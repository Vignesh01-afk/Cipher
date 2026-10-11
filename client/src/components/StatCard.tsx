import type { IconComponent } from '../lib/icons';
import type { ReactNode } from 'react';

export type StatTone = 'cyan' | 'emerald' | 'amber' | 'slate';

/** Flat icon tiles from the theme tokens. */
const TONE_CLASSES: Record<StatTone, string> = {
  cyan: 'bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300',
  emerald: 'bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300',
  amber: 'bg-danger-50 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300',
  slate: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
};

interface StatCardProps {
  icon: IconComponent;
  label: string;
  value: ReactNode;
  /** Small caption under the value (e.g. "+2 this week"). */
  suffix?: string;
  hint?: string;
  tone?: StatTone;
}

export function StatCard({ icon: Icon, label, value, suffix, hint, tone = 'cyan' }: StatCardProps): React.ReactElement {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-50">{value}</p>
          {suffix ? <p className="mt-0.5 text-[11px] font-medium text-stone-400 dark:text-stone-500">{suffix}</p> : null}
        </div>
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line ${TONE_CLASSES[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {hint ? <p className="mt-3 text-xs leading-5 text-stone-500 dark:text-stone-400">{hint}</p> : null}
    </div>
  );
}
