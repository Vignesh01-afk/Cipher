import type { ReactNode } from 'react';
import { Menu, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { SecurityBadge } from './SecurityBadge';

interface TopbarProps {
  title: string;
  subtitle?: string;
  onOpenSidebar: () => void;
  actions?: ReactNode;
}

export function Topbar({ title, subtitle, onOpenSidebar, actions }: TopbarProps): JSX.Element {
  const { theme, toggleTheme } = useTheme();
  const { status } = useAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-slate-100/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
      <div className="flex items-center gap-3 px-4 py-3.5 sm:px-6">
        <button
          type="button"
          className="btn btn-ghost p-2 lg:hidden"
          onClick={onOpenSidebar}
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            {title}
          </h1>
          {subtitle ? (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {actions}

          {/* App-wide encryption indicator; click for the claims modal. */}
          <span className="hidden sm:inline-flex">
            <SecurityBadge />
          </span>

          <span
            className={`badge hidden sm:inline-flex ${
              status === 'unlocked' ? 'badge-emerald' : 'badge-amber'
            }`}
            title={
              status === 'unlocked'
                ? 'Your encryption keys are unlocked in this tab'
                : 'Your keys are not in memory; decrypting requires unlocking'
            }
          >
            <ShieldCheck className="h-3 w-3" />
            {status === 'unlocked' ? 'Vault unlocked' : 'Vault locked'}
          </span>

          <button
            type="button"
            className="btn btn-ghost p-2"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
