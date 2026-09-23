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
import { ApiError, api, getAuthToken, setAuthToken } from '../lib/api';
import {
  buildRecoverySetup,
  createUserKeyMaterial,
  generateRecoveryKey,
  isWebCryptoAvailable,
  unlockUserKeyMaterial,
  type CryptoSession,
  type UserKeyMaterial,
} from '../lib/crypto';
import type { KeyMaterial } from '../lib/types';

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

interface AuthContextValue {
  status: AuthStatus;
  user: KeyMaterial | null;
  keys: CryptoSession | null;
  isWebCryptoSupported: boolean;
  register: (input: RegisterInput) => Promise<string | null>;
  login: (email: string, password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  lock: () => void;
  logout: () => Promise<void>;
  /** Generates a recovery key, wraps the master key under it and stores it. */
  setupRecoveryKey: () => Promise<string>;
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
   * Registers the account and immediately wraps the fresh master key under a
   * one-time recovery key - using the in-hand session, so no state race.
   * Returns the recovery key to show to the user exactly once, or null when
   * the setup call failed (the account still works; a key can be generated
   * later from Settings).
   */
  const register = useCallback(
    async ({ email, displayName, password }: RegisterInput): Promise<string | null> => {
      if (!isWebCryptoSupported) {
        throw new Error('This browser cannot provide Web Crypto, so CipherNote cannot encrypt notes here.');
      }

      // Everything below happens locally: the key hierarchy is generated on
      // this device before any network call is made.
      const { material, session } = await createUserKeyMaterial(password);

      try {
        const result = await api.register({ email, displayName, password, ...material });
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
      } catch (error) {
        // Do not leave a half-authenticated state behind.
        setAuthToken(null);
        setKeys(null);
        throw error;
      }
    },
    [isWebCryptoSupported],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      if (!isWebCryptoSupported) {
        throw new Error('This browser cannot provide Web Crypto, so CipherNote cannot decrypt notes here.');
      }

      const result = await api.login(email, password);
      setAuthToken(result.token);

      // The server said the password is correct; derive the KEK locally to
      // unwrap the master key and private key.
      const session = await unlockUserKeyMaterial(password, materialOf(result.user));

      setUser(result.user);
      setKeys(session);
      setStatus('unlocked');
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
      login,
      unlock,
      lock,
      logout,
      setupRecoveryKey,
    }),
    [
      status,
      user,
      keys,
      isWebCryptoSupported,
      register,
      login,
      unlock,
      lock,
      logout,
      setupRecoveryKey,
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
