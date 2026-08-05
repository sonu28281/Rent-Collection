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
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
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
