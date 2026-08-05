import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import QuotaMeter from './QuotaMeter';
import ThemeToggle from './ThemeToggle';
import LanguageSwitcher from './LanguageSwitcher';

// Desktop-only top bar holding the app controls (theme, language, quota, logout)
// so the sidebar rail stays a clean, non-scrolling nav list. Hidden on mobile,
// where these live in the slide-out sidebar footer.
const TopBar = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  return (
    <div className="hidden lg:flex sticky top-0 z-30 h-14 items-center justify-end gap-3 border-b border-gray-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 backdrop-blur px-6">
      <QuotaMeter compact />
      <div className="w-40">
        <ThemeToggle />
      </div>
      <LanguageSwitcher />
      <button
        onClick={handleLogout}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
      >
        <span>🚪</span>
        <span className="hidden sm:inline">Logout</span>
      </button>
    </div>
  );
};

export default TopBar;
