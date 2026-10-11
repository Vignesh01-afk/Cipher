interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  containerClassName?: string;
}

/** Accessible switch used by the privacy settings. */
export function Toggle({ checked, onChange, label, description, disabled, containerClassName }: ToggleProps): React.ReactElement {
  return (
    <div className={`flex items-start justify-between gap-4 py-2.5 ${containerClassName ?? ''}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-stone-800 dark:text-stone-100">{label}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-5 text-stone-500 dark:text-stone-400">{description}</p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'bg-accent' : 'bg-line'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-md bg-surface ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}
