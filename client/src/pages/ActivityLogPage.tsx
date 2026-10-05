import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, FileText, Users, Shield, Lock, FilePlus2, FileX2, KeyRound, ShieldOff, Clock, AlertTriangle, CheckCircle2, LogOut, LogIn, Mail, UserPlus, ArrowRight, RefreshCw, Trash2, Ban } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorState, InfoState } from '../components/States';
import { formatRelativeTime } from '../lib/format';
import { getAuditActionMeta, AUDIT_ACTION_CODES } from '../lib/auditActions';

const ICON_MAP: Record<string, typeof Activity> = {
  NOTE_CREATE: FilePlus2,
  NOTE_UPDATE: FileText,
  NOTE_DELETE: FileX2,
  USER_BLOCKED: Ban,
  CHAT_CLEARED: RefreshCw,
  CHAT_DELETED: Trash2,
  CHAT_NOTE_SHARED: KeyRound,
  CHAT_MESSAGE_SENT: Activity,
  CHAT_STARTED: Activity,
  OTP_REQUEST: Mail,
  REGISTER: UserPlus,
  LOGIN: LogIn,
  LOGOUT: LogOut,
  RECOVERY_RESET: KeyRound,
  RECOVERY_SETUP: KeyRound,
  SHARE_REVOKE: ShieldOff,
  PASSWORD_RESET_OTP: Mail,
  GOOGLE_REGISTER: UserPlus,
  GOOGLE_LOGIN: LogIn,
  GOOGLE_LINKED: Activity,
  ACCESS_DENIED: ShieldOff,
  OTP_VERIFY_FAILED: AlertTriangle,
  OTP_REQUEST_FAILED: AlertTriangle,
  RECOVERY_CHALLENGE_FAILED: AlertTriangle,
  RECOVERY_RESET_FAILED: AlertTriangle,
  LOGIN_FAILED: AlertTriangle,
  GOOGLE_LOGIN_FAILED: AlertTriangle,
};

const TONE_CLASS: Record<string, string> = {
  danger: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
  positive: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
};

export function ActivityLogPage(): JSX.Element {
  const { user } = useAuth();
  const toast = useToast();

  const [logs, setLogs] = useState<{ action: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listAuditLogs({ limit: 80 }).then((result) => {
      if (!cancelled) setLogs(result);
    }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load activity.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Activity log</h1>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              Real events recorded by your CipherNote account.
            </p>
          </div>
          <Link to="/dashboard" className="btn btn-secondary">
            <Clock className="h-4 w-4" />
            Back to dashboard
          </Link>
        </div>
      </section>

      {error ? (
        <ErrorState
          title="Could not load activity"
          message={error}
          onRetry={() => {
            setLoading(true);
            setError(null);
            api.listAuditLogs({ limit: 80 }).then((result) => setLogs(result)).catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load activity.')).finally(() => setLoading(false));
          }}
        />
      ) : loading ? (
        <div className="card">
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity recorded yet"
          description="Your CipherNote account is brand new. Every note, share, login and revocation is recorded here."
          action={
            <Link to="/notes/new" className="btn btn-primary">
              <FilePlus2 className="h-4 w-4" />
              Create a note
            </Link>
          }
        />
      ) : (
        <div className="card p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {logs.map((log) => {
              const meta = getAuditActionMeta(log.action);
              const Icon = meta.icon ?? Activity;
              return (
                <article
                  key={log.createdAt}
                  className="flex flex-col gap-3 rounded-2xl border border-white/70 bg-white/70 p-4 transition hover:bg-white/85 dark:border-white/[0.08] dark:bg-white/[0.04]"
                >
                  <div className="flex items-start gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${TONE_CLASS[meta.tone]}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">{meta.label}</p>
                      <p className="text-xs text-stone-500 dark:text-stone-400">
                        {meta.description}
                      </p>
                      <p className="mt-1 flex items-center gap-2 text-[11px] text-stone-400 dark:text-stone-500">
                        <Clock className="h-3 w-3" />
                        {formatRelativeTime(log.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-stone-400">
                    <span className="badge badge-slate">{log.action}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      <InfoState
        title="What this log means"
        message="Every entry is a real event produced by your CipherNote account. Keys, note contents and chat messages are never recorded here - only the actions that touch them."
      />
    </div>
  );
}
