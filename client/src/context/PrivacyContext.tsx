import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthContext';

/**
 * Privacy mode engine.
 *
 * Provides practical, browser-level privacy protections. IMPORTANT HONESTY
 * NOTE: no web application can guarantee 100% prevention of OS-level
 * screenshots, external cameras or dedicated recorders. What we implement:
 *
 *  - Detect getDisplayMedia-based capture of this tab (where supported) and
 *    hide sensitive content while a capture session is live.
 *  - Refuse to initiate screen sharing from CipherNote itself.
 *  - Blur content when the window loses focus.
 *  - Hide content when the tab is hidden (Page Visibility API).
 *  - Screenshot protection: block the PrintScreen / Ctrl(⌘)+P-style save
 *    shortcuts as far as a web page can, blank the clipboard with a notice
 *    when PrintScreen is pressed, and flash-hide sensitive content.
 *  - Optional subtle watermark with the session identity and timestamp.
 *  - Optional auto-lock after inactivity (requires password to resume).
 *
 * All of it is configurable; nothing is claimed to be DRM-level protection.
 */

export interface PrivacySettings {
  /** Master switch for all privacy behaviours. */
  privacyMode: boolean;
  blurOnBlur: boolean;
  hideOnHidden: boolean;
  /** React to getDisplayMedia capture of our tab by hiding content. */
  captureProtection: boolean;
  /**
   * Best-effort screenshot deterrence: intercept print/save shortcuts,
   * overwrite the clipboard on PrintScreen and flash-hide content. A web
   * page cannot defeat OS-level capture - see the honesty note below.
   */
  screenshotProtection: boolean;
  /** Show a subtle identity + timestamp watermark on sensitive screens. */
  watermark: boolean;
  /** Auto-lock timeout in seconds; 0 = never. */
  autoLockSeconds: number;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  privacyMode: true,
  blurOnBlur: true,
  hideOnHidden: true,
  captureProtection: true,
  screenshotProtection: true,
  watermark: false,
  autoLockSeconds: 900, // 15 minutes
};

export const AUTO_LOCK_OPTIONS = [
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 900, label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 0, label: 'Never' },
] as const;

interface PrivacyContextValue {
  settings: PrivacySettings;
  updateSettings: (patch: Partial<PrivacySettings>) => void;
  /** True while content should be visually protected right now. */
  protected: boolean;
  /** Why protection is currently active (for the overlay text). */
  reason: 'blur' | 'hidden' | 'capture' | null;
  /** A capture session is (or was) actively sharing this tab. */
  captureActive: boolean;
  /** True while a screenshot attempt was just intercepted (flash overlay). */
  screenshotAttempt: boolean;
  /** True while the auto-lock screen is showing. */
  locked: boolean;
  dismissLock: () => void;
}

const STORAGE_KEY = 'ciphernote.privacy';

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

function loadSettings(): PrivacySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PRIVACY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<PrivacySettings>;
    return { ...DEFAULT_PRIVACY_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_PRIVACY_SETTINGS;
  }
}

/**
 * Installs the best-effort screenshot deterrence listeners. Returns cleanup.
 *
 * What this CAN do inside a browser sandbox:
 *  - swallow PrintScreen, Ctrl/Cmd+P, Ctrl/Cmd+S and Ctrl/Cmd+Shift+S so the
 *    obvious shortcuts do nothing inside this tab;
 *  - overwrite the clipboard with a notice when PrintScreen is pressed
 *    (defeats the paste-screenshot habit on Windows);
 *  - flash a full-screen cover for a moment so shoulder-surfers/cameras see
 *    nothing but the warning.
 * What it CANNOT do (a web page has no such power):
 *  - stop the OS screenshot tools (Win+Shift+S, Snipping Tool, macOS
 *    Shift+Cmd+3/4/5), which never pass through the page at all;
 *  - detect or prevent a phone photographing the screen.
 */
function installScreenshotWatch(
  onAttempt: (active: boolean) => void,
): () => void {
  const FLASH_MS = 1200;
  let flashTimer: number | undefined;

  const flash = (): void => {
    onAttempt(true);
    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => onAttempt(false), FLASH_MS);
  };

  const overwriteClipboard = (): void => {
    try {
      void navigator.clipboard.writeText(
        'Screenshots of CipherNote content are not permitted.',
      );
    } catch {
      /* clipboard permission missing - the key was still swallowed */
    }
  };

  function onKeyDown(event: KeyboardEvent): void {
    const key = event.key;
    const lower = key.toLowerCase();

    // PrintScreen (and its Shift/Alt variants).
    if (key === 'PrintScreen') {
      event.preventDefault();
      overwriteClipboard();
      flash();
      return;
    }

    const mod = event.ctrlKey || event.metaKey;

    // Ctrl/Cmd+P (print), Ctrl/Cmd+S / +Shift+S (save page).
    if (mod && (lower === 'p' || lower === 's')) {
      event.preventDefault();
      flash();
      return;
    }

    // Ctrl/Cmd+Shift+S is covered above; Win/Meta+S opens search on Windows
    // and is not a capture path, so it is left alone.
  }

  window.addEventListener('keydown', onKeyDown, true);

  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.clearTimeout(flashTimer);
  };
}

/** Registers a getDisplayMedia interceptor. Returns a cleanup function. */
function installCaptureWatch(onCaptureChange: (active: boolean) => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return () => undefined;

  const media = navigator.mediaDevices as MediaDevices & {
    getDisplayMedia?: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
  };

  if (typeof media.getDisplayMedia !== 'function') return () => undefined;

  const original = media.getDisplayMedia.bind(media);

  media.getDisplayMedia = (async (constraints?: DisplayMediaStreamOptions) => {
    // CipherNote never initiates screen sharing: any call made from our own
    // pages would be an anomaly, but an extension or injected script could
    // still trigger it. We monitor instead of blocking the browser itself,
    // because a web page cannot revoke the browser's own screen-capture UI.
    const stream = await original(constraints);
    onCaptureChange(true);

    stream.getVideoTracks().forEach((track) => {
      const reportEnd = (): void => onCaptureChange(false);
      track.addEventListener('ended', reportEnd);
      track.addEventListener('mute', reportEnd);
    });

    return stream;
  }) as typeof media.getDisplayMedia;

  return () => {
    media.getDisplayMedia = original;
  };
}

export function PrivacyProvider({ children }: { children: ReactNode }): JSX.Element {
  const [settings, setSettings] = useState<PrivacySettings>(loadSettings);
  const [windowBlurred, setWindowBlurred] = useState(false);
  const [tabHidden, setTabHidden] = useState(
    typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false,
  );
  const [captureActive, setCaptureActive] = useState(false);
  const [screenshotAttempt, setScreenshotAttempt] = useState(false);
  const [autoLockArmed, setAutoLockArmed] = useState(false);
  const { status, lock } = useAuth();

  // Persist settings (non-sensitive UI preferences only).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable */
    }
  }, [settings]);

  const updateSettings = useCallback((patch: Partial<PrivacySettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  // --- Window focus / blur ---------------------------------------------------
  useEffect(() => {
    function onFocus(): void {
      setWindowBlurred(false);
    }
    function onBlur(): void {
      setWindowBlurred(true);
    }
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // --- Tab visibility (Page Visibility API) ----------------------------------
  useEffect(() => {
    function onVisibility(): void {
      setTabHidden(document.visibilityState === 'hidden');
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // --- Display capture watch -------------------------------------------------
  useEffect(() => {
    if (!settings.privacyMode || !settings.captureProtection) return undefined;
    return installCaptureWatch(setCaptureActive);
  }, [settings.privacyMode, settings.captureProtection]);

  // --- Screenshot deterrence --------------------------------------------------
  useEffect(() => {
    if (!settings.privacyMode || !settings.screenshotProtection) return undefined;
    return installScreenshotWatch(setScreenshotAttempt);
  }, [settings.privacyMode, settings.screenshotProtection]);

  // --- Auto-lock timer ---------------------------------------------------------
  const lastActivity = useRef(Date.now());
  const lockRef = useRef(lock);
  lockRef.current = lock;

  useEffect(() => {
    function markActivity(): void {
      lastActivity.current = Date.now();
    }
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((event) => window.addEventListener(event, markActivity, { passive: true }));
    return () => {
      events.forEach((event) => window.removeEventListener(event, markActivity));
    };
  }, []);

  useEffect(() => {
    if (!settings.privacyMode || settings.autoLockSeconds === 0) {
      setAutoLockArmed(false);
      return undefined;
    }
    if (status !== 'unlocked') return undefined;

    // The idle clock starts when the vault unlocks, not when the provider
    // mounted - otherwise a page reload (restore -> locked -> unlock) would
    // inherit idle time from before the unlock and instantly re-lock.
    lastActivity.current = Date.now();

    const interval = window.setInterval(() => {
      const idleFor = (Date.now() - lastActivity.current) / 1000;
      setAutoLockArmed(idleFor >= settings.autoLockSeconds);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [settings.privacyMode, settings.autoLockSeconds, status]);

  // Auto-lock only affects unlocked sessions: locking drops in-memory keys.
  useEffect(() => {
    if (autoLockArmed && status === 'unlocked') {
      lockRef.current();
      setAutoLockArmed(false);
    }
  }, [autoLockArmed, status]);

  const locked = autoLockArmed && status === 'unlocked';

  // --- Derived protection state ------------------------------------------------
  const protectedActive = settings.privacyMode && (windowBlurred || tabHidden || captureActive);
  const reason: PrivacyContextValue['reason'] = captureActive
    ? 'capture'
    : tabHidden
      ? 'hidden'
      : windowBlurred
        ? 'blur'
        : null;

  const dismissLock = useCallback(() => setAutoLockArmed(false), []);

  const value = useMemo<PrivacyContextValue>(
    () => ({
      settings,
      updateSettings,
      protected: protectedActive,
      reason,
      captureActive,
      screenshotAttempt,
      locked,
      dismissLock,
    }),
    [
      settings,
      updateSettings,
      protectedActive,
      reason,
      captureActive,
      screenshotAttempt,
      locked,
      dismissLock,
    ],
  );

  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  const context = useContext(PrivacyContext);
  if (!context) {
    throw new Error('usePrivacy must be used inside a PrivacyProvider');
  }
  return context;
}

/** Watermark text for the current session. */
export function watermarkText(email: string | undefined): string {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  return email ? `${email} · ${stamp} UTC` : `${stamp} UTC`;
}
