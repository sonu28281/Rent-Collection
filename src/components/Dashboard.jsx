import { useState, useEffect, useCallback, Fragment } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { getDashboardStats, getYearlyIncomeSummary, getMonthlyIncomeByYear, getCurrentMonthDetailedSummary, getTodaysCollection } from '../utils/financial';
import ViewModeToggle from './ui/ViewModeToggle';
import LiveDateTime from './ui/LiveDateTime';
import useResponsiveViewMode from '../utils/useResponsiveViewMode';
import { PaymentHistoryModal } from './Tenants';

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
  
  // Payment history modal state
  const [selectedTenantHistory, setSelectedTenantHistory] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [electricityHistory, setElectricityHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Helper function to get assigned rooms
  const getAssignedRooms = (tenantRecord) => {
    // Check for assignedRooms field (from Firestore tenant documents)
    if (Array.isArray(tenantRecord?.assignedRooms) && tenantRecord.assignedRooms.length > 0) {
      return tenantRecord.assignedRooms.map((room) => String(room));
    }
    // Check for roomNumbers field (from currentMonthSummary tenant objects)
    if (Array.isArray(tenantRecord?.roomNumbers) && tenantRecord.roomNumbers.length > 0) {
      return tenantRecord.roomNumbers.map((room) => String(room));
    }
    // Fallback to single roomNumber field
    if (tenantRecord?.roomNumber !== undefined && tenantRecord?.roomNumber !== null && tenantRecord?.roomNumber !== '') {
      return [String(tenantRecord.roomNumber)];
    }
    return [];
  };

  // Handle view payment history
  const handleViewHistory = async (tenant) => {
    console.log('🔍 Dashboard handleViewHistory called with tenant:', {
      id: tenant.id,
      name: tenant.name,
      roomNumber: tenant.roomNumber,
      roomNumbers: tenant.roomNumbers,
      assignedRooms: tenant.assignedRooms,
      roomCount: tenant.roomCount
    });
    
    setSelectedTenantHistory(tenant);
    setLoadingHistory(true);
    
    try {
      const paymentsRef = collection(db, 'payments');
      const assignedRooms = getAssignedRooms(tenant);
      
      console.log('📊 Assigned rooms for history query:', assignedRooms);

      const paymentDocs = new Map();

      // 1) Best match by tenantId (most reliable for current data)
      if (tenant.id) {
        const tenantIdQuery = query(paymentsRef, where('tenantId', '==', tenant.id));
        const tenantIdSnapshot = await getDocs(tenantIdQuery);
        tenantIdSnapshot.forEach((doc) => paymentDocs.set(doc.id, doc));
      }

      // 2) Fallback by assigned room numbers (supports old records with no tenantId)
      const roomQueries = [];
      assignedRooms.forEach((roomNumber) => {
        roomQueries.push(query(paymentsRef, where('roomNumber', '==', roomNumber)));

        const roomNumberAsNumber = Number.parseInt(roomNumber, 10);
        if (Number.isFinite(roomNumberAsNumber)) {
          roomQueries.push(query(paymentsRef, where('roomNumber', '==', roomNumberAsNumber)));
        }
      });

      const roomSnapshots = await Promise.all(roomQueries.map((roomQuery) => getDocs(roomQuery)));
      roomSnapshots.forEach((snapshot) => {
        snapshot.forEach((doc) => paymentDocs.set(doc.id, doc));
      });

      const tenantName = (tenant.name || '').trim().toLowerCase();

      const payments = Array.from(paymentDocs.values())
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((payment) => {
          if (payment.tenantId && tenant.id && payment.tenantId === tenant.id) {
            return true;
          }

          const snapshotName = (payment.tenantNameSnapshot || '').trim().toLowerCase();
          const legacyName = (payment.tenantName || '').trim().toLowerCase();

          return Boolean(tenantName) && (snapshotName === tenantName || legacyName === tenantName);
        })
        .sort((a, b) => {
          const yearDiff = Number(b.year || 0) - Number(a.year || 0);
          if (yearDiff !== 0) return yearDiff;
          return Number(b.month || 0) - Number(a.month || 0);
        });

      console.log(`✅ Found ${payments.length} payment records for ${tenant.name}`);
      console.log('Payment records:', payments.map(p => ({ month: p.month, year: p.year, room: p.roomNumber })));

      setPaymentHistory(payments);

      // Build electricity unit history from two sources:
      // 1) electricityReadings collection (direct meter readings)
      // 2) payments collection (meter fields embedded in each payment)
      try {
        const readingsRef = collection(db, 'electricityReadings');
        const readingDocs = new Map();

        // Source 1: direct electricityReadings by tenantId
        if (tenant.id) {
          const snap = await getDocs(query(readingsRef, where('tenantId', '==', tenant.id)));
          snap.forEach(d => readingDocs.set(d.id, { id: d.id, ...d.data(), source: 'electricityReadings' }));
        }

        // Source 2: extract meter readings embedded in payment records
        const toDate = (val) => {
          if (!val) return new Date(0);
          const d = new Date(val);
          return isNaN(d.getTime()) ? new Date(0) : d;
        };

        payments.forEach(payment => {
          const previousReading = Number(payment.oldReading ?? payment.previousReading);
          const currentReading = Number(payment.currentReading ?? payment.meterReading);
          const unitsConsumed = Number(payment.units ?? payment.unitsConsumed ?? 0);
          const totalCharge = Number(payment.electricity ?? payment.electricityAmount ?? 0);

          const validReadings = Number.isFinite(previousReading) && Number.isFinite(currentReading) && currentReading >= previousReading;
          const validElectricity = totalCharge > 0 || unitsConsumed > 0;

          if (!validReadings || !validElectricity) return;

          const recordDate = payment.paidDate || payment.paymentDate || payment.createdAt || payment.paidAt;
          const monthLabel = (payment.year && payment.month)
            ? `${new Date(Number(payment.year), Number(payment.month) - 1, 1).toLocaleDateString('en-IN', { month: 'short' })} ${payment.year}`
            : (recordDate ? new Date(recordDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '');

          const key = `payment_${payment.id}`;
          readingDocs.set(key, {
            id: key,
            tenantId: tenant.id,
            roomNumber: tenant.roomNumber,
            readingDate: recordDate,
            monthLabel,
            previousReading,
            currentReading,
            unitsConsumed: Number.isFinite(unitsConsumed) ? unitsConsumed : Math.max(0, currentReading - previousReading),
            ratePerUnit: Number(payment.ratePerUnit) || null,
            totalCharge,
            source: 'payments',
            year: payment.year,
            month: payment.month,
          });
        });

        // Deduplicate by monthLabel+currentReading+previousReading
        const seen = new Set();
        const readings = Array.from(readingDocs.values())
          .sort((a, b) => toDate(b.readingDate) - toDate(a.readingDate))
          .filter(r => {
            const dedupeKey = `${r.monthLabel}_${r.currentReading}_${r.previousReading}`;
            if (seen.has(dedupeKey)) return false;
            seen.add(dedupeKey);
            return true;
          });

        setElectricityHistory(readings);
      } catch (elErr) {
        console.warn('Could not fetch electricity readings:', elErr.message);
        setElectricityHistory([]);
      }
    } catch (err) {
      console.error('Error fetching payment history:', err);
      setPaymentHistory([]);
      setElectricityHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleCloseHistory = () => {
    setSelectedTenantHistory(null);
    setPaymentHistory([]);
    setElectricityHistory([]);
  };

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

  // Fixed building layout: 6 rooms per floor. Used to surface vacant rooms.
  const FLOOR_ROOM_NUMBERS = {
    1: ['101', '102', '103', '104', '105', '106'],
    2: ['201', '202', '203', '204', '205', '206']
  };

  // Rooms on a floor with no tenant occupying them in the selected month.
  const getVacantRoomsForFloor = (floorTenants, floorNum) => {
    const occupied = new Set();
    floorTenants.forEach((tenant) => {
      getTenantRooms(tenant).forEach((room) => occupied.add(String(room)));
    });
    return (FLOOR_ROOM_NUMBERS[floorNum] || []).filter((room) => !occupied.has(String(room)));
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

  // Helper function to calculate floor-wise summary stats
  const calculateFloorStats = (floorTenants) => {
    const totalExpected = floorTenants.reduce((sum, tenant) => sum + (tenant.expectedTotal || 0), 0);
    const totalCollected = floorTenants.reduce((sum, tenant) => sum + (tenant.collectedAmount || 0), 0);
    const totalDue = totalExpected - totalCollected;
    const paidCount = floorTenants.filter(t => t.status === 'paid' && t.collectedAmount > 0).length;
    const pendingCount = floorTenants.length - paidCount;
    return { totalExpected, totalCollected, totalDue, paidCount, pendingCount, totalTenants: floorTenants.length };
  };

  return (
    <div className="p-4 lg:p-8">
      {/* Header with Profile */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 truncate">
            Welcome Back, Admin! 👋
          </h2>
        </div>
        {/* Profile Button */}
        <div className="flex items-center gap-3 flex-shrink-0">
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
      {/* Date & Time */}
      <LiveDateTime className="mb-4" />

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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
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

            {/* Rent Status at a glance — mobile-first: who paid vs who didn't this month */}
            {currentMonthSummary.allTenants && currentMonthSummary.allTenants.length > 0 && (() => {
              const isRentPaid = (t) => t.status === 'paid' && t.collectedAmount > 0;
              const roomSort = (a, b) =>
                (Number(String(getTenantRoomLabel(a)).replace(/\D/g, '')) || 0) -
                (Number(String(getTenantRoomLabel(b)).replace(/\D/g, '')) || 0);
              const paidTenants = currentMonthSummary.allTenants.filter(isRentPaid).sort(roomSort);
              const pendingTenants = currentMonthSummary.allTenants.filter((t) => !isRentPaid(t)).sort(roomSort);
              return (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Is mahine ka rent status</h3>

                  {/* Not paid — most important, shown first */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-red-100 text-red-700 text-sm font-bold">{pendingTenants.length}</span>
                      <span className="font-semibold text-red-700">❌ Rent nahi aaya</span>
                    </div>
                    {pendingTenants.length === 0 ? (
                      <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3">🎉 Sabka rent aa gaya!</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {pendingTenants.map((t) => (
                          <div key={t.id} className="flex items-center justify-between gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-xs bg-red-100 text-red-800 px-1.5 py-0.5 rounded whitespace-nowrap">{getCompactRoomLabel(t)}</span>
                              <span className="font-semibold text-gray-900 truncate">{t.name}</span>
                            </div>
                            <span className="text-red-700 font-bold whitespace-nowrap">₹{Math.max((t.expectedTotal || 0) - (t.collectedAmount || 0), 0).toLocaleString('en-IN')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Paid */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-green-100 text-green-700 text-sm font-bold">{paidTenants.length}</span>
                      <span className="font-semibold text-green-700">✅ Rent aa gaya</span>
                    </div>
                    {paidTenants.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {paidTenants.map((t) => (
                          <div key={t.id} className="flex items-center justify-between gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded whitespace-nowrap">{getCompactRoomLabel(t)}</span>
                              <span className="font-semibold text-gray-900 truncate">{t.name}</span>
                            </div>
                            <span className="text-green-700 font-bold whitespace-nowrap">₹{(t.collectedAmount || 0).toLocaleString('en-IN')}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Floor-wise Summary */}
            {currentMonthSummary.allTenants && currentMonthSummary.allTenants.length > 0 && (() => {
              const { floor1, floor2 } = groupTenantsByFloor(currentMonthSummary.allTenants);
              const floor1Stats = calculateFloorStats(floor1);
              const floor2Stats = calculateFloorStats(floor2);
              return (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Floor-wise Breakdown</h3>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Floor 1 Card */}
                    <div className="border border-indigo-200 rounded-lg p-4 bg-gradient-to-br from-indigo-50 to-white">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-2xl">🏠</span>
                        <h4 className="font-bold text-indigo-900">Floor 1 - Ground Floor</h4>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="text-center">
                          <p className="text-xs text-gray-600 mb-1">Expected</p>
                          <p className="text-lg font-bold text-blue-700">₹{floor1Stats.totalExpected.toLocaleString('en-IN')}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-600 mb-1">Collected</p>
                          <p className="text-lg font-bold text-green-700">₹{floor1Stats.totalCollected.toLocaleString('en-IN')}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-600 mb-1">Due</p>
                          <p className="text-lg font-bold text-orange-700">₹{floor1Stats.totalDue.toLocaleString('en-IN')}</p>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-indigo-200 flex items-center justify-between text-xs">
                        <span className="text-gray-600">{floor1Stats.totalTenants} tenants</span>
                        <span className="text-green-700 font-semibold">{floor1Stats.paidCount} paid</span>
                        <span className="text-orange-700 font-semibold">{floor1Stats.pendingCount} pending</span>
                      </div>
                      <div className="mt-3">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-green-500 to-emerald-600 h-2 rounded-full transition-all duration-500"
                            style={{ width: floor1Stats.totalExpected > 0 ? `${Math.min((floor1Stats.totalCollected / floor1Stats.totalExpected) * 100, 100)}%` : '0%' }}
                          ></div>
                        </div>
                        <p className="text-xs text-gray-600 text-center mt-1">
                          {floor1Stats.totalExpected > 0 ? ((floor1Stats.totalCollected / floor1Stats.totalExpected) * 100).toFixed(1) : 0}% collected
                        </p>
                      </div>
                    </div>

                    {/* Floor 2 Card */}
                    <div className="border border-violet-200 rounded-lg p-4 bg-gradient-to-br from-violet-50 to-white">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-2xl">🏢</span>
                        <h4 className="font-bold text-violet-900">Floor 2 - First Floor</h4>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="text-center">
                          <p className="text-xs text-gray-600 mb-1">Expected</p>
                          <p className="text-lg font-bold text-blue-700">₹{floor2Stats.totalExpected.toLocaleString('en-IN')}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-600 mb-1">Collected</p>
                          <p className="text-lg font-bold text-green-700">₹{floor2Stats.totalCollected.toLocaleString('en-IN')}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-600 mb-1">Due</p>
                          <p className="text-lg font-bold text-orange-700">₹{floor2Stats.totalDue.toLocaleString('en-IN')}</p>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-violet-200 flex items-center justify-between text-xs">
                        <span className="text-gray-600">{floor2Stats.totalTenants} tenants</span>
                        <span className="text-green-700 font-semibold">{floor2Stats.paidCount} paid</span>
                        <span className="text-orange-700 font-semibold">{floor2Stats.pendingCount} pending</span>
                      </div>
                      <div className="mt-3">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-gradient-to-r from-green-500 to-emerald-600 h-2 rounded-full transition-all duration-500"
                            style={{ width: floor2Stats.totalExpected > 0 ? `${Math.min((floor2Stats.totalCollected / floor2Stats.totalExpected) * 100, 100)}%` : '0%' }}
                          ></div>
                        </div>
                        <p className="text-xs text-gray-600 text-center mt-1">
                          {floor2Stats.totalExpected > 0 ? ((floor2Stats.totalCollected / floor2Stats.totalExpected) * 100).toFixed(1) : 0}% collected
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

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
                    const vacantRooms = getVacantRoomsForFloor(floor1, 1);
                    return (
                      <div>
                        <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                          <span className="text-xl">🏠</span>
                          Floor 1 - Ground Floor ({floor1RoomCount} occupied, {floor1.length} tenants: {paidCount} paid, {pendingCount} pending{vacantRooms.length > 0 ? `, ${vacantRooms.length} vacant` : ''})
                        </h4>
                        {vacantRooms.length > 0 && (
                          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-semibold text-red-600">🔴 Vacant ({vacantRooms.length}):</span>
                            {vacantRooms.map((room) => (
                              <span key={room} className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded font-mono text-xs">{room}</span>
                            ))}
                          </div>
                        )}
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
                                    <span
                                      title={isPaid ? `Paid: ${tenant.paidDate} | Due was: ${tenant.dueDate}` : `Due: ${tenant.dueDate}`}
                                      className={`text-xs px-2 py-1 rounded font-semibold cursor-default`}
                                      style={{
                                        backgroundColor: tenant.dueStatusColor === 'red' ? '#fecaca' :
                                                         tenant.dueStatusColor === 'orange' ? '#fed7aa' :
                                                         tenant.dueStatusColor === 'yellow' ? '#fef08a' :
                                                         tenant.dueStatusColor === 'green' ? '#bbf7d0' : '#e5e7eb',
                                        color: tenant.dueStatusColor === 'red' ? '#991b1b' :
                                               tenant.dueStatusColor === 'orange' ? '#c2410c' :
                                               tenant.dueStatusColor === 'yellow' ? '#a16207' :
                                               tenant.dueStatusColor === 'green' ? '#15803d' : '#4b5563'
                                      }}
                                    >
                                      {tenant.dueStatusText || (isPaid ? '✅ Paid' : '❌ Pending')}
                                    </span>
                                  </div>
                                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                                    <p>Rent: <span className="font-semibold">₹{tenant.expectedRent.toLocaleString('en-IN')}</span></p>
                                    <p>Electricity: <span className="font-semibold text-blue-700">₹{tenant.expectedElectricity.toLocaleString('en-IN')}</span></p>
                                    <p>Expected: <span className="font-semibold">₹{tenant.expectedTotal.toLocaleString('en-IN')}</span></p>
                                    <p>Collected: <span className={`font-semibold ${isPaid ? 'text-green-700' : 'text-red-700'}`}>₹{tenant.collectedAmount.toLocaleString('en-IN')}</span></p>
                                  </div>
                                  <div className="mt-2 text-sm text-gray-700 flex items-center gap-2">
                                    <span className="text-xs text-gray-500">Records: {tenant.paymentRecordsCount || 0}</span>
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
                                            <button
                                              onClick={() => handleViewHistory(tenant)}
                                              className="text-blue-600 hover:text-blue-800 hover:underline font-medium transition-colors cursor-pointer text-left"
                                              title="View Payment History"
                                            >
                                              {tenant.name}
                                            </button>
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
                                          <td className="px-3 py-2 text-center whitespace-nowrap">
                                            <span
                                              title={isPaid ? `Paid: ${tenant.paidDate} | Due was: ${tenant.dueDate}` : `Due: ${tenant.dueDate}`}
                                              className="text-xs font-semibold px-2 py-1 rounded cursor-default"
                                              style={{
                                                backgroundColor: tenant.dueStatusColor === 'red' ? '#fecaca' :
                                                                 tenant.dueStatusColor === 'orange' ? '#fed7aa' :
                                                                 tenant.dueStatusColor === 'yellow' ? '#fef08a' :
                                                                 tenant.dueStatusColor === 'green' ? '#bbf7d0' : '#e5e7eb',
                                                color: tenant.dueStatusColor === 'red' ? '#991b1b' :
                                                       tenant.dueStatusColor === 'orange' ? '#c2410c' :
                                                       tenant.dueStatusColor === 'yellow' ? '#a16207' :
                                                       tenant.dueStatusColor === 'green' ? '#15803d' : '#4b5563'
                                              }}
                                            >
                                              {tenant.dueStatusText || (isPaid ? '✅ Paid' : '❌ Pending')}
                                            </span>
                                          </td>
                                        </tr>
                                        {tenant.roomCount > 1 && expanded && (
                                          <tr className="bg-indigo-50 border-b">
                                            <td className="px-3 py-2" colSpan={7}>
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
                    const vacantRooms = getVacantRoomsForFloor(floor2, 2);
                    return (
                      <div>
                        <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                          <span className="text-xl">🏢</span>
                          Floor 2 - First Floor ({floor2RoomCount} occupied, {floor2.length} tenants: {paidCount} paid, {pendingCount} pending{vacantRooms.length > 0 ? `, ${vacantRooms.length} vacant` : ''})
                        </h4>
                        {vacantRooms.length > 0 && (
                          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-semibold text-red-600">🔴 Vacant ({vacantRooms.length}):</span>
                            {vacantRooms.map((room) => (
                              <span key={room} className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded font-mono text-xs">{room}</span>
                            ))}
                          </div>
                        )}
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
                                    <span
                                      title={isPaid ? `Paid: ${tenant.paidDate} | Due was: ${tenant.dueDate}` : `Due: ${tenant.dueDate}`}
                                      className={`text-xs px-2 py-1 rounded font-semibold cursor-default`}
                                      style={{
                                        backgroundColor: tenant.dueStatusColor === 'red' ? '#fecaca' :
                                                         tenant.dueStatusColor === 'orange' ? '#fed7aa' :
                                                         tenant.dueStatusColor === 'yellow' ? '#fef08a' :
                                                         tenant.dueStatusColor === 'green' ? '#bbf7d0' : '#e5e7eb',
                                        color: tenant.dueStatusColor === 'red' ? '#991b1b' :
                                               tenant.dueStatusColor === 'orange' ? '#c2410c' :
                                               tenant.dueStatusColor === 'yellow' ? '#a16207' :
                                               tenant.dueStatusColor === 'green' ? '#15803d' : '#4b5563'
                                      }}
                                    >
                                      {tenant.dueStatusText || (isPaid ? '✅ Paid' : '❌ Pending')}
                                    </span>
                                  </div>
                                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                                    <p>Rent: <span className="font-semibold">₹{tenant.expectedRent.toLocaleString('en-IN')}</span></p>
                                    <p>Electricity: <span className="font-semibold text-blue-700">₹{tenant.expectedElectricity.toLocaleString('en-IN')}</span></p>
                                    <p>Expected: <span className="font-semibold">₹{tenant.expectedTotal.toLocaleString('en-IN')}</span></p>
                                    <p>Collected: <span className={`font-semibold ${isPaid ? 'text-green-700' : 'text-red-700'}`}>₹{tenant.collectedAmount.toLocaleString('en-IN')}</span></p>
                                  </div>
                                  <div className="mt-2 text-sm text-gray-700 flex items-center gap-2">
                                    <span className="text-xs text-gray-500">Records: {tenant.paymentRecordsCount || 0}</span>
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
                                            <button
                                              onClick={() => handleViewHistory(tenant)}
                                              className="text-blue-600 hover:text-blue-800 hover:underline font-medium transition-colors cursor-pointer text-left"
                                              title="View Payment History"
                                            >
                                              {tenant.name}
                                            </button>
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
                                          <td className="px-3 py-2 text-center whitespace-nowrap">
                                            <span
                                              title={isPaid ? `Paid: ${tenant.paidDate} | Due was: ${tenant.dueDate}` : `Due: ${tenant.dueDate}`}
                                              className="text-xs font-semibold px-2 py-1 rounded cursor-default"
                                              style={{
                                                backgroundColor: tenant.dueStatusColor === 'red' ? '#fecaca' :
                                                                 tenant.dueStatusColor === 'orange' ? '#fed7aa' :
                                                                 tenant.dueStatusColor === 'yellow' ? '#fef08a' :
                                                                 tenant.dueStatusColor === 'green' ? '#bbf7d0' : '#e5e7eb',
                                                color: tenant.dueStatusColor === 'red' ? '#991b1b' :
                                                       tenant.dueStatusColor === 'orange' ? '#c2410c' :
                                                       tenant.dueStatusColor === 'yellow' ? '#a16207' :
                                                       tenant.dueStatusColor === 'green' ? '#15803d' : '#4b5563'
                                              }}
                                            >
                                              {tenant.dueStatusText || (isPaid ? '✅ Paid' : '❌ Pending')}
                                            </span>
                                          </td>
                                        </tr>
                                        {tenant.roomCount > 1 && expanded && (
                                          <tr className="bg-indigo-50 border-b">
                                            <td className="px-3 py-2" colSpan={7}>
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

      {/* Payment History Modal */}
      {selectedTenantHistory && (
        <PaymentHistoryModal
          tenant={selectedTenantHistory}
          payments={paymentHistory}
          electricityReadings={electricityHistory}
          loading={loadingHistory}
          onClose={handleCloseHistory}
        />
      )}

    </div>
  );
};

export default Dashboard;
