import { useState } from 'react';
import { collection, getDocs, updateDoc, doc, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

const UpdateCheckInDates = () => {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  const updateCheckInDates = async () => {
    setLoading(true);
    setError('');
    setResults(null);

    try {
      console.log('🔍 Fetching active tenants...');
      
      // Get all active tenants
      const tenantsRef = collection(db, 'tenants');
      const tenantsQuery = query(tenantsRef, where('isActive', '==', true));
      const tenantsSnapshot = await getDocs(tenantsQuery);
      
      const updates = [];
      const alreadySet = [];
      const noHistory = [];
      
      for (const tenantDoc of tenantsSnapshot.docs) {
        const tenant = tenantDoc.data();
        const tenantName = tenant.name;
        const roomNumber = tenant.roomNumber;
        
        console.log(`\n👤 Checking: ${tenantName} (Room ${roomNumber})`);
        
        // Check if already has checkInDate
        if (tenant.checkInDate) {
          alreadySet.push({ name: tenantName, roomNumber, checkInDate: tenant.checkInDate });
          console.log(`   ✅ Already has checkInDate: ${new Date(tenant.checkInDate).toLocaleDateString('en-IN')}`);
          continue;
        }
        
        // Find first payment record for this tenant
        const paymentsRef = collection(db, 'payments');
        const paymentsQuery = query(
          paymentsRef,
          where('tenantNameSnapshot', '==', tenantName),
          orderBy('year', 'asc'),
          orderBy('month', 'asc')
        );
        
        const paymentsSnapshot = await getDocs(paymentsQuery);
        
        if (paymentsSnapshot.empty) {
          noHistory.push({ name: tenantName, roomNumber });
          console.log(`   ⚠️  No payment history found`);
          continue;
        }
        
        // Get first payment
        const firstPayment = paymentsSnapshot.docs[0].data();
        const firstYear = firstPayment.year;
        const firstMonth = firstPayment.month;
        
        // Create checkInDate as 1st of that month
        const checkInDate = new Date(firstYear, firstMonth - 1, 1).toISOString();
        
        console.log(`   📅 First payment: ${getMonthName(firstMonth)} ${firstYear}`);
        console.log(`   ✨ Setting checkInDate: ${new Date(checkInDate).toLocaleDateString('en-IN')}`);
        
        // Update in database
        const tenantRef = doc(db, 'tenants', tenantDoc.id);
        await updateDoc(tenantRef, {
          checkInDate: checkInDate
        });
        
        updates.push({
          name: tenantName,
          roomNumber,
          checkInDate,
          firstPayment: `${getMonthName(firstMonth)} ${firstYear}`
        });
      }
      
      setResults({
        updated: updates,
        alreadySet,
        noHistory,
        total: tenantsSnapshot.size
      });
      
      setLoading(false);
    } catch (err) {
      console.error('Error:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const getMonthName = (monthNum) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[monthNum - 1] || monthNum;
  };

  return (
    <div className="p-4 lg:p-8">
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">🔄 Update Check-In Dates</h2>
        <p className="text-gray-600">
          Updates tenant check-in dates based on their first payment record in history
        </p>
      </div>

      <div className="card mb-6">
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                <strong>Warning:</strong> This will update check-in dates for tenants who don&apos;t have one set.
                It will use the date of their first payment record as the check-in date.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={updateCheckInDates}
          disabled={loading}
          className="btn-primary w-full"
        >
          {loading ? '⏳ Processing...' : '🚀 Update Check-In Dates'}
        </button>
      </div>

      {error && (
        <div className="card bg-red-50 border border-red-200 mb-6">
          <h3 className="text-lg font-bold text-red-800 mb-2">❌ Error</h3>
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {results && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="card bg-blue-50 border border-blue-200">
              <p className="text-sm text-blue-600 mb-1">Total Tenants</p>
              <p className="text-3xl font-bold text-blue-800">{results.total}</p>
            </div>
            <div className="card bg-green-50 border border-green-200">
              <p className="text-sm text-green-600 mb-1">Updated</p>
              <p className="text-3xl font-bold text-green-800">{results.updated.length}</p>
            </div>
            <div className="card bg-gray-50 border border-gray-200">
              <p className="text-sm text-gray-600 mb-1">Already Set</p>
              <p className="text-3xl font-bold text-gray-800">{results.alreadySet.length}</p>
            </div>
            <div className="card bg-yellow-50 border border-yellow-200">
              <p className="text-sm text-yellow-600 mb-1">No History</p>
              <p className="text-3xl font-bold text-yellow-800">{results.noHistory.length}</p>
            </div>
          </div>

          {/* Updated Tenants */}
          {results.updated.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-bold text-gray-800 mb-4">✅ Updated Tenants</h3>
              <div className="space-y-2">
                {results.updated.map((tenant, idx) => (
                  <div key={idx} className="flex justify-between items-center p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div>
                      <p className="font-semibold text-gray-800">{tenant.name}</p>
                      <p className="text-sm text-gray-600">Room {tenant.roomNumber}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-gray-600">Check-in Date</p>
                      <p className="font-semibold text-green-700">
                        {new Date(tenant.checkInDate).toLocaleDateString('en-IN')}
                      </p>
                      <p className="text-xs text-gray-500">First payment: {tenant.firstPayment}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Already Set */}
          {results.alreadySet.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-bold text-gray-800 mb-4">ℹ️ Already Has Check-In Date</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {results.alreadySet.map((tenant, idx) => (
                  <div key={idx} className="p-2 bg-gray-50 border border-gray-200 rounded">
                    <p className="font-semibold text-sm text-gray-800">{tenant.name} (Room {tenant.roomNumber})</p>
                    <p className="text-xs text-gray-600">
                      {new Date(tenant.checkInDate).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No History */}
          {results.noHistory.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-bold text-gray-800 mb-4">⚠️ No Payment History Found</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {results.noHistory.map((tenant, idx) => (
                  <div key={idx} className="p-2 bg-yellow-50 border border-yellow-200 rounded">
                    <p className="font-semibold text-sm text-gray-800">{tenant.name} (Room {tenant.roomNumber})</p>
                    <p className="text-xs text-gray-600">No payment records found in database</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UpdateCheckInDates;
