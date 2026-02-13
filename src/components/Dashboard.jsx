import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';

const Dashboard = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">
                Autoxweb Rent Management
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                👤 {currentUser?.email}
              </span>
              <button
                onClick={handleLogout}
                className="btn-secondary"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome Back, Admin! 👋
          </h2>
          <p className="text-gray-600">
            Manage your 12-room lodge efficiently
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm">Total Rooms</p>
                <p className="text-3xl font-bold mt-1">12</p>
              </div>
              <div className="text-4xl">🏠</div>
            </div>
          </div>

          <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm">Active Tenants</p>
                <p className="text-3xl font-bold mt-1">0</p>
              </div>
              <div className="text-4xl">👥</div>
            </div>
          </div>

          <div className="card bg-gradient-to-br from-yellow-500 to-yellow-600 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-yellow-100 text-sm">Pending Payments</p>
                <p className="text-3xl font-bold mt-1">0</p>
              </div>
              <div className="text-4xl">💰</div>
            </div>
          </div>

          <div className="card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm">This Month</p>
                <p className="text-3xl font-bold mt-1">₹0</p>
              </div>
              <div className="text-4xl">📊</div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">
            Quick Actions
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button className="btn-primary flex items-center justify-center space-x-2">
              <span>➕</span>
              <span>Add New Tenant</span>
            </button>
            <button className="btn-primary flex items-center justify-center space-x-2">
              <span>⚡</span>
              <span>Record Electricity</span>
            </button>
            <button className="btn-primary flex items-center justify-center space-x-2">
              <span>💳</span>
              <span>Record Payment</span>
            </button>
          </div>
        </div>

        {/* Phase 1 Status */}
        <div className="mt-8 card bg-green-50 border border-green-200">
          <h3 className="text-lg font-semibold text-green-800 mb-2">
            ✅ Phase 1: Complete
          </h3>
          <ul className="text-sm text-green-700 space-y-1">
            <li>✓ React + Vite + Tailwind setup</li>
            <li>✓ Firebase initialized</li>
            <li>✓ Secured admin login (only sonu28281@gmail.com)</li>
            <li>✓ Password reset functionality</li>
            <li>✓ Protected routes</li>
          </ul>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
