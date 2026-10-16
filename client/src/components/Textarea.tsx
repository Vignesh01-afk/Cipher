import type { TextareaHTMLAttributes } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className = '', id, ...rest }: TextareaProps): React.ReactElement {
  const textareaId = id ?? (typeof rest.name === 'string' ? rest.name : undefined);

  return (
    <div className={`w-full ${className}`}>
      {label ? <label className="label" htmlFor={textareaId}>{label}</label> : null}
      <textarea
        id={textareaId}
        className={`textarea border ${error ? 'border-rose-400 focus:border-rose-400 focus:ring-rose-400/15' : ''}`}
        {...rest}
      />
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
