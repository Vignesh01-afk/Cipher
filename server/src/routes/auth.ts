import { Router } from 'express';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { env } from '../env';
import { AuditAction, recordAudit, requestIp } from '../lib/audit';
import { ApiError, asyncHandler, parseBody } from '../lib/http';
import { burnPasswordComparison, hashPassword, verifyPassword } from '../lib/password';
import {
  normaliseEmail,
  loginSchema,
  preloginSchema,
  registerSchema,
  recoverySetupSchema,
  recoveryChallengeSchema,
  recoveryResetSchema,
  upgradeAuthSchema,
} from '../lib/schemas';
import { toKeyMaterial } from '../lib/serialize';
import { signSessionToken } from '../lib/jwt';
import { currentUserId, requireAuth } from '../middleware/auth';
import { escrowWrap, isEscrowConfigured } from '../lib/otp';
import { generateCipherId } from '../lib/cipherId';
import { createRateLimitStore, hashKeyPart } from '../lib/rateLimitStore';

function fromBase64(value: string): Buffer {
  return Buffer.from(value, 'base64');
}

export const authRouter = Router();

// Credential endpoints get a much tighter budget than the rest of the API.
const credentialsLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  limit: env.authRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: createRateLimitStore(),
  message: { error: 'Too many authentication attempts. Please wait and try again.', code: 'RATE_LIMITED' },
});

/**
 * Second, stricter budget on /login keyed on the ACCOUNT rather than the IP.
 *
 * The IP limiter above stops one host from hammering the API; this one stops
 * a distributed botnet from spraying guesses for a single account from many
 * addresses (which the per-IP counter cannot see). The key is a hash of the
 * normalised email so no raw address lands in the rate-limit store, and it
 * falls back to the trusted `req.ip` when the body carries no email.
 */
const loginAccountLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  limit: env.authRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: createRateLimitStore(),
  keyGenerator: (req) => {
    const raw = (req.body as { email?: unknown } | undefined)?.email;
    return typeof raw === 'string' && raw.trim()
      ? `acct:${hashKeyPart(raw)}`
      : `ip:${req.ip ?? 'unknown'}`;
  },
  message: { error: 'Too many sign-in attempts for this account. Please wait and try again.', code: 'RATE_LIMITED' },
});

/**
 * POST /api/auth/register
 *
 * The client generates all key material locally and sends only:
 *   - the public key (safe to share),
 *   - the private key wrapped with the user's master key,
 *   - the master key wrapped with a password-derived key,
 *   - the authKey (second half of the split PBKDF2 derivation) that the
 *     server bcrypt-hashes as the login credential.
 * The server never receives the password (authVersion 2), and nothing it
 * stores can decrypt anything.
 */
authRouter.post(
  '/register',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(registerSchema, req.body);
    const email = normaliseEmail(input.email);
    const credential = input.authKey ?? input.password;
    if (!credential) {
      throw ApiError.badRequest('A credential is required', 'VALIDATION_ERROR');
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw ApiError.conflict('An account with that email address already exists', 'EMAIL_TAKEN');
    }

    const passwordHash = await hashPassword(credential);

    // Optional escrow of the raw master key (enables OTP-only password
    // reset later). The key is wrapped with a server-side secret immediately
    // and only the wrap is persisted; the raw bytes are never stored.
    const escrow =
      input.masterKeyRaw && isEscrowConfigured()
        ? escrowWrap(fromBase64(input.masterKeyRaw))
        : null;

    const user = await prisma.user.create({
      data: {
        email,
        displayName: input.displayName.trim(),
        cipherId: await generateCipherId(),
        passwordHash,
        // authKey -> split scheme (v2); a legacy raw password -> v1.
        authVersion: input.authKey ? 2 : 1,
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
      action: AuditAction.REGISTER,
      targetType: 'USER',
      targetId: user.id,
      ipAddress: requestIp(req),
    });

    res.status(201).json({
      token: signSessionToken(user),
      user: toKeyMaterial(user),
    });
  }),
);

/**
 * POST /api/auth/prelogin
 *
 * Public KDF parameters, fetched BEFORE building a login credential:
 * the client needs `authVersion` (password vs authKey) plus the salt and
 * iteration count to derive the 512-bit secret locally.
 *
 * Unknown emails receive deterministic pseudo-parameters derived from an HMAC
 * of the address: the response is identical on every probe for the same
 * email and shaped exactly like a real account's, so this endpoint cannot be
 * used to enumerate accounts. The pseudo authVersion is drawn from the HMAC
 * so fabricated accounts mimic both schemes, not just one.
 */
authRouter.post(
  '/prelogin',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(preloginSchema, req.body);
    const email = normaliseEmail(input.email);

    const user = await prisma.user.findUnique({
      where: { email },
      select: { authVersion: true, kdfSalt: true, kdfIterations: true },
    });

    if (user) {
      // kdfSalt / kdfIterations / authVersion are public by design: they are
      // needed to derive the credential and reveal nothing that unwraps keys.
      res.json({ authVersion: user.authVersion, kdfSalt: user.kdfSalt, kdfIterations: user.kdfIterations });
      return;
    }

    const mac = createHmac('sha256', env.jwtSecret).update(`prelogin:${email}`).digest();
    res.json({
      authVersion: mac[0]! % 2 === 0 ? 1 : 2,
      kdfSalt: mac.subarray(0, 16).toString('base64'),
      kdfIterations: 210_000,
    });
  }),
);

/**
 * POST /api/auth/login
 *
 * Verifies the bcrypt credential, then hands back the user's wrapped key
 * material. On the split scheme (authVersion 2) the credential is the authKey
 * - the second half of a 512-bit PBKDF2 derivation - and the server has never
 * seen, and cannot recompute, the first half (the KEK). Legacy v1 accounts
 * still authenticate with the raw password and are migrated by the client
 * via POST /auth/upgrade-auth after a successful login.
 */
authRouter.post(
  '/login',
  credentialsLimiter,
  loginAccountLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(loginSchema, req.body);
    const email = normaliseEmail(input.email);
    const usingAuthKey = typeof input.authKey === 'string';
    const credential = input.authKey ?? input.password ?? '';

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Spend comparable time so that response latency does not disclose
      // whether an account exists for this address.
      await burnPasswordComparison(credential);
      throw ApiError.unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
    }

    // The presented credential must match the scheme the hash was made with:
    // a v2 account never accepts a raw password (the server no longer stores
    // anything derived from it) and a v1 account never accepts an authKey.
    const schemeMatches = usingAuthKey ? user.authVersion >= 2 : user.authVersion === 1;
    let credentialMatches = false;
    if (schemeMatches) {
      credentialMatches = await verifyPassword(credential, user.passwordHash);
    } else {
      await burnPasswordComparison(credential);
    }

    if (!credentialMatches) {
      await recordAudit({
        userId: user.id,
        action: AuditAction.LOGIN_FAILED,
        targetType: 'USER',
        targetId: user.id,
        ipAddress: requestIp(req),
      });
      throw ApiError.unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
    }

    await recordAudit({
      userId: user.id,
      action: AuditAction.LOGIN,
      targetType: 'USER',
      targetId: user.id,
      ipAddress: requestIp(req),
      metadata: { email: user.email },
    });

    res.json({
      token: signSessionToken(user),
      user: toKeyMaterial(user),
    });
  }),
);

/** GET /api/auth/me - rehydrate a session after a page reload. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: currentUserId(req) } });
    if (!user) {
      throw ApiError.unauthorized('This account no longer exists', 'ACCOUNT_MISSING');
    }
    res.json({ user: toKeyMaterial(user) });
  }),
);

/**
 * POST /api/auth/upgrade-auth
 *
 * Legacy (v1) -> split (v2) migration, called by the client right after a
 * successful password login. The client re-derives 512 bits locally and sends
 * only the SECOND half; the server bcrypt-hashes it and bumps authVersion to
 * 2. The first half (the KEK) is byte-identical to the old direct 256-bit
 * derivation - PBKDF2 output is block-structured - so every key already
 * wrapped under the KEK keeps unlocking without re-encryption.
 *
 * Idempotent: upgrading an already-v2 account is a no-op.
 */
authRouter.post(
  '/upgrade-auth',
  requireAuth,
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(upgradeAuthSchema, req.body);
    const userId = currentUserId(req);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, authVersion: true },
    });
    if (!user) {
      throw ApiError.unauthorized('This account no longer exists', 'ACCOUNT_MISSING');
    }
    if (user.authVersion >= 2) {
      res.json({ ok: true, authVersion: user.authVersion });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(input.authKey), authVersion: 2 },
    });

    res.json({ ok: true, authVersion: 2 });
  }),
);

/**
 * POST /api/auth/logout
 *
 * Sessions are revocable JWTs: bumping `tokenVersion` invalidates every token
 * issued for this account before now (including any copy an attacker holds),
 * because requireAuth compares the claim against the current row on every
 * request. The client also discards its copy of the token.
 */
authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await recordAudit({
      userId,
      action: AuditAction.LOGOUT,
      targetType: 'USER',
      targetId: userId,
      ipAddress: requestIp(req),
    });
    res.status(204).send();
  }),
);

// --- Password recovery ------------------------------------------------------
//
// Zero-knowledge design: the server NEVER learns the recovery key or any key
// that can decrypt notes. It stores (a) the master key wrapped under a
// recovery-key-derived KEK and (b) a peppered hash of the client-computed
// VERIFIER (HKDF-SHA256 of the key with the info string
// "ciphernote-recovery-verifier") used to verify a presented key. An attacker
// with the full database still needs the user's recovery key (or password) to
// unwrap anything.

/**
 * Server-side verification hash for the recovery verifier:
 * SHA-256(serverSalt || verifier), compared in constant time. The verifier
 * itself is a one-way HKDF value, so neither this row nor the verifier alone
 * reveals the raw recovery key.
 */
function verifyRecoveryVerifier(recoveryVerifier: string, storedSalt: string, storedHash: string): boolean {
  const expected = createHash('sha256').update(`${storedSalt}:${recoveryVerifier}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/auth/recovery/setup
 *
 * Called during registration (or re-generation in settings). The browser has
 * derived a KEK from the fresh recovery key and re-wrapped the master key
 * under it, then computed the HKDF verifier. Store the wrap + derivation
 * params + verifier hash - never the raw key, which stays in the browser.
 */
authRouter.post(
  '/recovery/setup',
  requireAuth,
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const input = parseBody(recoverySetupSchema, req.body);

    // Re-authenticate: a valid session alone must not be able to mint a new
    // recovery key (a durable account-takeover primitive). The same
    // scheme-aware check as /login applies, with a dummy comparison on
    // mismatch so timing does not disclose the account's authVersion.
    const account = await prisma.user.findUnique({ where: { id: userId } });
    if (!account) {
      throw ApiError.unauthorized('This account no longer exists', 'ACCOUNT_MISSING');
    }
    const usingAuthKey = typeof input.authKey === 'string';
    const credential = input.authKey ?? input.password ?? '';
    const schemeMatches = usingAuthKey ? account.authVersion >= 2 : account.authVersion === 1;
    let reauthenticated = false;
    if (schemeMatches) {
      reauthenticated = await verifyPassword(credential, account.passwordHash);
    } else {
      await burnPasswordComparison(credential);
    }
    if (!reauthenticated) {
      await recordAudit({
        userId,
        action: AuditAction.RECOVERY_CHALLENGE_FAILED,
        targetType: 'USER',
        targetId: userId,
        metadata: { stage: 'recovery-setup-reauth' },
        ipAddress: requestIp(req),
      });
      throw ApiError.unauthorized('Re-enter your account password to continue', 'REAUTH_REQUIRED');
    }

    const serverSalt = randomBytes(16).toString('hex');
    const pepperedHash = createHash('sha256').update(`${serverSalt}:${input.recoveryVerifier}`).digest('hex');

    await prisma.user.update({
      where: { id: userId },
      data: {
        wrappedMasterKeyRecovery: input.wrappedMasterKeyRecovery,
        masterKeyRecoveryIv: input.masterKeyRecoveryIv,
        recoveryKdfSalt: input.kdfSalt,
        recoveryKdfIterations: input.kdfIterations,
        recoveryVerifier: `${serverSalt}:${pepperedHash}`,
        recoveryKeyUsedAt: null,
      },
    });

    await recordAudit({
      userId,
      action: AuditAction.RECOVERY_SETUP,
      targetType: 'USER',
      targetId: userId,
      ipAddress: requestIp(req),
    });

    res.status(200).json({ ok: true });
  }),
);

/**
 * POST /api/auth/recovery/challenge
 *
 * Pre-reset check from the forgot-password page: does this recovery key match
 * the account? The browser sends only the HKDF verifier. On success the
 * server returns the wrapped master key + derivation params so the browser
 * can decrypt it IN MEMORY and derive the new password KEK. The server still
 * cannot unwrap anything, and nothing is burned until the reset completes.
 */
authRouter.post(
  '/recovery/challenge',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(recoveryChallengeSchema, req.body);
    const email = normaliseEmail(input.email);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.recoveryVerifier || !user.wrappedMasterKeyRecovery || !user.recoveryKdfSalt) {
      await burnPasswordComparison(input.recoveryVerifier);
      throw ApiError.badRequest('This recovery key does not match the account', 'RECOVERY_KEY_INVALID');
    }

    if (user.recoveryKeyUsedAt) {
      throw ApiError.badRequest(
        'This recovery key has already been used and cannot be used again',
        'RECOVERY_KEY_USED',
      );
    }

    const [serverSalt, storedHash] = user.recoveryVerifier.split(':');
    if (!serverSalt || !storedHash || !verifyRecoveryVerifier(input.recoveryVerifier, serverSalt, storedHash)) {
      await recordAudit({
        userId: user.id,
        action: AuditAction.RECOVERY_CHALLENGE_FAILED,
        targetType: 'USER',
        targetId: user.id,
        ipAddress: requestIp(req),
      });
      await burnPasswordComparison(input.recoveryVerifier);
      throw ApiError.badRequest('This recovery key does not match the account', 'RECOVERY_KEY_INVALID');
    }

    await recordAudit({
      userId: user.id,
      action: AuditAction.RECOVERY_CHALLENGE,
      targetType: 'USER',
      targetId: user.id,
      ipAddress: requestIp(req),
    });

    res.json({
      displayName: user.displayName,
      wrappedMasterKeyRecovery: user.wrappedMasterKeyRecovery,
      masterKeyRecoveryIv: user.masterKeyRecoveryIv,
      recoveryKdfSalt: user.recoveryKdfSalt,
      recoveryKdfIterations: user.recoveryKdfIterations,
      privateKeyIv: user.privateKeyIv,
      wrappedPrivateKey: user.wrappedPrivateKey,
    });
  }),
);

/**
 * POST /api/auth/recovery/reset
 *
 * Completes the reset. By now the browser has: unwrapped the master key with
 * the recovery KEK, derived a NEW password KEK, re-wrapped the master key
 * under it, and sent the split authKey for the new password. The server
 * stores the new bcrypt hash and the new wraps, and burns the recovery key.
 *
 * The write is atomic (`updateMany` conditioned on `recoveryKeyUsedAt: null`)
 * so two concurrent resets cannot both succeed: the loser sees count 0.
 */
authRouter.post(
  '/recovery/reset',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(recoveryResetSchema, req.body);
    const email = normaliseEmail(input.email);
    const credential = input.authKey ?? input.newPassword;
    if (!credential) {
      throw ApiError.badRequest('A credential is required', 'VALIDATION_ERROR');
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.recoveryVerifier) {
      await burnPasswordComparison(credential);
      throw ApiError.badRequest('This recovery key does not match the account', 'RECOVERY_KEY_INVALID');
    }

    if (user.recoveryKeyUsedAt) {
      throw ApiError.badRequest(
        'This recovery key has already been used and cannot be used again',
        'RECOVERY_KEY_USED',
      );
    }

    const [serverSalt, storedHash] = user.recoveryVerifier.split(':');
    if (!serverSalt || !storedHash || !verifyRecoveryVerifier(input.recoveryVerifier, serverSalt, storedHash)) {
      await recordAudit({
        userId: user.id,
        action: AuditAction.RECOVERY_RESET_FAILED,
        targetType: 'USER',
        targetId: user.id,
        ipAddress: requestIp(req),
      });
      await burnPasswordComparison(credential);
      throw ApiError.badRequest('This recovery key does not match the account', 'RECOVERY_KEY_INVALID');
    }

    const passwordHash = await hashPassword(credential);

    const result = await prisma.user.updateMany({
      where: { id: user.id, recoveryKeyUsedAt: null },
      data: {
        passwordHash,
        // Which credential we just stored decides the login scheme.
        authVersion: input.authKey ? 2 : 1,
        kdfSalt: input.kdfSalt,
        kdfIterations: input.kdfIterations,
        wrappedMasterKey: input.wrappedMasterKey,
        masterKeyIv: input.masterKeyIv,
        // The private key is wrapped with the master key, which is unchanged,
        // so wrappedPrivateKey stays valid and is NOT touched here.
        recoveryKeyUsedAt: new Date(),
        // A password change must end every existing session.
        tokenVersion: { increment: 1 },
        // Refresh the escrow copy too so the OTP path keeps working after a
        // recovery-key reset (the master key itself is unchanged; re-wrapping
        // simply re-encrypts it under the current escrow secret).
        ...(input.masterKeyRaw && isEscrowConfigured()
          ? (() => {
              const wrap = escrowWrap(fromBase64(input.masterKeyRaw));
              return { escrowWrappedMasterKey: wrap.wrapped, escrowMasterKeyIv: wrap.iv, escrowUpdatedAt: new Date() };
            })()
          : {}),
      },
    });

    if (result.count === 0) {
      // A concurrent reset burned the key between our check and this write.
      throw ApiError.badRequest(
        'This recovery key has already been used and cannot be used again',
        'RECOVERY_KEY_USED',
      );
    }

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    if (!updated) {
      throw ApiError.internal('Account disappeared during reset', 'ACCOUNT_MISSING');
    }

    await recordAudit({
      userId: user.id,
      action: AuditAction.RECOVERY_RESET,
      targetType: 'USER',
      targetId: user.id,
      ipAddress: requestIp(req),
      metadata: { email: user.email },
    });

    res.json({
      token: signSessionToken(updated),
      user: toKeyMaterial(updated),
    });
  }),
);
