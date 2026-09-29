// PWA bootstrap: registers the service worker and handles the update flow.
// The worker itself (precache + fetch routing) lives in public/sw.js.

/**
 * Registers the app-shell service worker. No-op where unsupported.
 *
 * The worker is registered after the window 'load' event so it never competes
 * with the initial page load.
 *
 * Update flow: when an updated worker takes control of a page that already had
 * a controller, the page reloads once to pick up the new assets. A first-time
 * install (no previous controller) never triggers a surprise reload.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  // Capture the pre-registration state: a brand-new install has no controller,
  // so it must not auto-reload after the worker activates.
  const hadController = Boolean(navigator.serviceWorker.controller);

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload when an update replaced an existing controller,
    // and guard against firing twice.
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[pwa] Service worker registration failed', err);
    });
  });
}
