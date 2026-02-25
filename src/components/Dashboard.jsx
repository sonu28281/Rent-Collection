import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { getDashboardStats, getYearlyIncomeSummary, getMonthlyIncomeByYear, getCurrentMonthDetailedSummary, getTodaysCollection } from '../utils/financial';

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
  const [currentMonthSummary, setCurrentMonthSummary] = useState(null);
  const [todaysCollection, setTodaysCollection] = useState({ amount: 0, count: 0, date: '' });
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
      const [statsData, yearlyIncome, monthSummary, todaysData] = await Promise.all([
        getDashboardStats(),
        getYearlyIncomeSummary(),
        getCurrentMonthDetailedSummary(),
        getTodaysCollection()
      ]);
      
      setStats(statsData);
      setYearlyData(yearlyIncome);
      setCurrentMonthSummary(monthSummary);
      setTodaysCollection(todaysData);
      
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

  // Helper function to get floor number from room number
  const getFloor = (roomNumber) => {
    const roomNum = typeof roomNumber === 'string' ? parseInt(roomNumber, 10) : roomNumber;
    return roomNum >= 200 ? 2 : 1;
  };

  // Helper function to group tenants by floor
  const groupTenantsByFloor = (tenants) => {
    const floor1 = tenants.filter(t => getFloor(t.roomNumber) === 1);
    const floor2 = tenants.filter(t => getFloor(t.roomNumber) === 2);
    return { floor1, floor2 };
  };

  return (
    <div className="p-4 lg:p-8">
      {/* Header with Profile */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-3xl font-bold text-gray-900">
          Welcome Back, Admin! 👋
        </h2>
        
        {/* Profile Button */}
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm text-gray-600">
              <span className="font-semibold">{currentUser?.email}</span>
            </p>
            <p className="text-xs text-gray-500">
              12-room lodge manager
            </p>
          </div>
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
            {currentUser?.email?.charAt(0).toUpperCase()}
          </div>
        </div>
      </div>

      {/* Current Month Detailed Summary */}
      {currentMonthSummary && (
        <div className="mb-6">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-gray-800">
                📅 Current Month Summary - {new Date(2000, currentMonthSummary.month - 1).toLocaleString('default', { month: 'long' })} {currentMonthSummary.year}
              </h3>
              <span className="text-sm text-gray-600">
                {currentMonthSummary.paidCount + currentMonthSummary.pendingCount} active tenants
              </span>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-700 text-sm font-semibold mb-1">Expected Rent</p>
                    <p className="text-2xl font-bold text-blue-900">
                      ₹{currentMonthSummary.totalExpected.toLocaleString('en-IN')}
                    </p>
                    <p className="text-blue-600 text-xs mt-1">Total to collect</p>
                  </div>
                  <div className="text-3xl">💰</div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-green-50 to-green-100 border border-green-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-green-700 text-sm font-semibold mb-1">Collected</p>
                    <p className="text-2xl font-bold text-green-900">
                      ₹{currentMonthSummary.totalCollected.toLocaleString('en-IN')}
                    </p>
                    <p className="text-green-600 text-xs mt-1">
                      {currentMonthSummary.paidCount} tenants paid
                    </p>
                  </div>
                  <div className="text-3xl">✅</div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-orange-50 to-orange-100 border border-orange-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-orange-700 text-sm font-semibold mb-1">Pending</p>
                    <p className="text-2xl font-bold text-orange-900">
                      ₹{currentMonthSummary.totalDue.toLocaleString('en-IN')}
                    </p>
                    <p className="text-orange-600 text-xs mt-1">
                      {currentMonthSummary.pendingCount} tenants due
                    </p>
                  </div>
                  <div className="text-3xl">⏳</div>
                </div>
              </div>
            </div>

            {/* Collection Progress */}
            <div className="mb-6">
              <div className="flex items-center justify-between text-sm mb-2">
                <span className="font-semibold text-gray-700">Collection Progress</span>
                <span className="text-gray-600">
                  {currentMonthSummary.totalExpected > 0 
                    ? ((currentMonthSummary.totalCollected / currentMonthSummary.totalExpected) * 100).toFixed(1)
                    : 0}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div 
                  className="bg-gradient-to-r from-green-500 to-emerald-600 h-3 rounded-full transition-all duration-500"
                  style={{ 
                    width: currentMonthSummary.totalExpected > 0 
                      ? `${Math.min((currentMonthSummary.totalCollected / currentMonthSummary.totalExpected) * 100, 100)}%`
                      : '0%'
                  }}
                ></div>
              </div>
            </div>

            {/* Tenants Who Paid - Floor-wise */}
            {currentMonthSummary.paidTenants.length > 0 && (() => {
              const { floor1, floor2 } = groupTenantsByFloor(currentMonthSummary.paidTenants);
              return (
                <div className="mb-6 space-y-4">
                  {/* Floor 1 - Paid */}
                  {floor1.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-green-700 mb-3 flex items-center gap-2">
                        <span className="text-xl">✅</span>
                        Floor 1 - Paid ({floor1.length})
                      </h4>
                      <div className="bg-green-50 rounded-lg border border-green-200 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-green-100">
                              <tr>
                                <th className="px-3 py-2 text-left">Room</th>
                                <th className="px-3 py-2 text-left">Tenant</th>
                                <th className="px-3 py-2 text-right">Amount</th>
                                <th className="px-3 py-2 text-left">Payment Date</th>
                                <th className="px-3 py-2 text-left">Method</th>
                              </tr>
                            </thead>
                            <tbody>
                              {floor1.map((tenant) => (
                                <tr key={tenant.id} className="border-b border-green-100 hover:bg-green-100">
                                  <td className="px-3 py-2 font-semibold">{tenant.roomNumber}</td>
                                  <td className="px-3 py-2">{tenant.name}</td>
                                  <td className="px-3 py-2 text-right font-semibold text-green-700">
                                    ₹{tenant.collectedAmount.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-3 py-2">{tenant.paidDate || '-'}</td>
                                  <td className="px-3 py-2">
                                    <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded">
                                      {tenant.paymentMethod || 'N/A'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Floor 2 - Paid */}
                  {floor2.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-green-700 mb-3 flex items-center gap-2">
                        <span className="text-xl">✅</span>
                        Floor 2 - Paid ({floor2.length})
                      </h4>
                      <div className="bg-green-50 rounded-lg border border-green-200 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-green-100">
                              <tr>
                                <th className="px-3 py-2 text-left">Room</th>
                                <th className="px-3 py-2 text-left">Tenant</th>
                                <th className="px-3 py-2 text-right">Amount</th>
                                <th className="px-3 py-2 text-left">Payment Date</th>
                                <th className="px-3 py-2 text-left">Method</th>
                              </tr>
                            </thead>
                            <tbody>
                              {floor2.map((tenant) => (
                                <tr key={tenant.id} className="border-b border-green-100 hover:bg-green-100">
                                  <td className="px-3 py-2 font-semibold">{tenant.roomNumber}</td>
                                  <td className="px-3 py-2">{tenant.name}</td>
                                  <td className="px-3 py-2 text-right font-semibold text-green-700">
                                    ₹{tenant.collectedAmount.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-3 py-2">{tenant.paidDate || '-'}</td>
                                  <td className="px-3 py-2">
                                    <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded">
                                      {tenant.paymentMethod || 'N/A'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Tenants with Pending Payments - Floor-wise */}
            {currentMonthSummary.pendingTenants.length > 0 && (() => {
              const { floor1, floor2 } = groupTenantsByFloor(currentMonthSummary.pendingTenants);
              return (
                <div className="space-y-4">
                  {/* Floor 1 - Pending */}
                  {floor1.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-red-700 mb-3 flex items-center gap-2">
                        <span className="text-xl">❌</span>
                        Floor 1 - Pending ({floor1.length})
                      </h4>
                      <div className="bg-red-50 rounded-lg border border-red-300 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-red-100">
                              <tr>
                                <th className="px-3 py-2 text-left">Room</th>
                                <th className="px-3 py-2 text-left">Tenant</th>
                                <th className="px-3 py-2 text-right">Expected Rent</th>
                                <th className="px-3 py-2 text-right">Electricity</th>
                                <th className="px-3 py-2 text-right">Total Due</th>
                                <th className="px-3 py-2 text-center">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {floor1.map((tenant) => (
                                <tr key={tenant.id} className="border-b border-red-100 hover:bg-red-100">
                                  <td className="px-3 py-2 font-semibold">{tenant.roomNumber}</td>
                                  <td className="px-3 py-2">{tenant.name}</td>
                                  <td className="px-3 py-2 text-right">
                                    ₹{tenant.expectedRent.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    ₹{tenant.expectedElectricity.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold text-red-700">
                                    ₹{tenant.dueAmount.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className="text-xs px-2 py-1 rounded bg-red-200 text-red-900 font-semibold">
                                      {tenant.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Floor 2 - Pending */}
                  {floor2.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-red-700 mb-3 flex items-center gap-2">
                        <span className="text-xl">❌</span>
                        Floor 2 - Pending ({floor2.length})
                      </h4>
                      <div className="bg-red-50 rounded-lg border border-red-300 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-red-100">
                              <tr>
                                <th className="px-3 py-2 text-left">Room</th>
                                <th className="px-3 py-2 text-left">Tenant</th>
                                <th className="px-3 py-2 text-right">Expected Rent</th>
                                <th className="px-3 py-2 text-right">Electricity</th>
                                <th className="px-3 py-2 text-right">Total Due</th>
                                <th className="px-3 py-2 text-center">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {floor2.map((tenant) => (
                                <tr key={tenant.id} className="border-b border-red-100 hover:bg-red-100">
                                  <td className="px-3 py-2 font-semibold">{tenant.roomNumber}</td>
                                  <td className="px-3 py-2">{tenant.name}</td>
                                  <td className="px-3 py-2 text-right">
                                    ₹{tenant.expectedRent.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    ₹{tenant.expectedElectricity.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold text-red-700">
                                    ₹{tenant.dueAmount.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className="text-xs px-2 py-1 rounded bg-red-200 text-red-900 font-semibold">
                                      {tenant.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
      {/* Quick Stats - Essential Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm font-semibold">Property Overview</p>
              <div className="flex items-baseline gap-3 mt-2">
                <div>
                  <p className="text-3xl font-bold">12</p>
                  <p className="text-blue-100 text-xs">Total Rooms</p>
                </div>
                <div className="text-2xl text-blue-100">|</div>
                <div>
                  <p className="text-3xl font-bold">{loading ? '...' : stats.occupancy.occupied}</p>
                  <p className="text-blue-100 text-xs">Occupied</p>
                </div>
              </div>
            </div>
            <div className="text-5xl">🏠</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm font-semibold">Active Tenants</p>
              <div className="mt-2">
                <p className="text-4xl font-bold">
                  {loading ? '...' : stats.activeTenants}
                </p>
                <p className="text-green-100 text-xs mt-1">
                  {loading ? '...' : `${stats.occupancy.rate}% occupancy rate`}
                </p>
              </div>
            </div>
            <div className="text-5xl">👥</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm font-semibold">Today's Collection</p>
              <div className="mt-2">
                <p className="text-4xl font-bold">
                  {loading ? '...' : `₹${todaysCollection.amount.toLocaleString('en-IN')}`}
                </p>
                <p className="text-purple-100 text-xs mt-1">
                  {loading ? 'Loading...' : `${todaysCollection.count} payment${todaysCollection.count !== 1 ? 's' : ''} today`}
                </p>
              </div>
            </div>
            <div className="text-5xl">💰</div>
          </div>
        </div>
      </div>

      {/* Financial Summary */}
      <div className="mb-6">
        <div className="card">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-xl font-semibold text-gray-800">
                💰 Financial Summary
              </h3>
              <p className="text-sm text-gray-600 mt-1">Year-wise collection overview</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-600 uppercase tracking-wide">Total Lifetime Income</p>
              <p className="text-3xl font-bold text-indigo-600">
                {loading ? '...' : `₹${stats.totalIncome.toLocaleString('en-IN')}`}
              </p>
            </div>
          </div>

          {/* Yearly Summary */}
          <div className="mb-6">
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


    </div>
  );
};

export default Dashboard;
