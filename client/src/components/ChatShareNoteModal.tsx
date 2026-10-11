import { useEffect, useMemo, useState } from 'react';
import { FileText, MagnifyingGlass, ShareNetwork } from '@phosphor-icons/react';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { ErrorState } from './States';
import { useOwnNotes } from '../hooks/useNotes';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { buildWrappedKeyForRecipient } from '../lib/notes';
import { formatRelativeTime } from '../lib/format';
import { chatPublicKeyCache } from '../lib/chatKeys';

interface ChatShareNoteModalProps {
  open: boolean;
  onClose: () => void;
  /** The conversation to drop the share card into. */
  conversationId: string | null;
  /** The peer who will receive the share. */
  peer: { id: string; displayName: string } | null;
  /** Sends the encrypted card after the share succeeds. */
  onSendCard: (payload: { noteId: string; title: string }) => Promise<void>;
}

/**
 * "Share Note" from inside a chat. Reuses the existing encrypted sharing
 * mechanism (note key RSA-wrapped to the recipient's public key) and then
 * sends an encrypted chat card carrying metadata only - the note content
 * itself is never in the message.
 */
export function ChatShareNoteModal({
  open,
  onClose,
  conversationId,
  peer,
  onSendCard,
}: ChatShareNoteModalProps): React.ReactElement {
  const { keys, user } = useAuth();
  const toast = useToast();
  const own = useOwnNotes();

  const [query, setQuery] = useState('');
  const [sharingNoteId, setSharingNoteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setError(null);
      own.reload();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = own.notes.filter((n) => n.role === 'owner');
    if (!q) return list;
    return list.filter(
      (n) => n.title.toLowerCase().includes(q) || n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [own.notes, query]);

  async function share(noteId: string, title: string): Promise<void> {
    if (!keys || !peer || !conversationId) return;
    setSharingNoteId(noteId);
    setError(null);
    try {
      const note = own.notes.find((n) => n.id === noteId);
      if (!note) throw new Error('That note is no longer available.');

      const publicKey = chatPublicKeyCache.get(peer.id);
      if (!publicKey) {
        throw new Error('The recipient public key is not cached yet. Reopen the conversation and try again.');
      }

      // 1. Existing encrypted sharing mechanism (key wrap + server-side share).
      const wrappedKey = await buildWrappedKeyForRecipient(note, publicKey);
      await api.createShare(note.id, peer.id, wrappedKey);

      // 2. Encrypted share-card message into the chat (metadata only).
      await onSendCard({ noteId, title });

      toast.success(`Note shared with ${peer.displayName}`, 'The note key was wrapped with their public key and a secure card was sent to the chat.');
      onClose();
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : 'Sharing failed.');
    } finally {
      setSharingNoteId(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Share a note in this chat"
      description={peer ? `Recipient: ${peer.displayName}. The note stays encrypted; the chat only carries a card.` : undefined}
    >
      <div className="space-y-3">
        <div className="relative">
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            autoFocus
            type="search"
            className="input pl-10"
            placeholder="Search your notes"
            aria-label="Search your notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {error ? <ErrorState title="Could not share" message={error} /> : null}

        {own.loading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-stone-500 dark:text-stone-400">
            {query ? 'No notes match that search.' : 'You have no notes to share yet.'}
          </p>
        ) : (
          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {visible.map((note) => (
              <li
                key={note.id}
                className="flex items-center gap-3 rounded-md border border-orange-100 p-3 dark:border-white/[0.06]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-[#4A6CF7] dark:bg-[#6366F1]/15">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-stone-900 dark:text-stone-50">
                    {note.title || 'Untitled note'}
                  </p>
                  <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                    Updated {formatRelativeTime(note.updatedAt)}
                    {user?.id === note.ownerId ? '' : ' · shared with you'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={sharingNoteId !== null}
                  onClick={() => void share(note.id, note.title)}
                >
                  {sharingNoteId === note.id ? <Spinner /> : <ShareNetwork className="h-3.5 w-3.5" />}
                  Share
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
