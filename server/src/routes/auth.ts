import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { env } from '../env';
import { AuditAction, recordAudit, requestIp } from '../lib/audit';
import { ApiError, asyncHandler, parseBody } from '../lib/http';
import { createHash } from 'node:crypto';
import { burnPasswordComparison, hashPassword, verifyPassword } from '../lib/password';
import {
  normaliseEmail,
  loginSchema,
  registerSchema,
  recoverySetupSchema,
  recoveryChallengeSchema,
  recoveryResetSchema,
} from '../lib/schemas';
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

// --- Password recovery ------------------------------------------------------
//
// Zero-knowledge design: the server NEVER learns the recovery key or any key
// that can decrypt notes. It stores (a) the master key wrapped under a
// recovery-key-derived KEK and (b) a salted SHA-256 hash used to verify the
// key. An attacker with the full database still needs the user's recovery key
// (or password) to unwrap anything.

/** Server-side verification hash: SHA-256(salt || presented hash input). */
function verifyRecoveryHash(recoveryKeyHash: string, storedSalt: string, storedHash: string): boolean {
  const expected = createHash('sha256').update(`${storedSalt}:${recoveryKeyHash}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/auth/recovery/setup
 *
 * Called during registration (or re-generation in settings). The browser has
 * derived a KEK from the fresh recovery key and re-wrapped the master key
 * under it. Store the wrap + derivation params + verification hash.
 */
authRouter.post(
  '/recovery/setup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const input = parseBody(recoverySetupSchema, req.body);

    const serverSalt = randomBytes(16).toString('hex');
    const pepperedHash = createHash('sha256').update(`${serverSalt}:${input.recoveryKeyHash}`).digest('hex');

    await prisma.user.update({
      where: { id: userId },
      data: {
        wrappedMasterKeyRecovery: input.wrappedMasterKeyRecovery,
        masterKeyRecoveryIv: input.masterKeyRecoveryIv,
        recoveryKdfSalt: input.kdfSalt,
        recoveryKdfIterations: input.kdfIterations,
        recoveryKeyHash: `${serverSalt}:${pepperedHash}`,
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
 * the account? Returns the wrapped master key + derivation params so the
 * browser can decrypt it IN MEMORY and derive the new password KEK. The
 * server still cannot unwrap anything, and the key is not burned until the
 * reset endpoint completes successfully.
 */
authRouter.post(
  '/recovery/challenge',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(recoveryChallengeSchema, req.body);
    const email = normaliseEmail(input.email);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.recoveryKeyHash || !user.wrappedMasterKeyRecovery || !user.recoveryKdfSalt) {
      await burnPasswordComparison(input.recoveryKey);
      throw ApiError.badRequest('This recovery key does not match the account', 'RECOVERY_KEY_INVALID');
    }

    if (user.recoveryKeyUsedAt) {
      throw ApiError.badRequest(
        'This recovery key has already been used and cannot be used again',
        'RECOVERY_KEY_USED',
      );
    }

    const [serverSalt, storedHash] = user.recoveryKeyHash.split(':');
    if (!serverSalt || !storedHash || !verifyRecoveryHash(input.recoveryKeyHash, serverSalt, storedHash)) {
      await recordAudit({
        userId: user.id,
        action: AuditAction.RECOVERY_CHALLENGE_FAILED,
        targetType: 'USER',
        targetId: user.id,
        ipAddress: requestIp(req),
      });
      await burnPasswordComparison(input.recoveryKey);
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
 * under it, and re-wrapped the private key too. The server stores the new
 * bcrypt hash and the new wraps, and burns the recovery key.
 */
authRouter.post(
  '/recovery/reset',
  credentialsLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(recoveryResetSchema, req.body);
    const email = normaliseEmail(input.email);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.recoveryKeyHash) {
      await burnPasswordComparison(input.newPassword);
      throw ApiError.badRequest('This recovery key does not match the account', 'RECOVERY_KEY_INVALID');
    }

    if (user.recoveryKeyUsedAt) {
      throw ApiError.badRequest(
        'This recovery key has already been used and cannot be used again',
        'RECOVERY_KEY_USED',
      );
    }

    const [serverSalt, storedHash] = user.recoveryKeyHash.split(':');
    if (!serverSalt || !storedHash || !verifyRecoveryHash(input.recoveryKeyHash, serverSalt, storedHash)) {
      await recordAudit({
        userId: user.id,
        action: AuditAction.RECOVERY_RESET_FAILED,
        targetType: 'USER',
        targetId: user.id,
        ipAddress: requestIp(req),
      });
      await burnPasswordComparison(input.newPassword);
      throw ApiError.badRequest('This recovery key does not match the account', 'RECOVERY_KEY_INVALID');
    }

    const passwordHash = await hashPassword(input.newPassword);

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        kdfSalt: input.kdfSalt,
        kdfIterations: input.kdfIterations,
        wrappedMasterKey: input.wrappedMasterKey,
        masterKeyIv: input.masterKeyIv,
        // The private key is wrapped with the master key, which is unchanged,
        // so wrappedPrivateKey stays valid and is NOT touched here.
        recoveryKeyUsedAt: new Date(),
      },
    });

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
