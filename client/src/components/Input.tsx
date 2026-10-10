import { useId, type ReactNode } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftAddon?: ReactNode;
  rightAddon?: ReactNode;
}

export function Input({
  label,
  error,
  leftAddon,
  rightAddon,
  className = '',
  id,
  ...rest
}: InputProps): React.ReactElement {
  // Fall back to a generated id so the <label> is always programmatically
  // associated with its input (screen readers + getByLabel locators).
  const reactId = useId();
  const inputId = id ?? (typeof rest.name === 'string' ? rest.name : reactId);

  return (
    <div className={`w-full ${className}`}>
      {label ? <label className="label" htmlFor={inputId}>{label}</label> : null}
      <div className="relative">
        {leftAddon ? (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
            {leftAddon}
          </span>
        ) : null}
        <input
          id={inputId}
          className={`input ${leftAddon ? 'pl-11' : ''} ${error ? 'border-rose-400 focus:border-rose-400 focus:ring-rose-400/15' : ''}`}
          {...rest}
        />
        {rightAddon ? (
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400">
            {rightAddon}
          </span>
        ) : null}
      </div>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
