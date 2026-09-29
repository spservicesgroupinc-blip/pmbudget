import React, { useCallback, useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share, SquarePlus, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const IOS_HINT_DISMISSED_KEY = 'hays.sons.pwa.iosHintDismissed';

const isStandaloneMode = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIOSDevice = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * PWA install experience for the header.
 * Desktop Chrome/Edge: an Install button that fires the deferred
 * `beforeinstallprompt` event. iOS Safari (no install API): a
 * "Share -> Add to Home Screen" hint sheet. Renders nothing when the app
 * is already running standalone.
 */
export const InstallPwa: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const titleId = useId();

  const isStandalone = isStandaloneMode();
  const isIOS = isIOSDevice();

  // Desktop: stash the deferred prompt so our button can trigger it later.
  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  // iOS: auto-show the hint sheet once, unless it was dismissed before.
  useEffect(() => {
    if (isStandalone || !isIOS) return;
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(IOS_HINT_DISMISSED_KEY) === '1';
    } catch {
      dismissed = false;
    }
    if (dismissed) return;
    const timer = window.setTimeout(() => setSheetOpen(true), 1200);
    return () => window.clearTimeout(timer);
  }, [isIOS, isStandalone]);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    try {
      window.localStorage.setItem(IOS_HINT_DISMISSED_KEY, '1');
    } catch {
      // Private browsing can block localStorage; the sheet still closes.
    }
  }, []);

  // While the sheet is open, Escape closes it.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSheet();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sheetOpen, closeSheet]);

  // While the sheet is open, the page behind it can't scroll.
  useEffect(() => {
    if (!sheetOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sheetOpen]);

  if (isStandalone) return null;

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      // The prompt event is single-use, so drop it after the user chooses
      // (accepted or dismissed); Chrome/Edge may fire a fresh event later.
      setDeferredPrompt(null);
      return;
    }
    if (isIOS) setSheetOpen(true);
  };

  const showInstallButton = deferredPrompt !== null || isIOS;

  return (
    <>
      {showInstallButton && (
        <button
          type="button"
          onClick={handleInstallClick}
          title="Install this app"
          aria-label="Install App"
          className="inline-flex items-center gap-2 h-9 px-3 rounded-lg border border-slate-300 bg-white text-[12px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-2xs focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
        >
          <Download className="w-4 h-4" />
          <span className="hidden sm:inline">Install App</span>
        </button>
      )}

      {sheetOpen &&
        createPortal(
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center"
          onClick={closeSheet}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
            className="relative w-full sm:max-w-sm sm:mx-auto bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-xl"
          >
            <button
              type="button"
              onClick={closeSheet}
              aria-label="Close install instructions"
              className="absolute top-3.5 right-3.5 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <h3
              id={titleId}
              className="text-[15px] font-semibold tracking-tight text-slate-900 pr-8"
            >
              Install Hays + Sons
            </h3>
            <p className="mt-1 text-[12px] text-slate-500 leading-relaxed">
              Runs full-screen like a native app, with quick access from your
              Home Screen.
            </p>

            <ol className="mt-4 space-y-3">
              <li className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex items-center justify-center w-5 h-5 rounded-full bg-red-50 text-red-700 text-[11px] font-bold shrink-0"
                >
                  1
                </span>
                <p className="text-[12px] text-slate-700 leading-relaxed">
                  Tap the{' '}
                  <Share
                    aria-hidden="true"
                    className="inline-block w-4 h-4 align-text-bottom text-slate-500"
                  />{' '}
                  Share icon in Safari's toolbar.
                </p>
              </li>
              <li className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex items-center justify-center w-5 h-5 rounded-full bg-red-50 text-red-700 text-[11px] font-bold shrink-0"
                >
                  2
                </span>
                <p className="text-[12px] text-slate-700 leading-relaxed">
                  Scroll and tap{' '}
                  <SquarePlus
                    aria-hidden="true"
                    className="inline-block w-4 h-4 align-text-bottom text-slate-500"
                  />{' '}
                  &quot;Add to Home Screen&quot;.
                </p>
              </li>
              <li className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex items-center justify-center w-5 h-5 rounded-full bg-red-50 text-red-700 text-[11px] font-bold shrink-0"
                >
                  3
                </span>
                <p className="text-[12px] text-slate-700 leading-relaxed">
                  Tap &quot;Add&quot; — it launches full-screen like a native
                  app.
                </p>
              </li>
            </ol>
          </div>
        </div>,
          document.body,
        )}
    </>
  );
};
