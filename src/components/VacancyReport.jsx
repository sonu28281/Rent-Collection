import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

const VacancyReport = () => {
  const [loading, setLoading] = useState(true);
  const [allPayments, setAllPayments] = useState([]);
  const [yearlyReport, setYearlyReport] = useState([]);
  const [roomVacancy, setRoomVacancy] = useState([]);
  const [totalRooms, setTotalRooms] = useState(0);

  const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  useEffect(() => {
    loadVacancyData();
  }, []);

  const loadVacancyData = async () => {
    setLoading(true);
    try {
      // Load all payments
      const paymentsRef = collection(db, 'payments');
      const q = query(paymentsRef, orderBy('year', 'asc'), orderBy('month', 'asc'));
      const snapshot = await getDocs(q);
      
      const payments = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setAllPayments(payments);

      // Get unique room numbers
      const uniqueRooms = [...new Set(payments.map(p => p.roomNumber))].sort((a, b) => a - b);
      setTotalRooms(uniqueRooms.length);

      // Calculate yearly vacancy report
      const yearlyData = calculateYearlyVacancy(payments, uniqueRooms);
      setYearlyReport(yearlyData);

      // Calculate room-wise vacancy
      const roomData = calculateRoomVacancy(payments, uniqueRooms);
      setRoomVacancy(roomData);

    } catch (error) {
      console.error('Error loading vacancy data:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateYearlyVacancy = (payments, uniqueRooms) => {
    // Group by year and month
    const groupedByYear = {};
    
    payments.forEach(payment => {
      const year = payment.year;
      if (!groupedByYear[year]) {
        groupedByYear[year] = {};
      }
      
      const month = payment.month;
      if (!groupedByYear[year][month]) {
        groupedByYear[year][month] = new Set();
      }
      
      // Check if room was vacant (rent = 0 or roomStatus = vacant)
      const isVacant = payment.roomStatus === 'vacant' || (Number(payment.rent) || 0) === 0;
      
      if (!isVacant) {
        groupedByYear[year][month].add(payment.roomNumber);
      }
    });

    // Calculate statistics for each year
    const yearlyStats = [];
    const years = Object.keys(groupedByYear).sort((a, b) => Number(a) - Number(b));
    
    years.forEach(year => {
      const months = groupedByYear[year];
      let totalOccupiedRoomMonths = 0;
      let totalPossibleRoomMonths = uniqueRooms.length * Object.keys(months).length;
      
      Object.values(months).forEach(occupiedRooms => {
        totalOccupiedRoomMonths += occupiedRooms.size;
      });
      
      const vacantRoomMonths = totalPossibleRoomMonths - totalOccupiedRoomMonths;
      const occupancyRate = totalPossibleRoomMonths > 0 
        ? ((totalOccupiedRoomMonths / totalPossibleRoomMonths) * 100).toFixed(1)
        : 0;
      
      const vacancyRate = (100 - occupancyRate).toFixed(1);
      
      // Calculate average vacant rooms per month
      const monthsCount = Object.keys(months).length;
      const avgVacantRooms = monthsCount > 0 ? (vacantRoomMonths / monthsCount).toFixed(1) : 0;

      // Check if it's corona period
      const isCoronaPeriod = year >= '2020' && year <= '2021';

      yearlyStats.push({
        year: Number(year),
        totalPossibleRoomMonths,
        occupiedRoomMonths: totalOccupiedRoomMonths,
        vacantRoomMonths,
        occupancyRate: Number(occupancyRate),
        vacancyRate: Number(vacancyRate),
        avgVacantRooms: Number(avgVacantRooms),
        monthsRecorded: monthsCount,
        isCoronaPeriod
      });
    });

    return yearlyStats;
  };

  const calculateRoomVacancy = (payments, uniqueRooms) => {
    const roomStats = {};

    uniqueRooms.forEach(roomNumber => {
      const roomPayments = payments.filter(p => p.roomNumber === roomNumber);
      
      const vacantMonths = roomPayments.filter(p => 
        p.roomStatus === 'vacant' || (Number(p.rent) || 0) === 0
      ).length;
      
      const occupiedMonths = roomPayments.length - vacantMonths;
      const vacancyRate = roomPayments.length > 0 
        ? ((vacantMonths / roomPayments.length) * 100).toFixed(1)
        : 0;

      // Get years when room was vacant
      const vacantYears = [...new Set(
        roomPayments
          .filter(p => p.roomStatus === 'vacant' || (Number(p.rent) || 0) === 0)
          .map(p => p.year)
      )].sort();

      roomStats[roomNumber] = {
        roomNumber,
        totalRecords: roomPayments.length,
        vacantMonths,
        occupiedMonths,
        vacancyRate: Number(vacancyRate),
        vacantYears
      };
    });

    return Object.values(roomStats).sort((a, b) => b.vacantMonths - a.vacantMonths);
  };

  const getCoronaImpact = () => {
    const coronaYears = yearlyReport.filter(y => y.isCoronaPeriod);
    if (coronaYears.length === 0) return null;

    const avgVacancyDuringCorona = (
      coronaYears.reduce((sum, y) => sum + y.vacancyRate, 0) / coronaYears.length
    ).toFixed(1);

    const totalVacantRoomMonths = coronaYears.reduce((sum, y) => sum + y.vacantRoomMonths, 0);
    
    return {
      years: coronaYears.map(y => y.year).join(', '),
      avgVacancyRate: avgVacancyDuringCorona,
      totalVacantRoomMonths
    };
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="card text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading vacancy report...</p>
        </div>
      </div>
    );
  }

  // Check if no data available
  if (allPayments.length === 0 || yearlyReport.length === 0) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">📊 Vacancy Report</h1>
          <p className="text-gray-600">
            Historical vacancy analysis across all rooms and years
          </p>
        </div>

        <div className="card text-center py-12">
          <div className="text-6xl mb-4">📭</div>
          <h3 className="text-2xl font-bold text-gray-800 mb-2">No Data Available</h3>
          <p className="text-gray-600 mb-6">
            No payment records found in the database.
            <br />
            Import historical data or check if payments collection has data.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.href = '/import'}
              className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-6 rounded-lg"
            >
              📥 Import Data
            </button>
            <button
              onClick={() => window.location.href = '/sync-room-meters'}
              className="bg-purple-500 hover:bg-purple-600 text-white font-semibold py-2 px-6 rounded-lg"
            >
              ⚡ Sync Room Meters
            </button>
          </div>
        </div>
      </div>
    );
  }

  const coronaImpact = getCoronaImpact();

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">📊 Vacancy Report</h1>
        <p className="text-gray-600">
          Historical vacancy analysis across all rooms and years
        </p>
      </div>

      {/* Overall Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="card bg-gradient-to-br from-blue-50 to-blue-100 border-2 border-blue-200">
          <p className="text-sm text-blue-700 mb-1">Total Rooms Tracked</p>
          <p className="text-3xl font-bold text-blue-900">{totalRooms}</p>
        </div>
        <div className="card bg-gradient-to-br from-green-50 to-green-100 border-2 border-green-200">
          <p className="text-sm text-green-700 mb-1">Years of Data</p>
          <p className="text-3xl font-bold text-green-900">{yearlyReport.length}</p>
        </div>
        <div className="card bg-gradient-to-br from-purple-50 to-purple-100 border-2 border-purple-200">
          <p className="text-sm text-purple-700 mb-1">Total Records</p>
          <p className="text-3xl font-bold text-purple-900">{allPayments.length}</p>
        </div>
        <div className="card bg-gradient-to-br from-orange-50 to-orange-100 border-2 border-orange-200">
          <p className="text-sm text-orange-700 mb-1">Years Range</p>
          <p className="text-2xl font-bold text-orange-900">
            {yearlyReport.length > 0 && `${yearlyReport[0].year} - ${yearlyReport[yearlyReport.length - 1].year}`}
          </p>
        </div>
      </div>

      {/* Corona Period Impact */}
      {coronaImpact && (
        <div className="card mb-6 bg-gradient-to-r from-red-50 to-orange-50 border-2 border-red-300">
          <div className="flex items-start gap-4">
            <div className="text-5xl">🦠</div>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-red-800 mb-2">Corona Period Impact ({coronaImpact.years})</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <p className="text-sm text-red-700 mb-1">Average Vacancy Rate</p>
                  <p className="text-3xl font-bold text-red-900">{coronaImpact.avgVacancyRate}%</p>
                </div>
                <div>
                  <p className="text-sm text-red-700 mb-1">Total Vacant Room-Months</p>
                  <p className="text-3xl font-bold text-red-900">{coronaImpact.totalVacantRoomMonths}</p>
                </div>
              </div>
              <p className="text-sm text-red-700 mt-3">
                ⚠️ During the corona pandemic period, vacancy rates were significantly higher due to lockdowns and economic challenges.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Yearly Vacancy Report */}
      <div className="card mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">📅 Year-wise Vacancy Analysis</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2 border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Year</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-700">Months</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Occupied</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Vacant</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Avg Vacant/Month</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Occupancy %</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Vacancy %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {yearlyReport.map(year => (
                <tr 
                  key={year.year}
                  className={`hover:bg-gray-50 transition ${
                    year.isCoronaPeriod ? 'bg-red-50' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <span className="font-bold text-gray-800">
                      {year.year}
                      {year.isCoronaPeriod && <span className="ml-2 text-red-600">🦠</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-700">
                    {year.monthsRecorded}
                  </td>
                  <td className="px-4 py-3 text-right text-green-700 font-semibold">
                    {year.occupiedRoomMonths}
                  </td>
                  <td className="px-4 py-3 text-right text-red-700 font-semibold">
                    {year.vacantRoomMonths}
                  </td>
                  <td className="px-4 py-3 text-right text-orange-700 font-semibold">
                    {year.avgVacantRooms}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-green-500 h-2 rounded-full transition-all"
                          style={{ width: `${year.occupancyRate}%` }}
                        ></div>
                      </div>
                      <span className="font-semibold text-green-700 w-12 text-right">
                        {year.occupancyRate}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-red-500 h-2 rounded-full transition-all"
                          style={{ width: `${year.vacancyRate}%` }}
                        ></div>
                      </div>
                      <span className="font-semibold text-red-700 w-12 text-right">
                        {year.vacancyRate}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Room-wise Vacancy Report */}
      <div className="card">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">🏠 Room-wise Vacancy Pattern</h2>
        <p className="text-sm text-gray-600 mb-4">Rooms sorted by highest vacancy duration</p>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b-2 border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Room</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Total Records</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Occupied Months</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Vacant Months</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Vacancy Rate</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Vacant in Years</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {roomVacancy.map(room => {
                const isHighVacancy = room.vacancyRate > 30;
                
                return (
                  <tr 
                    key={room.roomNumber}
                    className={`hover:bg-gray-50 transition ${
                      isHighVacancy ? 'bg-orange-50' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className={`font-bold text-lg ${
                        room.roomNumber < 200 ? 'text-green-700' : 'text-purple-700'
                      }`}>
                        Room {room.roomNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">
                      {room.totalRecords}
                    </td>
                    <td className="px-4 py-3 text-right text-green-700 font-semibold">
                      {room.occupiedMonths}
                    </td>
                    <td className="px-4 py-3 text-right text-red-700 font-semibold">
                      {room.vacantMonths}
                      {isHighVacancy && <span className="ml-2">⚠️</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-24 bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full transition-all ${
                              isHighVacancy ? 'bg-red-500' : 'bg-orange-400'
                            }`}
                            style={{ width: `${room.vacancyRate}%` }}
                          ></div>
                        </div>
                        <span className={`font-semibold w-12 text-right ${
                          isHighVacancy ? 'text-red-700' : 'text-orange-700'
                        }`}>
                          {room.vacancyRate}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {room.vacantYears.length > 0 ? (
                          room.vacantYears.map(year => (
                            <span 
                              key={year}
                              className={`text-xs px-2 py-1 rounded ${
                                year >= 2020 && year <= 2021
                                  ? 'bg-red-100 text-red-700 font-semibold'
                                  : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {year}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-green-600">Never vacant</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info Box */}
      <div className="card bg-blue-50 border border-blue-200 mt-6">
        <h3 className="font-bold text-blue-900 mb-2">ℹ️ Understanding This Report</h3>
        <ul className="text-blue-800 text-sm space-y-2">
          <li>• <strong>Occupied:</strong> Months where rent was collected (room had a tenant)</li>
          <li>• <strong>Vacant:</strong> Months where room was empty or rent was ₹0</li>
          <li>• <strong>Corona Period (2020-2021):</strong> Marked with 🦠 symbol, typically shows higher vacancy</li>
          <li>• <strong>Vacancy Rate:</strong> Percentage of time room was vacant (higher = more vacancy)</li>
          <li>• <strong>Avg Vacant/Month:</strong> Average number of rooms vacant per month in that year</li>
          <li>• Rooms with high vacancy (&gt;30%) are highlighted with ⚠️</li>
        </ul>
      </div>
    </div>
  );
};

export default VacancyReport;
