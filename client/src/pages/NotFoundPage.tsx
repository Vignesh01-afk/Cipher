import { Link } from 'react-router-dom';
import { Home, ArrowLeft, Lock } from 'lucide-react';

export function NotFoundPage(): JSX.Element {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="card p-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/70 text-stone-400 dark:bg-white/[0.06] dark:text-stone-500">
          <Lock className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-stone-900 dark:text-white">Page not found</h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-stone-500 dark:text-stone-400">
          The address you followed either does not exist or the note, conversation or resource has moved.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/dashboard" className="btn btn-primary">
            <Home className="h-4 w-4" />
            Go to home
          </Link>
          <Link to="/notes" className="btn btn-secondary">
            <ArrowLeft className="h-4 w-4" />
            Back to notes
          </Link>
        </div>
      </div>
    </div>
  );
}
