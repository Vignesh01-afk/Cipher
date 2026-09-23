import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderLock } from 'lucide-react';
import { useOwnNotes, useSharedNotes } from '../hooks/useNotes';
import { api } from '../lib/api';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { formatBytes, formatRelativeTime } from '../lib/format';
import { FileKindIcon, FilePreviewModal } from '../components/FilePreviewModal';
import { LoadingBlock } from '../components/Spinner';
import { EmptyState, ErrorState } from '../components/States';
import type { SecureFileDto } from '../lib/types';

/**
 * Vault-wide view of every file you can access: files on your own notes plus
 * files attached to notes shared with you. Each row opens the secure in-app
 * preview (in-memory decrypt, no automatic downloads).
 */
export function SecureFilesPage(): JSX.Element {
  const navigate = useNavigate();
  const { user } = useAuth();
  const own = useOwnNotes();
  const shared = useSharedNotes();

  const [files, setFiles] = useState<SecureFileDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SecureFileDto | null>(null);

  // noteId -> noteKey for recipients (needed to unwrap file keys).
  const noteKeys = useMemo(() => {
    const map = new Map<string, CryptoKey>();
    for (const note of [...own.notes, ...shared.notes]) map.set(note.id, note.noteKey);
    return map;
  }, [own.notes, shared.notes]);

  const noteTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of [...own.notes, ...shared.notes]) map.set(note.id, note.title || 'Untitled note');
    return map;
  }, [own.notes, shared.notes]);

  const noteIds = useMemo(() => [...noteKeys.keys()], [noteKeys]);

  useEffect(() => {
    if (own.loading || shared.loading) return;
    let cancelled = false;

    async function loadAll(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const results = await Promise.all(
          noteIds.map((noteId) => api.listFiles(noteId).catch(() => [] as SecureFileDto[])),
        );
        if (cancelled) return;
        const all = results.flat();
        all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        setFiles(all);
      } catch {
        if (!cancelled) setError('Could not load your files.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [noteIds, own.loading, shared.loading]);

  const notesLoading = own.loading || shared.loading;

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
            <FolderLock className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">Secure files</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              Every file is encrypted in the browser with its own key before upload and stored as ciphertext. Previews
              decrypt in memory only - there is no save or export option by design.
            </p>
          </div>
        </div>
      </section>

      {error ? (
        <ErrorState message={error} />
      ) : notesLoading || loading ? (
        <div className="card">
          <LoadingBlock label="Indexing your encrypted files…" />
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          icon={FolderLock}
          title="No files yet"
          description="Open a note and attach an encrypted file - it will appear here for quick access."
          action={
            <Link to="/notes" className="btn btn-primary">
              Go to your notes
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {files.map((file) => (
              <li key={file.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <FileKindIcon mime={file.mimeType} />
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="block w-full truncate text-left text-sm font-medium text-slate-800 hover:text-cyan-700 dark:text-slate-100 dark:hover:text-cyan-300"
                    onClick={() => setPreview(file)}
                  >
                    {file.filename}
                  </button>
                  <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                    {noteTitles.get(file.noteId) ?? 'Note'} · {formatBytes(file.plaintextBytes)} ·{' '}
                    {formatRelativeTime(file.createdAt)}
                  </p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreview(file)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FilePreviewModal
        file={preview}
        noteKey={preview ? noteKeys.get(preview.noteId) : undefined}
        canDelete={Boolean(preview && preview.ownerId === user?.id)}
        onClose={() => setPreview(null)}
        onDeleted={() => setFiles((current) => current.filter((f) => f.id !== preview?.id))}
      />
    </div>
  );
}
