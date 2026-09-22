import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lock, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ApiError, api } from '../lib/api';
import {
  ENCRYPTION_VERSION,
  NOTE_ALGORITHM,
  encryptNotePayload,
  generateAesKey,
  unwrapNoteKeyFromStorage,
  wrapNoteKeyForStorage,
} from '../lib/crypto';
import { decryptOwnNote } from '../lib/notes';
import { formatBytes } from '../lib/format';
import { TagInput } from '../components/TagInput';
import { LoadingBlock, Spinner } from '../components/Spinner';
import { ErrorState } from '../components/States';

interface NoteEditorPageProps {
  mode: 'create' | 'edit';
}

export function NoteEditorPage({ mode }: NoteEditorPageProps): JSX.Element {
  const { noteId } = useParams<{ noteId: string }>();
  const { keys } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const [loading, setLoading] = useState(mode === 'edit');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastPayloadBytes, setLastPayloadBytes] = useState<number>(0);

  // Load and decrypt the existing note when editing.
  useEffect(() => {
    if (mode !== 'edit' || !noteId || !keys) return;
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      setLoadError(null);
      try {
        const remote = await api.getNote(noteId as string);
        const decrypted = await decryptOwnNote(remote, keys!);
        if (cancelled) return;
        setTitle(decrypted.title);
        setContent(decrypted.content);
        setTags(decrypted.tags);
        setLastPayloadBytes(decrypted.payloadBytes);
      } catch (error) {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiError && error.status === 403
            ? 'You do not have permission to edit this note. Only the owner can re-encrypt it.'
            : error instanceof Error
              ? error.message
              : 'Could not load the note.',
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [mode, noteId, keys]);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!keys || saving) return;

    if (!title.trim() && !content.trim()) {
      setSaveError('Add a title or some content before saving.');
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const payload = { title: title.trim() || 'Untitled note', content, tags };

      if (mode === 'create') {
        // 1. Fresh AES-GCM key for this note.
        const { key: noteKey, raw: noteKeyRaw } = await generateAesKey();
        // 2. Seal the payload in the browser.
        const sealed = await encryptNotePayload(noteKey, payload);
        // 3. Wrap the note key with the owner's master key.
        const wrapped = await wrapNoteKeyForStorage(keys.masterKey, noteKeyRaw);
        // 4. The API only ever receives the blobs below.
        const created = await api.createNote({
          ciphertext: sealed.ciphertext,
          iv: sealed.iv,
          encryptionVersion: ENCRYPTION_VERSION,
          algorithm: NOTE_ALGORITHM,
          payloadBytes: sealed.payloadBytes,
          wrappedNoteKey: wrapped.wrappedNoteKey,
          noteKeyIv: wrapped.noteKeyIv,
        });

        toast.success('Note created', `Encrypted ${formatBytes(sealed.payloadBytes)} with AES-GCM before upload.`);
        navigate(`/notes/${created.id}`, { replace: true });
        return;
      }

      if (!noteId) throw new Error('Missing note id');

      const existing = await api.getNote(noteId);
      if (!existing.wrappedNoteKey || !existing.noteKeyIv) {
        throw new Error('This note has no wrapped key material, so it cannot be re-encrypted here.');
      }

      // The ciphertext is replaced wholesale. The existing note key is reused on
      // purpose: that keeps every share created earlier valid, because each
      // recipient's copy of the key still matches the note.
      const noteKey = await unwrapNoteKeyFromStorage(
        keys.masterKey,
        existing.wrappedNoteKey,
        existing.noteKeyIv,
      );
      const sealed = await encryptNotePayload(noteKey, payload);
      await api.updateNote(noteId, {
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        encryptionVersion: ENCRYPTION_VERSION,
        payloadBytes: sealed.payloadBytes,
      });

      toast.success('Note updated', 'Re-encrypted locally and the new ciphertext was uploaded.');
      navigate(`/notes/${noteId}`, { replace: true });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Saving failed.');
    } finally {
      setSaving(false);
    }
  }

  if (mode === 'edit' && (loading || loadError)) {
    return (
      <div className="space-y-4">
        <Link to="/notes" className="btn btn-ghost btn-sm self-start">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to notes
        </Link>
        {loadError ? (
          <ErrorState title="Could not open this note" message={loadError} />
        ) : (
          <div className="card">
            <LoadingBlock label="Decrypting note…" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link to={mode === 'edit' && noteId ? `/notes/${noteId}` : '/notes'} className="btn btn-ghost btn-sm">
        <ArrowLeft className="h-3.5 w-3.5" />
        Cancel
      </Link>

      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              {mode === 'create' ? 'Create an encrypted note' : 'Edit note'}
            </h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              The title, body and tags are sealed together. Only the ciphertext, nonce and wrapped key are stored.
            </p>
          </div>
          <span className="badge badge-emerald">
            <Lock className="h-3 w-3" />
            AES-GCM-256
          </span>
        </div>

        {saveError ? (
          <div className="mt-4">
            <ErrorState title="Not saved" message={saveError} />
          </div>
        ) : null}

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="title" className="label">
              Title
            </label>
            <input
              id="title"
              type="text"
              className="input"
              placeholder="e.g. Q3 incident review"
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={saving}
            />
          </div>

          <div>
            <label htmlFor="content" className="label">
              Content
            </label>
            <textarea
              id="content"
              className="textarea min-h-[320px] font-mono text-[13px]"
              placeholder="Write anything. It is encrypted before it leaves this device."
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={saving}
            />
            <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
              {content.length} characters · {content.trim() ? content.trim().split(/\s+/).length : 0} words
              {lastPayloadBytes > 0 ? ` · last stored payload ${formatBytes(lastPayloadBytes)}` : ''}
            </p>
          </div>

          <div>
            <label className="label">Tags</label>
            <TagInput value={tags} onChange={setTags} disabled={saving} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/60">
            <p className="flex items-start gap-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
              On save, a payload is built, sealed with AES-GCM using a unique nonce, and the key is wrapped with your
              master key. {mode === 'edit' ? 'Sharing stays intact because the same note key is reused.' : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link to={mode === 'edit' && noteId ? `/notes/${noteId}` : '/notes'} className="btn btn-secondary">
              Cancel
            </Link>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <Spinner /> : mode === 'create' ? <Save className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
              {saving
                ? 'Encrypting and saving…'
                : mode === 'create'
                  ? 'Encrypt and save'
                  : 'Re-encrypt and save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
