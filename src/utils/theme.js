// Simple light/dark theme manager. Persists the choice in localStorage and
// toggles a `dark` class on <html> (Tailwind darkMode: 'class'). Falls back to
// the OS preference when the user hasn't chosen yet.

const KEY = 'callvia_theme';
export const THEME_EVENT = 'callvia-theme-changed';

export const getStoredTheme = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const getEffectiveTheme = () => {
  const stored = getStoredTheme();
  if (stored === 'dark' || stored === 'light') return stored;
  // Default to light when the user hasn't explicitly chosen. We intentionally do
  // NOT auto-follow the OS dark preference: the tenant portal (a separate origin
  // with no theme toggle) would otherwise get stuck in dark mode with no way to
  // switch. Admins opt into dark via the top-bar toggle, which persists here.
  return 'light';
};

export const applyTheme = (theme) => {
  const isDark = theme === 'dark';
  try {
    document.documentElement.classList.toggle('dark', isDark);
  } catch {
    /* no document */
  }
};

export const setTheme = (theme) => {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable */
  }
  applyTheme(theme);
  try {
    window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
  } catch {
    /* no window */
  }
};

// Apply the persisted/OS theme immediately on load.
export const initTheme = () => {
  applyTheme(getEffectiveTheme());
};
