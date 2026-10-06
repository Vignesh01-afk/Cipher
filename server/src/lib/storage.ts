import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../env';

/**
 * Private storage for encrypted file blobs.
 *
 * DESIGN RULES
 *  - Blobs are always AES-GCM ciphertext produced in the browser. Neither
 *    backend can read them even with full access to the stored bytes.
 *  - There is no public URL: every read goes through `GET /api/files/:id/content`
 *    (or a short-lived signed URL minted by that route), which authenticates
 *    the caller and re-validates note access on every request.
 *  - Storage keys are generated with the OS CSPRNG and stored on the record.
 *    User input is never part of the path, so path traversal is impossible by
 *    construction; the local driver additionally verifies containment.
 *
 * Two backends implement the same interface:
 *  - `local`    - a private directory on the host filesystem (default for dev
 *                 and self-hosted single-instance deployments).
 *  - `supabase` - a private Supabase Storage bucket, required for serverless
 *                 hosts (Vercel) where there is no durable local disk. It also
 *                 supports direct browser uploads and signed download URLs so
 *                 large blobs never pass through the API function.
 */

export type StorageDriverKind = 'local' | 'supabase';

export interface UploadTarget {
  /** Absolute URL the browser PUTs the encrypted blob to. */
  url: string;
  /** Header/value pairs the browser must send with that PUT. */
  headers: Record<string, string>;
}

export interface StorageAdapter {
  readonly kind: StorageDriverKind;
  /** True when the browser can upload straight to the backend. */
  readonly supportsDirectUpload: boolean;
  /** Writes a blob and returns its exact byte length. */
  put(key: string, body: Buffer, contentType?: string): Promise<number>;
  /** Reads a blob. Throws when it is missing. */
  get(key: string): Promise<Buffer>;
  /** Removes a blob. Missing objects are tolerated (idempotent delete). */
  delete(key: string): Promise<void>;
  /** Object byte length, or null when the object does not exist. */
  head(key: string): Promise<{ bytes: number } | null>;
  /** Presigned PUT for a direct browser upload (null when unsupported). */
  createUploadTarget(key: string): Promise<UploadTarget | null>;
  /** Presigned GET URL valid for `expiresIn` seconds (null when unsupported). */
  createDownloadUrl(key: string, expiresIn: number): Promise<string | null>;
}

/* -------------------------------------------------------------------------- */
/* Key generation + local path safety                                         */
/* -------------------------------------------------------------------------- */

/** Root directory for local encrypted blobs (created lazily, never indexed). */
export function storageRoot(): string {
  return path.resolve(process.cwd(), env.fileStorageDir);
}

/**
 * Generates a fresh storage key for a new blob. Format:
 *   <random base64url 32 chars>.bin
 * Contains no user input, so it can never be used for path traversal. The key
 * is stored on the SecureFile record and required for every read, but knowing
 * it grants nothing without API authorisation.
 */
export function generateStorageKey(): string {
  return `${randomBytes(24).toString('base64url')}.bin`;
}

/**
 * Resolves a stored key to an absolute path inside the storage root.
 *
 * The regex rejects anything containing separators, and the `relative` check
 * is defence in depth against exotic names - a resolved path that escapes the
 * root can never be read or written.
 */
export function resolveKeyPath(storageKey: string): string {
  if (!/^[A-Za-z0-9_-]+\.bin$/.test(storageKey)) {
    throw new Error('Invalid storage key');
  }
  const resolved = path.resolve(storageRoot(), storageKey);
  const relative = path.relative(storageRoot(), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid storage key');
  }
  return resolved;
}

/* -------------------------------------------------------------------------- */
/* Local disk driver                                                          */
/* -------------------------------------------------------------------------- */

class LocalDiskStorage implements StorageAdapter {
  readonly kind = 'local' as const;
  readonly supportsDirectUpload = false;

  async put(storageKey: string, body: Buffer): Promise<number> {
    const target = resolveKeyPath(storageKey);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body, { mode: 0o600 });
    return body.byteLength;
  }

  async get(storageKey: string): Promise<Buffer> {
    return fs.readFile(resolveKeyPath(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await fs.unlink(resolveKeyPath(storageKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async head(storageKey: string): Promise<{ bytes: number } | null> {
    try {
      const stat = await fs.stat(resolveKeyPath(storageKey));
      return { bytes: stat.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async createUploadTarget(): Promise<UploadTarget | null> {
    return null;
  }

  async createDownloadUrl(): Promise<string | null> {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Supabase Storage driver                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Talks to the Supabase Storage REST API directly with `fetch`.
 *
 * The service-role key is server-only. Object paths are the same random
 * `<key>.bin` strings as the disk driver, so a record is portable between
 * backends. The bucket must exist and stay PRIVATE; the driver never makes an
 * object public - downloads are either proxied by the API or served through a
 * signed URL that expires after `SIGNED_URL_TTL_SECONDS`.
 */
class SupabaseStorage implements StorageAdapter {
  readonly kind = 'supabase' as const;
  readonly supportsDirectUpload = true;

  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
    private readonly bucket: string,
  ) {}

  private url(suffix: string): string {
    return `${this.baseUrl.replace(/\/$/, '')}/storage/v1${suffix}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.serviceKey,
      Authorization: `Bearer ${this.serviceKey}`,
      ...extra,
    };
  }

  private objectPath(storageKey: string): string {
    if (!/^[A-Za-z0-9_-]+\.bin$/.test(storageKey)) {
      throw new Error('Invalid storage key');
    }
    return `${this.bucket}/${storageKey}`;
  }

  async put(storageKey: string, body: Buffer, contentType = 'application/octet-stream'): Promise<number> {
    const response = await fetch(this.url(`/object/${this.objectPath(storageKey)}`), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': contentType, 'x-upsert': 'true' }),
      body,
    });
    if (!response.ok) {
      throw new Error(`Supabase storage upload failed (${response.status})`);
    }
    return body.byteLength;
  }

  async get(storageKey: string): Promise<Buffer> {
    const response = await fetch(this.url(`/object/${this.objectPath(storageKey)}`), {
      headers: this.headers(),
    });
    if (!response.ok) {
      throw new Error(`Supabase storage read failed (${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(storageKey: string): Promise<void> {
    const response = await fetch(this.url(`/object/${this.objectPath(storageKey)}`), {
      method: 'DELETE',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: [storageKey] }),
    });
    // 404 means it is already gone - deletes are idempotent.
    if (!response.ok && response.status !== 404) {
      throw new Error(`Supabase storage delete failed (${response.status})`);
    }
  }

  async head(storageKey: string): Promise<{ bytes: number } | null> {
    const response = await fetch(this.url(`/object/info/${this.objectPath(storageKey)}`), {
      headers: this.headers(),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Supabase storage stat failed (${response.status})`);
    }
    const info = (await response.json()) as { size?: number };
    return typeof info.size === 'number' ? { bytes: info.size } : null;
  }

  async createUploadTarget(storageKey: string): Promise<UploadTarget | null> {
    const response = await fetch(this.url(`/object/upload/sign/${this.objectPath(storageKey)}`), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    if (!response.ok) {
      throw new Error(`Supabase signed upload URL failed (${response.status})`);
    }
    const payload = (await response.json()) as { url?: string };
    if (!payload.url) return null;
    return {
      url: this.url(payload.url),
      headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
    };
  }

  async createDownloadUrl(storageKey: string, expiresIn: number): Promise<string | null> {
    const response = await fetch(this.url(`/object/sign/${this.objectPath(storageKey)}`), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn }),
    });
    if (!response.ok) {
      throw new Error(`Supabase signed download URL failed (${response.status})`);
    }
    const payload = (await response.json()) as { signedURL?: string };
    if (!payload.signedURL) return null;
    return this.url(payload.signedURL);
  }
}

/* -------------------------------------------------------------------------- */
/* Driver selection                                                           */
/* -------------------------------------------------------------------------- */

export function supabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

/** The backend new blobs should be written to. */
export function defaultStorageKind(): StorageDriverKind {
  if (env.storageDriver === 'supabase') return 'supabase';
  if (env.storageDriver === 'local') return 'local';
  return supabaseConfigured() ? 'supabase' : 'local';
}

const adapters: Record<StorageDriverKind, StorageAdapter> = {
  local: new LocalDiskStorage(),
  // Constructed eagerly; the Supabase class only builds URLs from env values,
  // so this stays safe when Supabase is unconfigured (and unreachable).
  supabase: new SupabaseStorage(env.supabaseUrl, env.supabaseServiceRoleKey, env.supabaseStorageBucket),
};

/** Adapter for an explicit driver, used to read blobs written earlier. */
export function storageFor(kind: StorageDriverKind): StorageAdapter {
  return adapters[kind] ?? adapters.local;
}

/** Adapter for this deployment's configured driver. */
export function defaultStorage(): StorageAdapter {
  return storageFor(defaultStorageKind());
}

