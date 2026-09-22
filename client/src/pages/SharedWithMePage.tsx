import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, ShieldAlert, Unlock, Users, X } from 'lucide-react';
import { useSharedNotes } from '../hooks/useNotes';
import { collectTags, filterNotes } from '../lib/notes';
import { NoteCard } from '../components/NoteCard';
import { LoadingBlock } from '../components/Spinner';
import { EmptyState, ErrorState } from '../components/States';

export function SharedWithMePage(): JSX.Element {
  const navigate = useNavigate();
  const shared = useSharedNotes();

  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const tags = useMemo(() => collectTags(shared.notes), [shared.notes]);
  const visibleNotes = useMemo(
    () => filterNotes(shared.notes, { query, tag: activeTag, role: 'recipient' }),
    [shared.notes, query, activeTag],
  );

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">Notes shared with you</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Each note key here was wrapped with your RSA public key. Only your private key, unlocked with your
              password, can unwrap it.
            </p>
          </div>
          <span className="badge badge-violet">
            <Unlock className="h-3 w-3" />
            {shared.loading ? '…' : shared.notes.length} decrypted locally
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input pl-9"
              placeholder="Search shared notes locally, after decryption"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {query.trim() || activeTag ? (
            <button
              type="button"
              className="btn btn-secondary shrink-0"
              onClick={() => {
                setQuery('');
                setActiveTag(null);
              }}
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          ) : null}
        </div>

        {tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Tags
            </span>
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`badge ${activeTag === tag ? 'badge-cyan' : 'badge-slate'}`}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {shared.failedNoteIds.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
          <p className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-100/90">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {shared.failedNoteIds.length} shared{' '}
            {shared.failedNoteIds.length === 1 ? 'note could' : 'notes could'} not be decrypted. That usually means the
            wrapped key does not match this account's private key.
          </p>
        </div>
      ) : null}

      {shared.error ? (
        <ErrorState
          title="Could not load shared notes"
          message={shared.error}
          onRetry={() => void shared.reload()}
        />
      ) : shared.loading ? (
        <div className="card">
          <LoadingBlock label="Unwrapping note keys with your private key…" />
        </div>
      ) : shared.notes.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nothing has been shared with you yet"
          description="When another CipherNote user shares a note, the note key is encrypted to your public key and appears here for local decryption."
          action={
            <Link to="/dashboard" className="btn btn-secondary">
              Back to dashboard
            </Link>
          }
        />
      ) : visibleNotes.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No shared notes match"
          description="Search and tag filters run locally on the notes you have already decrypted."
          action={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setQuery('');
                setActiveTag(null);
              }}
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onOpen={() => navigate(`/notes/${note.id}`)}
              onInspect={() => navigate(`/inspector/${note.id}`)}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Shared notes are read-only for the recipient. Editing stays with the owner, who holds the master key that
        wraps the note key.
      </p>
    </div>
  );
}
