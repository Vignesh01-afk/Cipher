import 'dotenv/config';

function readString(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, received "${raw}"`);
  }
  return parsed;
}

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Storage backend selection.
 *
 * `auto` (the default) uses Supabase when credentials are present and private
 * local disk otherwise, so local development works with no configuration and
 * a production deployment only has to add the Supabase env vars.
 */
const rawStorageDriver = (process.env.STORAGE_DRIVER ?? 'auto').toLowerCase();
if (!['auto', 'local', 'supabase'].includes(rawStorageDriver)) {
  throw new Error(`STORAGE_DRIVER must be one of auto|local|supabase, received "${rawStorageDriver}"`);
}
export type StorageDriverSetting = 'auto' | 'local' | 'supabase';

// A placeholder secret is fine for local development but must never ship.
const jwtSecret = process.env.JWT_SECRET ?? 'ciphernote-development-only-secret-change-me';
if (isProduction && jwtSecret === 'ciphernote-development-only-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a strong random value when NODE_ENV=production');
}

// The escrow secret must be configured in production: without it the OTP
// reset flow cannot unwrap master keys. Failing fast beats a silent data-loss
// surprise after deployment.
if (isProduction && !process.env.ESCROW_MASTER_KEY) {
  throw new Error('ESCROW_MASTER_KEY must be set when NODE_ENV=production');
}

export const env = {
  isProduction,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: readNumber('PORT', 4000),
  clientOrigin: readString('CLIENT_ORIGIN', 'http://localhost:5173'),
  jwtSecret,
  // Short-lived sessions by default; clients re-authenticate silently via
  // /auth/me on reload. Revocation is enforced server-side (User.tokenVersion).
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '2h',
  bcryptRounds: readNumber('BCRYPT_ROUNDS', 12),
  authRateLimitWindowMs: readNumber('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  authRateLimitMax: readNumber('AUTH_RATE_LIMIT_MAX', 30),
  maxKdfIterations: 2_000_000,
  minKdfIterations: 100_000,

  // --- Request body limits --------------------------------------------------
  // The global ceiling is deliberately small. Notes and file uploads mount a
  // larger parser on their own path (see app.ts), because a body parser that
  // runs before the rate limiter is a cheap memory-exhaustion vector.
  jsonBodyLimit: process.env.JSON_BODY_LIMIT ?? '100kb',
  notesBodyLimit: process.env.NOTES_BODY_LIMIT ?? '3mb',

  // --- Shared rate-limit store (optional) ------------------------------------
  // Upstash Redis REST credentials. When set, every API instance shares the
  // counters so limits hold across serverless invocations; otherwise the
  // in-memory store is used (correct for a single instance / local dev).
  upstashRedisRestUrl: process.env.UPSTASH_REDIS_REST_URL ?? '',
  upstashRedisRestToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',

  // --- Secure file storage -------------------------------------------------
  storageDriver: rawStorageDriver as StorageDriverSetting,
  // Private server-side directory for encrypted file blobs. Never exposed
  // directly: every read goes through an authenticated API route.
  fileStorageDir: process.env.FILE_STORAGE_DIR ?? 'storage/files',
  // Supabase Storage (used when STORAGE_DRIVER=supabase, or =auto with creds).
  // The service-role key must NEVER reach the browser.
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? 'ciphernote-files',
  // How long a signed (presigned) download URL stays valid. Short by design:
  // the browser fetches it immediately and the blob is ciphertext anyway.
  signedUrlTtlSeconds: readNumber('SIGNED_URL_TTL_SECONDS', 60),
  // Uploads above this size use the two-step direct-upload flow so the body
  // never has to pass through the API function (Vercel caps request bodies).
  directUploadThresholdBytes: readNumber('DIRECT_UPLOAD_THRESHOLD_BYTES', 4 * 1024 * 1024),
  // Per-account storage ceiling for encrypted blobs.
  maxUserStorageBytes: readNumber('MAX_USER_STORAGE_BYTES', 500 * 1024 * 1024),
  // Maximum size of the *encrypted* blob accepted per upload.
  maxFileBytes: readNumber('MAX_FILE_BYTES', 25 * 1024 * 1024),
  // Base64 inflates ciphertext by ~4/3; this is the request ceiling for uploads.
  maxFileUploadBodyBytes: readNumber('MAX_FILE_UPLOAD_BODY_BYTES', 36 * 1024 * 1024),

  // --- Outbound email (Gmail OTP delivery) ---------------------------------
  // Gmail SMTP with an App Password. See docs/GOOGLE_AND_OTP_SETUP.md.
  smtpHost: process.env.SMTP_HOST ?? 'smtp.gmail.com',
  smtpPort: readNumber('SMTP_PORT', 465),
  smtpSecure: (process.env.SMTP_SECURE ?? 'true') === 'true',
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  mailFrom: process.env.MAIL_FROM ?? 'CipherNote <no-reply@ciphernote.local>',
  // When no SMTP credentials are configured the code is logged instead of
  // sent, so local development keeps working end to end.
  otpDebugLog: (process.env.OTP_DEBUG_LOG ?? 'true') === 'true',

  // --- Email OTP (password reset) -------------------------------------------
  otpLength: readNumber('OTP_LENGTH', 8),
  otpTtlMinutes: readNumber('OTP_TTL_MINUTES', 10),
  otpMaxAttempts: readNumber('OTP_MAX_ATTEMPTS', 5),
  otpResendCooldownSeconds: readNumber('OTP_RESEND_COOLDOWN_SECONDS', 60),
  otpMaxPerHour: readNumber('OTP_MAX_PER_HOUR', 4),
  otpSendMaxPerHour: readNumber('OTP_SEND_MAX_PER_HOUR', 4),

  // --- Master-key escrow (enables OTP-only password reset) ------------------
  // 32-byte key, base64 or hex. Rotating it invalidates every escrowed
  // recovery copy, so treat it like root credentials.
  escrowMasterKey: process.env.ESCROW_MASTER_KEY ?? '',

  // --- Google OAuth (sign in with Google) -----------------------------------
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  // Defaults keep localhost working without configuration.
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:5173/auth/google/callback',
  googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
};
