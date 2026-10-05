/**
 * Chat cryptography - reuses the note-key primitives from crypto.ts.
 *
 * Hierarchy: a random AES-256-GCM conversation key encrypts every message;
 * it is RSA-OAEP-wrapped to each member's public key and stored on their
 * membership row. The server relays ciphertext and never holds an unwrapped
 * conversation key. Same shape as a NoteShare, so no new primitives.
 */
import {
  decryptBytes,
  encryptBytes,
  importAesKey,
  importRecipientPublicKey,
  toBase64,
  wrapNoteKeyForRecipient,
  unwrapNoteKeyFromOwner,
  type CryptoSession,
} from './crypto';

export const CHAT_ALGORITHM = 'AES-GCM-256';
export const CHAT_ENCRYPTION_VERSION = 1;

/** Plaintext payload carried inside one encrypted chat message. */
export interface ChatMessagePayload {
  v: number;
  /** 'text' = a normal message; 'note-share' = a share card (no plaintext). */
  type: 'text' | 'note-share';
  text?: string;
  /** For note-share cards: metadata only, content stays encrypted in the note. */
  note?: {
    id: string;
    title: string;
    /** True when the sender re-shared or created a share inside this chat. */
    sharedViaChat: boolean;
  };
}

export interface EncryptedChatMessage {
  /** AES-GCM ciphertext (base64) of the JSON payload. */
  ciphertext: string;
  iv: string;
  /** Conversation key RSA-wrapped per member: { [userId]: base64 }. */
  wrappedConversationKeys: Record<string, string>;
  /** Plaintext byte length of the payload (metadata/stat only). */
  payloadBytes: number;
}

export interface ConversationCrypto {
  /** Raw conversation key (base64) - wrapped per member before sending. */
  conversationKeyRaw: string;
  key: CryptoKey;
}

/** Generates a fresh conversation key in the browser. */
export async function createConversationKey(): Promise<ConversationCrypto> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await importAesKey(raw, true);
  return { conversationKeyRaw: toBase64(raw), key };
}

/** Re-opens an existing conversation key from the wrap stored on my membership. */
export async function openConversationKey(
  wrappedConversationKey: string,
  session: CryptoSession,
): Promise<ConversationCrypto> {
  const raw = await unwrapNoteKeyFromOwner(session.privateKey, wrappedConversationKey);
  const key = await importAesKey(raw, true);
  return { conversationKeyRaw: toBase64(raw), key };
}

/**
 * Wraps the conversation key for every member (including me) using their
 * stored public keys: { userId -> RSA-OAEP(base64) }.
 */
export async function wrapConversationKeyForMembers(
  conversationKeyRaw: string,
  memberPublicKeys: Record<string, string>,
): Promise<Record<string, string>> {
  const raw = Uint8Array.from(atob(conversationKeyRaw), (c) => c.charCodeAt(0));
  const wrapped: Record<string, string> = {};
  for (const [userId, publicKeySpki] of Object.entries(memberPublicKeys)) {
    const recipientKey = await importRecipientPublicKey(publicKeySpki);
    wrapped[userId] = await wrapNoteKeyForRecipient(recipientKey, raw);
  }
  return wrapped;
}

/** Encrypts a chat payload into a sendable envelope (client-side, pre-send). */
export async function encryptChatMessage(
  conversationKey: CryptoKey,
  payload: ChatMessagePayload,
): Promise<{ ciphertext: string; iv: string; payloadBytes: number }> {
  const serialised = new TextEncoder().encode(JSON.stringify({ ...payload, v: CHAT_ENCRYPTION_VERSION }));
  const { iv, ciphertext } = await encryptBytes(conversationKey, serialised);
  return { ciphertext, iv, payloadBytes: serialised.byteLength };
}

/** Decrypts a received envelope back into the plaintext payload. */
export async function decryptChatMessage(
  conversationKey: CryptoKey,
  ciphertext: string,
  iv: string,
): Promise<ChatMessagePayload> {
  const bytes = await decryptBytes(conversationKey, ciphertext, iv);
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ChatMessagePayload> & { v?: number };
  return {
    v: typeof parsed.v === 'number' ? parsed.v : CHAT_ENCRYPTION_VERSION,
    type: parsed.type === 'note-share' ? 'note-share' : 'text',
    text: typeof parsed.text === 'string' ? parsed.text : undefined,
    note:
      parsed.note && typeof parsed.note === 'object'
        ? {
            id: typeof parsed.note.id === 'string' ? parsed.note.id : '',
            title: typeof parsed.note.title === 'string' ? parsed.note.title : '',
            sharedViaChat: parsed.note.sharedViaChat === true,
          }
        : undefined,
  };
}
