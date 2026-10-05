import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { KeyRound, ShieldAlert, ShieldCheck, AlertTriangle, Copy, CheckCheck } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { Button } from '../components/Button';
import { AuthShell } from './AuthShell';

export function RecoveryKeyHandoffPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRecoveryKey(sessionStorage.getItem('ciphernote.recovery.pending'));
  }, []);

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

  if (!recoveryKey) {
    return (
      <div className="relative flex min-h-screen overflow-hidden bg-stone-50 dark:bg-[#0B0F19]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-brand/10 blur-3xl dark:bg-brand/15" />
          <div className="absolute -right-32 top-10 h-[26rem] w-[26rem] rounded-full bg-violet-400/10 blur-3xl dark:bg-violet-400/10" />
          <div className="absolute -bottom-32 left-1/3 h-[32rem] w-[32rem] rounded-full bg-pink-400/8 blur-3xl dark:bg-pink-400/8" />
        </div>
        <div className="relative z-10 mx-auto w-full max-w-lg px-5 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
            <ShieldAlert className="h-7 w-7" />
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
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-violet-500 to-pink-500 text-white shadow-[0_12px_30px_-10px_rgba(122,88,247,0.9)]">
          <KeyRound className="h-6 w-6" />
        </span>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Save your recovery key</h1>
        <p className="text-sm leading-6 text-stone-500 dark:text-stone-400">
          This is the only way to reset a forgotten password. It is shown once — the server stores a wrapped copy of
          your keys under it, but never the key itself.
        </p>

        <div className="rounded-2xl border border-brand/20 bg-brand/5 p-4 dark:border-brand/30 dark:bg-brand/10">
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
              {copied ? <CheckCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200/60 bg-amber-50/50 p-4 dark:border-amber-500/20 dark:bg-amber-500/5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
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
          <Button variant="primary" onClick={() => { sessionStorage.removeItem('ciphernote.recovery.pending'); navigate('/dashboard', { replace: true }); }}>
            <CheckCheck className="h-4 w-4" />
            I saved it — continue
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
