// Removes throwaway accounts created by the E2E/browser test scripts.
// Usage (from server/): node scripts/cleanup-test-users.mjs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PREFIXES = [
  'browser-alice-',
  'browser-bob-',
  'probe-p-',
  'probe-q-',
  'probe2-p-',
  'probe2-q-',
  'probe3-p-',
  'probe3-q-',
  'note-probe-',
  'smoke-',
];

try {
  const users = await prisma.user.findMany({
    where: { OR: PREFIXES.map((prefix) => ({ email: { startsWith: prefix } })) },
    select: { id: true, email: true },
  });

  // Delete conversations involving any of these users first (hard FK chains).
  const userIds = users.map((u) => u.id);
  const convos = await prisma.conversation.findMany({
    where: { members: { some: { userId: { in: userIds } } } },
    select: { id: true },
  });
  if (convos.length > 0) {
    await prisma.encryptedMessage.deleteMany({ where: { conversationId: { in: convos.map((c) => c.id) } } });
    await prisma.conversationMember.deleteMany({ where: { conversationId: { in: convos.map((c) => c.id) } } });
    await prisma.conversation.deleteMany({ where: { id: { in: convos.map((c) => c.id) } } });
  }

  const ids = users.map((u) => u.id);
  await prisma.chatBlock.deleteMany({ where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] } });
  await prisma.otpToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  // Files attached to their notes, then shares, then notes, then users.
  const notes = await prisma.note.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
  const noteIds = notes.map((n) => n.id);
  await prisma.secureFile.deleteMany({ where: { noteId: { in: noteIds } } });
  await prisma.noteShare.deleteMany({
    where: { OR: [{ ownerId: { in: ids } }, { sharedWithId: { in: ids } }] },
  });
  await prisma.note.deleteMany({ where: { ownerId: { in: ids } } });
  const deleted = await prisma.user.deleteMany({ where: { id: { in: ids } } });

  console.log(`Deleted ${deleted.count} test users, ${convos.length} conversations.`);
} catch (error) {
  console.error('Cleanup failed:', error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
