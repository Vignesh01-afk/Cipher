import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  FilePlus2,
  FileText,
  KeyRound,
  Lock,
  Search,
  ServerOff,
  ShieldCheck,
  ScrollText,
  Users,
} from 'lucide-react';
import { useOwnNotes, useSharedNotes } from '../hooks/useNotes';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { getAuditActionMeta } from '../lib/auditActions';
import { formatRelativeTime } from '../lib/format';
import { StatCard } from '../components/StatCard';
import { NoteCard } from '../components/NoteCard';
import { LoadingBlock } from '../components/Spinner';
import { EmptyState, ErrorState } from '../components/States';
import type { AuditLogDto } from '../lib/types';

export function DashboardPage(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const own = useOwnNotes();
  const shared = useSharedNotes();

  const [logs, setLogs] = useState<AuditLogDto[]>([]);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function loadLogs(): Promise<void> {
      setLogsLoading(true);
      try {
        const result = await api.listAuditLogs({ limit: 6 });
        if (!cancelled) {
          setLogs(result);
          setLogsError(null);
        }
      } catch (error) {
        if (!cancelled) setLogsError(error instanceof Error ? error.message : 'Could not load activity.');
      } finally {
        if (!cancelled) setLogsLoading(false);
      }
    }

    void loadLogs();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeSharesGiven = useMemo(
    () => own.notes.reduce((total, note) => total + note.shares.filter((share) => share.isActive).length, 0),
    [own.notes],
  );

  const totalTags = useMemo(() => {
    const tags = new Set<string>();
    for (const note of own.notes) for (const tag of note.tags) tags.add(tag);
    return tags.size;
  }, [own.notes]);

  const recentNotes = own.notes.slice(0, 6);
  const loading = own.loading || shared.loading;

  return (
    <div className="space-y-6">
      {/* Greeting + local search */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {user ? `Welcome back, ${user.displayName}` : 'Welcome back'}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Everything below was decrypted in this browser tab. Your keys never leave it.
            </p>
          </div>
          <Link to="/notes/new" className="btn btn-primary">
            <FilePlus2 className="h-4 w-4" />
            New encrypted note
          </Link>
        </div>

        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            navigate(query.trim() ? `/notes?q=${encodeURIComponent(query.trim())}` : '/notes');
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input pl-9"
              placeholder="Search your notes by title, content or tag - locally, after decryption"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-secondary shrink-0">
            Search locally
          </button>
        </form>
      </section>

      {/* Stats */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={FileText}
          label="My notes"
          value={own.loading ? '—' : own.notes.length}
          hint={own.loading ? 'Loading…' : `${totalTags} distinct ${totalTags === 1 ? 'tag' : 'tags'} across your notes`}
          tone="cyan"
        />
        <StatCard
          icon={Users}
          label="Shared with me"
          value={shared.loading ? '—' : shared.notes.length}
          hint="Notes another user wrapped with your public key"
          tone="violet"
        />
        <StatCard
          icon={KeyRound}
          label="Active shares granted"
          value={own.loading ? '—' : activeSharesGiven}
          hint="Recipients who can currently decrypt your notes"
          tone="emerald"
        />
        <StatCard
          icon={ScrollText}
          label="Audit events"
          value={logsLoading ? '—' : logs.length}
          hint="Most recent security-relevant events on your account"
          tone="amber"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Recent notes */}
        <section className="xl:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Recent notes
            </h2>
            <Link to="/notes" className="link text-xs">
              View all
            </Link>
          </div>

          {own.error ? (
            <ErrorState message={own.error} onRetry={() => void own.reload()} />
          ) : loading ? (
            <div className="card">
              <LoadingBlock label="Fetching and decrypting your notes…" />
            </div>
          ) : recentNotes.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No notes yet"
              description="Create your first note. It will be sealed with AES-GCM in this browser before anything is sent to the API."
              action={
                <Link to="/notes/new" className="btn btn-primary">
                  <FilePlus2 className="h-4 w-4" />
                  Create a note
                </Link>
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {recentNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onOpen={() => navigate(`/notes/${note.id}`)}
                  onInspect={() => navigate(`/inspector/${note.id}`)}
                  onEdit={note.role === 'owner' ? () => navigate(`/notes/${note.id}/edit`) : undefined}
                />
              ))}
            </div>
          )}
        </section>

        {/* Security posture + activity */}
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
              <ShieldCheck className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
              Encryption in effect
            </h2>
            <dl className="mt-4 space-y-3 text-xs">
              {[
                { term: 'Note payload', value: 'AES-GCM-256, unique 96-bit nonce per write' },
                { term: 'Owner key wrap', value: 'AES-GCM-256 under a PBKDF2-derived master key' },
                { term: 'Recipient key wrap', value: 'RSA-OAEP-2048 with SHA-256' },
                { term: 'Password -> key', value: 'PBKDF2-SHA256, 210,000 iterations' },
                { term: 'Server-side plaintext', value: 'None - the API stores ciphertext only' },
              ].map((row) => (
                <div key={row.term} className="flex flex-col gap-0.5">
                  <dt className="font-semibold text-slate-700 dark:text-slate-200">{row.term}</dt>
                  <dd className="text-slate-500 dark:text-slate-400">{row.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              Vault unlocked in this tab
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/70 dark:text-slate-300">
              <ServerOff className="h-3.5 w-3.5 shrink-0" />
              The API cannot decrypt any note, even with full database access
            </div>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Latest activity</h2>
              <Link to="/activity" className="link text-xs">
                Full log
              </Link>
            </div>

            {logsError ? (
              <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{logsError}</p>
            ) : logsLoading ? (
              <LoadingBlock label="Loading activity…" />
            ) : logs.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No activity recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {logs.map((log) => {
                  const meta = getAuditActionMeta(log.action);
                  return (
                    <li key={log.id} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        <meta.icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                          {meta.label}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          {formatRelativeTime(log.createdAt)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <Link to="/activity" className="btn btn-secondary btn-sm mt-4 w-full">
              Open activity log
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
