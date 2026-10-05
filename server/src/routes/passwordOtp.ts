import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { env } from '../env';
import { AuditAction, recordAudit, requestIp } from '../lib/audit';
import { ApiError, asyncHandler, parseBody } from '../lib/http';
import { hashPassword } from '../lib/password';
import { escrowUnwrap, isEscrowConfigured, issueOtp, verifyOtp } from '../lib/otp';
import { normaliseEmail, otpRequestSchema, otpResetSchema, otpVerifySchema } from '../lib/schemas';
import { toKeyMaterial } from '../lib/serialize';
import { signPasswordResetToken, signSessionToken, verifyPasswordResetToken } from '../lib/jwt';

/**
 * Gmail OTP password reset.
 *
 * Three steps:
 *   1. POST /request-code - email a one-time numeric code to the account.
 *   2. POST /verify-code  - check the code; on success return profile info,
 *      a short-lived reset token, AND the raw (escrow-unwrapped) master key.
 *      The browser needs the master key BEFORE the reset call so it can
 *      re-wrap the whole local key hierarchy under the new password.
 *   3. POST /reset        - exchange the reset token for the persisted new
 *      password hash + wraps. The escrow copy survives untouched because the
 *      master key itself never changes.
 */
export const passwordOtpRouter = Router();

// OTP endpoints are credential-adjacent: tight budget, keyed per IP.
const otpLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  limit: env.authRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait and try again.', code: 'RATE_LIMITED' },
});

/**
 * POST /api/auth/password/request-code
 *
 * Emails a one-time code. The response shape is identical whether or not the
 * address is registered, so it never discloses account existence.
 */
passwordOtpRouter.post(
  '/request-code',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(otpRequestSchema, req.body);
    const email = normaliseEmail(input.email);

    if (!isEscrowConfigured()) {
      throw ApiError.internal(
        'Email-code reset is not available on this server. Use your recovery key instead.',
        'ESCROW_UNCONFIGURED',
      );
    }

    const result = await issueOtp(email, requestIp(req));

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      await recordAudit({
        userId: user.id,
        action: AuditAction.OTP_REQUEST,
        targetType: 'USER',
        targetId: user.id,
        ipAddress: requestIp(req),
      });
    }

    res.json({
      sentTo: result.sentTo,
      cooldownSeconds: result.cooldownSeconds,
      expiresInSeconds: env.otpTtlMinutes * 60,
      deliveredViaConsole: result.deliveredViaConsole,
    });
  }),
);

/**
 * POST /api/auth/password/verify-code
 *
 * Verifies the code, consumes it, and hands back:
 *   - resetToken: single-purpose JWT, 10 minutes, authorises one /reset call
 *   - masterKeyRaw: the escrow-unwrapped master key (base64) so the browser
 *     can rebuild its key hierarchy under the new password BEFORE /reset
 */
passwordOtpRouter.post(
  '/verify-code',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(otpVerifySchema, req.body);
    const email = normaliseEmail(input.email);

    let user;
    try {
      user = await verifyOtp(email, input.code);
    } catch (error) {
      const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        await recordAudit({
          userId: existing.id,
          action: AuditAction.OTP_VERIFY_FAILED,
          targetType: 'USER',
          targetId: existing.id,
          ipAddress: requestIp(req),
        });
      }
      throw error;
    }

    if (!user.escrowWrappedMasterKey || !user.escrowMasterKeyIv || !isEscrowConfigured()) {
      throw ApiError.badRequest(
        'No email-based recovery copy exists for this account. Use your recovery key instead.',
        'ESCROW_MISSING',
      );
    }

    const masterKeyRaw = escrowUnwrap(user.escrowWrappedMasterKey, user.escrowMasterKeyIv);
    const resetToken = signPasswordResetToken(user.id);

    await recordAudit({
      userId: user.id,
      action: AuditAction.OTP_REQUEST,
      targetType: 'USER',
      targetId: user.id,
      ipAddress: requestIp(req),
      metadata: { stage: 'verified' },
    });

    res.json({
      resetToken,
      displayName: user.displayName,
      masterKeyRaw: masterKeyRaw.toString('base64'),
      expiresInSeconds: 10 * 60,
    });
  }),
);

/**
 * POST /api/auth/password/reset
 *
 * Exchanges the reset token for the completed reset: new bcrypt hash, new
 * password-wrapped master key, and a re-wrapped private key (the client
 * re-encrypts it under the same master key with a fresh nonce). The escrow
 * copy is left as-is: the master key is unchanged, so it stays valid.
 */
passwordOtpRouter.post(
  '/reset',
  otpLimiter,
  asyncHandler(async (req, res) => {
    const input = parseBody(otpResetSchema, req.body);
    const payload = verifyPasswordResetToken(input.resetToken);

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw ApiError.badRequest('This account no longer exists', 'ACCOUNT_MISSING');
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
        // wrappedPrivateKey stays valid: it is wrapped with the master key,
        // which the OTP flow recovers unchanged. The escrow copy likewise
        // remains valid for the same reason.
      },
    });

    await recordAudit({
      userId: user.id,
      action: AuditAction.PASSWORD_RESET_OTP,
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
