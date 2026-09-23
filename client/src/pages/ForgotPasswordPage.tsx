import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { Spinner } from '../components/Spinner';
import { ErrorState } from '../components/States';
import { ApiError, api } from '../lib/api';
import {
  buildResetMaterial,
  decryptBytes,
  importAesKey,
  importPrivateKey,
  recoveryKeyDigest,
  unwrapMasterKeyWithRecoveryKey,
} from '../lib/crypto';

/**
 * Forgot password.
 *
 * CipherNote is zero-knowledge: the server cannot "reset" a password because
 * the password derives the only key that unlocks the vault. Instead, the
 * recovery key shown at registration re-wraps the master key under a NEW
 * password - entirely in this browser:
 *
 *   1. challenge  : the server verifies the recovery-key hash and returns the
 *                   recovery-wrapped master key (+ derivation params)
 *   2. unwrap     : this browser derives the recovery KEK and unwraps the
 *                   master key, then decrypts the wrapped private key
 *   3. re-wrap    : a fresh PBKDF2 salt + the new password produce a new KEK;
 *                   the master key is re-wrapped under it
 *   4. reset      : the server stores the new bcrypt hash + new wraps and
 *                   burns the one-time recovery key
 *
 * The server never sees the recovery key, the old keys, or any derived key.
 */
export function ForgotPasswordPage(): JSX.Element {
  const toast = useToast();

  const [done, setDone] = useState(false);
  const [email, setEmail] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetEmail, setResetEmail] = useState('');

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (newPassword.length < 8) {
      setError('Use at least 8 characters for the new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const keyHash = await recoveryKeyDigest(recoveryKey.trim());

      // 1. Verify the key and fetch the recovery-wrapped key material.
      const challenge = await api.recoveryChallenge({
        email: email.trim(),
        recoveryKey: recoveryKey.trim(),
        recoveryKeyHash: keyHash,
      });

      // 2. Unwrap the master key with the recovery KEK (local only).
      const masterKeyRaw = await unwrapMasterKeyWithRecoveryKey(recoveryKey.trim(), {
        wrappedMasterKeyRecovery: challenge.wrappedMasterKeyRecovery,
        masterKeyRecoveryIv: challenge.masterKeyRecoveryIv,
        recoveryKdfSalt: challenge.recoveryKdfSalt,
        recoveryKdfIterations: challenge.recoveryKdfIterations,
      });

      // 3. Decrypt the private key with the recovered master key.
      const masterKey = await importAesKey(masterKeyRaw, false);
      const privateKeyPkcs8 = await decryptBytes(
        masterKey,
        challenge.wrappedPrivateKey,
        challenge.privateKeyIv,
      );
      await importPrivateKey(privateKeyPkcs8); // sanity: PKCS#8 parses

      // 4. Rebuild the password hierarchy under the new password.
      const material = await buildResetMaterial(newPassword, masterKeyRaw, privateKeyPkcs8);

      // 5. Complete the reset; the server burns the recovery key.
      const result = await api.recoveryReset({
        email: email.trim(),
        recoveryKey: recoveryKey.trim(),
        recoveryKeyHash: keyHash,
        newPassword,
        kdfSalt: material.kdfSalt,
        kdfIterations: material.kdfIterations,
        wrappedMasterKey: material.wrappedMasterKey,
        masterKeyIv: material.masterKeyIv,
      });

      // Deliberately do NOT persist the returned session token: landing on
      // /login and signing in with the new password both confirms it works
      // and keeps the post-reload flow on the expected screens.
      setResetEmail(email.trim());
      setDone(true);
      toast.success('Password reset', 'Sign in with your new password. The recovery key has been retired.');
      // One full-page navigation guarantees a clean state (no half-old keys
      // in memory); the user then signs in explicitly with the new password.
      window.setTimeout(() => {
        window.location.href = '/login';
      }, 2500);
    } catch (resetError) {
      setError(
        resetError instanceof ApiError
          ? resetError.message
          : resetError instanceof Error
            ? resetError.message
            : 'Password reset failed.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 dark:bg-slate-950">
        <div className="w-full max-w-md">
          <div className="card p-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              Password reset
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              The password for <span className="font-medium">{resetEmail}</span> was changed and your keys were
              re-wrapped under the new password. The recovery key has been burned and cannot be used again.
            </p>
            <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">Redirecting to sign in…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12 dark:bg-slate-950">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-600 text-white">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Reset your password
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Your recovery key re-encrypts your vault keys under a new password - inside this browser. The server never
            sees any key.
          </p>
        </div>

        <div className="card p-6">
          {error ? (
            <div className="mb-4">
              <ErrorState title="Could not reset your password" message={error} />
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="label">
                Account email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="input pl-9"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            <div>
              <label htmlFor="recoveryKey" className="label">
                Recovery key
              </label>
              <textarea
                id="recoveryKey"
                required
                rows={2}
                spellCheck={false}
                className="input font-mono text-xs"
                placeholder="RCVR-…"
                value={recoveryKey}
                onChange={(event) => setRecoveryKey(event.target.value)}
                disabled={busy}
              />
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                The <span className="font-mono">RCVR-…</span> key you saved when creating your account (or from Settings
                → Recovery). It is single-use.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="newPassword" className="label">
                  New password
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    className="input pl-9"
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    disabled={busy}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="confirmNewPassword" className="label">
                  Confirm new password
                </label>
                <input
                  id="confirmNewPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="input"
                  placeholder="Repeat new password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
              <p className="flex items-start gap-2 text-xs leading-5 text-amber-900 dark:text-amber-100/90">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Without your recovery key the password cannot be reset - this is a property of end-to-end encryption.
                Resetting retires the recovery key: generate a new one from Settings after signing in.
              </p>
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={busy || !email || !recoveryKey || newPassword.length < 8 || newPassword !== confirmPassword}
            >
              {busy ? <Spinner /> : <KeyRound className="h-4 w-4" />}
              {busy ? 'Re-wrapping your keys locally…' : 'Reset password with recovery key'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
            Remembered it?{' '}
            <Link to="/login" className="link">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
