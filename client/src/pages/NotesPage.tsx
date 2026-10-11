import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useOwnNotes } from '../hooks/useNotes';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { collectTags, filterNotes, type DecryptedNote } from '../lib/notes';
import { NoteCard } from '../components/NoteCard';
import { ShareNoteModal } from '../components/ShareNoteModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { ErrorState, InfoState } from '../components/States';
import { FilePlus, MagnifyingGlass, X, Funnel, Tag, FileText } from '@phosphor-icons/react';
import type { ReactElement } from 'react';

export function NotesPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const own = useOwnNotes();

  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<DecryptedNote | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DecryptedNote | null>(null);
  const [inspectTarget, setInspectTarget] = useState<DecryptedNote | null>(null);
  const [deleting, setDeleting] = useState(false);

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
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-stone-900 dark:text-white">My Notes</h2>
            <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">
              Your encrypted notes. Only you can access them.
              {own.loading ? ' Decrypting locally…' : ''}
            </p>
          </div>
          <Link to="/notes/new" className="btn btn-primary">
            <FilePlus className="h-4 w-4" />
            Create Note
          </Link>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              className="input pl-9"
              placeholder="Search title, content and tags - runs locally on decrypted notes"
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
            <span className="sr-only">
              <Funnel className="h-3.5 w-3.5" />
              Category filters
            </span>
            <button
              type="button"
              onClick={() => setActiveTag(null)}
              className={`rounded border px-4 py-1.5 text-xs font-semibold transition-colors ${
                activeTag === null
                  ? 'border-accent bg-accent text-paper'
                  : 'border-line bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
              }`}
            >
              All
            </button>
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`inline-flex items-center gap-1.5 rounded border px-4 py-1.5 text-xs font-semibold transition-colors ${
                  activeTag === tag
                    ? 'border-accent bg-accent text-paper'
                    : 'border-line bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
                }`}
              >
                <Tag className="h-3 w-3" />
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
          Search runs locally: your query never reaches the API, which only holds ciphertext.
        </p>
      </section>

      {own.failedNoteIds.length > 0 ? (
        <InfoState
          title="A few notes could not be decrypted"
          message="AES-GCM authentication failed for these notes, which means their ciphertext or nonce was altered in storage. They stay hidden in this list and you can still access the notes your vault can read."
        />
      ) : null}

      {own.error ? (
        <ErrorState
          title="Could not load your notes"
          message={own.error}
          onRetry={() => void own.reload()}
        />
      ) : own.loading ? (
        <div className="card space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ) : own.notes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nothing here yet"
          description="Your vault is empty. Create a note and it will be encrypted on this device before the API ever sees it."
          action={
            <Link to="/notes/new" className="btn btn-primary">
              <FilePlus className="h-4 w-4" />
              Create your first note
            </Link>
          }
        />
      ) : visibleNotes.length === 0 ? (
        <EmptyState
          icon={MagnifyingGlass}
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
              onInspect={() => setInspectTarget(note)}
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
              <strong className="font-semibold text-stone-800 dark:text-stone-100">
                {deleteTarget?.title || 'Untitled note'}
              </strong>{' '}
              will be removed from the server along with every share attached to it. Anyone it was shared with loses
              access immediately.
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              This cannot be undone. Copies that recipients already decrypted are outside this application's control.
            </p>
          </div>
        }
      />

      <ConfirmDialog
        open={Boolean(inspectTarget)}
        title="Close note?"
        message="This note will stay on your device until you close it."
        onCancel={() => setInspectTarget(null)}
        onConfirm={() => setInspectTarget(null)}
      />
    </div>
  );
}
