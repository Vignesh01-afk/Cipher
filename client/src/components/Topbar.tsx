import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MagnifyingGlass, Moon, Sun, SignOut, User, Gear, Shield, Lock, ArrowLeft } from '@phosphor-icons/react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { Dropdown, DropdownMenu, type DropdownItem } from './Dropdown';

interface TopbarProps {
  onOpenSidebar?: () => void;
  actions?: React.ReactNode;
}

export function Topbar({ onOpenSidebar, actions }: TopbarProps): React.ReactElement {
  const { theme, toggleTheme, setTheme } = useTheme();
  const { status, user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);

  const displayName = user?.displayName ?? 'User';
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
            placeholder="Search notes, chats, or users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            aria-label="Search notes, chats, or users"
          />
        </form>

        <div className="flex shrink-0 items-center gap-2">
          {actions}

          <button
            type="button"
            className="btn btn-ghost h-9 w-9 shrink-0 p-0"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <span className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line sm:inline-flex ${status === 'unlocked' ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300' : 'bg-danger-50 text-danger-700 dark:bg-danger-900/40 dark:text-danger-300'}`}>
            <Lock className="h-4 w-4" />
          </span>

          <Dropdown
            align="right"
            trigger={
              <button
                type="button"
                className="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1"
              >
                <Avatar name={displayName} size="sm" />
                <span className="hidden text-left sm:block">
                  <span className="block text-sm font-medium leading-tight text-ink">{displayName}</span>
                  {user?.cipherId ? (
                    <span className="block font-mono text-xs leading-tight text-muted">{user.cipherId}</span>
                  ) : null}
                </span>
              </button>
            }
          >
            <DropdownMenu items={profileItems} />
          </Dropdown>
        </div>
      </div>
    </header>
  );
}
