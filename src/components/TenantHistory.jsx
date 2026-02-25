import { useState, useEffect } from 'react';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

const TenantHistory = () => {
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [tenantHistory, setTenantHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [tenantDetails, setTenantDetails] = useState(null);

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
          const tenantName = data.name?.trim();
          if (!tenantName) return;

          if (!tenantMap.has(tenantName)) {
            tenantMap.set(tenantName, {
              name: tenantName,
              isActive: Boolean(data.isActive),
              roomNumber: data.roomNumber ?? null,
              checkInDate: data.checkInDate ?? null,
              checkOutDate: data.checkOutDate ?? null,
              source: 'tenantDoc'
            });
          } else {
            const existing = tenantMap.get(tenantName);
            tenantMap.set(tenantName, {
              ...existing,
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
          if (
            !tenantName ||
            tenantName === 'Historical Record' ||
            tenantName === 'Unknown'
          ) {
            return;
          }

          if (!tenantMap.has(tenantName)) {
            tenantMap.set(tenantName, {
              name: tenantName,
              isActive: false,
              roomNumber: data.roomNumber ?? null,
              checkInDate: null,
              checkOutDate: null,
              source: 'paymentOnly'
            });
          }
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
    setLoading(true);
    setSelectedTenant(tenantObj);
    
    try {
      const paymentsRef = collection(db, 'payments');
      const snapshot = await getDocs(paymentsRef);
      
      // Filter payments for this tenant
      const history = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(p => {
          const name = p.tenantNameSnapshot || p.tenantName;
          return name === tenantName;
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

  // Filter tenants based on search
  const filteredTenants = tenants.filter(tenant =>
    tenant.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">👤 Tenant History</h1>
        <p className="text-gray-600">
          View complete payment records, stay duration, and consumption patterns for each tenant
        </p>
      </div>

      {/* Tenant Selection */}
      <div className="card mb-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Select Tenant</h2>
        
        {/* Search Box */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="🔍 Search tenant by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>

        {/* Tenant List */}
        {filteredTenants.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchQuery ? 'No tenants found matching your search' : 'No tenants found in database'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
            {filteredTenants.map((tenant, idx) => {
              const isSelected = selectedTenant?.name === tenant.name;
              
              return (
                <button
                  key={idx}
                  onClick={() => loadTenantHistory(tenant)}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    isSelected
                      ? 'bg-indigo-500 text-white border-indigo-600 shadow-lg'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold text-lg">👤 {tenant.name}</div>
                  <div className={`text-xs mt-1 font-semibold ${isSelected ? 'text-indigo-100' : 'text-gray-500'}`}>
                    {tenant.isActive ? '🟢 Active' : '⚪ Past Tenant'}
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
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-3xl font-bold text-gray-800">
                  👤 {selectedTenant.name}
                </h2>
                <p className="text-gray-600 mt-1">
                  {stats.totalRecords} records • From {stats.firstRecord} to {stats.latestRecord}
                </p>
              </div>
              <div className="text-sm font-semibold px-4 py-2 rounded-full bg-indigo-200 text-indigo-900">
                {stats.yearsStayed} years
              </div>
            </div>

            {/* Stay Timeline */}
            {tenantDetails && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                <div className="bg-white rounded-lg p-3 border border-indigo-200">
                  <p className="text-xs text-gray-600 mb-1">Status</p>
                  <p className={`text-sm font-bold ${tenantDetails.status === 'Active' ? 'text-green-600' : 'text-gray-700'}`}>
                    {tenantDetails.status}
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 border border-blue-200">
                  <p className="text-xs text-gray-600 mb-1">Joined Month</p>
                  <p className="text-sm font-bold text-blue-700">{tenantDetails.joinedMonth}</p>
                </div>
                <div className="bg-white rounded-lg p-3 border border-cyan-200">
                  <p className="text-xs text-gray-600 mb-1">Joined Date</p>
                  <p className="text-sm font-bold text-cyan-700">{tenantDetails.joinedDate}</p>
                </div>
                <div className="bg-white rounded-lg p-3 border border-orange-200">
                  <p className="text-xs text-gray-600 mb-1">Left Month</p>
                  <p className="text-sm font-bold text-orange-700">{tenantDetails.leftMonth}</p>
                </div>
                <div className="bg-white rounded-lg p-3 border border-purple-200">
                  <p className="text-xs text-gray-600 mb-1">Latest Room</p>
                  <p className="text-sm font-bold text-purple-700">{tenantDetails.latestRoom}</p>
                </div>
              </div>
            )}

            {/* Duration & Rooms */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div className="bg-white rounded-lg p-3 border border-indigo-200">
                <p className="text-xs text-gray-600 mb-1">Total Months</p>
                <p className="text-xl font-bold text-indigo-600">{stats.monthsStayed}</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-purple-200">
                <p className="text-xs text-gray-600 mb-1">Rooms Stayed</p>
                <p className="text-xl font-bold text-purple-600">{stats.rooms.join(', ')}</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-blue-200">
                <p className="text-xs text-gray-600 mb-1">Avg Units/Month</p>
                <p className="text-xl font-bold text-blue-600">{stats.avgUnitsPerMonth}</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-cyan-200">
                <p className="text-xs text-gray-600 mb-1">Avg Electricity/Mo</p>
                <p className="text-xl font-bold text-cyan-600">₹{stats.avgElectricityPerMonth}</p>
              </div>
            </div>

            {/* Financial Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
              <div className="bg-white rounded-lg p-3 border border-blue-200">
                <p className="text-xs text-gray-600 mb-1">Total Rent</p>
                <p className="text-xl font-bold text-blue-600">₹{stats.totalRent.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-purple-200">
                <p className="text-xs text-gray-600 mb-1">Total Electricity</p>
                <p className="text-xl font-bold text-purple-600">₹{stats.totalElectricity.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <p className="text-xs text-gray-600 mb-1">Grand Total</p>
                <p className="text-xl font-bold text-green-600">₹{stats.totalAmount.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-teal-200">
                <p className="text-xs text-gray-600 mb-1">Total Paid</p>
                <p className="text-xl font-bold text-teal-600">₹{stats.totalPaid.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-orange-200">
                <p className="text-xs text-gray-600 mb-1">Total Balance</p>
                <p className={`text-xl font-bold ${stats.totalBalance < 0 ? 'text-red-600' : 'text-orange-600'}`}>
                  ₹{stats.totalBalance.toLocaleString('en-IN')}
                </p>
              </div>
            </div>

            {/* Payment Status */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-white rounded-lg p-3 border border-green-200">
                <p className="text-xs text-gray-600 mb-1">✅ Paid</p>
                <p className="text-xl font-bold text-green-600">{stats.paidCount} months</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-yellow-200">
                <p className="text-xs text-gray-600 mb-1">⚠️ Partial</p>
                <p className="text-xl font-bold text-yellow-600">{stats.partialCount} months</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-red-200">
                <p className="text-xs text-gray-600 mb-1">❌ Unpaid</p>
                <p className="text-xl font-bold text-red-600">{stats.unpaidCount} months</p>
              </div>
            </div>
          </div>

          {/* Payment History by Year */}
          <div className="space-y-6">
            {Object.entries(groupByYear(tenantHistory))
              .sort(([yearA], [yearB]) => Number(yearB) - Number(yearA))
              .map(([year, records]) => {
                const yearTotals = calculateStats(records);
                
                return (
                  <div key={year} className="card">
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
                      <div>
                        <h3 className="text-2xl font-bold text-gray-800">{year}</h3>
                        <p className="text-sm text-gray-600">{records.length} months • {yearTotals.totalUnits} units consumed</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-600">Year Total</p>
                        <p className="text-2xl font-bold text-green-600">
                          ₹{yearTotals.totalAmount.toLocaleString('en-IN')}
                        </p>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Month</th>
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Room</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-700">Rent</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-700">Old Reading</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-700">Current Reading</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-700">Units</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-700">Rate</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-700">Electricity</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-700">Total</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-700">Paid</th>
                            <th className="px-3 py-2 text-center font-semibold text-gray-700">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {records.map((record) => {
                            const rent = Number(record.rent) || 0;
                            const electricity = Number(record.electricity) || 0;
                            const total = rent + electricity;
                            const paid = Number(record.paidAmount) || 0;
                            const units = record.units || 0;
                            const oldReading = record.oldReading || 0;
                            const currentReading = record.currentReading || 0;
                            const ratePerUnit = record.ratePerUnit || 0;

                            return (
                              <tr key={record.id} className="hover:bg-gray-50">
                                <td className="px-3 py-2 font-semibold">
                                  {MONTHS[record.month - 1]?.name}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`px-2 py-1 rounded ${
                                    record.roomNumber < 200 
                                      ? 'bg-green-100 text-green-700' 
                                      : 'bg-purple-100 text-purple-700'
                                  } font-semibold`}>
                                    {record.roomNumber}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-right">
                                  ₹{rent.toLocaleString('en-IN')}
                                </td>
                                <td className="px-3 py-2 text-right">{oldReading}</td>
                                <td className="px-3 py-2 text-right">{currentReading}</td>
                                <td className="px-3 py-2 text-right font-semibold text-blue-600">{units}</td>
                                <td className="px-3 py-2 text-right">₹{ratePerUnit.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right">
                                  ₹{electricity.toLocaleString('en-IN')}
                                </td>
                                <td className="px-3 py-2 text-right font-semibold">
                                  ₹{total.toLocaleString('en-IN')}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  ₹{paid.toLocaleString('en-IN')}
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                    record.status === 'paid'
                                      ? 'bg-green-100 text-green-800'
                                      : record.status === 'partial'
                                      ? 'bg-yellow-100 text-yellow-800'
                                      : 'bg-red-100 text-red-800'
                                  }`}>
                                    {record.status || 'unpaid'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
          </div>
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
