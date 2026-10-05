import type { ReactNode } from 'react';
import { AlertOctagon, RefreshCw, AlertTriangle, Info } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  icon?: LucideIcon;
  children?: ReactNode;
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, icon: Icon = AlertOctagon, children }: ErrorStateProps): JSX.Element {
  return (
    <div className="card-interactive flex flex-col items-start gap-3 rounded-2xl border border-rose-200/80 bg-rose-50/40 p-4 dark:border-rose-500/20 dark:bg-rose-500/5">
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 shrink-0 text-rose-500" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-rose-800 dark:text-rose-200">{title}</h3>
          <p className="mt-0.5 text-sm leading-6 text-rose-700/90 dark:text-rose-200/80">{message}</p>
          {children}
          {onRetry ? (
            <button type="button" className="btn btn-secondary mt-3" onClick={onRetry}>
              <RefreshCw className="h-3.5 w-3.5" />
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface InfoStateProps {
  title?: string;
  message: string;
  icon?: LucideIcon;
  children?: ReactNode;
}

export function InfoState({ title = 'Heads up', message, icon: Icon = Info, children }: InfoStateProps): JSX.Element {
  return (
    <div className="card-interactive flex flex-col items-start gap-3 rounded-2xl border border-cyan-200/80 bg-cyan-50/40 p-4 dark:border-cyan-500/20 dark:bg-cyan-500/5">
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 shrink-0 text-cyan-500" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-cyan-800 dark:text-cyan-200">{title}</h3>
          <p className="mt-0.5 text-sm leading-6 text-cyan-700/90 dark:text-cyan-200/80">{message}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
