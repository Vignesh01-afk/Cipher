import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilePlus, ShieldCheck, Trash, CloudArrowUp, FolderOpen } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useOwnNotes } from '../hooks/useNotes';
import { api } from '../lib/api';
import {
  encryptFileForUpload,
  uploadEncryptedFile,
  wrapFileKeyForRecipient,
  FileTooLargeError,
} from '../lib/files';
import type { SecureFileDto } from '../lib/types';
import { formatBytes, formatRelativeTime } from '../lib/format';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/States';
import { FilePreviewModal, FileKindIcon } from '../components/FilePreviewModal';

/**
 * Every encrypted file this account has uploaded, across all of its notes.
 *
 * A file always belongs to a note (that is what grants recipients access to
 * it), so uploading here requires picking one of your own notes first - the
 * note key wraps the file key. Files on notes shared with you are not listed:
 * they live in the note's own attachment panel.
 */
export function SecureFilesPage(): React.ReactElement {
  const { keys, user } = useAuth();
  const toast = useToast();
  const { notes, loading: notesLoading, error: notesError } = useOwnNotes();

  const [files, setFiles] = useState<SecureFileDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [phase, setPhase] = useState<'idle' | 'preparing' | 'encrypting' | 'uploading' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [pendingName, setPendingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [previewFile, setPreviewFile] = useState<SecureFileDto | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const selectedNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [notes, selectedNoteId],
  );

  // Default to the most recently updated note so the common case is one click.
  useEffect(() => {
    if (!selectedNoteId && notes.length > 0) setSelectedNoteId(notes[0]!.id);
  }, [notes, selectedNoteId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setFiles(await api.listAllFiles());
    } catch (listError) {
      setLoadError(listError instanceof Error ? listError.message : 'Could not load files.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSelected(file: File): Promise<void> {
    if (!keys) return;
    if (!selectedNote) {
      setError('Choose one of your notes to attach this file to.');
      return;
    }

    setError(null);
    setPhase('preparing');
    setPendingName(file.name);
    setProgress(0);

    try {
      setPhase('encrypting');
      const prepared = await encryptFileForUpload(file, keys.masterKey);

      // Wrap the file key with the note key so the note's share recipients can
      // unwrap it too - the existing note share grants file access.
      const noteWrap = await wrapFileKeyForRecipient(selectedNote.noteKey, prepared.fileKeyRaw);

      setPhase('uploading');
      await uploadEncryptedFile(
        prepared,
        {
          noteId: selectedNote.id,
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
  const noteKeysById = useMemo(
    () => new Map(notes.map((note) => [note.id, note.noteKey])),
    [notes],
  );
  const ownedNoteIds = useMemo(() => new Set(notes.map((note) => note.id)), [notes]);

  return (
    <div className="space-y-6">
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Secure files</h1>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              Encrypted attachments for notes you own. The server stores ciphertext only.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="secure-files-note">
              Note to attach the file to
            </label>
            <select
              id="secure-files-note"
              className="input max-w-[16rem]"
              value={selectedNoteId}
              onChange={(event) => setSelectedNoteId(event.target.value)}
              disabled={busy || notesLoading || notes.length === 0}
            >
              {notes.length === 0 ? (
                <option value="">{notesLoading ? 'Loading notes…' : 'No notes yet'}</option>
              ) : (
                notes.map((note) => (
                  <option key={note.id} value={note.id}>
                    {note.title || 'Untitled note'}
                  </option>
                ))
              )}
            </select>
            <Button
              variant="primary"
              onClick={() => inputRef.current?.click()}
              disabled={busy || !keys || !selectedNote}
            >
              <FilePlus className="h-4 w-4" />
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
        </div>
        {notesError ? (
          <p className="mt-3 text-xs text-rose-600 dark:text-rose-400">
            Your notes could not be loaded, so uploads are unavailable: {notesError}
          </p>
        ) : notes.length === 0 && !notesLoading ? (
          <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
            Create a note first, every encrypted file belongs to one of your notes.
          </p>
        ) : null}
      </section>

      {error ? (
        <div className="card">
          <ErrorState title="Upload problem" message={error} />
        </div>
      ) : null}

      {phase !== 'idle' ? (
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <CloudArrowUp className="h-4 w-4 shrink-0 text-orange-700 dark:text-orange-500" />
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
            <div className="mt-3 h-1.5 overflow-hidden rounded-md bg-stone-200 dark:bg-stone-800">
              <div
                className="h-full rounded-md bg-orange-600  "
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
            icon={FolderOpen}
            title="No files yet"
            description="Attach an encrypted file to one of your notes and it will be sealed with AES-GCM before upload."
            action={
              <Button
                variant="primary"
                onClick={() => inputRef.current?.click()}
                disabled={!keys || !selectedNote}
              >
                <FilePlus className="h-4 w-4" />
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
                className="flex flex-wrap items-center gap-3 rounded-md border border-white/70 p-4  hover:border-white/90 dark:border-white/[0.08] dark:hover:border-white/[0.12]"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-stone-100 text-stone-500 dark:bg-surface/[0.06] dark:text-stone-400">
                  <FileKindIcon mime={file.mimeType} />
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
                  onClick={() => setPreviewFile(file)}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Preview
                </button>
                {file.ownerId === user?.id || ownedNoteIds.has(file.noteId) ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10"
                    onClick={() => void handleDelete(file)}
                  >
                    <Trash className="h-3.5 w-3.5" />
                    Delete
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <FilePreviewModal
        file={previewFile}
        noteKey={previewFile ? noteKeysById.get(previewFile.noteId) : undefined}
        canDelete={Boolean(
          previewFile && (previewFile.ownerId === user?.id || ownedNoteIds.has(previewFile.noteId)),
        )}
        onClose={() => setPreviewFile(null)}
        onDeleted={() => void load()}
      />
    </div>
  );
}
