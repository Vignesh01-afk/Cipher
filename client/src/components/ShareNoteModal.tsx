import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Search, Share2, ShieldOff, UserCheck, Users } from 'lucide-react';
import { Modal } from './Modal';
import { ConfirmDialog } from './ConfirmDialog';
import { Spinner } from './Spinner';
import { ErrorState } from './States';
import { ApiError, api } from '../lib/api';
import { buildWrappedKeyForRecipient, type DecryptedNote } from '../lib/notes';
import { formatRelativeTime, truncate } from '../lib/format';
import { useToast } from '../context/ToastContext';
import type { PublicProfile, ShareDto } from '../lib/types';

interface ShareNoteModalProps {
  open: boolean;
  note: DecryptedNote | null;
  onClose: () => void;
  /** Fired after a successful share or revocation so callers can refresh. */
  onChanged?: () => void;
}

export function ShareNoteModal({ open, note, onClose, onChanged }: ShareNoteModalProps): JSX.Element {
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [candidate, setCandidate] = useState<PublicProfile | null>(null);
  const [shares, setShares] = useState<ShareDto[]>([]);
  const [loadingShares, setLoadingShares] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ShareDto | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noteId = note?.id ?? null;

  const loadShares = useCallback(async () => {
    if (!noteId) return;
    setLoadingShares(true);
    setError(null);
    try {
      setShares(await api.listShares(noteId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the share list.');
    } finally {
      setLoadingShares(false);
    }
  }, [noteId]);

  useEffect(() => {
    if (!open) {
      setEmail('');
      setCandidate(null);
      setShares([]);
      setError(null);
      return;
    }
    void loadShares();
  }, [open, loadShares]);

  async function handleLookup(): Promise<void> {
    const value = email.trim();
    if (!value) return;

    setLookingUp(true);
    setError(null);
    setCandidate(null);
    try {
      const found = await api.lookUpUser(value);
      if (note && found.id === note.ownerId) {
        setError('That is your own account - you already own this note.');
        return;
      }
      setCandidate(found);
    } catch (lookupError) {
      setError(
        lookupError instanceof ApiError && lookupError.status === 404
          ? 'No CipherNote account uses that email address.'
          : lookupError instanceof Error
            ? lookupError.message
            : 'Lookup failed.',
      );
    } finally {
      setLookingUp(false);
    }
  }

  async function handleShare(): Promise<void> {
    if (!note || !candidate) return;

    setSharing(true);
    setError(null);
    try {
      // The note key is unwrapped in memory already; wrap it to the recipient's
      // public key right here so the key never leaves the browser in the clear.
      const wrappedKey = await buildWrappedKeyForRecipient(note, candidate.publicKey);
      await api.createShare(note.id, candidate.id, wrappedKey);

      toast.success(
        `Note shared with ${candidate.displayName}`,
        'The note key was wrapped with their public key. Only their private key can unwrap it.',
      );
      setCandidate(null);
      setEmail('');
      await loadShares();
      onChanged?.();
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : 'Sharing failed.');
    } finally {
      setSharing(false);
    }
  }

  async function handleRevoke(): Promise<void> {
    if (!note || !revokeTarget) return;

    setRevoking(true);
    try {
      await api.revokeShare(note.id, revokeTarget.sharedWithId);
      toast.success(
        `Access revoked for ${revokeTarget.recipient.displayName}`,
        'Future requests for this note are rejected and the action is recorded in the audit log.',
      );
      setRevokeTarget(null);
      await loadShares();
      onChanged?.();
    } catch (revokeError) {
      toast.error('Could not revoke access', revokeError instanceof Error ? revokeError.message : undefined);
    } finally {
      setRevoking(false);
    }
  }

  const activeShares = shares.filter((share) => share.isActive);
  const revokedShares = shares.filter((share) => !share.isActive);

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={note ? `Share "${note.title || 'Untitled note'}"` : 'Share note'}
        description="Recipients receive the note key wrapped with their own public key. The server only ever sees that wrapped copy."
        size="lg"
      >
        {!note ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Select a note to share.</p>
        ) : (
          <div className="space-y-6">
            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                <Search className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                Grant access
              </h3>

              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  className="input"
                  placeholder="recipient@example.com"
                  value={email}
                  disabled={sharing}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setCandidate(null);
                    setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void handleLookup();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary shrink-0"
                  onClick={() => void handleLookup()}
                  disabled={lookingUp || sharing || !email.trim()}
                >
                  {lookingUp ? <Spinner /> : <Search className="h-4 w-4" />}
                  Look up
                </button>
              </div>

              {candidate ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/5">
                  <div className="flex min-w-0 items-center gap-3">
                    <UserCheck className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {candidate.displayName}
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{candidate.email}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleShare()}
                    disabled={sharing}
                  >
                    {sharing ? <Spinner className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                    Encrypt key &amp; share
                  </button>
                </div>
              ) : null}

              {error ? (
                <div className="mt-3">
                  <ErrorState title="Sharing problem" message={error} />
                </div>
              ) : null}
            </section>

            <section>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                <Users className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                People with access
                <span className="badge badge-slate">{activeShares.length}</span>
              </h3>

              {loadingShares ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <Spinner /> Loading shares…
                </div>
              ) : activeShares.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                  This note has not been shared with anyone yet.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
                  {activeShares.map((share) => (
                    <li key={share.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {share.recipient.displayName}
                        </p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{share.recipient.email}</p>
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                          <KeyRound className="h-3 w-3" />
                          {share.keyAlgorithm} · granted {formatRelativeTime(share.createdAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10"
                        onClick={() => setRevokeTarget(share)}
                      >
                        <ShieldOff className="h-3.5 w-3.5" />
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {revokedShares.length > 0 ? (
              <section>
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Revoked access</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Kept for the audit trail. These shares no longer authorise any request; a revoked recipient keeps
                  a copy of anything they already opened or exported before revocation.
                </p>
                <ul className="mt-3 space-y-2">
                  {revokedShares.map((share) => (
                    <li
                      key={share.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-600 line-through dark:text-slate-400">
                          {truncate(share.recipient.email, 42)}
                        </p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">
                          revoked {share.revokedAt ? formatRelativeTime(share.revokedAt) : ''}
                        </p>
                      </div>
                      <span className="badge badge-rose">Revoked</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="Revoke access"
        destructive
        busy={revoking}
        confirmLabel="Revoke access"
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => void handleRevoke()}
        message={
          <div className="space-y-3">
            <p>
              <strong className="font-semibold text-slate-800 dark:text-slate-100">
                {revokeTarget?.recipient.displayName}
              </strong>{' '}
              will immediately stop being able to load this note. Every future request is rejected by the API and
              the revocation is written to your audit log.
            </p>
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              Revocation changes access control, not physics. Anything they already decrypted, copied or exported
              before this moment cannot be taken back, and the note key they hold would still open the current
              ciphertext.
            </p>
          </div>
        }
      />
    </>
  );
}
