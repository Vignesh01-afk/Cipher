import {
  AlertTriangle,
  FilePlus2,
  FileX2,
  KeyRound,
  LogIn,
  LogOut,
  PencilLine,
  ShieldOff,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';

export type AuditTone = 'neutral' | 'positive' | 'warning' | 'danger';

export interface AuditActionMeta {
  label: string;
  description: string;
  tone: AuditTone;
  icon: LucideIcon;
}

/**
 * Client-side presentation for the server's audit action codes. Keep in sync
 * with `server/src/lib/audit.ts`.
 */
export const AUDIT_ACTIONS: Record<string, AuditActionMeta> = {
  REGISTER: {
    label: 'Account created',
    description: 'A new CipherNote account and key pair were generated on this device.',
    tone: 'positive',
    icon: UserPlus,
  },
  LOGIN: {
    label: 'Signed in',
    description: 'Password verified and the encrypted key material was downloaded for local unlock.',
    tone: 'positive',
    icon: LogIn,
  },
  LOGIN_FAILED: {
    label: 'Failed sign-in',
    description: 'An incorrect password was supplied for this account.',
    tone: 'warning',
    icon: AlertTriangle,
  },
  LOGOUT: {
    label: 'Signed out',
    description: 'The session token was discarded. Cached note keys were cleared from memory.',
    tone: 'neutral',
    icon: LogOut,
  },
  NOTE_CREATE: {
    label: 'Note created',
    description: 'A note was encrypted on the client and the ciphertext was stored.',
    tone: 'positive',
    icon: FilePlus2,
  },
  NOTE_UPDATE: {
    label: 'Note updated',
    description: 'The author re-encrypted the note and replaced the stored ciphertext.',
    tone: 'neutral',
    icon: PencilLine,
  },
  NOTE_DELETE: {
    label: 'Note deleted',
    description: 'The ciphertext and all of its shares were removed.',
    tone: 'danger',
    icon: FileX2,
  },
  NOTE_SHARE: {
    label: 'Note shared',
    description: 'The note key was wrapped with the recipient\u2019s public key.',
    tone: 'positive',
    icon: KeyRound,
  },
  SHARE_REVOKE: {
    label: 'Access revoked',
    description: 'The recipient\u2019s share was revoked and will no longer authorise access.',
    tone: 'danger',
    icon: ShieldOff,
  },
  ACCESS_DENIED: {
    label: 'Access denied',
    description: 'A request for a note was rejected because the share had been revoked.',
    tone: 'warning',
    icon: ShieldOff,
  },
};

export const AUDIT_ACTION_CODES = Object.keys(AUDIT_ACTIONS);

export function getAuditActionMeta(action: string): AuditActionMeta {
  return (
    AUDIT_ACTIONS[action] ?? {
      label: action,
      description: 'Unrecognised audit event.',
      tone: 'neutral',
      icon: AlertTriangle,
    }
  );
}

export const AUDIT_TONE_CLASSES: Record<AuditTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
  positive: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
  danger: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30',
};
