import type {
  AuditLogDto,
  AuthResponse,
  KeyMaterial,
  NoteDto,
  PublicProfile,
  RecoveryChallengeResponse,
  SecureFileDto,
  ShareDto,
  SharedNoteDto,
} from './types';

/**
 * Thin fetch wrapper around the CipherNote API.
 *
 * The session token is kept in memory and mirrored to localStorage so a reload
 * can restore the session. Note keys are NOT part of this - they stay in memory
 * and require the password to be re-derived (see AuthContext.unlock).
 */

const TOKEN_STORAGE_KEY = 'ciphernote.session.token';

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

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

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

let authToken: string | null = readStoredToken();

export function getAuthToken(): string | null {
  return authToken;
}

export function setAuthToken(token: string | null): void {
  authToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* storage unavailable - the session stays in memory only */
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
  password: string;
  publicKey: string;
  wrappedPrivateKey: string;
  privateKeyIv: string;
  kdfSalt: string;
  kdfIterations: number;
  wrappedMasterKey: string;
  masterKeyIv: string;
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

  async login(email: string, password: string): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } });
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
    recoveryKey: string;
    kdfSalt: string;
    kdfIterations: number;
    wrappedMasterKeyRecovery: string;
    masterKeyRecoveryIv: string;
    recoveryKeyHash: string;
  }): Promise<void> {
    await request<{ ok: boolean }>('/auth/recovery/setup', { method: 'POST', body: payload });
  },

  async recoveryChallenge(payload: {
    email: string;
    recoveryKey: string;
    recoveryKeyHash: string;
  }): Promise<RecoveryChallengeResponse> {
    return request<RecoveryChallengeResponse>('/auth/recovery/challenge', { method: 'POST', body: payload });
  },

  async recoveryReset(payload: {
    email: string;
    recoveryKey: string;
    recoveryKeyHash: string;
    newPassword: string;
    kdfSalt: string;
    kdfIterations: number;
    wrappedMasterKey: string;
    masterKeyIv: string;
  }): Promise<AuthResponse> {
    return request<AuthResponse>('/auth/recovery/reset', { method: 'POST', body: payload });
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
