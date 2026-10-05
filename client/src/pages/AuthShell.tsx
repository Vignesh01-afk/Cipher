import type { ReactNode } from 'react';
import BrandMark from '../components/BrandMark';
import { ShieldCheck, KeyRound, Wallet } from 'lucide-react';

interface AuthShellProps {
  children: ReactNode;
  width?: 'md' | 'lg';
}

const TRUST_CHIPS = [
  { icon: KeyRound, label: 'End-to-End', sub: 'Encryption' },
  { icon: ShieldCheck, label: 'Secure', sub: 'Sharing' },
  { icon: Wallet, label: 'Full', sub: 'Control' },
];

export function AuthShell({ children, width = 'md' }: AuthShellProps): JSX.Element {
  return (
    <div className="relative flex min-h-screen overflow-hidden bg-stone-50 dark:bg-[#0B0F19]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-brand/15 blur-3xl dark:bg-brand/20" />
        <div className="absolute -right-32 top-10 h-[26rem] w-[26rem] rounded-full bg-violet-400/15 blur-3xl dark:bg-violet-400/15" />
        <div className="absolute -bottom-32 left-1/3 h-[32rem] w-[32rem] rounded-full bg-pink-400/10 blur-3xl dark:bg-pink-400/10" />

        <svg className="absolute bottom-0 left-0 h-64 w-full opacity-50 dark:opacity-40" viewBox="0 0 1440 320" preserveAspectRatio="none">
          <defs>
            <linearGradient id="auth-wave-1" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#4A6CF7" stopOpacity="0.35" />
              <stop offset="50%" stopColor="#7C5CF6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#D946EF" stopOpacity="0.35" />
            </linearGradient>
            <linearGradient id="auth-wave-2" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#7C5CF6" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#4A6CF7" stopOpacity="0.25" />
            </linearGradient>
          </defs>
          <path fill="url(#auth-wave-1)" d="M0,224L60,213.3C120,203,240,181,360,181.3C480,181,600,203,720,213.3C840,224,960,224,1080,208C1200,192,1320,160,1380,144L1440,128L1440,320L0,320Z" />
          <path fill="url(#auth-wave-2)" d="M0,256L80,250.7C160,245,320,235,480,240C640,245,800,267,960,272C1120,277,1280,267,1360,261.3L1440,256L1440,320L0,320Z" />
        </svg>
      </div>

      <div className="relative z-10 grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-5 py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-8">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <div className="flex items-center gap-3 lg:gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 via-violet-500 to-pink-500 text-white shadow-[0_12px_30px_-10px_rgba(122,88,247,0.9)]">
              <BrandMark size="lg" aria-hidden="true" />
            </div>
            <span className="text-2xl font-bold tracking-tight text-stone-900 dark:text-white sm:text-3xl">
              <span className="brand-wordmark-cipher">Cipher</span>
              <span className="brand-wordmark-note">Note</span>
            </span>
          </div>

          <p className="mt-5 text-base font-semibold text-stone-700 dark:text-stone-200">
            Your notes. Your privacy. Always.
          </p>

          <div className="mt-8 hidden gap-6 lg:flex">
            {TRUST_CHIPS.map((chip) => (
              <div key={chip.label} className="flex flex-col items-center gap-2 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/60 bg-white/70 text-brand-600 backdrop-blur dark:border-white/10 dark:bg-white/[0.06] dark:text-brand-300">
                  <chip.icon className="h-5 w-5" />
                </div>
                <span className="text-[11px] font-semibold leading-tight text-stone-600 dark:text-stone-300">
                  {chip.label}
                  <br />
                  {chip.sub}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-10 hidden items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-stone-400 dark:text-stone-500 lg:flex">
            <span>Secure</span>
            <span className="h-1 w-1 rounded-full bg-current opacity-60" />
            <span>Encrypted</span>
            <span className="h-1 w-1 rounded-full bg-current opacity-60" />
            <span>Yours</span>
          </p>
        </div>

        <div className={`w-full ${width === 'lg' ? 'max-w-lg' : 'max-w-md'} mx-auto`}>
          <div className="card-glass p-6 sm:p-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
