/**
 * In-memory cache of user id -> RSA public key (SPKI base64).
 *
 * Public keys are fetched on demand from the API as conversations are opened
 * and are only ever held in memory for the lifetime of the tab - they are
 * never written to storage. Kept in its own module so both the chat page and
 * the chat share-note modal share one cache instance.
 */
export const chatPublicKeyCache = new Map<string, string>();
