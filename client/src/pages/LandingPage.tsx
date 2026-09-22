import { Link } from 'react-router-dom';
import {
  ArrowRight,
  EyeOff,
  FileText,
  Fingerprint,
  FolderLock,
  KeyRound,
  Lock,
  Moon,
  Search,
  ServerOff,
  ShieldCheck,
  UserX,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const FEATURES = [
  {
    icon: FileText,
    title: 'Encrypted before it leaves the tab',
    body: 'Titles, bodies, tags and file attachments are sealed with AES-GCM-256 in your browser. The API receives opaque blobs.',
  },
  {
    icon: ServerOff,
    title: 'Zero-knowledge backend',
    body: 'The database stores ciphertext and wrapped keys. A full dump of the PostgreSQL database reveals no note or file content.',
  },
  {
    icon: FolderLock,
    title: 'End-to-end encrypted files',
    body: 'Every attachment gets its own key, wrapped like note keys. Files live in private server storage with no public URLs.',
  },
  {
    icon: KeyRound,
    title: 'Keys wrapped per recipient',
    body: 'Sharing wraps the note key with the recipient\u2019s RSA-OAEP public key, so only their private key can open it.',
  },
  {
    icon: UserX,
    title: 'Revocable access',
    body: 'Owners can withdraw a share at any time. The API rejects revoked callers and writes the decision to the audit log.',
  },
  {
    icon: Search,
    title: 'Private local search',
    body: 'Search runs on notes you have already decrypted in memory. There is no server-side search over note content.',
  },
  {
    icon: Fingerprint,
    title: 'Honest about the edges',
    body: 'Revocation cannot un-download plaintext. Login events, key derivation and threat boundaries are documented in the README.',
  },
];

const FLOW = [
  { step: '01', label: 'Alice writes a note', detail: 'PBKDF2 unlocks her master key; a fresh AES-GCM note key seals the payload.' },
  { step: '02', label: 'Database stores ciphertext', detail: 'Only the blob, a nonce and a wrapped key reach the server.' },
  { step: '03', label: 'Alice shares with Bob', detail: 'The note key is wrapped with Bob\u2019s public key and stored per recipient.' },
  { step: '04', label: 'Bob decrypts locally', detail: 'His private key unwraps the note key; plaintext never leaves his device.' },
  { step: '05', label: 'Alice revokes Bob', detail: 'The share is marked revoked and every later request is refused.' },
  { step: '06', label: 'Audit log captures it', detail: 'Share and revocation events are recorded with actor, note and timestamp.' },
];

export function LandingPage(): JSX.Element {
  const { status } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const primaryHref = status === 'unlocked' ? '/dashboard' : status === 'locked' ? '/unlock' : '/register';

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <span className="brand-tile" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="10.5" width="16" height="9.5" rx="2" />
              <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
              <path d="M12 14v3" strokeLinecap="round" />
            </svg>
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold tracking-tight text-slate-900 dark:text-slate-50">
              CipherNote
            </span>
            <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Private by design.
            </span>
          </span>
        </div>

        <nav className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="btn btn-ghost p-2"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <Moon className="h-4 w-4" />
          </button>
          <Link to="/login" className="btn btn-secondary btn-sm">
            Sign in
          </Link>
          <Link to={primaryHref} className="btn btn-primary btn-sm">
            {status === 'unlocked' ? 'Open vault' : 'Create account'}
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 pb-16">
        {/* Hero */}
        <section className="pt-10 text-center sm:pt-16">
          <span className="badge badge-cyan mx-auto">
            <Lock className="h-3 w-3" />
            End-to-end encrypted · notes & files · zero-knowledge server
          </span>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-50 sm:text-5xl">
            Notes that are encrypted{' '}
            <span className="bg-gradient-to-r from-cyan-500 to-emerald-400 bg-clip-text text-transparent">
              before they reach the server
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-400">
            CipherNote is a working, full-stack secure notes app. Your browser derives the keys, seals every note with
            AES-GCM, and wraps the note key for each recipient with RSA-OAEP. The API stores ciphertext it cannot
            read - and can prove it.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to={primaryHref} className="btn btn-primary px-5 py-2.5">
              {status === 'unlocked' ? 'Open your vault' : 'Create your encrypted vault'}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/login" className="btn btn-secondary px-5 py-2.5">
              I already have an account
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" /> AES-GCM-256 note payloads
            </span>
            <span className="inline-flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" /> RSA-OAEP-2048 key wrapping
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Fingerprint className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" /> PBKDF2-SHA256 key derivation
            </span>
            <span className="inline-flex items-center gap-1.5">
              <EyeOff className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" /> No plaintext search on the server
            </span>
          </div>
        </section>

        {/* Features */}
        <section className="mt-20">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            What actually makes it secure
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title} className="card p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-600/10 text-cyan-600 dark:text-cyan-400">
                  <feature.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-slate-900 dark:text-slate-50">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Demo flow */}
        <section className="mt-20">
          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <h2 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                The demonstration flow: Alice, Bob and a revoked share
              </h2>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
                Register two accounts (for example in a normal and a private window) and walk the whole lifecycle.
              </p>
            </div>
            <ol className="grid gap-px bg-slate-200 dark:bg-slate-800 sm:grid-cols-2 lg:grid-cols-3">
              {FLOW.map((item) => (
                <li key={item.step} className="bg-white p-5 dark:bg-slate-900">
                  <span className="font-mono text-xs font-semibold text-cyan-600 dark:text-cyan-400">
                    {item.step}
                  </span>
                  <h3 className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-50">{item.label}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-400">{item.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Honest limitations */}
        <section className="mt-12 rounded-xl border border-amber-300 bg-amber-50/70 p-6 dark:border-amber-500/30 dark:bg-amber-500/5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            What CipherNote does not claim
          </h2>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-900/90 dark:text-amber-100/80">
            <li>
              Revoking access is an access-control change. It cannot erase plaintext a recipient already decrypted,
              copied or exported, and the note key they hold would still open the note until the owner rotates it.
            </li>
            <li>
              The server sees metadata: user ids, note ids, timestamps, share relationships and the size of each
              ciphertext.
            </li>
            <li>
              A compromised browser, a malicious extension or a keylogger defeats end-to-end encryption in any web
              application, this one included.
            </li>
          </ul>
        </section>
      </main>

      <footer className="border-t border-slate-200 py-8 dark:border-slate-800">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2 px-5 text-center text-xs text-slate-500 dark:text-slate-400">
          <p>CipherNote · SYNCSQUAD · Srikanth G · Vignesh S · Moushika G · Navasakthi A</p>
          <p>React + Vite + TypeScript · Express + TypeScript · Prisma + PostgreSQL · Web Crypto API</p>
        </div>
      </footer>
    </div>
  );
}
