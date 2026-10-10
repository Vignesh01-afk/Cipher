import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Spinner } from '../components/Spinner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { ChatShareNoteModal } from '../components/ChatShareNoteModal';
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
import { Lock, ChatTeardropText, MagnifyingGlass, Clock, ShareNetwork, Info, ShieldCheck, FileText, Checks, Paperclip, Smiley, PaperPlaneTilt, X } from '@phosphor-icons/react';
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
  const peer = useMemo(() => {
    const list = activeDetail?.members ?? activeConversation?.participants ?? [];
    return list.map((m) => ('user' in m ? m.user : m)).find((p) => p.id !== myUserId) ?? null;
  }, [activeDetail, activeConversation, myUserId]);

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
              payload: { v: 1, type: 'text', text: '⚠ Unable to decrypt this message' },
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
            payload: { v: 1, type: 'text', text: '⚠ Unable to decrypt this message' },
            createdAt: m.createdAt,
            deliveredAt: m.deliveredAt,
            readAt: m.readAt,
            status: 'sent',
          },
        ]);
      }
    }

    const onTyping = (p: { conversationId: string; userId: string; typing: boolean }) => {
      if (p.conversationId !== activeId || p.userId === myUserId) return;
      setPeerTyping(p.typing);
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

        if (hasNew && fresh.some((m) => m.senderId !== myUserId)) {
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

  const contextNoteId = activeDetail?.contextNoteId ?? activeConversation?.contextNoteId ?? null;

  if (!keys) {
    return (
      <div className="card p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-stone-400" />
        <h2 className="mt-3 text-lg font-semibold text-stone-900 dark:text-white">Vault locked</h2>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
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
                <h1 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white">Chat</h1>
                <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
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
                <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
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
                        className="flex items-center gap-3 rounded-xl border border-white/70 p-3 dark:border-white/[0.08]"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 via-violet-500 to-pink-500 text-sm font-bold text-white">
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

      {conversations.length === 0 ? (
            <div className="card p-8 text-center">
              <ChatTeardropText className="mx-auto h-8 w-8 text-stone-400" />
              <h2 className="mt-3 text-lg font-semibold text-stone-900 dark:text-white">No conversations yet</h2>
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                Start a secure chat with any of your CipherNote contacts.
              </p>
              <button
                type="button"
                className="mt-4 btn btn-primary"
                onClick={() => setSearchOpen(true)}
              >
                <ChatTeardropText className="h-4 w-4" />
                New chat
              </button>
            </div>
          ) : (
            <div className="flex flex-1 overflow-hidden">
              <section
                className="card flex flex-col overflow-y-auto"
                style={{ maxWidth: '340px', flex: '0 0 340px' }}
              >
                <div className="p-4 pb-2">
                  <div className="relative">
                    <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
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
                </div>

                <div className="px-4">
                  {conversations.map((conv) => {
                    const last = conv.lastMessage;
                    const mine = conv.participants.some((p) => p.id === myUserId);
                    return (
                      <button
                        key={conv.id}
                        type="button"
                        className={`flex w-full flex-col gap-1 border-b border-white/10 p-4 text-left transition hover:bg-white/50 dark:hover:bg-white/[0.06] ${
                          activeId === conv.id ? 'bg-white/60 dark:bg-white/[0.08]' : ''
                        }`}
                        onClick={() => void openConversation(conv.id)}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={conv.participants.find((p) => p.id !== myUserId)?.displayName ?? 'Chat'}
                            size="sm"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-stone-900 dark:text-white">
                              {conv.participants.find((p) => p.id !== myUserId)?.displayName ?? 'Chat'}
                            </p>
                            {last ? (
                              <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                                {last.senderId === myUserId ? 'You: ' : ''}
                                {last.hasPayload ? last.id.slice(0, 18) : last.id}
                                {conv.unreadCount > 0 ? (
                                  <span className="ml-2 inline-flex items-center justify-center rounded-full bg-gradient-to-r from-brand-500 via-violet-500 to-pink-500 px-2 py-0.5 text-[10px] font-bold text-white">
                                    {conv.unreadCount}
                                  </span>
                                ) : null}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-stone-400 dark:text-stone-500">
                          <Clock className="h-3 w-3" />
                          <span>{formatRelativeTime(conv.updatedAt)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="flex flex-1 flex-col overflow-hidden">
                {activeId ? (
                  <>
                    <div className="card flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4 dark:border-white/[0.08]">
                      <div className="flex items-center gap-3">
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
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                      {messages.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/70 text-stone-400 dark:bg-white/[0.06] dark:text-stone-500">
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
                        <div className="space-y-6">
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
                                  className={`max-w-[68%] rounded-2xl px-4 py-2.5 text-sm leading-6 shadow-sm ${
                                    isMe
                                      ? 'bg-gradient-to-br from-brand-500 via-violet-500 to-pink-500 text-white'
                                      : 'bg-white/80 text-stone-800 dark:bg-white/[0.07] dark:text-stone-100'
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
                                    <div className="mb-1 flex items-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-xs text-stone-600 dark:bg-white/[0.12] dark:text-stone-300">
                                      <FileText className="h-3.5 w-3.5 shrink-0" />
                                      <span>Shared note card</span>
                                    </div>
                                  ) : null}
                                  <p className="leading-relaxed">{payload.text}</p>
                                  <div className="mt-1 flex items-center justify-end gap-2">
                                    <span>{timeLabel(msg.createdAt)}</span>
                                    {!isMe ? (
                                      <span className="flex items-center gap-1 text-[11px] text-stone-400">
                                        <Checks className="h-3 w-3" />
                                        {msg.status === 'sent' ? 'Delivered' : msg.status === 'failed' ? 'Failed' : 'Sending…'}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          {peerTyping ? (
                            <div className="chat-message justify-start">
                              <div className="max-w-[68%] rounded-2xl rounded-bl-md bg-white/80 px-4 py-3 text-sm text-stone-500 dark:bg-white/[0.07] dark:text-stone-400">
                                <span className="flex items-center gap-2 text-[11px] font-semibold text-stone-400">
                                  {peer?.displayName ?? 'Contact'}
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <span className="h-2 w-2 animate-bounce rounded-full bg-stone-400" />
                                  <span className="h-2 w-2 animate-bounce rounded-full bg-stone-400" style={{ animationDelay: '0.2s' }} />
                                  <span className="h-2 w-2 animate-bounce rounded-full bg-stone-400" style={{ animationDelay: '0.4s' }} />
                                </span>
                                typing
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
                                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                                    msg.senderId === myUserId
                                      ? 'bg-gradient-to-br from-brand-500 via-violet-500 to-pink-500 text-white'
                                      : 'bg-white/80 text-stone-700 dark:bg-white/[0.07] dark:text-stone-200'
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
                    </div>

                    <div className="card border-t border-white/10 p-4 dark:border-white/[0.08]">
                      <div className="flex items-end gap-2">
                        <div className="flex flex-1 gap-2">
                          <button
                            type="button"
                            className="btn btn-secondary p-2"
                            aria-label="Attach file"
                          >
                            <Paperclip className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary p-2"
                            aria-label="Emoji"
                          >
                            <Smiley className="h-4 w-4" />
                          </button>
                          <textarea
                            ref={composerRef}
                            className="input flex-1 min-h-[44px] max-h-[120px] resize-y px-3 py-2 text-sm"
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
                        </div>
                        <button
                          type="button"
                          className="btn btn-primary self-end"
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

      {/* Destructive-action confirmation */}
      {activeId ? (
        <ConfirmDialog
          open={confirmAction === 'clear' || confirmAction === 'block' || confirmAction === 'delete'}
          title={confirmAction === 'clear' ? 'Clear chat?' : confirmAction === 'block' ? 'Block user?' : 'Delete conversation?'}
          message={
            <>
              {confirmAction === 'clear' && 'This chat will be hidden from your list until the next message. It will still exist on the server.'}
              {confirmAction === 'block' && 'This user will be blocked and cannot message you from any conversation.'}
              {confirmAction === 'delete' && 'You will leave this conversation and the message history will be removed for you.'}
            </>
          }
          confirmLabel={confirmAction === 'block' ? 'Block user' : confirmAction === 'delete' ? 'Delete' : 'Clear'}
          destructive={confirmAction === 'block' || confirmAction === 'delete'}
          busy={false}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void runConfirmAction()}
        />
      ) : null}

      {/* Share note card in chat */}
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
          {activeDetail?.members.map((m) => (
            <div key={m.user.id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Avatar name={m.user.displayName} size="sm" />
                <span>{m.user.displayName}</span>
              </div>
              <span className="text-xs text-stone-400">{m.user.cipherId}</span>
            </div>
          ))}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4 backdrop-blur-sm">
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
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 dark:bg-emerald-500/10">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
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

function Avatar({ name, size = 'md', className = '' }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const sizeClass = {
    sm: 'h-8 w-8',
    md: 'h-9 w-9',
    lg: 'h-11 w-11',
  }[size];

  const initials = name.trim().split(/\s+/).filter(Boolean);
  const text = initials.length === 0 ? '?' : initials.length === 1 ? initials[0]!.slice(0, 2).toUpperCase() : `${initials[0]![0]}${initials[initials.length - 1]![0]}`.toUpperCase();

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <div className={`${sizeClass} rounded-full bg-gradient-to-br from-brand-500 via-violet-500 to-pink-500 text-xs font-bold text-white flex items-center justify-center`}>
        {text}
      </div>
      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-[#0B0F19] bg-emerald-500" />
    </div>
  );
}
