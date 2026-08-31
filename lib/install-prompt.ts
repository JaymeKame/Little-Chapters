const DISMISSED_KEY = 'little-chapters-install-dismissed-at';
const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function isIOSSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function shouldShowInstallPrompt(now = Date.now()): boolean {
  if (typeof localStorage === 'undefined' || isStandalone() || !isIOSSafari()) return false;
  const dismissed = Number(localStorage.getItem(DISMISSED_KEY) ?? 0);
  return !dismissed || now - dismissed >= DISMISS_MS;
}

export function dismissInstallPrompt(now = Date.now()): void {
  localStorage.setItem(DISMISSED_KEY, String(now));
}
