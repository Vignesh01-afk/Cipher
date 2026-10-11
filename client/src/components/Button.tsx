import { type ReactNode, type ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass';
  size?: 'sm' | 'md' | 'lg';
  iconOnly?: boolean;
  active?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  iconOnly = false,
  active = false,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonProps): React.ReactElement {
  const base =
    'inline-flex items-center justify-center gap-2 rounded border font-semibold px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';
  const variantClass = {
    primary: 'border-accent bg-accent text-paper hover:bg-accent-600 dark:hover:bg-accent-400',
    secondary: 'border-line bg-surface text-ink hover:border-accent',
    ghost: 'border-transparent text-muted hover:text-ink',
    danger: 'border-danger bg-danger text-white',
    // Kept as a named alias of secondary for call-site compatibility.
    glass: 'border-line bg-surface text-ink hover:border-accent',
  }[variant];

  const sizeClass = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-6 py-3.5 text-base',
  }[size];

  const iconOnlyClass = iconOnly ? 'p-3' : '';

  return (
    <button
      className={`${base} ${variantClass} ${sizeClass} ${iconOnlyClass} ${className}`}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
