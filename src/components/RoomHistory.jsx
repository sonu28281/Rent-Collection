import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

const RoomHistory = () => {
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [roomHistory, setRoomHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);

  const MONTHS = [
    { num: 1, name: 'Jan' }, { num: 2, name: 'Feb' }, { num: 3, name: 'Mar' },
    { num: 4, name: 'Apr' }, { num: 5, name: 'May' }, { num: 6, name: 'Jun' },
    { num: 7, name: 'Jul' }, { num: 8, name: 'Aug' }, { num: 9, name: 'Sep' },
    { num: 10, name: 'Oct' }, { num: 11, name: 'Nov' }, { num: 12, name: 'Dec' }
  ];

  // Load all rooms
  useEffect(() => {
    const fetchRooms = async () => {
      try {
        const roomsRef = collection(db, 'rooms');
        const snapshot = await getDocs(roomsRef);
        const roomsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })).sort((a, b) => a.roomNumber - b.roomNumber);
        
        setRooms(roomsData);
      } catch (error) {
        console.error('Error fetching rooms:', error);
      }
    };

    fetchRooms();
  }, []);

  // Load room history when room is selected
  const loadRoomHistory = async (roomNumber) => {
    setLoading(true);
    setSelectedRoom(roomNumber);
    
    try {
      const paymentsRef = collection(db, 'payments');
      const q = query(
        paymentsRef,
        where('roomNumber', '==', roomNumber),
        orderBy('year', 'desc'),
        orderBy('month', 'desc')
      );
      
      const snapshot = await getDocs(q);
      const history = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setRoomHistory(history);
      
      // Calculate statistics
      const stats = calculateStats(history);
      setStats(stats);
      
    } catch (error) {
      console.error('Error loading room history:', error);
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

    const years = [...new Set(history.map(p => p.year))].sort();
    const firstRecord = history[history.length - 1];
    const latestRecord = history[0];

    // Get unique tenants
    const tenants = [...new Set(history
      .map(p => p.tenantNameSnapshot || p.tenantName)
      .filter(t => t && t !== 'Historical Record' && t !== 'Unknown')
    )];

    // Calculate vacancy periods (when rent was 0 or status was vacant)
    const vacantMonths = history.filter(p => 
      p.roomStatus === 'vacant' || (Number(p.rent) || 0) === 0
    ).length;

    return {
      totalRecords: history.length,
      totalRent,
      totalElectricity,
      totalAmount,
      totalPaid,
      totalBalance,
      yearsActive: years,
      firstRecord: `${MONTHS[firstRecord.month - 1]?.name} ${firstRecord.year}`,
      latestRecord: `${MONTHS[latestRecord.month - 1]?.name} ${latestRecord.year}`,
      uniqueTenants: tenants,
      vacantMonths,
      occupiedMonths: history.length - vacantMonths
    };
  };

  // Group history by year for better organization
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

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">🏠 Room History</h1>
        <p className="text-gray-600">
          View complete payment history, occupancy records, and revenue details for each room
        </p>
      </div>

      {/* Room Selection Grid */}
      <div className="card mb-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Select Room</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
          {rooms.map(room => {
            const isSelected = selectedRoom === room.roomNumber;
            const isFloor1 = room.roomNumber < 200;
            
            return (
              <button
                key={room.id}
                onClick={() => loadRoomHistory(room.roomNumber)}
                className={`p-4 rounded-lg border-2 font-semibold transition-all ${
                  isSelected
                    ? isFloor1
                      ? 'bg-green-500 text-white border-green-600 shadow-lg scale-105'
                      : 'bg-purple-500 text-white border-purple-600 shadow-lg scale-105'
                    : isFloor1
                    ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                    : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100'
                }`}
              >
                <div className="text-2xl mb-1">{room.roomNumber}</div>
                <div className={`text-xs ${isSelected ? 'text-white' : 'text-gray-600'}`}>
                  {room.status === 'vacant' ? '⬜ Vacant' : '✅ Filled'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="card text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading room history...</p>
        </div>
      )}

      {/* Statistics Summary */}
      {!loading && stats && selectedRoom && (
        <>
          {/* Room Header */}
          <div className="card mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-3xl font-bold text-gray-800">
                  Room {selectedRoom}
                </h2>
                <p className="text-gray-600 mt-1">
                  Floor {selectedRoom < 200 ? '1' : '2'} • {stats.totalRecords} records • From {stats.firstRecord} to {stats.latestRecord}
                </p>
              </div>
              <div className={`text-sm font-semibold px-4 py-2 rounded-full ${
                selectedRoom < 200 ? 'bg-green-200 text-green-800' : 'bg-purple-200 text-purple-800'
              }`}>
                {rooms.find(r => r.roomNumber === selectedRoom)?.status === 'vacant' ? '⬜ Vacant' : '✅ Filled'}
              </div>
            </div>

            {/* Revenue Stats */}
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
                <p className="text-xs text-gray-600 mb-1">Total Revenue</p>
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

            {/* Occupancy Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <p className="text-xs text-gray-600 mb-1">Years Active</p>
                <p className="text-lg font-bold text-gray-700">
                  {stats.yearsActive.join(', ')}
                </p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <p className="text-xs text-gray-600 mb-1">Occupied Months</p>
                <p className="text-lg font-bold text-green-600">{stats.occupiedMonths}</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <p className="text-xs text-gray-600 mb-1">Vacant Months</p>
                <p className="text-lg font-bold text-red-600">{stats.vacantMonths}</p>
              </div>
              <div className="bg-white rounded-lg p-3 border border-gray-200">
                <p className="text-xs text-gray-600 mb-1">Unique Tenants</p>
                <p className="text-lg font-bold text-indigo-600">{stats.uniqueTenants.length}</p>
              </div>
            </div>

            {/* Tenant List */}
            {stats.uniqueTenants.length > 0 && (
              <div className="mt-4 bg-white rounded-lg p-3 border border-gray-200">
                <p className="text-xs text-gray-600 mb-2 font-semibold">Tenants Who Stayed:</p>
                <div className="flex flex-wrap gap-2">
                  {stats.uniqueTenants.map((tenant, idx) => (
                    <span key={idx} className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-medium">
                      {tenant}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Payment History by Year */}
          <div className="space-y-6">
            {Object.entries(groupByYear(roomHistory))
              .sort(([yearA], [yearB]) => Number(yearB) - Number(yearA))
              .map(([year, records]) => {
                const yearTotals = calculateStats(records);
                
                return (
                  <div key={year} className="card">
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-200">
                      <div>
                        <h3 className="text-2xl font-bold text-gray-800">{year}</h3>
                        <p className="text-sm text-gray-600">{records.length} records</p>
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
                            <th className="px-3 py-2 text-left font-semibold text-gray-700">Tenant</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-700">Rent</th>
                            <th className="px-3 py-2 text-right font-semibold text-gray-700">Units</th>
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
                            const tenant = record.tenantNameSnapshot || record.tenantName || 'Unknown';
                            const isVacant = record.roomStatus === 'vacant' || rent === 0;

                            return (
                              <tr key={record.id} className={isVacant ? 'bg-red-50' : 'hover:bg-gray-50'}>
                                <td className="px-3 py-2">
                                  {MONTHS[record.month - 1]?.name}
                                </td>
                                <td className="px-3 py-2">
                                  {isVacant ? (
                                    <span className="text-red-600 font-semibold">⬜ Vacant</span>
                                  ) : (
                                    <span className={
                                      tenant === 'Historical Record' ? 'text-gray-500 italic' : 'text-gray-700'
                                    }>
                                      {tenant}
                                    </span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  ₹{rent.toLocaleString('en-IN')}
                                </td>
                                <td className="px-3 py-2 text-right">{units}</td>
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
      {!loading && !selectedRoom && (
        <div className="card text-center py-12">
          <div className="text-5xl mb-4">🏠</div>
          <p className="text-gray-600 text-lg">Select a room to view its complete history</p>
        </div>
      )}

      {!loading && selectedRoom && roomHistory.length === 0 && (
        <div className="card text-center py-12">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-gray-600 text-lg">No payment history found for Room {selectedRoom}</p>
        </div>
      )}
    </div>
  );
};

export default RoomHistory;
