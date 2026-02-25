import { useState } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * SyncRoomMeters Component
 * 
 * Updates rooms collection with:
 * - Meter numbers matching room numbers (e.g., Room 101 → Meter MTR101)
 * - Latest meter readings from historical payment data
 */
const SyncRoomMeters = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const syncMeters = async () => {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      console.log('🔍 Loading rooms and payment history...');

      // Load all rooms
      const roomsRef = collection(db, 'rooms');
      const roomsSnapshot = await getDocs(roomsRef);
      
      if (roomsSnapshot.empty) {
        setError('No rooms found in database');
        setLoading(false);
        return;
      }

      const rooms = [];
      roomsSnapshot.forEach(docSnap => {
        rooms.push({ id: docSnap.id, ...docSnap.data() });
      });

      console.log(`📊 Found ${rooms.length} rooms`);

      // Load all payments
      const paymentsRef = collection(db, 'payments');
      const paymentsSnapshot = await getDocs(paymentsRef);
      
      console.log(`📊 Found ${paymentsSnapshot.size} payment records`);

      // Group payments by room
      const paymentsByRoom = {};
      paymentsSnapshot.forEach(docSnap => {
        const payment = docSnap.data();
        const roomNum = payment.roomNumber;
        
        if (!paymentsByRoom[roomNum]) {
          paymentsByRoom[roomNum] = [];
        }
        
        paymentsByRoom[roomNum].push({
          id: docSnap.id,
          year: payment.year,
          month: payment.month,
          currentReading: Number(payment.currentReading) || 0,
          previousReading: Number(payment.previousReading) || 0,
          units: Number(payment.units) || 0
        });
      });

      // Sort payments by year and month to get latest readings
      Object.keys(paymentsByRoom).forEach(roomNum => {
        paymentsByRoom[roomNum].sort((a, b) => {
          if (a.year !== b.year) return b.year - a.year; // Descending year
          return b.month - a.month; // Descending month
        });
      });

      console.log('🔧 Updating rooms with meter data...');

      let successCount = 0;
      let errorCount = 0;
      const updates = [];

      for (const room of rooms) {
        try {
          const roomNumber = Number(room.roomNumber);
          
          if (isNaN(roomNumber)) {
            console.warn(`⚠️  Room ${room.roomNumber}: Invalid room number`);
            errorCount++;
            continue;
          }

          // Prepare update data
          const updateData = {
            electricityMeterNo: `MTR${roomNumber}`, // Meter number matches room number
            updatedAt: new Date().toISOString()
          };

          // Get latest meter readings from payments
          const roomPayments = paymentsByRoom[roomNumber] || [];
          
          if (roomPayments.length > 0) {
            const latestPayment = roomPayments[0]; // Most recent
            updateData.currentReading = latestPayment.currentReading;
            updateData.previousReading = latestPayment.previousReading;
            
            updates.push({
              roomNumber,
              meter: `MTR${roomNumber}`,
              current: updateData.currentReading,
              previous: updateData.previousReading,
              hasData: true
            });
          } else {
            // No historical data, set to 0
            updateData.currentReading = 0;
            updateData.previousReading = 0;
            
            updates.push({
              roomNumber,
              meter: `MTR${roomNumber}`,
              current: 0,
              previous: 0,
              hasData: false
            });
          }

          // Update room document
          await updateDoc(doc(db, 'rooms', room.id), updateData);
          successCount++;

        } catch (err) {
          console.error(`❌ Error updating room ${room.roomNumber}:`, err.message);
          errorCount++;
        }
      }

      setResult({
        success: true,
        totalRooms: rooms.length,
        successCount,
        errorCount,
        totalPayments: paymentsSnapshot.size,
        updates
      });

    } catch (err) {
      console.error('Error syncing meters:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">⚡</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Sync Room Meters</h1>
            <p className="text-sm text-gray-600">
              Update room meter numbers and readings from historical payment data
            </p>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-blue-900 mb-2">🔧 What this does:</h3>
          <ul className="text-blue-800 text-sm space-y-2 list-disc list-inside">
            <li>Sets meter number to match room number (e.g., Room 101 → Meter MTR101)</li>
            <li>Extracts latest meter readings from payment history (2017-2025)</li>
            <li>Updates currentReading and previousReading for each room</li>
            <li>Helps fix Vacancy Report if it shows empty</li>
          </ul>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Action Button */}
        {!result && (
          <button
            onClick={syncMeters}
            disabled={loading}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? '⏳ Syncing...' : '⚡ Sync Room Meters'}
          </button>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600">Syncing meter data from historical records...</p>
          </div>
        )}

        {/* Results */}
        {result && result.success && (
          <div className="bg-green-50 border-2 border-green-300 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-4xl">✅</span>
              <div>
                <h3 className="text-2xl font-bold text-green-800">Sync Successful!</h3>
                <p className="text-green-700">All rooms have been updated with meter data</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-lg p-4 border border-green-200">
                <p className="text-sm text-gray-600 mb-1">Total Rooms</p>
                <p className="text-3xl font-bold text-green-700">{result.totalRooms}</p>
              </div>
              <div className="bg-white rounded-lg p-4 border border-green-200">
                <p className="text-sm text-gray-600 mb-1">Successfully Updated</p>
                <p className="text-3xl font-bold text-green-700">{result.successCount}</p>
              </div>
              <div className="bg-white rounded-lg p-4 border border-green-200">
                <p className="text-sm text-gray-600 mb-1">Payment Records</p>
                <p className="text-3xl font-bold text-green-700">{result.totalPayments}</p>
              </div>
            </div>

            <div className="bg-white border border-green-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-800 mb-3">📊 Room Updates:</h4>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {result.updates.map((update) => (
                  <div 
                    key={update.roomNumber}
                    className={`flex items-center justify-between p-3 rounded ${
                      update.hasData ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'
                    }`}
                  >
                    <div>
                      <span className="font-bold text-gray-800">Room {update.roomNumber}</span>
                      <span className="text-gray-600 ml-3">→ {update.meter}</span>
                    </div>
                    <div className="text-sm text-gray-700">
                      {update.hasData ? (
                        <>
                          <span className="font-semibold">Current:</span> {update.current} | 
                          <span className="font-semibold ml-2">Previous:</span> {update.previous}
                        </>
                      ) : (
                        <span className="text-gray-500">No historical data</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex gap-3">
              <button
                onClick={() => window.location.href = '/rooms'}
                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg"
              >
                📋 View Rooms
              </button>
              <button
                onClick={() => window.location.href = '/vacancy-report'}
                className="flex-1 bg-purple-500 hover:bg-purple-600 text-white font-semibold py-2 px-4 rounded-lg"
              >
                📊 View Vacancy Report
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-lg"
              >
                🔄 Sync Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SyncRoomMeters;
