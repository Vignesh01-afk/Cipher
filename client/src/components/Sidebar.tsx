import { NavLink, useLocation } from 'react-router-dom';

import BrandMark from './BrandMark';
import { useAuth } from '../context/AuthContext';
import { House, FileText, ChatsCircle, Users, Scroll, Gear, Lock, CaretRight, SignOut } from '@phosphor-icons/react';
import type { ReactElement } from 'react';

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
  {
    to: '/settings',
    label: 'Settings',
    icon: Gear,
    children: [
      { to: '/privacy', label: 'Privacy Mode', icon: Lock },
    ],
  },
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
          className="fixed inset-0 z-30 bg-stone-950/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={`sidebar fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-white/10 bg-white/60 backdrop-blur-xl transition-transform duration-300 dark:bg-[#0B0F19]/80 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="sidebar-brand">
          <NavLink to="/dashboard" className="group flex items-center gap-3" onClick={onClose}>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 via-violet-500 to-pink-500 text-white shadow-[0_8px_24px_-10px_rgba(122,88,247,0.9)]">
              <BrandMark size="md" aria-hidden="true" />
            </div>
            <span className="text-xl font-bold tracking-tight text-stone-900 dark:text-white">
              <span className="brand-wordmark-cipher">Cipher</span>
              <span className="brand-wordmark-note">Note</span>
            </span>
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
              {item.children ? (
                <div className="sidebar-section-label">Settings</div>
              ) : null}
              <NavLink
                to={item.to}
                end={item.to === '/dashboard' || item.to === '/settings'}
                onClick={onClose}
                className={({ isActive }) =>
                  `nav-link flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all ${
                    isActive
                      ? 'nav-link-active'
                      : 'text-stone-600 hover:bg-white/60 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-white/8'
                  }`
                }
              >
                <item.icon className="nav-icon" />
                <span className="nav-label">{item.label}</span>
                {item.children ? (
                  <CaretRight className="ml-auto h-3.5 w-3.5 text-stone-400" />
                ) : null}
              </NavLink>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="security-badge">
            <Lock className="h-4 w-4 shrink-0 text-emerald-500" />
            <div>
              <p className="text-xs font-bold text-stone-900 dark:text-white">End-to-End Encrypted</p>
              <p className="text-[11px] text-stone-400">Your privacy. Our priority.</p>
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
