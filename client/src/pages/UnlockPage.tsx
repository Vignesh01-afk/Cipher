import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { WarningCircle, Lock, Key, SignOut, ShieldCheck } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { AuthShell } from './AuthShell';
import BrandMark from '../components/BrandMark';
import { Button } from '../components/Button';

export function UnlockPage(): React.ReactElement {
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
    <AuthShell>
      <div className="flex flex-col items-center text-center py-6">
        <BrandMark size="lg" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Your vault is locked</h1>
        <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
          {user ? (
            <>
              Signed in as <span className="font-semibold text-ink dark:text-paper">{user.email}</span>.
              Re-enter your password to unlock your encryption keys.
            </>
          ) : (
            'Re-enter your password to unlock your encryption keys.'
          )}
        </p>
      </div>

      {error ? (
        <div className="card-interactive flex items-start gap-3 rounded-md border border-rose-200/80 bg-rose-50/40 p-4 dark:border-rose-500/20 dark:bg-rose-500/5">
          <WarningCircle className="h-5 w-5 shrink-0 text-rose-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">Unlock failed</p>
            <p className="mt-0.5 text-sm leading-6 text-rose-700/90 dark:text-rose-200/80">{error}</p>
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <div className="mt-1">
          <label className="label" htmlFor="password">Password</label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              className="input-auth"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={busy || !password}>
          {busy ? 'Deriving keys with PBKDF2…' : 'Unlock vault'}
        </Button>
      </form>

      <div className="divider" />

      <div className="flex flex-col gap-3 text-sm leading-6 text-stone-500 dark:text-stone-400">
        <p className="flex items-start gap-2.5 text-stone-600 dark:text-stone-300">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          Nothing was lost: your encrypted notes and wrapped keys are still on the server. They simply cannot be read
          without the key your password derives, which is why it is requested again.
        </p>
        <button
          type="button"
          className="btn btn-secondary w-full"
          onClick={() => void logout()}
          disabled={busy}
        >
          <SignOut className="h-3.5 w-3.5" />
          Sign out instead
        </button>
      </div>
    </AuthShell>
  );
}
