import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { getDashboardStats, getYearlyIncomeSummary, getMonthlyIncomeByYear } from '../utils/financial';

const Dashboard = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    activeTenants: 0,
    pendingPayments: 0,
    currentMonthIncome: 0,
    totalIncome: 0,
    occupancy: { occupied: 0, vacant: 12, rate: '0.0' }
  });
  const [yearlyData, setYearlyData] = useState([]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [monthlyData, setMonthlyData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (selectedYear) {
      fetchMonthlyData(selectedYear);
    }
  }, [selectedYear]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [statsData, yearlyIncome] = await Promise.all([
        getDashboardStats(),
        getYearlyIncomeSummary()
      ]);
      
      setStats(statsData);
      setYearlyData(yearlyIncome);
      
      // Set selected year to current or latest year with data
      if (yearlyIncome.length > 0) {
        const latestYear = yearlyIncome[0].year;
        setSelectedYear(latestYear);
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setLoading(false);
    }
  };

  const fetchMonthlyData = async (year) => {
    try {
      const data = await getMonthlyIncomeByYear(year);
      setMonthlyData(data);
    } catch (error) {
      console.error('Error fetching monthly data:', error);
    }
  };

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
              <p className="text-blue-100 text-xs mt-1">
                {loading ? '...' : `${stats.occupancy.occupied} occupied`}
              </p>
            </div>
            <div className="text-4xl">🏠</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">Active Tenants</p>
              <p className="text-3xl font-bold mt-1">
                {loading ? '...' : stats.activeTenants}
              </p>
              <p className="text-green-100 text-xs mt-1">
                {loading ? '...' : `${stats.occupancy.rate}% occupancy`}
              </p>
            </div>
            <div className="text-4xl">👥</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-yellow-500 to-yellow-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-yellow-100 text-sm">Pending Payments</p>
              <p className="text-3xl font-bold mt-1">
                {loading ? '...' : stats.pendingPayments}
              </p>
              <p className="text-yellow-100 text-xs mt-1">Due this month</p>
            </div>
            <div className="text-4xl">💰</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm">This Month</p>
              <p className="text-3xl font-bold mt-1">
                {loading ? '...' : `₹${stats.currentMonthIncome.toLocaleString('en-IN')}`}
              </p>
              <p className="text-purple-100 text-xs mt-1">Collected</p>
            </div>
            <div className="text-4xl">📊</div>
          </div>
        </div>
      </div>

      {/* Financial Summary */}
      <div className="mb-8">
        <div className="card">
          <h3 className="text-xl font-semibold text-gray-800 mb-4">
            💰 Financial Summary
          </h3>
          
          {/* Total Lifetime Income */}
          <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg p-6 mb-6">
            <p className="text-indigo-100 text-sm mb-1">Total Lifetime Income</p>
            <p className="text-4xl font-bold">
              {loading ? '...' : `₹${stats.totalIncome.toLocaleString('en-IN')}`}
            </p>
            <p className="text-indigo-100 text-xs mt-2">All-time collected rent + electricity</p>
          </div>

          {/* Yearly Summary */}
          <div className="mb-6">
            <h4 className="font-semibold text-gray-700 mb-3">📊 Year-wise Income</h4>
            {loading ? (
              <p className="text-gray-500 text-sm">Loading...</p>
            ) : yearlyData.length === 0 ? (
              <p className="text-gray-500 text-sm">No payment data yet. Import historical data or record new payments.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left">Year</th>
                      <th className="px-3 py-2 text-right">Rent Income</th>
                      <th className="px-3 py-2 text-right">Electricity</th>
                      <th className="px-3 py-2 text-right">Total Income</th>
                      <th className="px-3 py-2 text-center">Payments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlyData.map((year) => (
                      <tr 
                        key={year.year} 
                        className={`border-b hover:bg-gray-50 cursor-pointer ${selectedYear === year.year ? 'bg-blue-50' : ''}`}
                        onClick={() => setSelectedYear(year.year)}
                      >
                        <td className="px-3 py-2 font-semibold">{year.year}</td>
                        <td className="px-3 py-2 text-right">₹{year.rentIncome.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2 text-right">₹{year.electricityIncome.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2 text-right font-semibold text-green-600">
                          ₹{year.totalIncome.toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-2 text-center">{year.paymentCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Monthly Breakdown */}
          {selectedYear && monthlyData.length > 0 && (
            <div>
              <h4 className="font-semibold text-gray-700 mb-3">
                📅 Monthly Breakdown - {selectedYear}
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {monthlyData.map((month) => (
                  <div 
                    key={month.month} 
                    className={`border rounded-lg p-3 ${month.totalIncome > 0 ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}
                  >
                    <p className="text-xs font-semibold text-gray-600 mb-1">{month.monthName}</p>
                    <p className="text-lg font-bold text-gray-800">
                      ₹{month.totalIncome.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </p>
                    {month.paymentCount > 0 && (
                      <p className="text-xs text-gray-500">{month.paymentCount} payments</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
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
        <div className="card bg-green-50 border border-green-200">
          <h3 className="text-lg font-semibold text-green-800 mb-2">
            ✅ Phase 4: Complete
          </h3>
          <ul className="text-sm text-green-700 space-y-1">
            <li>✓ Tenant portal component</li>
            <li>✓ Token-based access</li>
            <li>✓ Dues & history display</li>
            <li>✓ Active UPI display</li>
          </ul>
        </div>
        <div className="card bg-blue-50 border border-blue-200">
          <h3 className="text-lg font-semibold text-blue-800 mb-2">
            🔄 Phase 5: In Progress
          </h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>✓ Settings component</li>
            <li>✓ Global electricity rate</li>
            <li>✓ Electricity module</li>
            <li>⏳ Testing in progress</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
