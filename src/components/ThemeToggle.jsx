import { useEffect, useState } from 'react';
import { getEffectiveTheme, setTheme, THEME_EVENT } from '../utils/theme';

// Segmented light/dark switch for the sidebar footer.
const ThemeToggle = () => {
  const [theme, setThemeState] = useState(getEffectiveTheme());

  useEffect(() => {
    const sync = () => setThemeState(getEffectiveTheme());
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const choose = (next) => {
    setTheme(next);
    setThemeState(next);
  };

  return (
    <div className="flex items-center rounded-full bg-gray-100 dark:bg-slate-700 p-0.5 text-xs font-semibold">
      <button
        type="button"
        onClick={() => choose('light')}
        aria-pressed={theme === 'light'}
        className={`flex-1 flex items-center justify-center gap-1 rounded-full px-2 py-1 transition ${
          theme === 'light' ? 'bg-white text-amber-600 shadow-sm' : 'text-gray-500 dark:text-slate-300'
        }`}
      >
        ☀️ Light
      </button>
      <button
        type="button"
        onClick={() => choose('dark')}
        aria-pressed={theme === 'dark'}
        className={`flex-1 flex items-center justify-center gap-1 rounded-full px-2 py-1 transition ${
          theme === 'dark' ? 'bg-slate-800 text-indigo-300 shadow-sm' : 'text-gray-500 dark:text-slate-300'
        }`}
      >
        🌙 Dark
      </button>
    </div>
  );
};

export default ThemeToggle;
