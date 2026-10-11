import type { ReactNode } from 'react';
import { Key, ShieldCheck, Wallet } from '@phosphor-icons/react';
import BrandMark from './BrandMark';

/**
 * Split-screen auth shell from the reference mockup:
 *
 *  - Left: the brand panel - gradient padlock, split wordmark, tagline,
 *    "Secure • Encrypted • Yours" and (in dark mode) the three trust chips.
 *  - Right: the form card.
 *  - Background: soft aurora waves, light periwinkle by day and deep
 *    indigo-navy with glowing waves by night.
 *
 * On phones the brand panel collapses to a compact centred header above the
 * card so the form stays the focus.
 */

interface AuthShellProps {
  children: ReactNode;
  /** Card width; register needs a touch more room than sign-in. */
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
