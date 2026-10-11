import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Warning, Check, Key, Lock, ShieldCheck, User } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Spinner } from '../components/Spinner';
import { ErrorState } from '../components/States';
import { AuthShell } from './AuthShell';
import {
  MIN_PASSWORD_LENGTH,
  TONE_BAR,
  assessPassword,
  passwordPolicyError,
} from '../lib/passwordStrength';

/** Completes sign-up after Google verified the identity. The signup token and
 * verified email are stashed in sessionStorage by the callback page; keys are
 * generated locally under the chosen vault password, exactly like the classic
 * register flow - Google never sees any key and neither does the server. */
export function GoogleSignupPage(): React.ReactElement {
  const { registerWithGoogle } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const signupToken = sessionStorage.getItem('ciphernote.google.signupToken');
  const googleEmail = sessionStorage.getItem('ciphernote.google.email');
  const suggestedName = sessionStorage.getItem('ciphernote.google.displayName') ?? '';

  const [displayName, setDisplayName] = useState(suggestedName);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  const strength = useMemo(() => assessPassword(password), [password]);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const passwordError = password ? passwordPolicyError(password) : null;
  const canSubmit =
    !busy && displayName.trim().length > 0 && passwordPolicyError(password) === null && passwordsMatch;

  // Landed here directly (reload, stale link, back button): send the user
  // back through the flow instead of showing a broken form.
  if (!signupToken || !googleEmail) {
    return (
      <AuthShell>
        <div className="text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-50">Sign-up session expired</h1>
          <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">Start again with Google to create your account.</p>
          <Link to="/register" className="btn btn-primary mt-5 w-full">
            Back to sign up
          </Link>
        </div>
      </AuthShell>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit || !signupToken) return;

    setBusy(true);
    setError(null);

    try {
      const recovery = await registerWithGoogle({
        signupToken,
        email: googleEmail ?? '',
        displayName: displayName.trim(),
        password,
      });

      // Clean up before navigating so a reload cannot re-submit the token.
      sessionStorage.removeItem('ciphernote.google.signupToken');
      sessionStorage.removeItem('ciphernote.google.email');
      sessionStorage.removeItem('ciphernote.google.displayName');

      if (recovery) {
        // Router state only (in-memory): the raw recovery key is never written
        // to sessionStorage/localStorage, and the entry is replaced so Back
        // cannot re-surface it.
        navigate('/recovery-key', { replace: true, state: { recoveryKey: recovery } });
        return;
      }

      toast.warning(
        'Account created without a recovery key',
        'Generate one from Settings → Recovery key - without it a forgotten password cannot be reset.',
      );
      navigate('/dashboard', { replace: true });
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : 'Could not create your account.');
      setBusy(false);
    }
  }

  return (
    <AuthShell width="lg">
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-md bg-accent text-paper ">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Finish creating your vault</h1>
          <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">
            Google verified <span className="font-medium text-stone-700 dark:text-stone-200">{googleEmail}</span>
          </p>
        </div>

        {error ? (
          <div className="card-interactive flex items-start gap-3 rounded-md border border-rose-200/80 bg-rose-50/40 p-4 dark:border-rose-500/20 dark:bg-rose-500/5">
            <Warning className="h-5 w-5 shrink-0 text-rose-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">Could not create your account</p>
              <p className="mt-0.5 text-sm leading-6 text-rose-700/90 dark:text-rose-200/80">{error}</p>
            </div>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="displayName" className="label">
              Display name
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                id="displayName"
                type="text"
                autoComplete="name"
                required
                maxLength={80}
                className="input-auth"
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
            <input
              id="email"
              type="email"
              className="input opacity-70"
              value={googleEmail}
              disabled
              aria-describedby="email-locked"
            />
            <p id="email-locked" className="mt-1.5 text-xs text-stone-400 dark:text-stone-500">
              Verified by Google and used to sign you in - it cannot be changed here.
            </p>
          </div>

          <div>
            <label htmlFor="password" className="label">
              Vault password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                id="password"
                type="password"
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                required
                className="input-auth"
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </div>

            {password ? (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-md bg-stone-200 dark:bg-stone-800">
                    <div
                      className={`h-full rounded-md  ${TONE_BAR[strength.tone]}`}
                      style={{ width: `${(strength.score / 5) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-xs font-medium text-stone-500 dark:text-stone-400">
                    {strength.label}
                  </span>
                </div>
                {strength.suggestions.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {strength.suggestions.slice(0, 2).map((suggestion) => (
                      <li
                        key={suggestion}
                        className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400"
                      >
                        <Warning className="h-3 w-3" />
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
                {passwordError ? <p className="field-error">{passwordError}</p> : null}
              </div>
            ) : null}
          </div>

          <div>
            <label htmlFor="confirmPassword" className="label">
              Confirm vault password
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

          <div className="rounded-md border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
            <p className="flex items-start gap-2 text-xs leading-5 text-amber-900 dark:text-amber-100/90">
              <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              This password unlocks your keys on this device - Google does not know it. A recovery key is generated
              right after sign-up; it is the only way to reset a forgotten password.
            </p>
          </div>

          <button type="submit" className="btn btn-primary w-full" disabled={!canSubmit}>
            {busy ? <Spinner /> : <Key className="h-4 w-4" />}
            {busy ? 'Generating keys and creating vault…' : 'Generate keys and create vault'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-stone-500 dark:text-stone-400">
          Already have an account?{' '}
          <Link to="/login" className="link">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
