import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { File as FileIcon, FileText, Film, Image as ImageIcon, Music, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { downloadAndDecryptFile, type SecureFileWithNoteKey } from '../lib/files';
import { formatBytes, formatDateTime } from '../lib/format';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { ErrorState } from './States';

/**
 * Secure file viewer.
 *
 * - Downloads ciphertext via the authorised endpoint and decrypts it in memory.
 * - Creates an in-memory object URL for preview only. There is deliberately
 *   NO save/export affordance: decrypted bytes never touch the disk from here.
 * - The object URL is revoked and state cleared on close or on unmount.
 */
export function FilePreviewModal({
  file,
  noteKey,
  canDelete,
  onClose,
  onDeleted,
}: {
  file: SecureFileWithNoteKey | null;
  noteKey?: CryptoKey;
  canDelete: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}): JSX.Element | null {
  const { keys } = useAuth();
  const toast = useToast();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const revoke = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setBlobUrl(null);
  }, []);

  useEffect(() => {
    if (!file || !keys) {
      revoke();
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    downloadAndDecryptFile(file, keys, noteKey)
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setBlobUrl(url);
      })
      .catch((downloadError: unknown) => {
        if (cancelled) return;
        setError(downloadError instanceof Error ? downloadError.message : 'Could not decrypt this file.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      revoke();
    };
  }, [file, keys, noteKey, revoke]);

  async function handleDelete(): Promise<void> {
    if (!file) return;
    try {
      await api.deleteFile(file.id);
      toast.success('File deleted', 'The encrypted blob was removed from the server.');
      revoke();
      onDeleted?.();
      onClose();
    } catch (deleteError) {
      toast.error('Could not delete the file', deleteError instanceof Error ? deleteError.message : undefined);
    }
  }

  if (!file) return null;

  const mime = file.mimeType || 'application/octet-stream';
  const kind: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other' = mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : mime.startsWith('audio/')
        ? 'audio'
        : mime === 'application/pdf'
          ? 'pdf'
          : mime.startsWith('text/')
            ? 'text'
            : 'other';

  return (
    <Modal
      open
      onClose={onClose}
      title={file.filename}
      description={`${formatBytes(file.plaintextBytes)} · decrypted in memory only`}
      size="lg"
      footer={
        <>
          {canDelete ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => void handleDelete()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          ) : null}
        </>
      }
    >
      {loading ? (
        <div className="flex flex-col items-center gap-3 py-10 text-sm text-slate-500 dark:text-slate-400">
          <Spinner className="h-5 w-5" />
          Downloading and decrypting in memory…
        </div>
      ) : error ? (
        <ErrorState title="Could not open this file" message={error} />
      ) : blobUrl && kind === 'image' ? (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-950/5 dark:border-slate-800 dark:bg-slate-950/40">
          <img
            src={blobUrl}
            alt={file.filename}
            className="mx-auto max-h-[60vh] w-auto select-none"
            draggable={false}
            onContextMenu={(event) => event.preventDefault()}
          />
        </div>
      ) : blobUrl && kind === 'video' ? (
        <video src={blobUrl} controls className="mx-auto max-h-[60vh] w-full rounded-lg" />
      ) : blobUrl && kind === 'audio' ? (
        <audio src={blobUrl} controls className="w-full" />
      ) : blobUrl && kind === 'pdf' ? (
        <iframe title={file.filename} src={blobUrl} className="h-[60vh] w-full rounded-lg border border-slate-200 dark:border-slate-800" />
      ) : blobUrl && kind === 'text' ? (
        <iframe title={file.filename} src={blobUrl} className="h-[50vh] w-full rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950" />
      ) : blobUrl ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <FileIcon className="h-6 w-6" />
          </span>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            No in-app preview is available for <span className="font-mono text-xs">{mime}</span>.
          </p>
          <p className="max-w-sm text-xs text-slate-500 dark:text-slate-400">
            Export is disabled for security: the decrypted bytes only exist in this tab's memory and are never written to disk.
          </p>
        </div>
      ) : null}

      <p className="mt-4 flex items-start gap-2 rounded-lg border border-cyan-200 bg-cyan-50/60 p-3 text-xs leading-5 text-cyan-900 dark:border-cyan-500/30 dark:bg-cyan-500/5 dark:text-cyan-100/90">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        This preview came from ciphertext that was decrypted inside your browser. The server never saw the plaintext.
      </p>
    </Modal>
  );
}

/** Small icon by MIME family, used in file lists. */
export function FileKindIcon({ mime, className = 'h-4 w-4' }: { mime: string; className?: string }): JSX.Element {
  if (mime.startsWith('image/')) return <ImageIcon className={className} />;
  if (mime.startsWith('video/')) return <Film className={className} />;
  if (mime.startsWith('audio/')) return <Music className={className} />;
  if (mime === 'application/pdf' || mime.startsWith('text/')) return <FileText className={className} />;
  return <FileIcon className={className} />;
}
