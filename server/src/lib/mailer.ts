import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env';

/**
 * Outbound email for the OTP password-reset flow, delivered through Gmail's
 * SMTP relay with an App Password (see docs/GOOGLE_AND_OTP_SETUP.md).
 *
 * The transporter is created lazily and cached: serverless invocations reuse
 * it on warm starts, and local dev without credentials never constructs one.
 * When SMTP is unconfigured, sendMail degrades to a console log so the whole
 * flow stays testable locally without a Gmail account.
 */

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.smtpUser || !env.smtpPass) return null;
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: { user: env.smtpUser, pass: env.smtpPass },
  });
  return cachedTransporter;
}

export async function sendMail(options: { to: string; subject: string; text: string; html?: string }): Promise<void> {
  const transporter = getTransporter();

  if (!transporter) {
    if (env.otpDebugLog) {
      console.log(`[mailer] SMTP not configured - would send to ${options.to}: ${options.subject}\n${options.text}`);
    }
    return;
  }

  await transporter.sendMail({
    from: env.mailFrom,
    to: options.to,
    subject: options.subject,
    text: options.text,
    html: options.html,
  });
}

const BRAND = 'CipherNote';

/** Plain-text body for a password-reset OTP email. */
export function otpEmailText(code: string, ttlMinutes: number): string {
  return [
    `Your ${BRAND} password reset code is: ${code}`,
    '',
    `This code expires in ${ttlMinutes} minutes and can be used once.`,
    'If you did not request this, you can safely ignore this email - your vault is untouched.',
    '',
    `-${BRAND}`,
  ].join('\n');
}

/** HTML body for the same email; mirrors the plain text version. */
export function otpEmailHtml(code: string, ttlMinutes: number): string {
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px">',
    `<h2 style="margin:0 0 12px;color:#0e7490">${BRAND} password reset</h2>`,
    '<p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.6">',
    'Use this one-time code to reset your password:',
    '</p>',
    `<p style="margin:0 0 16px"><span style="display:inline-block;font-size:28px;letter-spacing:8px;font-weight:700;color:#0f172a">${code}</span></p>`,
    `<p style="margin:0 0 8px;color:#64748b;font-size:13px">This code expires in ${ttlMinutes} minutes and works only once.</p>`,
    `<p style="margin:0;color:#64748b;font-size:13px">If you did not request it, ignore this email - your vault is untouched.</p>`,
    '</div>',
  ].join('\n');
}
