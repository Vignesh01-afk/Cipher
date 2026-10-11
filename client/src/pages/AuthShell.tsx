import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import BrandMark from '../components/BrandMark';
import { ShieldCheck, Key, Wallet } from '@phosphor-icons/react';

interface AuthShellProps {
  children: ReactNode;
  width?: 'md' | 'lg';
}

const TRUST_CHIPS = [
  { icon: Key, label: 'End-to-End', sub: 'Encryption' },
  { icon: ShieldCheck, label: 'Secure', sub: 'Sharing' },
  { icon: Wallet, label: 'Full', sub: 'Control' },
];

export function AuthShell({ children, width = 'md' }: AuthShellProps): React.ReactElement {
  return (
    <div className="relative flex min-h-screen flex-col bg-paper">
      <div className="flex flex-1 flex-col justify-center">
        {children}
      </div>
      <footer className="border-t border-line bg-surface px-4 py-4 text-center text-xs text-muted">
        <p className="flex items-center justify-center gap-4">
          <Link to="/terms" className="link">Terms of Service</Link>
          <Link to="/privacy-policy" className="link">Privacy Policy</Link>
        </p>
      </footer>
    </div>
  );
}
