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
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [monthlyData, setMonthlyData] = useState([]);
  const [loading, setLoading] = useState(true);

  const MONTHS = [
    { value: 'all', label: 'All Months' },
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' }
  ];

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
      
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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
      <div className="mb-6">
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
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-gray-700">
                  📅 Monthly Breakdown
                </h4>
                
                {/* Year and Month Dropdowns */}
                <div className="flex gap-3">
                  <select
                    value={selectedYear}
                    onChange={(e) => {
                      setSelectedYear(Number(e.target.value));
                      setSelectedMonth('all');
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-medium"
                  >
                    {yearlyData.map((year) => (
                      <option key={year.year} value={year.year}>
                        {year.year}
                      </option>
                    ))}
                  </select>
                  
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                    className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-medium"
                  >
                    {MONTHS.map((month) => (
                      <option key={month.value} value={month.value}>
                        {month.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Selected Period Summary */}
              {(() => {
                const filteredData = selectedMonth === 'all' 
                  ? monthlyData 
                  : monthlyData.filter(m => m.month === selectedMonth);
                
                const summary = filteredData.reduce((acc, month) => {
                  acc.totalIncome += month.totalIncome;
                  acc.rentIncome += month.rentIncome;
                  acc.electricityIncome += month.electricityIncome;
                  acc.paymentCount += month.paymentCount;
                  return acc;
                }, { totalIncome: 0, rentIncome: 0, electricityIncome: 0, paymentCount: 0 });

                const periodLabel = selectedMonth === 'all' 
                  ? `${selectedYear} - Full Year` 
                  : `${MONTHS.find(m => m.value === selectedMonth)?.label} ${selectedYear}`;

                return (
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg p-5 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <h5 className="font-bold text-gray-800 text-lg">
                        💰 {periodLabel}
                      </h5>
                      <span className="text-sm text-gray-600 bg-white px-3 py-1 rounded-full">
                        {summary.paymentCount} payment{summary.paymentCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white rounded-lg p-4 border border-blue-200">
                        <p className="text-xs text-gray-600 mb-1">Rent Income</p>
                        <p className="text-2xl font-bold text-blue-600">
                          ₹{summary.rentIncome.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                      <div className="bg-white rounded-lg p-4 border border-purple-200">
                        <p className="text-xs text-gray-600 mb-1">Electricity Income</p>
                        <p className="text-2xl font-bold text-purple-600">
                          ₹{summary.electricityIncome.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                      <div className="bg-white rounded-lg p-4 border border-green-200">
                        <p className="text-xs text-gray-600 mb-1">Total Income</p>
                        <p className="text-2xl font-bold text-green-600">
                          ₹{summary.totalIncome.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Monthly Grid - Only show if "All Months" is selected */}
              {selectedMonth === 'all' && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {monthlyData.map((month) => (
                    <div 
                      key={month.month} 
                      className={`border rounded-lg p-3 cursor-pointer transition-all hover:shadow-md ${
                        month.totalIncome > 0 ? 'bg-green-50 border-green-200 hover:bg-green-100' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                      onClick={() => setSelectedMonth(month.month)}
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
              )}
            </div>
          )}
        </div>
      </div>


    </div>
  );
};

export default Dashboard;
