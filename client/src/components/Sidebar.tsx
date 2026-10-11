import { NavLink, useLocation } from 'react-router-dom';

import BrandMark from './BrandMark';
import { useAuth } from '../context/AuthContext';
import { House, FileText, ChatsCircle, Users, Scroll, Gear, Lock, SignOut } from '@phosphor-icons/react';
import type { ReactElement } from 'react';

const LOGO_SRC = new URL('../../../public/logo.png', import.meta.url).href;

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Home', icon: House },
  { to: '/notes', label: 'Notes', icon: FileText },
  { to: '/chat', label: 'Chat', icon: ChatsCircle },
  { to: '/shared', label: 'Shared', icon: Users },
  { to: '/activity', label: 'Audit Log', icon: Scroll },
  { to: '/settings', label: 'Settings', icon: Gear },
];

export function Sidebar({ open, onClose }: SidebarProps): ReactElement {
  const { lock, logout } = useAuth();
  const location = useLocation();

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-scrim lg:hidden"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={`sidebar fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line bg-surface transition-transform duration-300 dark:bg-surface lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="sidebar-brand">
          <NavLink to="/dashboard" className="group flex items-center gap-3" onClick={onClose}>
            <BrandMark size="md" aria-hidden="true" logoSrc={LOGO_SRC} />
            <div className="flex flex-col leading-tight text-stone-900 dark:text-paper">
              <span className="text-lg font-bold tracking-tight">
                <span className="brand-wordmark-cipher">Cipher</span>
                <span className="brand-wordmark-note">Note</span>
              </span>
              <span className="text-[11px] font-medium text-muted dark:text-muted">Encrypt. Share. Revoke.</span>
            </div>
          </NavLink>
          <button
            type="button"
            className="btn btn-ghost p-1.5 lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <div key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/dashboard' || item.to === '/settings'}
                onClick={onClose}
                className={({ isActive }) =>
                  `nav-link flex items-center gap-3 rounded-md px-3.5 py-2.5 text-sm font-medium transition-all ${
                    isActive
                      ? 'nav-link-active'
                      : 'text-muted hover:bg-panel/70 hover:text-ink dark:hover:bg-panel/40 dark:hover:text-stone-100'
                  }`
                }
              >
                <item.icon className="nav-icon" />
                <span className="nav-label">{item.label}</span>
              </NavLink>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">            <div className="security-badge">
            <Lock className="h-4 w-4 shrink-0 text-indigo-400" />
            <div>
              <p className="text-xs font-semibold text-ink dark:text-paper">End-to-End Encrypted</p>
              <p className="text-[11px] text-muted dark:text-muted">Your privacy. Our priority.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={lock}
              disabled={lock === undefined}
              title="Clear decryption keys from memory"
            >
              <Lock className="h-3.5 w-3.5" />
              Lock
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void logout()}
              title="Sign out of your session"
            >
              <SignOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
