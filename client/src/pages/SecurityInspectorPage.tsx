import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, KeyRound, Lock, Server, ShieldCheck, Unlock, Copy } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { decryptOwnNote, decryptSharedNote, type DecryptedNote } from '../lib/notes';
import { formatBytes, formatDateTime } from '../lib/format';
import { Input } from '../components/Input';
import { Badge } from '../components/Badge';
import { Spinner } from '../components/Spinner';
import { SkeletonText } from '../components/Skeleton';
import { ErrorState } from '../components/States';

export function SecurityInspectorPage(): JSX.Element {
  const { noteId } = useParams<{ noteId: string }>();
  const { keys } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [note, setNote] = useState<DecryptedNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copyToClipboard = async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      toast.success('Copied');
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error('Could not copy');
    }
  };

  const load = useCallback(async () => {
    if (!noteId || !keys) return;
    setLoading(true);
    setError(null);
    try {
      const remote = await api.getNote(noteId);
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
      if (loadError instanceof Error) {
        setError(
          loadError.message.includes('404')
            ? 'Note not found.'
            : loadError.message.includes('403')
              ? 'Access denied.'
              : loadError.message,
        );
      } else {
        setError('Could not load this note.');
      }
    } finally {
      setLoading(false);
    }
  }, [noteId, keys]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="card">
          <div className="flex items-center justify-between">
            <div className="skeleton h-6 w-32" />
            <div className="skeleton h-10 w-24 rounded-full" />
          </div>
          <SkeletonText lines={6} />
        </div>
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/notes')}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to notes
        </button>
        <ErrorState
          title="Could not inspect this note"
          message={error ?? 'This note could not be loaded.'}
          onRetry={() => void load()}
        />
      </div>
    );
  }

  const isOwner = note.role === 'owner';
  const activeShares = note.shares.filter((share) => share.isActive);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/notes')}>
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to notes
        </button>
        <Badge variant="brand">Inspector</Badge>
      </div>

      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-stone-900 dark:text-white">
              Security Inspector
            </h1>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              Read-only metadata about this note. Nothing here exposes keys, passwords or secrets.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-800 dark:text-stone-100">
              <Lock className="h-4 w-4 text-orange-700 dark:text-orange-500" />
              Encryption
            </h2>
            <div className="space-y-2 text-sm text-stone-600 dark:text-stone-300">
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">Algorithm</span>
                <span className="font-medium text-stone-800 dark:text-stone-100">{note.algorithm}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">Payload version</span>
                <span className="font-medium text-stone-800 dark:text-stone-100">v{note.encryptionVersion}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">Payload size</span>
                <span className="font-medium text-stone-800 dark:text-stone-100">{formatBytes(note.payloadBytes)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">IV (base64)</span>
                <button
                  type="button"
                  className="text-xs font-medium text-brand hover:underline"
                  onClick={() => copyToClipboard(note.iv, 'iv')}
                >
                  {copied === 'iv' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-800 dark:text-stone-100">
              <Server className="h-4 w-4 text-orange-700 dark:text-orange-500" />
              Server-side
            </h2>
            <div className="space-y-2 text-sm text-stone-600 dark:text-stone-300">
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">Note ID</span>
                <span className="font-mono text-xs text-stone-800 dark:text-stone-100">{note.id.slice(0, 16)}…</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">Owner</span>
                <span className="font-medium text-stone-800 dark:text-stone-100">{note.owner.displayName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">Created</span>
                <span className="text-xs text-stone-500 dark:text-stone-400">{formatDateTime(note.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">Updated</span>
                <span className="text-xs text-stone-500 dark:text-stone-400">{formatDateTime(note.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-800 dark:text-stone-100">
              <Unlock className="h-4 w-4 text-orange-700 dark:text-orange-500" />
              {isOwner ? 'Owner access' : 'Recipient access'}
            </h2>
            <div className="space-y-2 text-sm text-stone-600 dark:text-stone-300">
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">How you can read this note</span>
                <span className="font-medium text-stone-800 dark:text-stone-100">
                  {isOwner ? 'Local decryption with your master key' : 'Local decryption with your private key'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">Note key origin</span>
                <span className="font-mono text-xs text-stone-600 dark:text-stone-300">
                  {isOwner ? 'wrapped with your master key' : 'RSA-OAEP to your public key'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">Recipients</span>
                <span className="text-xs text-stone-500 dark:text-stone-400">
                  {isOwner
                    ? activeShares.length === 0
                      ? 'Not shared'
                      : `${activeShares.length} ${activeShares.length === 1 ? 'person' : 'people'}`
                    : 'N/A'}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-800 dark:text-stone-100">
              <ShieldCheck className="h-4 w-4 text-orange-700 dark:text-orange-500" />
              Integrity
            </h2>
            <div className="space-y-2 text-sm text-stone-600 dark:text-stone-300">
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">Decryption</span>
                <Badge variant="success">Authenticated on decrypt</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">Ciphertext</span>
                <span className="font-mono text-xs text-stone-600 dark:text-stone-300">
                  {note.ciphertext.slice(0, 16)}…
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-stone-500 dark:text-stone-400">AES-GCM</span>
                <Badge variant="emerald">Authenticated encryption</Badge>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm leading-6 text-amber-900 dark:border-amber-600/30 dark:bg-amber-500/5 dark:text-amber-100/90">
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This inspector shows read-only metadata that is already public to this account. It contains no private
              key, password, raw authentication secret or sensitive token. The actual plaintext only existed in this
              browser's memory and was never sent to the server.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
