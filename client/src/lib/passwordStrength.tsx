import { normalizePassword } from './crypto';

/**
 * Minimum vault-password length.
 *
 * The password is the only input to the PBKDF2 key-encryption-key, so its
 * length is the single biggest factor in resisting offline guessing (the
 * server stores a bcrypt of the derived authKey, and an attacker with the
 * database also gets the public KDF salt). 10 is the floor, not the goal -
 * the strength meter still nudges toward longer.
 */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * A deliberately small denylist of passwords that top every breach corpus.
 *
 * This cannot be a complete check (that needs a full breach corpus, e.g. the
 * HaveIBeenPwned range API), but it stops the handful of favourites that a
 * naive attacker tries first. Matched case-insensitively against the
 * normalised password.
 */
const COMMON_PASSWORDS = new Set([
  '1234567890',
  '12345678901',
  '123456789012',
  'qwertyuiop',
  'qwerty12345',
  'password1',
  'password12',
  'password123',
  'password1234',
  'passw0rd123',
  'p@ssw0rd123',
  'letmein123',
  'welcome123',
  'welcome1234',
  'iloveyou123',
  'admin12345',
  'administrator',
  'changeme123',
  'trustno1',
  'sunshine1',
  'princess1',
  'football1',
  'baseball1',
  'superman1',
  'monkey123',
  'dragon123',
  'shadow123',
  'master123',
  'ciphernote',
  'ciphernote1',
  'encryption',
  'correcthorsebatterystaple',
]);

export interface StrengthResult {
  score: number;
  label: string;
  tone: 'rose' | 'amber' | 'emerald';
  suggestions: string[];
}

/** Shared by the register and Google sign-up completion forms. */
export function assessPassword(rawPassword: string): StrengthResult {
  const password = normalizePassword(rawPassword);
  const suggestions: string[] = [];
  let score = 0;

  if (password.length >= MIN_PASSWORD_LENGTH) score += 1;
  else suggestions.push(`Use at least ${MIN_PASSWORD_LENGTH} characters`);
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  else suggestions.push('Mix upper and lower case');
  if (/\d/.test(password)) score += 1;
  else suggestions.push('Add a number');
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  else suggestions.push('Add a symbol');

  const knownBreach = COMMON_PASSWORDS.has(password.toLowerCase());
  if (knownBreach) {
    suggestions.unshift('This password appears in known breach lists - pick something unique');
  }

  // A denylisted password is always Weak, no matter how it scores on shape.
  if (knownBreach || score <= 2) return { score, label: 'Weak', tone: 'rose', suggestions };
  if (score === 3) return { score, label: 'Fair', tone: 'amber', suggestions };
  if (score === 4) return { score, label: 'Strong', tone: 'emerald', suggestions };
  return { score, label: 'Very strong', tone: 'emerald', suggestions };
}

/**
 * Single source of truth for "is this password acceptable?".
 *
 * Returns a user-facing message, or `null` when the password passes. Used by
 * register, Google sign-up and the recovery reset so every entry point enforces
 * the same policy; the strength meter is advisory, this is the gate.
 */
export function passwordPolicyError(rawPassword: string): string | null {
  const password = normalizePassword(rawPassword);

  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return 'That password appears in known breach lists. Choose a different one.';
  }
  if (assessPassword(password).score <= 2) {
    return 'That password is too weak. Add length, mixed case, a number or a symbol.';
  }
  return null;
}

export const TONE_BAR: Record<StrengthResult['tone'], string> = {
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
};

/** The Google "G" logo, shared by the login and register pages. */
export function GoogleIcon(): JSX.Element {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}
