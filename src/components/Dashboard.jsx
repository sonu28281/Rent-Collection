import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

const Dashboard = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="p-4 lg:p-8">
      {/* Welcome Header */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">
          Welcome Back, Admin! 👋
        </h2>
        <p className="text-gray-600">
          Logged in as: <span className="font-semibold">{currentUser?.email}</span>
        </p>
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
      <div className="card mb-8">
        <h3 className="text-xl font-semibold text-gray-800 mb-4">
          Quick Actions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button 
            onClick={() => navigate('/tenants')}
            className="btn-primary flex items-center justify-center space-x-2"
          >
            <span>➕</span>
            <span>Add New Tenant</span>
          </button>
          <button 
            onClick={() => navigate('/electricity')}
            className="btn-primary flex items-center justify-center space-x-2"
          >
            <span>⚡</span>
            <span>Record Electricity</span>
          </button>
          <button 
            onClick={() => navigate('/payments')}
            className="btn-primary flex items-center justify-center space-x-2"
          >
            <span>💳</span>
            <span>Record Payment</span>
          </button>
        </div>
      </div>

      {/* Phase Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card bg-green-50 border border-green-200">
          <h3 className="text-lg font-semibold text-green-800 mb-2">
            ✅ Phase 1: Complete
          </h3>
          <ul className="text-sm text-green-700 space-y-1">
            <li>✓ React + Vite + Tailwind setup</li>
            <li>✓ Firebase initialized</li>
            <li>✓ Secured admin login</li>
            <li>✓ Password reset functionality</li>
            <li>✓ Protected routes</li>
          </ul>
        </div>
        <div className="card bg-blue-50 border border-blue-200">
          <h3 className="text-lg font-semibold text-blue-800 mb-2">
            🔄 Phase 2: In Progress
          </h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>✓ Room seeding script created</li>
            <li>✓ Rooms UI component</li>
            <li>✓ Sidebar navigation</li>
            <li>⏳ Firestore rules setup needed</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
