import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { env } from '../env';
import { AuditAction, recordAudit, requestIp } from '../lib/audit';
import { ApiError, asyncHandler, parseBody } from '../lib/http';
import { googleAuthSchema, googleRegisterSchema, normaliseEmail } from '../lib/schemas';
import { toKeyMaterial } from '../lib/serialize';
import { signGoogleSignupToken, signSessionToken, verifyGoogleSignupToken } from '../lib/jwt';
import { generateCipherId } from '../lib/cipherId';
import { escrowWrap, isEscrowConfigured } from '../lib/otp';
import { randomBytes } from 'node:crypto';

/**
 * "Sign in with Google" (OAuth 2.0 authorization-code flow).
 *
 * The server performs the code exchange with its client secret, validates the
 * returned ID token against Google's tokeninfo endpoint, and links the local
 * account by verified email or Google subject. It then issues the regular
 * session JWT.
 *
 * IMPORTANT E2EE note: a Google login authenticates the *account* only. The
 * browser still needs the vault password to derive the key-encryption-key and
 * unwrap the master key, so the client lands on the existing /unlock screen.
 * Google never sees any key and the server still stores no plaintext.
 *
 * Setup: create OAuth credentials in Google Cloud Console and set
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI
 * (see docs/GOOGLE_AND_OTP_SETUP.md).
 */
export const googleAuthRouter = Router();

const googleLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many Google sign-in attempts. Please wait and try again.', code: 'RATE_LIMITED' },
});

interface GoogleTokenResponse {
  id_token?: string;
}

interface GoogleIdTokenClaims {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  aud?: string | string[];
}

/** Validates claims through Google's tokeninfo endpoint (over TLS). */
async function claimsFromIdToken(idToken: string): Promise<GoogleIdTokenClaims> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!response.ok) {
    throw ApiError.badRequest('Google rejected the sign-in. Please try again.', 'GOOGLE_TOKEN_INVALID');
  }
  const claims = (await response.json()) as GoogleIdTokenClaims & { aud?: string | string[] };

  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audiences.includes(env.googleClientId)) {
    throw ApiError.badRequest('Google sign-in was issued for a different application.', 'GOOGLE_AUD_MISMATCH');
  }
  return claims;
}

function requireGoogleConfig(): void {
  if (!env.googleEnabled) {
    throw ApiError.internal('Google sign-in is not configured on this server.', 'GOOGLE_UNCONFIGURED');
  }
}

/** Finds the local account for verified Google claims, linking by email once. */
async function resolveUser(
  claims: GoogleIdTokenClaims,
  req: { ip?: string; headers: Record<string, unknown> },
): Promise<{ id: string; email: string } | null> {
  const sub = claims.sub;
  const email = claims.email ? normaliseEmail(claims.email) : null;

  if (!sub || !email) {
    throw ApiError.badRequest('The Google account did not share an email address.', 'GOOGLE_NO_EMAIL');
  }
  if (claims.email_verified === false) {
    throw ApiError.badRequest('The Google email address is not verified.', 'GOOGLE_EMAIL_UNVERIFIED');
  }

  const existingByGoogleId = await prisma.user.findFirst({ where: { googleId: sub } });
  if (existingByGoogleId) {
    if (existingByGoogleId.email !== email) {
      // Google-verified email change: keep the account, sync the address.
      await prisma.user.update({ where: { id: existingByGoogleId.id }, data: { email } });
      existingByGoogleId.email = email;
    }
    return existingByGoogleId;
  }

  const existingByEmail = await prisma.user.findUnique({ where: { email } });
  if (existingByEmail) {
    // Link by verified email - the standard "same person, new login method".
    const linked = await prisma.user.update({ where: { id: existingByEmail.id }, data: { googleId: sub } });
    await recordAudit({
      userId: linked.id,
      action: AuditAction.GOOGLE_LINKED,
      targetType: 'USER',
      targetId: linked.id,
      ipAddress: requestIp(req),
    });
    return linked;
  }

  // A full account requires client-generated key material, so it cannot be
  // silently created server-side. Hand the verified identity back as a
  // short-lived signup token; the client collects the vault password, derives
  // keys locally, then completes via POST /auth/google/register.
  return null;
}

/** Shape returned when Google verified an identity that has no account yet. */
interface SignupRequired {
  signupRequired: true;
  signupToken: string;
  email: string;
  displayName: string;
}

type ResolvedGoogleUser = NonNullable<Awaited<ReturnType<typeof resolveUser>>>;

async function resolveUserOrSignup(
  claims: GoogleIdTokenClaims,
  req: { ip?: string; headers: Record<string, unknown> },
): Promise<{ kind: 'user'; user: ResolvedGoogleUser } | { kind: 'signup'; payload: SignupRequired }> {
  const resolved = await resolveUser(claims, req);
  if (resolved) return { kind: 'user', user: resolved };

  const email = normaliseEmail(claims.email!);
  // Prefer the Google profile name, trimmed to the local max length.
  const displayName = (claims.name ?? email.split('@')[0] ?? 'New user').trim().slice(0, 80) || 'New user';
  return {
    kind: 'signup',
    payload: {
      signupRequired: true,
      signupToken: signGoogleSignupToken({ sub: claims.sub!, email, displayName }),
      email,
      displayName,
    },
  };
}

/**
 * GET /api/auth/google/url
 *
 * Returns a fresh authorization URL plus a server-issued state value (CSRF
 * guard). The client opens the URL and echoes the state back on callback.
 */
googleAuthRouter.get(
  '/url',
  googleLimiter,
  asyncHandler(async (_req, res) => {
    requireGoogleConfig();

    const state = randomBytes(24).toString('hex');
    const params = new URLSearchParams({
      client_id: env.googleClientId,
      redirect_uri: env.googleRedirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });

    res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, state });
  }),
);

/**
 * POST /api/auth/google
 *
 * Body: { code, state } from the redirect flow, or { credential } when the
 * client uses Google Identity Services token flow. Responds with the same
 * shape as /auth/login plus `requiresUnlock: true`.
 */
googleAuthRouter.post(
  '/',
  googleLimiter,
  asyncHandler(async (req, res) => {
    requireGoogleConfig();
    const input = parseBody(googleAuthSchema, req.body);

    let claims: GoogleIdTokenClaims;

    if (input.code) {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: input.code,
          client_id: env.googleClientId,
          client_secret: env.googleClientSecret,
          redirect_uri: env.googleRedirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenResponse.ok) {
        throw ApiError.badRequest('Google rejected the sign-in attempt.', 'GOOGLE_CODE_INVALID');
      }
      const tokens = (await tokenResponse.json()) as GoogleTokenResponse;
      if (!tokens.id_token) {
        throw ApiError.badRequest('Google did not return an identity token.', 'GOOGLE_TOKEN_MISSING');
      }
      claims = await claimsFromIdToken(tokens.id_token);
    } else if (input.credential) {
      claims = await claimsFromIdToken(input.credential);
    } else {
      throw ApiError.badRequest('Provide either a Google authorization code or credential.', 'VALIDATION_ERROR');
    }

    const outcome = await resolveUserOrSignup(claims, req);

    if (outcome.kind === 'signup') {
      // Google verified the identity but no account exists yet: the client
      // shows the sign-up completion form and later calls /auth/google/register.
      res.json(outcome.payload);
      return;
    }

    const userId = outcome.user.id;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.internal('Account vanished during Google sign-in.', 'ACCOUNT_MISSING');

    await recordAudit({
      userId: user.id,
      action: AuditAction.GOOGLE_LOGIN,
      targetType: 'USER',
      targetId: user.id,
      ipAddress: requestIp(req),
      metadata: { email: user.email },
    });

    res.json({
      token: signSessionToken(user),
      user: toKeyMaterial(user),
      // The vault is always "locked" after a Google login: no password-derived
      // key exists in this browser, so the client must show /unlock.
      requiresUnlock: true,
    });
  }),
);

/**
 * POST /auth/google/register
 *
 * Completes sign-up for a Google-verified identity. The browser has generated
 * the whole key hierarchy locally under the chosen vault password (identical
 * to the classic register flow); the only difference is that the email comes
 * from the signed signup token instead of the request body, and the Google ID
 * is linked immediately so sign-in works right away.
 */
googleAuthRouter.post(
  '/register',
  googleLimiter,
  asyncHandler(async (req, res) => {
    requireGoogleConfig();
    const input = parseBody(googleRegisterSchema, req.body);
    const claims = verifyGoogleSignupToken(input.signupToken);
    const email = normaliseEmail(claims.email);

    // The identity was verified minutes ago at most; re-check the DB in case
    // the account was created in another tab in the meantime.
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw ApiError.conflict('An account with that email address already exists', 'EMAIL_TAKEN');
    }

    const { hashPassword } = await import('../lib/password');
    const passwordHash = await hashPassword(input.password);

    const escrow =
      input.masterKeyRaw && isEscrowConfigured()
        ? escrowWrap(Buffer.from(input.masterKeyRaw, 'base64'))
        : null;

    const user = await prisma.user.create({
      data: {
        email,
        displayName: input.displayName.trim(),
        cipherId: await generateCipherId(),
        passwordHash,
        googleId: claims.sub,
        publicKey: input.publicKey,
        wrappedPrivateKey: input.wrappedPrivateKey,
        privateKeyIv: input.privateKeyIv,
        kdfSalt: input.kdfSalt,
        kdfIterations: input.kdfIterations,
        wrappedMasterKey: input.wrappedMasterKey,
        masterKeyIv: input.masterKeyIv,
        ...(escrow
          ? { escrowWrappedMasterKey: escrow.wrapped, escrowMasterKeyIv: escrow.iv, escrowUpdatedAt: new Date() }
          : {}),
      },
    });

    await recordAudit({
      userId: user.id,
      action: AuditAction.GOOGLE_REGISTER,
      targetType: 'USER',
      targetId: user.id,
      ipAddress: requestIp(req),
      metadata: { email: user.email },
    });

    res.status(201).json({
      token: signSessionToken(user),
      user: toKeyMaterial(user),
    });
  }),
);
