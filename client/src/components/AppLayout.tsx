import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { MagnifyingGlass, Bell, Moon, Sun, CaretDown, SignOut, User, Gear, Shield, Lock, ArrowLeft, House, ChatCircle, FileText, Users, Star } from '@phosphor-icons/react';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { Dropdown, DropdownMenu, type DropdownItem } from './Dropdown';
import { Sidebar } from './Sidebar';

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
    { label: 'Profile', icon: <User className="h-4 w-4" />, onSelect: () => { setProfileOpen(false); navigate('/settings/privacy'); } },
    { label: 'Settings', icon: <Gear className="h-4 w-4" />, onSelect: () => { setProfileOpen(false); navigate('/settings/privacy'); } },
    { label: 'Security', icon: <Shield className="h-4 w-4" />, onSelect: () => { setProfileOpen(false); navigate('/inspector'); } },
    { label: 'Log out', icon: <SignOut className="h-4 w-4" />, onSelect: () => { setProfileOpen(false); void logout(); } },
  ];

  const onChatThread = location.pathname.startsWith('/chat') && location.pathname !== '/chat';
  const onNoteEditor = location.pathname.startsWith('/notes/') && location.pathname.endsWith('/edit');
  const onNoteView = location.pathname.startsWith('/notes/') && !location.pathname.endsWith('/edit');
  const onShared = location.pathname === '/shared';
  const inChatList = location.pathname === '/chat';

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

        {!onNoteEditor ? (
          <form className="topbar-search" onSubmit={onSearch}>
            <MagnifyingGlass className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
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
        ) : null}

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

export function AppLayout({ children }: { children?: ReactNode }): React.ReactElement {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const isFullBleed =
    location.pathname.startsWith('/chat') ||
    location.pathname.startsWith('/notes') ||
    location.pathname === '/shared';

  return (
    <div className="thumb-layout">
      <Sidebar open={sidebarOpen || false} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-h-screen flex-col lg:pl-72">
        <Topbar onOpenSidebar={() => setSidebarOpen(true)} />

        <main className="flex flex-1 flex-col overflow-hidden pb-16 lg:pb-0">
          {isFullBleed ? (
            <Outlet />
          ) : (
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
              <Outlet />
            </div>
          )}
        </main>

        {/* Mobile bottom navigation *always* visible so the nav targets stay consistent */}
        <nav className="bottom-nav" aria-label="Mobile primary">
          <button
            type="button"
            className={`bottom-nav-link ${location.pathname === '/dashboard' ? 'bottom-nav-link-active' : ''}`}
            onClick={() => navigate('/dashboard')}
            aria-label="Go to Home"
          >
            <House className="h-5 w-5" />
            Home
          </button>
          <button
            type="button"
            className={`bottom-nav-link ${location.pathname === '/notes' ? 'bottom-nav-link-active' : ''}`}
            onClick={() => navigate('/notes')}
            aria-label="Go to Notes"
          >
            <FileText className="h-5 w-5" />
            Notes
          </button>
          <button
            type="button"
            className={`bottom-nav-link ${location.pathname === '/chat' || location.pathname.startsWith('/chat/') ? 'bottom-nav-link-active' : ''}`}
            onClick={() => navigate('/chat')}
            aria-label="Go to Chat"
          >
            <ChatCircle className="h-5 w-5" />
            Chat
          </button>
          <button
            type="button"
            className={`bottom-nav-link ${location.pathname === '/shared' ? 'bottom-nav-link-active' : ''}`}
            onClick={() => navigate('/shared')}
            aria-label="Go to Shared"
          >
            <Users className="h-5 w-5" />
            Shared
          </button>
          <button
            type="button"
            className={`bottom-nav-link ${location.pathname === '/settings/privacy' || location.pathname === '/settings' || location.pathname === '/privacy' ? 'bottom-nav-link-active' : ''}`}
            onClick={() => navigate('/settings/privacy')}
            aria-label="Go to Settings"
          >
            <Star className="h-5 w-5" />
            Settings
          </button>
        </nav>
      </div>
    </div>
  );
}
