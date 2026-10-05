import { test, expect } from '@playwright/test';
import { loadAccounts, tokenFromStorageState } from './helpers/accounts';
import {
  authHeaders,
  createNoteViaApi,
  deleteNoteViaApi,
  getConversationViaApi,
  getNoteViaApi,
  listMessagesViaApi,
  listSharesViaApi,
  listSharedWithMeViaApi,
  lookupUserId,
  revokeShareViaApi,
  shareNoteViaApi,
  updateNoteViaApi,
} from './helpers/api';

/**
 * Authorization / IDOR (BOLA) suite.
 *
 * Every check goes through the REAL HTTP API with a real Bearer token, so the
 * backend's authorization gate is exercised directly. No browser is needed:
 * tokens are read from each account's saved storageState.
 */
const book = loadAccounts();
const aliceToken = tokenFromStorageState('alice');
const bobToken = tokenFromStorageState('bob');
const carolToken = tokenFromStorageState('carol');

test.describe('Authentication is required', () => {
  test('anonymous requests to protected endpoints are rejected with 401', async ({ request }) => {
    const paths = ['/api/notes', '/api/shared', '/api/chat/conversations', '/api/audit'];
    for (const path of paths) {
      const response = await request.get(path);
      expect(response.status(), `${path} should require auth`).toBe(401);
    }
  });

  test('a forged token is rejected', async ({ request }) => {
    const response = await request.get('/api/notes', {
      headers: { Authorization: 'Bearer not.a.real.token' },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe('Note authorization', () => {
  test("Bob cannot read, edit or delete Alice's private note", async ({ request }) => {
    const noteId = await createNoteViaApi(request, aliceToken);

    // Control: the owner can read it.
    expect((await getNoteViaApi(request, aliceToken, noteId)).status()).toBe(200);

    expect((await getNoteViaApi(request, bobToken, noteId)).status()).toBe(403);
    expect((await updateNoteViaApi(request, bobToken, noteId)).status()).toBe(403);
    expect((await deleteNoteViaApi(request, bobToken, noteId)).status()).toBe(403);

    // The owner's note really is untouched.
    const stillThere = await getNoteViaApi(request, aliceToken, noteId);
    expect(stillThere.status()).toBe(200);
  });

  test("Bob cannot enumerate or manage shares on Alice's note", async ({ request }) => {
    const noteId = await createNoteViaApi(request, aliceToken);

    expect((await listSharesViaApi(request, bobToken, noteId)).status()).toBe(403);

    const bobId = await lookupUserId(request, aliceToken, book.bob.email);
    const forgedShare = await shareNoteViaApi(request, bobToken, noteId, bobId);
    expect(forgedShare.status()).toBe(403);

    // Alice never granted anything, so revocation must also be refused.
    const forgedRevoke = await revokeShareViaApi(request, bobToken, noteId, bobId);
    expect(forgedRevoke.status()).toBe(403);
  });

  test("Alice's private note never appears in Bob's shared list", async ({ request }) => {
    const noteId = await createNoteViaApi(request, aliceToken);
    const response = await listSharedWithMeViaApi(request, bobToken);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { shares: { noteId: string }[] };
    expect(body.shares.map((s) => s.noteId)).not.toContain(noteId);
  });

  test('a non-existent note id returns 404, not a server error', async ({ request }) => {
    const response = await getNoteViaApi(request, aliceToken, 'clzzzzzzzzzzzzzzzzzzzzzzz');
    expect(response.status()).toBe(404);
    expect((await response.json()).code).toBe('NOTE_NOT_FOUND');
  });
});

test.describe('Share authorization (grant -> use -> revoke)', () => {
  test('a recipient can read but not modify, and loses access immediately on revoke', async ({ request }) => {
    const noteId = await createNoteViaApi(request, aliceToken);
    const bobId = await lookupUserId(request, aliceToken, book.bob.email);

    // Before sharing: denied.
    expect((await getNoteViaApi(request, bobToken, noteId)).status()).toBe(403);

    // Alice grants access.
    const granted = await shareNoteViaApi(request, aliceToken, noteId, bobId);
    expect(granted.status()).toBe(201);

    // Recipient can READ...
    const asRecipient = await getNoteViaApi(request, bobToken, noteId);
    expect(asRecipient.status()).toBe(200);
    const note = (await asRecipient.json()) as { note: { role: string } };
    expect(note.note.role).toBe('recipient');

    // ...but cannot write, delete, or manage the share list.
    expect((await updateNoteViaApi(request, bobToken, noteId)).status()).toBe(403);
    expect((await deleteNoteViaApi(request, bobToken, noteId)).status()).toBe(403);
    expect((await listSharesViaApi(request, bobToken, noteId)).status()).toBe(403);

    // And it now shows up in Bob's shared-with-me list.
    const shared = await listSharedWithMeViaApi(request, bobToken);
    const sharedBody = (await shared.json()) as { shares: { noteId: string }[] };
    expect(sharedBody.shares.map((s) => s.noteId)).toContain(noteId);

    // Alice revokes.
    const revoked = await revokeShareViaApi(request, aliceToken, noteId, bobId);
    expect(revoked.status()).toBe(200);

    // Access is gone, immediately, everywhere.
    expect((await getNoteViaApi(request, bobToken, noteId)).status()).toBe(403);
    const afterRevoke = await listSharedWithMeViaApi(request, bobToken);
    const afterBody = (await afterRevoke.json()) as { shares: { noteId: string }[] };
    expect(afterBody.shares.map((s) => s.noteId)).not.toContain(noteId);

    // Owner unaffected.
    expect((await getNoteViaApi(request, aliceToken, noteId)).status()).toBe(200);
  });
});

test.describe('Chat authorization', () => {
  test("Bob cannot read or write a conversation he is not a member of", async ({ request }) => {
    const aliceId = await lookupUserId(request, aliceToken, book.alice.email);
    const carolId = await lookupUserId(request, aliceToken, book.carol.email);
    const wrap = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2';

    // Alice starts a 1:1 conversation with Carol (Bob is not a member).
    const started = await request.post('/api/chat/conversations', {
      headers: authHeaders(aliceToken),
      data: {
        recipientId: carolId,
        wrappedKeys: { [aliceId]: wrap, [carolId]: wrap },
      },
    });
    expect([200, 201]).toContain(started.status());
    const { conversation } = (await started.json()) as { conversation: { id: string } };

    // Carol (a member) can read it.
    expect((await getConversationViaApi(request, carolToken, conversation.id)).status()).toBe(200);

    // Bob (not a member) cannot.
    expect((await getConversationViaApi(request, bobToken, conversation.id)).status()).toBe(403);
    expect((await listMessagesViaApi(request, bobToken, conversation.id)).status()).toBe(403);

    const send = await request.post(`/api/chat/conversations/${conversation.id}/messages`, {
      headers: authHeaders(bobToken),
      data: {
        ciphertext: 'QUJDREVGR0hJSktMTU5PUA==',
        iv: 'AAAAAAAAAAAAAAAA',
        clientId: `idor-${Date.now()}`,
        payloadBytes: 12,
      },
    });
    expect(send.status()).toBe(403);

    const hide = await request.post(`/api/chat/conversations/${conversation.id}/hide`, {
      headers: authHeaders(bobToken),
    });
    expect(hide.status()).toBe(403);

    const remove = await request.delete(`/api/chat/conversations/${conversation.id}`, {
      headers: authHeaders(bobToken),
    });
    expect(remove.status()).toBe(403);
  });
});
