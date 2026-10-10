import { type ReactNode } from 'react';

interface SkeletonProps {
  className?: string;
  children?: ReactNode;
}

export function Skeleton({ className = '', children }: SkeletonProps): React.ReactElement {
  return (
    <div className={`skeleton ${className}`}>
      {children ?? null}
    </div>
  );
}

export function SkeletonText({ lines = 3, className = '', children }: { lines?: number; className?: string; children?: ReactNode }): React.ReactElement {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className="h-3 w-full" />
      ))}
      {children}
    </div>
  );
}

export function SkeletonBlock({ label = 'Loading…' }: { label?: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500 dark:text-slate-400">
      <div className="h-5 w-5  rounded-md border-2 border-brand/30 border-t-brand" />
      <span>{label}</span>
    </div>
  );
}
