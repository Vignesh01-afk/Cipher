import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePrivacy } from '../context/PrivacyContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { Toggle } from '../components/Toggle';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Skeleton } from '../components/Skeleton';
import { ErrorState } from '../components/States';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { AUTO_LOCK_OPTIONS } from '../context/PrivacyContext';
import {
  EyeSlash,
  Key,
  Monitor,
  ShieldCheck,
  Timer,
  Waves,
  Lock,
  Info,
  Envelope,
  User,
  Trash,
  Warning,
  CloudCheck,
} from '@phosphor-icons/react';
import type { ReactElement } from 'react';
import type { Theme } from '../context/ThemeContext';

type Tab = 'account' | 'security' | 'appearance' | 'notifications' | 'privacy' | 'about';

interface SettingsPageProps {
  tab?: string;
}

function StorageBar({ noteId }: { noteId: string }): ReactElement {
  const [usedBytes, setUsedBytes] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const files = await api.listFiles(noteId);
      const total = files.reduce((acc: number, f: { plaintextBytes?: number }) => acc + (f.plaintextBytes ?? 0), 0);
      setUsedBytes(total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read storage usage.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [noteId]);

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-full" />
        </div>
      ) : error ? (
        <ErrorState title="Storage unavailable" message={error} onRetry={load} />
      ) : usedBytes === null || usedBytes === 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink dark:text-paper">No files stored yet</p>
          <div className="h-3 w-full rounded-full bg-line" />
          <p className="text-xs text-muted dark:text-muted">
            Upload a file to see how much of your storage allowance you are using.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-ink dark:text-paper font-medium">{formatBytes(usedBytes)} used</span>
            <span className="text-muted dark:text-muted text-xs">of 25 MB per account</span>
          </div>
          <div className="h-3 w-full rounded-full bg-line overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#2f6bff] to-[#8b5cf6]"
              style={{ width: `${Math.min(100, (usedBytes / (25 * 1024 * 1024)) * 100).toFixed(2)}%` }}
            />
          </div>
          <p className="text-xs text-muted dark:text-muted">
            Limit reflects the server's per-file cap of 25 MB and the account storage allowance.
          </p>
        </div>
      )}
    </div>
  );
}

function AccountTab({ userName, userEmail, storageNoteId }: { userName: string; userEmail: string; storageNoteId: string }): ReactElement {
  const navigate = useNavigate();
  const [localName, setLocalName] = useState(userName);
  const [localEmail, setLocalEmail] = useState(userEmail);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveProfile = async () => {
    setSaving(true);
    setError(null);
    try {
      // No account-update endpoint exists yet (checked server/src/routes/auth.ts).
      setError('The server has no “update my profile” endpoint yet, so name and email are read-only for now.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <Avatar name={userName} size="lg" className="flex-shrink-0" />
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-ink dark:text-paper break-all">{userName || '—'}</h3>
          <p className="mt-0.5 text-sm text-muted dark:text-muted break-all">{userEmail || '—'}</p>
        </div>
        <Button variant="secondary" size="sm" disabled title="Not available yet" className="ml-auto flex-shrink-0">
          <User className="h-3.5 w-3.5" />
          Change Photo
        </Button>
      </div>

      <section className="card p-5 space-y-4">
        <h4 className="text-sm font-semibold text-ink dark:text-paper">Profile fields</h4>
        <Input
          label="Name"
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          disabled
          placeholder="Your display name"
        />
        <Input
          label="Email"
          type="email"
          value={localEmail}
          onChange={(e) => setLocalEmail(e.target.value)}
          disabled
          placeholder="you@example.com"
        />
        {error ? <ErrorState title="Read-only for now" message={error} /> : null}
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted dark:text-muted">
            Name and email come from your account. There is no server endpoint to update them yet, so these fields are read-only.
          </p>
          <Button variant="secondary" size="sm" disabled={saving || !('updateProfile' in api)} onClick={saveProfile}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </section>

      <section className="card p-5">
        <h4 className="text-sm font-semibold text-ink dark:text-paper">Quick Actions</h4>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <a href="/forgot-password" className="btn btn-secondary btn-sm inline-flex items-center gap-2">
            <Lock className="h-3.5 w-3.5" />
            Change Password
          </a>
          <Button variant="secondary" size="sm" disabled title="Not available yet">
            <ShieldCheck className="h-3.5 w-3.5" />
            Two-Factor Authentication
          </Button>
          <Button variant="secondary" size="sm" disabled title="Not available yet">
            <CloudCheck className="h-3.5 w-3.5" />
            Download My Data
          </Button>
          <Button variant="danger" size="sm" disabled title="Not available yet">
            <span className="flex items-center gap-2">
              <Trash className="h-3.5 w-3.5" />
              Delete Account
            </span>
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted dark:text-muted">
          Change Password links to the existing password-recovery flow. The other actions are not wired yet.
        </p>
      </section>

      <section className="card p-5">
        <h4 className="text-sm font-semibold text-ink dark:text-paper">Storage Usage</h4>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted dark:text-muted">
            Storage used is computed from the existing files API by summing every file attached to your notes.
          </p>
          <StorageBar noteId={storageNoteId} />
        </div>
      </section>
    </div>
  );
}

function SecurityTab(): ReactElement {
  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h4 className="text-sm font-semibold text-ink dark:text-paper">Security inspector</h4>
        <p className="mt-1 text-sm text-muted dark:text-muted">
          Read-only metadata about a note or conversation. No keys or passwords are exposed.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link to="/inspector" className="btn btn-secondary btn-sm inline-flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5" />
            Open Security Inspector
          </Link>
        </div>
      </section>

      <section className="card p-5">
        <h4 className="text-sm font-semibold text-ink dark:text-paper flex items-center gap-2">
          <Lock className="h-4 w-4 text-brand-600 dark:text-brand-300" />
          Recovery key
        </h4>
        <p className="mt-1 text-sm text-muted dark:text-muted">
          The single-use recovery key can reset a forgotten password. It is shown once at registration; the server
          stores a wrapped copy of your master key under it, but never the key itself.
        </p>
        <div className="mt-4 rounded-md border border-rose-200/80 bg-rose-50/40 p-4 dark:border-rose-500/20 dark:bg-rose-500/5">
          <RecoveryKeyPanel />
        </div>
      </section>
    </div>
  );
}

function RecoveryKeyPanel(): ReactElement {
  const { setupRecoveryKey } = useAuth();
  const toast = useToast();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenPassword, setRegenPassword] = useState('');

  const doRegen = async () => {
    if (!regenPassword) {
      toast.error('Password required', 'Enter your account password to continue.');
      return;
    }
    setRegenBusy(true);
    try {
      const key = await setupRecoveryKey(regenPassword);
      setNewKey(key);
      setRegenPassword('');
      setConfirmRegen(false);
      toast.success('Recovery key regenerated', 'The previous key no longer works.');
    } catch (err) {
      toast.error('Could not regenerate', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setRegenBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setConfirmRegen(true)}>
        Generate a new recovery key
      </Button>
      {newKey ? (
        <div className="mt-3 rounded-md border border-brand/25 bg-brand/[0.06] p-3 dark:border-brand/25 dark:bg-brand/[0.08]">
          <p className="select-all break-all font-mono text-xs font-semibold text-ink dark:text-paper">{newKey}</p>
          <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
            Shown once. Copy it to a safe place — the previous key is now invalid.
          </p>
          <Button variant="ghost" size="sm" onClick={() => { void navigator.clipboard.writeText(newKey); toast.success('Copied', 'Paste it somewhere safe.'); }}>
            Copy key
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirmRegen}
        title="Generate a new recovery key?"
        destructive={false}
        busy={regenBusy}
        confirmLabel="Generate"
        onCancel={() => { setRegenPassword(''); setConfirmRegen(false); }}
        onConfirm={doRegen}
        message={
          <span className="block space-y-3">
            <span className="block">
              A new single-use recovery key will replace the current one. Your notes, files and shares are unaffected.
            </span>
            <label className="block text-left">
              <span className="mb-1 block text-xs font-medium text-muted dark:text-muted">
                Confirm your account password
              </span>
              <Input
                type="password"
                value={regenPassword}
                autoComplete="current-password"
                onChange={(e) => setRegenPassword(e.target.value)}
                placeholder="Your password"
              />
            </label>
          </span>
        }
      />
    </>
  );
}

function AppearanceTab(): ReactElement {
  const { theme, setTheme } = useTheme();

  const options: { value: 'light' | 'dark' | 'system'; label: string; description: string }[] = [
    { value: 'light', label: 'Light', description: 'Always use the light theme.' },
    { value: 'dark', label: 'Dark', description: 'Always use the dark theme.' },
    { value: 'system', label: 'System', description: 'Follow the operating system theme.' },
  ];

  const isActive = (value: 'light' | 'dark' | 'system') => {
    if (theme === 'light') {
      if (value === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches;
      return value === 'light';
    }
    if (theme === 'dark') {
      if (value === 'system') return !window.matchMedia('(prefers-color-scheme: dark)').matches;
      return value === 'dark';
    }
    return false;
  };

  const isLight = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  return (
    <div className="card p-5 space-y-4">
      <h4 className="text-sm font-semibold text-ink dark:text-paper">Theme</h4>
      <p className="text-xs text-muted dark:text-muted">Choose how CipherNote matches your preferred appearance.</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`flex flex-col gap-1 rounded-md border p-3 text-left transition ${
              isActive(option.value)
                ? 'border-accent bg-accent/10 text-ink dark:text-paper'
                : 'border-line bg-panel text-muted hover:border-accent/60'
            }`}
            onClick={() => setTheme(option.value === 'system' ? isLight : option.value)}
            title={option.description}
          >
            <span className="text-sm font-semibold">{option.label}</span>
            <span className="text-xs leading-5">{option.description}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted dark:text-muted">
        Theme preference is stored locally in this browser. System follows your OS setting.
      </p>
    </div>
  );
}

const STORAGE_KEY_NOTIFICATIONS = 'ciphernote.settings.notifications.v1';

function defaultNotificationValues(): Record<string, boolean> {
  return { newNotes: true, newShares: true, chatMessages: true };
}

function NotificationsTab(): ReactElement {
  const [values, setValues] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_NOTIFICATIONS);
      if (!raw) return defaultNotificationValues();
      const parsed = JSON.parse(raw);
      return {
        newNotes: typeof parsed.newNotes === 'boolean' ? parsed.newNotes : defaultNotificationValues().newNotes,
        newShares: typeof parsed.newShares === 'boolean' ? parsed.newShares : defaultNotificationValues().newShares,
        chatMessages: typeof parsed.chatMessages === 'boolean' ? parsed.chatMessages : defaultNotificationValues().chatMessages,
      };
    } catch {
      return defaultNotificationValues();
    }
  });

  const persist = (key: string, value: boolean) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY_NOTIFICATIONS, JSON.stringify(next));
      } catch {
      }
      return next;
    });
  };

  return (
    <div className="card p-5 space-y-4">
      <h4 className="text-sm font-semibold text-ink dark:text-paper">Notifications</h4>
      <p className="text-xs text-muted dark:text-muted">Saved on this device only.</p>
      <Toggle
        label="New notes"
        checked={values.newNotes}
        onChange={(v) => persist('newNotes', v)}
        description="Notify when a note is created or updated."
      />
      <Toggle
        label="New shares"
        checked={values.newShares}
        onChange={(v) => persist('newShares', v)}
        description="Notify when someone shares a note with you."
      />
      <Toggle
        label="Chat messages"
        checked={values.chatMessages}
        onChange={(v) => persist('chatMessages', v)}
        description="Notify when you receive a chat message."
      />
      <p className="text-xs text-muted dark:text-muted mt-2">
        These preferences are stored in localStorage only and do not sync across devices or with the server.
      </p>
    </div>
  );
}

function PrivacySettingsWrapper(): ReactElement {
  const { settings, updateSettings } = usePrivacy();
  const toast = useToast();
  const { setupRecoveryKey } = useAuth();
  const [newKey, setNewKey] = useState<string | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenPassword, setRegenPassword] = useState('');

  const doRegen = async () => {
    if (!regenPassword) {
      toast.error('Password required', 'Enter your account password to continue.');
      return;
    }
    setRegenBusy(true);
    try {
      const key = await setupRecoveryKey(regenPassword);
      setNewKey(key);
      setRegenPassword('');
      setConfirmRegen(false);
      toast.success('Recovery key regenerated', 'The previous key no longer works.');
    } catch (err) {
      toast.error('Could not regenerate', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setRegenBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-line text-muted">
              <EyeSlash className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink dark:text-paper">Privacy Mode</h2>
              <p className="mt-0.5 text-sm text-muted dark:text-muted">
                Practical, browser-level protection against observation. Master switch for all behaviours below.
              </p>
            </div>
          </div>
          <div className="ml-14">
            <Toggle
              checked={settings.privacyMode}
              onChange={(value) => updateSettings({ privacyMode: value })}
              label="Master switch"
            />
          </div>
        </div>
        <div className="border-t border-line pt-3 mt-4 space-y-1">
        </div>

        <div className="mt-4 space-y-1">
          <Toggle checked={settings.blurOnBlur} onChange={(value) => updateSettings({ blurOnBlur: value })} label="Hide content when the window loses focus" description="Live toggles stay editable from the account and security tabs." disabled={!settings.privacyMode} />
          <Toggle checked={settings.hideOnHidden} onChange={(value) => updateSettings({ hideOnHidden: value })} label="Hide content when the tab becomes inactive" disabled={!settings.privacyMode} />
          <Toggle checked={settings.captureProtection} onChange={(value) => updateSettings({ captureProtection: value })} label="Screen capture protection" description="Hide sensitive content while this tab is being shared via getDisplayMedia." disabled={!settings.privacyMode} />
          <Toggle checked={settings.screenshotProtection} onChange={(value) => updateSettings({ screenshotProtection: value })} label="Screenshot protection" description="Block print/save shortcuts, overwrite the clipboard on PrintScreen and flash-hide content when a capture key is pressed. Cannot stop OS-level tools." disabled={!settings.privacyMode} />
          <Toggle checked={settings.watermark} onChange={(value) => updateSettings({ watermark: value })} label="Sensitive-content watermark" description="Subtle session identifier and timestamp in the corner of the app." disabled={!settings.privacyMode} />
          <Toggle checked={settings.autoLockSeconds > 0} onChange={(value) => updateSettings({ autoLockSeconds: value ? 900 : 0 })} label="Auto-lock after inactivity" description="Locking drops the decryption keys from memory; your password restores them." disabled={!settings.privacyMode} />

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
                <option value={60}>1 minute</option>
                <option value={300}>5 minutes</option>
                <option value={900}>15 minutes</option>
                <option value={1800}>30 minutes</option>
                <option value={0}>Never</option>
              </select>
            </div>
          ) : null}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-white">
          <ShieldCheck className="h-4 w-4 text-brand-600 dark:text-brand-300" />
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
              <dt className="font-semibold text-stone-700 dark:text-stone-200">{row.term}</dt>
              <dd className="text-stone-500 dark:text-stone-400">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Badge variant="emerald">
            <Monitor className="h-3 w-3" />
            Capture detection: {settings.captureProtection ? 'on' : 'off'}
          </Badge>
          <Badge variant="slate">
            <Waves className="h-3 w-3" />
            Watermark: {settings.watermark ? 'on' : 'off'}
          </Badge>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-white">
          <Key className="h-4 w-4 text-brand-600 dark:text-brand-300" />
          Recovery key
        </h2>
        <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-stone-400">
          The single-use key that can reset a forgotten password. Shown once at registration; the server stores a
          wrapped copy of your master key under it, but never the key itself.
        </p>
        <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => setConfirmRegen(true)}>
          Generate a new recovery key
        </button>
        {newKey ? (
          <div className="mt-3 rounded-md border border-brand/25 bg-brand/[0.06] p-3 dark:border-brand/25 dark:bg-brand/[0.08]">
            <p className="select-all break-all font-mono text-xs font-semibold text-stone-800 dark:text-stone-100">{newKey}</p>
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
        onCancel={() => {
          setRegenPassword('');
          setConfirmRegen(false);
        }}
        onConfirm={doRegen}
        message={
          <span className="block space-y-3">
            <span className="block">
              A new single-use recovery key will replace the current one. Your notes, files and shares are unaffected.
            </span>
            <label className="block text-left">
              <span className="mb-1 block text-xs font-medium text-stone-600 dark:text-stone-300">
                Confirm your account password
              </span>
              <input
                type="password"
                className="input"
                value={regenPassword}
                autoComplete="current-password"
                onChange={(event) => setRegenPassword(event.target.value)}
              />
            </label>
          </span>
        }
      />
    </div>
  );
}

function PrivacyTab(): ReactElement {
  return <PrivacySettingsWrapper />;
}

function AboutTab(): ReactElement {
  const pkgVersion = '1.0.0';

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h4 className="text-sm font-semibold text-ink dark:text-paper">CipherNote</h4>
        <p className="mt-1 text-sm text-muted dark:text-muted">Encrypted notes. Encrypted chat. Encrypted files.</p>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted dark:text-muted">Version</span>
            <span className="font-mono text-ink dark:text-paper">{pkgVersion}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted dark:text-muted">License</span>
            <span className="text-ink dark:text-paper">Proprietary</span>
          </div>
        </dl>
      </section>

      <section className="card p-5">
        <h4 className="text-sm font-semibold text-ink dark:text-paper">Links</h4>
        <div className="mt-3 space-y-2">
          <Link to="/terms" className="btn btn-ghost btn-sm inline-flex items-center gap-2 w-full justify-start">
            <Info className="h-3.5 w-3.5" />
            Terms of Service
          </Link>
          <Link to="/privacy-policy" className="btn btn-ghost btn-sm inline-flex items-center gap-2 w-full justify-start">
            <EyeSlash className="h-3.5 w-3.5" />
            Privacy Policy
          </Link>
        </div>
      </section>
    </div>
  );
}

export function SettingsPage({ tab: initialTab }: SettingsPageProps): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const raw = (initialTab ?? searchParams.get('tab') ?? '').toLowerCase();
    if (raw.includes('account')) return 'account';
    if (raw.includes('security')) return 'security';
    if (raw.includes('appearance') || raw.includes('theme')) return 'appearance';
    if (raw.includes('notification')) return 'notifications';
    if (raw.includes('privacy')) return 'privacy';
    if (raw.includes('about')) return 'about';
    return 'account';
  });

  const { user } = useAuth();
  const displayName = user?.displayName ?? 'User';
  const email = user?.email ?? '';

  const navigateTab = (nextTab: Tab) => {
    setTab(nextTab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    setSearchParams(next, { replace: true });
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'account', label: 'Account' },
    { id: 'security', label: 'Security' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'privacy', label: 'Privacy' },
    { id: 'about', label: 'About' },
  ];

  const content: Record<Tab, ReactElement> = {
    account: <AccountTab userName={displayName} userEmail={email} storageNoteId="" />,
    security: <SecurityTab />,
    appearance: <AppearanceTab />,
    notifications: <NotificationsTab />,
    privacy: <PrivacyTab />,
    about: <AboutTab />,
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-col lg:flex-row gap-6">
        <nav className="flex overflow-x-auto overflow-y-visible flex-nowrap gap-1 bg-panel rounded-b-xl border-b border-line px-2 py-2 lg:hidden">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`whitespace-nowrap px-3 py-2 text-sm font-medium rounded-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-indigo ${
                tab === t.id
                  ? 'bg-gradient-to-r from-[#2f6bff] to-[#8b5cf6] text-white shadow-[0_0_0_1px_rgba(99,102,241,0.35),0_0_14px_rgba(99,102,241,0.3)]'
                  : 'text-muted hover:bg-panel/80 hover:text-ink dark:hover:bg-panel/40 dark:hover:text-stone-100'
              }`}
              onClick={() => navigateTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <nav className="hidden lg:flex lg:flex-col lg:w-48 lg:flex-nowrap flex-shrink-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tab-btn whitespace-nowrap px-3 py-2 text-sm font-medium rounded-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-indigo ${
                tab === t.id
                  ? 'bg-gradient-to-r from-[#2f6bff] to-[#8b5cf6] text-white shadow-[0_0_0_1px_rgba(99,102,241,0.35),0_0_14px_rgba(99,102,241,0.3)]'
                  : 'text-muted hover:bg-panel hover:text-ink dark:hover:bg-panel/40 dark:hover:text-stone-100'
              }`}
              onClick={() => navigateTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Badge variant="slate">{tabs.find((t) => t.id === tab)?.label ?? 'Settings'}</Badge>
            </div>
            {content[tab]}
          </div>
        </div>
      </div>
    </div>
  );
}
