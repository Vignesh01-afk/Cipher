import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { verifySessionToken } from './lib/jwt';
import { prisma } from './db';

/**
 * Real-time chat transport (Socket.IO).
 *
 * Auth: the client presents its normal session JWT in the handshake; sockets
 * that fail verification are rejected before any event fires.
 *
 * Security invariants mirror the REST surface:
 *  - the server relays opaque ciphertext only; it never sees plaintext,
 *  - every event re-checks conversation membership against the DB,
 *  - blocks are enforced server-side on send,
 *  - payloads are size-capped before relay.
 *
 * Presence is per-process (single-node deployment); typing indicators are
 * ephemeral and never persisted.
 */

interface AuthenticatedSocket extends Socket {
  data: { userId: string };
}

/** conversationId -> Set<userId> with at least one live socket. */
const presence = new Map<string, Set<string>>();

function userIdsOf(conversationId: string): string[] {
  return [...(presence.get(conversationId) ?? [])];
}

function isOnline(conversationId: string, userId: string): boolean {
  return presence.get(conversationId)?.has(userId) ?? false;
}

const MAX_RELAY_BYTES = 128 * 1024;

/**
 * Handle to the attached Socket.IO server, set by attachSocketServer(). The
 * REST layer uses it to fan out chat events for sends that arrive over HTTP
 * (no-socket clients, note-share cards), so those messages still reach other
 * participants live instead of only on reload.
 */
let attached: SocketServer | null = null;

/** @returns the live Socket.IO server, or null when sockets are not attached. */
export function getSocketServer(): SocketServer | null {
  return attached;
}

export function attachSocketServer(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, callback) => callback(null, true), // REST CORS already gates browsers; token gates sockets
      methods: ['GET', 'POST'],
    },
    // Tokens are validated per handshake below; keep buffers bounded.
    maxHttpBufferSize: MAX_RELAY_BYTES,
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });

  io.use((socket, next) => {
    try {
      const token =
        typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : null;
      if (!token) {
        next(new Error('UNAUTHORIZED'));
        return;
      }
      const payload = verifySessionToken(token);
      (socket as AuthenticatedSocket).data = { userId: payload.sub };
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const userId = socket.data.userId;

    /** Membership + block guard shared by every conversation-scoped event. */
    async function assertMembership(conversationId: string): Promise<void> {
      const membership = await prisma.conversationMember.findFirst({
        where: { conversationId, userId },
        select: { id: true },
      });
      if (!membership) {
        throw new Error('NOT_A_MEMBER');
      }
    }

    async function joinOwnConversations(): Promise<void> {
      const memberships = await prisma.conversationMember.findMany({
        where: { userId },
        select: { conversationId: true },
        take: 500,
      });
      await Promise.all(memberships.map((m) => socket.join(`conversation:${m.conversationId}`)));
      await socket.join(`user:${userId}`);
    }

    void joinOwnConversations();

    socket.on('presence:subscribe', ({ conversationId }: { conversationId?: unknown }) => {
      if (typeof conversationId !== 'string' || conversationId.length > 64) return;
      void (async () => {
        try {
          await assertMembership(conversationId);
        } catch {
          return;
        }
        // Also (re)join the broadcast room: conversations created after this
        // socket connected are not covered by joinOwnConversations(), which
        // ran once at connect time.
        await socket.join(`conversation:${conversationId}`);
        socket.join(`presence:${conversationId}`);
        socket.emit('presence:state', { conversationId, online: userIdsOf(conversationId) });
      })();
    });

    socket.on('chat:send', (payload: {
      conversationId?: unknown;
      message?: unknown;
      wrappedConversationKeys?: unknown;
      clientId?: unknown;
      kind?: unknown;
      noteId?: unknown;
    }) => {
      void (async () => {
        try {
          const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : '';
          const message = payload.message as
            | { ciphertext?: unknown; iv?: unknown; payloadBytes?: unknown }
            | undefined;
          if (!conversationId || !message) return;
          await assertMembership(conversationId);

          const ciphertext = typeof message.ciphertext === 'string' ? message.ciphertext : '';
          const iv = typeof message.iv === 'string' ? message.iv : '';
          const payloadBytes = typeof message.payloadBytes === 'number' ? message.payloadBytes : 0;
          const clientId = typeof payload.clientId === 'string' ? payload.clientId : '';
          if (!ciphertext || !iv || !clientId) return;
          if (ciphertext.length > MAX_RELAY_BYTES) return; // hard cap

          // Block enforcement (server-side, not client trust).
          const members = await prisma.conversationMember.findMany({
            where: { conversationId },
            select: { userId: true },
          });
          const blocks = await prisma.chatBlock.findFirst({
            where: {
              OR: members
                .filter((m) => m.userId !== userId)
                .map((m) => ({ blockerId: m.userId, blockedId: userId })),
            },
            select: { id: true },
          });
          if (blocks) {
            socket.emit('chat:error', { code: 'CHAT_BLOCKED', clientId });
            return;
          }

          // Upsert per-member key wraps if provided (key rotation on reuse).
          const wraps = (payload.wrappedConversationKeys ?? {}) as Record<string, string>;
          const memberIds = new Set(members.map((m) => m.userId));
          const validWraps = Object.entries(wraps).filter(([id, wrapped]) => memberIds.has(id) && typeof wrapped === 'string' && wrapped.length <= 1024);
          if (validWraps.length > 0) {
            await prisma.$transaction(
              validWraps.map(([memberId, wrapped]) =>
                prisma.conversationMember.updateMany({
                  where: { conversationId, userId: memberId },
                  data: { wrappedConversationKey: wrapped },
                }),
              ),
            );
          }

          // Idempotent on clientId (unique index) - retries never duplicate.
          const stored = await prisma.encryptedMessage.upsert({
            where: {
              conversationId_senderId_clientId: { conversationId, senderId: userId, clientId },
            },
            create: {
              conversationId,
              senderId: userId,
              ciphertext,
              iv,
              payloadBytes,
              clientId,
            },
            update: {},
          });

          io.to(`conversation:${conversationId}`).emit('chat:message', {
            id: stored.id,
            conversationId,
            senderId: stored.senderId,
            ciphertext: stored.ciphertext,
            iv: stored.iv,
            algorithm: stored.algorithm,
            encryptionVersion: stored.encryptionVersion,
            payloadBytes: stored.payloadBytes,
            clientId: stored.clientId,
            deliveredAt: new Date().toISOString(),
            readAt: null,
            createdAt: stored.createdAt.toISOString(),
          });

          // Tell members whose sockets may not sit in the conversation room
          // yet (e.g. the conversation was created after they connected) so
          // their client can refresh the conversation list.
          for (const m of members) {
            if (m.userId !== userId) {
              io.to(`user:${m.userId}`).emit('chat:activity', { conversationId, senderId: userId });
            }
          }
        } catch {
          socket.emit('chat:error', { code: 'SEND_FAILED', clientId: typeof payload.clientId === 'string' ? payload.clientId : null });
        }
      })();
    });

    socket.on('chat:typing', ({ conversationId, typing }: { conversationId?: unknown; typing?: unknown }) => {
      if (typeof conversationId !== 'string') return;
      void (async () => {
        try {
          await assertMembership(conversationId);
        } catch {
          return;
        }
        socket.to(`conversation:${conversationId}`).emit('chat:typing', {
          conversationId,
          userId,
          typing: typing === true,
        });
      })();
    });

    socket.on('chat:delivered', ({ conversationId, messageId }: { conversationId?: unknown; messageId?: unknown }) => {
      if (typeof conversationId !== 'string' || typeof messageId !== 'string') return;
      void (async () => {
        try {
          await assertMembership(conversationId);
        } catch {
          return;
        }
        const updated = await prisma.encryptedMessage.updateMany({
          where: { id: messageId, conversationId, senderId: { not: userId }, deliveredAt: null },
          data: { deliveredAt: new Date() },
        });
        if (updated.count > 0) {
          io.to(`conversation:${conversationId}`).emit('chat:receipt', {
            conversationId,
            messageId,
            status: 'delivered',
            at: new Date().toISOString(),
          });
        }
      })();
    });

    socket.on('chat:read', ({ conversationId }: { conversationId?: unknown }) => {
      if (typeof conversationId !== 'string') return;
      void (async () => {
        try {
          await assertMembership(conversationId);
        } catch {
          return;
        }
        const now = new Date();
        await prisma.conversationMember.updateMany({
          where: { conversationId, userId },
          data: { lastReadAt: now },
        });
        const updated = await prisma.encryptedMessage.updateMany({
          where: { conversationId, senderId: { not: userId }, readAt: null },
          data: { readAt: now },
        });
        if (updated.count > 0) {
          socket.to(`conversation:${conversationId}`).emit('chat:receipt', {
            conversationId,
            status: 'read',
            at: now.toISOString(),
          });
        }
      })();
    });

    socket.on('disconnecting', () => {
      void (async () => {
        const rooms = [...socket.rooms]
          .filter((r: string) => r.startsWith('conversation:'))
          .map((r) => r.slice('conversation:'.length));
        for (const conversationId of rooms) {
          // Only broadcast offline if the user has no other live socket here.
          const sockets = await io.in(`presence:${conversationId}`).fetchSockets();
          const stillConnected = sockets.some((s) => (s.data as { userId?: string } | undefined)?.userId === userId);
          if (!stillConnected) {
            socket.to(`conversation:${conversationId}`).emit('presence:update', {
              conversationId,
              userId,
              online: false,
            });
          }
        }
      })();
    });
  });

  // Presence broadcast whenever a user joins a conversation presence room.
  attached = io;

  io.of('/').adapter.on('join-room', (room: string, socketId: string) => {
    if (!room.startsWith('presence:')) return;
    const conversationId = room.slice('presence:'.length);
    const socket = io.sockets.sockets.get(socketId);
    const userId = (socket?.data as { userId?: string } | undefined)?.userId;
    if (!userId) return;
    let set = presence.get(conversationId);
    if (!set) {
      set = new Set();
      presence.set(conversationId, set);
    }
    const wasOnline = set.has(userId);
    set.add(userId);
    if (!wasOnline) {
      io.to(`conversation:${conversationId}`).emit('presence:update', {
        conversationId,
        userId,
        online: true,
      });
    }
  });

  return io;
}
