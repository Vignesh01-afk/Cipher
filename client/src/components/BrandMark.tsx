/**
 * The CipherNote brand mark: a flat padlock drawn with two tokens only -
 * var(--color-accent) for the shape and var(--color-surface) for the
 * keyhole. Flat tokens only, no gradients and no image request, so it renders
 * crisply at every size on both themes. Every auth page and both chrome
 * headers use it, so the logo only needs to change in this one component.
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

export default function BrandMark({ size = 'sm', className = '', logoSrc, ...rest }: BrandMarkProps & { logoSrc?: string | null }) {
  // Prefer the uploaded logo tile when present (mockup spec, client/public/logo.png).
  // Fall back to the inline SVG brand mark so the app still works without the file.
  if (logoSrc) {
    return (
      <span className={`brand-logo-tile ${className}`.trim()} {...rest}>
        <img src={logoSrc} alt="CipherNote logo" draggable={false} />
      </span>
    );
  }

  return (
    <span className={`brand-logo-img ${SIZES[size]} ${className}`.trim()} {...rest}>
      <svg viewBox="0 0 48 48" role="img" aria-label="CipherNote logo" focusable="false">
        {/* Shackle */}
        <path
          d="M15 21v-3.5a9 9 0 0 1 18 0V21"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="4"
          strokeLinecap="round"
        />

        {/* Body */}
        <rect x="8" y="20" width="32" height="22" rx="5" fill="var(--color-accent)" />

        {/* Keyhole */}
        <circle cx="24" cy="29" r="3.1" fill="var(--color-surface)" />
        <rect x="22.6" y="30.5" width="2.8" height="6" rx="1.4" fill="var(--color-surface)" />
      </svg>
    </span>
  );
}
