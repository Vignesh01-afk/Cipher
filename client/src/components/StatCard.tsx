import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export type StatTone = 'cyan' | 'emerald' | 'amber' | 'violet' | 'magenta' | 'slate';

/** Gradient icon tiles, per the dashboard mockup. */
const TONE_CLASSES: Record<StatTone, string> = {
  cyan: 'bg-gradient-to-br from-[#4A6CF7] to-[#7C5CF6] text-white',
  violet: 'bg-gradient-to-br from-[#7C5CF6] to-[#8B5CF6] text-white',
  magenta: 'bg-gradient-to-br from-[#8B5CF6] to-[#D946EF] text-white',
  emerald: 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white',
  amber: 'bg-gradient-to-br from-amber-500 to-orange-500 text-white',
  slate: 'bg-gradient-to-br from-stone-500 to-stone-600 text-white',
};

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  /** Small caption under the value (e.g. "+2 this week"). */
  suffix?: string;
  hint?: string;
  tone?: StatTone;
}

export function StatCard({ icon: Icon, label, value, suffix, hint, tone = 'cyan' }: StatCardProps): JSX.Element {
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
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-[0_10px_24px_-12px_rgba(122,88,247,0.8)] ${TONE_CLASSES[tone]}`}
        >
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {hint ? <p className="mt-3 text-xs leading-5 text-stone-500 dark:text-stone-400">{hint}</p> : null}
    </div>
  );
}
