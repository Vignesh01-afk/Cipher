import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, KeyRound } from 'lucide-react';
import { useToast } from '../context/ToastContext';

/**
 * One-time handoff screen shown immediately after registration.
 *
 * It lives on its own route (not inside RegisterPage's render) because the
 * auth guard redirects /register to /dashboard as soon as the session flips
 * to "unlocked" - which would swallow the key before the user sees it.
 *
 * The key is read once from sessionStorage and the entry is destroyed on
 * acknowledgement, so it is never reachable again afterwards.
 */
export function RecoveryKeyHandoffPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

  useEffect(() => {
    setRecoveryKey(sessionStorage.getItem('ciphernote.recovery.pending'));
  }, []);

  if (!recoveryKey) {
    // Direct visit without a pending key: nothing to show.
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 dark:bg-slate-950">
        <div className="card max-w-md p-6 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            There is no recovery key waiting to be shown. You can generate one from Settings → Recovery key.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-lg">
        <div className="card p-6">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-600 text-white">
              <KeyRound className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              Save your recovery key
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              This is the only way to reset a forgotten password. It is shown <strong>once</strong> - the server stores
              a wrapped copy of your keys under it, but never the key itself.
            </p>
          </div>

          <div className="mt-5 rounded-lg border border-cyan-200 bg-cyan-50/70 p-4 dark:border-cyan-500/30 dark:bg-cyan-500/5">
            <p className="select-all break-all font-mono text-sm font-semibold text-cyan-900 dark:text-cyan-100">
              {recoveryKey}
            </p>
          </div>

          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
            <p className="flex items-start gap-2 text-xs leading-5 text-amber-900 dark:text-amber-100/90">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Store it in a password manager or on paper, somewhere safe. If you lose BOTH your password and this key,
              your notes cannot be recovered by anyone. It can be used exactly once.
            </p>
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className="btn btn-secondary flex-1"
              onClick={() => {
                void navigator.clipboard.writeText(recoveryKey);
                toast.success('Copied', 'Paste it somewhere safe right now.');
              }}
            >
              Copy key
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              onClick={() => {
                sessionStorage.removeItem('ciphernote.recovery.pending');
                navigate('/dashboard', { replace: true });
              }}
            >
              I saved it - continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
