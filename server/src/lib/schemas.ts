import { z } from 'zod';
import { env } from '../env';

/** Canonical form of an email address used for every lookup and storage path. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

// --- Reusable primitives ---------------------------------------------------

const ivSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be base64 encoded');

const keyBlobSchema = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be base64 encoded');

const ciphertextSchema = z
  .string()
  .min(1)
  .max(2_000_000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Must be base64 encoded');

/** Note identifier as produced by Prisma's cuid(). */
export const idParamSchema = z.string().min(1).max(64);

// --- Authentication --------------------------------------------------------

export const registerSchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
  displayName: z.string().trim().min(1, 'Enter a display name').max(80),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
  publicKey: keyBlobSchema,
  wrappedPrivateKey: keyBlobSchema,
  privateKeyIv: ivSchema,
  kdfSalt: keyBlobSchema,
  kdfIterations: z
    .number()
    .int()
    .min(env.minKdfIterations)
    .max(env.maxKdfIterations),
  wrappedMasterKey: keyBlobSchema,
  masterKeyIv: ivSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
  password: z.string().min(1, 'Enter your password').max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;

// --- Notes -----------------------------------------------------------------

export const createNoteSchema = z.object({
  ciphertext: ciphertextSchema,
  iv: ivSchema,
  encryptionVersion: z.number().int().min(1).max(100).default(1),
  algorithm: z.string().max(64).default('AES-GCM-256'),
  payloadBytes: z.number().int().min(0).max(10_000_000).default(0),
  wrappedNoteKey: keyBlobSchema,
  noteKeyIv: ivSchema,
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z
  .object({
    ciphertext: ciphertextSchema.optional(),
    iv: ivSchema.optional(),
    encryptionVersion: z.number().int().min(1).max(100).optional(),
    payloadBytes: z.number().int().min(0).max(10_000_000).optional(),
    wrappedNoteKey: keyBlobSchema.optional(),
    noteKeyIv: ivSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update',
  });

export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

// --- Sharing ---------------------------------------------------------------

export const createShareSchema = z.object({
  userId: z.string().min(1).max(64),
  wrappedKey: keyBlobSchema,
});

export type CreateShareInput = z.infer<typeof createShareSchema>;

export const lookupQuerySchema = z.object({
  email: z.string().email('Enter a valid email address').max(254),
});
