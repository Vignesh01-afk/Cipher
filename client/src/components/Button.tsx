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
    primary: 'bg-gradient-to-r from-[#2f6bff] to-[#8b5cf6] text-white shadow-[0_0_0_1px_rgba(99,102,241,0.35),0_0_18px_rgba(99,102,241,0.25)] hover:shadow-[0_0_0_1px_rgba(99,102,241,0.35),0_0_28px_rgba(99,102,241,0.42)]',
    secondary: 'bg-panel text-ink border-line hover:border-indigo-500 shadow-[0_0_0_1px_rgba(99,102,241,0.12)]',
    ghost: 'bg-transparent text-muted hover:text-ink hover:bg-panel/70',
    danger: 'bg-danger text-white',
    // Kept as a named alias of secondary for call-site compatibility.
    glass: 'bg-panel/80 backdrop-blur border-line text-ink hover:border-indigo-500',
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
