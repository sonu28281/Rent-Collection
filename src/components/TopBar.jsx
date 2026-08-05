import QuotaMeter from './QuotaMeter';
import ThemeToggle from './ThemeToggle';
import LanguageSwitcher from './LanguageSwitcher';
import UserMenu from './UserMenu';
import CollectionProgressPill from './CollectionProgressPill';

// Desktop-only top bar. Left: this month's collection progress. Right: reads
// meter, theme toggle, language, and the user menu (email + logout). Keeps the
// sidebar rail a clean, non-scrolling nav list.
const TopBar = () => {
  return (
    <div className="hidden lg:flex sticky top-0 z-30 h-14 items-center justify-between gap-3 border-b border-gray-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 backdrop-blur px-6">
      <CollectionProgressPill />
      <div className="flex items-center gap-3 ml-auto">
        <QuotaMeter compact />
        <ThemeToggle />
        <LanguageSwitcher />
        <UserMenu />
      </div>
    </div>
  );
};

export default TopBar;
