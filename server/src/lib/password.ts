import bcrypt from 'bcryptjs';
import { env } from '../env';

/**
 * Password handling for authentication.
 *
 * The password travels to the server once, over TLS, because it is needed for
 * two independent purposes:
 *   1. bcrypt hash -> server-side authentication.
 *   2. in the browser only -> PBKDF2 key-encryption-key that unwraps the
 *      user's master key. The derived key is never sent here.
 *
 * bcrypt is used via `bcryptjs` (pure JavaScript) so that the project installs
 * cleanly on any machine without a native toolchain. The stored value always
 * contains the algorithm, cost and salt, so moving to argon2id later only
 * requires changing this module.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.bcryptRounds);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}

/**
 * Constant-time-ish guard used when the email does not exist, so that login
 * latency does not reveal whether an account is registered.
 */
export async function burnPasswordComparison(password: string): Promise<void> {
  const dummyHash = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.5o7QWmQ5k1a0o8yFbFq0P5c1T3n2Kxu';
  try {
    await bcrypt.compare(password, dummyHash);
  } catch {
    /* ignore */
  }
}
