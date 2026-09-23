import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  KeyRound,
  Lock,
  Pencil,
  Share2,
  ShieldCheck,
  Tag,
  Trash2,
  Unlock,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ApiError, api } from '../lib/api';
import { decryptOwnNote, decryptSharedNote, type DecryptedNote } from '../lib/notes';
import { formatBytes, formatDateTime, formatRelativeTime } from '../lib/format';
import { ShareNoteModal } from '../components/ShareNoteModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { LoadingBlock } from '../components/Spinner';
import { ErrorState } from '../components/States';
import { NoteFilesPanel } from '../components/NoteFilesPanel';
import { SecurityBadge } from '../components/SecurityBadge';

export function NoteViewPage(): JSX.Element {
  const { noteId } = useParams<{ noteId: string }>();
  const { keys } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [note, setNote] = useState<DecryptedNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!noteId || !keys) return;
    setLoading(true);
    setError(null);
    try {
      const remote = await api.getNote(noteId);
      // The server tells us which side of the share we are on; decrypt
      // accordingly with the owner's master key or our RSA private key.
      const decrypted =
        remote.role === 'owner'
          ? await decryptOwnNote(remote, keys)
          : await decryptSharedNote(
              {
                shareId: '',
                noteId: remote.id,
                grantedAt: remote.updatedAt,
                keyAlgorithm: remote.keyAlgorithm ?? 'RSA-OAEP-2048-SHA256',
                wrappedKey: remote.wrappedKey ?? '',
                owner: remote.owner,
                ciphertext: remote.ciphertext,
                iv: remote.iv,
                encryptionVersion: remote.encryptionVersion,
                algorithm: remote.algorithm,
                payloadBytes: remote.payloadBytes,
                createdAt: remote.createdAt,
                updatedAt: remote.updatedAt,
              },
              keys,
            );
      setNote(decrypted);
    } catch (loadError) {
      if (loadError instanceof ApiError) {
        setError({ message: loadError.message, status: loadError.status });
      } else {
        setError({
          message:
            loadError instanceof Error
              ? `${loadError.message} The ciphertext may have been altered, or the key no longer matches.`
              : 'Could not open this note.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [noteId, keys]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete(): Promise<void> {
    if (!note) return;
    setDeleting(true);
    try {
      await api.deleteNote(note.id);
      toast.success('Note deleted', 'The ciphertext and all of its shares were removed.');
      navigate('/notes', { replace: true });
    } catch (deleteError) {
      toast.error('Could not delete the note', deleteError instanceof Error ? deleteError.message : undefined);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <LoadingBlock label="Downloading ciphertext and decrypting locally…" />
      </div>
    );
  }

  if (error || !note) {
    const accessDenied = error?.status === 403;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link to="/notes" className="btn btn-ghost btn-sm">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to notes
        </Link>
        <ErrorState
          title={accessDenied ? 'Access denied' : 'Could not open this note'}
          message={
            error?.message ??
            'This note is unavailable.'
          }
          onRetry={() => void load()}
        >
          {accessDenied ? (
            <p className="mt-2 text-xs text-rose-700/90 dark:text-rose-200/80">
              If the owner revoked your access, the API now rejects every request for this note. A copy you already
              decrypted before the revocation would still be readable outside CipherNote.
            </p>
          ) : null}
        </ErrorState>
      </div>
    );
  }

  const isOwner = note.role === 'owner';
  const activeShares = note.shares.filter((share) => share.isActive);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to={isOwner ? '/notes' : '/shared'} className="btn btn-ghost btn-sm">
          <ArrowLeft className="h-3.5 w-3.5" />
          {isOwner ? 'Back to notes' : 'Back to shared notes'}
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <SecurityBadge compact />
          <Link to={`/inspector/${note.id}`} className="btn btn-secondary btn-sm">
            <ShieldCheck className="h-3.5 w-3.5" />
            Security inspector
          </Link>
          {isOwner ? (
            <>
              <Link to={`/notes/${note.id}/edit`} className="btn btn-secondary btn-sm">
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Link>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setShareOpen(true)}>
                <Share2 className="h-3.5 w-3.5" />
                Share
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm text-rose-600 dark:text-rose-400"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </>
          ) : null}
        </div>
      </div>

      <article className="card p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`badge ${isOwner ? 'badge-cyan' : 'badge-amber'}`}>
            {isOwner ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
            {isOwner ? 'Owned by you' : 'Shared with you'}
          </span>
          <span className="badge badge-emerald">
            <KeyRound className="h-3 w-3" />
            {note.algorithm} · v{note.encryptionVersion}
          </span>
          {isOwner ? (
            <span className="badge badge-slate">
              {activeShares.length === 0
                ? 'Not shared'
                : `${activeShares.length} active ${activeShares.length === 1 ? 'share' : 'shares'}`}
            </span>
          ) : null}
        </div>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          {note.title || 'Untitled note'}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <UserRound className="h-3.5 w-3.5" />
            {note.owner.displayName} · {note.owner.email}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            Created {formatDateTime(note.createdAt)}
          </span>
          <span title={new Date(note.updatedAt).toString()}>Updated {formatRelativeTime(note.updatedAt)}</span>
          <span>{formatBytes(note.payloadBytes)} plaintext payload</span>
        </div>

        {note.tags.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {note.tags.map((tag) => (
              <span key={tag} className="badge badge-slate">
                <Tag className="h-3 w-3" />
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="divider" />

        <div className="whitespace-pre-wrap break-words font-mono text-[13px] leading-7 text-slate-700 dark:text-slate-200">
          {note.content || <span className="text-slate-400 dark:text-slate-500">This note is empty.</span>}
        </div>
      </article>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        <NoteFilesPanel noteId={note.id} noteKey={note.noteKey} />

        <aside className="space-y-5">
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Encryption information</h2>
            <dl className="mt-3 space-y-2.5 text-xs">
              <div>
                <dt className="font-semibold text-slate-700 dark:text-slate-200">Cipher</dt>
                <dd className="text-slate-500 dark:text-slate-400">
                  {note.algorithm} · payload v{note.encryptionVersion}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-700 dark:text-slate-200">Your access</dt>
                <dd className="text-slate-500 dark:text-slate-400">
                  {isOwner ? 'Owner - master key unwrap' : 'Recipient - RSA-OAEP wrapped note key'}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-700 dark:text-slate-200">File keys</dt>
                <dd className="text-slate-500 dark:text-slate-400">
                  Wrapped with the note key, so every participant can decrypt attachments
                </dd>
              </div>
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Conversation</h2>
            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {isOwner
                ? activeShares.length === 0
                  ? 'This note is private. Share it to start an encrypted conversation; recipients will see the files too.'
                  : `Shared with ${activeShares.length} ${activeShares.length === 1 ? 'person' : 'people'}. They can read this note and its encrypted files.`
                : `Shared by ${note.owner.displayName}. You hold a per-recipient wrapped key; revocation ends future access immediately.`}
            </p>
          </section>
        </aside>
      </div>

      <div className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-4 text-xs leading-5 text-cyan-900 dark:border-cyan-500/30 dark:bg-cyan-500/5 dark:text-cyan-100/90">
        This plaintext exists only in your browser's memory. The server held the ciphertext shown in the security
        inspector, never the text above.
      </div>

      <ShareNoteModal open={shareOpen} note={note} onClose={() => setShareOpen(false)} onChanged={() => void load()} />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this note?"
        destructive
        busy={deleting}
        confirmLabel="Delete permanently"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        message="The ciphertext, its wrapped key and every share will be removed. Recipients lose access immediately and this cannot be undone."
      />
    </div>
  );
}
