import { useCallback, useEffect, useRef, useState } from 'react';
import { FilePlus2, Loader2, Lock, ShieldCheck, Trash2, UploadCloud } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  buildFileUploadPayload,
  encryptFileForUpload,
  uploadFileWithProgress,
  wrapFileKeyForRecipient,
  exportFileKey,
  FileTooLargeError,
  type SecureFileWithNoteKey,
} from '../lib/files';
import type { SecureFileDto } from '../lib/types';
import { formatBytes, formatRelativeTime } from '../lib/format';
import { FileKindIcon } from './FilePreviewModal';
import { FilePreviewModal } from './FilePreviewModal';

type UploadPhase = 'idle' | 'preparing' | 'encrypting' | 'uploading' | 'done';

/**
 * File attachment panel for one note.
 *
 * Implements the full upload experience:
 *   Preparing → Encrypting locally → Uploading encrypted file → Securely stored
 * with real progress, then a "Sent" confirmation. Recipients see the same list
 * and decrypt with the note key from their share - no extra sharing flow.
 */
export function NoteFilesPanel({ noteId, noteKey }: { noteId: string; noteKey?: CryptoKey }): JSX.Element {
  const { keys, user } = useAuth();
  const toast = useToast();

  const [files, setFiles] = useState<SecureFileDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [pendingName, setPendingName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [previewFile, setPreviewFile] = useState<SecureFileDto | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isOwner = Boolean(user && files.some((f) => f.ownerId === user.id) === true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setFiles(await api.listFiles(noteId));
    } catch (listError) {
      setLoadError(listError instanceof Error ? listError.message : 'Could not load files.');
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSelected(file: File): Promise<void> {
    if (!keys) return;
    setError(null);

    setPhase('preparing');
    setPendingName(file.name);
    setProgress(0);

    try {
      setPhase('encrypting');
      const prepared = await encryptFileForUpload(file, keys.masterKey);

      // Wrap a second copy of the file key with the note key so every note
      // participant (owner and share recipients) can unwrap it.
      const noteWrap = noteKey
        ? await wrapFileKeyForRecipient(noteKey, prepared.fileKeyRaw)
        : await wrapFileKeyForRecipient(keys.masterKey, prepared.fileKeyRaw);

      setPhase('uploading');
      const payload = buildFileUploadPayload(prepared, noteId);
      await uploadFileWithProgress(
        {
          ...payload,
          wrappedForNoteKey: noteWrap.wrappedFileKey,
          noteKeyWrapIv: noteWrap.fileKeyIv,
        },
        setProgress,
      );

      setPhase('done');
      toast.success('Securely stored', `${file.name} was encrypted locally and uploaded.`);
      await load();
      window.setTimeout(() => {
        setPhase('idle');
        setPendingName('');
      }, 1200);
    } catch (uploadError) {
      setPhase('idle');
      setPendingName('');
      if (uploadError instanceof FileTooLargeError) {
        setError(uploadError.message);
      } else {
        setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
      }
    }
  }

  async function handleDelete(file: SecureFileDto): Promise<void> {
    try {
      await api.deleteFile(file.id);
      toast.success('File deleted', 'The encrypted blob was removed from the server.');
      await load();
    } catch (deleteError) {
      toast.error('Could not delete the file', deleteError instanceof Error ? deleteError.message : undefined);
    }
  }

  const busy = phase !== 'idle' && phase !== 'done';

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
          <ShieldCheck className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          Secure files
        </h2>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy || !keys}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FilePlus2 className="h-3.5 w-3.5" />}
          Attach encrypted file
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = '';
            if (selected) void handleSelected(selected);
          }}
        />
      </div>

      <p className="mt-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
        Files are sealed with AES-GCM-256 in this browser before upload. The server stores ciphertext only.
      </p>

      {/* Upload experience */}
      {phase !== 'idle' ? (
        <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50/60 p-4 dark:border-cyan-500/30 dark:bg-cyan-500/5">
          <div className="flex items-center gap-3">
            <UploadCloud className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{pendingName}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {phase === 'preparing' && 'Preparing file…'}
                {phase === 'encrypting' && 'Encrypting locally…'}
                {phase === 'uploading' && `Uploading encrypted file… ${Math.round(progress * 100)}%`}
                {phase === 'done' && 'Securely stored · Sent'}
              </p>
            </div>
            {phase === 'done' ? <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" /> : null}
          </div>
          {phase === 'uploading' ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-cyan-500 transition-[width] duration-150"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/5 dark:text-rose-300">
          {error}
        </p>
      ) : null}

      {loadError ? (
        <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">{loadError}</p>
      ) : loading ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading files…
        </p>
      ) : files.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No files attached yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-800">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-3 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <FileKindIcon mime={file.mimeType} />
              </span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="block w-full truncate text-left text-sm font-medium text-slate-800 hover:text-cyan-700 dark:text-slate-100 dark:hover:text-cyan-300"
                  onClick={() => setPreviewFile(file)}
                  title="Open secure preview"
                >
                  {file.filename}
                </button>
                <p className="flex items-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
                  <Lock className="h-3 w-3" />
                  {formatBytes(file.plaintextBytes)} · {formatRelativeTime(file.createdAt)} · {file.algorithm}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setPreviewFile(file)}
              >
                Open
              </button>
              {file.ownerId === user?.id ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10"
                  onClick={() => void handleDelete(file)}
                  aria-label={`Delete ${file.filename}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <FilePreviewModal
        file={previewFile}
        noteKey={noteKey}
        canDelete={Boolean(previewFile && previewFile.ownerId === user?.id)}
        onClose={() => setPreviewFile(null)}
        onDeleted={() => void load()}
      />
    </section>
  );
}
