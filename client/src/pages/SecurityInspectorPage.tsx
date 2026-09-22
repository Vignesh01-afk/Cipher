import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Check,
  ClipboardCopy,
  EyeOff,
  FileText,
  Info,
  KeyRound,
  Lock,
  ShieldCheck,
  ShieldOff,
  Unlock,
  Users,
} from 'lucide-react';
import { useOwnNotes, useSharedNotes } from '../hooks/useNotes';
import type { DecryptedNote } from '../lib/notes';
import { formatBytes, formatDateTime, shortenId } from '../lib/format';
import { LoadingBlock } from '../components/Spinner';
import { EmptyState, ErrorState } from '../components/States';

const CIPHERTEXT_PREVIEW_CHARS = 320;

interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
  hint?: string;
}

function DetailRow({ label, value, mono = false, copyable = false, hint }: DetailRowProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="border-b border-slate-200 py-3 last:border-b-0 dark:border-slate-800">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1.5 flex items-start gap-2">
        <span className={`min-w-0 flex-1 break-all text-sm text-slate-700 dark:text-slate-200 ${mono ? 'font-mono text-xs' : ''}`}>
          {value}
        </span>
        {copyable ? (
          <button
            type="button"
            onClick={() => void copy()}
            className="btn btn-ghost shrink-0 p-1.5"
            title={`Copy ${label}`}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </dd>
      {hint ? <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function SecurityInspectorPage(): JSX.Element {
  const { noteId } = useParams<{ noteId: string }>();
  const navigate = useNavigate();
  const own = useOwnNotes();
  const shared = useSharedNotes();

  const allNotes = useMemo(() => [...own.notes, ...shared.notes], [own.notes, shared.notes]);
  const [manualSelection, setManualSelection] = useState<string | null>(null);

  const selected: DecryptedNote | null = useMemo(() => {
    const targetId = noteId ?? manualSelection;
    if (targetId) {
      const found = allNotes.find((note) => note.id === targetId);
      if (found) return found;
    }
    return allNotes[0] ?? null;
  }, [noteId, manualSelection, allNotes]);

  const loading = own.loading || shared.loading;
  const error = own.error ?? shared.error;

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-600/10 text-cyan-600 dark:text-cyan-400">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">Security inspector</h2>
              <p className="mt-0.5 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
                Safe, technical facts about one note: identifiers, algorithm choices, the nonce and a ciphertext
                preview. It deliberately never displays passwords, private keys, master keys or note key material.
              </p>
            </div>
          </div>
          {selected ? (
            <Link to={`/notes/${selected.id}`} className="btn btn-secondary btn-sm">
              <FileText className="h-3.5 w-3.5" />
              Open note
            </Link>
          ) : null}
        </div>
      </section>

      {error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            void own.reload();
            void shared.reload();
          }}
        />
      ) : loading ? (
        <div className="card">
          <LoadingBlock label="Decrypting notes so the inspector can describe them…" />
        </div>
      ) : allNotes.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nothing to inspect yet"
          description="Create a note (or receive a share) and its encryption metadata will show up here."
          action={
            <Link to="/notes/new" className="btn btn-primary">
              Create a note
            </Link>
          }
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          {/* Note picker */}
          <section className="card h-fit p-4">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Select a note ({allNotes.length})
            </h3>
            <ul className="mt-3 max-h-[32rem] space-y-1 overflow-y-auto pr-1">
              {allNotes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setManualSelection(note.id);
                      navigate(`/inspector/${note.id}`, { replace: true });
                    }}
                    className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                      selected?.id === note.id
                        ? 'bg-cyan-600/10 text-cyan-800 dark:bg-cyan-500/10 dark:text-cyan-200'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {note.role === 'owner' ? (
                        <Lock className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400" />
                      ) : (
                        <Unlock className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
                      )}
                      <span className="truncate text-sm font-medium">{note.title || 'Untitled note'}</span>
                    </span>
                    <span className="mt-1 block truncate font-mono text-[11px] text-slate-400 dark:text-slate-500">
                      {shortenId(note.id, 12, 6)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {/* Details */}
          {selected ? (
            <div className="space-y-6">
              <section className="card p-5">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {selected.title || 'Untitled note'}
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Decrypted in this tab. The values below describe how it is stored, not what it says.
                </p>

                <dl className="mt-4">
                  <DetailRow label="Note ID" value={selected.id} mono copyable />
                  <DetailRow
                    label="Owner ID"
                    value={selected.ownerId}
                    mono
                    copyable
                    hint={`Owner: ${selected.owner.displayName} <${selected.owner.email}>`}
                  />
                  <DetailRow
                    label="Your relationship"
                    value={selected.role === 'owner' ? 'Owner - holds the master key' : 'Recipient - holds a wrapped copy of the note key'}
                  />
                  <DetailRow
                    label="Encryption version"
                    value={`v${selected.encryptionVersion} (current payload format)`}
                    hint="Stored per note so the payload format can evolve without breaking older notes."
                  />
                  <DetailRow label="Cipher" value={selected.algorithm} mono />
                  <DetailRow
                    label="IV / nonce"
                    value={selected.iv}
                    mono
                    copyable
                    hint="A fresh 96-bit random nonce is generated for every write. It is not secret, but it must never repeat for the same key."
                  />
                  <DetailRow label="Ciphertext size" value={`${selected.ciphertext.length.toLocaleString()} base64 characters`} />
                  <DetailRow
                    label="Plaintext payload size"
                    value={`${formatBytes(selected.payloadBytes)} (metadata only)`}
                    hint="Length of the encrypted JSON payload. The server stores this number and cannot derive content from it."
                  />
                  <DetailRow label="Created" value={formatDateTime(selected.createdAt)} />
                  <DetailRow label="Last updated" value={formatDateTime(selected.updatedAt)} />
                </dl>
              </section>

              <section className="card p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
                  <KeyRound className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                  Ciphertext preview
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  The first {CIPHERTEXT_PREVIEW_CHARS} characters of the stored blob. It is AES-GCM output: unreadable
                  without the note key, and a single altered byte makes decryption fail authentication.
                </p>
                <pre className="mt-3 max-h-52 overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-[11px] leading-5 text-cyan-200">
                  {selected.ciphertext.slice(0, CIPHERTEXT_PREVIEW_CHARS)}
                  {selected.ciphertext.length > CIPHERTEXT_PREVIEW_CHARS ? '\n… truncated for display' : ''}
                </pre>
              </section>

              <section className="card p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
                  <Users className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                  Sharing status
                </h3>

                {selected.role === 'recipient' ? (
                  <div className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                    <p className="flex items-start gap-2">
                      <Unlock className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                      This note belongs to {selected.owner.displayName}. You hold a per-recipient copy of the note key
                      wrapped with RSA-OAEP-2048/SHA-256.
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      If the owner revokes your access, the API rejects every future request. Anything you already
                      decrypted stays readable outside CipherNote.
                    </p>
                  </div>
                ) : selected.shares.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                    This note is private and has never been shared.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
                    {selected.shares.map((share) => (
                      <li key={share.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-slate-700 dark:text-slate-200">
                            {share.recipient.displayName}{' '}
                            <span className="text-slate-400 dark:text-slate-500">({share.recipient.email})</span>
                          </p>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-400 dark:text-slate-500">
                            {share.sharedWithId} · {share.keyAlgorithm}
                          </p>
                        </div>
                        <span className={`badge ${share.isActive ? 'badge-emerald' : 'badge-rose'}`}>
                          {share.isActive ? (
                            <>
                              <Check className="h-3 w-3" /> Active
                            </>
                          ) : (
                            <>
                              <ShieldOff className="h-3 w-3" /> Revoked
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-xl border border-rose-200 bg-rose-50/60 p-5 dark:border-rose-500/30 dark:bg-rose-500/5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-rose-800 dark:text-rose-300">
                  <EyeOff className="h-4 w-4" />
                  What this page will never show
                </h3>
                <ul className="mt-3 grid gap-1.5 text-xs leading-5 text-rose-900/90 sm:grid-cols-2 dark:text-rose-100/80">
                  {[
                    'Passwords or password hashes',
                    'PBKDF2 key-encryption-key material',
                    'Your master key or any note key',
                    'The RSA private key (or its plaintext form)',
                    'Decrypted note plaintext outside this page',
                    'Any other user\u2019s private data',
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-1.5">
                      <ShieldOff className="mt-0.5 h-3 w-3 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="card p-5">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
                  <Info className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                  Metadata the server does see
                </h3>
                <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                  End-to-end encryption protects note content, not all information. The database holds user ids, note
                  ids, your owner id, creation and update timestamps, ciphertext and plaintext byte counts, the nonce,
                  and the sharing graph including when a share was created or revoked. Traffic analysis against this
                  metadata is outside the protection CipherNote provides.
                </p>
              </section>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
