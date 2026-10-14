import { useCallback, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { Badge } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { api } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import {
  ChatUserDto,
  ConversationDetailDto,
} from '../lib/types';
import {
  ChatTeardropText,
  Info,
  ShieldCheck,
  MagnifyingGlass,
  FileText,
  Trash,
  Warning,
  Eye,
  Lock,
  X,
} from '@phosphor-icons/react';
import type { ReactElement } from 'react';

interface ChatInfoPanelProps {
  peer: ChatUserDto | null;
  detail: ConversationDetailDto | null;
  members: (ChatUserDto | { user: ChatUserDto })[];
  contextNoteId: string | null;
  activeId: string | null;
  online: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onOpenSecurityInspector: () => void;
  onOpenConversationInfo: () => void;
  onStartSearchInConversation: () => void;
  sharedNoteIds: Map<string, string>;
  hasBlockApi: boolean;
  hasDeleteApi: boolean;
}

function AvatarChip({ name, size = 'md', className = '' }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }): ReactElement {
  return (
    <div className={`flex items-center gap-3 rounded-lg border border-line bg-surface p-3 ${className}`.trim()}>
      <Avatar name={name} size={size} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-stone-900 dark:text-white">{name || 'Conversation'}</p>
        <p className="truncate text-xs text-stone-500 dark:text-stone-400">{name ? 'Chat contact' : 'Group chat'}</p>
      </div>
    </div>
  );
}

function memberId(m: ChatInfoPanelProps['members'][number]): string {
  return 'user' in m ? m.user.id : m.id;
}

function memberUser(m: ChatInfoPanelProps['members'][number]): ChatUserDto {
  return 'user' in m ? m.user : m;
}

export function ChatInfoPanel({
  peer,
  detail,
  members,
  contextNoteId,
  activeId,
  online,
  mobileOpen,
  onCloseMobile,
  onOpenSecurityInspector,
  onOpenConversationInfo,
  onStartSearchInConversation,
  sharedNoteIds,
  hasBlockApi,
  hasDeleteApi,
}: ChatInfoPanelProps): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const myId = user?.id ?? '';
  const displayName = peer?.displayName ?? 'Conversation';
  const cipherId = peer?.cipherId ?? '—';

  const memberCount = members.length;
  const username = peer?.username ?? null;
  const noteCount = sharedNoteIds.size;

  const handleBlock = useCallback(async () => {
    if (!activeId || !peer) return;
    try {
      await api.blockUser(peer.id);
      toast.success('User blocked', 'They cannot message you from any conversation.');
    } catch (error) {
      toast.error('Block failed', error instanceof Error ? error.message : 'Try again.');
    }
  }, [activeId, peer, toast]);

  const handleDelete = useCallback(async () => {
    if (!activeId) return;
    try {
      await api.deleteConversation(activeId);
      toast.success('Conversation deleted', 'You left and the messages are gone for you.');
      navigate('/chat');
    } catch (error) {
      toast.error('Delete failed', error instanceof Error ? error.message : 'Try again.');
    }
  }, [activeId, toast, navigate]);

  const header = (
    <div className="flex items-start gap-3">
      <Avatar name={displayName} size="lg" className="h-11 w-11" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-stone-900 dark:text-white">{displayName}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
          {online ? (
            <Badge variant="emerald" className="text-[11px]">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 mr-1.5 align-middle" />
              Online
            </Badge>
          ) : (
            <Badge variant="slate" className="text-[11px]">Offline</Badge>
          )}
          <span className="text-stone-400 dark:text-stone-500 font-mono">{cipherId}</span>
          {username ? (
            <span className="text-stone-500 dark:text-stone-400 truncate max-w-[140px]">@{username}</span>
          ) : null}
        </div>
      </div>
    </div>
  );

  const securitySection = (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Security</p>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-100 hover:text-ink dark:hover:bg-stone-800"
        onClick={onOpenSecurityInspector}
      >
        <ShieldCheck className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
        <span className="flex flex-col leading-tight">
          <span>End-to-end encrypted</span>
          <span className="text-[11px] text-stone-500 dark:text-stone-400">AES-GCM-256 per conversation key</span>
        </span>
      </button>
    </div>
  );

  const notesSection = (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
        <FileText className="h-3.5 w-3.5" />
        Shared notes in this chat ({noteCount})
      </p>
      {noteCount === 0 ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">No notes shared in this conversation yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {Array.from(sharedNoteIds.entries()).map(([noteId, title]) => (
            <li key={noteId} className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-sm">
              <span className="truncate flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-stone-400" />
                <span className="truncate">{title}</span>
              </span>
              <span className="shrink-0 ml-2 font-mono text-[11px] text-stone-400">{noteId.slice(0, 12)}…</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const actionsSection = (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">Actions</p>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-100 hover:text-ink dark:hover:bg-stone-800"
        onClick={() => {
          onStartSearchInConversation();
          onCloseMobile();
        }}
      >
        <MagnifyingGlass className="h-4 w-4 shrink-0 text-stone-400" />
        Search in conversation
      </button>

      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-100 hover:text-ink dark:hover:bg-stone-800"
        onClick={onOpenConversationInfo}
      >
        <Info className="h-4 w-4 shrink-0 text-stone-400" />
        Conversation info
      </button>

      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-stone-500 dark:text-stone-400"
        onClick={handleDelete}
        disabled={!hasDeleteApi}
        title={hasDeleteApi ? undefined : 'Not available yet'}
      >
        <Trash className="h-3.5 w-3.5 shrink-0" />
        Delete conversation
      </Button>

      {hasBlockApi ? (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-rose-600 dark:text-rose-300"
          onClick={handleBlock}
        >
          <Warning className="h-3.5 w-3.5 shrink-0" />
          Block user
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-stone-500 dark:text-stone-400"
          disabled
          title="Not available yet"
        >
          <Warning className="h-3.5 w-3.5 shrink-0" />
          Block user
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-stone-500 dark:text-stone-400"
        disabled
        title="Not available yet"
      >
        <Eye className="h-3.5 w-3.5 shrink-0" />
        Report user
      </Button>
    </div>
  );

  const mobilePanel = (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex flex-1 items-end">
        <div className="card max-w-sm w-full p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-stone-900 dark:text-white">Conversation details</h2>
            <button type="button" className="btn btn-ghost p-1.5" onClick={onCloseMobile} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>

          {header}

          <div className="border-t border-line pt-3 space-y-3">
            {securitySection}
            {notesSection}
            {actionsSection}
          </div>
        </div>
      </div>
      <div className="flex flex-1 bg-scrim/40" onClick={onCloseMobile} />
    </div>
  );

  const desktopPanel = (
    <div className="space-y-4">
      {header}

      <div className="border-t border-line pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-400 mb-2">Members ({memberCount})</p>
        <ul className="space-y-1.5">
          {members.map((m) => {
            const member = memberUser(m);
            const isMe = member.id === myId;
            return (
              <li key={member.id} className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar name={member.displayName} size="sm" />
                  <span className="truncate text-stone-700 dark:text-stone-200">{member.displayName}</span>
                  {isMe ? <span className="shrink-0 text-[11px] text-stone-400">(me)</span> : null}
                </div>
                <span className="shrink-0 ml-2 font-mono text-[11px] text-stone-400">{member.cipherId}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {contextNoteId ? (
        <div className="rounded-md border border-orange-200/80 bg-orange-50/40 p-3 dark:border-orange-500/20 dark:bg-orange-500/5">
          <div className="flex items-center gap-2 text-sm text-stone-700 dark:text-orange-200">
            <FileText className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
            <span className="flex flex-col leading-tight">
              <span>Opened from note</span>
              <span className="font-mono text-[11px]">{contextNoteId.slice(0, 12)}…</span>
            </span>
          </div>
        </div>
      ) : null}

      <div className="border-t border-line pt-3 space-y-3">
        {securitySection}
        {notesSection}
        {actionsSection}
      </div>
    </div>
  );

  return (
    <>
      {mobileOpen ? mobilePanel : null}
      {!mobileOpen ? desktopPanel : null}

      <Modal
        open={mobileOpen}
        onClose={onCloseMobile}
        title="Conversation details"
        description="Read-only details about this conversation."
        size="sm"
      >
        {desktopPanel}
      </Modal>
    </>
  );
}
