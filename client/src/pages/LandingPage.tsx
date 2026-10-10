import { Link } from 'react-router-dom';
import { ArrowRight, Lock, ShieldCheck, Users, CaretDown } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';

export function LandingPage(): React.ReactElement {
  const { status } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="card-glass border-b border-white/10 px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-3 group">
            <span className="flex h-10 w-10 items-center justify-center rounded-md     text-white ">
              <Lock className="h-5 w-5" />
            </span>
            <span className="text-xl font-bold tracking-tight text-stone-900 dark:text-white">
              <span className="brand-wordmark-cipher">Cipher</span>
              <span className="brand-wordmark-note">Note</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {status === 'unlocked' ? (
              <Link to="/dashboard" className="btn btn-secondary btn-sm">
                Go to app <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <Link to="/login" className="btn btn-primary btn-sm">
                Sign in <CaretDown className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 flex justify-center">
            <span className="flex h-18 w-18 items-center justify-center rounded-md     text-white ">
              <Lock className="h-9 w-9" />
            </span>
          </div>

          <h1 className="text-4xl font-extrabold tracking-tight text-stone-900 dark:text-white sm:text-5xl lg:text-6xl">
            <span className="brand-gradient-text">CipherNote</span>
          </h1>

          <p className="mt-5 max-w-lg text-lg leading-8 text-stone-500 dark:text-stone-400">
            Your notes, your privacy. Encrypted end-to-end in your browser before anything is stored on the server.
            Share, revoke and manage access with a premium security workflow.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/login" className="btn btn-primary">
              Start for free <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/login" className="btn btn-secondary">
              <Lock className="h-4 w-4" />
              See how it works
            </Link>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            <div className="card p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <h3 className="mt-3 text-sm font-bold text-stone-900 dark:text-white">End-to-end encrypted</h3>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                Every note is sealed with AES-GCM before it leaves this browser.
              </p>
            </div>
            <div className="card p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-brand/10 text-brand-600 dark:text-brand-300">
                <Users className="h-5 w-5" />
              </span>
              <h3 className="mt-3 text-sm font-bold text-stone-900 dark:text-white">Share & revoke</h3>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                Share with anyone. Revoke access instantly, from anywhere.
              </p>
            </div>
            <div className="card p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
                <Lock className="h-5 w-5" />
              </span>
              <h3 className="mt-3 text-sm font-bold text-stone-900 dark:text-white">Zero-knowledge core</h3>
              <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                The server stores ciphertext and wrapped keys it cannot decrypt. An optional escrow copy makes
                email-code recovery possible; the threat model spells out the trade-off.
              </p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-white/10 px-4 py-6 text-center text-xs text-stone-500 dark:border-white/[0.08] dark:text-stone-400">
        <div className="flex items-center justify-center gap-2">
          <Lock className="h-3.5 w-3.5" />
          <span>CipherNote · Encrypt. Share. Revoke.</span>
        </div>
        <p className="mt-2">Your privacy is your power.</p>
      </footer>
    </div>
  );
}
