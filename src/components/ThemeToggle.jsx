import { useEffect, useState } from 'react';
import { getEffectiveTheme, setTheme, THEME_EVENT } from '../utils/theme';

// Single toggle button: in light mode it offers "Dark", in dark mode it offers
// "Light" — only the mode you can switch TO is shown.
const ThemeToggle = () => {
  const [theme, setThemeState] = useState(getEffectiveTheme());

  useEffect(() => {
    const sync = () => setThemeState(getEffectiveTheme());
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const isDark = theme === 'dark';
  const toggle = () => {
    const next = isDark ? 'light' : 'dark';
    setTheme(next);
    setThemeState(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-slate-600 bg-gray-100 dark:bg-slate-700 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-600 transition"
    >
      {isDark ? <>☀️ <span>Light</span></> : <>🌙 <span>Dark</span></>}
    </button>
  );
};

export default ThemeToggle;
