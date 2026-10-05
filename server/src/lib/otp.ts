import { createHash, randomInt, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { prisma } from '../db';
import { env } from '../env';
import { sendMail, otpEmailText, otpEmailHtml } from './mailer';
import { ApiError } from './http';
import { normaliseEmail } from './schemas';

/**
 * Email OTP for password reset, plus the AES-256-GCM escrow that makes the
 * OTP-only reset possible.
 *
 * OTP storage: only SHA-256(code) is persisted, scoped to the user and the
 * purpose. Verification is rate limited (per-user attempts + a coarse IP
 * limiter on the route) and the row is consumed on first success, so codes
 * are single-use. Resending replaces the previous code.
 *
 * Escrow: the client uploads the raw master key once over TLS (registration
 * or recovery reset), the server wraps it with ESCROW_MASTER_KEY and stores
 * the blob. This is deliberately NOT zero knowledge - it is the trade-off
 * the user chose so a verified Gmail OTP can always recover the vault. The
 * master key itself never changes, so the escrow copy survives password
 * resets; only a recovery-key re-wrap requires re-uploading it.
 */

const OTP_PURPOSE = 'PASSWORD_RESET';

/** Derives the 32-byte AES key from the configured escrow secret. */
function escrowKey(): Buffer {
  const secret = env.escrowMasterKey;
  if (!secret) {
    throw ApiError.internal('Master-key escrow is not configured on this server', 'ESCROW_UNCONFIGURED');
  }
  // Accept base64 or hex of 32 bytes, else derive from the raw string.
  if (/^[A-Za-z0-9+/=]+$/.test(secret) && secret.length === 44) {
    const decoded = Buffer.from(secret, 'base64');
    if (decoded.length === 32) return decoded;
  }
  if (/^[a-fA-F0-9]{64}$/.test(secret)) {
    return Buffer.from(secret, 'hex');
  }
  return createHash('sha256').update(secret).digest();
}

export function isEscrowConfigured(): boolean {
  return Boolean(env.escrowMasterKey);
}

/** Wraps raw master-key bytes with the server escrow secret (AES-256-GCM). */
export function escrowWrap(masterKeyRaw: Uint8Array): { wrapped: string; iv: string } {
  const key = escrowKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(masterKeyRaw), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    wrapped: Buffer.concat([tag, encrypted]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

/** Unwraps an escrowed master key. Throws a generic error on any mismatch. */
export function escrowUnwrap(wrappedBase64: string, ivBase64: string): Buffer {
  const key = escrowKey();
  const blob = Buffer.from(wrappedBase64, 'base64');
  if (blob.length <= 16) {
    throw ApiError.internal('Escrowed key material is corrupt', 'ESCROW_CORRUPT');
  }
  const tag = blob.subarray(0, 16);
  const encrypted = blob.subarray(16);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch {
    throw ApiError.internal('Escrowed key material failed authentication', 'ESCROW_CORRUPT');
  }
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generateNumericCode(): string {
  // Zero-padded numeric code; 8 digits by default (~1e8 space) which, combined
  // with attempt limits and short expiry, is adequate for email OTP.
  const max = 10 ** env.otpLength;
  return randomInt(0, max).toString().padStart(env.otpLength, '0');
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return 'your email';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export interface OtpRequestResult {
  /** Masked address, safe to show in the UI. */
  sentTo: string;
  cooldownSeconds: number;
  /** Only true when SMTP is unconfigured AND debug logging is on. */
  deliveredViaConsole: boolean;
}

/**
 * Issues a fresh OTP for the account, replacing any previous one.
 *
 * Always reports success even when the account does not exist: responses must
 * not disclose whether an email is registered. Audit entries are written for
 * real users only, so the audit trail stays clean.
 */
export async function issueOtp(rawEmail: string, ip: string | null): Promise<OtpRequestResult> {
  const email = normaliseEmail(rawEmail);
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Burn comparable time so latency does not leak account existence.
    await new Promise((resolve) => setTimeout(resolve, 50 + randomInt(0, 40)));
    const masked = maskEmail(email);
    return { sentTo: masked, cooldownSeconds: env.otpResendCooldownSeconds, deliveredViaConsole: false };
  }

  if (!isEscrowConfigured()) {
    // Without escrow there is nothing the OTP can unlock; fail loudly for the
    // real user rather than letting them hit a dead end after verification.
    throw ApiError.internal(
      'Email-code reset is not available on this server. Use your recovery key instead.',
      'ESCROW_UNCONFIGURED',
    );
  }

  // Per-hour send throttle per user.
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recentCount = await prisma.otpToken.count({
    where: { userId: user.id, purpose: OTP_PURPOSE, sentAt: { gte: since } },
  });
  if (recentCount >= env.otpSendMaxPerHour) {
    throw ApiError.badRequest(
      'Too many reset codes requested. Please try again later.',
      'OTP_RATE_LIMITED',
    );
  }

  // Cooldown between sends.
  const latest = await prisma.otpToken.findFirst({
    where: { userId: user.id, purpose: OTP_PURPOSE },
    orderBy: { sentAt: 'desc' },
  });
  if (latest) {
    const elapsedSeconds = (Date.now() - latest.sentAt.getTime()) / 1000;
    if (elapsedSeconds < env.otpResendCooldownSeconds) {
      const wait = Math.ceil(env.otpResendCooldownSeconds - elapsedSeconds);
      throw ApiError.badRequest(`Please wait ${wait}s before requesting another code.`, 'OTP_COOLDOWN', {
        retryAfterSeconds: wait,
      });
    }
  }

  const code = generateNumericCode();
  const expiresAt = new Date(Date.now() + env.otpTtlMinutes * 60 * 1000);

  // Replace any outstanding code for this purpose.
  await prisma.otpToken.deleteMany({ where: { userId: user.id, purpose: OTP_PURPOSE } });
  await prisma.otpToken.create({
    data: {
      userId: user.id,
      codeHash: hashCode(code),
      purpose: OTP_PURPOSE,
      expiresAt,
      sentAt: new Date(),
    },
  });

  try {
    await sendMail({
      to: user.email,
      subject: 'Your CipherNote password reset code',
      text: otpEmailText(code, env.otpTtlMinutes),
      html: otpEmailHtml(code, env.otpTtlMinutes),
    });
  } catch (error) {
    console.error('[otp] failed to send email', error);
    throw ApiError.internal('Could not send the reset email. Please try again.', 'OTP_SEND_FAILED');
  }

  return {
    sentTo: maskEmail(user.email),
    cooldownSeconds: env.otpResendCooldownSeconds,
    deliveredViaConsole: !env.smtpUser || !env.smtpPass ? env.otpDebugLog : false,
  };
}

export interface VerifiedOtpUser {
  id: string;
  email: string;
  displayName: string;
  escrowWrappedMasterKey: string | null;
  escrowMasterKeyIv: string | null;
}

/**
 * Verifies a presented code. Throws a 400 with a stable code on failure;
 * increments the attempt counter otherwise. Returns the user when correct.
 */
export async function verifyOtp(rawEmail: string, code: string): Promise<VerifiedOtpUser> {
  const email = normaliseEmail(rawEmail);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw ApiError.badRequest('That code is not valid for this account', 'OTP_INVALID');
  }

  const token = await prisma.otpToken.findFirst({
    where: { userId: user.id, purpose: OTP_PURPOSE },
    orderBy: { sentAt: 'desc' },
  });
  if (!token) {
    throw ApiError.badRequest('No reset code is pending. Request a new one.', 'OTP_NONE_PENDING');
  }

  if (token.usedAt) {
    throw ApiError.badRequest('That code has already been used. Request a new one.', 'OTP_USED');
  }

  if (token.expiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('That code has expired. Request a new one.', 'OTP_EXPIRED');
  }

  if (token.attempts >= env.otpMaxAttempts) {
    throw ApiError.badRequest('Too many incorrect attempts. Request a new code.', 'OTP_TOO_MANY_ATTEMPTS');
  }

  if (token.codeHash !== hashCode(code.trim())) {
    await prisma.otpToken.update({ where: { id: token.id }, data: { attempts: { increment: 1 } } });
    throw ApiError.badRequest('That code is not valid', 'OTP_INVALID');
  }

  // Single use: consume immediately.
  await prisma.otpToken.update({ where: { id: token.id }, data: { usedAt: new Date() } });

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    escrowWrappedMasterKey: user.escrowWrappedMasterKey,
    escrowMasterKeyIv: user.escrowMasterKeyIv,
  };
}
