import {
  AlertTriangle,
  Ban,
  Chrome,
  Download,
  Eraser,
  FilePlus2,
  FileX2,
  KeyRound,
  Paperclip,
  LogIn,
  LogOut,
  Mail,
  MailCheck,
  MessageCircle,
  PencilLine,
  ShieldOff,
  Trash2,
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
  FILE_CREATE: {
    label: 'File uploaded',
    description: 'An encrypted file was attached to a note you own.',
    tone: 'positive',
    icon: Paperclip,
  },
  FILE_DOWNLOAD: {
    label: 'File downloaded',
    description: 'The encrypted blob was served to a browser authorised to read the note.',
    tone: 'neutral',
    icon: Download,
  },
  FILE_DELETE: {
    label: 'File deleted',
    description: 'An encrypted file and its stored blob were removed.',
    tone: 'danger',
    icon: Trash2,
  },
  FILE_ACCESS_DENIED: {
    label: 'File access denied',
    description: 'A file request was rejected because the caller no longer has access to its note.',
    tone: 'warning',
    icon: ShieldOff,
  },
  RECOVERY_SETUP: {
    label: 'Recovery key set up',
    description: 'A single-use recovery key was generated and the master key re-wrapped under it.',
    tone: 'positive',
    icon: KeyRound,
  },
  RECOVERY_CHALLENGE: {
    label: 'Recovery key verified',
    description: 'A recovery key was presented on the forgot-password page and matched.',
    tone: 'neutral',
    icon: KeyRound,
  },
  RECOVERY_CHALLENGE_FAILED: {
    label: 'Recovery key rejected',
    description: 'A presented recovery key did not match this account.',
    tone: 'warning',
    icon: AlertTriangle,
  },
  RECOVERY_RESET: {
    label: 'Password reset (recovery key)',
    description: 'The password was reset with a recovery key and the vault keys were re-wrapped.',
    tone: 'positive',
    icon: KeyRound,
  },
  RECOVERY_RESET_FAILED: {
    label: 'Failed password reset',
    description: 'A recovery-key reset attempt was rejected.',
    tone: 'warning',
    icon: AlertTriangle,
  },
  OTP_REQUEST: {
    label: 'Reset code requested',
    description: 'A one-time password-reset code was emailed to the account address.',
    tone: 'neutral',
    icon: Mail,
  },
  OTP_REQUEST_FAILED: {
    label: 'Reset code request blocked',
    description: 'A request for a reset code was throttled or rejected.',
    tone: 'warning',
    icon: AlertTriangle,
  },
  OTP_VERIFY_FAILED: {
    label: 'Wrong reset code',
    description: 'An incorrect one-time code was entered for this account.',
    tone: 'warning',
    icon: AlertTriangle,
  },
  PASSWORD_RESET_OTP: {
    label: 'Password reset (email code)',
    description: 'The password was reset after verifying a one-time email code.',
    tone: 'positive',
    icon: MailCheck,
  },
  GOOGLE_LINKED: {
    label: 'Google account linked',
    description: 'A verified Google account was linked to this CipherNote account.',
    tone: 'positive',
    icon: Chrome,
  },
  GOOGLE_LOGIN: {
    label: 'Signed in with Google',
    description: 'Google verified the identity; the vault password is still required to unlock keys.',
    tone: 'positive',
    icon: Chrome,
  },
  GOOGLE_LOGIN_FAILED: {
    label: 'Google sign-in failed',
    description: 'A Google sign-in attempt was rejected.',
    tone: 'warning',
    icon: AlertTriangle,
  },
  GOOGLE_REGISTER: {
    label: 'Account created with Google',
    description: 'A new CipherNote account was created after Google verified the email address.',
    tone: 'positive',
    icon: UserPlus,
  },
  CHAT_STARTED: {
    label: 'Chat started',
    description: 'A new encrypted conversation was opened.',
    tone: 'neutral',
    icon: MessageCircle,
  },
  CHAT_MESSAGE_SENT: {
    label: 'Chat message sent',
    description: 'An encrypted message was delivered to a conversation.',
    tone: 'neutral',
    icon: MessageCircle,
  },
  CHAT_NOTE_SHARED: {
    label: 'Note shared in chat',
    description: 'A note card was sent into an encrypted conversation.',
    tone: 'positive',
    icon: MessageCircle,
  },
  CHAT_CLEARED: {
    label: 'Chat cleared',
    description: 'A conversation was hidden from your list until the next message.',
    tone: 'warning',
    icon: Eraser,
  },
  CHAT_DELETED: {
    label: 'Conversation deleted',
    description: 'You left a conversation; the message history is gone for you.',
    tone: 'warning',
    icon: Trash2,
  },
  CHAT_USER_BLOCKED: {
    label: 'User blocked',
    description: 'A user was blocked from messaging you in any conversation.',
    tone: 'danger',
    icon: Ban,
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
