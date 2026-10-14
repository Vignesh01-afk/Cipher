import type { ReactNode } from 'react';
import { Camera, Monitor, ShieldWarning } from '@phosphor-icons/react';
import { usePrivacy, watermarkText } from '../context/PrivacyContext';
import { useAuth } from '../context/AuthContext';

/**
 * Privacy shield rendered above the app while content should be protected.
 *
 * Layers:
 *  - Full-screen opaque cover when the tab is hidden or capture is active
 *    (invisible to the user in the hidden case, but covers screen sharing).
 *  - A plain, non-blurred hidden layer when only the window lost focus.
 *  - A clear warning banner when capture is detected.
 *  - Optional subtle watermark with session identity and timestamp.
 *
 * Honest scope: this protects against casual observation and getDisplayMedia
 * sharing of the tab. It cannot stop OS screenshots, phone photos or hardware
 * recorders - the UI copy says so in the privacy settings page.
 */
export function PrivacyShield({ children }: { children: ReactNode }): React.ReactElement {
  const privacy = usePrivacy();
  const { user } = useAuth();

  const capture = privacy.protected && privacy.reason === 'capture';
  const blur = privacy.protected && privacy.reason === 'blur';

  return (
    <div className="relative min-h-screen bg-page">
      {/* Content layer - mounted even while protected, so state is not lost. */}
      <div aria-hidden={privacy.protected} className={blur ? 'min-h-screen select-none invisible' : 'min-h-screen'}>
        {children}
      </div>

      {/* Screenshot-attempt flash: covers the screen for ~1s. */}
      {privacy.screenshotAttempt ? (
        <div className="fixed inset-0 z-[75] flex flex-col items-center justify-center gap-4 bg-scrim text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-md bg-danger/10 text-danger">
            <Camera className="h-7 w-7" />
          </span>
          <p className="max-w-md px-6 text-base font-semibold text-stone-100">
            Screenshot blocked
          </p>
          <p className="max-w-md px-6 text-xs leading-5 text-stone-400">
            Screen capture of CipherNote content is not permitted. The clipboard was overwritten.
          </p>
        </div>
      ) : null}

      {/* Opaque cover for hidden-tab / capture cases. */}
      {privacy.protected && privacy.reason !== 'blur' ? (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-stone-950 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-md bg-rose-500/10 text-rose-400">
            {capture ? <Monitor className="h-7 w-7" /> : <ShieldWarning className="h-7 w-7" />}
          </span>
          <p className="max-w-md px-6 text-base font-semibold text-stone-100">
            {capture
              ? 'Screen sharing detected. Sensitive content has been hidden for your protection.'
              : 'Content hidden while this tab is in the background.'}
          </p>
          <p className="max-w-md px-6 text-xs leading-5 text-stone-400">
            Content will reappear automatically when it is safe again.
          </p>
        </div>
      ) : null}

      {/* Watermark - subtle, non-interactive, never intercepts clicks. */}
      {privacy.settings.privacyMode && privacy.settings.watermark ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed bottom-3 right-4 z-[65] select-none font-mono text-[10px] tracking-wide text-stone-500/50 dark:text-stone-400/40"
        >
          {watermarkText(user?.email)}
        </div>
      ) : null}
    </div>
  );
}
