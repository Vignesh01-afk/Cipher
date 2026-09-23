import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Spinner } from '../components/Spinner';
import { ErrorState } from '../components/States';
import { KeyUnlockError } from '../lib/crypto';

export function LoginPage(): JSX.Element {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      await login(email.trim(), password);
      toast.success('Signed in', 'Your encrypted key material was unlocked locally.');
      navigate('/dashboard', { replace: true });
    } catch (loginError) {
      if (loginError instanceof KeyUnlockError) {
        setError(
          'Your password was accepted but the stored key material could not be unwrapped. The account may have been created with a different password or the data is damaged.',
        );
      } else {
        setError(loginError instanceof Error ? loginError.message : 'Sign-in failed.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-600 text-white">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Welcome back to CipherNote
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Your password both authenticates you and unlocks the keys that decrypt your notes.
          </p>
        </div>

        <div className="card p-6">
          {error ? (
            <div className="mb-4">
              <ErrorState title="Could not sign you in" message={error} />
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
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
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                />
              </div>
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
                  autoComplete="current-password"
                  required
                  className="input pl-9"
                  placeholder="Your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={busy || !email || !password}>
              {busy ? <Spinner /> : <KeyRound className="h-4 w-4" />}
              {busy ? 'Verifying and unwrapping keys…' : 'Sign in and unlock vault'}
            </button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
            <Link to="/forgot-password" className="link">
              Forgot your password?
            </Link>
          </p>

          <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
            No account yet?{' '}
            <Link to="/register" className="link">
              Create one
            </Link>
          </p>
        </div>

        <p className="mt-4 text-center text-xs leading-5 text-slate-500 dark:text-slate-400">
          The server compares a bcrypt hash of your password. The password-derived key that actually decrypts your
          notes is computed in this browser with PBKDF2 and never leaves it.
        </p>
      </div>
    </div>
  );
}
