import { useState } from 'react';
import { collection, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { VALID_ROOM_NUMBERS } from '../utils/roomValidation';

/**
 * Clean Duplicate Payments
 * Ensures only ONE payment record per room per month
 * Removes duplicate payment entries for Jan 2026 & Feb 2026
 */
const CleanDuplicatePayments = () => {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [paymentStats, setPaymentStats] = useState(null);
  const [result, setResult] = useState(null);

  const checkPaymentDuplicates = async () => {
    setChecking(true);
    setPaymentStats(null);

    try {
      const paymentsRef = collection(db, 'payments');
      
      // Check Jan 2026
      const jan2026Query = query(
        paymentsRef,
        where('year', '==', 2026),
        where('month', '==', 1)
      );
      const jan2026Snapshot = await getDocs(jan2026Query);
      const jan2026Payments = jan2026Snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Check Feb 2026
      const feb2026Query = query(
        paymentsRef,
        where('year', '==', 2026),
        where('month', '==', 2)
      );
      const feb2026Snapshot = await getDocs(feb2026Query);
      const feb2026Payments = feb2026Snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Find duplicates in Jan 2026
      const jan2026ByRoom = {};
      jan2026Payments.forEach(payment => {
        const room = payment.roomNumber;
        if (!jan2026ByRoom[room]) {
          jan2026ByRoom[room] = [];
        }
        jan2026ByRoom[room].push(payment);
      });

      // Find duplicates in Feb 2026
      const feb2026ByRoom = {};
      feb2026Payments.forEach(payment => {
        const room = payment.roomNumber;
        if (!feb2026ByRoom[room]) {
          feb2026ByRoom[room] = [];
        }
        feb2026ByRoom[room].push(payment);
      });

      // Count duplicates
      const jan2026Duplicates = Object.entries(jan2026ByRoom).filter(([_, payments]) => payments.length > 1);
      const feb2026Duplicates = Object.entries(feb2026ByRoom).filter(([_, payments]) => payments.length > 1);

      setPaymentStats({
        jan2026: {
          total: jan2026Payments.length,
          expected: 12,
          byRoom: jan2026ByRoom,
          duplicates: jan2026Duplicates
        },
        feb2026: {
          total: feb2026Payments.length,
          expected: 12,
          byRoom: feb2026ByRoom,
          duplicates: feb2026Duplicates
        }
      });
    } catch (error) {
      console.error('Error checking payment duplicates:', error);
      setPaymentStats({
        error: error.message
      });
    } finally {
      setChecking(false);
    }
  };

  const handleCleanupPayments = async () => {
    setLoading(true);
    setResult(null);

    const results = {
      jan2026Deleted: [],
      feb2026Deleted: [],
      jan2026Kept: [],
      feb2026Kept: [],
      errors: []
    };

    try {
      const paymentsRef = collection(db, 'payments');

      // Clean Jan 2026 duplicates
      if (paymentStats?.jan2026?.duplicates) {
        for (const [roomNumber, payments] of paymentStats.jan2026.duplicates) {
          // Keep first payment, delete rest
          const toKeep = payments[0];
          const toDelete = payments.slice(1);

          results.jan2026Kept.push(`Room ${roomNumber}: ${toKeep.tenantName} - ₹${toKeep.total}`);

          for (const payment of toDelete) {
            try {
              await deleteDoc(doc(db, 'payments', payment.id));
              results.jan2026Deleted.push(`Room ${roomNumber}: Duplicate ₹${payment.total}`);
            } catch (error) {
              results.errors.push(`Failed to delete Jan payment for Room ${roomNumber}: ${error.message}`);
            }
          }
        }
      }

      // Clean Feb 2026 duplicates
      if (paymentStats?.feb2026?.duplicates) {
        for (const [roomNumber, payments] of paymentStats.feb2026.duplicates) {
          // Keep first payment, delete rest
          const toKeep = payments[0];
          const toDelete = payments.slice(1);

          results.feb2026Kept.push(`Room ${roomNumber}: ${toKeep.tenantName} - ₹${toKeep.total}`);

          for (const payment of toDelete) {
            try {
              await deleteDoc(doc(db, 'payments', payment.id));
              results.feb2026Deleted.push(`Room ${roomNumber}: Duplicate ₹${payment.total}`);
            } catch (error) {
              results.errors.push(`Failed to delete Feb payment for Room ${roomNumber}: ${error.message}`);
            }
          }
        }
      }

      // Also check for invalid room numbers
      const jan2026Query = query(
        paymentsRef,
        where('year', '==', 2026),
        where('month', '==', 1)
      );
      const jan2026Snapshot = await getDocs(jan2026Query);
      for (const docSnap of jan2026Snapshot.docs) {
        const payment = docSnap.data();
        if (!VALID_ROOM_NUMBERS.includes(payment.roomNumber)) {
          try {
            await deleteDoc(doc(db, 'payments', docSnap.id));
            results.jan2026Deleted.push(`Room ${payment.roomNumber}: Invalid room number`);
          } catch (error) {
            results.errors.push(`Failed to delete invalid Jan payment: ${error.message}`);
          }
        }
      }

      const feb2026Query = query(
        paymentsRef,
        where('year', '==', 2026),
        where('month', '==', 2)
      );
      const feb2026Snapshot = await getDocs(feb2026Query);
      for (const docSnap of feb2026Snapshot.docs) {
        const payment = docSnap.data();
        if (!VALID_ROOM_NUMBERS.includes(payment.roomNumber)) {
          try {
            await deleteDoc(doc(db, 'payments', docSnap.id));
            results.feb2026Deleted.push(`Room ${payment.roomNumber}: Invalid room number`);
          } catch (error) {
            results.errors.push(`Failed to delete invalid Feb payment: ${error.message}`);
          }
        }
      }

      setResult(results);
      
      // Re-check stats
      await checkPaymentDuplicates();
    } catch (error) {
      console.error('Error cleaning payment duplicates:', error);
      results.errors.push(`Fatal error: ${error.message}`);
      setResult(results);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="bg-white rounded-lg shadow-lg p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">💳 Clean Duplicate Payments</h1>
          <p className="text-gray-600">
            Removes duplicate payment records for Jan & Feb 2026
          </p>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-blue-900 mb-2">📋 What this checks:</h3>
          <ul className="text-blue-800 text-sm space-y-1 list-disc list-inside">
            <li>Jan 2026: Should have exactly 12 payments (one per room)</li>
            <li>Feb 2026: Should have exactly 12 payments (one per room)</li>
            <li>Finds duplicate payments for same room number</li>
            <li>Removes invalid room number payments</li>
            <li>Keeps first payment, deletes duplicates</li>
          </ul>
        </div>

        {/* Check Button */}
        {!paymentStats && (
          <button
            onClick={checkPaymentDuplicates}
            disabled={checking}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed mb-6"
          >
            {checking ? '🔍 Checking...' : '🔍 Check Payment Duplicates'}
          </button>
        )}

        {/* Stats Display */}
        {paymentStats && !paymentStats.error && (
          <div className="space-y-4 mb-6">
            {/* Jan 2026 Stats */}
            <div className={`p-4 rounded-lg border-2 ${
              paymentStats.jan2026.total === 12 && paymentStats.jan2026.duplicates.length === 0
                ? 'bg-green-50 border-green-300'
                : 'bg-red-50 border-red-300'
            }`}>
              <h3 className="font-bold text-lg mb-2">
                {paymentStats.jan2026.total === 12 ? '✅' : '❌'} January 2026
              </h3>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <p className="text-sm text-gray-600">Total Payments</p>
                  <p className="text-3xl font-bold">{paymentStats.jan2026.total}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Expected</p>
                  <p className="text-3xl font-bold text-green-600">{paymentStats.jan2026.expected}</p>
                </div>
              </div>
              
              {paymentStats.jan2026.duplicates.length > 0 && (
                <div className="bg-white rounded p-3 border border-red-200">
                  <p className="font-semibold text-red-800 mb-2">
                    🚨 Found {paymentStats.jan2026.duplicates.length} rooms with duplicates:
                  </p>
                  <ul className="text-sm text-red-700 space-y-1">
                    {paymentStats.jan2026.duplicates.map(([roomNumber, payments]) => (
                      <li key={roomNumber}>
                        Room {roomNumber}: {payments.length} payments (should be 1)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Feb 2026 Stats */}
            <div className={`p-4 rounded-lg border-2 ${
              paymentStats.feb2026.total === 12 && paymentStats.feb2026.duplicates.length === 0
                ? 'bg-green-50 border-green-300'
                : 'bg-red-50 border-red-300'
            }`}>
              <h3 className="font-bold text-lg mb-2">
                {paymentStats.feb2026.total === 12 ? '✅' : '❌'} February 2026
              </h3>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <p className="text-sm text-gray-600">Total Payments</p>
                  <p className="text-3xl font-bold">{paymentStats.feb2026.total}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Expected</p>
                  <p className="text-3xl font-bold text-green-600">{paymentStats.feb2026.expected}</p>
                </div>
              </div>
              
              {paymentStats.feb2026.duplicates.length > 0 && (
                <div className="bg-white rounded p-3 border border-red-200">
                  <p className="font-semibold text-red-800 mb-2">
                    🚨 Found {paymentStats.feb2026.duplicates.length} rooms with duplicates:
                  </p>
                  <ul className="text-sm text-red-700 space-y-1">
                    {paymentStats.feb2026.duplicates.map(([roomNumber, payments]) => (
                      <li key={roomNumber}>
                        Room {roomNumber}: {payments.length} payments (should be 1)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Cleanup Button */}
            {(paymentStats.jan2026.duplicates.length > 0 || paymentStats.feb2026.duplicates.length > 0) && !result && (
              <button
                onClick={handleCleanupPayments}
                disabled={loading}
                className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? '🧹 Cleaning...' : '🧹 Remove All Duplicate Payments'}
              </button>
            )}

            {/* Success - No Duplicates */}
            {paymentStats.jan2026.total === 12 && 
             paymentStats.feb2026.total === 12 && 
             paymentStats.jan2026.duplicates.length === 0 && 
             paymentStats.feb2026.duplicates.length === 0 && 
             !result && (
              <div className="bg-green-50 border border-green-300 rounded-lg p-6 text-center">
                <p className="text-green-800 text-xl font-bold mb-2">✅ Perfect!</p>
                <p className="text-green-700">
                  Jan 2026: 12 payments ✓<br />
                  Feb 2026: 12 payments ✓<br />
                  No duplicates found.
                </p>
              </div>
            )}

            {/* Re-check Button */}
            <button
              onClick={checkPaymentDuplicates}
              disabled={checking || loading}
              className="w-full bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:bg-gray-400"
            >
              🔄 Re-check
            </button>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {result.jan2026Deleted.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h3 className="font-bold text-orange-800 mb-2">
                  🗑️ Jan 2026 - Deleted ({result.jan2026Deleted.length})
                </h3>
                <ul className="text-orange-700 text-sm space-y-1 list-disc list-inside max-h-40 overflow-y-auto">
                  {result.jan2026Deleted.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.feb2026Deleted.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h3 className="font-bold text-orange-800 mb-2">
                  🗑️ Feb 2026 - Deleted ({result.feb2026Deleted.length})
                </h3>
                <ul className="text-orange-700 text-sm space-y-1 list-disc list-inside max-h-40 overflow-y-auto">
                  {result.feb2026Deleted.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.jan2026Kept.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-bold text-green-800 mb-2">
                  ✅ Jan 2026 - Kept ({result.jan2026Kept.length})
                </h3>
                <ul className="text-green-700 text-sm space-y-1 list-disc list-inside max-h-40 overflow-y-auto">
                  {result.jan2026Kept.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.feb2026Kept.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-bold text-green-800 mb-2">
                  ✅ Feb 2026 - Kept ({result.feb2026Kept.length})
                </h3>
                <ul className="text-green-700 text-sm space-y-1 list-disc list-inside max-h-40 overflow-y-auto">
                  {result.feb2026Kept.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h3 className="font-bold text-red-800 mb-2">❌ Errors ({result.errors.length})</h3>
                <ul className="text-red-700 text-sm space-y-1 list-disc list-inside max-h-40 overflow-y-auto">
                  {result.errors.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-blue-50 border border-blue-300 rounded-lg p-4">
              <p className="text-blue-800 font-semibold">
                ✅ Cleanup completed! Click "Re-check" to verify.
              </p>
            </div>
          </div>
        )}

        {paymentStats?.error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800 font-semibold">❌ Error: {paymentStats.error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CleanDuplicatePayments;
