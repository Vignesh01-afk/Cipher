import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MagnifyingGlass, Moon, Sun, SignOut, User, Gear, Shield, Lock, ArrowLeft, List, FileText, LockOpen, UserCircle } from '@phosphor-icons/react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Avatar } from './Avatar';
import { Dropdown, DropdownMenu, type DropdownItem } from './Dropdown';

interface TopbarProps {
  onOpenSidebar?: () => void;
  actions?: ReactNode;
}

export function Topbar({ onOpenSidebar, actions }: TopbarProps): React.ReactElement {
  const { theme, toggleTheme, setTheme } = useTheme();
  const { status, user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifications, setNotifications] = useState<{ id: string; action: string; createdAt: string; noteId?: string | null }[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const displayName = user?.displayName ?? 'User';
  const unreadCount = notifications.length;
  const nameParts = displayName.trim().split(/\s+/).filter(Boolean);
  const initials =
    nameParts.length === 0
      ? '?'
      : nameParts.length === 1
        ? nameParts[0]!.slice(0, 2).toUpperCase()
        : `${nameParts[0]![0]}${nameParts[nameParts.length - 1]![0]}`.toUpperCase();

  const handleThemeChange = (next: 'light' | 'dark') => {
    setTheme(next);
    toggleTheme();
  };

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) navigate(`/notes?q=${encodeURIComponent(searchQuery.trim())}`);
    setSearchOpen(false);
  };

  useEffect(() => {
    let cancelled = false;
    api
      .listAuditLogs({ limit: 50 })
      .then((items) => {
        if (cancelled) return;
        setNotifications(items.slice(0, 8));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const profileItems: DropdownItem[] = [
    { label: 'Profile', icon: <User className="h-4 w-4" />, onSelect: () => { setProfileOpen(false); navigate('/settings/privacy'); } },
    { label: 'Settings', icon: <Gear className="h-4 w-4" />, onSelect: () => { setProfileOpen(false); navigate('/settings/privacy'); } },
    { label: 'Security', icon: <Shield className="h-4 w-4" />, onSelect: () => { setProfileOpen(false); navigate('/inspector'); } },
    { label: 'Log out', icon: <SignOut className="h-4 w-4" />, onSelect: () => { setProfileOpen(false); void logout(); } },
  ];

  const onChatThread = location.pathname.startsWith('/chat') && location.pathname !== '/chat';

  return (
    <header className="topbar">
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
        {onChatThread ? (
          <button
            type="button"
            className="btn btn-ghost p-2"
            onClick={() => navigate('/chat')}
            aria-label="Back to conversations"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : onOpenSidebar ? (
          <button type="button" className="btn btn-ghost p-2 lg:hidden" onClick={onOpenSidebar} aria-label="Open navigation">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        ) : null}

        {/* Mobile: icon-only search that jumps to the notes page. */}
        <button
          type="button"
          className="btn btn-ghost h-9 w-9 shrink-0 p-0 sm:hidden"
          onClick={() => navigate('/notes')}
          aria-label="Search notes"
        >
          <MagnifyingGlass className="h-4 w-4" />
        </button>

        <form className="topbar-search relative hidden sm:flex" onSubmit={onSearch}>
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            className="input pl-10"
            placeholder="Search notes, users or CipherNote ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            aria-label="Search notes, users or CipherNote ID"
          />
        </form>

        <div className="flex shrink-0 items-center gap-2">
          {actions}

          <button
            type="button"
            className="btn btn-ghost h-9 w-9 shrink-0 p-0 relative"
            aria-label="Notifications"
            onClick={(e) => {
              e.stopPropagation();
              setNotificationsOpen((open) => !open);
            }}
          >
            <span className="relative flex h-4 w-4 items-center justify-center">
              <List className="h-5 w-5" />
              {unreadCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[9px] font-bold text-white shadow-[0_0_0_1px_rgba(99,102,241,0.35),0_0_8px_rgba(99,102,241,0.3)]">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : null}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-ghost h-9 w-9 shrink-0 p-0"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <Dropdown
            align="right"
            trigger={
              <button
                type="button"
                className="flex items-center gap-2 rounded-xl border border-line bg-panel px-2.5 py-1.5 shadow-[0_0_0_1px_rgba(99,102,241,0.08)]"
              >
                <Avatar name={displayName} size="sm" />
                <span className="hidden text-left sm:block">
                  <span className="block text-sm font-medium leading-tight text-ink">{displayName}</span>
                  {user?.cipherId ? (
                    <span className="block font-mono text-xs leading-tight text-muted">{user.cipherId}</span>
                  ) : null}
                </span>
                <svg className="h-4 w-4 shrink-0 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
            }
          >
            <div className="max-h-80 overflow-y-auto p-1">
              {notifications.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-muted">No recent activity</div>
              ) : (
              notifications.slice(0, 6).map((item) => {
                const label = getAuditLabel(item.action);
                const icon = getAuditIcon(item.action);
                const targetNoteId = item.noteId ?? null;
                return (
                  <div
                    key={item.id}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                    onClick={() => {
                      if (targetNoteId) {
                        navigate(`/notes/${targetNoteId}`);
                      } else {
                        navigate('/activity');
                      }
                      setNotificationsOpen(false);
                    }}
                  >
                    {icon}
                    <span>{label}</span>
                  </div>
                );
              })
              )}
            </div>
          </Dropdown>

        </div>
      </div>
    </header>
  );
}

function getAuditLabel(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b[A-Z]/g, (ch) => ch.toLowerCase());
}

function getAuditIcon(action: string): ReactNode {
  if (action.includes('NOTE')) return <FileText className="h-4 w-4" />;
  if (action.includes('CHAT')) return <LockOpen className="h-4 w-4" />;
  if (action.includes('SHARE')) return <UserCircle className="h-4 w-4" />;
  return <List className="h-4 w-4" />;
}
