import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

// Top-bar user chip: shows the signed-in email and opens a dropdown with Logout.
const UserMenu = () => {
  const { currentUser, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const email = currentUser?.email || 'Admin';
  const initial = (email[0] || 'A').toUpperCase();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-700 pl-1 pr-2 py-1 hover:bg-gray-50 dark:hover:bg-slate-600 transition"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-white text-xs font-bold">{initial}</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-200 max-w-[170px] truncate hidden md:inline">{email}</span>
        <span className={`text-gray-400 text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1 z-50">
          <div className="px-4 py-2 border-b border-gray-100 dark:border-slate-700">
            <p className="text-xs text-gray-500 dark:text-slate-400">Signed in as</p>
            <p className="text-sm font-semibold text-gray-800 dark:text-slate-100 truncate">{email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-4 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition"
          >
            🚪 Logout
          </button>
        </div>
      )}
    </div>
  );
};

export default UserMenu;
