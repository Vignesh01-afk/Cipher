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

/**
 * Short-lived single-purpose token that authorises exactly one OTP-verified
 * password reset. Separate secret + `purpose` claim so a session JWT can
 * never stand in for it and vice versa.
 */
export interface PasswordResetTokenPayload {
  sub: string;
  purpose: 'password-reset';
  iat?: number;
  exp?: number;
}

const RESET_TOKEN_TTL_SECONDS = 10 * 60;

export function signPasswordResetToken(userId: string): string {
  return jwt.sign(
    { purpose: 'password-reset' },
    process.env.JWT_SECRET ?? env.jwtSecret,
    {
      subject: userId,
      expiresIn: RESET_TOKEN_TTL_SECONDS,
      algorithm: 'HS256',
      audience: 'ciphernote:password-reset',
    },
  );
}

export function verifyPasswordResetToken(token: string): PasswordResetTokenPayload {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET ?? env.jwtSecret, {
      algorithms: ['HS256'],
      audience: 'ciphernote:password-reset',
    });
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      typeof (decoded as { sub?: unknown }).sub === 'string' &&
      (decoded as { purpose?: unknown }).purpose === 'password-reset'
    ) {
      return decoded as unknown as PasswordResetTokenPayload;
    }
    throw new Error('Unexpected token payload');
  } catch {
    throw ApiError.badRequest('Your reset session expired. Start again with a fresh code.', 'RESET_TOKEN_INVALID');
  }
}

/**
 * Short-lived single-purpose token that carries a Google-verified identity to
 * the sign-up completion step. Google has already verified the email; the
 * client still has to generate the key material locally (vault password +
 * keys), so the account is only created after that. A separate audience keeps
 * this token from being replayed against any other endpoint.
 */
export interface GoogleSignupTokenPayload {
  /** Google subject. */
  sub: string;
  purpose: 'google-signup';
  email: string;
  displayName: string;
  iat?: number;
  exp?: number;
}

const SIGNUP_TOKEN_TTL_SECONDS = 15 * 60;

export function signGoogleSignupToken(claims: { sub: string; email: string; displayName: string }): string {
  return jwt.sign(
    { purpose: 'google-signup', email: claims.email, displayName: claims.displayName },
    env.jwtSecret,
    {
      subject: claims.sub,
      expiresIn: SIGNUP_TOKEN_TTL_SECONDS,
      algorithm: 'HS256',
      audience: 'ciphernote:google-signup',
    },
  );
}

export function verifyGoogleSignupToken(token: string): GoogleSignupTokenPayload {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, {
      algorithms: ['HS256'],
      audience: 'ciphernote:google-signup',
    });
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      typeof (decoded as { sub?: unknown }).sub === 'string' &&
      (decoded as { purpose?: unknown }).purpose === 'google-signup' &&
      typeof (decoded as { email?: unknown }).email === 'string' &&
      typeof (decoded as { displayName?: unknown }).displayName === 'string'
    ) {
      return decoded as unknown as GoogleSignupTokenPayload;
    }
    throw new Error('Unexpected token payload');
  } catch {
    throw ApiError.badRequest('Your Google sign-up session expired. Start again from the sign-up page.',
      'GOOGLE_SIGNUP_TOKEN_INVALID');
  }
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
