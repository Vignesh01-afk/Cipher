import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { AuthShell } from './AuthShell';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { GoogleIcon, assessPassword, TONE_BAR } from '../lib/passwordStrength';

export function RegisterPage(): JSX.Element {
  const { register, isWebCryptoSupported } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const strength = useMemo(() => assessPassword(password), [password]);
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const canSubmit =
    !busy &&
    displayName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    passwordsMatch &&
    agreed;

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const recovery = await register({ email: email.trim(), displayName: displayName.trim(), password });
      if (recovery) {
        // Router state only (in-memory): the raw recovery key is never written
        // to sessionStorage/localStorage, and the entry is replaced so Back
        // cannot re-surface it.
        navigate('/recovery-key', { replace: true, state: { recoveryKey: recovery } });
        return;
      }
      toast.warning('Account created without a recovery key', 'Generate one from Settings → Recovery key.');
      navigate('/dashboard', { replace: true });
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : 'Registration failed.');
    } finally {
      setBusy(false);
    }
  }

  async function onGoogleSignUp(): Promise<void> {
    setError(null);
    try {
      const { api } = await import('../lib/api');
      const { url } = await api.getGoogleAuthUrl();
      window.location.href = url;
    } catch (googleError) {
      setError(
        googleError instanceof Error
          ? googleError.message
          : 'Could not start Google sign-up. It may not be configured on this server.',
      );
    }
  }

  return (
    <AuthShell width="lg">
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-violet-500 to-pink-500 text-white shadow-[0_12px_30px_-10px_rgba(122,88,247,0.9)]">
            <Lock className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Create your account</h1>
          <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">
            Join CipherNote and start securing your notes.
          </p>
        </div>

        {!isWebCryptoSupported ? (
          <div className="card-interactive flex items-start gap-3 rounded-2xl border border-rose-200/80 bg-rose-50/40 p-4 dark:border-rose-500/20 dark:bg-rose-500/5">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">Web Crypto required</p>
              <p className="mt-0.5 text-sm leading-6 text-rose-700/90 dark:text-rose-200/80">
                CipherNote needs <code>window.crypto.subtle</code>, which requires a secure context (https:// or
                localhost).
              </p>
            </div>
          </div>
        ) : null}
        {error ? (
          <div className="card-interactive flex items-start gap-3 rounded-2xl border border-rose-200/80 bg-rose-50/40 p-4 dark:border-rose-500/20 dark:bg-rose-500/5">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">Registration failed</p>
              <p className="mt-0.5 text-sm leading-6 text-rose-700/90 dark:text-rose-200/80">{error}</p>
            </div>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Input
            label="Full name"
            type="text"
            autoComplete="name"
            maxLength={80}
            placeholder="John Doe"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={busy}
            leftAddon={<User className="h-4 w-4" />}
          />
          <Input
            label="Email address"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            leftAddon={<Mail className="h-4 w-4" />}
          />
          <div className="mt-1">
            <label className="label" htmlFor="password">Password</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={8}
                className="input-auth pr-11"
                placeholder="Create a strong password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {password ? (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/50 dark:bg-white/[0.06]">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${TONE_BAR[strength.tone]}`}
                      style={{ width: `${(strength.score / 5) * 100}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-xs font-semibold text-stone-500 dark:text-stone-400">{strength.label}</span>
                </div>
                {strength.suggestions.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {strength.suggestions.slice(0, 2).map((suggestion) => (
                      <li key={suggestion} className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                        <AlertTriangle className="h-3 w-3" />
                        {suggestion}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" />
                    Good — this password derives your key-encryption-key with PBKDF2.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          <div className="mt-1">
            <label className="label" htmlFor="confirmPassword">Confirm password</label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              className="input"
              placeholder="Repeat your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={busy}
            />
            {confirmPassword && !passwordsMatch ? <p className="field-error">Passwords do not match.</p> : null}
          </div>

          <label className="flex cursor-pointer select-none items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={busy}
              className="mt-0.5 h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-500 focus:ring-brand-500"
            />
            <span className="flex-1 text-left">
              I agree to the <Link to="/terms" className="link font-semibold">Terms of Service</Link> and{' '}
              <Link to="/privacy" className="link font-semibold">Privacy Policy</Link>
            </span>
          </label>

          <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 p-3 dark:border-amber-500/20 dark:bg-amber-500/5">
            <p className="text-xs leading-5 text-amber-800 dark:text-amber-200">
              A recovery key is generated right after registration. It is the only way to reset a forgotten password.
            </p>
          </div>

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {busy ? 'Generating keys and registering…' : 'Create Account'}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400 dark:text-stone-500">or</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        <Button variant="secondary" className="w-full" onClick={() => onGoogleSignUp()} disabled={busy}>
          <GoogleIcon />
          {busy ? 'Redirecting…' : 'Sign up with Google'}
        </Button>

        <p className="mt-5 text-center text-sm text-stone-500 dark:text-stone-400">
          Already have an account?{' '}
          <Link to="/login" className="link font-semibold text-brand-600 dark:text-brand-300">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
