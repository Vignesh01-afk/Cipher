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
}: ButtonProps): JSX.Element {
  const base =
    'inline-flex cursor-pointer select-none items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand/50';
  const variantClass = {
    primary:
      'bg-gradient-to-r from-brand-500 via-violet-500 to-pink-500 text-white shadow-[0_10px_26px_-10px_rgba(122,88,247,0.8)] hover:brightness-[1.07] hover:shadow-[0_14px_32px_-10px_rgba(122,88,247,0.9)]',
    secondary:
      'border border-white/60 bg-white/70 text-slate-700 hover:bg-white/90 active:bg-white dark:border-white/[0.10] dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.12]',
    ghost:
      'text-slate-600 hover:bg-white/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-slate-100',
    danger:
      'bg-rose-600 text-white shadow-[0_10px_26px_-10px_rgba(225,29,72,0.7)] hover:bg-rose-500 active:bg-rose-700',
    glass:
      'border border-white/60 bg-white/70 text-slate-700 hover:bg-white/90 active:bg-white dark:border-white/[0.10] dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/[0.12]',
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
