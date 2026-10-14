import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export interface DropdownItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  className?: string;
}

const DropdownCloseContext = createContext<() => void>(() => undefined);

interface DropdownProps {
  trigger: ReactNode;
  /**
   * Optional classes for the wrapper <button> around the trigger node.
   * The wrapper is unstyled by default (inline-flex only) so callers put
   * their own tile/border styles on it exactly once - never on an inner
   * element as well, which would render a double border.
   */
  triggerClassName?: string;
  className?: string;
  align?: 'left' | 'right';
  children: ReactNode;
  rootRef?: (node: HTMLElement | null) => void;
}

export function Dropdown({ trigger, triggerClassName = '', className = '', align = 'left', children, rootRef }: DropdownProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onDocKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onDocKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onDocKey);
    };
  }, [open]);

  return (
    <div
      className={`relative inline-flex ${className}`.trim()}
      ref={(node) => {
        containerRef.current = node;
        rootRef?.(node);
      }}
    >
      <button
        type="button"
        className={`inline-flex ${triggerClassName}`.trim()}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {trigger}
      </button>

      {open ? (
        <DropdownCloseContext.Provider value={() => setOpen(false)}>
          <div
            ref={panelRef}
            className="absolute z-50 mt-2 w-56 overflow-hidden rounded-md border border-line bg-surface p-1"
            style={{
              right: align === 'right' ? '0' : 'auto',
              left: align === 'left' ? '0' : 'auto',
            }}
          >
            {children}
          </div>
        </DropdownCloseContext.Provider>
      ) : null}
    </div>
  );
}

export function DropdownMenu({ items, className }: { items: DropdownItem[]; className?: string }): React.ReactElement {
  const close = useContext(DropdownCloseContext);
  return (
    <div className={`py-1 ${className ?? ''}`} role="menu" aria-label="Options">
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          role="menuitem"
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm  ${
            item.disabled
              ? 'cursor-not-allowed text-muted dark:text-muted'
              : 'text-ink hover:bg-stone-100 hover:text-ink dark:text-ink dark:hover:bg-stone-800'
          } ${item.className ?? ''}`}
          onClick={() => {
            item.onSelect();
            close();
          }}
          disabled={item.disabled}
        >
          {item.icon ? <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">{item.icon}</span> : null}
          {item.label}
        </button>
      ))}
    </div>
  );
}
