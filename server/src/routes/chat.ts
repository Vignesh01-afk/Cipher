import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { AuditAction, recordAudit, requestIp } from '../lib/audit';
import { ApiError, asyncHandler } from '../lib/http';
import {
  paginationSchema,
  sendChatMessageSchema,
  startConversationSchema,
  userSearchSchema,
} from '../lib/schemas';
import { currentUserId, requireAuth } from '../middleware/auth';
import { getSocketServer } from '../socket';

/**
 * Encrypted chat REST surface.
 *
 * SECURITY: every endpoint requires a session; every conversation access is
 * checked against ConversationMember; blocks are enforced server-side; the
 * server stores ciphertext + RSA-wrapped conversation keys only. Plaintext
 * never reaches this code.
 */
export const chatRouter = Router();

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many chat requests, slow down.', code: 'RATE_LIMITED' },
});

chatRouter.use(requireAuth, chatLimiter);

/** The membership row for `userId` in a member list, or undefined. */
function memberOf<T extends { userId: string }>(members: T[], userId: string): T | undefined {
  return members.find((m) => m.userId === userId);
}

async function requireMembership(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      members: {
        include: { user: { select: { id: true, email: true, displayName: true, cipherId: true, username: true, publicKey: true } } },
      },
    },
  });
  if (!conversation) {
    throw ApiError.notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
  }
  const me = memberOf(conversation.members, userId);
  if (!me) {
    throw ApiError.forbidden('You are not a member of this conversation', 'NOT_A_MEMBER');
  }
  return { conversation, me };
}

// --- User search ------------------------------------------------------------

/**
 * GET /api/users/search?q=<username | CN-XXXXXX>
 *
 * Chat addressing lookup by public handle only. Returns the minimum needed to
 * open a conversation: identity fields + public key (to wrap the conversation
 * key). Never private material.
 */
chatRouter.get(
  '/users/search',
  asyncHandler(async (req, res) => {
    const parsed = userSearchSchema.safeParse({ q: req.query.q });
    if (!parsed.success) {
      throw ApiError.badRequest(parsed.error.issues[0]?.message ?? 'Invalid search', 'VALIDATION_ERROR');
    }
    const q = parsed.data.q.replace(/^@/, '').trim();

    const users = await prisma.user.findMany({
      where: {
        OR: [
          { username: { equals: q, mode: 'insensitive' } },
          { cipherId: { equals: q, mode: 'insensitive' } },
          { username: { contains: q, mode: 'insensitive' } },
          { displayName: { equals: q, mode: 'insensitive' } },
          { displayName: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, email: false, displayName: true, cipherId: true, username: true, publicKey: true },
      take: 10,
    });

    // Deliberately omit email: chat addressing is by public handle.
    res.json({
      users: users.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        cipherId: u.cipherId,
        username: u.username,
        publicKey: u.publicKey,
      })),
    });
  }),
);

// --- Conversations ----------------------------------------------------------

/** GET /api/chat/conversations - the member's conversation list with previews. */
chatRouter.get(
  '/conversations',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);

    const memberships = await prisma.conversationMember.findMany({
      where: { userId, hiddenAt: null },
      include: {
        conversation: {
          include: {
            members: {
              include: {
                user: {
                  select: { id: true, displayName: true, cipherId: true, username: true },
                },
              },
            },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { conversation: { updatedAt: 'desc' } },
    });

    const conversations = memberships.map((membership) => {
      const others = membership.conversation.members.filter((m) => m.userId !== userId);
      const last = membership.conversation.messages[0] ?? null;
      const unread = last && last.senderId !== userId && (!membership.lastReadAt || last.createdAt > membership.lastReadAt) ? 1 : 0;

      return {
        id: membership.conversation.id,
        contextNoteId: membership.conversation.contextNoteId,
        createdAt: membership.conversation.createdAt,
        updatedAt: membership.conversation.updatedAt,
        lastReadAt: membership.lastReadAt,
        wrappedConversationKey: membership.wrappedConversationKey,
        keyAlgorithm: membership.keyAlgorithm,
        participants: others.map((m) => ({
          id: m.user.id,
          displayName: m.user.displayName,
          cipherId: m.user.cipherId,
          username: m.user.username,
        })),
        lastMessage: last
          ? {
              id: last.id,
              senderId: last.senderId,
              createdAt: last.createdAt,
              readAt: last.readAt,
              deliveredAt: last.deliveredAt,
              // The server cannot decrypt; the client shows a placeholder
              // until it fetches and decrypts the body itself.
              hasPayload: true,
            }
          : null,
        unreadCount: unread,
      };
    });

    res.json({ conversations });
  }),
);

/**
 * POST /api/chat/conversations
 *
 * Starts (or returns the existing) 1:1 conversation with `recipientId`.
 * The client generates the conversation AES key locally and supplies it
 * RSA-OAEP-wrapped for every member (`wrappedKeys`: { [userId]: base64 }).
 * When the conversation already exists the stored wraps are returned and the
 * submitted ones are ignored - keys never rotate on re-entry.
 */
chatRouter.post(
  '/conversations',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const input = startConversationSchema.parse(req.body);
    const recipientId = input.recipientId!;

    if (recipientId === userId) {
      throw ApiError.badRequest('You cannot start a conversation with yourself', 'SELF_CONVERSATION');
    }

    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true },
    });
    if (!recipient) {
      throw ApiError.notFound('That user does not exist', 'USER_NOT_FOUND');
    }

    const blocked = await prisma.chatBlock.findFirst({
      where: {
        OR: [
          { blockerId: recipientId, blockedId: userId },
          { blockerId: userId, blockedId: recipientId },
        ],
      },
    });
    if (blocked) {
      throw ApiError.forbidden('Conversation is blocked for one of the participants', 'CHAT_BLOCKED');
    }

    // Reuse an existing 1:1 conversation between the two users when present.
    const existing = await prisma.conversation.findFirst({
      where: {
        AND: [
          { members: { some: { userId } } },
          { members: { some: { userId: recipientId } } },
        ],
        contextNoteId: input.contextNoteId ?? null,
      },
      include: { members: true },
    });
    if (existing && existing.members.length === 2) {
      const mine = memberOf(existing.members, userId);
      return res.status(200).json({
        conversation: {
          id: existing.id,
          contextNoteId: existing.contextNoteId,
          wrappedConversationKey: mine?.wrappedConversationKey ?? null,
          keyAlgorithm: mine?.keyAlgorithm ?? 'RSA-OAEP-2048-SHA256',
          reused: true,
        },
      });
    }

    const wrappedKeys = (req.body?.wrappedKeys ?? {}) as Record<string, string>;
    const mine = wrappedKeys[userId];
    const theirs = wrappedKeys[recipientId];
    if (!mine || !theirs) {
      throw ApiError.badRequest(
        'Provide the conversation key wrapped for every member (wrappedKeys)',
        'VALIDATION_ERROR',
      );
    }

    const conversation = await prisma.conversation.create({
      data: {
        contextNoteId: input.contextNoteId ?? null,
        members: {
          create: [
            { userId, wrappedConversationKey: mine },
            { userId: recipientId, wrappedConversationKey: theirs },
          ],
        },
      },
      include: { members: true },
    });

    await recordAudit({
      userId,
      action: AuditAction.CHAT_STARTED,
      targetType: 'USER',
      targetId: recipientId,
      ipAddress: requestIp(req),
      metadata: { conversationId: conversation.id, noteContext: Boolean(input.contextNoteId) },
    });

    const myWrap = memberOf(conversation.members, userId);
    return res.status(201).json({
      conversation: {
        id: conversation.id,
        contextNoteId: conversation.contextNoteId,
        wrappedConversationKey: myWrap?.wrappedConversationKey ?? null,
        keyAlgorithm: myWrap?.keyAlgorithm ?? 'RSA-OAEP-2048-SHA256',
        reused: false,
      },
    });
  }),
);

/** GET /api/chat/conversations/:id - full member roster for one conversation. */
chatRouter.get(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const { conversation } = await requireMembership(req.params.id, userId);

    res.json({
      conversation: {
        id: conversation.id,
        contextNoteId: conversation.contextNoteId,
        createdAt: conversation.createdAt,
        members: conversation.members.map((m) => ({
          user: {
            id: m.user.id,
            displayName: m.user.displayName,
            cipherId: m.user.cipherId,
            username: m.user.username,
          },
          wrappedConversationKey: m.wrappedConversationKey,
          keyAlgorithm: m.keyAlgorithm,
          lastReadAt: m.lastReadAt,
        })),
      },
    });
  }),
);

// --- Messages ---------------------------------------------------------------

/**
 * GET /api/chat/conversations/:id/messages?cursor=&limit=
 *
 * Cursor-paginated, newest page first. The client decrypts locally.
 */
chatRouter.get(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const { conversation } = await requireMembership(req.params.id, userId);

    const parsed = paginationSchema.safeParse({
      cursor: req.query.cursor,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    if (!parsed.success) {
      throw ApiError.badRequest('Invalid pagination parameters', 'VALIDATION_ERROR');
    }

    const messages = await prisma.encryptedMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: parsed.data.limit,
      ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
    });

    res.json({
      messages: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        ciphertext: m.ciphertext,
        iv: m.iv,
        algorithm: m.algorithm,
        encryptionVersion: m.encryptionVersion,
        payloadBytes: m.payloadBytes,
        clientId: m.clientId,
        deliveredAt: m.deliveredAt,
        readAt: m.readAt,
        createdAt: m.createdAt,
      })),
      nextCursor: messages.length === parsed.data.limit ? messages[messages.length - 1]!.id : null,
    });
  }),
);

/**
 * POST /api/chat/conversations/:id/messages
 *
 * Persists one encrypted message and fans it out over Socket.IO. Membership
 * and block rules are enforced here (the socket path reuses this handler's
 * helpers); payloads are opaque ciphertext to the server.
 */
chatRouter.post(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const { conversation } = await requireMembership(req.params.id, userId);
    const input = sendChatMessageSchema.parse(req.body);

    // Every wrapped key must target an actual member of THIS conversation.
    const memberIds = new Set(conversation.members.map((m) => m.userId));
    const wraps = input.wrappedConversationKeys ?? {};
    for (const target of Object.keys(wraps)) {
      if (!memberIds.has(target)) {
        throw ApiError.badRequest('Wrapped key targets a non-member', 'VALIDATION_ERROR');
      }
    }

    const blocked = await prisma.chatBlock.findFirst({
      where: {
        OR: conversation.members
          .filter((m) => m.userId !== userId)
          .map((m) => ({ blockerId: m.userId, blockedId: userId })),
      },
    });
    if (blocked) {
      throw ApiError.forbidden('You cannot message this participant', 'CHAT_BLOCKED');
    }

    // Store per-member wraps on the membership rows (idempotent update).
    if (Object.keys(wraps).length > 0) {
      await prisma.$transaction(
        Object.entries(wraps).map(([memberId, wrapped]) =>
          prisma.conversationMember.updateMany({
            where: { conversationId: conversation.id, userId: memberId },
            data: { wrappedConversationKey: wrapped },
          }),
        ),
      );
    }

    const message = await prisma.encryptedMessage.create({
      data: {
        conversationId: conversation.id,
        senderId: userId,
        ciphertext: input.ciphertext,
        iv: input.iv,
        payloadBytes: input.payloadBytes,
        clientId: input.clientId,
      },
    });

    await recordAudit({
      userId,
      action: AuditAction.CHAT_MESSAGE_SENT,
      targetType: 'USER',
      targetId: conversation.id,
      ipAddress: requestIp(req),
      metadata: { conversationId: conversation.id, messageId: message.id, bytes: input.payloadBytes },
    });

    // A share card sent through chat: audit the event (ids only - the note
    // content stays encrypted, and the share itself was audited by /notes/:id/shares).
    if (input.kind === 'note-share' && input.noteId) {
      await recordAudit({
        userId,
        action: AuditAction.CHAT_NOTE_SHARED,
        targetType: 'USER',
        targetId: conversation.id,
        noteId: input.noteId,
        ipAddress: requestIp(req),
        metadata: { conversationId: conversation.id, messageId: message.id },
      });
    }

    const messageDto = {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      ciphertext: message.ciphertext,
      iv: message.iv,
      algorithm: message.algorithm,
      encryptionVersion: message.encryptionVersion,
      payloadBytes: message.payloadBytes,
      clientId: message.clientId,
      deliveredAt: message.deliveredAt,
      readAt: message.readAt,
      createdAt: message.createdAt,
    };

    // Fan out over Socket.IO when attached (local `npm run dev` entry point).
    // Sends that arrive over HTTP instead of the socket - no-socket clients,
    // note-share cards, socket reconnect gaps - must still reach other
    // participants live, otherwise they only see the message after a reload.
    const io = getSocketServer();
    if (io) {
      io.to(`conversation:${conversation.id}`).emit('chat:message', {
        ...messageDto,
        createdAt: messageDto.createdAt.toISOString(),
        deliveredAt: null,
      });
      for (const m of conversation.members) {
        if (m.userId !== userId) {
          io.to(`user:${m.userId}`).emit('chat:activity', { conversationId: conversation.id, senderId: userId });
        }
        io.to(`user:${m.userId}`).emit('chat:receipt', {
          conversationId: conversation.id,
          messageId: messageDto.id,
          status: 'delivered',
          at: new Date().toISOString(),
        });
      }
    }

    res.status(201).json({ message: messageDto });
  }),
);

/** POST /api/chat/conversations/:id/read - mark the conversation read. */
chatRouter.post(
  '/conversations/:id/read',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    await requireMembership(req.params.id, userId);

    await prisma.conversationMember.updateMany({
      where: { conversationId: req.params.id, userId },
      data: { lastReadAt: new Date() },
    });

    res.json({ ok: true });
  }),
);

/** POST /api/chat/conversations/:id/hide - "clear local chat": soft-hide. */
chatRouter.post(
  '/conversations/:id/hide',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    await requireMembership(req.params.id, userId);

    await prisma.conversationMember.updateMany({
      where: { conversationId: req.params.id, userId },
      data: { hiddenAt: new Date() },
    });

    await recordAudit({
      userId,
      action: AuditAction.CHAT_CLEARED,
      targetType: 'USER',
      targetId: req.params.id,
      ipAddress: requestIp(req),
    });

    res.json({ ok: true });
  }),
);

/** POST /api/chat/conversations/:id/show - un-hide after a new message. */
chatRouter.post(
  '/conversations/:id/show',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    await requireMembership(req.params.id, userId);

    await prisma.conversationMember.updateMany({
      where: { conversationId: req.params.id, userId },
      data: { hiddenAt: null },
    });

    res.json({ ok: true });
  }),
);

/** DELETE /api/chat/conversations/:id - leave/delete for this member. */
chatRouter.delete(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const { conversation } = await requireMembership(req.params.id, userId);

    await prisma.conversationMember.deleteMany({
      where: { conversationId: conversation.id, userId },
    });

    // Conversation with no members left is gone for good.
    const remaining = await prisma.conversationMember.count({
      where: { conversationId: conversation.id },
    });
    if (remaining === 0) {
      await prisma.conversation.delete({ where: { id: conversation.id } });
    }

    await recordAudit({
      userId,
      action: AuditAction.CHAT_DELETED,
      targetType: 'USER',
      targetId: conversation.id,
      ipAddress: requestIp(req),
    });

    res.json({ ok: true });
  }),
);

// --- Blocking ---------------------------------------------------------------

/** GET /api/chat/blocks - users this account has blocked. */
chatRouter.get(
  '/blocks',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const blocks = await prisma.chatBlock.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: { id: true, displayName: true, cipherId: true, username: true } } },
    });
    res.json({ blocks: blocks.map((b) => b.blocked) });
  }),
);

/** POST /api/chat/blocks - block a user (server-enforced on send). */
chatRouter.post(
  '/blocks',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    const blockedId = typeof req.body?.userId === 'string' ? req.body.userId : '';
    if (!blockedId || blockedId === userId) {
      throw ApiError.badRequest('Provide a valid userId to block', 'VALIDATION_ERROR');
    }

    await prisma.chatBlock.upsert({
      where: { blockerId_blockedId: { blockerId: userId, blockedId } },
      create: { blockerId: userId, blockedId },
      update: {},
    });

    await recordAudit({
      userId,
      action: AuditAction.CHAT_USER_BLOCKED,
      targetType: 'USER',
      targetId: blockedId,
      ipAddress: requestIp(req),
    });

    res.status(201).json({ ok: true });
  }),
);

/** DELETE /api/chat/blocks/:userId - unblock. */
chatRouter.delete(
  '/blocks/:userId',
  asyncHandler(async (req, res) => {
    const userId = currentUserId(req);
    await prisma.chatBlock.deleteMany({
      where: { blockerId: userId, blockedId: req.params.userId },
    });
    res.json({ ok: true });
  }),
);
