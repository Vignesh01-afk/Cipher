import bcrypt from 'bcryptjs';
import { env } from '../env';

/**
 * Password handling for authentication.
 *
 * On the split scheme (authVersion 2) the server never sees the user's
 * password: the browser sends an `authKey` (the second half of a 512-bit
 * PBKDF2 derivation) and this module bcrypt-hashes that instead. On legacy
 * authVersion 1 accounts the raw password is still hashed here so those
 * accounts keep working until the client migrates them.
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
 * Fallback used only if generating the timing-equaliser hash ever fails. A
 * valid bcrypt string with a plausible cost keeps `compare` doing real work
 * rather than rejecting early.
 */
const FALLBACK_DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.5o7QWmQ5k1a0o8yFbFq0P5c1T3n2Kxu';

let dummyHashPromise: Promise<string> | null = null;

/**
 * A bcrypt hash generated with THIS deployment's configured cost factor.
 *
 * A hard-coded dummy hash only burns the right amount of CPU while
 * BCRYPT_ROUNDS happens to match its cost; if an operator raises the cost, the
 * equaliser would become measurably cheaper than a real comparison and leak
 * account existence through timing. Deriving it from `env.bcryptRounds` keeps
 * the two in step. It is computed once, lazily, so boot is unaffected.
 */
function dummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash('ciphernote-timing-equaliser', env.bcryptRounds).catch(() => {
      // Do not cache a rejected promise; fall back for this call.
      dummyHashPromise = null;
      return FALLBACK_DUMMY_HASH;
    });
  }
  return dummyHashPromise;
}

/**
 * Constant-time-ish guard used when the account does not exist or the
 * presented credential does not match the stored scheme, so that login
 * latency does not reveal whether an account is registered.
 */
export async function burnPasswordComparison(password: string): Promise<void> {
  try {
    await bcrypt.compare(password, await dummyHash());
  } catch {
    /* ignore */
  }
}
