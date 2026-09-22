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

// A placeholder secret is fine for local development but must never ship.
const jwtSecret = process.env.JWT_SECRET ?? 'ciphernote-development-only-secret-change-me';
if (isProduction && jwtSecret === 'ciphernote-development-only-secret-change-me') {
  throw new Error('JWT_SECRET must be set to a strong random value when NODE_ENV=production');
}

export const env = {
  isProduction,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: readNumber('PORT', 4000),
  clientOrigin: readString('CLIENT_ORIGIN', 'http://localhost:5173'),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  bcryptRounds: readNumber('BCRYPT_ROUNDS', 12),
  authRateLimitWindowMs: readNumber('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  authRateLimitMax: readNumber('AUTH_RATE_LIMIT_MAX', 30),
  // Comfortably above the 2,000,000-character ciphertext cap in schemas.ts.
  jsonBodyLimit: '4mb',
  maxKdfIterations: 2_000_000,
  minKdfIterations: 100_000,

  // --- Secure file storage -------------------------------------------------
  // Private server-side directory for encrypted file blobs. Never exposed
  // directly: every read goes through an authenticated API route.
  fileStorageDir: process.env.FILE_STORAGE_DIR ?? 'storage/files',
  // Maximum size of the *encrypted* blob accepted per upload.
  maxFileBytes: readNumber('MAX_FILE_BYTES', 25 * 1024 * 1024),
  // Base64 inflates ciphertext by ~4/3; this is the request ceiling for uploads.
  maxFileUploadBodyBytes: readNumber('MAX_FILE_UPLOAD_BODY_BYTES', 36 * 1024 * 1024),
};
