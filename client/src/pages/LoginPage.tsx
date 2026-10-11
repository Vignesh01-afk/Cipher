import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Envelope, Lock, Eye, EyeSlash, WarningCircle, User } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { AuthShell } from './AuthShell';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { GoogleIcon } from '../lib/passwordStrength';

export function LoginPage(): React.ReactElement {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleUrl, setGoogleUrl] = useState<string | null>(null);

  // Only show the Google button when the API hands back a real OAuth URL.
  useEffect(() => {
    let cancelled = false;
    void import('../lib/api')
      .then(({ api }) => api.getGoogleAuthUrl())
      .then(({ url }) => {
        if (!cancelled && typeof url === 'string' && /^https?:\/\//.test(url)) setGoogleUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password, { remember });
      toast.success('Signed in', 'Your encrypted key material was unlocked locally.');
      navigate('/dashboard', { replace: true });
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : 'Sign-in failed. Please check your email and password and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  function onGoogleSignIn(): void {
    // Never navigate to a missing URL: the button only exists when the API
    // confirmed Google is configured on this server.
    if (!googleUrl) return;
    window.location.href = googleUrl;
  }

  return (
    <AuthShell>
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-md     text-white ">
            <Lock className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Welcome back</h1>
          <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">
            Sign in to access your encrypted notes.
          </p>
        </div>

        {error ? (
          <div className="card-interactive flex items-start gap-3 rounded-md border border-rose-200/80 bg-rose-50/40 p-4 dark:border-rose-500/20 dark:bg-rose-500/5">
            <WarningCircle className="h-5 w-5 shrink-0 text-rose-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">Incorrect password</p>
              <p className="mt-0.5 text-sm leading-6 text-rose-700/90 dark:text-rose-200/80">{error}</p>
            </div>
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Input
            label="Email address"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            leftAddon={<User className="h-4 w-4" />}
          />
          <div className="mt-1">
            <label className="label" htmlFor="password">Password</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                className="input-auth pr-11"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400  hover:text-slate-600"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeSlash className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={busy}
                className="h-4 w-4 cursor-pointer rounded border-slate-300 text-brand-500 focus:ring-brand-500"
              />
              Remember me
            </label>
            <Link to="/forgot-password" className="link">
              Forgot password?
            </Link>
          </div>

          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            {busy ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>

        {googleUrl ? (
          <>
            <div className="my-5 flex items-center gap-3">
              <span className="h-px flex-1 bg-surface/10" />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400 dark:text-stone-500">or</span>
              <span className="h-px flex-1 bg-surface/10" />
            </div>

            <Button variant="secondary" className="w-full" onClick={() => onGoogleSignIn()} disabled={busy}>
              <GoogleIcon />
              {busy ? 'Redirecting…' : 'Sign in with Google'}
            </Button>
          </>
        ) : null}

        <p className="mt-5 text-center text-sm text-stone-500 dark:text-stone-400">
          Don&apos;t have an account?{' '}
          <Link to="/register" className="link font-semibold text-brand-600 dark:text-brand-300">
            Create account
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
