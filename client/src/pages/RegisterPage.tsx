import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, KeyRound, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Spinner } from '../components/Spinner';
import { ErrorState } from '../components/States';

interface StrengthResult {
  score: number;
  label: string;
  tone: 'rose' | 'amber' | 'emerald';
  suggestions: string[];
}

function assessPassword(password: string): StrengthResult {
  const suggestions: string[] = [];
  let score = 0;

  if (password.length >= 8) score += 1;
  else suggestions.push('Use at least 8 characters');
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  else suggestions.push('Mix upper and lower case');
  if (/\d/.test(password)) score += 1;
  else suggestions.push('Add a number');
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  else suggestions.push('Add a symbol');

  if (score <= 2) return { score, label: 'Weak', tone: 'rose', suggestions };
  if (score === 3) return { score, label: 'Fair', tone: 'amber', suggestions };
  if (score === 4) return { score, label: 'Strong', tone: 'emerald', suggestions };
  return { score, label: 'Very strong', tone: 'emerald', suggestions };
}

const TONE_BAR: Record<StrengthResult['tone'], string> = {
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  emerald: 'bg-emerald-500',
};

export function RegisterPage(): JSX.Element {
  const { register, isWebCryptoSupported } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  const strength = useMemo(() => assessPassword(password), [password]);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit =
    !busy && displayName.trim().length > 0 && email.trim().length > 0 && password.length >= 8 && passwordsMatch;

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setBusy(true);
    setError(null);

    try {
      // register() returns the one-time recovery key (or null when its setup
      // failed - the account still works, the key can be made from Settings).
      const recovery = await register({
        email: email.trim(),
        displayName: displayName.trim(),
        password,
      });

      if (recovery) {
        // Stash the key and move to a handoff ROUTE rather than rendering in
        // place: RedirectIfAuthenticated bounces /register to /dashboard the
        // moment status flips to 'unlocked', which would swallow the screen.
        sessionStorage.setItem('ciphernote.recovery.pending', recovery);
        navigate('/recovery-key', { replace: true });
        return;
      }

      toast.warning(
        'Account created without a recovery key',
        'Generate one from Settings → Recovery key - without it a forgotten password cannot be reset.',
      );
      navigate('/dashboard', { replace: true });
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-600 text-white">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Create your encrypted vault
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Your keys are generated in this browser. The server receives the public key and encrypted copies of your
            private keys - never anything it can read.
          </p>
        </div>

        {!isWebCryptoSupported ? (
          <div className="mb-4">
            <ErrorState
              title="Web Crypto is unavailable"
              message="CipherNote needs window.crypto.subtle, which requires a secure context (https:// or localhost). Use a modern browser over https or localhost."
            />
          </div>
        ) : null}

        <div className="card p-6">
          {error ? (
            <div className="mb-4">
              <ErrorState title="Could not create your account" message={error} />
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="displayName" className="label">
                Display name
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="displayName"
                  type="text"
                  autoComplete="name"
                  required
                  maxLength={80}
                  className="input pl-9"
                  placeholder="Alice"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="label">
                Email address
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="input pl-9"
                  placeholder="alice@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                Other users look you up by this address when they want to share a note with you.
              </p>
            </div>

            <div>
              <label htmlFor="password" className="label">
                Password
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="input pl-9"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
              </div>

              {password ? (
                <div className="mt-2">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full transition-all ${TONE_BAR[strength.tone]}`}
                        style={{ width: `${(strength.score / 5) * 100}%` }}
                      />
                    </div>
                    <span className="w-20 text-right text-xs font-medium text-slate-500 dark:text-slate-400">
                      {strength.label}
                    </span>
                  </div>
                  {strength.suggestions.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {strength.suggestions.slice(0, 2).map((suggestion) => (
                        <li key={suggestion} className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                          <AlertTriangle className="h-3 w-3" />
                          {suggestion}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                      <Check className="h-3 w-3" />
                      Good - this password will derive your key-encryption-key with PBKDF2.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="label">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                className="input"
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={busy}
              />
              {confirmPassword && !passwordsMatch ? (
                <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">Passwords do not match.</p>
              ) : null}
            </div>

            <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
              <p className="flex items-start gap-2 text-xs leading-5 text-amber-900 dark:text-amber-100/90">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                A recovery key is generated right after registration - it is the only way to reset a forgotten
                password. Without it, nobody - including this server - can recover your vault if you forget your
                password.
              </p>
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={!canSubmit}>
              {busy ? <Spinner /> : <KeyRound className="h-4 w-4" />}
              {busy ? 'Generating keys and registering…' : 'Generate keys and create vault'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
            Already registered?{' '}
            <Link to="/login" className="link">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
