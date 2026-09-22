import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type StatTone = 'cyan' | 'emerald' | 'amber' | 'violet' | 'slate';

const TONE_CLASSES: Record<StatTone, string> = {
  cyan: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-400',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: StatTone;
}

export function StatCard({ icon: Icon, label, value, hint, tone = 'cyan' }: StatCardProps): JSX.Element {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {hint ? <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{hint}</p> : null}
    </div>
  );
}
