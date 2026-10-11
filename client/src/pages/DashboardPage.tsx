import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useOwnNotes, useSharedNotes } from '../hooks/useNotes';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatRelativeTime } from '../lib/format';
import { AUDIT_ACTIONS, getAuditActionMeta } from '../lib/auditActions';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { NoteCard } from '../components/NoteCard';
import { ErrorState } from '../components/States';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import { FilePlus, MagnifyingGlass, FileText, Users, ChatsCircle, Scroll, ArrowRight, ShieldCheck, Lock, WifiSlash } from '@phosphor-icons/react';
import type { ReactElement } from 'react';

export function DashboardPage(): ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const own = useOwnNotes();
  const shared = useSharedNotes();

  const [search, setSearch] = useState('');
  const [logs, setLogs] = useState<{ action: string; createdAt: string }[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  const [recentNotes, setRecentNotes] = useState<typeof own.notes>([]);
  const [notesLoading, setNotesLoading] = useState(true);

  useMemo(() => {
    if (!own.notes.length) return;
    setRecentNotes(own.notes.slice(0, 5));
    setNotesLoading(false);
  }, [own.notes]);

  useEffect(() => {
    let cancelled = false;
    api.listAuditLogs({ limit: 8 }).then((result) => {
      if (!cancelled) setLogs(result);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? '';

  const totalNotes = own.loading ? null : own.notes.length;
  const sharedNotes = shared.loading ? null : shared.notes.length;
  const secureChats = own.loading
    ? null
    : own.notes.reduce((total, note) => total + note.shares.filter((s) => s.isActive).length, 0);

  return (
    <div className="space-y-6">
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white">
              {greeting()}, {firstName ? <>{firstName}</> : <>there</>}!
            </h1>
            <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">
              Your notes are safe, private and always with you.
            </p>
          </div>
          <Button variant="primary" onClick={() => navigate('/notes/new')}>
            <FilePlus className="h-4 w-4" />
            New Note
          </Button>
        </div>

        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(search.trim() ? `/notes?q=${encodeURIComponent(search.trim())}` : '/notes');
          }}
        >
          <div className="relative flex-1">
            <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              className="input pl-10"
              placeholder="Search your notes by title, content or tag"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            <MagnifyingGlass className="h-4 w-4" />
            Search locally
          </Button>
        </form>
      </section>

      <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          className="stat-card"
          onClick={() => navigate('/notes')}
          aria-label="Go to Notes"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="stat-card-label">Total Notes</p>
              <p className="stat-card-value">{totalNotes ?? '-'}</p>
              <span className="stat-card-url">View all</span>
            </div>
            <span className="stat-card-icon">
              <FileText className="h-5 w-5" />
            </span>
          </div>
        </button>

        <button
          type="button"
          className="stat-card"
          onClick={() => navigate('/shared')}
          aria-label="Go to Shared notes"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="stat-card-label">Shared Notes</p>
              <p className="stat-card-value">{sharedNotes ?? '-'}</p>
              <span className="stat-card-url">View all</span>
            </div>
            <span className="stat-card-icon">
              <Users className="h-5 w-5" />
            </span>
          </div>
        </button>

        <button
          type="button"
          className="stat-card"
          onClick={() => navigate('/chat')}
          aria-label="Go to Secure Chats"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="stat-card-label">Secure Chats</p>
              <p className="stat-card-value">{secureChats ?? '-'}</p>
              <span className="stat-card-url">Start a conversation</span>
            </div>
            <span className="stat-card-icon">
              <ChatsCircle className="h-5 w-5" />
            </span>
          </div>
        </button>

        <button
          type="button"
          className="stat-card"
          onClick={() => navigate('/activity')}
          aria-label="Go to Activity log"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="stat-card-label">Audit Events</p>
              <p className="stat-card-value">{logsLoading ? '-' : logs.length}</p>
              <span className="stat-card-url">View full log</span>
            </div>
            <span className="stat-card-icon">
              <Scroll className="h-5 w-5" />
            </span>
          </div>
        </button>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-stone-900 dark:text-white">
              Encrypted. Always.
            </h2>
            <p className="mt-1 text-sm leading-6 text-stone-500 dark:text-stone-400">
              Notes are sealed with AES-GCM-256 in this browser and only readable by those you choose.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <section className="xl:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold tracking-tight text-stone-900 dark:text-white">Recent Notes</h2>
            <Link to="/notes" className="link">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {own.error ? (
            <ErrorState message={own.error} onRetry={() => void own.reload()} />
          ) : notesLoading ? (
            <div className="card">
              <SkeletonText lines={4} />
            </div>
          ) : recentNotes.length === 0 ? (
            <EmptyState
              icon={FilePlus}
              title="No notes yet"
              description="Create your first encrypted note. It will be sealed with AES-GCM in this browser before anything is sent to the API."
              action={<Button variant="primary" onClick={() => navigate('/notes/new')}><FilePlus className="h-4 w-4" /> New Note</Button>}
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {recentNotes.map((note) => (
                <NoteCard key={note.id} note={note} onOpen={() => navigate(`/notes/${note.id}`)} />
              ))}
            </div>
          )}
        </section>

        <section className="space-y-6">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold text-stone-900 dark:text-white">
              <ShieldCheck className="h-4 w-4 text-brand-600 dark:text-brand-300" />
              Encryption in effect
            </h2>
            <dl className="mt-4 space-y-3 text-xs leading-6 text-stone-500 dark:text-stone-400">
              {[
                { term: 'Note payload', value: 'AES-GCM-256, unique 96-bit nonce per write' },
                { term: 'Owner key wrap', value: 'AES-GCM-256 under a PBKDF2-derived master key' },
                { term: 'Recipient key wrap', value: 'RSA-OAEP-2048 with SHA-256' },
                { term: 'Password to key', value: 'PBKDF2-SHA256, 210,000 iterations' },
                {              term: 'Server-side plaintext',
              value: 'None - the API stores ciphertext only' },
              ].map((row) => (
                <div key={row.term} className="flex flex-col gap-0.5">
                  <dt className="font-semibold text-stone-700 dark:text-stone-200">{row.term}</dt>
                  <dd className="text-stone-500 dark:text-stone-400">{row.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex items-center gap-2 rounded-md border border-accent-300 bg-accent-50 px-3 py-2 text-xs text-accent-700 dark:border-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              Vault unlocked in this tab
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted dark:bg-surface">
              <WifiSlash className="h-3.5 w-3.5 shrink-0" />
              The API cannot decrypt any note, even with full database access
            </div>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-stone-900 dark:text-white">Latest activity</h2>
            </div>
            {logsLoading ? (
              <SkeletonBlock />
            ) : logs.length === 0 ? (
              <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">No activity recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {logs.map((log) => {
                  const matching = getAuditActionMeta(log.action);
                  const Icon = matching?.icon ?? MagnifyingGlass;
                  return (
                    <li key={log.createdAt} className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-line bg-surface text-muted dark:bg-surface">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-stone-700 dark:text-stone-200">{matching?.label ?? log.action}</p>
                        <p className="text-xs text-stone-400">{formatRelativeTime(log.createdAt)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </section>
      </section>
    </div>
  );
}

function SkeletonBlock({ label = 'Loading…' }: { label?: string }): ReactElement {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-stone-500 dark:text-stone-400">
      <div className="h-4 w-16 rounded border border-line bg-line" />
      <span>{label}</span>
    </div>
  );
}
