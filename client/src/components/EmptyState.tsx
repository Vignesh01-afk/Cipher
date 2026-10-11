import type { ReactNode } from 'react';
import type { IconComponent } from '../lib/icons';

interface EmptyStateProps {
  icon: IconComponent;
  title: string;
  description: string;
  action?: ReactNode;
  secondaryAction?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action, secondaryAction }: EmptyStateProps): React.ReactElement {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        <Icon className="h-6 w-6" />
      </div>          <h3 className="text-base font-bold text-ink dark:text-paper">{title}</h3>
          <p className="mt-1 max-w-md text-sm leading-6 text-muted dark:text-muted">{description}</p>
      {(action || secondaryAction) ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
