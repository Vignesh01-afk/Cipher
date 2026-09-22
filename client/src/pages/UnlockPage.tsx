import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Spinner } from '../components/Spinner';
import { ErrorState } from '../components/States';

/**
 * Shown when a session exists but the note keys are not in memory - which is
 * exactly what happens after a page reload. Keys are never cached in storage,
 * so the password has to be supplied again to re-derive the
 * key-encryption-key and unwrap them.
 */
export function UnlockPage(): JSX.Element {
  const { user, unlock, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !password) return;

    setBusy(true);
    setError(null);
    try {
      await unlock(password);
      toast.success('Vault unlocked', 'Your master key is in memory for this tab only.');
      navigate('/dashboard', { replace: true });
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : 'Unlock failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Lock className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Your vault is locked
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {user ? (
              <>
                Signed in as <span className="font-medium text-slate-700 dark:text-slate-200">{user.email}</span>.
                Re-enter your password to unlock your encryption keys.
              </>
            ) : (
              'Re-enter your password to unlock your encryption keys.'
            )}
          </p>
        </div>

        <div className="card p-6">
          {error ? (
            <div className="mb-4">
              <ErrorState title="Could not unlock" message={error} />
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
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
                  autoFocus
                  required
                  className="input pl-9"
                  placeholder="Your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            <button type="submit" className="btn btn-primary w-full" disabled={busy || !password}>
              {busy ? <Spinner /> : <KeyRound className="h-4 w-4" />}
              {busy ? 'Deriving keys with PBKDF2…' : 'Unlock vault'}
            </button>
          </form>

          <div className="divider" />

          <div className="flex flex-col gap-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
            <p className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
              Nothing was lost: your encrypted notes and wrapped keys are still on the server. They simply cannot be
              read without the key your password derives, which is why it is requested again.
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm self-start"
              onClick={() => void logout()}
              disabled={busy}
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out instead
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
