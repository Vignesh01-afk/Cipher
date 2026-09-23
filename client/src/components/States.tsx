import { AlertOctagon, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-700">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      <p className="mt-1 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  children?: ReactNode;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  children,
}: ErrorStateProps): JSX.Element {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-5 dark:border-rose-500/30 dark:bg-rose-500/5">
      <div className="flex items-start gap-3">
        <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-rose-800 dark:text-rose-300">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-rose-700/90 dark:text-rose-200/80">{message}</p>
          {children}
          {onRetry ? (
            <button type="button" onClick={onRetry} className="btn btn-secondary btn-sm mt-3">
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
