import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL, getAuthToken } from './api';

/**
 * Socket.IO lifecycle for the chat UI.
 *
 * - Auth: the session JWT rides the handshake (server verifies before accept).
 * - Reconnect: `socket-io-client` retries with backoff; on reconnect the chat
 *   page re-joins conversation rooms via `ensureJoined`.
 * - API base: sockets bypass the Vite `/api` proxy, so derive the server root.
 */

export type ChatSocketEvents = {
  'chat:message': (message: unknown) => void;
  'chat:typing': (payload: { conversationId: string; userId: string; typing: boolean }) => void;
  'chat:receipt': (payload: { conversationId: string; messageId?: string; status: 'delivered' | 'read'; at: string }) => void;
  'presence:state': (payload: { conversationId: string; online: string[] }) => void;
  'presence:update': (payload: { conversationId: string; userId: string; online: boolean }) => void;
  'chat:error': (payload: { code: string; clientId: string | null }) => void;
};

function serverRoot(): string {
  // Vite dev proxies /api -> :4000; sockets connect to the origin directly.
  if (import.meta.env.DEV) return 'http://localhost:4000';
  return window.location.origin;
}

let socket: Socket | null = null;

export function getChatSocket(): Socket {
  if (socket && socket.connected) return socket;
  if (socket) return socket; // connecting - reuse

  const token = getAuthToken();
  socket = io(serverRoot(), {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 8000,
    autoConnect: true,
  });

  return socket;
}

/** Joins rooms for all my conversations after (re)connect. */
export function ensureJoined(conversationIds: string[]): void {
  const s = getChatSocket();
  if (s.connected) {
    for (const id of conversationIds) s.emit('presence:subscribe', { conversationId: id });
  } else {
    s.once('connect', () => {
      for (const id of conversationIds) s.emit('presence:subscribe', { conversationId: id });
    });
  }
}

/** Tears the socket down (logout / unmount of the whole app shell). */
export function disconnectChatSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** Emits an event only while connected; caller falls back to REST otherwise. */
export function emitIfConnected(event: string, payload: unknown): boolean {
  const s = getChatSocket();
  if (!s.connected) return false;
  s.emit(event, payload);
  return true;
}
