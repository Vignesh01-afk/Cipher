import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FilePlus2, FileText, Filter, Search, ShieldAlert, Tag, X } from 'lucide-react';
import { useOwnNotes } from '../hooks/useNotes';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { collectTags, filterNotes, type DecryptedNote } from '../lib/notes';
import { NoteCard } from '../components/NoteCard';
import { ShareNoteModal } from '../components/ShareNoteModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LoadingBlock } from '../components/Spinner';
import { EmptyState, ErrorState } from '../components/States';

export function NotesPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const own = useOwnNotes();

  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<DecryptedNote | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DecryptedNote | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Keep the URL in sync so a search can be linked to or reloaded.
  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (current === query) return;
    const next = new URLSearchParams(searchParams);
    if (query.trim()) next.set('q', query.trim());
    else next.delete('q');
    setSearchParams(next, { replace: true });
  }, [query, searchParams, setSearchParams]);

  const tags = useMemo(() => collectTags(own.notes), [own.notes]);
  const visibleNotes = useMemo(
    () => filterNotes(own.notes, { query, tag: activeTag }),
    [own.notes, query, activeTag],
  );

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteNote(deleteTarget.id);
      toast.success('Note deleted', 'Its ciphertext and all shares were removed from the server.');
      setDeleteTarget(null);
      await own.reload();
    } catch (error) {
      toast.error('Could not delete the note', error instanceof Error ? error.message : undefined);
    } finally {
      setDeleting(false);
    }
  }

  const searchIsActive = query.trim().length > 0 || activeTag !== null;

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">Your encrypted notes</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {own.loading
                ? 'Decrypting locally…'
                : `${own.notes.length} ${own.notes.length === 1 ? 'note' : 'notes'} decrypted in this tab`}
            </p>
          </div>
          <Link to="/notes/new" className="btn btn-primary">
            <FilePlus2 className="h-4 w-4" />
            New note
          </Link>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input pl-9"
              placeholder="Search title, content and tags - this runs on decrypted notes locally"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {searchIsActive ? (
            <button
              type="button"
              className="btn btn-secondary shrink-0"
              onClick={() => {
                setQuery('');
                setActiveTag(null);
              }}
            >
              <X className="h-4 w-4" />
              Clear filters
            </button>
          ) : null}
        </div>

        {tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Filter className="h-3.5 w-3.5" />
              Tags
            </span>
            <button
              type="button"
              onClick={() => setActiveTag(null)}
              className={`badge ${activeTag === null ? 'badge-cyan' : 'badge-slate'}`}
            >
              All
            </button>
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`badge ${activeTag === tag ? 'badge-cyan' : 'badge-slate'}`}
              >
                <Tag className="h-3 w-3" />
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
          Search is local: your query never reaches the API, which only holds ciphertext.
        </p>
      </section>

      {own.failedNoteIds.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
          <p className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-100/90">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {own.failedNoteIds.length === 1
              ? '1 note could not be decrypted and was hidden.'
              : `${own.failedNoteIds.length} notes could not be decrypted and were hidden.`}{' '}
            AES-GCM authentication failed, which means the ciphertext or nonce was altered in storage.
          </p>
        </div>
      ) : null}

      {own.error ? (
        <ErrorState
          title="Could not load your notes"
          message={own.error}
          onRetry={() => void own.reload()}
        />
      ) : own.loading ? (
        <div className="card">
          <LoadingBlock label="Fetching ciphertext and decrypting in your browser…" />
        </div>
      ) : own.notes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nothing here yet"
          description="Your vault is empty. Create a note and it will be encrypted on this device before the API ever sees it."
          action={
            <Link to="/notes/new" className="btn btn-primary">
              <FilePlus2 className="h-4 w-4" />
              Create your first note
            </Link>
          }
        />
      ) : visibleNotes.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No notes match that search"
          description="Search runs locally across decrypted titles, bodies and tags. Try a different term or clear the filters."
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
              onEdit={() => navigate(`/notes/${note.id}/edit`)}
              onShare={() => setShareTarget(note)}
              onDelete={() => setDeleteTarget(note)}
              onInspect={() => navigate(`/inspector/${note.id}`)}
            />
          ))}
        </div>
      )}

      <ShareNoteModal
        open={Boolean(shareTarget)}
        note={shareTarget}
        onClose={() => setShareTarget(null)}
        onChanged={() => void own.reload()}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete this note?"
        destructive
        busy={deleting}
        confirmLabel="Delete permanently"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
        message={
          <div className="space-y-2">
            <p>
              <strong className="font-semibold text-slate-800 dark:text-slate-100">
                {deleteTarget?.title || 'Untitled note'}
              </strong>{' '}
              will be removed from the server along with every share attached to it. Anyone it was shared with loses
              access immediately.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              This cannot be undone. Copies that recipients already decrypted are outside this application's control.
            </p>
          </div>
        }
      />
    </div>
  );
}
