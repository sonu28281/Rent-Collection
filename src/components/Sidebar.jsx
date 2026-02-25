import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import LanguageSwitcher from './LanguageSwitcher';

const Sidebar = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();

  // Main menu items
  const menuItems = [
    { icon: '📊', label: 'Dashboard', path: '/dashboard' },
    { icon: '👥', label: 'Tenants', path: '/tenants' },
    { icon: '🏠', label: 'Rooms', path: '/rooms' },
    { icon: '⚡', label: 'Electricity', path: '/electricity' },
    { icon: '📈', label: 'Rent Increase', path: '/rent-increase' },
    { icon: '💳', label: 'Payments', path: '/payments' },
    { icon: '🔧', label: 'Maintenance', path: '/maintenance' },
    { icon: '📥', label: 'Import CSV', path: '/import' },
    { icon: '📚', label: 'History Manager', path: '/history' },
    { icon: '📊', label: 'Financial History', path: '/financial-history' },
    { icon: '🏠', label: 'Room History', path: '/room-history' },
    { icon: '👤', label: 'Tenant History', path: '/tenant-history' },
    { icon: '📉', label: 'Vacancy Report', path: '/vacancy-report' },
  ];

  // Settings submenu items
  const settingsItems = [
    { icon: '⚙️', label: 'General Settings', path: '/settings' },
    { icon: '🏦', label: 'Bank Accounts', path: '/bank-accounts' },
    { icon: '💾', label: 'Backup & Export', path: '/backup' },
    { icon: '📋', label: 'Import Logs', path: '/import-logs' },
    { icon: '�', label: 'Setup 2026 Tenants', path: '/setup-2026' },
    { icon: '�🚨', label: 'Payments Reset', path: '/payments-reset' },
    { icon: '🗑️', label: 'Database Cleanup', path: '/database-cleanup' },
  ];

  const handleNavigation = (path) => {
    navigate(path);
    setIsMobileMenuOpen(false);
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const isActive = (path) => {
    return location.pathname === path;
  };

  const isSettingsActive = () => {
    return settingsItems.some(item => item.path === location.pathname);
  };

  return (
    <>
      {/* Mobile Header with Hamburger */}
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-40 h-16 flex items-center px-4">
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 rounded-lg hover:bg-gray-100 transition"
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isMobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
        <h1 className="ml-4 text-lg font-bold text-gray-800">Autoxweb Rent</h1>
      </div>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-full bg-white border-r border-gray-200 z-50
          transition-transform duration-300 ease-in-out
          w-64 lg:w-240
          flex flex-col
          ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Logo/Header */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-gray-200 flex-shrink-0">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Autoxweb</h1>
            <p className="text-xs text-gray-500">Rent Management</p>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="lg:hidden p-1 rounded hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation Menu - Scrollable */}
        <nav className="flex-1 overflow-y-auto py-2">
          {/* Main Menu Items */}
          {menuItems.map((item) => (
            <button
              key={item.path}
              onClick={() => handleNavigation(item.path)}
              className={`
                w-full flex items-center px-6 py-1.5 text-left transition
                ${isActive(item.path)
                  ? 'bg-primary text-white font-semibold'
                  : 'text-gray-700 hover:bg-gray-100'
                }
              `}
            >
              <span className="text-xl mr-3">{item.icon}</span>
              <span className="text-sm">{item.label}</span>
            </button>
          ))}

          {/* Settings Dropdown */}
          <div>
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`
                w-full flex items-center justify-between px-6 py-1.5 text-left transition
                ${isSettingsActive()
                  ? 'bg-primary text-white font-semibold'
                  : 'text-gray-700 hover:bg-gray-100'
                }
              `}
            >
              <div className="flex items-center">
                <span className="text-xl mr-3">⚙️</span>
                <span className="text-sm">Settings & Tools</span>
              </div>
              <svg 
                className={`w-4 h-4 transition-transform ${isSettingsOpen ? 'rotate-180' : ''}`}
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Settings Submenu */}
            {isSettingsOpen && (
              <div className="bg-gray-50">
                {settingsItems.map((item) => (
                  <button
                    key={item.path}
                    onClick={() => handleNavigation(item.path)}
                    className={`
                      w-full flex items-center px-10 py-1.5 text-left transition
                      ${isActive(item.path)
                        ? 'bg-primary text-white font-semibold'
                        : 'text-gray-600 hover:bg-gray-200'
                      }
                    `}
                  >
                    <span className="text-lg mr-2">{item.icon}</span>
                    <span className="text-xs">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* Logout Button - Fixed at bottom of menu */}
        <div className="flex-shrink-0 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className="w-full flex items-center px-6 py-2 text-left transition text-red-600 hover:bg-red-50"
          >
            <span className="text-xl mr-3">🚪</span>
            <span className="text-sm font-semibold">Logout</span>
          </button>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex-shrink-0">
          <div className="mb-3">
            <LanguageSwitcher />
          </div>
          <div className="text-xs text-gray-500 text-center">
            <p>v1.0.0</p>
            <p>© 2026 Autoxweb</p>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
