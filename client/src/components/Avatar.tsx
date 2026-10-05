import { type ReactNode } from 'react';
import { User } from 'lucide-react';

interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  src?: string;
  online?: boolean;
  icon?: ReactNode;
  className?: string;
}

export function Avatar({ name, size = 'md', src, online, icon, className = '' }: AvatarProps): JSX.Element {
  const sizeClass = {
    sm: 'h-8 w-8',
    md: 'h-9 w-9',
    lg: 'h-11 w-11',
  }[size];

  const initials = name.trim().split(/\s+/).filter(Boolean);
  const text = initials.length === 0 ? '?' : initials.length === 1 ? initials[0]!.slice(0, 2).toUpperCase() : `${initials[0]![0]}${initials[initials.length - 1]![0]}`.toUpperCase();

  const inner = src ? (
    <img src={src} alt={name} className={`${sizeClass} rounded-full object-cover`} />
  ) : (
    <div className={`${sizeClass} rounded-full bg-gradient-to-br from-brand-500 via-violet-500 to-pink-500 text-xs font-bold text-white flex items-center justify-center`}>
      {icon ?? <User className="h-4 w-4" />}
      {text}
    </div>
  );

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {inner}
      {online ? (
        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-[#0B0F19] bg-emerald-500" />
      ) : null}
    </div>
  );
}
