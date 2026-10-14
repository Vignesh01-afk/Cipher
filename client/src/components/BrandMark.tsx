/**
 * The CipherNote brand mark. Exactly ONE logo asset exists in the project -
 * client/public/logo.png - and this component is its single render point:
 * the sidebar, the auth pages (login, register, forgot, unlock, google),
 * and the landing header/hero all use <BrandMark />.
 */

const SIZES = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-16 w-16',
} as const;

type BrandMarkProps = {
  /** 'lg' for auth pages and the landing hero, 'md' for panels, 'sm' for headers. */
  size?: keyof typeof SIZES;
  className?: string;
  /** Set on purely decorative marks (headers) so screen readers skip it. */
  'aria-hidden'?: boolean | 'true' | 'false';
};

export default function BrandMark({ size = 'sm', className = '', ...rest }: BrandMarkProps) {
  return (
    <span className={`brand-logo-tile ${SIZES[size]} ${className}`.trim()} {...rest}>
      <img src="/logo.png" alt="CipherNote logo" draggable={false} />
    </span>
  );
}
