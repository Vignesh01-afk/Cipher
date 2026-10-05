import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilePlus2, Loader2, Lock, ShieldCheck, Trash2, UploadCloud, ArrowLeft, FolderOpen, Inbox } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
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
import { Input } from '../components/Input';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/States';

export function SecureFilesPage(): JSX.Element {
  const { keys, user } = useAuth();
  const toast = useToast();

  const [files, setFiles] = useState<SecureFileDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase, setPhase] = useState<'idle' | 'preparing' | 'encrypting' | 'uploading' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [pendingName, setPendingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [previewFileId, setPreviewFileId] = useState<string | null>(null);
  const [uploadNoteId, setUploadNoteId] = useState<string | null>(null);
  const [uploadNoteKey, setUploadNoteKey] = useState<CryptoKey | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setFiles(await api.listFiles(''));
    } catch (listError) {
      setLoadError(listError instanceof Error ? listError.message : 'Could not load files.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeNote = files.find((f) => f.ownerId === user?.id) ?? null;

  async function handleSelected(file: File): Promise<void> {
    if (!keys) return;
    setError(null);

    setUploadNoteId('');
    setUploadNoteKey(null);
    setPhase('preparing');
    setPendingName(file.name);
    setProgress(0);

    try {
      setPhase('encrypting');
      const prepared = await encryptFileForUpload(file, keys.masterKey);

      const noteWrap = uploadNoteKey
        ? await wrapFileKeyForRecipient(uploadNoteKey, prepared.fileKeyRaw)
        : await wrapFileKeyForRecipient(keys.masterKey, prepared.fileKeyRaw);

      setPhase('uploading');
      const payload = buildFileUploadPayload(prepared, uploadNoteId ?? '');
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
      setPendingName('');
      await load();
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
    <div className="space-y-6">
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Secure files</h1>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              Encrypted attachments for the note that owns them. The server stores ciphertext only.
            </p>
          </div>
          <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={busy || !keys}>
            <FilePlus2 className="h-4 w-4" />
            Attach file
          </Button>
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
      </section>

      {error ? (
        <div className="card">
          <ErrorState title="Upload problem" message={error} />
        </div>
      ) : null}

      {activeNote ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-600 dark:text-brand-300">
              <FolderOpen className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-stone-800 dark:text-stone-100">Note {activeNote.id.slice(0, 12)}…</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">{formatBytes(activeNote.plaintextBytes)} plaintext payload</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setUploadNoteId(activeNote.id)}>
              <Lock className="h-3.5 w-3.5" />
              New file
            </Button>
          </div>
        </div>
      ) : null}

      {phase !== 'idle' ? (
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <UploadCloud className="h-4 w-4 shrink-0 text-orange-700 dark:text-orange-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-100">{pendingName}</p>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {phase === 'preparing' && 'Preparing file…'}
                {phase === 'encrypting' && 'Encrypting locally…'}
                {phase === 'uploading' && `Uploading encrypted file… ${Math.round(progress * 100)}%`}
                {phase === 'done' && 'Securely stored · Sent'}
              </p>
            </div>
            {phase === 'done' ? <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" /> : null}
          </div>
          {phase === 'uploading' ? (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800">
              <div
                className="h-full rounded-full bg-orange-600 transition-[width] duration-150"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="card">
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        </div>
      ) : loadError ? (
        <div className="card">
          <ErrorState title="Could not load files" message={loadError} onRetry={() => void load()} />
        </div>
      ) : files.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Inbox}
            title="No files yet"
            description="Attach an encrypted file to a note and it will be sealed with AES-GCM before upload."
            action={
              <Button variant="primary" onClick={() => inputRef.current?.click()} disabled={!keys}>
                <FilePlus2 className="h-4 w-4" />
                Attach a file
              </Button>
            }
          />
        </div>
      ) : (
        <div className="card p-5">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {files.map((file) => (
              <li
                key={file.id}
                className={`flex flex-wrap items-center gap-3 rounded-2xl border p-4 transition ${previewFileId === file.id ? 'border-brand/30 bg-brand/5' : 'border-white/70 hover:border-white/90 dark:border-white/[0.08] dark:hover:border-white/[0.12]'}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-stone-500 dark:bg-white/[0.06] dark:text-stone-400">
                  <FilePlus2 className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-100">{file.filename}</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {formatBytes(file.plaintextBytes)} · {formatRelativeTime(file.createdAt)} · {file.algorithm}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setPreviewFileId(previewFileId === file.id ? null : file.id)}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Preview
                </button>
                {file.ownerId === user?.id ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10"
                    onClick={() => void handleDelete(file)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {previewFileId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4 backdrop-blur-sm"
          onClick={() => setPreviewFileId(null)}
        >
          <div
            className="card max-w-lg p-6"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            tabIndex={0}
          >
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold text-stone-900 dark:text-white">Secure preview</h2>
              <button
                type="button"
                className="btn btn-ghost p-1.5"
                onClick={() => setPreviewFileId(null)}
                aria-label="Close"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">Preview is available for image, audio and video files.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
