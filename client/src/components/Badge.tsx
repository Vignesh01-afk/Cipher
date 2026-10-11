import type { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'brand' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'slate' | 'success';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ children, variant = 'slate', size = 'sm', className = '' }: BadgeProps): React.ReactElement {
  const variantClass = {
    brand: 'bg-accent bg-opacity-15 text-accent-700 dark:text-accent-300',
    emerald: 'bg-accent bg-opacity-10 text-accent-700 dark:text-accent-300',
    amber: 'bg-danger bg-opacity-10 text-danger-700 dark:text-danger-300',
    rose: 'bg-danger bg-opacity-10 text-danger-700 dark:text-danger-300',
    cyan: 'bg-accent bg-opacity-15 text-accent-700 dark:text-accent-300',
    slate: 'bg-surface/70 text-muted',
    success: 'bg-accent bg-opacity-10 text-accent-700 dark:text-accent-300',
  }[variant];

  const sizeClass = size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-xs font-medium ${variantClass} ${sizeClass} ${className}`}>
      {children}
    </span>
  );
}
