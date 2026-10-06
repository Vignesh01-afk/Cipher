import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api, getAuthToken, setAuthToken, setRememberPreference } from '../lib/api';
import {
  buildRecoverySetup,
  createUserKeyMaterial,
  deriveKekAndAuthKey,
  fromBase64,
  generateRecoveryKey,
  isWebCryptoAvailable,
  toBase64,
  unlockUserKeyMaterial,
  wipe,
  type CryptoSession,
  type UserKeyMaterial,
} from '../lib/crypto';
import type { AuthResponse, KeyMaterial } from '../lib/types';

/**
 * `loading`   - restoring a stored session on first paint
 * `anonymous` - no session at all
 * `locked`    - a session exists but the note keys are not in memory yet
 *               (happens after a page reload: re-entering the password
 *               re-derives the key-encryption-key locally)
 * `unlocked`  - session plus in-memory crypto keys, ready to decrypt notes
 */
export type AuthStatus = 'loading' | 'anonymous' | 'locked' | 'unlocked';

export interface RegisterInput {
  email: string;
  displayName: string;
  password: string;
}

export interface GoogleRegisterInput {
  signupToken: string;
  email: string;
  displayName: string;
  password: string;
}

interface AuthContextValue {
  status: AuthStatus;
  user: KeyMaterial | null;
  keys: CryptoSession | null;
  isWebCryptoSupported: boolean;
  register: (input: RegisterInput) => Promise<string | null>;
  /**
   * Completes sign-up for a Google-verified identity: creates the key
   * hierarchy under the chosen vault password and registers the account with
   * the Google ID already linked. Returns the one-time recovery key (or null).
   */
  registerWithGoogle: (input: GoogleRegisterInput) => Promise<string | null>;
  /** `remember` mirrors the sign-in checkbox: keep the session across restarts. */
  login: (email: string, password: string, options?: { remember?: boolean }) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  logout: () => Promise<void>;
  /** Generates a recovery key, wraps the master key under it and stores it. */
  setupRecoveryKey: () => Promise<string>;
  /**
   * Adopts a session created without a local password (Google sign-in):
   * stores the token + user and puts the app in the `locked` state so the
   * vault password is requested to derive keys locally.
   */
  adoptSession: (result: { token: string; user: KeyMaterial }) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function materialOf(user: KeyMaterial): UserKeyMaterial {
  return {
    publicKey: user.publicKey,
    wrappedPrivateKey: user.wrappedPrivateKey,
    privateKeyIv: user.privateKeyIv,
    kdfSalt: user.kdfSalt,
    kdfIterations: user.kdfIterations,
    wrappedMasterKey: user.wrappedMasterKey,
    masterKeyIv: user.masterKeyIv,
  };
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<KeyMaterial | null>(null);
  const [keys, setKeys] = useState<CryptoSession | null>(null);
  const isWebCryptoSupported = useRef(isWebCryptoAvailable()).current;

  // Restore an existing session token on first load. Note keys are NOT
  // restored: the password is required to unwrap them again, so the app starts
  // in the `locked` state.
  useEffect(() => {
    let cancelled = false;

    async function restore(): Promise<void> {
      if (!getAuthToken()) {
        if (!cancelled) setStatus('anonymous');
        return;
      }

      try {
        const result = await api.me();
        if (cancelled) return;
        setUser(result.user);
        setStatus('locked');
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.isAuthError) {
          setAuthToken(null);
          setUser(null);
          setStatus('anonymous');
          return;
        }
        // Network hiccup: keep the token and let the user retry from the UI.
        setStatus('anonymous');
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearSession = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    setKeys(null);
    setStatus('anonymous');
  }, []);

  /**
   * Shared tail of both registration paths: adopts the fresh session, flips
   * to `unlocked`, then wraps the master key under a one-time recovery key.
   * Returns the recovery key to show exactly once, or null when its setup
   * failed (a key can be generated later from Settings).
   */
  const adoptNewAccount = useCallback(
    async (result: { token: string; user: KeyMaterial }, session: CryptoSession): Promise<string | null> => {
      setAuthToken(result.token);
      setUser(result.user);
      setKeys(session);
      setStatus('unlocked');

      // Recovery setup uses the in-hand `session` (NOT React state, which
      // would still be stale within this closure).
      try {
        const recoveryKey = generateRecoveryKey();
        const setup = await buildRecoverySetup(recoveryKey, session.masterKey);
        await api.setupRecovery(setup);
        return recoveryKey;
      } catch {
        return null;
      }
    },
    [],
  );

  /**
   * Registers the account and immediately wraps the fresh master key under a
   * one-time recovery key - using the in-hand session, so no state race.
   */
  const register = useCallback(
    async ({ email, displayName, password }: RegisterInput): Promise<string | null> => {
      if (!isWebCryptoSupported) {
        throw new Error('This browser cannot provide Web Crypto, so CipherNote cannot encrypt notes here.');
      }

      // Everything below happens locally: the key hierarchy is generated on
      // this device before any network call is made.
      const { material, session, masterKeyRaw, authKey } = await createUserKeyMaterial(password);

      try {
        // masterKeyRaw enables the server-side escrow wrap used by the
        // email-OTP password reset. Sent once over TLS; the server stores
        // only its own encrypted wrap of it. `authKey` replaces the password:
        // the server bcrypt-hashes it, so it can never recompute the KEK.
        const result = await api.register({
          email,
          displayName,
          authKey,
          ...material,
          masterKeyRaw: toBase64(masterKeyRaw),
        });
        wipe(masterKeyRaw);
        return await adoptNewAccount(result, session);
      } catch (error) {
        // Do not leave a half-authenticated state behind.
        setAuthToken(null);
        setKeys(null);
        throw error;
      }
    },
    [isWebCryptoSupported, adoptNewAccount],
  );

  /**
   * Google sign-up path: identical key generation to `register`, but the
   * email comes from the server-verified signup token and the Google ID is
   * linked server-side in the same call.
   */
  const registerWithGoogle = useCallback(
    async ({ signupToken, displayName, password }: GoogleRegisterInput): Promise<string | null> => {
      if (!isWebCryptoSupported) {
        throw new Error('This browser cannot provide Web Crypto, so CipherNote cannot encrypt notes here.');
      }

      const { material, session, masterKeyRaw, authKey } = await createUserKeyMaterial(password);

      try {
        const result = await api.googleRegister({
          signupToken,
          displayName,
          authKey,
          ...material,
          masterKeyRaw: toBase64(masterKeyRaw),
        });
        wipe(masterKeyRaw);
        return await adoptNewAccount(result, session);
      } catch (error) {
        setAuthToken(null);
        setKeys(null);
        throw error;
      }
    },
    [isWebCryptoSupported, adoptNewAccount],
  );

  /** Google sign-in path: session adopted, vault stays locked until unlock(). */
  const adoptSession = useCallback((result: { token: string; user: KeyMaterial }) => {
    setAuthToken(result.token);
    setUser(result.user);
    setKeys(null);
    setStatus('locked');
  }, []);

  const login = useCallback(
    async (email: string, password: string, options: { remember?: boolean } = {}) => {
      if (!isWebCryptoSupported) {
        throw new Error('This browser cannot provide Web Crypto, so CipherNote cannot decrypt notes here.');
      }

      // Step 1: public KDF parameters. v2 accounts derive an authKey from
      // them and never send the password; v1 (legacy) accounts fall back to
      // the password once and are migrated below.
      try {
        const prelogin = await api.prelogin(email);

        let result: AuthResponse;
        let session: CryptoSession;

        if (prelogin.authVersion >= 2) {
          // Split derivation: KEK stays here, only the second half is sent.
          const { kek, authKey } = await deriveKekAndAuthKey(
            password,
            fromBase64(prelogin.kdfSalt),
            prelogin.kdfIterations,
          );
          result = await api.login(email, { authKey });
          session = await unlockUserKeyMaterial(password, materialOf(result.user), kek);
        } else {
          result = await api.login(email, { password });
          // The server said the password is correct; derive the KEK locally to
          // unwrap the master key and private key.
          session = await unlockUserKeyMaterial(password, materialOf(result.user));

          // v1 -> v2 migration, best-effort: with the password still in hand,
          // send the authKey so the server stops receiving passwords. A failure
          // here is retried on the next login and does not break this session.
          try {
            const { authKey } = await deriveKekAndAuthKey(
              password,
              fromBase64(result.user.kdfSalt),
              result.user.kdfIterations,
            );
            await api.upgradeAuth(authKey);
          } catch {
            /* keep the session; the upgrade is retried next login */
          }
        }

        // Only persist the token once the local unlock has succeeded, so a
        // failed unlock can never leave a half-authenticated session behind.
        setAuthToken(result.token, { remember: options.remember ?? true });
        setRememberPreference(options.remember ?? true);

        setUser(result.user);
        setKeys(session);
        setStatus('unlocked');
      } catch (error) {
        // Never keep a token (stale or fresh) when login or unlock fails.
        setAuthToken(null);
        throw error;
      }
    },
    [isWebCryptoSupported],
  );

  const unlock = useCallback(
    async (password: string) => {
      if (!user) {
        throw new Error('There is no session to unlock. Please sign in again.');
      }
      const session = await unlockUserKeyMaterial(password, materialOf(user));
      setKeys(session);
      setStatus('unlocked');
    },
    [user],
  );

  /** Drops the in-memory keys but keeps the session token. */
  const lock = useCallback(() => {
    setKeys(null);
    setStatus((current) => (current === 'anonymous' ? current : 'locked'));
  }, []);

  /**
   * Generates a fresh recovery key in this browser, re-wraps the current
   * master key under it and stores the wrap server-side. The key is returned
   * exactly once - the server only holds a hash, so it cannot be re-shown.
   */
  const setupRecoveryKey = useCallback(async (): Promise<string> => {
    if (!keys || !user) {
      throw new Error('Unlock your vault before generating a recovery key.');
    }
    const recoveryKey = generateRecoveryKey();
    const setup = await buildRecoverySetup(recoveryKey, keys.masterKey);
    await api.setupRecovery(setup);
    return recoveryKey;
  }, [keys, user]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Even if the audit call fails, the local session must be torn down.
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      keys,
      isWebCryptoSupported,
      register,
      registerWithGoogle,
      login,
      unlock,
      lock,
      logout,
      setupRecoveryKey,
      adoptSession,
    }),
    [
      status,
      user,
      keys,
      isWebCryptoSupported,
      register,
      registerWithGoogle,
      login,
      unlock,
      lock,
      logout,
      setupRecoveryKey,
      adoptSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
}

/** Convenience hook for components that only render once keys are available. */
export function useCryptoSession(): CryptoSession {
  const { keys } = useAuth();
  if (!keys) {
    throw new Error('Crypto keys are not unlocked in this session');
  }
  return keys;
}
