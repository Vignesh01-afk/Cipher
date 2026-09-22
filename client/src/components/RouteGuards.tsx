import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FullPageLoader } from './Spinner';

/**
 * Guards for the three session states.
 *
 * `RequireUnlocked` is the important one: even with a valid session token, the
 * app refuses to render note pages until the user's keys have been unlocked in
 * memory, because there is nothing to decrypt with otherwise.
 */
export function RequireUnlocked({ children }: { children: ReactNode }): JSX.Element {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (status === 'locked') return <Navigate to="/unlock" replace />;

  return <>{children}</>;
}

/** Wraps the unlock screen: needs a session, but not unlocked keys. */
export function RequireLockedSession({ children }: { children: ReactNode }): JSX.Element {
  const { status } = useAuth();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  if (status === 'unlocked') return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}

/** Wraps login/register so signed-in users are bounced into the app. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }): JSX.Element {
  const { status } = useAuth();

  if (status === 'loading') return <FullPageLoader />;
  if (status === 'unlocked') return <Navigate to="/dashboard" replace />;
  if (status === 'locked') return <Navigate to="/unlock" replace />;

  return <>{children}</>;
}
