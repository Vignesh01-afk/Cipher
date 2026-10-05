import { Loader2 } from 'lucide-react';

export function Spinner({ className = 'h-4 w-4' }: { className?: string }): JSX.Element {
  return <Loader2 className={`animate-spin ${className}`} aria-hidden="true" />;
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-stone-500 dark:text-stone-400">
      <Spinner className="h-5 w-5" />
      <span>{label}</span>
    </div>
  );
}

export function FullPageLoader({ label = 'Preparing your encrypted workspace…' }: { label?: string }): JSX.Element {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-100 aurora-bg dark:bg-[#0A0E23] dark:aurora-bg-dark">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#4A6CF7]/12 text-[#3D55E0] dark:bg-[#4A6CF7]/15 dark:text-[#A3B4FF]">
        <Spinner className="h-6 w-6" />
      </div>
      <p className="text-sm text-stone-500 dark:text-stone-400">{label}</p>
    </div>
  );
}
