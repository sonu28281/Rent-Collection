import { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

const TenantHistory = () => {
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [tenantHistory, setTenantHistory] = useState([]);
  const [meterHistory, setMeterHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tenantDetails, setTenantDetails] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [floorFilter, setFloorFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [historyViewMode, setHistoryViewMode] = useState('card'); // 'card' or 'table'

  const MONTHS = [
    { num: 1, name: 'Jan' }, { num: 2, name: 'Feb' }, { num: 3, name: 'Mar' },
    { num: 4, name: 'Apr' }, { num: 5, name: 'May' }, { num: 6, name: 'Jun' },
    { num: 7, name: 'Jul' }, { num: 8, name: 'Aug' }, { num: 9, name: 'Sep' },
    { num: 10, name: 'Oct' }, { num: 11, name: 'Nov' }, { num: 12, name: 'Dec' }
  ];

  const formatMonthYear = (dateLike) => {
    if (!dateLike) return '-';
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) return '-';
    return `${MONTHS[date.getMonth()]?.name} ${date.getFullYear()}`;
  };

  const formatDate = (dateLike) => {
    if (!dateLike) return '-';
    const date = new Date(dateLike);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-IN');
  };

  const normalizeRoomValue = (roomValue) => {
    if (roomValue === null || roomValue === undefined || roomValue === '') return null;
    const roomText = String(roomValue).trim();
    if (!roomText) return null;

    const numericRoom = Number(roomText);
    return Number.isNaN(numericRoom) ? roomText : numericRoom;
  };

  const getFloorFromRoom = (roomValue) => {
    const normalizedRoom = normalizeRoomValue(roomValue);
    if (normalizedRoom === null) return null;

    const numericRoom = Number(normalizedRoom);
    if (Number.isNaN(numericRoom)) return null;

    return String(Math.floor(numericRoom / 100));
  };

  const getYearMonthFromPayment = (payment) => {
    const explicitYear = Number(payment?.year);
    const explicitMonth = Number(payment?.month);

    if (Number.isFinite(explicitYear) && Number.isFinite(explicitMonth) && explicitMonth >= 1 && explicitMonth <= 12) {
      return { year: explicitYear, month: explicitMonth };
    }

    const fallbackDate = payment?.paidDate || payment?.paymentDate || payment?.date || payment?.createdAt || payment?.paidAt;
    if (!fallbackDate) return null;

    const parsedDate = new Date(fallbackDate);
    if (Number.isNaN(parsedDate.getTime())) return null;

    return {
      year: parsedDate.getFullYear(),
      month: parsedDate.getMonth() + 1
    };
  };

  const formatYearMonthLabel = (year, month) => {
    if (!Number.isFinite(Number(year)) || !Number.isFinite(Number(month))) return '-';
    return `${MONTHS[Number(month) - 1]?.name || month} ${year}`;
  };

  const toSortKey = (year, month) => (Number(year) * 100) + Number(month);

  const getDurationLabel = (startSortKey, endSortKey) => {
    if (!Number.isFinite(startSortKey) || !Number.isFinite(endSortKey) || endSortKey < startSortKey) {
      return '-';
    }

    const startYear = Math.floor(startSortKey / 100);
    const startMonth = startSortKey % 100;
    const endYear = Math.floor(endSortKey / 100);
    const endMonth = endSortKey % 100;

    const totalMonths = ((endYear - startYear) * 12) + (endMonth - startMonth) + 1;
    if (!Number.isFinite(totalMonths) || totalMonths <= 0) return '-';

    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;

    if (years > 0 && months > 0) return `${years}y ${months}m`;
    if (years > 0) return `${years}y`;
    return `${months}m`;
  };

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);

    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);

    return () => {
      mediaQuery.removeEventListener('change', updateViewport);
    };
  }, []);

  // Load all unique tenants from tenants + payments
  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const tenantsRef = collection(db, 'tenants');
        const tenantsSnapshot = await getDocs(tenantsRef);

        const paymentsRef = collection(db, 'payments');
        const paymentsSnapshot = await getDocs(paymentsRef);

        const tenantMap = new Map();

        tenantsSnapshot.docs.forEach((doc) => {
          const data = doc.data();
          const tenantId = doc.id;
          const tenantName = data.name?.trim();
          if (!tenantName) return;
          const nameKey = tenantName.toLowerCase();

          // Ensure isActive is properly calculated
          let isActive = Boolean(data.isActive);
          if (typeof data.isActive === 'undefined') {
            isActive = data.status !== 'inactive';
          }

          if (!tenantMap.has(nameKey)) {
            tenantMap.set(nameKey, {
              id: tenantId,
              allIds: [tenantId],
              name: tenantName,
              isActive: isActive,
              roomNumber: data.roomNumber ?? null,
              checkInDate: data.checkInDate ?? null,
              checkOutDate: data.checkOutDate ?? null,
              firstStaySortKey: null,
              lastStaySortKey: null,
              firstStayLabel: '-',
              lastStayLabel: '-',
              roomsInHistory: [],
              source: 'tenantDoc'
            });
          } else {
            const existing = tenantMap.get(nameKey);
            const allIds = [...new Set([...(existing.allIds || []), tenantId])];
            tenantMap.set(nameKey, {
              ...existing,
              id: existing.id || tenantId,
              allIds,
              isActive: existing.isActive || Boolean(data.isActive),
              roomNumber: existing.roomNumber ?? data.roomNumber ?? null,
              checkInDate: existing.checkInDate ?? data.checkInDate ?? null,
              checkOutDate: existing.checkOutDate ?? data.checkOutDate ?? null
            });
          }
        });

        paymentsSnapshot.docs.forEach((doc) => {
          const data = doc.data();
          const tenantName = (data.tenantNameSnapshot || data.tenantName || '').trim();
          const paymentTenantId = data.tenantId || null;
          const nameKey = tenantName.toLowerCase();

          if (
            !tenantName ||
            tenantName === 'Historical Record' ||
            tenantName === 'Unknown'
          ) {
            return;
          }

          const hasMatchingTenantDoc = paymentTenantId
            ? tenantsSnapshot.docs.some((tenantDoc) => tenantDoc.id === paymentTenantId)
            : false;

          if (hasMatchingTenantDoc) {
            return;
          }

          const yearMonth = getYearMonthFromPayment(data);
          const sortKey = yearMonth ? toSortKey(yearMonth.year, yearMonth.month) : null;
          const roomFromPayment = data.roomNumber ?? null;

          if (!tenantMap.has(nameKey)) {
            tenantMap.set(nameKey, {
              id: paymentTenantId,
              allIds: paymentTenantId ? [paymentTenantId] : [],
              name: tenantName,
              isActive: false,
              roomNumber: roomFromPayment,
              checkInDate: null,
              checkOutDate: null,
              firstStaySortKey: sortKey,
              lastStaySortKey: sortKey,
              firstStayLabel: yearMonth ? formatYearMonthLabel(yearMonth.year, yearMonth.month) : '-',
              lastStayLabel: yearMonth ? formatYearMonthLabel(yearMonth.year, yearMonth.month) : '-',
              roomsInHistory: roomFromPayment !== null && roomFromPayment !== undefined && roomFromPayment !== ''
                ? [String(roomFromPayment)]
                : [],
              source: 'paymentOnly'
            });
            return;
          }

          const existing = tenantMap.get(nameKey);
          const nextFirstSort = Number.isFinite(sortKey) && (!Number.isFinite(existing.firstStaySortKey) || sortKey < existing.firstStaySortKey)
            ? sortKey
            : existing.firstStaySortKey;
          const nextLastSort = Number.isFinite(sortKey) && (!Number.isFinite(existing.lastStaySortKey) || sortKey > existing.lastStaySortKey)
            ? sortKey
            : existing.lastStaySortKey;

          const roomsSet = new Set([...(existing.roomsInHistory || []).map(String)]);
          if (roomFromPayment !== null && roomFromPayment !== undefined && roomFromPayment !== '') {
            roomsSet.add(String(roomFromPayment));
          }

          tenantMap.set(nameKey, {
            ...existing,
            id: existing.id || paymentTenantId,
            allIds: paymentTenantId ? [...new Set([...(existing.allIds || []), paymentTenantId])] : (existing.allIds || []),
            roomNumber: existing.roomNumber ?? roomFromPayment,
            firstStaySortKey: nextFirstSort,
            lastStaySortKey: nextLastSort,
            firstStayLabel: Number.isFinite(nextFirstSort)
              ? formatYearMonthLabel(Math.floor(nextFirstSort / 100), nextFirstSort % 100)
              : '-',
            lastStayLabel: Number.isFinite(nextLastSort)
              ? formatYearMonthLabel(Math.floor(nextLastSort / 100), nextLastSort % 100)
              : '-',
            roomsInHistory: Array.from(roomsSet).sort((a, b) => {
              const roomA = Number(a);
              const roomB = Number(b);
              if (!Number.isNaN(roomA) && !Number.isNaN(roomB)) return roomA - roomB;
              return a.localeCompare(b);
            })
          });
        });

        const tenantList = Array.from(tenantMap.values()).sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        setTenants(tenantList);
      } catch (error) {
        console.error('Error fetching tenants:', error);
      }
    };

    fetchTenants();
  }, []);

  // Load tenant history
  const loadTenantHistory = async (tenantObj) => {
    const tenantName = tenantObj.name;
    const tenantIds = new Set(tenantObj.allIds || (tenantObj.id ? [tenantObj.id] : []));
    setLoading(true);
    setSelectedTenant(tenantObj);
    
    try {
      const paymentsRef = collection(db, 'payments');
      const snapshot = await getDocs(paymentsRef);
      
      // Filter payments for this tenant (match any of the tenant's IDs or name)
      const history = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(p => {
          const name = (p.tenantNameSnapshot || p.tenantName || '').trim();
          if (p.tenantId && tenantIds.has(p.tenantId)) return true;
          if (!p.tenantId && name.toLowerCase() === tenantName.toLowerCase()) return true;
          return false;
        })
        .sort((a, b) => {
          if (a.year !== b.year) return b.year - a.year;
          return b.month - a.month;
        });

      setTenantHistory(history);

      const firstRecord = history.length > 0 ? history[history.length - 1] : null;
      const latestRecord = history.length > 0 ? history[0] : null;

      setTenantDetails({
        joinedMonth: tenantObj.checkInDate
          ? formatMonthYear(tenantObj.checkInDate)
          : firstRecord
            ? `${MONTHS[firstRecord.month - 1]?.name} ${firstRecord.year}`
            : '-',
        joinedDate: tenantObj.checkInDate ? formatDate(tenantObj.checkInDate) : '-',
        leftMonth: tenantObj.checkOutDate
          ? formatMonthYear(tenantObj.checkOutDate)
          : tenantObj.isActive
            ? 'Still Staying'
            : latestRecord
              ? `${MONTHS[latestRecord.month - 1]?.name} ${latestRecord.year}`
              : '-',
        leftDate: tenantObj.checkOutDate ? formatDate(tenantObj.checkOutDate) : '-',
        latestRoom: latestRecord?.roomNumber ?? tenantObj.roomNumber ?? '-',
        status: tenantObj.isActive ? 'Active' : 'Past Tenant'
      });
      
      // Calculate statistics
      const stats = calculateStats(history);
      setStats(stats);

      // Fetch meter history for this tenant (all IDs)
      try {
        const readingsRef = collection(db, 'electricityReadings');
        const allReadings = [];
        for (const tid of tenantIds) {
          const readingQuery = query(readingsRef, where('tenantId', '==', tid));
          const readingsSnapshot = await getDocs(readingQuery);
          readingsSnapshot.docs.forEach(doc => allReadings.push({ id: doc.id, ...doc.data() }));
        }
        setMeterHistory(allReadings);
      } catch (error) {
        console.log('No meter history found for this tenant:', error.message);
        setMeterHistory([]);
      }
      
    } catch (error) {
      console.error('Error loading tenant history:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (history) => {
    if (history.length === 0) return null;

    const totalRent = history.reduce((sum, p) => sum + (Number(p.rent) || 0), 0);
    const totalElectricity = history.reduce((sum, p) => sum + (Number(p.electricity) || 0), 0);
    const totalAmount = totalRent + totalElectricity;
    const totalPaid = history.reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0);
    const totalBalance = history.reduce((sum, p) => sum + (Number(p.balance) || 0), 0);
    const totalUnits = history.reduce((sum, p) => sum + (Number(p.units) || 0), 0);

    const firstRecord = history[history.length - 1];
    const latestRecord = history[0];

    // Get unique rooms tenant stayed in
    const rooms = [...new Set(history.map(p => p.roomNumber))].sort((a, b) => a - b);

    // Calculate stay duration
    const monthsStayed = history.length;
    const yearsStayed = history.length / 12;

    // Get payment status breakdown
    const paidCount = history.filter(p => p.status === 'paid').length;
    const partialCount = history.filter(p => p.status === 'partial').length;
    const unpaidCount = history.filter(p => p.status === 'unpaid' || !p.status).length;

    // Average electricity consumption
    const avgUnitsPerMonth = totalUnits / monthsStayed;
    const avgElectricityPerMonth = totalElectricity / monthsStayed;

    return {
      totalRecords: history.length,
      totalRent,
      totalElectricity,
      totalAmount,
      totalPaid,
      totalBalance,
      totalUnits,
      avgUnitsPerMonth: Math.round(avgUnitsPerMonth),
      avgElectricityPerMonth: Math.round(avgElectricityPerMonth),
      firstRecord: `${MONTHS[firstRecord.month - 1]?.name} ${firstRecord.year}`,
      latestRecord: `${MONTHS[latestRecord.month - 1]?.name} ${latestRecord.year}`,
      rooms,
      monthsStayed,
      yearsStayed: yearsStayed.toFixed(1),
      paidCount,
      partialCount,
      unpaidCount
    };
  };

  // Group history by year
  const groupByYear = (history) => {
    const grouped = {};
    history.forEach(record => {
      if (!grouped[record.year]) {
        grouped[record.year] = [];
      }
      grouped[record.year].push(record);
    });
    return grouped;
  };

  // Merge records by month (combine multiple rooms into one record)
  const mergeRecordsByMonth = (records) => {
    const grouped = {};
    
    records.forEach(record => {
      const monthKey = `${record.year}-${String(record.month).padStart(2, '0')}`;
      
      if (!grouped[monthKey]) {
        grouped[monthKey] = {
          year: record.year,
          month: record.month,
          monthKey,
          rooms: [],
          totalRent: 0,
          totalElectricity: 0,
          totalPaid: 0,
          totalUnits: 0,
          statuses: new Set(),
          records: [] // Keep original records for reference
        };
      }
      
      const rent = Number(record.rent) || 0;
      const electricity = Number(record.electricity) || 0;
      const paid = Number(record.paidAmount) || 0;
      const units = Number(record.units) || 0;
      
      grouped[monthKey].rooms.push({
        roomNumber: record.roomNumber,
        rent,
        electricity,
        paid,
        units,
        status: record.status
      });
      grouped[monthKey].totalRent += rent;
      grouped[monthKey].totalElectricity += electricity;
      grouped[monthKey].totalPaid += paid;
      grouped[monthKey].totalUnits += units;
      grouped[monthKey].statuses.add(record.status);
      grouped[monthKey].records.push(record);
    });
    
    return Object.values(grouped).sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      return b.month - a.month;
    });
  };

  const floorOptions = [...new Set(
    tenants
      .map((tenant) => getFloorFromRoom(tenant.roomNumber))
      .filter(Boolean)
  )].sort((a, b) => Number(a) - Number(b));

  const roomOptions = [...new Set(
    tenants
      .filter((tenant) => {
        if (floorFilter === 'all') return true;
        return getFloorFromRoom(tenant.roomNumber) === floorFilter;
      })
      .map((tenant) => normalizeRoomValue(tenant.roomNumber))
      .filter((room) => room !== null)
      .map((room) => String(room))
  )].sort((a, b) => {
    const roomA = Number(a);
    const roomB = Number(b);
    if (!Number.isNaN(roomA) && !Number.isNaN(roomB)) return roomA - roomB;
    return a.localeCompare(b);
  });

  useEffect(() => {
    if (roomFilter === 'all') return;
    const roomStillAvailable = roomOptions.includes(roomFilter);
    if (!roomStillAvailable) {
      setRoomFilter('all');
    }
  }, [floorFilter, roomFilter, roomOptions]);

  // Filter tenants based on status + floor + room + search
  const filteredTenants = tenants.filter((tenant) => {
    const matchesSearch = tenant.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && tenant.isActive) ||
      (statusFilter === 'past' && !tenant.isActive);
    const tenantFloor = getFloorFromRoom(tenant.roomNumber);
    const tenantRoom = normalizeRoomValue(tenant.roomNumber);
    const matchesFloor = floorFilter === 'all' || tenantFloor === floorFilter;
    const matchesRoom = roomFilter === 'all' || String(tenantRoom) === roomFilter;

    return matchesSearch && matchesStatus && matchesFloor && matchesRoom;
  });

  useEffect(() => {
    if (!selectedTenant) return;
    const stillVisible = filteredTenants.some((tenant) => tenant.name === selectedTenant.name);
    if (!stillVisible) {
      setSelectedTenant(null);
      setTenantHistory([]);
      setMeterHistory([]);
      setStats(null);
      setTenantDetails(null);
    }
  }, [filteredTenants, selectedTenant]);

  return (
    <div className="container mx-auto px-4 py-4 max-w-7xl">
      {/* Header */}
      <div className="mb-3">
        <h1 className="text-2xl font-bold text-gray-800 mb-1">👤 Tenant History</h1>
        <p className="text-sm text-gray-600">
          View complete payment records, stay duration, and consumption patterns for each tenant
        </p>
      </div>

      {/* Tenant Selection */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-bold text-gray-800">Select Tenant</h2>
          <span className="text-xs text-gray-500">Showing {filteredTenants.length} of {tenants.length}</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 mb-3">
          <div className="lg:col-span-5">
            <input
              type="text"
              placeholder="🔍 Search tenant..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          <div className="lg:col-span-3">
            <select
              value={floorFilter}
              onChange={(e) => setFloorFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="all">All Floors</option>
              {floorOptions.map((floor) => (
                <option key={floor} value={floor}>
                  Floor {floor}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-4">
            <select
              value={roomFilter}
              onChange={(e) => setRoomFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md bg-white focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="all">All Rooms</option>
              {roomOptions.map((room) => (
                <option key={room} value={room}>
                  Room {room}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${
              statusFilter === 'all'
                ? 'bg-indigo-500 text-white border-indigo-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
            }`}
          >
            All ({tenants.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${
              statusFilter === 'active'
                ? 'bg-green-500 text-white border-green-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
            }`}
          >
            Active ({tenants.filter((tenant) => tenant.isActive).length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('past')}
            className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${
              statusFilter === 'past'
                ? 'bg-gray-700 text-white border-gray-800'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
            }`}
          >
            Past ({tenants.filter((tenant) => !tenant.isActive).length})
          </button>
        </div>

        {/* Tenant List */}
        {filteredTenants.length === 0 ? (
          <div className="text-center py-5 text-sm text-gray-500">
            {searchQuery || statusFilter !== 'all' || floorFilter !== 'all' || roomFilter !== 'all'
              ? 'No tenants found for selected filters'
              : 'No tenants found in database'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
            {filteredTenants.map((tenant, idx) => {
              const isSelected = selectedTenant?.name === tenant.name;
              const sinceLabel = tenant.checkInDate
                ? formatMonthYear(tenant.checkInDate)
                : (tenant.firstStayLabel || '-');
              const tillLabel = tenant.checkOutDate
                ? formatMonthYear(tenant.checkOutDate)
                : (tenant.isActive ? 'Present' : (tenant.lastStayLabel || '-'));
              const durationLabel = getDurationLabel(
                tenant.firstStaySortKey,
                tenant.isActive ? tenant.lastStaySortKey : tenant.lastStaySortKey
              );
              const roomsLabel = (tenant.roomsInHistory && tenant.roomsInHistory.length > 0)
                ? tenant.roomsInHistory.join(', ')
                : (tenant.roomNumber ?? '-');
              
              return (
                <button
                  key={idx}
                  onClick={() => loadTenantHistory(tenant)}
                  className={`p-2.5 rounded-md border text-left transition-all ${
                    isSelected
                      ? 'bg-indigo-500 text-white border-indigo-600 shadow'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-xs leading-tight">👤 {tenant.name}</div>
                    <div className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : tenant.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-200 text-gray-700'
                    }`}>
                      {tenant.isActive ? 'Active' : 'Past'}
                    </div>
                  </div>

                  <div className={`mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] ${isSelected ? 'text-indigo-50' : 'text-gray-600'}`}>
                    <div>
                      <span className="font-semibold">Since:</span> {sinceLabel}
                    </div>
                    <div>
                      <span className="font-semibold">Till:</span> {tillLabel}
                    </div>
                    <div>
                      <span className="font-semibold">Stay:</span> {durationLabel}
                    </div>
                    <div>
                      <span className="font-semibold">Rooms:</span> {roomsLabel}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Loading State */}
      {loading && (
        <div className="card text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading tenant history...</p>
        </div>
      )}

      {/* Statistics Summary */}
      {!loading && stats && selectedTenant && (
        <>
          {/* Tenant Header */}
          <div className="card mb-6 bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3 pb-3 border-b border-indigo-200">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-2xl font-bold text-gray-800">👤 {selectedTenant.name}</h2>
                  {tenantDetails?.status && (
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tenantDetails.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>
                      {tenantDetails.status}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-0.5">
                  {stats.totalRecords} records • {stats.firstRecord} → {stats.latestRecord}
                </p>
              </div>
              <div className="text-sm font-semibold px-3 py-1.5 rounded-full bg-indigo-100 text-indigo-800 w-fit">
                {stats.yearsStayed} years stay
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-sm">
              <div className="bg-white rounded-lg p-3 border border-indigo-200 space-y-1.5">
                <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">Stay Timeline</p>
                <p><span className="text-gray-500">Since:</span> <span className="font-semibold text-gray-800">{tenantDetails?.joinedMonth || '-'}</span></p>
                <p><span className="text-gray-500">Till:</span> <span className="font-semibold text-gray-800">{tenantDetails?.leftMonth || (selectedTenant.isActive ? 'Present' : '-')}</span></p>
                <p><span className="text-gray-500">Latest Room:</span> <span className="font-semibold text-gray-800">{tenantDetails?.latestRoom ?? '-'}</span></p>
                <p><span className="text-gray-500">Rooms Stayed:</span> <span className="font-semibold text-gray-800">{stats.rooms.join(', ')}</span></p>
              </div>

              <div className="bg-white rounded-lg p-3 border border-green-200 space-y-1.5">
                <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Financial Summary</p>
                <p><span className="text-gray-500">Total Rent:</span> <span className="font-semibold text-gray-800">₹{stats.totalRent.toLocaleString('en-IN')}</span></p>
                <p><span className="text-gray-500">Electricity:</span> <span className="font-semibold text-gray-800">₹{stats.totalElectricity.toLocaleString('en-IN')}</span></p>
                <p><span className="text-gray-500">Grand Total:</span> <span className="font-semibold text-gray-800">₹{stats.totalAmount.toLocaleString('en-IN')}</span></p>
                <p><span className="text-gray-500">Paid:</span> <span className="font-semibold text-green-700">₹{stats.totalPaid.toLocaleString('en-IN')}</span></p>
                <p><span className="text-gray-500">Balance:</span> <span className={`font-semibold ${stats.totalBalance < 0 ? 'text-red-600' : 'text-orange-600'}`}>₹{stats.totalBalance.toLocaleString('en-IN')}</span></p>
              </div>

              <div className="bg-white rounded-lg p-3 border border-blue-200 space-y-1.5">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Usage & Payment Health</p>
                <p><span className="text-gray-500">Total Months:</span> <span className="font-semibold text-gray-800">{stats.monthsStayed}</span></p>
                <p><span className="text-gray-500">Avg Units/Month:</span> <span className="font-semibold text-gray-800">{stats.avgUnitsPerMonth}</span></p>
                <p><span className="text-gray-500">Avg Elec/Month:</span> <span className="font-semibold text-gray-800">₹{stats.avgElectricityPerMonth}</span></p>
                <p><span className="text-gray-500">Paid / Partial / Unpaid:</span> <span className="font-semibold text-gray-800">{stats.paidCount} / {stats.partialCount} / {stats.unpaidCount}</span></p>
              </div>
            </div>
          </div>

          {/* Payment History by Year */}
          <div className="space-y-4">
            {Object.entries(groupByYear(tenantHistory))
              .sort(([yearA], [yearB]) => Number(yearB) - Number(yearA))
              .map(([year, records]) => {
                const yearTotals = calculateStats(records);
                
                return (
                  <div key={year} className="card">
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                      <div>
                        <h3 className="text-xl font-bold text-gray-800">{year}</h3>
                        <p className="text-sm text-gray-600">{records.length} months • {yearTotals.totalUnits} units consumed</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-600">Year Total</p>
                        <p className="text-2xl font-bold text-green-600">
                          ₹{yearTotals.totalAmount.toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>

                    {isMobileViewport ? (
                      <div className="space-y-3">
                        {mergeRecordsByMonth(records).map((merged) => {
                          const total = merged.totalRent + merged.totalElectricity;
                          const balance = merged.totalRent + merged.totalElectricity - merged.totalPaid;
                          const roomList = merged.rooms.map(r => r.roomNumber).sort((a, b) => a - b);
                          
                          // Determine status
                          let statusColor = 'bg-green-100 text-green-800';
                          let statusText = 'Paid';
                          if (merged.statuses.has('unpaid')) {
                            statusColor = 'bg-red-100 text-red-800';
                            statusText = 'Unpaid';
                          } else if (merged.statuses.has('partial')) {
                            statusColor = 'bg-yellow-100 text-yellow-800';
                            statusText = merged.statuses.size > 1 ? 'Mixed' : 'Partial';
                          }

                          return (
                            <div key={merged.monthKey} className="rounded-lg border border-gray-200 p-3 bg-white">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-xs text-gray-500">Month</p>
                                  <p className="font-semibold text-gray-900">{MONTHS[merged.month - 1]?.name} {merged.year}</p>
                                </div>
                                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColor}`}>
                                  {statusText}
                                </span>
                              </div>

                              <div className="mt-2 flex gap-1 flex-wrap">
                                {roomList.map((room) => (
                                  <span 
                                    key={room}
                                    className={`px-2 py-1 rounded text-xs font-semibold ${
                                      room < 200
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-purple-100 text-purple-700'
                                    }`}
                                  >
                                    Room {room}
                                  </span>
                                ))}
                              </div>

                              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                <p>Rent: <span className="font-semibold">₹{merged.totalRent.toLocaleString('en-IN')}</span></p>
                                <p>Paid: <span className="font-semibold">₹{merged.totalPaid.toLocaleString('en-IN')}</span></p>
                                <p>Units: <span className="font-semibold text-blue-600">{merged.totalUnits}</span></p>
                                <p>Electricity: <span className="font-semibold">₹{merged.totalElectricity.toLocaleString('en-IN')}</span></p>
                                <p>Total: <span className="font-semibold">₹{total.toLocaleString('en-IN')}</span></p>
                                <p>Balance: <span className={`font-semibold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>₹{Math.abs(balance).toLocaleString('en-IN')}</span></p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <>
                        {/* View Mode Toggle - Only on Desktop */}
                        {!isMobileViewport && (
                          <div className="mb-3 flex gap-2">
                            <button
                              onClick={() => setHistoryViewMode('card')}
                              className={`px-3 py-1 rounded-lg text-sm font-semibold transition-all ${
                                historyViewMode === 'card'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                              }`}
                            >
                              🃏 Card View
                            </button>
                            <button
                              onClick={() => setHistoryViewMode('table')}
                              className={`px-3 py-1 rounded-lg text-sm font-semibold transition-all ${
                                historyViewMode === 'table'
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                              }`}
                            >
                              📊 Table View
                            </button>
                          </div>
                        )}

                        {historyViewMode === 'card' || isMobileViewport ? (
                          <div className="space-y-3">
                            {mergeRecordsByMonth(records).map((merged) => {
                              const total = merged.totalRent + merged.totalElectricity;
                              const balance = merged.totalRent + merged.totalElectricity - merged.totalPaid;
                              const roomList = merged.rooms.map(r => r.roomNumber).sort((a, b) => a - b);
                              
                              // Get meter readings for this month if available
                              const monthMeterReadings = meterHistory.filter(m => {
                                const mDate = new Date(m.readingDate || m.createdAt);
                                return mDate.getMonth() + 1 === merged.month && mDate.getFullYear() === merged.year;
                              });
                              
                              let statusColor = 'bg-green-100 text-green-800';
                              let statusText = 'Paid';
                              if (merged.statuses.has('unpaid')) {
                                statusColor = 'bg-red-100 text-red-800';
                                statusText = 'Unpaid';
                              } else if (merged.statuses.has('partial')) {
                                statusColor = 'bg-yellow-100 text-yellow-800';
                                statusText = merged.statuses.size > 1 ? 'Mixed' : 'Partial';
                              }

                              return (
                                <div key={merged.monthKey} className="rounded-lg border border-gray-200 p-3 bg-white">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-xs text-gray-500">Month</p>
                                      <p className="font-semibold text-gray-900">{MONTHS[merged.month - 1]?.name} {merged.year}</p>
                                    </div>
                                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColor}`}>
                                      {statusText}
                                    </span>
                                  </div>

                                  <div className="mt-2 flex gap-1 flex-wrap">
                                    {roomList.map((room) => (
                                      <span 
                                        key={room}
                                        className={`px-2 py-1 rounded text-xs font-semibold ${
                                          room < 200
                                            ? 'bg-green-100 text-green-700'
                                            : 'bg-purple-100 text-purple-700'
                                        }`}
                                      >
                                        Room {room}
                                      </span>
                                    ))}
                                  </div>

                                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                    <p>Rent: <span className="font-semibold">₹{merged.totalRent.toLocaleString('en-IN')}</span></p>
                                    <p>Paid: <span className="font-semibold">₹{merged.totalPaid.toLocaleString('en-IN')}</span></p>
                                    <p>Units: <span className="font-semibold text-blue-600">{merged.totalUnits}</span></p>
                                    <p>Electricity: <span className="font-semibold">₹{merged.totalElectricity.toLocaleString('en-IN')}</span></p>
                                    <p>Total: <span className="font-semibold">₹{total.toLocaleString('en-IN')}</span></p>
                                    <p>Balance: <span className={`font-semibold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>₹{Math.abs(balance).toLocaleString('en-IN')}</span></p>
                                  </div>

                                  {monthMeterReadings.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-gray-200">
                                      <p className="text-xs font-semibold text-gray-600 mb-2">⚡ Meter Readings:</p>
                                      <div className="grid grid-cols-2 gap-2 text-xs">
                                        {monthMeterReadings.map((reading, idx) => (
                                          <div key={idx} className="bg-blue-50 p-2 rounded">
                                            <p className="text-gray-600">Prev: <span className="font-semibold">{reading.previousReading}</span></p>
                                            <p className="text-gray-600">Curr: <span className="font-semibold">{reading.currentReading}</span></p>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {(() => {
                                    const record = merged.records[0];
                                    const paymentDate = record?.paidDate || record?.paymentDate;
                                    const submissionDate = record?.submissionDate;
                                    const verifiedAt = record?.verifiedAt;
                                    const delayDays = record?.paymentDelayDays;
                                    const isOnTime = record?.isPaymentOnTime;
                                    
                                    if (!paymentDate && !submissionDate && !verifiedAt) return null;
                                    
                                    return (
                                      <div className="mt-3 pt-3 border-t border-gray-200">
                                        <p className="text-xs font-semibold text-gray-600 mb-2">📅 Payment Timeline:</p>
                                        <div className="space-y-1 text-xs">
                                          {paymentDate && (
                                            <p>💳 Payment: <span className="font-semibold">{new Date(paymentDate).toLocaleDateString('en-IN')}</span></p>
                                          )}
                                          {submissionDate && (
                                            <p>📝 Submitted: <span className="font-semibold">{new Date(submissionDate).toLocaleDateString('en-IN')}</span></p>
                                          )}
                                          {verifiedAt && (
                                            <p>✅ Verified: <span className="font-semibold">{new Date(verifiedAt).toLocaleDateString('en-IN')}</span></p>
                                          )}
                                          {delayDays !== undefined && (
                                            <p>⏱️ Delay: <span className={`font-semibold ${isOnTime ? 'text-green-600' : 'text-red-600'}`}>
                                              {isOnTime ? 'On-Time' : `${delayDays} days`}
                                            </span></p>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Month</th>
                                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Rooms</th>
                                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Prev Rdg</th>
                                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Curr Rdg</th>
                                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Units</th>
                                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Total Rent</th>
                                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Electricity</th>
                                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Total</th>
                                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Paid</th>
                                  <th className="px-3 py-2 text-right font-semibold text-gray-700">Balance</th>
                                  <th className="px-3 py-2 text-center font-semibold text-gray-700">Status</th>
                                  <th className="px-3 py-2 text-center font-semibold text-gray-700">💳 Payment Date</th>
                                  <th className="px-3 py-2 text-center font-semibold text-gray-700">📝 Submitted</th>
                                  <th className="px-3 py-2 text-center font-semibold text-gray-700">✅ Verified</th>
                                  <th className="px-3 py-2 text-center font-semibold text-gray-700">⏱️ Delay</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {mergeRecordsByMonth(records).map((merged) => {
                              const total = merged.totalRent + merged.totalElectricity;
                              const balance = merged.totalRent + merged.totalElectricity - merged.totalPaid;
                              const roomList = merged.rooms.map(r => r.roomNumber).sort((a, b) => a - b);
                              
                              // Determine status based on all room statuses
                              let statusColor = 'bg-green-100 text-green-800';
                              let statusText = 'Paid';
                              if (merged.statuses.has('unpaid')) {
                                statusColor = 'bg-red-100 text-red-800';
                                statusText = 'Unpaid';
                              } else if (merged.statuses.has('partial')) {
                                statusColor = 'bg-yellow-100 text-yellow-800';
                                statusText = merged.statuses.size > 1 ? 'Mixed' : 'Partial';
                              }

                              return (
                                <tr key={merged.monthKey} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 font-semibold">
                                    {MONTHS[merged.month - 1]?.name} {merged.year}
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex gap-1 flex-wrap">
                                      {roomList.map((room) => (
                                        <span 
                                          key={room}
                                          className={`px-2 py-1 rounded text-xs font-semibold ${
                                            room < 200
                                              ? 'bg-green-100 text-green-700'
                                              : 'bg-purple-100 text-purple-700'
                                          }`}
                                        >
                                          {room}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono text-sm">
                                    {(() => {
                                      const monthMeter = meterHistory.find(m => {
                                        const mDate = new Date(m.readingDate || m.createdAt);
                                        return mDate.getMonth() + 1 === merged.month && mDate.getFullYear() === merged.year;
                                      });
                                      return monthMeter ? monthMeter.previousReading : '-';
                                    })()}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono text-sm">
                                    {(() => {
                                      const monthMeter = meterHistory.find(m => {
                                        const mDate = new Date(m.readingDate || m.createdAt);
                                        return mDate.getMonth() + 1 === merged.month && mDate.getFullYear() === merged.year;
                                      });
                                      return monthMeter ? monthMeter.currentReading : '-';
                                    })()}
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold text-blue-600">
                                    {merged.totalUnits}
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold">
                                    ₹{merged.totalRent.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                    ₹{merged.totalElectricity.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold">
                                    ₹{total.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-3 py-2 text-right text-green-600 font-semibold">
                                    ₹{merged.totalPaid.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold">
                                    <span className={balance > 0 ? 'text-red-600' : 'text-green-600'}>
                                      ₹{Math.abs(balance).toLocaleString('en-IN')}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColor}`}>
                                      {statusText}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-center text-xs">
                                    {(() => {
                                      const record = merged.records[0];
                                      const paymentDate = record?.paidDate || record?.paymentDate;
                                      return paymentDate ? new Date(paymentDate).toLocaleDateString('en-IN') : '-';
                                    })()}
                                  </td>
                                  <td className="px-3 py-2 text-center text-xs">
                                    {(() => {
                                      const record = merged.records[0];
                                      const submissionDate = record?.submissionDate;
                                      return submissionDate ? new Date(submissionDate).toLocaleDateString('en-IN') : '-';
                                    })()}
                                  </td>
                                  <td className="px-3 py-2 text-center text-xs">
                                    {(() => {
                                      const record = merged.records[0];
                                      const verifiedAt = record?.verifiedAt;
                                      return verifiedAt ? new Date(verifiedAt).toLocaleDateString('en-IN') : '-';
                                    })()}
                                  </td>
                                  <td className="px-3 py-2 text-center text-xs font-semibold">
                                    {(() => {
                                      const record = merged.records[0];
                                      const delayDays = record?.paymentDelayDays;
                                      const isOnTime = record?.isPaymentOnTime;
                                      if (delayDays === undefined) return '-';
                                      if (isOnTime) return <span className="text-green-600">On-Time</span>;
                                      return <span className="text-red-600">{delayDays} days</span>;
                                    })()}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
          </div>

          {/* Meter History Section */}
          {meterHistory.length > 0 && (
            <div className="card bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-200">
              <h3 className="text-xl font-bold text-gray-800 mb-4 pb-2 border-b border-blue-200">⚡ Meter Reading History</h3>
              
              {isMobileViewport ? (
                <div className="space-y-3">
                  {meterHistory.sort((a, b) => new Date(b.readingDate || b.createdAt) - new Date(a.readingDate || a.createdAt)).map((reading) => {
                    const readingDate = new Date(reading.readingDate || reading.createdAt);
                    const monthLabel = readingDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
                    const unitsConsumed = Number(reading.unitsConsumed ?? 0);
                    const totalCharge = Number(reading.totalCharge ?? 0);
                    
                    return (
                      <div key={reading.id} className="bg-white rounded-lg border border-blue-200 p-4 space-y-2">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-semibold text-gray-800">{monthLabel}</h4>
                          <span className="text-xs font-semibold px-2 py-1 rounded-full bg-blue-100 text-blue-700">Meter</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div className="bg-gray-50 p-2 rounded">
                            <p className="text-xs text-gray-600">Previous Reading</p>
                            <p className="font-mono font-bold text-gray-800">{reading.previousReading}</p>
                          </div>
                          <div className="bg-gray-50 p-2 rounded">
                            <p className="text-xs text-gray-600">Current Reading</p>
                            <p className="font-mono font-bold text-gray-800">{reading.currentReading}</p>
                          </div>
                          <div className="bg-blue-50 p-2 rounded">
                            <p className="text-xs text-blue-600">Units Consumed</p>
                            <p className="font-bold text-blue-800">{unitsConsumed} units</p>
                          </div>
                          <div className="bg-green-50 p-2 rounded">
                            <p className="text-xs text-green-600">Charge</p>
                            <p className="font-bold text-green-800">₹{totalCharge.toFixed(2)}</p>
                          </div>
                        </div>
                        <p className="text-xs text-gray-500 pt-1 border-t border-gray-200">
                          {formatDate(reading.readingDate || reading.createdAt)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="overflow-x-auto border border-blue-200 rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-blue-100 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Date</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Previous Reading</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Current Reading</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Units Consumed</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Charge</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-blue-100">
                      {meterHistory.sort((a, b) => new Date(b.readingDate || b.createdAt) - new Date(a.readingDate || a.createdAt)).map((reading) => {
                        const unitsConsumed = Number(reading.unitsConsumed ?? 0);
                        const totalCharge = Number(reading.totalCharge ?? 0);
                        
                        return (
                          <tr key={reading.id} className="hover:bg-blue-50">
                            <td className="px-3 py-2 font-semibold">
                              {formatDate(reading.readingDate || reading.createdAt)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono">{reading.previousReading}</td>
                            <td className="px-3 py-2 text-right font-mono text-blue-600 font-semibold">{reading.currentReading}</td>
                            <td className="px-3 py-2 text-right font-semibold text-blue-600">{unitsConsumed}</td>
                            <td className="px-3 py-2 text-right font-semibold text-green-600">₹{totalCharge.toFixed(2)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Empty State */}
      {!loading && !selectedTenant && (
        <div className="card text-center py-12">
          <div className="text-5xl mb-4">👤</div>
          <p className="text-gray-600 text-lg">Select a tenant to view their complete history</p>
        </div>
      )}

      {!loading && selectedTenant && tenantHistory.length === 0 && (
        <div className="card text-center py-12">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-gray-600 text-lg">No payment history found for {selectedTenant.name}</p>
        </div>
      )}
    </div>
  );
};

export default TenantHistory;
