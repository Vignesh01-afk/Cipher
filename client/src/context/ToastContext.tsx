import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode, } from 'react';
import { Warning, CheckCircle, Info, X, XCircle } from '@phosphor-icons/react';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<ToastVariant, { container: string; icon: ReactNode }> = {
  success: {
    container:
      'border-emerald-200 bg-surface text-stone-800 dark:border-emerald-500/30 dark:bg-stone-900 dark:text-stone-100',
    icon: <CheckCircle className="h-5 w-5 shrink-0 text-emerald-500" />,
  },
  error: {
    container:
      'border-rose-200 bg-surface text-stone-800 dark:border-rose-500/30 dark:bg-stone-900 dark:text-stone-100',
    icon: <XCircle className="h-5 w-5 shrink-0 text-rose-500" />,
  },
  warning: {
    container:
      'border-amber-200 bg-surface text-stone-800 dark:border-amber-500/30 dark:bg-stone-900 dark:text-stone-100',
    icon: <Warning className="h-5 w-5 shrink-0 text-amber-500" />,
  },
  info: {
    container:
      'border-cyan-200 bg-surface text-stone-800 dark:border-cyan-500/30 dark:bg-stone-900 dark:text-stone-100',
    icon: <Info className="h-5 w-5 shrink-0 text-cyan-500" />,
  },
};

const TOAST_TIMEOUT_MS = 5200;

export function ToastProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      counter.current += 1;
      const id = `toast-${counter.current}-${Date.now()}`;
      setToasts((current) => [...current, { ...toast, id }].slice(-4));
      window.setTimeout(() => dismiss(id), TOAST_TIMEOUT_MS);
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      dismiss,
      success: (title, description) => push({ title, description, variant: 'success' }),
      error: (title, description) => push({ title, description, variant: 'error' }),
      info: (title, description) => push({ title, description, variant: 'info' }),
      warning: (title, description) => push({ title, description, variant: 'warning' }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border px-4 py-3    ${VARIANT_STYLES[toast.variant].container}`}
          >
            {VARIANT_STYLES[toast.variant].icon}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-5">{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 text-xs leading-5 text-stone-500 dark:text-stone-400">
                  {toast.description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="rounded-md p-1 text-stone-400  hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used inside a ToastProvider');
  }
  return context;
}
