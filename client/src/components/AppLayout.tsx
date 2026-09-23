import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

/** Route prefix -> page heading shown in the top bar. */
const PAGE_TITLES: Array<{ prefix: string; title: string; subtitle: string }> = [
  { prefix: '/dashboard', title: 'Dashboard', subtitle: 'Your encrypted workspace at a glance' },
  { prefix: '/notes/new', title: 'Create Note', subtitle: 'Encrypted in this browser before it is stored' },
  { prefix: '/notes/', title: 'Note', subtitle: 'Decrypted locally in this tab' },
  { prefix: '/notes', title: 'My Notes', subtitle: 'Search, edit and share your encrypted notes' },
  { prefix: '/shared', title: 'Shared With Me', subtitle: 'Notes other people wrapped for your key' },
  { prefix: '/activity', title: 'Activity & Audit Log', subtitle: 'Security-relevant events on your account' },
  { prefix: '/inspector', title: 'Security Inspector', subtitle: 'Technical metadata - never keys or passwords' },
];

function resolveHeading(pathname: string): { title: string; subtitle: string } {
  const match = PAGE_TITLES.find((entry) => pathname.startsWith(entry.prefix));
  return match ?? { title: 'CipherNote', subtitle: '' };
}

export function AppLayout(): JSX.Element {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const heading = resolveHeading(location.pathname);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-72">
        <Topbar
          title={heading.title}
          subtitle={heading.subtitle}
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          <Outlet />
        </main>

        <footer className="mx-auto w-full max-w-7xl px-4 pb-8 text-xs text-slate-400 dark:text-slate-600 sm:px-6">
          CipherNote · SYNCSQUAD · notes and files are encrypted with AES-GCM in your browser and are never sent in
          plaintext.
        </footer>
      </div>
    </div>
  );
}
