import {
  Eye,
  Lock,
  Pencil,
  Share2,
  ShieldCheck,
  Tag,
  Trash2,
  Unlock,
  Users,
} from 'lucide-react';
import type { DecryptedNote } from '../lib/notes';
import { notePreview } from '../lib/notes';
import { formatRelativeTime, truncate } from '../lib/format';

interface NoteCardProps {
  note: DecryptedNote;
  onOpen: () => void;
  onEdit?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  onInspect?: () => void;
}

export function NoteCard({ note, onOpen, onEdit, onShare, onDelete, onInspect }: NoteCardProps): JSX.Element {
  const isOwner = note.role === 'owner';
  const activeShares = note.shares.filter((share) => share.isActive);

  return (
    <article className="card-interactive flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {isOwner ? (
            <Lock className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
          ) : (
            <Unlock className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden="true" />
          )}
          <h3 className="truncate text-base font-semibold text-slate-900 dark:text-slate-50" title={note.title}>
            {note.title || 'Untitled note'}
          </h3>
        </div>
        <span className={`badge shrink-0 ${isOwner ? 'badge-cyan' : 'badge-amber'}`}>
          {isOwner ? 'Owner' : 'Shared with me'}
        </span>
      </div>

      <p className="mt-3 line-clamp-4 flex-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
        {notePreview(note.content) || 'This note has no content yet.'}
      </p>

      {note.tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {note.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="badge badge-slate">
              <Tag className="h-3 w-3" />
              {tag}
            </span>
          ))}
          {note.tags.length > 4 ? (
            <span className="badge badge-slate">+{note.tags.length - 4}</span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span title={new Date(note.updatedAt).toString()}>Updated {formatRelativeTime(note.updatedAt)}</span>
        {isOwner ? (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {activeShares.length === 0
              ? 'Not shared'
              : `${activeShares.length} ${activeShares.length === 1 ? 'recipient' : 'recipients'}`}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1" title={note.owner.email}>
            From {truncate(note.owner.displayName, 24)}
          </span>
        )}
        <span className="inline-flex items-center gap-1">v{note.encryptionVersion}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-4 dark:border-slate-800">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onOpen}>
          <Eye className="h-3.5 w-3.5" />
          Open
        </button>

        {isOwner && onEdit ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
        ) : null}

        {isOwner && onShare ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onShare}>
            <Share2 className="h-3.5 w-3.5" />
            Share
          </button>
        ) : null}

        {onInspect ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onInspect}
            title="Open the security inspector for this note"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Inspect
          </button>
        ) : null}

        {isOwner && onDelete ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm ml-auto text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10"
            onClick={onDelete}
            title="Delete this note"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        ) : null}
      </div>
    </article>
  );
}
