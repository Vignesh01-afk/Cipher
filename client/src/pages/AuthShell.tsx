import type { ReactNode } from 'react';
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
    <div className="relative flex min-h-screen flex-col bg-surface">
      <div className="flex flex-1 flex-col">
        {children}
      </div>
    </div>
  );
}
