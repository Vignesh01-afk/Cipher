import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  push: (toast: Omit<ToastItem, 'id'>) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
}

const TOAST_TIMEOUT_MS = 5200;

function ToastIcon({ variant }: { variant: ToastVariant }): JSX.Element {
  if (variant === 'success') return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />;
  if (variant === 'error') return <XCircle className="h-5 w-5 shrink-0 text-rose-500" />;
  if (variant === 'warning') return <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />;
  return <Info className="h-5 w-5 shrink-0 text-blue-500" />;
}

function ToastItemComponent({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }): JSX.Element {
  return (
    <div className="toast">
      <div className="flex items-start gap-3">
        <ToastIcon variant={toast.variant} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-5 text-slate-900 dark:text-white">{toast.title}</p>
          {toast.description ? <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{toast.description}</p> : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="rounded-md p-1 text-slate-400 transition hover:bg-white/60 hover:text-slate-600 dark:hover:bg-white/[0.08] dark:hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      counter.current += 1;
      const id = `toast-${counter.current}`;
      setToasts((current) => [...current, { ...toast, id }]);
      window.setTimeout(() => dismiss(id), TOAST_TIMEOUT_MS);
      return id;
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push({ title, description, variant: 'success' }),
      error: (title, description) => push({ title, description, variant: 'error' }),
      warning: (title, description) => push({ title, description, variant: 'warning' }),
      info: (title, description) => push({ title, description, variant: 'info' }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container" aria-live="polite" aria-label="Notifications">
        {toasts.map((toast) => (
          <ToastItemComponent key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}
