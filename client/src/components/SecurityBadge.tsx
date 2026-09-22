import { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import { Modal } from './Modal';

/**
 * The "🔒 End-to-End Encrypted" indicator.
 *
 * Every claim in the detail modal is true of this implementation:
 *  - note payloads and file blobs are AES-GCM-256 encrypted in the browser;
 *  - keys are wrapped (master key under PBKDF2 KEK; note/file keys under the
 *    master key or the recipient's RSA public key);
 *  - the server stores ciphertext only.
 *
 * No DRM-level screenshot-protection claim is made anywhere.
 */
export function SecurityBadge({ compact = false }: { compact?: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="badge badge-emerald cursor-pointer hover:brightness-110"
        title="How CipherNote encryption works"
      >
        <Lock className="h-3 w-3" />
        {compact ? 'E2E' : 'End-to-End Encrypted'}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Encryption details"
        description="Only claims that are true of this implementation are listed here."
        size="md"
      >
        <div className="space-y-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            Your messages and notes are encrypted with AES-GCM-256 <em>before transmission</em>. The server stores
            ciphertext and wrapped keys only.
          </p>
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            Files are encrypted in your browser before upload and decrypted in the recipient's browser after an
            authorised download.
          </p>
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            Only authorized participants can decrypt: owners via their master key, recipients via the note key
            wrapped with their RSA-OAEP public key.
          </p>
          <p className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/5 dark:text-amber-200/90">
            Honest limitation: no web application can prevent OS-level screenshots, photos of the screen or hardware
            recorders. Privacy Mode offers practical browser-level protections only.
          </p>
        </div>
      </Modal>
    </>
  );
}
