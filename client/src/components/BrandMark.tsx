/**
 * The CipherNote brand mark: a padlock whose body fades from brand blue to
 * magenta, matching the reference mockups.
 *
 * Drawn inline (no image request, no flash) so it renders crisply at every
 * size on both themes. Every auth page and both chrome headers use it, so the
 * logo only needs to change in this one component.
 */

const SIZES = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-16 w-16',
} as const;

type BrandMarkProps = {
  /** 'lg' for auth pages, 'md' for panels, 'sm' for headers/sidebar. */
  size?: keyof typeof SIZES;
  className?: string;
  /** Set on purely decorative marks (headers) so screen readers skip it. */
  'aria-hidden'?: boolean | 'true' | 'false';
};

export default function BrandMark({ size = 'sm', className = '', ...rest }: BrandMarkProps) {
  return (
    <span className={`brand-logo-img ${SIZES[size]} ${className}`.trim()} {...rest}>
      <svg viewBox="0 0 48 48" role="img" aria-label="CipherNote logo" focusable="false">
        <defs>
          <linearGradient id="cn-lock-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4A6CF7" />
            <stop offset="55%" stopColor="#7C5CF6" />
            <stop offset="100%" stopColor="#D946EF" />
          </linearGradient>
          <linearGradient id="cn-lock-shackle" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#5C7BFF" />
            <stop offset="100%" stopColor="#A855F7" />
          </linearGradient>
        </defs>

        {/* Shackle */}
        <path
          d="M15 21v-3.5a9 9 0 0 1 18 0V21"
          fill="none"
          stroke="url(#cn-lock-shackle)"
          strokeWidth="4"
          strokeLinecap="round"
        />

        {/* Body */}
        <rect x="8" y="20" width="32" height="22" rx="7" fill="url(#cn-lock-body)" />

        {/* Keyhole */}
        <circle cx="24" cy="29" r="3.1" fill="#FAF8F3" fillOpacity="0.95" />
        <rect x="22.6" y="30.5" width="2.8" height="6" rx="1.4" fill="#FAF8F3" fillOpacity="0.95" />
      </svg>
    </span>
  );
}
