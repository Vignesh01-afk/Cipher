import { useState } from 'react';
import { EyeOff, KeyRound, MonitorX, ShieldCheck, Timer, Waves } from 'lucide-react';
import { AUTO_LOCK_OPTIONS, usePrivacy } from '../context/PrivacyContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Toggle } from '../components/Toggle';
import { SecurityBadge } from '../components/SecurityBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';

/**
 * Privacy / Security settings page.
 *
 * Every toggle here is wired to real behaviour in PrivacyContext:
 *  - blur on window blur (window focus/blur events)
 *  - hide on hidden tab (Page Visibility API)
 *  - screen capture protection (getDisplayMedia watch)
 *  - watermark (session identity + timestamp)
 *  - auto-lock (inactivity timer -> drops in-memory keys)
 */
export function PrivacySettingsPage(): JSX.Element {
  const { settings, updateSettings } = usePrivacy();
  const { setupRecoveryKey } = useAuth();
  const toast = useToast();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
              <EyeOff className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">Privacy Mode</h2>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                Practical, browser-level protection against observation. Master switch for all behaviours below.
              </p>
            </div>
          </div>
          <Toggle
            checked={settings.privacyMode}
            onChange={(value) => updateSettings({ privacyMode: value })}
            label="Privacy Mode"
          />
        </div>

        <div className="mt-4 space-y-1">
          <Toggle
            checked={settings.blurOnBlur}
            onChange={(value) => updateSettings({ blurOnBlur: value })}
            label="Hide content when the window loses focus"
            disabled={!settings.privacyMode}
          />
          <Toggle
            checked={settings.hideOnHidden}
            onChange={(value) => updateSettings({ hideOnHidden: value })}
            label="Hide content when the tab becomes inactive"
            disabled={!settings.privacyMode}
          />
          <Toggle
            checked={settings.captureProtection}
            onChange={(value) => updateSettings({ captureProtection: value })}
            label="Screen capture protection"
            description="Hide sensitive content while this tab is being shared via getDisplayMedia."
            disabled={!settings.privacyMode}
          />
          <Toggle
            checked={settings.screenshotProtection}
            onChange={(value) => updateSettings({ screenshotProtection: value })}
            label="Screenshot protection"
            description="Block print/save shortcuts, overwrite the clipboard on PrintScreen and flash-hide content when a capture key is pressed. Cannot stop OS-level tools."
            disabled={!settings.privacyMode}
          />
          <Toggle
            checked={settings.watermark}
            onChange={(value) => updateSettings({ watermark: value })}
            label="Sensitive-content watermark"
            description="Subtle session identifier and timestamp in the corner of the app."
            disabled={!settings.privacyMode}
          />
          <Toggle
            checked={settings.autoLockSeconds > 0}
            onChange={(value) => updateSettings({ autoLockSeconds: value ? 900 : 0 })}
            label="Auto-lock after inactivity"
            description="Locking drops the decryption keys from memory; your password restores them."
            disabled={!settings.privacyMode}
          />

          {settings.autoLockSeconds > 0 && settings.privacyMode ? (
            <div className="mt-3 pl-11">
              <label htmlFor="autolock" className="label flex items-center gap-2">
                <Timer className="h-3.5 w-3.5" />
                Session timeout
              </label>
              <select
                id="autolock"
                className="select max-w-xs"
                value={settings.autoLockSeconds}
                onChange={(event) => updateSettings({ autoLockSeconds: Number(event.target.value) })}
              >
                {AUTO_LOCK_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
          <ShieldCheck className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          Security information
        </h2>
        <dl className="mt-4 space-y-3 text-xs">
          {[
            { term: 'Note payloads', value: 'AES-GCM-256, unique 96-bit nonce per write' },
            { term: 'File blobs', value: 'AES-GCM-256 with a fresh per-file key, wrapped like note keys' },
            { term: 'Recipient access', value: 'RSA-OAEP-2048 / SHA-256 key wrapping per share' },
            { term: 'Password → key', value: 'PBKDF2-SHA256, 210,000 iterations' },
            { term: 'Server-side plaintext', value: 'None - the API stores ciphertext only' },
          ].map((row) => (
            <div key={row.term} className="flex flex-col gap-0.5">
              <dt className="font-semibold text-slate-700 dark:text-slate-200">{row.term}</dt>
              <dd className="text-slate-500 dark:text-slate-400">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SecurityBadge />
          <span className="badge badge-slate">
            <MonitorX className="h-3 w-3" />
            Capture detection: {settings.captureProtection ? 'on' : 'off'}
          </span>
          <span className="badge badge-slate">
            <Waves className="h-3 w-3" />
            Watermark: {settings.watermark ? 'on' : 'off'}
          </span>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
          <KeyRound className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          Recovery key
        </h2>
        <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
          The single-use key that can reset a forgotten password. Shown once at registration; the server stores a
          wrapped copy of your master key under it, but never the key itself.
        </p>
        <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setConfirmRegen(true)}>
          Generate a new recovery key
        </button>
        {newKey ? (
          <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50/70 p-3 dark:border-cyan-500/30 dark:bg-cyan-500/5">
            <p className="select-all break-all font-mono text-xs font-semibold text-cyan-900 dark:text-cyan-100">{newKey}</p>
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
              Shown once. Copy it to a safe place - the previous key is now invalid.
            </p>
            <button
              type="button"
              className="btn btn-ghost btn-sm mt-2"
              onClick={() => {
                void navigator.clipboard.writeText(newKey);
                toast.success('Copied', 'Paste it somewhere safe.');
              }}
            >
              Copy key
            </button>
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={confirmRegen}
        title="Generate a new recovery key?"
        destructive={false}
        busy={regenBusy}
        confirmLabel="Generate"
        onCancel={() => setConfirmRegen(false)}
        onConfirm={() => {
          void (async () => {
            setRegenBusy(true);
            try {
              const key = await setupRecoveryKey();
              setNewKey(key);
              setConfirmRegen(false);
              toast.success('Recovery key regenerated', 'The previous key no longer works.');
            } catch (error) {
              toast.error('Could not regenerate', error instanceof Error ? error.message : undefined);
            } finally {
              setRegenBusy(false);
            }
          })();
        }}
        message="A new single-use recovery key will replace the current one. Your notes, files and shares are unaffected."
      />

      <section className="rounded-xl border border-amber-300 bg-amber-50/70 p-5 dark:border-amber-500/30 dark:bg-amber-500/5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
          What Privacy Mode cannot do
        </h2>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-900/90 dark:text-amber-100/80">
          <li>
            It cannot block operating-system screenshots, print-screen tools or hardware capture devices. A browser
            page has no API to detect or prevent those.
          </li>
          <li>
            It cannot stop a phone photographing the screen, or someone looking over your shoulder while the content
            is visible.
          </li>
          <li>
            It cannot prevent another user who legitimately decrypted a file from keeping a copy. That is true of
            every end-to-end encrypted system.
          </li>
        </ul>
      </section>
    </div>
  );
}
