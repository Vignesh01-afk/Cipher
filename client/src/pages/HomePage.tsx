import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useOwnNotes, useSharedNotes } from '../hooks/useNotes';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { notePreview, sortNotesByUpdated, categoryFromTags } from '../lib/notes';
import { formatRelativeTime } from '../lib/format';
import { Lock, FileText, Users, ChatsCircle, Clock, ArrowRight, ShieldCheck, Folder, ShareNetwork } from '@phosphor-icons/react';
import type { ReactElement } from 'react';
import type { DecryptedNote } from '../lib/notes';

export function HomePage(): ReactElement {
  const { user } = useAuth();
  const own = useOwnNotes();
  const shared = useSharedNotes();
  const navigate = useNavigate();
  const toast = useToast();
  const [recent, setRecent] = useState<DecryptedNote[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    if (!own.notes.length) return;
    const sorted = sortNotesByUpdated(own.notes);
    setRecent(sorted.slice(0, 8));
    setRecentLoading(false);
  }, [own.notes]);

  const totalNotes = own.loading ? null : own.notes.length;
  const sharedNotes = shared.loading ? null : shared.notes.length;
  const activeShares = own.loading
    ? null
    : own.notes.reduce((acc, note) => acc + note.shares.filter((s) => s.isActive).length, 0);

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = user?.displayName?.trim().split(/\s+/)[0] ?? '';

  const logs = useMemo(() => {
    const result: { id: string; action: string; createdAt: string; recipient?: string }[] = [];
    let cancelled = false;
    api
      .listAuditLogs({ limit: 6 })
      .then((items) => {
        if (cancelled) return;
        for (const item of items.slice(0, 6)) {
          result.push({ id: item.id, action: item.action, createdAt: item.createdAt });
        }
      })
      .catch(() => {});
    return result;
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="card p-6 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-ink dark:text-paper sm:text-4xl">
              {greeting()}, {firstName ? firstName : 'there'} <span aria-hidden="true">👋</span>
            </h1>
            <p className="mt-2 max-w-xl text-lg leading-7 text-muted dark:text-muted">
              Your notes are safe, private and always with you.
            </p>
          </div>
          <Link to="/notes/new" className="btn btn-primary flex-none sm:min-w-[140px]">
            <FileText className="h-4 w-4" />
            Create Note
          </Link>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-3">
          <article className="glass-panel stat-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="stat-card-label">Total Notes</p>
                <p className="stat-card-value mt-1">{totalNotes ?? '-'}</p>
              </div>
              <span className="stat-card-icon">
                <FileText className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-xs text-muted dark:text-muted">
              Every note is AES-GCM-256 in this browser.
            </p>
            <Link to="/notes" className="stat-card-url mt-2 inline-block">
              View all <ArrowRight className="h-3.5 w-3.5 inline-block" />
            </Link>
          </article>

          <article className="glass-panel stat-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="stat-card-label">Shared Notes</p>
                <p className="stat-card-value mt-1">{sharedNotes ?? '-'}</p>
              </div>
              <span className="stat-card-icon">
                <Users className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-xs text-muted dark:text-muted">
              {sharedNotes === 0 ? 'No notes have been shared with you yet.' : 'Notes others shared with you.'}
            </p>
            <Link to="/shared" className="stat-card-url mt-2 inline-block">
              View all <ArrowRight className="h-3.5 w-3.5 inline-block" />
            </Link>
          </article>

          <article className="glass-panel stat-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="stat-card-label">Secure Chats</p>
                <p className="stat-card-value mt-1">{activeShares ?? '-'}</p>
              </div>
              <span className="stat-card-icon">
                <ShareNetwork className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-xs text-muted dark:text-muted">
              Active encrypted conversations in this account.
            </p>
            <Link to="/chat" className="stat-card-url mt-2 inline-block">
              Start one <ArrowRight className="h-3.5 w-3.5 inline-block" />
            </Link>
          </article>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight text-ink dark:text-paper">Recent Notes</h2>
            <Link to="/notes" className="link inline-flex items-center gap-1 text-sm font-medium">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {recentLoading ? (
            <div className="card space-y-3 p-4">
              <div className="skeleton h-4 w-1/3" />
              <div className="skeleton h-3 w-2/3" />
              <div className="skeleton h-10 w-full" />
            </div>
          ) : recent.length === 0 ? (
            <div className="card p-8 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted" />
              <h3 className="mt-3 text-lg font-bold text-ink dark:text-paper">No notes yet</h3>
              <p className="mt-1 text-sm text-muted dark:text-muted">
                Create your first encrypted note and it will appear here.
              </p>
              <Link to="/notes/new" className="btn btn-primary mt-4">
                Create Note
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {recent.map((note) => (
                <li
                  key={note.id}
                  className="flex items-center gap-3 rounded-xl border border-line bg-panel p-4 transition hover:shadow-[0_0_0_1px_rgba(99,102,241,0.35),0_0_24px_rgba(99,102,241,0.18)]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-sm font-bold shadow-[0_0_0_1px_rgba(99,102,241,0.35),0_0_24px_rgba(99,102,241,0.18)]">
                    {note.title?.[0]?.toUpperCase() ?? '?'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-ink dark:text-paper">
                        {note.title || 'Untitled note'}
                      </span>
                      {categoryFromTags(note.tags) && (
                        <span className="shrink-0">
                          <span className={`chip chip-${categoryFromTags(note.tags)!}`}>
                            {categoryFromTags(note.tags)}
                          </span>
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-muted dark:text-muted">
                      Last edited {formatRelativeTime(note.updatedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm shrink-0 text-muted hover:text-ink"
                    onClick={() => {
                      setHighlightId(note.id);
                      navigate(`/notes/${note.id}`);
                    }}
                    aria-label={`Open ${note.title || 'Untitled note'}`}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside className="space-y-5">
          <div className="glass-panel overflow-hidden rounded-2xl p-6 text-center">
            <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 via-indigo-500 to-purple-600 text-white shadow-[0_0_0_1px_rgba(99,102,241,0.35),0_0_24px_rgba(99,102,241,0.18)]">
              <Lock className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-ink dark:text-paper">Encrypted. Always.</h3>
            <p className="mt-2 text-sm leading-6 text-muted dark:text-muted">
              Your notes are protected with end-to-end encryption and only accessible by you and people you
              trust.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-muted dark:text-muted">
              <ShieldCheck className="h-4 w-4 text-cyan-400" />
              AES-GCM-256
              <span className="mx-1" aria-hidden="true">·</span>
              RSA-OAEP wrapping
              <span className="mx-1" aria-hidden="true">·</span>
              Zero-knowledge server
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-5 text-left">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink dark:text-paper">Latest activity</h3>
            <ul className="mt-3 space-y-3">
              {logs.length === 0 ? (
                <li className="text-sm text-muted dark:text-muted">No activity yet.</li>
              ) : (
                logs.map((log) => (
                  <li key={log.id} className="flex items-center gap-3 text-sm">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-panel border border-line text-indigo-500">
                      <Clock className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink dark:text-paper">{log.action}</p>
                      <p className="text-xs text-muted dark:text-muted">{formatRelativeTime(log.createdAt)}</p>
                    </div>
                  </li>
                ))
              )}
            </ul>
            <Link to="/activity" className="mt-4 btn btn-secondary w-full">
              Full activity log
            </Link>
          </div>
        </aside>
      </section>
    </div>
  );
}
