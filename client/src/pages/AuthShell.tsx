import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface AuthShellProps {
  children: ReactNode;
  width?: 'md' | 'lg';
}

// Each auth page renders its own <BrandMark /> at the top of the card, so
// the shell itself stays brand-free to avoid a double logo.
export function AuthShell({ children, width = 'md' }: AuthShellProps): React.ReactElement {
  return (
    <div className="flex min-h-screen flex-col bg-page">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div
          className={`mx-auto w-full ${width === 'lg' ? 'max-w-lg' : 'max-w-md'} rounded-md border border-line bg-surface p-6`}
        >
          {children}
        </div>
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
