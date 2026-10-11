import { type ReactNode } from 'react';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  src?: string;
  online?: boolean;
  icon?: ReactNode;
  className?: string;
}

export function Avatar({ name, size = 'md', src, online, icon, className = '' }: AvatarProps): React.ReactElement {
  const sizeClass = {
    sm: 'h-8 w-8',
    md: 'h-9 w-9',
    lg: 'h-11 w-11',
  }[size];

  const initials = name.trim().split(/\s+/).filter(Boolean);
  const text = initials.length === 0 ? '?' : initials.length === 1 ? initials[0]!.slice(0, 2).toUpperCase() : `${initials[0]![0]}${initials[initials.length - 1]![0]}`.toUpperCase();

  const inner = src ? (
    <img src={src} alt={name} className={`${sizeClass} rounded-md object-cover`} />
  ) : (
    <div className={`${sizeClass} flex items-center justify-center rounded-md bg-accent text-paper text-xs font-semibold`}>
      {icon ?? text}
    </div>
  );

  return (
    <div className={`${className}`}>
      {inner}
      {online ? (
        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-sm border border-line bg-accent" />
      ) : null}
    </div>
  );
}
