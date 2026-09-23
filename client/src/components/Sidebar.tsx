import { NavLink } from 'react-router-dom';
import {
  EyeOff,
  FilePlus2,
  FileText,
  FolderLock,
  LayoutDashboard,
  Lock,
  LogOut,
  ScrollText,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { initials } from '../lib/format';

interface SidebarProps {
  /** Mobile drawer state. The sidebar is always visible on large screens. */
  open: boolean;
  onClose: () => void;
}

const NAV_SECTIONS: Array<{
  heading: string;
  items: Array<{ to: string; label: string; icon: typeof FileText; end?: boolean }>;
}> = [
  {
    heading: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/notes', label: 'My Notes', icon: FileText, end: true },
      { to: '/notes/new', label: 'Create Note', icon: FilePlus2 },
      { to: '/shared', label: 'Shared With Me', icon: Users },
      { to: '/files', label: 'Secure Files', icon: FolderLock },
    ],
  },
  {
    heading: 'Security',
    items: [
      { to: '/privacy', label: 'Privacy Mode', icon: EyeOff },
      { to: '/activity', label: 'Activity Log', icon: ScrollText },
      { to: '/inspector', label: 'Security Inspector', icon: ShieldCheck },
    ],
  },
];

export function Sidebar({ open, onClose }: SidebarProps): JSX.Element {
  const { user, lock, logout } = useAuth();

  return (
    <>
      {/* Mobile backdrop */}
      {open ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform duration-200 dark:border-slate-800 dark:bg-slate-900 lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4">
          <NavLink
            to="/dashboard"
            className="group flex items-center gap-2.5"
            onClick={onClose}
          >
            <span className="brand-tile transition-transform duration-150 group-hover:scale-105" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8">
                <rect x="4" y="10.5" width="16" height="9.5" rx="2" />
                <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
                <path d="M12 14v3" strokeLinecap="round" />
              </svg>
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-bold tracking-tight text-slate-900 dark:text-slate-50">
                CipherNote
              </span>
              <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Private by design.
              </span>
            </span>
          </NavLink>
          <button
            type="button"
            className="btn btn-ghost p-1.5 lg:hidden"
            onClick={onClose}
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-2">
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading}>
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                {section.heading}
              </p>
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onClose}
                      className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-600/10 text-xs font-bold text-cyan-700 dark:text-cyan-300">
              {user ? initials(user.displayName) : '??'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
                {user?.displayName ?? 'Unknown user'}
              </p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email ?? ''}</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={lock} title="Clear note keys from memory">
              <Lock className="h-3.5 w-3.5" />
              Lock
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void logout()}
              title="Sign out and clear this session"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>

          <p className="mt-3 text-[11px] leading-4 text-slate-400 dark:text-slate-500">
            Keys live in memory only. Locking or reloading requires your password to decrypt notes again.
          </p>
        </div>
      </aside>
    </>
  );
}
