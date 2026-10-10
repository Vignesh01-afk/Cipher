import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'brand' | 'emerald' | 'amber' | 'rose' | 'violet' | 'cyan' | 'slate' | 'success';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ children, variant = 'slate', size = 'sm', className = '' }: BadgeProps): React.ReactElement {
  const variantClass = {
    brand: 'bg-brand/15 text-brand-700 ring-brand/30 dark:bg-brand/15 dark:text-brand-300 dark:ring-brand/40',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
    amber: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/30',
    rose: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30',
    cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-500/30',
    slate: 'bg-surface/70 text-slate-600 ring-white/40 dark:bg-surface/[0.06] dark:text-slate-300 dark:ring-white/10',
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  }[variant];

  const sizeClass = size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${variantClass} ${sizeClass} ${className}`}>
      {children}
    </span>
  );
}
