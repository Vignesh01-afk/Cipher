import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Key, ShieldWarning, ShieldCheck, Warning, Copy, Checks } from '@phosphor-icons/react';
import { useToast } from '../context/ToastContext';
import { Button } from '../components/Button';
import { AuthShell } from './AuthShell';

/**
 * Shows the freshly generated recovery key exactly once.
 *
 * The key arrives via React router state (in-memory only) - it is never
 * persisted to sessionStorage/localStorage, so a reload or a Back navigation
 * cannot resurrect it from disk. On acknowledge the local copy is dropped.
 */
export function RecoveryKeyHandoffPage(): React.ReactElement {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [copied, setCopied] = useState(false);
  const state = location.state as { recoveryKey?: unknown } | null;
  const recoveryKey = typeof state?.recoveryKey === 'string' ? state.recoveryKey : null;

  const handleCopy = async () => {
    if (!recoveryKey) return;
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
      toast.success('Recovery key copied');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy');
    }
  };

  const handleAcknowledged = () => {
    // Drop the in-memory copy before navigating away.
    navigate('/dashboard', { replace: true });
  };

  if (!recoveryKey) {
    return (
      <div className="relative flex min-h-screen bg-surface">
        <div className="relative z-10 mx-auto w-full max-w-lg px-5 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
            <ShieldWarning className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Nothing to show here</h1>
          <p className="mt-2 text-sm leading-6 text-stone-500 dark:text-stone-400">
            There is no recovery key waiting to be shown. You can generate one from Settings → Recovery key.
          </p>
          <Button variant="primary" className="mt-6" onClick={() => navigate('/dashboard', { replace: true })}>
            <ShieldCheck className="h-4 w-4" />
            Back to dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <AuthShell width="lg">
      <div className="space-y-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-md     text-white ">
          <Key className="h-6 w-6" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Save your recovery key</h1>
        <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">
          This is the only way to reset a forgotten password. It is shown once, the server stores a wrapped copy of
          your keys under it, but never the key itself.
        </p>

        <div className="rounded-md border border-brand/20 bg-brand/5 p-4 dark:border-brand/30 dark:bg-brand/10">
          <div className="flex items-center justify-between gap-2">
            <p
              className="select-all break-all font-mono text-sm font-semibold tracking-wide text-brand-900 dark:text-brand-100"
              title={recoveryKey}
            >
              {recoveryKey}
            </p>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleCopy}
              disabled={copied}
            >
              {copied ? <Checks className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="rounded-md border border-amber-200/60 bg-amber-50/50 p-4 dark:border-amber-500/20 dark:bg-amber-500/5">
          <div className="flex items-start gap-2.5">
            <Warning className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-xs leading-5 text-amber-800 dark:text-amber-200">
              Store it in a password manager or on paper, somewhere safe. If you lose both your password and this key,
              your notes cannot be recovered by anyone. It can be used exactly once.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center sm:gap-3">
          <Button variant="secondary" onClick={handleCopy} disabled={copied}>
            <Copy className="h-4 w-4" />
            Copy key
          </Button>
          <Button variant="primary" onClick={handleAcknowledged}>
            <Checks className="h-4 w-4" />
            I saved it, continue
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
