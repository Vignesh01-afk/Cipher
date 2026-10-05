/**
 * Unique public chat handle, e.g. CN-7F4K29. Random, rotatable, and purely an
 * addressing identifier: it never derives, wraps or unlocks any key.
 *
 * Shared because both the classic register route and the Google sign-up route
 * must allocate one when creating a user.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../db';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1 - unambiguous when read aloud

export async function generateCipherId(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = randomBytes(6);
    let id = 'CN-';
    for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
    if (!(await prisma.user.findUnique({ where: { cipherId: id } }))) return id;
  }
  throw new Error('Could not generate a unique cipherId');
}
