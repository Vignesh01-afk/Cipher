import { prisma } from '../db';

/**
 * The complete set of auditable events.
 *
 * Keep this list in sync with `client/src/lib/auditActions.ts`, which maps the
 * values to human readable labels in the UI.
 */
export const AuditAction = {
  REGISTER: 'REGISTER',
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  NOTE_CREATE: 'NOTE_CREATE',
  NOTE_UPDATE: 'NOTE_UPDATE',
  NOTE_DELETE: 'NOTE_DELETE',
  NOTE_SHARE: 'NOTE_SHARE',
  SHARE_REVOKE: 'SHARE_REVOKE',
  ACCESS_DENIED: 'ACCESS_DENIED',
  FILE_CREATE: 'FILE_CREATE',
  FILE_DOWNLOAD: 'FILE_DOWNLOAD',
  FILE_DELETE: 'FILE_DELETE',
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  RECOVERY_SETUP: 'RECOVERY_SETUP',
  RECOVERY_CHALLENGE: 'RECOVERY_CHALLENGE',
  RECOVERY_CHALLENGE_FAILED: 'RECOVERY_CHALLENGE_FAILED',
  RECOVERY_RESET: 'RECOVERY_RESET',
  RECOVERY_RESET_FAILED: 'RECOVERY_RESET_FAILED',
} as const;

export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AUDIT_ACTION_VALUES: string[] = Object.values(AuditAction);

/**
 * Metadata is stored for forensic value only. It may contain identifiers,
 * counts and email addresses - never note titles, bodies, tags or key material.
 */
export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  userId: string;
  action: AuditAction;
  targetType?: 'USER' | 'NOTE' | 'SHARE' | 'FILE';
  targetId?: string;
  noteId?: string | null;
  metadata?: AuditMetadata;
  ipAddress?: string | null;
}

/**
 * Persist an audit event.
 *
 * Auditing is best-effort by design: a failure to write a log line must never
 * turn a successful user action into a 500, so errors are swallowed and logged.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        noteId: entry.noteId ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata).slice(0, 2000) : null,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  } catch (error) {
    console.error('[audit] failed to record event', entry.action, error);
  }
}

/** Normalises the IP address of a request for storage in the audit log. */
export function requestIp(req: { ip?: string; headers: Record<string, unknown> }): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim().slice(0, 100);
  }
  return req.ip ? req.ip.slice(0, 100) : null;
}
