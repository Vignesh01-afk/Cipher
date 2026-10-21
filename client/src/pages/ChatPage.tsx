import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Spinner } from '../components/Spinner';
import { Skeleton } from '../components/Skeleton';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { ChatShareNoteModal } from '../components/ChatShareNoteModal';
import { ChatInfoPanel } from './chat-info-panel';
import { api } from '../lib/api';
import { initials, formatDateTime, formatRelativeTime } from '../lib/format';
import {
  createConversationKey,
  decryptChatMessage,
  encryptChatMessage,
  openConversationKey,
  wrapConversationKeyForMembers,
  type ChatMessagePayload,
  type ConversationCrypto,
} from '../lib/chatCrypto';
import { ensureJoined, emitIfConnected, getChatSocket } from '../lib/chatSocket';
import { chatPublicKeyCache } from '../lib/chatKeys';
import {
  Lock,
  ArrowLeft,
  ChatTeardropText,
  MagnifyingGlass,
  ShareNetwork,
  Info,
  ShieldCheck,
  FileText,
  Checks,
  Paperclip,
  Smiley,
  PaperPlaneTilt,
  X,
} from '@phosphor-icons/react';
import type { ReactElement } from 'react';
import type {
  ChatMessageDto,
  ChatUserDto,
  ConversationDetailDto,
  ConversationDto,
} from '../lib/types';

/** A decrypted message in local UI state. */
interface LocalMessage {
  id: string;
  clientId: string;
  senderId: string;
  payload: ChatMessagePayload;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  status: 'sending' | 'sent' | 'failed';
}

const STATUS_LABEL: Record<LocalMessage['status'], string> = {
  sending: 'Sending…',
  sent: 'Sent',
  failed: 'Failed',
};

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return 'Today';
  if (same(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function ChatPage(): ReactElement {
  const { user, keys } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<ConversationDetailDto | null>(null);
  const [convCrypto, setConvCrypto] = useState<ConversationCrypto | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerOnline, setPeerOnline] = useState(false);
  const [connected, setConnected] = useState(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ChatUserDto[]>([]);
  const [searching, setSearching] = useState(false);
  const [startingChat, setStartingChat] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);

  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'clear' | 'block' | 'delete' | null>(null);
  const [inConvSearch, setInConvSearch] = useState(false);
  const [convSearchQuery, setConvSearchQuery] = useState('');
  const [shareNoteOpen, setShareNoteOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoPanelOpen, setInfoPanelOpen] = useState(true);
  const [pendingDeepLinkUserId, setPendingDeepLinkUserId] = useState<string | null>(null);
  const [infoPanelMobileOpen, setInfoPanelMobileOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const searchParams = useSearchParams()[0];

  const typingTimer = useRef<number | null>(null);
  const openSeqRef = useRef(0);
  const messagesRef = useRef<LocalMessage[]>([]);
  const myUserId = user?.id ?? '';

  useEffect(() => {
    const target = searchParams.get('user');
    if (target && target !== myUserId) setPendingDeepLinkUserId(target);
  }, [searchParams, myUserId]);

  useEffect(() => {
    if (!pendingDeepLinkUserId || loadingList) return;
    const existing = conversations.find((c) => c.participants.some((p) => p.id === pendingDeepLinkUserId));
    if (existing) {
      void openConversation(existing.id);
    } else {
      setSearchOpen(true);
    }
    setPendingDeepLinkUserId(null);
  }, [pendingDeepLinkUserId, loadingList, conversations]);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;
  const contextNoteId = activeDetail?.contextNoteId ?? activeConversation?.contextNoteId ?? null;
  const resolvedMembers = activeDetail?.members ?? activeConversation?.participants ?? [];
  const peer = useMemo(() => {
    const list = resolvedMembers;
    return list.map((m) => ('user' in m ? m.user : m)).find((p) => p.id !== myUserId) ?? null;
  }, [resolvedMembers, myUserId]);

  const refreshList = useCallback(async (): Promise<ConversationDto[]> => {
    const result = await api.listConversations();
    setConversations(result.conversations);
    ensureJoined(result.conversations.map((c) => c.id));
    return result.conversations;
  }, []);

  useEffect(() => {
    if (!keys) return;
    void refreshList().finally(() => setLoadingList(false));
  }, [keys, refreshList]);

  useEffect(() => {
    if (!keys || !myUserId) return;
    const socket = getChatSocket();
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    setConnected(socket.connected);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [keys, myUserId]);

  const openConversation = useCallback(
    async (conversationId: string): Promise<void> => {
      if (!keys) return;
      const seq = ++openSeqRef.current;
      setActiveId(conversationId);
      setMessages([]);
      setConvCrypto(null);
      setPeerTyping(false);

      ensureJoined([conversationId]);

      try {
        const detail = (await api.getConversation(conversationId)).conversation;
        if (seq !== openSeqRef.current) return;
        setActiveDetail(detail);

        const mine = detail.members.find((m) => m.user.id === myUserId);
        let opened: ConversationCrypto | null = null;
        if (mine?.wrappedConversationKey) {
          opened = await openConversationKey(mine.wrappedConversationKey, keys);
          if (seq !== openSeqRef.current) return;
          setConvCrypto(opened);
        }

        for (const m of detail.members) {
          if (m.user.id === myUserId) {
            if (user?.publicKey) {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
              chatPublicKeyCache.set(
                m.user.id,
                user.publicKey,
              );
            }
            continue;
          }
          try {
            const handle = m.user.username ?? m.user.cipherId;
            const found = await api.searchUsers(handle);
            const match = found.users.find((u) => u.id === m.user.id);
            if (match?.publicKey) {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
              chatPublicKeyCache.set(
                m.user.id,
                match.publicKey,
              );
            }
          } catch {
            // non-fatal: sends needing the key will surface an error
          }
        }

        const page = await api.listMessages(conversationId, { limit: 50 });
        setNextCursor(page.nextCursor);

        const decrypted: LocalMessage[] = [];
        for (const m of page.messages) {
          if (!opened) break;
          try {
            const payload = await decryptChatMessage(opened.key, m.ciphertext, m.iv);
            decrypted.push({
              id: m.id,
              clientId: m.clientId ?? m.id,
              senderId: m.senderId,
              payload,
              createdAt: m.createdAt,
              deliveredAt: m.deliveredAt,
              readAt: m.readAt,
              status: 'sent',
            });
          } catch {
            decrypted.push({
              id: m.id,
              clientId: m.clientId ?? m.id,
              senderId: m.senderId,
              payload: { v: 1, type: 'text', text: 'Unable to decrypt this message' },
              createdAt: m.createdAt,
              deliveredAt: m.deliveredAt,
              readAt: m.readAt,
              status: 'sent',
            });
          }
        }
        if (seq !== openSeqRef.current) return;
        decrypted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        setMessages((existing) => {
          const known = new Set(decrypted.map((m) => m.clientId));
          const preserved = existing.filter((m) => !known.has(m.clientId));
          return [...decrypted, ...preserved];
        });

        await api.markConversationRead(conversationId);
        if (emitIfConnected('chat:read', { conversationId })) {
          setConversations((list) =>
            list.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)),
          );
        }
      } finally {
        setLoadingThread(false);
      }
    },
    [keys, myUserId, user],
  );

  useEffect(() => {
    if (!keys || !myUserId) return;
    const socket = getChatSocket();

    async function onMessage(raw: unknown) {
      const m = raw as ChatMessageDto;
      setConversations((list) =>
        list.map((c) =>
          c.id === m.conversationId
            ? {
                ...c,
                updatedAt: m.createdAt,
                lastMessage: {
                  id: m.id,
                  senderId: m.senderId,
                  createdAt: m.createdAt,
                  readAt: null,
                  deliveredAt: null,
                  hasPayload: true,
                },
                unreadCount:
                  m.senderId !== myUserId && c.id !== activeId ? c.unreadCount + 1 : c.unreadCount,
              }
            : c),
      );

      // FIX 10: a message from the partner means they are no longer typing.
      if (m.conversationId === activeId && m.senderId !== myUserId) {
        setPeerTyping(false);
      }

      if (m.conversationId !== activeId || !convCrypto) return;

      try {
        const payload = await decryptChatMessage(convCrypto.key, m.ciphertext, m.iv);
        setMessages((list) => {
          if (list.some((x) => x.clientId === m.clientId)) return list;
          return [
            ...list,
            {
              id: m.id,
              clientId: m.clientId ?? m.id,
              senderId: m.senderId,
              payload,
              createdAt: m.createdAt,
              deliveredAt: m.deliveredAt,
              readAt: m.readAt,
              status: 'sent',
            },
          ];
        });
        if (m.senderId !== myUserId) {
          void api.markConversationRead(m.conversationId);
          emitIfConnected('chat:read', { conversationId: m.conversationId });
          emitIfConnected('chat:delivered', { conversationId: m.conversationId, messageId: m.id });
        }
      } catch {
        setMessages((list) => [
          ...list,
          {
            id: m.id,
            clientId: m.clientId ?? m.id,
            senderId: m.senderId,
            payload: { v: 1, type: 'text', text: 'Unable to decrypt this message' },
            createdAt: m.createdAt,
            deliveredAt: m.deliveredAt,
            readAt: m.readAt,
            status: 'sent',
          },
        ]);
      }
    }

    // FIX 10: clear the typing indicator 4s after the last typing event,
    // and immediately when a message from that partner arrives (handled in
    // onMessage above). Do not change the socket event names.
    const onTyping = (p: { conversationId: string; userId: string; typing: boolean }) => {
      if (p.conversationId !== activeId || p.userId === myUserId) return;
      setPeerTyping(p.typing);
      if (p.typing) {
        if (typingTimer.current) window.clearTimeout(typingTimer.current);
        typingTimer.current = window.setTimeout(() => {
          setPeerTyping(false);
        }, 4000);
      } else {
        if (typingTimer.current) window.clearTimeout(typingTimer.current);
      }
    };

    const onReceipt = (p: { conversationId: string; messageId?: string; status: string; at: string }) => {
      if (p.conversationId !== activeId) return;
      setMessages((list) =>
        list.map((msg) =>
          msg.senderId === myUserId && (p.status === 'read' || msg.readAt === null)
            ? {
                ...msg,
                readAt: p.status === 'read' ? p.at : msg.readAt,
                deliveredAt: p.status === 'delivered' ? p.at : msg.deliveredAt,
              }
            : msg,
        ),
      );
    };

    const onPresence = (p: { conversationId: string; userId: string; online: boolean }) => {
      if (p.conversationId !== activeId) return;
      setPeerOnline((current) => (p.userId === peer?.id ? p.online : current));
    };

    const onPresenceState = (p: { conversationId: string; online: string[] }) => {
      if (p.conversationId !== activeId) return;
      setPeerOnline(peer ? p.online.includes(peer.id) : false);
    };

    const onError = (p: { code: string; clientId: string | null }) => {
      if (p.code === 'CHAT_BLOCKED') {
        toast.warning('Message not sent', 'This conversation is blocked.');
      } else if (p.clientId) {
        setMessages((list) =>
          list.map((m) => (m.clientId === p.clientId ? { ...m, status: 'failed' } : m)),
        );
      }
    };

    const onActivity = (p: { conversationId: string; senderId: string }) => {
      if (p.senderId === myUserId) return;
      void refreshList().catch(() => undefined);
    };

    socket.on('chat:message', onMessage);
    socket.on('chat:typing', onTyping);
    socket.on('chat:receipt', onReceipt);
    socket.on('presence:update', onPresence);
    socket.on('presence:state', onPresenceState);
    socket.on('chat:error', onError);
    socket.on('chat:activity', onActivity);

    return () => {
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
      socket.off('chat:message', onMessage);
      socket.off('chat:typing', onTyping);
      socket.off('chat:receipt', onReceipt);
      socket.off('presence:update', onPresence);
      socket.off('presence:state', onPresenceState);
      socket.off('chat:error', onError);
      socket.off('chat:activity', onActivity);
    };
  }, [keys, myUserId, activeId, convCrypto, peer, toast, refreshList]);

  useEffect(() => {
    if (!keys || !activeId || !convCrypto) return;

    const conversationId = activeId;
    const conversationKey = convCrypto.key;
    let cancelled = false;

    async function poll(): Promise<void> {
      if (cancelled || document.hidden) return;
      try {
        const page = await api.listMessages(conversationId, { limit: 30 });
        if (cancelled) return;

        const fresh: LocalMessage[] = [];
        for (const m of page.messages) {
          try {
            const payload = await decryptChatMessage(conversationKey, m.ciphertext, m.iv);
            fresh.push({
              id: m.id,
              clientId: m.clientId ?? m.id,
              senderId: m.senderId,
              payload,
              createdAt: m.createdAt,
              deliveredAt: m.deliveredAt,
              readAt: m.readAt,
              status: 'sent',
            });
          } catch {
            // skip undecryptable
          }
        }
        if (cancelled) return;

        const known = new Set(messagesRef.current.map((x) => x.clientId));
        const hasNew = fresh.some((m) => !known.has(m.clientId));
        if (hasNew) {
          setMessages((list) => {
            const knownNow = new Set(list.map((x) => x.clientId));
            const additions = fresh.filter((m) => !knownNow.has(m.clientId));
            if (additions.length === 0) return list;
            return [...list, ...additions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          });
        }

        // FIX 10 (polling fallback): a freshly delivered partner message
        // means they are no longer typing, even when the socket path is down.
        if (hasNew && fresh.some((m) => m.senderId !== myUserId)) {
          setPeerTyping(false);
          void api.markConversationRead(conversationId).catch(() => undefined);
          emitIfConnected('chat:read', { conversationId });
        }
        void refreshList().catch(() => undefined);
      } catch {
        // transient network error - retry on next tick
      }
    }

    const interval = window.setInterval(() => void poll(), 4000);
    const onVisibility = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    void poll();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [keys, activeId, convCrypto, myUserId, refreshList]);

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (!activeId || !emitIfConnected('chat:typing', { conversationId: activeId, typing: true })) return;
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => {
      emitIfConnected('chat:typing', { conversationId: activeId, typing: false });
    }, 2500);
  };

  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    if (!text || !activeId || !convCrypto || !keys || sending) return;

    const clientId = crypto.randomUUID();
    const optimistic: LocalMessage = {
      id: clientId,
      clientId,
      senderId: myUserId,
      payload: { v: 1, type: 'text', text },
      createdAt: new Date().toISOString(),
      deliveredAt: null,
      readAt: null,
      status: 'sending',
    };
    setMessages((list) => [...list, optimistic]);
    setDraft('');
    setSending(true);

    try {
      const { ciphertext, iv, payloadBytes } = await encryptChatMessage(convCrypto.key, {
        v: 1,
        type: 'text',
        text,
      });

      const detail = activeDetail;
      const memberIds = (detail?.members ?? []).map((m) => m.user.id);
      const publicKeys: Record<string, string> = {};
      for (const id of memberIds) {
        const cached = chatPublicKeyCache.get(id);
        if (cached) publicKeys[id] = cached;
      }
      const wrapped =
        Object.keys(publicKeys).length === memberIds.length
          ? await wrapConversationKeyForMembers(convCrypto.conversationKeyRaw, publicKeys)
          : null;

      let sent: ChatMessageDto | null = null;
      if (wrapped && emitIfConnected('chat:send', { conversationId: activeId, clientId, message: { ciphertext, iv, payloadBytes }, wrappedConversationKeys: wrapped })) {
        // Socket path: server upserts + broadcasts; ack arrives as chat:message.
      } else {
        const payload: Record<string, unknown> = { ciphertext, iv, clientId, payloadBytes };
        if (wrapped) payload.wrappedConversationKeys = wrapped;
        const result = await api.sendMessage(activeId, payload as Parameters<typeof api.sendMessage>[1]);
        sent = result.message;
      }

      setMessages((list) =>
        list.map((m) =>
          m.clientId === clientId
            ? {
                ...m,
                id: sent?.id ?? clientId,
                status: 'sent',
                createdAt: sent?.createdAt ?? m.createdAt,
              }
            : m,
        ),
      );
    } catch {
      setMessages((list) =>
        list.map((m) => (m.clientId === clientId ? { ...m, status: 'failed' } : m)),
      );
      toast.error('Message not sent', 'It could not be encrypted or delivered.');
    } finally {
      setSending(false);
    }
  }, [draft, activeId, convCrypto, keys, sending, myUserId, activeDetail, toast]);

  useEffect(() => {
    if (!searchOpen) return;
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const handle = window.setTimeout(async () => {
      try {
        const result = await api.searchUsers(q);
        setSearchResults(result.users);
        for (const u of result.users) {
          if (u.publicKey) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            chatPublicKeyCache.set(u.id, u.publicKey);
          }
        }
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchQuery, searchOpen]);

  async function startChatWith(target: ChatUserDto): Promise<void> {
    if (!keys || startingChat) return;
    setStartingChat(true);
    try {
      if (!target.publicKey) {
        toast.error('Cannot open chat', 'That user has no public key registered.');
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      chatPublicKeyCache.set(target.id, target.publicKey);

      const convKey = await createConversationKey();
      const wrapped = await wrapConversationKeyForMembers(convKey.conversationKeyRaw, {
        [myUserId]: user?.publicKey ?? '',
        [target.id]: target.publicKey,
      });

      const result = await api.startConversation({
        recipientId: target.id,
        wrappedKeys: wrapped,
      });

      if (!result.conversation.reused && result.conversation.wrappedConversationKey === null) {
        toast.error('Chat not created', 'The server did not accept the key wraps.');
        return;
      }

      await refreshList();
      setSearchOpen(false);
      setSearchQuery('');
      setSearchResults([]);
      await openConversation(result.conversation.id);
    } catch (error) {
      toast.error(
        'Chat not created',
        error instanceof Error ? error.message : 'Could not start the conversation.',
      );
    } finally {
      setStartingChat(false);
    }
  }

  const sendShareCard = useCallback(
    async ({ noteId, title }: { noteId: string; title: string }): Promise<void> => {
      if (!activeId || !convCrypto || !keys) throw new Error('Open the conversation first.');

      const clientId = crypto.randomUUID();
      const { ciphertext, iv, payloadBytes } = await encryptChatMessage(convCrypto.key, {
        v: 1,
        type: 'note-share',
        note: { id: noteId, title, sharedViaChat: true },
      });

      const wrappedKeys = await wrapsForActiveMembers();
      await api.sendMessage(activeId, {
        ciphertext,
        iv,
        clientId,
        payloadBytes,
        wrappedConversationKeys: wrappedKeys,
        kind: 'note-share',
        noteId,
      });

      setMessages((list) => [
        ...list,
        {
          id: clientId,
          clientId,
          senderId: myUserId,
          payload: { v: 1, type: 'note-share', note: { id: noteId, title, sharedViaChat: true } },
          createdAt: new Date().toISOString(),
          deliveredAt: null,
          readAt: null,
          status: 'sent',
        },
      ]);
    },
    [activeId, convCrypto, keys, myUserId],
  );

  const wrapsForActiveMembers = useCallback(async (): Promise<Record<string, string>> => {
    if (!activeDetail || !convCrypto) throw new Error('Conversation is not ready.');
    const publicKeys: Record<string, string> = {};
    for (const m of activeDetail.members) {
      const pk =
        m.user.id === myUserId
          ? (user?.publicKey ?? chatPublicKeyCache.get(m.user.id))
          : chatPublicKeyCache.get(m.user.id);
      if (pk) publicKeys[m.user.id] = pk;
    }
    if (Object.keys(publicKeys).length < activeDetail.members.length) {
      throw new Error('Recipient public keys are not cached yet.');
    }
    return wrapConversationKeyForMembers(convCrypto.conversationKeyRaw, publicKeys);
  }, [activeDetail, convCrypto, myUserId, user]);

  async function runConfirmAction(): Promise<void> {
    if (!activeId || !confirmAction) return;
    try {
      if (confirmAction === 'clear') {
        await api.hideConversation(activeId);
        toast.success('Chat cleared', 'It is hidden from your list until the next message.');
        await refreshList();
        setActiveId(null);
        setMessages([]);
      } else if (confirmAction === 'block' && peer) {
        await api.blockUser(peer.id);
        toast.success('User blocked', 'They cannot message you from any conversation.');
      } else if (confirmAction === 'delete') {
        await api.deleteConversation(activeId);
        toast.success('Conversation deleted', 'You left and the messages are gone for you.');
        await refreshList();
        setActiveId(null);
        setMessages([]);
      }
    } catch (error) {
      toast.error('Action failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setConfirmAction(null);
      setMenuOpen(false);
    }
  }

  async function loadOlder(): Promise<void> {
    if (!activeId || !nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await api.listMessages(activeId, { cursor: nextCursor, limit: 50 });
      setNextCursor(page.nextCursor);
      if (convCrypto) {
        const decrypted: LocalMessage[] = [];
        for (const m of page.messages) {
          try {
            const payload = await decryptChatMessage(convCrypto.key, m.ciphertext, m.iv);
            decrypted.push({
              id: m.id,
              clientId: m.clientId ?? m.id,
              senderId: m.senderId,
              payload,
              createdAt: m.createdAt,
              deliveredAt: m.deliveredAt,
              readAt: m.readAt,
              status: 'sent',
            });
          } catch {
            // skip undecryptable
          }
        }
        setMessages((list) => [...decrypted.reverse(), ...list]);
      }
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, peerTyping, activeId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const visibleMessages = useMemo(() => {
    if (!inConvSearch || !convSearchQuery.trim()) return messages;
    const q = convSearchQuery.toLowerCase();
    return messages.filter((m) => m.payload.text?.toLowerCase().includes(q));
  }, [messages, inConvSearch, convSearchQuery]);

  const sharedNoteIds = useMemo(() => {
    const ids = new Map<string, string>();
    for (const m of messages) {
      if (m.payload.type === 'note-share' && m.payload.note?.id) {
        ids.set(m.payload.note.id, m.payload.note.title ?? 'Note');
      }
    }
    return ids;
  }, [messages]);

  const hasChatAttachApi = false;
  const emojiSet = ['😀', '😂', '❤️', '👍', '🔒', '🔑', '📝', '🤝'];

  if (!keys) {
    return (
      <div className="card p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted" />
        <h2 className="mt-3 text-lg font-semibold text-ink dark:text-paper">Vault locked</h2>
        <p className="mt-1 text-sm text-muted dark:text-muted">
          Unlock your vault to open encrypted chat. Keys stay in memory only.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {!activeId ? (
        <section className="card p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-ink dark:text-paper">Chat</h1>
                <p className="mt-1 text-sm text-muted dark:text-muted">
                  Secure conversations with your trusted contacts.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setSearchOpen(true)}
              >
                <ChatTeardropText className="h-4 w-4" />
                New Chat
              </button>
            </div>

            <div className="mt-4">
              <div className="relative">
                <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  className="input pl-10"
                  placeholder="Search contacts..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setSearchOpen(true)}
                  aria-label="Search contacts"
                />
              </div>
            </div>

            {searchOpen ? (
              <div className="mt-4 card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <MagnifyingGlass className="h-4 w-4 shrink-0 text-stone-400" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-stone-400">Users</span>
                  <span className="text-xs text-stone-400">·</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                    {searching ? 'Searching…' : `${searchResults.length} contact${searchResults.length === 1 ? '' : 's'}`}
                  </span>
                </div>

                {searching ? (
                  <div className="mt-3 flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : searchResults.length === 0 ? (
                  <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">No contacts match that search.</p>
                ) : (
                  <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto">
                    {searchResults.map((target) => (
                      <li
                        key={target.id}
                        className="flex items-center gap-3 rounded-md border border-line p-3"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-paper text-sm font-bold">
                          {initials(target.displayName)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-stone-900 dark:text-white">
                            {target.displayName}
                          </p>
                          <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                            {target.cipherId}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={startingChat}
                          onClick={() => void startChatWith(target)}
                        >
                          {startingChat ? <Spinner /> : <ChatTeardropText className="h-4 w-4" />}
                          Start chat
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
        </section>
      ) : null}

      {loadingList ? (
        <div className="card space-y-3 p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : conversations.length === 0 ? (
            <div className="card p-8 text-center">
              <ChatTeardropText className="mx-auto h-8 w-8 text-stone-400" />
              <h2 className="mt-3 text-lg font-semibold text-stone-900 dark:text-white">No conversations yet</h2>
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                Start a secure chat with any of your CipherNote contacts. Use the New Chat button above.
              </p>
            </div>
          ) : (
            <div className="flex flex-1 overflow-hidden">
              {/* Below lg the conversation list is replaced by the open thread:
                  the fixed 340px basis otherwise squeezes the thread (and the
                  composer) into a few pixels at 390px. The thread's lg:hidden
                  back button returns to this list. */}
              <section
                className={`card flex-col overflow-y-auto ${activeId ? 'hidden lg:flex' : 'flex'}`}
                style={{ maxWidth: '340px', flex: '0 0 340px' }}
              >
                <div className="p-4 pb-2">
                  <div className="relative">
                    <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      type="search"
                      className="input pl-10"
                      placeholder="Search conversations..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onFocus={() => setSearchOpen(true)}
                      aria-label="Search conversations"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-stone-500 dark:text-stone-400">{conversations.length} conversation{conversations.length === 1 ? '' : 's'}</span>
                    <button
                      type="button"
                      className="text-stone-500 dark:text-stone-400 hover:text-ink"
                      onClick={() => setMenuOpen((open) => !open)}
                    >
                      ⋮
                    </button>
                  </div>

                  {menuOpen && (
                    <div className="border-t border-line px-4 py-3 space-y-2">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-md p-2 text-left text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800"
                        onClick={() => { setMenuOpen(false); setInConvSearch(true); setConvSearchQuery(''); }}
                      >
                        <span className="flex items-center gap-2">
                          <MagnifyingGlass className="h-3.5 w-3.5" />
                          Search in conversation
                        </span>
                        <span className="text-stone-400">⌘F</span>
                      </button>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-md p-2 text-left text-sm text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800"
                        onClick={() => { setMenuOpen(false); setInspectorOpen(true); }}
                      >
                        <span className="flex items-center gap-2">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          Conversation security
                        </span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="px-4">
                  {conversations.map((conv) => {
                    const last = conv.lastMessage;
                    const other = conv.participants.find((p) => p.id !== myUserId) ?? null;
                    /* FIX 9: the second line must NEVER be a raw conversation or
                       message id. It shows the relative time of the last activity
                       ("just now", "5 minutes ago"), falling back to the contact's
                       CipherNote id when there is no usable activity time. The
                       selected row uses bg-accent/15 (Tailwind v4 opacity
                       modifier - the old `bg-accent bg-opacity-15` pair painted a
                       ~46% indigo that dropped text-muted to 1.9:1 contrast), so
                       the muted subtitle stays readable there too. */
                    const activityAt = last?.createdAt ?? conv.updatedAt;
                    const activityTime = Number.isNaN(new Date(activityAt).getTime())
                      ? null
                      : formatRelativeTime(activityAt);
                    const subtitleText = activityTime ?? other?.cipherId ?? '';
                    return (
                      <button
                        key={conv.id}
                        type="button"
                        className={`flex w-full flex-col gap-1 border-b border-line p-4 text-left transition hover:bg-stone-100 dark:hover:bg-stone-800 ${
                          activeId === conv.id ? 'bg-accent/15 border-accent' : ''
                        }`}
                        onClick={() => void openConversation(conv.id)}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar name={other?.displayName ?? 'Chat'} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-ink">
                              {other?.displayName ?? 'Chat'}
                            </p>
                            <p className="truncate text-xs text-muted">
                              {last && last.senderId === myUserId ? 'You: ' : ''}
                              {subtitleText}
                              {conv.unreadCount > 0 ? (
                                <span className="ml-2 inline-flex items-center justify-center rounded border border-accent bg-accent text-paper px-2 py-0.5 text-[10px] font-bold">
                                  {conv.unreadCount}
                                </span>
                              ) : null}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="flex flex-1 flex-col overflow-hidden">
                {activeId ? (
                  <>
                    <div className="card flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
                      <div className="flex items-center gap-3">
                        {/* Mobile: back to the conversation list (the list pane is
                            replaced once a conversation is open on small screens). */}
                        <button
                          type="button"
                          className="btn btn-ghost -ml-2 p-2 lg:hidden"
                          onClick={() => {
                            setActiveId(null);
                            setMessages([]);
                          }}
                          aria-label="Back to conversations"
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </button>
                        <Avatar
                          name={peer?.displayName ?? 'Conversation'}
                          size="md"
                          className="h-9 w-9"
                        />
                        <div>
                          <p className="text-sm font-semibold text-stone-900 dark:text-white">
                            {peer?.displayName ?? 'Conversation'}
                          </p>
                          <p className="text-[11px] text-stone-400 dark:text-stone-500">
                            {peerOnline ? 'Online' : 'Offline'} · {timeLabel(activeDetail?.createdAt ?? '')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost p-2"
                          onClick={() => setShareNoteOpen(true)}
                          aria-label="Share a note in this chat"
                        >
                          <ShareNetwork className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost p-2"
                          onClick={() => setInfoOpen(true)}
                          aria-label="Conversation info"
                        >
                          <Info className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost p-2"
                          onClick={() => setInspectorOpen(true)}
                          aria-label="Conversation security"
                        >
                          <ShieldCheck className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost p-2"
                          onClick={() => setInfoPanelMobileOpen(true)}
                          aria-label="Conversation details"
                        >
                          <ChatTeardropText className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                      {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <div className="flex h-14 w-14 items-center justify-center rounded-md border border-line bg-surface text-muted">
                            <Lock className="h-6 w-6" />
                          </div>
                          <h3 className="mt-4 text-base font-bold text-stone-800 dark:text-stone-100">
                            No messages yet
                          </h3>
                          <p className="mt-1 max-w-sm text-sm leading-6 text-stone-500 dark:text-stone-400">
                            Messages are encrypted end-to-end. Your key is held in memory and you only need your
                            password to unlock it.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-6" role="log" aria-label="Messages">
                          {messages.map((msg) => {
                            const isMe = msg.senderId === myUserId;
                            const payload = isMe
                              ? msg.payload
                              : { ...msg.payload };
                            const note = payload.type === 'note-share' ? payload.note : undefined;

                            return (
                              <div
                                key={msg.id}
                                className={`chat-message ${isMe ? 'justify-end' : 'justify-start'}`}
                              >
                                <div
                                  className={`max-w-[68%] rounded-md border px-4 py-2.5 text-sm leading-6 ${
                                    isMe
                                      ? 'border-accent bg-accent text-paper'
                                      : 'border-line bg-surface text-ink'
                                  }`}
                                >
                                  {!isMe ? (
                                    <div className="flex items-center gap-2 mb-1">
                                      <Avatar name={peer?.displayName ?? 'User'} size="sm" />
                                      <span className="text-[11px] font-semibold text-stone-400 dark:text-stone-500">
                                        {peer?.displayName ?? 'Contact'}
                                      </span>
                                    </div>
                                  ) : null}
                                  {note ? (
                                    <div className="mb-1 flex items-center gap-2 rounded border border-line bg-surface px-3 py-2 text-xs text-muted">
                                      <FileText className="h-3.5 w-3.5 shrink-0" />
                                      <span>Shared note card</span>
                                    </div>
                                  ) : null}
                                  <p className="leading-relaxed">{payload.text}</p>
                                  <div className="mt-1 flex items-center justify-end gap-2">
                                    <span>{timeLabel(msg.createdAt)}</span>
                                    {/* Receipts apply to OUR messages: they flip to
                                        Delivered/Read as the socket reports receipts. */}
                                    {isMe ? (
                                      <span
                                        className="flex items-center gap-1 text-[11px] text-stone-400"
                                        aria-label={
                                          msg.status === 'failed'
                                            ? 'Failed'
                                            : msg.readAt
                                              ? 'Read'
                                              : msg.deliveredAt
                                                ? 'Delivered'
                                                : STATUS_LABEL[msg.status]
                                        }
                                      >
                                        <Checks className="h-3 w-3" />
                                        {msg.status === 'failed'
                                          ? 'Failed'
                                          : msg.readAt
                                            ? 'Read'
                                            : msg.deliveredAt
                                              ? 'Delivered'
                                              : STATUS_LABEL[msg.status]}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {peerTyping ? (
                            <div className="chat-message justify-start" aria-label="Partner is typing">
                              <div className="max-w-[68%] rounded-md border border-line bg-surface px-4 py-3 text-sm text-muted">
                                <span className="flex items-center gap-2 text-[11px] font-semibold text-muted">
                                  {peer?.displayName ?? 'Contact'}
                                </span>
                                Typing
                              </div>
                            </div>
                          ) : null}
                          <div ref={bottomRef} />
                        </div>
                      )}

                      {inConvSearch ? (
                        <div className="mt-4 card p-4">
                          <div className="flex items-center gap-2">
                            <MagnifyingGlass className="h-4 w-4 shrink-0 text-stone-400" />
                            <span className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                              In this chat
                            </span>
                            <span className="text-xs text-stone-400">·</span>
                            <span className="text-xs font-semibold uppercase tracking-wide text-stone-400">
                              {visibleMessages.length}
                            </span>
                          </div>
                          <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                            {visibleMessages.map((msg) => (
                              <div
                                key={msg.id}
                                className="chat-message"
                                style={{ marginLeft: msg.senderId === myUserId ? 'auto' : 0 }}
                              >
                                <div
                                  className={`max-w-[80%] rounded-md border px-4 py-2 text-sm ${
                                    msg.senderId === myUserId
                                      ? 'border-accent bg-accent text-paper'
                                      : 'border-line bg-surface text-ink'
                                  }`}
                                >
                                  {msg.payload.text}
                                  <span className="block mt-1 text-[10px] text-stone-400">
                                    {timeLabel(msg.createdAt)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {!inConvSearch && convSearchQuery.trim() === '' && (
                        <button
                          type="button"
                          className="mt-4 w-full btn btn-ghost btn-sm text-stone-500 dark:text-stone-400"
                          onClick={() => {
                            setInConvSearch(true);
                            setConvSearchQuery('');
                          }}
                        >
                          <MagnifyingGlass className="h-3.5 w-3.5 mr-2" />
                          Search in conversation
                        </button>
                      )}
                    </div>

                    <div className="card border-t border-line p-4">
                      {/* ONE composer row at every width: [attach][emoji][input][send].
                          The legacy polyfill defined `.flex-col` unlayered, so
                          `flex-col sm:flex-row` stayed a column at all widths and
                          the send button dropped onto its own row. A plain `flex`
                          row (no direction utilities to fight) with shrink-0
                          controls and a min-w-0 textarea keeps the layout on one
                          line on desktop and mobile alike. */}
                      <div className="flex items-end gap-2">
                          <button
                            type="button"
                            className="btn btn-secondary shrink-0 p-2"
                            aria-label="Attach file"
                            disabled={!hasChatAttachApi}
                            title={hasChatAttachApi ? undefined : 'Not available yet'}
                          >
                            <Paperclip className="h-4 w-4" />
                          </button>
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              className="btn btn-secondary p-2"
                              aria-label="Emoji"
                              onClick={() => setEmojiPickerOpen((open) => !open)}
                            >
                              <Smiley className="h-4 w-4" />
                            </button>
                            {emojiPickerOpen && (
                              <div className="absolute bottom-full left-0 mb-2 card p-2 flex flex-wrap gap-1 rounded-md border border-line shadow-md">
                                {emojiSet.map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    className="btn btn-ghost p-1 text-lg"
                                    onClick={() => {
                                      setDraft((prev) => `${prev}${emoji}`);
                                      setEmojiPickerOpen(false);
                                      composerRef.current?.focus();
                                    }}
                                    aria-label={`Insert ${emoji}`}
                                  >
                                    {emoji}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <textarea
                            ref={composerRef}
                            rows={1}
                            className="input min-w-0 flex-1 min-h-[44px] max-h-[120px] resize-y px-3 py-2 text-sm"
                            placeholder={convCrypto ? 'Type a message...' : 'Unlocking conversation…'}
                            value={draft}
                            onChange={(e) => onDraftChange(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void sendMessage();
                              }
                            }}
                            disabled={sending || !convCrypto}
                            aria-label="Message input"
                          />
                        <button
                          type="button"
                          className="btn btn-primary shrink-0 self-end"
                          onClick={() => void sendMessage()}
                          disabled={sending || !convCrypto || !draft.trim()}
                          aria-label="Send message"
                        >
                          {sending ? <Spinner /> : <PaperPlaneTilt className="h-4 w-4" />}
                        </button>
                      </div>
                      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-stone-400 dark:text-stone-500">
                        <Lock className="h-3 w-3" />
                        End-to-end encrypted
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="card flex flex-col items-center justify-center py-20 text-center">
                    <ChatTeardropText className="h-8 w-8 text-stone-400" />
                    <h3 className="mt-3 text-base font-semibold text-stone-800 dark:text-stone-100">
                      Select a conversation
                    </h3>
                    <p className="mt-1 max-w-sm text-sm text-stone-500 dark:text-stone-400">
                      Open a thread from your list to read and send encrypted messages.
                    </p>
                  </div>
                )}
              </section>
            </div>
          )}

      {infoPanelMobileOpen ? (
        <ChatInfoPanel
          peer={peer}
          detail={activeDetail}
          members={resolvedMembers}
          contextNoteId={contextNoteId}
          activeId={activeId}
          online={peerOnline}
          mobileOpen={infoPanelMobileOpen}
          onCloseMobile={() => setInfoPanelMobileOpen(false)}
          onOpenSecurityInspector={() => { setInfoPanelMobileOpen(false); setInspectorOpen(true); }}
          onOpenConversationInfo={() => { setInfoPanelMobileOpen(false); setInfoOpen(true); }}
          onStartSearchInConversation={() => { setInfoPanelMobileOpen(false); setInConvSearch(true); setConvSearchQuery(''); }}
          sharedNoteIds={sharedNoteIds}
          hasBlockApi={!!peer}
          hasDeleteApi={true}
        />
      ) : null}

      {confirmAction === 'clear' ? (
        <ConfirmDialog
          open={true}
          title="Clear chat?"
          message="This chat will be hidden from your list until the next message. It will still exist on the server."
          confirmLabel="Clear"
          destructive={false}
          busy={false}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void runConfirmAction()}
        />
      ) : null}

      {confirmAction === 'block' || confirmAction === 'delete' ? (
        <ConfirmDialog
          open={true}
          title={confirmAction === 'block' ? 'Block user?' : 'Delete conversation?'}
          message={
            <>
              {confirmAction === 'block' && 'This user will be blocked and cannot message you from any conversation.'}
              {confirmAction === 'delete' && 'You will leave this conversation and the message history will be removed for you.'}
            </>
          }
          confirmLabel={confirmAction === 'block' ? 'Block user' : 'Delete'}
          destructive={confirmAction === 'block' || confirmAction === 'delete'}
          busy={false}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void runConfirmAction()}
        />
      ) : null}

      <ChatShareNoteModal
        open={shareNoteOpen}
        onClose={() => setShareNoteOpen(false)}
        conversationId={activeId}
        peer={peer}
        onSendCard={sendShareCard}
      />

      <Modal
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title="Conversation info"
        description="Read-only details about this conversation."
        size="md"
      >
        <div className="space-y-4 text-sm leading-6 text-stone-600 dark:text-stone-300">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 shrink-0 text-emerald-500" />
            <p>End-to-end encrypted. Only you and the participants can read these messages.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-stone-700 dark:text-stone-200">Members:</span>
            <span className="text-stone-500 dark:text-stone-400">{resolvedMembers.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-stone-700 dark:text-stone-200">Shared notes in this chat:</span>
            <span className="text-stone-500 dark:text-stone-400">{sharedNoteIds.size}</span>
          </div>
          {contextNoteId ? (
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-orange-700 dark:text-orange-500" />
              <p>
                This conversation was opened from note <span className="font-mono text-xs">{contextNoteId.slice(0, 12)}</span>
              </p>
            </div>
          ) : null}
        </div>
      </Modal>

      {inspectorOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/50 p-4">
          <div className="card max-w-lg p-6">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold text-stone-900 dark:text-white">Security inspector</h2>
              <button
                type="button"
                className="btn btn-ghost p-1.5"
                onClick={() => setInspectorOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 grid gap-3 text-sm leading-6 text-stone-600 dark:text-stone-300">
              <div className="flex items-center gap-2 rounded-md border border-line bg-accent-50 px-3 py-2 dark:bg-accent-900/40">
                <ShieldCheck className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400" />
                <p>This conversation is end-to-end encrypted.</p>
              </div>
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 shrink-0 text-stone-500 dark:text-stone-400" />
                <p>Every message is sealed with AES-GCM-256 using a per-conversation key.</p>
              </div>
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 shrink-0 text-stone-500 dark:text-stone-400" />
                <p>The wrapped conversation key is stored server-side and can only be unwrapped by a member.</p>
              </div>
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 shrink-0 text-stone-500 dark:text-stone-400" />
                <p>No plaintext messages are stored by the server.</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Avatar({ name, size = 'md', className = '' }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }): ReactElement {
  const sizeClass = {
    sm: 'h-8 w-8',
    md: 'h-9 w-9',
    lg: 'h-11 w-11',
  }[size];

  const initials = name.trim().split(/\s+/).filter(Boolean);
  const text = initials.length === 0 ? '?' : initials.length === 1 ? initials[0]!.slice(0, 2).toUpperCase() : `${initials[0]![0]}${initials[initials.length - 1]![0]}`.toUpperCase();

  return (
    <div className={`relative flex items-center justify-center ${className}`.trim()}>
      <div className={`${sizeClass} rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center`}>
        {text}
      </div>
    </div>
  );
}
