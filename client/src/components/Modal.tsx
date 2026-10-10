import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@phosphor-icons/react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: ReactNode;
  children: ReactNode;
}

function useDialog(open: boolean, onClose: () => void, panelRef: React.RefObject<HTMLDivElement | null>) {
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const focusables = panelRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0] as HTMLElement;
        const last = focusables[focusables.length - 1] as HTMLElement;
        if (event.shiftKey && document.activeElement === first) {
          last.focus();
          event.preventDefault();
        } else if (!event.shiftKey && document.activeElement === last) {
          first.focus();
          event.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, onClose, panelRef]);

  return { previousFocus };
}

export function Modal({ open, onClose, title, description, size = 'md', footer, children }: ModalProps): React.ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const { previousFocus } = useDialog(open, onClose, panelRef);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-950/50 p-4   sm:items-center">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${size === 'sm' ? 'max-w-sm' : size === 'md' ? 'max-w-xl' : size === 'lg' ? 'max-w-3xl' : 'max-w-4xl'} modal`}
      >
        {title ? (
          <div className="modal-header">
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{title}</h2>
              {description ? <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="rounded-md p-2 text-slate-400  hover:bg-surface/60 hover:text-slate-600 dark:hover:bg-surface/[0.08] dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <div className="px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-4 dark:border-white/[0.08]">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
