import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { env } from '../env';
import { AuditAction, recordAudit, requestIp } from '../lib/audit';
import { ApiError, asyncHandler, parseBody } from '../lib/http';
import { burnPasswordComparison, hashPassword, verifyPassword } from '../lib/password';
import { normaliseEmail, loginSchema, registerSchema } from '../lib/schemas';
import { toKeyMaterial } from '../lib/serialize';
import { signSessionToken } from '../lib/jwt';
import { currentUserId, requireAuth } from '../middleware/auth';

export const authRouter = Router();

// Credential endpoints get a much tighter budget than the rest of the API.
const credentialsLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  limit: env.authRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait and try again.', code: 'RATE_LIMITED' },
});

/**
 * POST /api/auth/register
 *
 * The client generates all key material locally and sends only:
 *   - the public key (safe to share),
 *   - the private key wrapped with the user's master key,
 *   - the master key wrapped with a password-derived key.
 * The server cannot unwrap any of it, and the password it hashes is never
 * stored in a form that can decrypt anything.
 */
authRouter.post(
  '/register',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(registerSchema, req.body);
    const email = normaliseEmail(input.email);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw ApiError.conflict('An account with that email address already exists', 'EMAIL_TAKEN');
    }

    const passwordHash = await hashPassword(input.password);

    const user = await prisma.user.create({
      data: {
        email,
        displayName: input.displayName.trim(),
        passwordHash,
        publicKey: input.publicKey,
        wrappedPrivateKey: input.wrappedPrivateKey,
        privateKeyIv: input.privateKeyIv,
        kdfSalt: input.kdfSalt,
        kdfIterations: input.kdfIterations,
        wrappedMasterKey: input.wrappedMasterKey,
        masterKeyIv: input.masterKeyIv,
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
 * POST /api/auth/login
 *
 * The server verifies the bcrypt hash, then hands back the user's wrapped key
 * material. The browser repeats the PBKDF2 derivation locally to unwrap it -
 * the server never sees the resulting keys.
 */
authRouter.post(
  '/login',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(loginSchema, req.body);
    const email = normaliseEmail(input.email);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Spend comparable time so that response latency does not disclose
      // whether an account exists for this address.
      await burnPasswordComparison(input.password);
      throw ApiError.unauthorized('Incorrect email or password', 'INVALID_CREDENTIALS');
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash);
    if (!passwordMatches) {
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
 * POST /api/auth/logout
 *
 * Sessions are stateless JWTs, so logout is a client-side token discard plus an
 * audit record. A production deployment would keep a token denylist here.
 */
authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await recordAudit({
      userId: currentUserId(req),
      action: AuditAction.LOGOUT,
      targetType: 'USER',
      targetId: currentUserId(req),
      ipAddress: requestIp(req),
    });
    res.status(204).send();
  }),
);
