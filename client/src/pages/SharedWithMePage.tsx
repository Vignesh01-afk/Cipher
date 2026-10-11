import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MagnifyingGlass, ShieldWarning, LockOpen, Users, X, ShareNetwork, FileText, Trash } from '@phosphor-icons/react';
import { useOwnNotes, useSharedNotes } from '../hooks/useNotes';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { collectTags, filterNotes, type DecryptedNote } from '../lib/notes';
import { NoteCard } from '../components/NoteCard';
import { Skeleton } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/States';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { ShareNoteModal } from '../components/ShareNoteModal';
import { Badge } from '../components/Badge';
import { formatRelativeTime } from '../lib/format';
import type { ShareDto } from '../lib/types';

type Tab = 'with-me' | 'by-me';

interface OutgoingShare {
  note: DecryptedNote;
  share: ShareDto;
}

/**
 * Sharing hub.
 *
 *  - "Shared with me": notes other people shared, decrypted locally with the
 *    recipient's private key (the wrapped note key is opened in the browser).
 *  - "Shared by me": every active share the current user has granted, derived
 *    from the same locally-decrypted own-note list (no plaintext leaves here).
 *
 * Revocation is a real `DELETE`-style call to the API; the dialog is explicit
 * that revoking removes future access but cannot recall copies already read.
 */
export function SharedWithMePage(): React.ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const shared = useSharedNotes();
  const own = useOwnNotes();

  const [tab, setTab] = useState<Tab>('with-me');
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<DecryptedNote | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<OutgoingShare | null>(null);
  const [revoking, setRevoking] = useState(false);

  const tags = useMemo(() => collectTags(shared.notes), [shared.notes]);
  const visibleNotes = useMemo(
    () => filterNotes(shared.notes, { query, tag: activeTag, role: 'recipient' }),
    [shared.notes, query, activeTag],
  );

  const outgoing = useMemo<OutgoingShare[]>(
    () =>
      own.notes.flatMap((note) =>
        note.shares.filter((share) => share.isActive).map((share) => ({ note, share })),
      ),
    [own.notes],
  );

  const visibleOutgoing = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return outgoing;
    return outgoing.filter(
      (row) =>
        row.note.title.toLowerCase().includes(needle) ||
        row.share.recipient.displayName.toLowerCase().includes(needle) ||
        row.share.recipient.email.toLowerCase().includes(needle),
    );
  }, [outgoing, query]);

  const pickerNotes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return own.notes;
    return own.notes.filter((note) => note.title.toLowerCase().includes(needle));
  }, [own.notes, query]);

  async function confirmRevoke(): Promise<void> {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api.revokeShare(revokeTarget.note.id, revokeTarget.share.sharedWithId);
      toast.success('Access revoked', `${revokeTarget.share.recipient.displayName} can no longer open this note.`);
      setRevokeTarget(null);
      await own.reload();
    } catch (error) {
      toast.error('Could not revoke access', error instanceof Error ? error.message : undefined);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900 dark:text-stone-50">Shared Notes</h2>
            <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">
              Every note key is wrapped with RSA-OAEP and only opened in your browser.
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setPickerOpen(true)}>
            <ShareNetwork className="h-4 w-4" />
            Share Note
          </button>
        </div>

        <div className="mt-4 inline-flex rounded-md bg-stone-100 p-1 dark:bg-surface/[0.06]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`rounded-md px-4 py-2 text-sm font-semibold  ${
                tab === 'by-me'
                  ? '    text-white '
                  : 'text-stone-600 dark:text-stone-300'
              }`}
              onClick={() => {
                setTab('by-me');
                setQuery('');
              }}
            >
              Shared by me
            </button>
            <span className="ml-1.5 text-xs opacity-80">{outgoing.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`rounded-md px-4 py-2 text-sm font-semibold  ${
                tab === 'with-me'
                  ? '    text-white '
                  : 'text-stone-600 dark:text-stone-300'
              }`}
              onClick={() => {
                setTab('with-me');
                setQuery('');
              }}
            >
              Shared with me
            </button>
            <span className="ml-1.5 text-xs opacity-80">{shared.notes.length}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              className="input pl-10"
              placeholder={tab === 'by-me' ? 'Search by note or recipient' : 'Search shared notes locally, after decryption'}
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

        {tab === 'with-me' && tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">Tags</span>
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

      {tab === 'by-me' ? (
        own.error ? (
          <ErrorState title="Could not load your notes" message={own.error} onRetry={() => void own.reload()} />
        ) : own.loading ? (
          <div className="card space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ) : visibleOutgoing.length === 0 ? (
          <EmptyState
            icon={ShareNetwork}
            title={outgoing.length === 0 ? 'You have not shared any notes yet' : 'No active shares match'}
            description={
              outgoing.length === 0
                ? 'Open a note and use “Share” to wrap its key for another CipherNote user. Active shares will appear here.'
                : 'Search runs locally against the notes you have already decrypted.'
            }
            action={
              outgoing.length === 0 ? (
                <Link to="/notes" className="btn btn-secondary">
                  Go to my notes
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-stone-400 dark:border-white/[0.08]">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Note</th>
                    <th className="px-4 py-3 font-semibold">Shared with</th>
                    <th className="px-4 py-3 font-semibold">Access</th>
                    <th className="px-4 py-3 font-semibold">Shared</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOutgoing.map((row) => (
                    <tr
                      key={row.share.id}
                      className="border-b border-white/5  hover:bg-surface/40 last:border-0 dark:border-white/[0.05] dark:hover:bg-surface/[0.04]"
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="flex items-center gap-2 text-left font-medium text-stone-800 hover:text-brand-600 dark:text-stone-100 dark:hover:text-brand-300"
                          onClick={() => navigate(`/notes/${row.note.id}`)}
                        >
                          <FileText className="h-4 w-4 shrink-0 text-stone-400" />
                          <span className="truncate">{row.note.title || 'Untitled note'}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-stone-800 dark:text-stone-100">{row.share.recipient.displayName}</p>
                        <p className="text-xs text-stone-500 dark:text-stone-400">{row.share.recipient.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="emerald">Can view</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-stone-500 dark:text-stone-400">
                        {formatRelativeTime(row.share.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10"
                          onClick={() => setRevokeTarget(row)}
                        >
                          <Trash className="h-3.5 w-3.5" />
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : shared.failedNoteIds.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-500/30 dark:bg-amber-500/5">
          <p className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-100/90">
            <ShieldWarning className="mt-0.5 h-4 w-4 shrink-0" />
            {shared.failedNoteIds.length} shared {shared.failedNoteIds.length === 1 ? 'note could' : 'notes could'} not
            be decrypted. That usually means the wrapped key does not match this account's private key.
          </p>
        </div>
      ) : shared.error ? (
        <ErrorState title="Could not load shared notes" message={shared.error} onRetry={() => void shared.reload()} />
      ) : shared.loading ? (
        <div className="card space-y-3">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
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
          icon={MagnifyingGlass}
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

      <p className="flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
        <LockOpen className="h-3.5 w-3.5" />
        Shared notes are read-only for the recipient. Editing stays with the owner, who holds the master key that wraps
        the note key.
      </p>

      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Share a note" description="Pick one of your notes to wrap its key for another user." size="md">
        <div className="space-y-3">
          <div className="relative">
            <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="search"
              className="input pl-10"
              placeholder="Search your notes"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {own.loading ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ) : pickerNotes.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-500 dark:text-stone-400">No notes match your search.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {pickerNotes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left  hover:bg-surface/70 dark:hover:bg-surface/[0.06]"
                    onClick={() => {
                      setPickerOpen(false);
                      setShareTarget(note);
                    }}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-stone-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-stone-800 dark:text-stone-100">
                        {note.title || 'Untitled note'}
                      </span>
                      <span className="block truncate text-xs text-stone-500 dark:text-stone-400">
                        {note.shares.filter((s) => s.isActive).length} active share(s)
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <ShareNoteModal
        open={shareTarget !== null}
        note={shareTarget}
        onClose={() => setShareTarget(null)}
        onChanged={() => void own.reload()}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke access?"
        message={
          revokeTarget
            ? `${revokeTarget.share.recipient.displayName} will lose access to “${revokeTarget.note.title || 'Untitled note'}”. Revoking stops future access but cannot recall copies they already opened or exported.`
            : ''
        }
        confirmLabel="Revoke access"
        destructive
        busy={revoking}
        onConfirm={() => void confirmRevoke()}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}
