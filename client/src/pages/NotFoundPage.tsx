import { Link } from 'react-router-dom';
import { Compass, Home } from 'lucide-react';

export function NotFoundPage(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <div className="card w-full max-w-md p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-600/10 text-cyan-600 dark:text-cyan-400">
          <Compass className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-xl font-semibold text-slate-900 dark:text-slate-50">
          This page does not exist
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
          The address you followed is not part of CipherNote. It may have been a note that was deleted or a share you
          no longer hold.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Link to="/dashboard" className="btn btn-primary">
            <Home className="h-4 w-4" />
            Go to dashboard
          </Link>
          <Link to="/" className="btn btn-secondary">
            Landing page
          </Link>
        </div>
      </div>
    </div>
  );
}
