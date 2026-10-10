import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { FullPageLoader } from './Spinner';
import { useAuth } from '../context/AuthContext';

export function RequireUnlocked({ children }: { children: ReactNode }): React.ReactElement {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (status === 'locked') return <Navigate to="/unlock" replace />;
  return <>{children}</>;
}

export function RequireLockedSession({ children }: { children: ReactNode }): React.ReactElement {
  const { status } = useAuth();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  if (status === 'unlocked') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export function RedirectIfAuthenticated({ children }: { children: ReactNode }): React.ReactElement {
  const { status } = useAuth();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'unlocked') return <Navigate to="/dashboard" replace />;
  if (status === 'locked') return <Navigate to="/unlock" replace />;
  return <>{children}</>;
}
