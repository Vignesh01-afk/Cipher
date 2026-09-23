import type { Note, NoteShare } from '@prisma/client';
import { prisma } from '../db';
import { ApiError } from './http';

export type AccessRole = 'owner' | 'recipient';

export interface NoteAccess {
  note: Note;
  role: AccessRole;
  share: NoteShare | null;
  /** Every share that still grants access (revoked ones are filtered out). */
  activeShares: NoteShare[];
}

/**
 * The single authorization gate for notes.
 *
 * A caller may reach a note when they are the owner, or when they hold a share
 * that has not been revoked. Revoked shares are filtered out at the query level,
 * so revocation takes effect immediately for every future request.
 */
export async function requireNoteAccess(noteId: string, userId: string): Promise<NoteAccess> {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    include: { shares: true },
  });

  if (!note) {
    throw ApiError.notFound('That note does not exist', 'NOTE_NOT_FOUND');
  }

  const activeShares = note.shares.filter((share) => share.revokedAt === null);

  if (note.ownerId === userId) {
    return { note, role: 'owner', share: null, activeShares };
  }

  const share = activeShares.find((candidate) => candidate.sharedWithId === userId);
  if (!share) {
    // Deliberately explicit instead of a 404: the revoked user gets a clear
    // signal that access was withdrawn. See the threat model in the README for
    // the existence-disclosure trade-off this implies.
    throw ApiError.forbidden('You no longer have access to this note', 'NOTE_ACCESS_DENIED');
  }

  return { note, role: 'recipient', share, activeShares };
}

/**
 * True when the user once held a share on this note that has since been
 * revoked. Used to distinguish "you were removed" (which we log) from "you
 * never had access" (which we do not).
 */
export async function hasRevokedShare(noteId: string, userId: string): Promise<boolean> {
  const share = await prisma.noteShare.findUnique({
    where: { noteId_sharedWithId: { noteId, sharedWithId: userId } },
    select: { revokedAt: true },
  });
  return Boolean(share?.revokedAt);
}

/** Use for mutations that only the note owner is allowed to perform. */
export async function requireNoteOwnership(noteId: string, userId: string): Promise<Note> {
  const note = await prisma.note.findUnique({ where: { id: noteId } });
  if (!note) {
    throw ApiError.notFound('That note does not exist', 'NOTE_NOT_FOUND');
  }
  if (note.ownerId !== userId) {
    throw ApiError.forbidden('Only the note owner can perform this action', 'NOT_NOTE_OWNER');
  }
  return note;
}
