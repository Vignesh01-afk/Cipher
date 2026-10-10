import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MagnifyingGlass, Bell, Moon, Sun, CaretDown, SignOut, User, Gear, Shield, Lock, Envelope, Compass, ArrowLeft } from '@phosphor-icons/react';
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
  const [notificationOpen, setNotificationOpen] = useState(false);

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
    { label: 'Profile', icon: <User className="h-4 w-4" />, onSelect: () => { setProfileOpen(false); navigate('/privacy'); } },
    { label: 'Settings', icon: <Gear className="h-4 w-4" />, onSelect: () => { setProfileOpen(false); navigate('/settings'); } },
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
          <button type="button" className="btn btn-ghost p-2" onClick={onOpenSidebar} aria-label="Open navigation">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        ) : null}

        <form className="topbar-search" onSubmit={onSearch}>
          <MagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            className="input pl-11"
            placeholder="Search notes, chats, or users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            aria-label="Search notes, chats, or users"
          />
        </form>

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <Bell className="h-2.5 w-2.5" />
            <span className="notification-ring" />
            <span className="notification-dot" />
          </span>

          {actions}

          <span className={`hidden h-9 w-9 items-center justify-center rounded-md sm:inline-flex ${status === 'unlocked' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
            <Lock className="h-4 w-4" />
          </span>

          <button
            type="button"
            className="btn btn-ghost p-2"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <Dropdown align="right" trigger={<Avatar name={user?.displayName ?? 'User'} />}>
            <DropdownMenu items={profileItems} />
          </Dropdown>
        </div>
      </div>
    </header>
  );
}
