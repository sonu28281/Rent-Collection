import { useState } from 'react';
import { collection, query, where, getDocs, doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const SetupTenants2026 = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [floor, setFloor] = useState('1');

  // Floor 1 tenant data
  const floor1Tenants = [
    { roomNumber: 101, tenantName: 'Janvi Singh', dueDate: 20, rent: 3200, ratePerUnit: 9 },
    { roomNumber: 102, tenantName: 'Aadarsh Sharma', dueDate: 1, rent: 2500, ratePerUnit: 9 },
    { roomNumber: 103, tenantName: 'DK Singh', dueDate: 22, rent: 3500, ratePerUnit: 9 },
    { roomNumber: 104, tenantName: 'Raj Singh', dueDate: 1, rent: 3800, ratePerUnit: 9 },
    { roomNumber: 105, tenantName: 'Akash Singh', dueDate: 1, rent: 2500, ratePerUnit: 9 },
    { roomNumber: 106, tenantName: 'Akash Singh', dueDate: 1, rent: 2500, ratePerUnit: 9 }
  ];

  // Floor 2 tenant data
  const floor2Tenants = [
    { roomNumber: 201, tenantName: 'Saurabh Singh', dueDate: 22, rent: 3200, ratePerUnit: 9 },
    { roomNumber: 202, tenantName: 'Sumit Yadav', dueDate: 20, rent: 3000, ratePerUnit: 9 },
    { roomNumber: 203, tenantName: 'Manali Singh', dueDate: 1, rent: 4000, ratePerUnit: 9 },
    { roomNumber: 204, tenantName: 'Suneel Gupta', dueDate: 20, rent: 4000, ratePerUnit: 9 },
    { roomNumber: 205, tenantName: 'Veer Singh', dueDate: 1, rent: 3800, ratePerUnit: 9 },
    { roomNumber: 206, tenantName: 'Sanjeev Rastogi', dueDate: 1, rent: 2500, ratePerUnit: 9 }
  ];

  const setupFloor = async (floorNumber) => {
    setLoading(true);
    setResult(null);

    try {
      const tenants = floorNumber === '1' ? floor1Tenants : floor2Tenants;
      const results = [];

      for (const tenantData of tenants) {
        // Skip empty tenant names for floor 2
        if (!tenantData.tenantName || tenantData.rent === 0) continue;

        // 1. Update/Create Room
        const roomsRef = collection(db, 'rooms');
        const roomQuery = query(roomsRef, where('roomNumber', '==', tenantData.roomNumber));
        const roomSnapshot = await getDocs(roomQuery);

        if (roomSnapshot.empty) {
          // Create new room
          const newRoomRef = doc(roomsRef);
          await setDoc(newRoomRef, {
            roomNumber: tenantData.roomNumber,
            floor: tenantData.roomNumber < 200 ? 1 : 2,
            rent: tenantData.rent,
            ratePerUnit: tenantData.ratePerUnit,
            status: 'filled',
            tenantName: tenantData.tenantName,
            dueDate: tenantData.dueDate,
            currentReading: 0,
            previousReading: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        } else {
          // Update existing room
          const roomDocRef = roomSnapshot.docs[0].ref;
          await updateDoc(roomDocRef, {
            rent: tenantData.rent,
            ratePerUnit: tenantData.ratePerUnit,
            status: 'filled',
            tenantName: tenantData.tenantName,
            dueDate: tenantData.dueDate,
            updatedAt: serverTimestamp()
          });
        }

        // 2. Update/Create Tenant
        const tenantsRef = collection(db, 'tenants');
        const tenantQuery = query(
          tenantsRef,
          where('roomNumber', '==', tenantData.roomNumber),
          where('isActive', '==', true)
        );
        const tenantSnapshot = await getDocs(tenantQuery);

        let uniqueToken;
        if (tenantSnapshot.empty) {
          // Create new tenant
          const newTenantRef = doc(tenantsRef);
          uniqueToken = `tenant_${tenantData.roomNumber}_${Date.now()}`;

          await setDoc(newTenantRef, {
            name: tenantData.tenantName,
            roomNumber: tenantData.roomNumber,
            phone: '',
            email: '',
            isActive: true,
            uniqueToken: uniqueToken,
            currentRent: tenantData.rent,
            dueDate: tenantData.dueDate,
            checkInDate: new Date().toISOString().split('T')[0],
            securityDeposit: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        } else {
          // Update existing tenant
          const tenantDocRef = tenantSnapshot.docs[0].ref;
          const existingData = tenantSnapshot.docs[0].data();
          uniqueToken = existingData.uniqueToken;

          await updateDoc(tenantDocRef, {
            name: tenantData.tenantName,
            currentRent: tenantData.rent,
            dueDate: tenantData.dueDate,
            isActive: true,
            updatedAt: serverTimestamp()
          });
        }

        results.push({
          roomNumber: tenantData.roomNumber,
          tenantName: tenantData.tenantName,
          rent: tenantData.rent,
          dueDate: tenantData.dueDate,
          portalLink: `${window.location.origin}/t/${uniqueToken}`,
          uniqueToken
        });
      }

      setResult({
        success: true,
        floor: floorNumber,
        count: results.length,
        tenants: results
      });
    } catch (error) {
      console.error('Error setting up floor:', error);
      setResult({
        success: false,
        error: error.message
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">🚀 Setup Tenants 2026</h1>
        <p className="text-gray-600">
          Setup tenant information for the new year. This will update rooms and create tenant portal access.
        </p>
      </div>

      {/* Important Info */}
      <div className="card bg-yellow-50 border-2 border-yellow-300 mb-6">
        <div className="flex items-start gap-3">
          <span className="text-3xl">⚠️</span>
          <div className="flex-1">
            <h3 className="font-bold text-yellow-900 mb-2">Important: Run Setup Before Sharing Links</h3>
            <ul className="text-yellow-800 text-sm space-y-1 list-disc list-inside">
              <li><strong>Step 1:</strong> Click Floor 1 or Floor 2 button below to create tenant accounts</li>
              <li><strong>Step 2:</strong> Copy the generated portal links for each tenant</li>
              <li><strong>Step 3:</strong> Share links via WhatsApp or SMS (use Tenants page for quick sharing)</li>
              <li><strong>Step 4:</strong> Test links by clicking "Test" button to verify they work</li>
              <li>⚠️ If tenants get "Invalid link" error = Setup not run yet!</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Floor Selection */}
      <div className="card mb-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Select Floor to Setup</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => setupFloor('1')}
            disabled={loading}
            className="p-6 rounded-lg border-2 border-green-300 bg-green-50 hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <div className="text-4xl mb-2">🏠</div>
            <h3 className="text-xl font-bold text-green-800 mb-2">Floor 1</h3>
            <p className="text-sm text-green-700">Rooms 101-106 (6 rooms)</p>
            <p className="text-xs text-green-600 mt-2">All tenant details ready</p>
          </button>

          <button
            onClick={() => setupFloor('2')}
            disabled={loading}
            className="p-6 rounded-lg border-2 border-blue-300 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <div className="text-4xl mb-2">🏢</div>
            <h3 className="text-xl font-bold text-blue-800 mb-2">Floor 2</h3>
            <p className="text-sm text-blue-700">Rooms 201-206 (6 rooms filled)</p>
            <p className="text-xs text-blue-600 mt-2">Ready to setup!</p>
          </button>
        </div>
      </div>

      {/* Floor 1 Details */}
      <div className="card mb-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">📋 Floor 1 Tenant Details</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Room</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Tenant Name</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Rent</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Due Date</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Rate/Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {floor1Tenants.map((tenant) => (
                <tr key={tenant.roomNumber} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-semibold">{tenant.roomNumber}</td>
                  <td className="px-3 py-2">{tenant.tenantName}</td>
                  <td className="px-3 py-2 text-right">₹{tenant.rent.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2 text-right">{tenant.dueDate}th each month</td>
                  <td className="px-3 py-2 text-right">₹{tenant.ratePerUnit}/unit</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Floor 2 Details */}
      <div className="card mb-6">
        <h2 className="text-xl font-bold text-gray-800 mb-4">📋 Floor 2 Tenant Details</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Room</th>
                <th className="px-3 py-2 text-left font-semibold text-gray-700">Tenant Name</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Rent</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Due Date</th>
                <th className="px-3 py-2 text-right font-semibold text-gray-700">Rate/Unit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {floor2Tenants.filter(t => t.tenantName).map((tenant) => (
                <tr key={tenant.roomNumber} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-semibold">{tenant.roomNumber}</td>
                  <td className="px-3 py-2">{tenant.tenantName}</td>
                  <td className="px-3 py-2 text-right">₹{tenant.rent.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2 text-right">{tenant.dueDate}th each month</td>
                  <td className="px-3 py-2 text-right">₹{tenant.ratePerUnit}/unit</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="card text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Setting up tenants...</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className={`card ${result.success ? 'bg-green-50 border-2 border-green-300' : 'bg-red-50 border-2 border-red-300'}`}>
          {result.success ? (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className="text-4xl">✅</div>
                <div>
                  <h3 className="text-2xl font-bold text-green-800">Setup Successful!</h3>
                  <p className="text-green-700">Floor {result.floor} - {result.count} tenants configured</p>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-bold text-gray-800 mb-2">📱 Tenant Portal Links:</h4>
                {result.tenants.map((tenant) => (
                  <div key={tenant.roomNumber} className="bg-white rounded-lg p-4 border border-green-200">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-bold text-gray-800">Room {tenant.roomNumber} - {tenant.tenantName}</p>
                        <p className="text-sm text-gray-600">Rent: ₹{tenant.rent.toLocaleString('en-IN')} | Due: {tenant.dueDate}th</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => window.open(tenant.portalLink, '_blank')}
                          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                          title="Open portal link in new tab to test"
                        >
                          🔗 Test
                        </button>
                        <button
                          onClick={() => navigator.clipboard.writeText(tenant.portalLink)}
                          className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
                        >
                          📋 Copy
                        </button>
                      </div>
                    </div>
                    <div className="bg-gray-50 rounded p-2 text-xs font-mono break-all">
                      {tenant.portalLink}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-blue-800 font-semibold mb-2">📤 Next Steps:</p>
                <ul className="text-blue-700 text-sm space-y-1 ml-4">
                  <li>1. Copy each tenant's portal link</li>
                  <li>2. Share the link via WhatsApp/SMS with respective tenants</li>
                  <li>3. Tenants can view their room details and make payments</li>
                  <li>4. Setup QR code in Bank Accounts section for UPI payments</li>
                </ul>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <div className="text-4xl">❌</div>
                <div>
                  <h3 className="text-2xl font-bold text-red-800">Setup Failed</h3>
                  <p className="text-red-700">{result.error}</p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Info Box */}
      <div className="card bg-blue-50 border border-blue-200 mt-6">
        <h3 className="font-bold text-blue-900 mb-2">ℹ️ Important Information</h3>
        <ul className="text-blue-800 text-sm space-y-2">
          <li>• This will update room details with new tenant information</li>
          <li>• Each tenant will get a unique portal link for self-service access</li>
          <li>• Electricity rate is set to ₹9 per unit for all rooms</li>
          <li>• Tenants can view their room, meter readings, and payment history</li>
          <li>• Setup UPI/QR code in Bank Accounts for payment collection</li>
          <li>• Portal links are permanent and secure for each tenant</li>
        </ul>
      </div>
    </div>
  );
};

export default SetupTenants2026;
