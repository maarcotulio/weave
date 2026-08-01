export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'weave.theme';
export const DEFAULT_THEME: Theme = 'light';

export function isTheme(value: string | null | undefined): value is Theme {
  return value === 'light' || value === 'dark';
}

function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readStoredTheme(storage: Pick<Storage, 'getItem'> | undefined = browserStorage()): Theme {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function persistTheme(theme: Theme, storage: Pick<Storage, 'setItem'> | undefined = browserStorage()): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // A locked-down browser or desktop webview may not provide writable storage.
  }
}

export function toggleTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

export function applyTheme(theme: Theme, root?: Pick<HTMLElement, 'dataset'>): void {
  const target = root ?? (typeof document !== 'undefined' ? document.documentElement : undefined);
  if (!target) return;
  target.dataset.theme = theme;
  if (typeof document !== 'undefined') {
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#17150f' : '#f4f1eb');
  }
}
