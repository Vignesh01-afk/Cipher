import type {
  AuditLogDto,
  AuthResponse,
  GoogleAuthOutcome,
  GoogleUrlResponse,
  KeyMaterial,
  NoteDto,
  OtpRequestResponse,
  OtpResetResponse,
  OtpVerifyResponse,
  PreloginResponse,
  PublicProfile,
  RecoveryChallengeResponse,
  SecureFileDto,
  ShareDto,
  SharedNoteDto,
  ChatUserDto,
  ConversationDto,
  ConversationDetailDto,
  ChatMessageDto,
} from './types';

/**
 * Thin fetch wrapper around the CipherNote API.
 *
 * The session token is kept in memory and mirrored to localStorage so a reload
 * can restore the session. Note keys are NOT part of this - they stay in memory
 * and require the password to be re-derived (see AuthContext.unlock).
 */

const TOKEN_STORAGE_KEY = 'ciphernote.session.token';

/**
 * API base URL.
 *
 * Defaults to the relative `/api`, which is correct in both environments:
 *  - local dev: Vite proxies /api -> http://localhost:4000 (see vite.config.ts)
 *  - deployed:  Vercel serves the API as a same-origin function at /api
 * Set VITE_API_BASE_URL only to point the client at a different origin.
 * (`import.meta.env` is optional-chained so this module can also be imported
 * by non-Vite tooling, e.g. the Node test runner.)
 */
export const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the session is missing, expired or no longer valid. */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

const REMEMBER_STORAGE_KEY = 'ciphernote.session.remember';

function readStoredToken(): string | null {
  try {
    // "Remember me" sessions live in localStorage; unchecked sessions are
    // scoped to the tab (sessionStorage) and end when it closes.
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

let authToken: string | null = readStoredToken();

export function getAuthToken(): string | null {
  return authToken;
}

/**
 * Persists (or clears) the session token.
 *
 * `remember` mirrors the "Remember me" checkbox on the sign-in screen:
 * true keeps the session across browser restarts (localStorage), false keeps
 * it only for this tab (sessionStorage).
 */
export function setAuthToken(token: string | null, options: { remember?: boolean } = {}): void {
  const remember = options.remember ?? true;
  authToken = token;
  try {
    if (token) {
      if (remember) {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      } else {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    /* storage unavailable - the session stays in memory only */
  }
}

/** Last "Remember me" choice, used as the sign-in form default. */
export function getRememberPreference(): boolean {
  try {
    return localStorage.getItem(REMEMBER_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setRememberPreference(remember: boolean): void {
  try {
    localStorage.setItem(REMEMBER_STORAGE_KEY, remember ? '1' : '0');
  } catch {
    /* storage unavailable - keep the in-memory default */
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the CipherNote API. Is the server running?');
  }

  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const errorPayload = (payload ?? {}) as { error?: string; code?: string; details?: unknown };
    throw new ApiError(
      response.status,
      errorPayload.code ?? 'REQUEST_FAILED',
      errorPayload.error ?? `Request failed with status ${response.status}`,
      errorPayload.details,
    );
  }

  return payload as T;
}

// --- Endpoints -------------------------------------------------------------

export interface RegisterPayload {
  email: string;
  displayName: string;
  /**
   * Split-derivation credential: the second 256 bits of the 512-bit PBKDF2
   * output. The password itself never reaches the server (authVersion 2).
   */
  authKey: string;
  publicKey: string;
  wrappedPrivateKey: string;
  privateKeyIv: string;
  kdfSalt: string;
  kdfIterations: number;
  wrappedMasterKey: string;
  masterKeyIv: string;
  /** Raw master key (base64) for the server-side escrow wrap (OTP reset). */
  masterKeyRaw?: string;
}

export interface GoogleRegisterPayload {
  signupToken: string;
  displayName: string;
  /** Split-derivation credential (see RegisterPayload). */
  authKey: string;
  publicKey: string;
  wrappedPrivateKey: string;
  privateKeyIv: string;
  kdfSalt: string;
  kdfIterations: number;
  wrappedMasterKey: string;
  masterKeyIv: string;
  /** Raw master key (base64) for the server-side escrow wrap (OTP reset). */
  masterKeyRaw?: string;
}

export interface CreateNotePayload {
  ciphertext: string;
  iv: string;
  encryptionVersion: number;
  algorithm: string;
  payloadBytes: number;
  wrappedNoteKey: string;
  noteKeyIv: string;
}

export type UpdateNotePayload = Partial<CreateNotePayload>;

export const api = {
  async register(payload: RegisterPayload): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/register', { method: 'POST', body: payload });
  },

  /**
   * Public KDF parameters for building a login credential. Must be called
   * before `login`: `authVersion` decides authKey (v2) vs legacy password.
   */
  async prelogin(email: string): Promise<PreloginResponse> {
    return request<PreloginResponse>('/auth/prelogin', { method: 'POST', body: { email } });
  },

  /**
   * Signs in with exactly one credential: `authKey` (split derivation, the
   * normal path) or the legacy raw `password` (authVersion 1 accounts only).
   */
  async login(
    email: string,
    credential: { authKey?: string; password?: string },
  ): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/login', { method: 'POST', body: { email, ...credential } });
  },

  /** v1 -> v2 migration: stores the authKey hash after a password login. */
  async upgradeAuth(authKey: string): Promise<{ ok: boolean; authVersion: number }> {
    return request<{ ok: boolean; authVersion: number }>('/auth/upgrade-auth', {
      method: 'POST',
      body: { authKey },
    });
  },

  async me(): Promise<{ user: KeyMaterial }> {
    return request<{ user: KeyMaterial }>('/auth/me');
  },

  async logout(): Promise<void> {
    await request<void>('/auth/logout', { method: 'POST' });
  },

  async lookUpUser(email: string): Promise<PublicProfile> {
    const result = await request<{ user: PublicProfile }>(
      `/users/lookup?email=${encodeURIComponent(email)}`,
    );
    return result.user;
  },

  async listNotes(): Promise<NoteDto[]> {
    const result = await request<{ notes: NoteDto[] }>('/notes');
    return result.notes;
  },

  async getNote(noteId: string): Promise<NoteDto> {
    const result = await request<{ note: NoteDto }>(`/notes/${encodeURIComponent(noteId)}`);
    return result.note;
  },

  async createNote(payload: CreateNotePayload): Promise<NoteDto> {
    const result = await request<{ note: NoteDto }>('/notes', { method: 'POST', body: payload });
    return result.note;
  },

  async updateNote(noteId: string, payload: UpdateNotePayload): Promise<NoteDto> {
    const result = await request<{ note: NoteDto }>(`/notes/${encodeURIComponent(noteId)}`, {
      method: 'PATCH',
      body: payload,
    });
    return result.note;
  },

  async deleteNote(noteId: string): Promise<void> {
    await request<void>(`/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
  },

  async listShares(noteId: string): Promise<ShareDto[]> {
    const result = await request<{ shares: ShareDto[] }>(
      `/notes/${encodeURIComponent(noteId)}/shares`,
    );
    return result.shares;
  },

  async createShare(noteId: string, userId: string, wrappedKey: string): Promise<ShareDto> {
    const result = await request<{ share: ShareDto }>(
      `/notes/${encodeURIComponent(noteId)}/shares`,
      { method: 'POST', body: { userId, wrappedKey } },
    );
    return result.share;
  },

  async revokeShare(noteId: string, userId: string): Promise<ShareDto> {
    const result = await request<{ share: ShareDto }>(
      `/notes/${encodeURIComponent(noteId)}/shares/${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
    );
    return result.share;
  },

  async listSharedWithMe(): Promise<SharedNoteDto[]> {
    const result = await request<{ shares: SharedNoteDto[] }>('/shared');
    return result.shares;
  },

  async listAuditLogs(options: { action?: string; limit?: number } = {}): Promise<AuditLogDto[]> {
    const params = new URLSearchParams();
    if (options.action) params.set('action', options.action);
    if (options.limit) params.set('limit', String(options.limit));
    const query = params.toString();
    const result = await request<{ logs: AuditLogDto[] }>(`/audit${query ? `?${query}` : ''}`);
    return result.logs;
  },

  // --- Password recovery ------------------------------------------------------

  async setupRecovery(payload: {
    kdfSalt: string;
    kdfIterations: number;
    wrappedMasterKeyRecovery: string;
    masterKeyRecoveryIv: string;
    /** HKDF verifier computed in the browser; the raw key never leaves it. */
    recoveryVerifier: string;
  }): Promise<void> {
    await request<{ ok: boolean }>('/auth/recovery/setup', { method: 'POST', body: payload });
  },

  async recoveryChallenge(payload: {
    email: string;
    /** HKDF verifier computed in the browser; the raw key never leaves it. */
    recoveryVerifier: string;
  }): Promise<RecoveryChallengeResponse> {
    return request<RecoveryChallengeResponse>('/auth/recovery/challenge', { method: 'POST', body: payload });
  },

  async recoveryReset(payload: {
    email: string;
    /** HKDF verifier computed in the browser; the raw key never leaves it. */
    recoveryVerifier: string;
    /** Split-derivation credential for the NEW password (never the password). */
    authKey: string;
    kdfSalt: string;
    kdfIterations: number;
    wrappedMasterKey: string;
    masterKeyIv: string;
    masterKeyRaw?: string;
  }): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/recovery/reset', { method: 'POST', body: payload });
  },

  // --- Email OTP password reset ----------------------------------------------

  async requestPasswordResetCode(email: string): Promise<OtpRequestResponse> {
    return request<OtpRequestResponse>('/auth/password/request-code', {
      method: 'POST',
      body: { email },
    });
  },

  async verifyPasswordResetCode(email: string, code: string): Promise<OtpVerifyResponse> {
    return request<OtpVerifyResponse>('/auth/password/verify-code', {
      method: 'POST',
      body: { email, code },
    });
  },

  async resetPasswordWithOtp(payload: {
    resetToken: string;
    /** Split-derivation credential for the NEW password (never the password). */
    authKey: string;
    kdfSalt: string;
    kdfIterations: number;
    wrappedMasterKey: string;
    masterKeyIv: string;
  }): Promise<OtpResetResponse> {
    return request<OtpResetResponse>('/auth/password/reset', { method: 'POST', body: payload });
  },

  // --- Google sign-in ----------------------------------------------------------

  async getGoogleAuthUrl(): Promise<GoogleUrlResponse> {
    return request<GoogleUrlResponse>('/auth/google/url');
  },

  async googleSignIn(code: string, state: string): Promise<GoogleAuthOutcome> {
    return request<GoogleAuthOutcome>('/auth/google', { method: 'POST', body: { code, state } });
  },

  async googleRegister(payload: GoogleRegisterPayload): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/google/register', { method: 'POST', body: payload });
  },

  // --- Chat -------------------------------------------------------------------

  async searchUsers(q: string): Promise<{ users: ChatUserDto[] }> {
    return request<{ users: ChatUserDto[] }>(`/chat/users/search?q=${encodeURIComponent(q)}`);
  },

  async listConversations(): Promise<{ conversations: ConversationDto[] }> {
    return request<{ conversations: ConversationDto[] }>('/chat/conversations');
  },

  async getConversation(conversationId: string): Promise<{ conversation: ConversationDetailDto }> {
    return request<{ conversation: ConversationDetailDto }>(
      `/chat/conversations/${encodeURIComponent(conversationId)}`,
    );
  },

  async startConversation(payload: {
    recipientId: string;
    contextNoteId?: string;
    wrappedKeys: Record<string, string>;
  }): Promise<{ conversation: { id: string; wrappedConversationKey: string | null; reused: boolean; contextNoteId: string | null } }> {
    return request('/chat/conversations', { method: 'POST', body: payload });
  },

  async listMessages(
    conversationId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{ messages: ChatMessageDto[]; nextCursor: string | null }> {
    const params = new URLSearchParams();
    if (options.cursor) params.set('cursor', options.cursor);
    if (options.limit) params.set('limit', String(options.limit));
    const query = params.toString();
    return request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages${query ? `?${query}` : ''}`);
  },

  async sendMessage(
    conversationId: string,
    payload: {
      ciphertext: string;
      iv: string;
      clientId: string;
      payloadBytes: number;
      wrappedConversationKeys: Record<string, string>;
      kind?: 'note-share';
      noteId?: string;
    },
  ): Promise<{ message: ChatMessageDto }> {
    return request(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: payload,
    });
  },

  async markConversationRead(conversationId: string): Promise<void> {
    await request(`/chat/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'POST' });
  },

  async hideConversation(conversationId: string): Promise<void> {
    await request(`/chat/conversations/${encodeURIComponent(conversationId)}/hide`, { method: 'POST' });
  },

  async deleteConversation(conversationId: string): Promise<void> {
    await request(`/chat/conversations/${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
  },

  async listBlocked(): Promise<{ blocks: ChatUserDto[] }> {
    return request<{ blocks: ChatUserDto[] }>('/chat/blocks');
  },

  async blockUser(userId: string): Promise<void> {
    await request('/chat/blocks', { method: 'POST', body: { userId } });
  },

  async unblockUser(userId: string): Promise<void> {
    await request(`/chat/blocks/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  },

  // --- Secure files ---------------------------------------------------------

  async listFiles(noteId: string): Promise<SecureFileDto[]> {
    const result = await request<{ files: SecureFileDto[] }>(
      `/files?noteId=${encodeURIComponent(noteId)}`,
    );
    return result.files;
  },

  async getFileMeta(fileId: string): Promise<SecureFileDto> {
    const result = await request<{ file: SecureFileDto }>(`/files/${encodeURIComponent(fileId)}`);
    return result.file;
  },

  async deleteFile(fileId: string): Promise<void> {
    await request<void>(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  },
};
