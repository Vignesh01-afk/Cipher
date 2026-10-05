/**
 * Shared API-facing types. These mirror `server/src/lib/serialize.ts`.
 */

export interface KeyMaterial {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  /** Public chat handle (CN-XXXXXX). */
  cipherId?: string;
  username?: string | null;
  publicKey: string;
  wrappedPrivateKey: string;
  privateKeyIv: string;
  kdfSalt: string;
  kdfIterations: number;
  wrappedMasterKey: string;
  masterKeyIv: string;
}

export interface PublicProfile {
  id: string;
  email: string;
  displayName: string;
  publicKey: string;
}

export interface ShareDto {
  id: string;
  noteId: string;
  sharedWithId: string;
  recipient: { id: string; displayName: string; email: string };
  keyAlgorithm: string;
  createdAt: string;
  revokedAt: string | null;
  isActive: boolean;
  wrappedKey?: string;
}

export interface NoteDto {
  id: string;
  ownerId: string;
  owner: { id: string; displayName: string; email: string };
  ciphertext: string;
  iv: string;
  encryptionVersion: number;
  algorithm: string;
  payloadBytes: number;
  wrappedNoteKey: string | null;
  noteKeyIv: string | null;
  createdAt: string;
  updatedAt: string;
  role: 'owner' | 'recipient';
  wrappedKey: string | null;
  keyAlgorithm: string | null;
  shares: ShareDto[];
}

export interface SharedNoteDto {
  shareId: string;
  noteId: string;
  grantedAt: string;
  keyAlgorithm: string;
  wrappedKey: string;
  owner: { id: string; displayName: string; email: string };
  ciphertext: string;
  iv: string;
  encryptionVersion: number;
  algorithm: string;
  payloadBytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogDto {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  noteId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: KeyMaterial;
}

/** Response of POST /auth/recovery/challenge (see server routes/auth.ts). */
export interface RecoveryChallengeResponse {
  displayName: string;
  wrappedMasterKeyRecovery: string;
  masterKeyRecoveryIv: string;
  recoveryKdfSalt: string;
  recoveryKdfIterations: number;
  privateKeyIv: string;
  wrappedPrivateKey: string;
}

// --- Email OTP password reset -----------------------------------------------

/** Response of POST /auth/password/request-code. */
export interface OtpRequestResponse {
  sentTo: string;
  cooldownSeconds: number;
  expiresInSeconds: number;
  /** True when SMTP is unconfigured and the code was logged server-side. */
  deliveredViaConsole: boolean;
}

/** Response of POST /auth/password/verify-code. */
export interface OtpVerifyResponse {
  resetToken: string;
  displayName: string;
  /** Escrow-unwrapped master key (base64) for the client-side re-wrap. */
  masterKeyRaw: string;
  expiresInSeconds: number;
}

/** Response of POST /auth/password/reset. Same shape as login. */
export interface OtpResetResponse extends AuthResponse {}

// --- Google sign-in -----------------------------------------------------------

/** Response of GET /auth/google/url. */
export interface GoogleUrlResponse {
  url: string;
  state: string;
}

/** Response of POST /auth/google when the identity has an account. */
export interface GoogleAuthResponse extends AuthResponse {
  /** Always true: the vault password is still needed to derive keys. */
  requiresUnlock: true;
}

/** Response of POST /auth/google when Google verified an identity with no account yet. */
export interface GoogleSignupRequiredResponse {
  signupRequired: true;
  /** Short-lived single-purpose token authorising POST /auth/google/register. */
  signupToken: string;
  email: string;
  displayName: string;
}

export type GoogleAuthOutcome = GoogleAuthResponse | GoogleSignupRequiredResponse;

export function isGoogleSignupRequired(
  outcome: GoogleAuthOutcome,
): outcome is GoogleSignupRequiredResponse {
  return (outcome as GoogleSignupRequiredResponse).signupRequired === true;
}

export interface ApiErrorPayload {
  error: string;
  code: string;
  details?: unknown;
}

// --- Chat ---------------------------------------------------------------------

/** A public chat identity - no email (chat addressing is by handle). */
export interface ChatUserDto {
  id: string;
  displayName: string;
  cipherId: string;
  username: string | null;
  publicKey?: string;
}

export interface ConversationDto {
  id: string;
  contextNoteId: string | null;
  createdAt: string;
  updatedAt: string;
  lastReadAt: string | null;
  wrappedConversationKey: string;
  keyAlgorithm: string;
  participants: Array<{ id: string; displayName: string; cipherId: string; username: string | null }>;
  lastMessage: {
    id: string;
    senderId: string;
    createdAt: string;
    readAt: string | null;
    deliveredAt: string | null;
    hasPayload: true;
  } | null;
  unreadCount: number;
}

export interface ConversationDetailDto {
  id: string;
  contextNoteId: string | null;
  createdAt: string;
  members: Array<{
    user: { id: string; displayName: string; cipherId: string; username: string | null };
    wrappedConversationKey: string;
    keyAlgorithm: string;
    lastReadAt: string | null;
  }>;
}

/** One encrypted message as stored/relayed - the payload is opaque here. */
export interface ChatMessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  ciphertext: string;
  iv: string;
  algorithm: string;
  encryptionVersion: number;
  payloadBytes: number;
  clientId: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
  /** Client-only: local send state for optimistic UI. */
  pending?: boolean;
  failed?: boolean;
}

export interface SecureFileDto {
  id: string;
  noteId: string;
  ownerId: string;
  filename: string;
  mimeType: string;
  extension: string | null;
  encryptedBytes: number;
  plaintextBytes: number;
  /** IV of the file ciphertext itself. */
  fileIv: string;
  encryptionVersion: number;
  algorithm: string;
  createdAt: string;
  /** Present for the owner: the file key wrapped with their master key. */
  wrappedFileKey?: string;
  fileKeyIv?: string;
  /** Present for every participant: the file key wrapped with the note key. */
  wrappedForNoteKey?: string;
  noteKeyWrapIv?: string;
}
