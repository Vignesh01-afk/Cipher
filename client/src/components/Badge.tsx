import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'brand' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate' | 'success';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ children, variant = 'slate', size = 'sm', className = '' }: BadgeProps): React.ReactElement {
  const variantClass = {
    brand: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300',
    emerald: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-300',
    amber: 'bg-rose-500/12 text-rose-600 dark:text-rose-300',
    rose: 'bg-rose-500/12 text-rose-600 dark:text-rose-300',
    cyan: 'bg-indigo-500/15 text-cyan-500 dark:text-cyan-300',
    slate: 'border border-line bg-panel text-muted',
    success: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-300',
  }[variant];

  const sizeClass = size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-xs font-medium ${variantClass} ${sizeClass} ${className}`}>
      {children}
    </span>
  );
}
