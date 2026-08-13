// Global light/dark theme. The preference is one of three values, but the
// *resolved* theme (never "system") is what gets stamped on <html data-theme>,
// so styles.css needs a single `[data-theme='dark']` block rather than the
// usual media-query/attribute duplication. "system" is re-resolved whenever the
// OS preference flips.

export type Theme = 'system' | 'light' | 'dark';
export type Resolved = 'light' | 'dark';

const KEY = 'jse.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export const THEME_ORDER: Theme[] = ['system', 'light', 'dark'];

export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'system' || v === 'light' || v === 'dark') return v;
  } catch {
    /* storage unavailable (private mode) — fall back to system */
  }
  return 'system';
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* preference just won't survive a reload */
  }
}

export function resolveTheme(theme: Theme): Resolved {
  if (theme !== 'system') return theme;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/** stamp the resolved theme on <html>; also drives UA colors (scrollbars, form controls) */
export function applyResolved(resolved: Resolved): void {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

/** subscribe to OS preference changes; returns an unsubscribe */
export function onSystemThemeChange(cb: () => void): () => void {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
