import { CircleNotch } from '@phosphor-icons/react';

export function Spinner({ className = 'h-4 w-4' }: { className?: string }): React.ReactElement {
  return <CircleNotch className={` ${className}`} aria-hidden="true" />;
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-stone-500 dark:text-stone-400">
      <Spinner className="h-5 w-5" />
      <span>{label}</span>
    </div>
  );
}

export function FullPageLoader({ label = 'Preparing your encrypted workspace…' }: { label?: string }): React.ReactElement {
  return (              <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-100 bg-surface dark:bg-surface">
      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-accent/10 text-accent dark:bg-accent/15">
        <Spinner className="h-6 w-6" />
      </div>
      <p className="text-sm text-stone-500 dark:text-stone-400">{label}</p>
    </div>
  );
}
