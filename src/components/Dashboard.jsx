import { useState, useEffect, useCallback, Fragment } from 'react';
import { useAuth } from '../AuthContext';
import { getDashboardStats, getYearlyIncomeSummary, getMonthlyIncomeByYear, getCurrentMonthDetailedSummary, getTodaysCollection } from '../utils/financial';
import ViewModeToggle from './ui/ViewModeToggle';
import useResponsiveViewMode from '../utils/useResponsiveViewMode';

const Dashboard = () => {
  const { currentUser } = useAuth();
  
  // State for month navigation
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1); // 1-12
  const [selectedMonthYear, setSelectedMonthYear] = useState(now.getFullYear());
  
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
  const { viewMode, setViewMode, isCardView } = useResponsiveViewMode('dashboard-view-mode', 'table');
  const [tableSorts, setTableSorts] = useState({
    floor1: { column: 'room', direction: 'asc' },
    floor2: { column: 'room', direction: 'asc' },
    yearly: { column: 'year', direction: 'desc' }
  });
  const [expandedSplitRows, setExpandedSplitRows] = useState({});

  const fetchMonthData = useCallback(async () => {
    try {
      const monthSummary = await getCurrentMonthDetailedSummary(selectedMonth, selectedMonthYear);
      setCurrentMonthSummary(monthSummary);
    } catch (error) {
      console.error('Error fetching month data:', error);
    }
  }, [selectedMonth, selectedMonthYear]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [statsData, yearlyIncome, todaysData] = await Promise.all([
        getDashboardStats(),
        getYearlyIncomeSummary(),
        getTodaysCollection()
      ]);
      
      setStats(statsData);
      setYearlyData(yearlyIncome);
      setTodaysCollection(todaysData);
      
      // Set selected year to current or latest year with data
      if (yearlyIncome.length > 0) {
        const latestYear = yearlyIncome[0].year;
        setSelectedYear(latestYear);
      }
      
      // Fetch month data
      await fetchMonthData();
      
      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setLoading(false);
    }
  }, [fetchMonthData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (selectedYear) {
      fetchMonthlyData(selectedYear);
    }
  }, [selectedYear]);

  // Refetch when selected month/year changes
  useEffect(() => {
    fetchMonthData();
  }, [fetchMonthData]);

  const fetchMonthlyData = async (year) => {
    try {
      const data = await getMonthlyIncomeByYear(year);
      setMonthlyData(data);
    } catch (error) {
      console.error('Error fetching monthly data:', error);
    }
  };

  // Month navigation functions
  const goToPreviousMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedMonthYear(selectedMonthYear - 1);
    } else {
      setSelectedMonth(selectedMonth - 1);
    }
  };

  const goToNextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedMonthYear(selectedMonthYear + 1);
    } else {
      setSelectedMonth(selectedMonth + 1);
    }
  };

  const goToToday = () => {
    const now = new Date();
    setSelectedMonth(now.getMonth() + 1);
    setSelectedMonthYear(now.getFullYear());
  };

  const isCurrentMonth = () => {
    const now = new Date();
    return selectedMonth === (now.getMonth() + 1) && selectedMonthYear === now.getFullYear();
  };

  // Helper function to get floor number from room number
  const getFloor = (roomNumber) => {
    const roomNum = typeof roomNumber === 'string' ? parseInt(roomNumber, 10) : roomNumber;
    return roomNum >= 200 ? 2 : 1;
  };

  const getTenantRooms = (tenant) => {
    if (Array.isArray(tenant?.roomNumbers) && tenant.roomNumbers.length > 0) {
      return tenant.roomNumbers.map((room) => String(room));
    }
    if (tenant?.roomNumber !== undefined && tenant?.roomNumber !== null && tenant?.roomNumber !== '') {
      return [String(tenant.roomNumber)];
    }
    return [];
  };

  const getTenantRoomLabel = (tenant) => {
    const rooms = getTenantRooms(tenant);
    if (rooms.length === 0) return '-';
    return rooms.join(', ');
  };

  const getCompactRoomLabel = (tenant) => {
    const rooms = getTenantRooms(tenant);
    if (rooms.length === 0) return '-';
    if (rooms.length === 1) return rooms[0];
    return `${rooms[0]} +${rooms.length - 1}`;
  };

  const getFloorRoomCount = (tenants) => {
    const uniqueRooms = new Set();
    tenants.forEach((tenant) => {
      getTenantRooms(tenant).forEach((room) => uniqueRooms.add(String(room)));
    });
    return uniqueRooms.size;
  };

  const getPrimaryRoomNumber = (tenant) => {
    const rooms = getTenantRooms(tenant);
    if (rooms.length === 0) return 0;
    return Number(String(rooms[0]).replace(/\D/g, '')) || 0;
  };

  const getSortIndicator = (tableKey, columnKey) => {
    const sortConfig = tableSorts[tableKey];
    if (!sortConfig || sortConfig.column !== columnKey) return '';
    return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
  };

  const isSplitExpanded = (tableKey, tenantId) => !!expandedSplitRows[`${tableKey}_${tenantId}`];

  const toggleSplitRow = (tableKey, tenantId) => {
    const mapKey = `${tableKey}_${tenantId}`;
    setExpandedSplitRows((prev) => ({
      ...prev,
      [mapKey]: !prev[mapKey]
    }));
  };

  const handleTableSort = (tableKey, columnKey) => {
    setTableSorts((prev) => {
      const current = prev[tableKey] || { column: columnKey, direction: 'asc' };
      const nextDirection = current.column === columnKey && current.direction === 'asc' ? 'desc' : 'asc';
      return {
        ...prev,
        [tableKey]: {
          column: columnKey,
          direction: nextDirection
        }
      };
    });
  };

  const sortFloorTenants = (tenants, tableKey) => {
    const sortConfig = tableSorts[tableKey] || { column: 'room', direction: 'asc' };
    const sorted = [...tenants].sort((a, b) => {
      const getValue = (tenant) => {
        switch (sortConfig.column) {
          case 'tenant':
            return String(tenant.name || '').toLowerCase();
          case 'rent':
            return Number(tenant.expectedRent || 0);
          case 'electricity':
            return Number(tenant.expectedElectricity || 0);
          case 'expected':
            return Number(tenant.expectedTotal || 0);
          case 'collected':
            return Number(tenant.collectedAmount || 0);
          case 'date':
            return Number(tenant.paidTimestamp || 0);
          case 'status':
            return tenant.status === 'paid' ? 1 : 0;
          case 'room':
          default:
            return getPrimaryRoomNumber(tenant);
        }
      };

      const valueA = getValue(a);
      const valueB = getValue(b);
      if (valueA < valueB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valueA > valueB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  };

  const sortYearlyRows = (rows) => {
    const sortConfig = tableSorts.yearly || { column: 'year', direction: 'desc' };
    const sorted = [...rows].sort((a, b) => {
      const getValue = (row) => {
        switch (sortConfig.column) {
          case 'rentIncome':
            return Number(row.rentIncome || 0);
          case 'electricityIncome':
            return Number(row.electricityIncome || 0);
          case 'totalIncome':
            return Number(row.totalIncome || 0);
          case 'paymentCount':
            return Number(row.paymentCount || 0);
          case 'year':
          default:
            return Number(row.year || 0);
        }
      };

      const valueA = getValue(a);
      const valueB = getValue(b);
      if (valueA < valueB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valueA > valueB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  };

  // Helper function to group tenants by floor
  const groupTenantsByFloor = (tenants) => {
    const floor1 = tenants.filter((tenant) => {
      const tenantRooms = getTenantRooms(tenant);
      return tenantRooms.some((room) => getFloor(room) === 1);
    });
    const floor2 = tenants.filter((tenant) => {
      const tenantRooms = getTenantRooms(tenant);
      return tenantRooms.some((room) => getFloor(room) === 2);
    });
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
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
                  📅 Month Summary - {new Date(2000, currentMonthSummary.month - 1).toLocaleString('default', { month: 'long' })} {currentMonthSummary.year}
                  {!isCurrentMonth() && (
                    <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-semibold rounded-full">
                      Historical
                    </span>
                  )}
                </h3>
                <span className="text-sm text-gray-600">
                  {currentMonthSummary.paidCount + currentMonthSummary.pendingCount} active tenants
                </span>
              </div>
              
              {/* Month Navigation Controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={goToPreviousMonth}
                  className="flex items-center gap-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold transition text-sm"
                  title="Previous Month"
                >
                  ⬅️ Prev
                </button>
                
                {!isCurrentMonth() && (
                  <button
                    onClick={goToToday}
                    className="flex items-center gap-1 px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg font-semibold transition text-sm"
                    title="Go to Current Month"
                  >
                    📅 Today
                  </button>
                )}
                
                <button
                  onClick={goToNextMonth}
                  className="flex items-center gap-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold transition text-sm"
                  title="Next Month"
                >
                  Next ➡️
                </button>
              </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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

              <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-purple-700 text-sm font-semibold mb-1">Today&apos;s Collection</p>
                    <p className="text-2xl font-bold text-purple-900">
                      {loading ? '...' : `₹${todaysCollection.amount.toLocaleString('en-IN')}`}
                    </p>
                    <p className="text-purple-600 text-xs mt-1">
                      {loading ? 'Loading...' : `${todaysCollection.count} payment${todaysCollection.count !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                  <div className="text-3xl">💵</div>
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

            <div className="mb-5">
              <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
            </div>

            {/* All Tenants - Floor-wise with Color Coding */}
            {currentMonthSummary.allTenants && currentMonthSummary.allTenants.length > 0 && (() => {
              const { floor1, floor2 } = groupTenantsByFloor(currentMonthSummary.allTenants);
              return (
                <div className="space-y-4">
                  {/* Floor 1 - All Tenants */}
                  {floor1.length > 0 && (() => {
                    const paidCount = floor1.filter(t => t.status === 'paid').length;
                    const pendingCount = floor1.filter(t => t.status !== 'paid').length;
                    const floor1RoomCount = getFloorRoomCount(floor1);
                    return (
                      <div>
                        <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                          <span className="text-xl">🏠</span>
                          Floor 1 - Ground Floor ({floor1RoomCount} rooms, {floor1.length} tenants: {paidCount} paid, {pendingCount} pending)
                        </h4>
                        {isCardView ? (
                          <div className="space-y-3">
                            {floor1.map((tenant) => {
                              const isPaid = tenant.status === 'paid' && tenant.collectedAmount > 0;
                              return (
                                <div key={tenant.id} className={`rounded-lg border p-3 ${isPaid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-xs text-gray-500">Room{tenant.roomCount > 1 ? 's' : ''}</p>
                                      <p className="font-bold text-gray-900">{getTenantRoomLabel(tenant)} • {tenant.name}</p>
                                      {tenant.roomCount > 1 && (
                                        <p className="text-xs text-indigo-700 font-semibold mt-1">Multi-room tenant ({tenant.roomCount} rooms)</p>
                                      )}
                                    </div>
                                    <span className={`text-xs px-2 py-1 rounded font-semibold ${
                                      isPaid ? 'bg-green-200 text-green-900' : 'bg-red-200 text-red-900'
                                    }`}>
                                      {isPaid ? '✅ Paid' : '❌ Pending'}
                                    </span>
                                  </div>
                                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                                    <p>Rent: <span className="font-semibold">₹{tenant.expectedRent.toLocaleString('en-IN')}</span></p>
                                    <p>Electricity: <span className="font-semibold text-blue-700">₹{tenant.expectedElectricity.toLocaleString('en-IN')}</span></p>
                                    <p>Expected: <span className="font-semibold">₹{tenant.expectedTotal.toLocaleString('en-IN')}</span></p>
                                    <p>Collected: <span className={`font-semibold ${isPaid ? 'text-green-700' : 'text-red-700'}`}>₹{tenant.collectedAmount.toLocaleString('en-IN')}</span></p>
                                  </div>
                                  <div className="mt-2 text-sm text-gray-700 flex items-center gap-2">
                                    <span>Payment: {tenant.paidDate || '-'}</span>
                                    <span className="text-xs text-gray-500">Records: {tenant.paymentRecordsCount || 0}</span>
                                    {tenant.isDelayed && (
                                      <span className="text-xs bg-orange-200 text-orange-900 px-2 py-0.5 rounded font-semibold">Delayed</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-gray-200 overflow-hidden">
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-100">
                                  <tr>
                                    <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleTableSort('floor1', 'room')}>Room{getSortIndicator('floor1', 'room')}</th>
                                    <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleTableSort('floor1', 'tenant')}>Tenant{getSortIndicator('floor1', 'tenant')}</th>
                                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleTableSort('floor1', 'rent')}>Rent{getSortIndicator('floor1', 'rent')}</th>
                                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleTableSort('floor1', 'electricity')}>Electricity{getSortIndicator('floor1', 'electricity')}</th>
                                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleTableSort('floor1', 'expected')}>Expected{getSortIndicator('floor1', 'expected')}</th>
                                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleTableSort('floor1', 'collected')}>Collected{getSortIndicator('floor1', 'collected')}</th>
                                    <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleTableSort('floor1', 'date')}>Payment Date{getSortIndicator('floor1', 'date')}</th>
                                    <th className="px-3 py-2 text-center cursor-pointer select-none" onClick={() => handleTableSort('floor1', 'status')}>Status{getSortIndicator('floor1', 'status')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortFloorTenants(floor1, 'floor1').map((tenant) => {
                                    const isPaid = tenant.status === 'paid' && tenant.collectedAmount > 0;
                                    const expanded = isSplitExpanded('floor1', tenant.id);
                                    return (
                                      <Fragment key={tenant.id}>
                                        <tr
                                          key={tenant.id}
                                          className={`border-b transition-colors ${
                                            isPaid
                                              ? 'bg-green-50 hover:bg-green-100'
                                              : 'bg-red-50 hover:bg-red-100'
                                          }`}
                                        >
                                          <td className="px-3 py-2 font-semibold whitespace-nowrap" title={getTenantRoomLabel(tenant)}>
                                            {getCompactRoomLabel(tenant)}
                                          </td>
                                          <td className="px-3 py-2">
                                            {tenant.name}
                                            {tenant.roomCount > 1 && (
                                              <div className="mt-1 flex items-center gap-2">
                                                <span className="text-xs text-indigo-700 font-semibold">Multi-room tenant</span>
                                                <button
                                                  type="button"
                                                  onClick={() => toggleSplitRow('floor1', tenant.id)}
                                                  className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded hover:bg-indigo-200"
                                                >
                                                  Split {expanded ? '▲' : '▼'}
                                                </button>
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-3 py-2 text-right text-gray-700">₹{tenant.expectedRent.toLocaleString('en-IN')}</td>
                                          <td className="px-3 py-2 text-right text-blue-700">₹{tenant.expectedElectricity.toLocaleString('en-IN')}</td>
                                          <td className="px-3 py-2 text-right font-semibold">₹{tenant.expectedTotal.toLocaleString('en-IN')}</td>
                                          <td className={`px-3 py-2 text-right font-semibold ${isPaid ? 'text-green-700' : 'text-red-700'}`}>
                                            ₹{tenant.collectedAmount.toLocaleString('en-IN')}
                                          </td>
                                          <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                              <span>{tenant.paidDate || '-'}</span>
                                              <span className="text-xs text-gray-500">Records: {tenant.paymentRecordsCount || 0}</span>
                                              {tenant.isDelayed && (
                                                <span className="text-xs bg-orange-200 text-orange-900 px-2 py-0.5 rounded font-semibold">Delayed</span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="px-3 py-2 text-center">
                                            <span className={`text-xs px-2 py-1 rounded font-semibold ${
                                              isPaid ? 'bg-green-200 text-green-900' : 'bg-red-200 text-red-900'
                                            }`}>
                                              {isPaid ? '✅ Paid' : '❌ Pending'}
                                            </span>
                                          </td>
                                        </tr>
                                        {tenant.roomCount > 1 && expanded && (
                                          <tr className="bg-indigo-50 border-b">
                                            <td className="px-3 py-2" colSpan={8}>
                                              <div className="text-xs font-semibold text-indigo-900 mb-2">Room-wise collected split</div>
                                              <div className="overflow-x-auto">
                                                <table className="w-full text-xs">
                                                  <thead>
                                                    <tr className="text-indigo-800">
                                                      <th className="px-2 py-1 text-left">Room</th>
                                                      <th className="px-2 py-1 text-right">Rent</th>
                                                      <th className="px-2 py-1 text-right">Electricity</th>
                                                      <th className="px-2 py-1 text-right">Collected</th>
                                                      <th className="px-2 py-1 text-center">Records</th>
                                                      <th className="px-2 py-1 text-left">Last Paid</th>
                                                      <th className="px-2 py-1 text-center">Status</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {(tenant.roomWiseSplit || []).map((entry) => (
                                                      <tr key={`${tenant.id}_${entry.roomNumber}`} className="border-t border-indigo-100">
                                                        <td className="px-2 py-1 font-semibold">{entry.roomNumber}</td>
                                                        <td className="px-2 py-1 text-right">₹{Number(entry.rentAmount || 0).toLocaleString('en-IN')}</td>
                                                        <td className="px-2 py-1 text-right">₹{Number(entry.electricityAmount || 0).toLocaleString('en-IN')}</td>
                                                        <td className="px-2 py-1 text-right font-semibold">₹{Number(entry.collectedAmount || 0).toLocaleString('en-IN')}</td>
                                                        <td className="px-2 py-1 text-center">{entry.paymentRecordsCount || 0}</td>
                                                        <td className="px-2 py-1">{entry.latestPaidDate || '-'}</td>
                                                        <td className="px-2 py-1 text-center">{entry.status === 'paid' ? '✅' : '⏳'}</td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Floor 2 - All Tenants */}
                  {floor2.length > 0 && (() => {
                    const paidCount = floor2.filter(t => t.status === 'paid').length;
                    const pendingCount = floor2.filter(t => t.status !== 'paid').length;
                    const floor2RoomCount = getFloorRoomCount(floor2);
                    return (
                      <div>
                        <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                          <span className="text-xl">🏢</span>
                          Floor 2 - First Floor ({floor2RoomCount} rooms, {floor2.length} tenants: {paidCount} paid, {pendingCount} pending)
                        </h4>
                        {isCardView ? (
                          <div className="space-y-3">
                            {floor2.map((tenant) => {
                              const isPaid = tenant.status === 'paid' && tenant.collectedAmount > 0;
                              return (
                                <div key={tenant.id} className={`rounded-lg border p-3 ${isPaid ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-xs text-gray-500">Room{tenant.roomCount > 1 ? 's' : ''}</p>
                                      <p className="font-bold text-gray-900">{getTenantRoomLabel(tenant)} • {tenant.name}</p>
                                      {tenant.roomCount > 1 && (
                                        <p className="text-xs text-indigo-700 font-semibold mt-1">Multi-room tenant ({tenant.roomCount} rooms)</p>
                                      )}
                                    </div>
                                    <span className={`text-xs px-2 py-1 rounded font-semibold ${
                                      isPaid ? 'bg-green-200 text-green-900' : 'bg-red-200 text-red-900'
                                    }`}>
                                      {isPaid ? '✅ Paid' : '❌ Pending'}
                                    </span>
                                  </div>
                                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                                    <p>Rent: <span className="font-semibold">₹{tenant.expectedRent.toLocaleString('en-IN')}</span></p>
                                    <p>Electricity: <span className="font-semibold text-blue-700">₹{tenant.expectedElectricity.toLocaleString('en-IN')}</span></p>
                                    <p>Expected: <span className="font-semibold">₹{tenant.expectedTotal.toLocaleString('en-IN')}</span></p>
                                    <p>Collected: <span className={`font-semibold ${isPaid ? 'text-green-700' : 'text-red-700'}`}>₹{tenant.collectedAmount.toLocaleString('en-IN')}</span></p>
                                  </div>
                                  <div className="mt-2 text-sm text-gray-700 flex items-center gap-2">
                                    <span>Payment: {tenant.paidDate || '-'}</span>
                                    <span className="text-xs text-gray-500">Records: {tenant.paymentRecordsCount || 0}</span>
                                    {tenant.isDelayed && (
                                      <span className="text-xs bg-orange-200 text-orange-900 px-2 py-0.5 rounded font-semibold">Delayed</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-lg border border-gray-200 overflow-hidden">
                            <div className="overflow-x-auto">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-100">
                                  <tr>
                                    <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleTableSort('floor2', 'room')}>Room{getSortIndicator('floor2', 'room')}</th>
                                    <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleTableSort('floor2', 'tenant')}>Tenant{getSortIndicator('floor2', 'tenant')}</th>
                                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleTableSort('floor2', 'rent')}>Rent{getSortIndicator('floor2', 'rent')}</th>
                                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleTableSort('floor2', 'electricity')}>Electricity{getSortIndicator('floor2', 'electricity')}</th>
                                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleTableSort('floor2', 'expected')}>Expected{getSortIndicator('floor2', 'expected')}</th>
                                    <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleTableSort('floor2', 'collected')}>Collected{getSortIndicator('floor2', 'collected')}</th>
                                    <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleTableSort('floor2', 'date')}>Payment Date{getSortIndicator('floor2', 'date')}</th>
                                    <th className="px-3 py-2 text-center cursor-pointer select-none" onClick={() => handleTableSort('floor2', 'status')}>Status{getSortIndicator('floor2', 'status')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sortFloorTenants(floor2, 'floor2').map((tenant) => {
                                    const isPaid = tenant.status === 'paid' && tenant.collectedAmount > 0;
                                    const expanded = isSplitExpanded('floor2', tenant.id);
                                    return (
                                      <Fragment key={tenant.id}>
                                        <tr
                                          key={tenant.id}
                                          className={`border-b transition-colors ${
                                            isPaid
                                              ? 'bg-green-50 hover:bg-green-100'
                                              : 'bg-red-50 hover:bg-red-100'
                                          }`}
                                        >
                                          <td className="px-3 py-2 font-semibold whitespace-nowrap" title={getTenantRoomLabel(tenant)}>
                                            {getCompactRoomLabel(tenant)}
                                          </td>
                                          <td className="px-3 py-2">
                                            {tenant.name}
                                            {tenant.roomCount > 1 && (
                                              <div className="mt-1 flex items-center gap-2">
                                                <span className="text-xs text-indigo-700 font-semibold">Multi-room tenant</span>
                                                <button
                                                  type="button"
                                                  onClick={() => toggleSplitRow('floor2', tenant.id)}
                                                  className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded hover:bg-indigo-200"
                                                >
                                                  Split {expanded ? '▲' : '▼'}
                                                </button>
                                              </div>
                                            )}
                                          </td>
                                          <td className="px-3 py-2 text-right text-gray-700">₹{tenant.expectedRent.toLocaleString('en-IN')}</td>
                                          <td className="px-3 py-2 text-right text-blue-700">₹{tenant.expectedElectricity.toLocaleString('en-IN')}</td>
                                          <td className="px-3 py-2 text-right font-semibold">₹{tenant.expectedTotal.toLocaleString('en-IN')}</td>
                                          <td className={`px-3 py-2 text-right font-semibold ${isPaid ? 'text-green-700' : 'text-red-700'}`}>
                                            ₹{tenant.collectedAmount.toLocaleString('en-IN')}
                                          </td>
                                          <td className="px-3 py-2">
                                            <div className="flex items-center gap-2">
                                              <span>{tenant.paidDate || '-'}</span>
                                              <span className="text-xs text-gray-500">Records: {tenant.paymentRecordsCount || 0}</span>
                                              {tenant.isDelayed && (
                                                <span className="text-xs bg-orange-200 text-orange-900 px-2 py-0.5 rounded font-semibold">Delayed</span>
                                              )}
                                            </div>
                                          </td>
                                          <td className="px-3 py-2 text-center">
                                            <span className={`text-xs px-2 py-1 rounded font-semibold ${
                                              isPaid ? 'bg-green-200 text-green-900' : 'bg-red-200 text-red-900'
                                            }`}>
                                              {isPaid ? '✅ Paid' : '❌ Pending'}
                                            </span>
                                          </td>
                                        </tr>
                                        {tenant.roomCount > 1 && expanded && (
                                          <tr className="bg-indigo-50 border-b">
                                            <td className="px-3 py-2" colSpan={8}>
                                              <div className="text-xs font-semibold text-indigo-900 mb-2">Room-wise collected split</div>
                                              <div className="overflow-x-auto">
                                                <table className="w-full text-xs">
                                                  <thead>
                                                    <tr className="text-indigo-800">
                                                      <th className="px-2 py-1 text-left">Room</th>
                                                      <th className="px-2 py-1 text-right">Rent</th>
                                                      <th className="px-2 py-1 text-right">Electricity</th>
                                                      <th className="px-2 py-1 text-right">Collected</th>
                                                      <th className="px-2 py-1 text-center">Records</th>
                                                      <th className="px-2 py-1 text-left">Last Paid</th>
                                                      <th className="px-2 py-1 text-center">Status</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {(tenant.roomWiseSplit || []).map((entry) => (
                                                      <tr key={`${tenant.id}_${entry.roomNumber}`} className="border-t border-indigo-100">
                                                        <td className="px-2 py-1 font-semibold">{entry.roomNumber}</td>
                                                        <td className="px-2 py-1 text-right">₹{Number(entry.rentAmount || 0).toLocaleString('en-IN')}</td>
                                                        <td className="px-2 py-1 text-right">₹{Number(entry.electricityAmount || 0).toLocaleString('en-IN')}</td>
                                                        <td className="px-2 py-1 text-right font-semibold">₹{Number(entry.collectedAmount || 0).toLocaleString('en-IN')}</td>
                                                        <td className="px-2 py-1 text-center">{entry.paymentRecordsCount || 0}</td>
                                                        <td className="px-2 py-1">{entry.latestPaidDate || '-'}</td>
                                                        <td className="px-2 py-1 text-center">{entry.status === 'paid' ? '✅' : '⏳'}</td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              );
            })()}
          </div>
        </div>
      )}

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
            ) : isCardView ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {yearlyData.map((year) => (
                  <button
                    key={year.year}
                    type="button"
                    className={`text-left rounded-lg border p-4 transition ${selectedYear === year.year ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
                    onClick={() => setSelectedYear(year.year)}
                  >
                    <p className="text-xs text-gray-500">Year</p>
                    <p className="text-lg font-bold text-gray-900">{year.year}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <p>Rent: <span className="font-semibold">₹{year.rentIncome.toLocaleString('en-IN')}</span></p>
                      <p>Electricity: <span className="font-semibold">₹{year.electricityIncome.toLocaleString('en-IN')}</span></p>
                      <p>Total: <span className="font-semibold text-green-600">₹{year.totalIncome.toLocaleString('en-IN')}</span></p>
                      <p>Payments: <span className="font-semibold">{year.paymentCount}</span></p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => handleTableSort('yearly', 'year')}>Year{getSortIndicator('yearly', 'year')}</th>
                      <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleTableSort('yearly', 'rentIncome')}>Rent Income{getSortIndicator('yearly', 'rentIncome')}</th>
                      <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleTableSort('yearly', 'electricityIncome')}>Electricity{getSortIndicator('yearly', 'electricityIncome')}</th>
                      <th className="px-3 py-2 text-right cursor-pointer select-none" onClick={() => handleTableSort('yearly', 'totalIncome')}>Total Income{getSortIndicator('yearly', 'totalIncome')}</th>
                      <th className="px-3 py-2 text-center cursor-pointer select-none" onClick={() => handleTableSort('yearly', 'paymentCount')}>Payments{getSortIndicator('yearly', 'paymentCount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortYearlyRows(yearlyData).map((year) => (
                      <tr
                        key={year.year}
                        className={`border-b hover:bg-gray-50 cursor-pointer ${selectedYear === year.year ? 'bg-blue-50' : ''}`}
                        onClick={() => setSelectedYear(year.year)}
                      >
                        <td className="px-3 py-2 font-semibold">{year.year}</td>
                        <td className="px-3 py-2 text-right">₹{year.rentIncome.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2 text-right">₹{year.electricityIncome.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2 text-right font-semibold text-green-600">₹{year.totalIncome.toLocaleString('en-IN')}</td>
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
