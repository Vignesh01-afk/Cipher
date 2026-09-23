import { useState, type KeyboardEvent } from 'react';
import { Tag, X } from 'lucide-react';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  disabled?: boolean;
}

const MAX_TAG_LENGTH = 32;

/**
 * Tag editor used by the note editor. Tags are part of the encrypted payload,
 * so they are never sent to the server as readable values.
 */
export function TagInput({
  value,
  onChange,
  placeholder = 'Add a tag and press Enter',
  maxTags = 12,
  disabled = false,
}: TagInputProps): JSX.Element {
  const [draft, setDraft] = useState('');

  function commit(raw: string): void {
    const tag = raw.trim().replace(/^#/, '').slice(0, MAX_TAG_LENGTH);
    if (!tag) return;
    const alreadyPresent = value.some((existing) => existing.toLowerCase() === tag.toLowerCase());
    if (alreadyPresent || value.length >= maxTags) {
      setDraft('');
      return;
    }
    onChange([...value, tag]);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commit(draft);
      return;
    }
    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.map((tag) => (
          <span key={tag} className="badge badge-cyan">
            <Tag className="h-3 w-3" />
            {tag}
            <button
              type="button"
              onClick={() => onChange(value.filter((candidate) => candidate !== tag))}
              className="-mr-1 ml-0.5 rounded-full p-0.5 transition-colors hover:bg-cyan-500/20"
              aria-label={`Remove tag ${tag}`}
              disabled={disabled}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {value.length === 0 ? (
          <span className="text-xs text-slate-400 dark:text-slate-500">No tags yet</span>
        ) : null}
      </div>

      <input
        type="text"
        className="input mt-2"
        value={draft}
        placeholder={placeholder}
        disabled={disabled || value.length >= maxTags}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
      />
      <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
        {value.length}/{maxTags} tags · stored inside the encrypted payload, not on the server as plaintext
      </p>
    </div>
  );
}
