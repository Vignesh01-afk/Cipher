import jwt from 'jsonwebtoken';
import { env } from '../env';
import { ApiError } from './http';

/**
 * Wraps jsonwebtoken's sign/verify so that the rest of the codebase never has
 * to deal with `unknown` payloads or library-specific error types.
 */
export interface SessionTokenPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

export function signSessionToken(user: { id: string; email: string }): string {
  // `expiresIn` is typed as a template-literal duration, so the plain string
  // from the environment is narrowed here rather than at every call site.
  const options: jwt.SignOptions = {
    subject: user.id,
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  };

  return jwt.sign({ email: user.email }, env.jwtSecret, options);
}

export function verifySessionToken(token: string): SessionTokenPayload {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || !decoded.sub || typeof decoded.sub !== 'string') {
      throw new Error('Token payload is missing a subject');
    }
    return {
      sub: decoded.sub,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      iat: decoded.iat,
      exp: decoded.exp,
    };
  } catch {
    throw ApiError.unauthorized('Your session is invalid or has expired', 'INVALID_SESSION');
  }
}
