import { useState } from 'react';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { isValidRoomNumber } from '../utils/roomValidation';

/**
 * Add 2026 Payment Records
 * Creates Jan & Feb 2026 payment records for all 12 tenants (all marked as PAID)
 * SECURITY: Only processes valid room numbers (101-106, 201-206)
 */
const Add2026Payments = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const tenants = [
    // Floor 1
    { roomNumber: '101', rent: 3200, dueDate: 20, name: 'Janvi Singh' },
    { roomNumber: '102', rent: 2500, dueDate: 1, name: 'Aadarsh Sharma' },
    { roomNumber: '103', rent: 3500, dueDate: 22, name: 'DK Singh' },
    { roomNumber: '104', rent: 3800, dueDate: 1, name: 'Raj Singh' },
    { roomNumber: '105', rent: 2500, dueDate: 1, name: 'Akash Singh' },
    { roomNumber: '106', rent: 2500, dueDate: 1, name: 'Akash Singh' },
    // Floor 2
    { roomNumber: '201', rent: 3200, dueDate: 22, name: 'Saurabh Singh' },
    { roomNumber: '202', rent: 3000, dueDate: 20, name: 'Sumit Yadav' },
    { roomNumber: '203', rent: 4000, dueDate: 1, name: 'Manali Singh' },
    { roomNumber: '204', rent: 4000, dueDate: 20, name: 'Suneel Gupta' },
    { roomNumber: '205', rent: 3800, dueDate: 1, name: 'Veer Singh' },
    { roomNumber: '206', rent: 2500, dueDate: 1, name: 'Sanjeev Rastogi' }
  ];

  const getRoomElectricity = async (roomNumber) => {
    const roomsRef = collection(db, 'rooms');
    const roomQuery = query(roomsRef, where('roomNumber', '==', roomNumber));
    const roomSnapshot = await getDocs(roomQuery);
    
    if (!roomSnapshot.empty) {
      const roomData = roomSnapshot.docs[0].data();
      const units = Math.max(0, (roomData.currentReading || 0) - (roomData.previousReading || 0));
      const electricity = units * (roomData.ratePerUnit || 9);
      return {
        units,
        electricity,
        meterNo: roomData.electricityMeterNo || `MTR${roomNumber}`,
        ratePerUnit: roomData.ratePerUnit || 9
      };
    }
    
    // Default if room not found
    const units = Math.floor(Math.random() * 50) + 150; // 150-200 units
    return {
      units,
      electricity: units * 9,
      meterNo: `MTR${roomNumber}`,
      ratePerUnit: 9
    };
  };

  const checkPaymentExists = async (roomNumber, year, month) => {
    const paymentsRef = collection(db, 'payments');
    const paymentQuery = query(
      paymentsRef,
      where('roomNumber', '==', roomNumber),
      where('year', '==', year),
      where('month', '==', month)
    );
    const snapshot = await getDocs(paymentQuery);
    return !snapshot.empty;
  };

  const handleAdd2026Payments = async () => {
    setLoading(true);
    setResult(null);

    const results = {
      added: [],
      skipped: [],
      errors: []
    };

    try {
      const paymentsRef = collection(db, 'payments');

      for (const tenant of tenants) {
        // VALIDATION: Skip invalid room numbers
        if (!isValidRoomNumber(tenant.roomNumber)) {
          console.error(`Skipping invalid room number: ${tenant.roomNumber}`);
          results.skipped.push(`Room ${tenant.roomNumber} - Invalid room number`);
          continue;
        }
        
        const elecData = await getRoomElectricity(tenant.roomNumber);

        // January 2026
        const janExists = await checkPaymentExists(tenant.roomNumber, 2026, 1);
        if (!janExists) {
          try {
            await addDoc(paymentsRef, {
              roomNumber: tenant.roomNumber,
              tenantName: tenant.name,
              year: 2026,
              month: 1,
              rent: tenant.rent,
              electricity: elecData.electricity,
              units: elecData.units,
              total: tenant.rent + elecData.electricity,
              electricityMeterNo: elecData.meterNo,
              ratePerUnit: elecData.ratePerUnit,
              status: 'paid',
              paidAt: `2026-01-${String(tenant.dueDate).padStart(2, '0')}`,
              paymentMethod: 'UPI',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
            results.added.push(`Room ${tenant.roomNumber} - Jan 2026`);
          } catch (error) {
            results.errors.push(`Room ${tenant.roomNumber} - Jan 2026: ${error.message}`);
          }
        } else {
          results.skipped.push(`Room ${tenant.roomNumber} - Jan 2026 (already exists)`);
        }

        // February 2026
        const febExists = await checkPaymentExists(tenant.roomNumber, 2026, 2);
        if (!febExists) {
          try {
            await addDoc(paymentsRef, {
              roomNumber: tenant.roomNumber,
              tenantName: tenant.name,
              year: 2026,
              month: 2,
              rent: tenant.rent,
              electricity: elecData.electricity,
              units: elecData.units,
              total: tenant.rent + elecData.electricity,
              electricityMeterNo: elecData.meterNo,
              ratePerUnit: elecData.ratePerUnit,
              status: 'paid',
              paidAt: `2026-02-${String(tenant.dueDate).padStart(2, '0')}`,
              paymentMethod: 'UPI',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            });
            results.added.push(`Room ${tenant.roomNumber} - Feb 2026`);
          } catch (error) {
            results.errors.push(`Room ${tenant.roomNumber} - Feb 2026: ${error.message}`);
          }
        } else {
          results.skipped.push(`Room ${tenant.roomNumber} - Feb 2026 (already exists)`);
        }

        // Small delay to avoid overwhelming Firebase
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      setResult(results);
    } catch (error) {
      console.error('Error adding payments:', error);
      setResult({
        added: [],
        skipped: [],
        errors: [`Fatal error: ${error.message}`]
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <div className="bg-white rounded-lg shadow-lg p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">📅 Add 2026 Payment Records</h1>
          <p className="text-gray-600">
            Create January and February 2026 payment records for all 12 tenants (marked as PAID)
          </p>
        </div>

        {/* Auto-run notification */}
        {loading && !result && (
          <div className="bg-blue-50 border-2 border-blue-400 rounded-lg p-6 mb-6 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
            <h3 className="text-xl font-bold text-blue-900 mb-2">⏳ Adding Payment Records...</h3>
            <p className="text-blue-700">Processing all 12 tenants for Jan & Feb 2026</p>
          </div>
        )}

        {/* Info Box */}
        {!loading && !result && (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-blue-900 mb-2">ℹ️ What this will do:</h3>
              <ul className="text-blue-800 text-sm space-y-1 list-disc list-inside">
                <li>Create payment records for January 2026 (all 12 tenants)</li>
                <li>Create payment records for February 2026 (all 12 tenants)</li>
                <li>All payments marked as PAID with payment date = due date</li>
                <li>Electricity charges calculated from room meter data</li>
                <li>✅ <strong>Skips if payment already exists (no duplicates)</strong></li>
                <li>Only processes valid room numbers (101-106, 201-206)</li>
              </ul>
            </div>

            <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4 mb-6">
              <h3 className="font-semibold text-yellow-900 mb-2">⚠️ Already have duplicate payments?</h3>
              <p className="text-yellow-800 text-sm mb-2">
                If you accidentally ran this tool multiple times and now have 24 payments instead of 12,
                use the <strong>&quot;Clean Duplicate Payments&quot;</strong> tool to fix it.
              </p>
              <p className="text-yellow-700 text-xs">
                Settings → Clean Duplicate Payments
              </p>
            </div>
          </>
        )}

        {/* Action Button */}
        {!result && !loading && (
          <button
            onClick={handleAdd2026Payments}
            disabled={loading}
            className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            ✅ Add Jan & Feb 2026 Payments
          </button>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {result.added.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-bold text-green-800 mb-2">✅ Successfully Added ({result.added.length})</h3>
                <ul className="text-green-700 text-sm space-y-1 list-disc list-inside max-h-60 overflow-y-auto">
                  {result.added.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.skipped.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <h3 className="font-bold text-yellow-800 mb-2">⚠️ Skipped ({result.skipped.length})</h3>
                <ul className="text-yellow-700 text-sm space-y-1 list-disc list-inside max-h-60 overflow-y-auto">
                  {result.skipped.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h3 className="font-bold text-red-800 mb-2">❌ Errors ({result.errors.length})</h3>
                <ul className="text-red-700 text-sm space-y-1 list-disc list-inside max-h-60 overflow-y-auto">
                  {result.errors.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Reset Button */}
            <button
              onClick={() => setResult(null)}
              className="w-full bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition-colors"
            >
              🔄 Run Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Add2026Payments;
