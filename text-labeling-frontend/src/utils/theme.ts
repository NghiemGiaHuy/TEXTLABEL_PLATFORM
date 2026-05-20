export type UiTheme = 'light' | 'dark';

export function normalizeUiTheme(value: unknown): UiTheme {
  return value === 'dark' ? 'dark' : 'light';
}

export function getStoredUiTheme(): UiTheme {
  try {
    const raw = localStorage.getItem('settings_ui');
    const parsed = raw ? JSON.parse(raw) : null;
    return normalizeUiTheme(parsed?.theme);
  } catch {
    return 'light';
  }
}

export function applyUiTheme(theme: UiTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function initializeUiTheme() {
  applyUiTheme(getStoredUiTheme());
}
