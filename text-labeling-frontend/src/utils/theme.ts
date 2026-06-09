export type UiTheme = 'light';

export function normalizeUiTheme(): UiTheme {
  return 'light';
}

export function getStoredUiTheme(): UiTheme {
  return 'light';
}

export function applyUiTheme() {
  document.documentElement.classList.remove('dark');
}

export function initializeUiTheme() {
  applyUiTheme();
}
