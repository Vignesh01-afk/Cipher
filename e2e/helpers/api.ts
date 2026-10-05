import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Thin API helpers for the authorization / IDOR tests.
 *
 * All paths are relative (`/api/...`), so they resolve against the configured
 * baseURL and travel through the same Vite proxy the app uses. The server
 * validates these fields only as base64 blobs - it never inspects content -
 * so a synthetic ciphertext is enough for access-control tests.
 */

export const BASE64_CIPHERTEXT = 'QUJDREVGR0hJSktMTU5PUA==';
export const BASE64_IV = 'AAAAAAAAAAAAAAAA';
export const BASE64_KEY = 'QUJDREVGR0hJSktMTU5PUA==';

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function createNoteViaApi(
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await request.post('/api/notes', {
    headers: authHeaders(token),
    data: {
      ciphertext: BASE64_CIPHERTEXT,
      iv: BASE64_IV,
      encryptionVersion: 1,
      algorithm: 'AES-GCM-256',
      payloadBytes: 12,
      wrappedNoteKey: BASE64_KEY,
      noteKeyIv: BASE64_IV,
      ...overrides,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = (await response.json()) as { note: { id: string } };
  return body.note.id;
}

export async function lookupUserId(
  request: APIRequestContext,
  token: string,
  email: string,
): Promise<string> {
  const response = await request.get(`/api/users/lookup?email=${encodeURIComponent(email)}`, {
    headers: authHeaders(token),
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = (await response.json()) as { user: { id: string } };
  return body.user.id;
}

export function getNoteViaApi(request: APIRequestContext, token: string, noteId: string) {
  return request.get(`/api/notes/${noteId}`, { headers: authHeaders(token) });
}

export function updateNoteViaApi(request: APIRequestContext, token: string, noteId: string) {
  return request.patch(`/api/notes/${noteId}`, {
    headers: authHeaders(token),
    data: { ciphertext: BASE64_CIPHERTEXT },
  });
}

export function deleteNoteViaApi(request: APIRequestContext, token: string, noteId: string) {
  return request.delete(`/api/notes/${noteId}`, { headers: authHeaders(token) });
}

export function listSharesViaApi(request: APIRequestContext, token: string, noteId: string) {
  return request.get(`/api/notes/${noteId}/shares`, { headers: authHeaders(token) });
}

export function shareNoteViaApi(
  request: APIRequestContext,
  token: string,
  noteId: string,
  userId: string,
  wrappedKey: string = BASE64_KEY,
) {
  return request.post(`/api/notes/${noteId}/shares`, {
    headers: authHeaders(token),
    data: { userId, wrappedKey },
  });
}

export function revokeShareViaApi(
  request: APIRequestContext,
  token: string,
  noteId: string,
  userId: string,
) {
  return request.delete(`/api/notes/${noteId}/shares/${userId}`, { headers: authHeaders(token) });
}

export function listSharedWithMeViaApi(request: APIRequestContext, token: string) {
  return request.get('/api/shared', { headers: authHeaders(token) });
}

export function getConversationViaApi(request: APIRequestContext, token: string, conversationId: string) {
  return request.get(`/api/chat/conversations/${conversationId}`, { headers: authHeaders(token) });
}

export function listMessagesViaApi(request: APIRequestContext, token: string, conversationId: string) {
  return request.get(`/api/chat/conversations/${conversationId}/messages`, {
    headers: authHeaders(token),
  });
}

/**
 * Client-side navigation without a page reload.
 *
 * A full `page.goto` would re-lock the vault (keys are memory-only), so tests
 * that already unlocked a session move around by pushing history + dispatching
 * popstate, which is exactly what React Router reacts to.
 */
export async function clientNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}
