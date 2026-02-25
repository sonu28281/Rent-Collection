import { useState } from 'react';
import { collection, query, where, getDocs, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Simple Tenant Setup for 2026
 * 
 * Creates tenants with USERNAME/PASSWORD login (not token)
 * - Username = Room Number (e.g., "101")  
 * - Password = "password" (tenant can change later)
 * 
 * Prevents duplicates by deleting existing tenants before creating
 */
const SetupTenants2026 = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  // Floor 1 tenant data
  const floor1Tenants = [
    { roomNumber: '101', tenantName: 'Janvi Singh', dueDate: 20, rent: 3200, phone: '' },
    { roomNumber: '102', tenantName: 'Aadarsh Sharma', dueDate: 1, rent: 2500, phone: '' },
    { roomNumber: '103', tenantName: 'DK Singh', dueDate: 22, rent: 3500, phone: '' },
    { roomNumber: '104', tenantName: 'Raj Singh', dueDate: 1, rent: 3800, phone: '' },
    { roomNumber: '105', tenantName: 'Akash Singh', dueDate: 1, rent: 2500, phone: '' },
    { roomNumber: '106', tenantName: 'Akash Singh', dueDate: 1, rent: 2500, phone: '' }
  ];

  // Floor 2 tenant data
  const floor2Tenants = [
    { roomNumber: '201', tenantName: 'Saurabh Singh', dueDate: 22, rent: 3200, phone: '' },
    { roomNumber: '202', tenantName: 'Sumit Yadav', dueDate: 20, rent: 3000, phone: '' },
    { roomNumber: '203', tenantName: 'Manali Singh', dueDate: 1, rent: 4000, phone: '' },
    { roomNumber: '204', tenantName: 'Suneel Gupta', dueDate: 20, rent: 4000, phone: '' },
    { roomNumber: '205', tenantName: 'Veer Singh', dueDate: 1, rent: 3800, phone: '' },
    { roomNumber: '206', tenantName: 'Sanjeev Rastogi', dueDate: 1, rent: 2500, phone: '' }
  ];

  const setupFloor = async (floorNumber) => {
    setLoading(true);
    setResult(null);

    try {
      const tenants = floorNumber === '1' ? floor1Tenants : floor2Tenants;
      const results = [];

      for (const tenantData of tenants) {
        // 1. Delete ANY existing tenant for this room (to prevent duplicates)
        const tenantsRef = collection(db, 'tenants');
        const existingQuery = query(tenantsRef, where('roomNumber', '==', tenantData.roomNumber));
        const existingSnap = await getDocs(existingQuery);
        
        for (const docSnap of existingSnap.docs) {
          await deleteDoc(doc(db, 'tenants', docSnap.id));
        }

        // 2. Create NEW tenant with simple username/password
        const newTenantRef = doc(tenantsRef);
        const username = tenantData.roomNumber; // Room number IS the username
        const password = 'password';  // Default password
        
        await setDoc(newTenantRef, {
          // Basic Info
          name: tenantData.tenantName,
          roomNumber: tenantData.roomNumber,
          phone: tenantData.phone || '',
          email: '',
          
          // Login Credentials
          username: username,  // e.g., "101"
          password: password,  // Simple default password
          
          // Status
          isActive: true,
          
          // Rent Info
          currentRent: tenantData.rent,
          dueDate: tenantData.dueDate,
          
          // Dates
          checkInDate: new Date().toISOString().split('T')[0],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        // 3. Update/Create Room record
        const roomsRef = collection(db, 'rooms');
        const roomQuery = query(roomsRef, where('roomNumber', '==', tenantData.roomNumber));
        const roomSnapshot = await getDocs(roomQuery);

        if (roomSnapshot.empty) {
          // Create new room
          const newRoomRef = doc(roomsRef);
          await setDoc(newRoomRef, {
            roomNumber: tenantData.roomNumber,
            floor: parseInt(tenantData.roomNumber) < 200 ? 1 : 2,
            rent: tenantData.rent,
            ratePerUnit: 9,
            status: 'filled',
            tenantName: tenantData.tenantName,
            dueDate: tenantData.dueDate,
            electricityMeterNo: `MTR${tenantData.roomNumber}`,
            currentReading: 0,
            previousReading: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        } else {
          // Update existing room
          const roomDocRef = roomSnapshot.docs[0].ref;
          await setDoc(roomDocRef, {
            roomNumber: tenantData.roomNumber,
            floor: parseInt(tenantData.roomNumber) < 200 ? 1 : 2,
            rent: tenantData.rent,
            ratePerUnit: 9,
            status: 'filled',
            tenantName: tenantData.tenantName,
            dueDate: tenantData.dueDate,
            electricityMeterNo: `MTR${tenantData.roomNumber}`,
            updatedAt: serverTimestamp()
          }, { merge: true });
        }

        results.push({
          roomNumber: tenantData.roomNumber,
          tenantName: tenantData.tenantName,
          username: username,
          password: password
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
        <p className="text-gray-600">Create tenant accounts with simple username/password login</p>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-6 mb-6">
        <h3 className="font-bold text-blue-900 mb-3">📋 How This Works:</h3>
        <ul className="space-y-2 text-blue-800">
          <li>✓ <strong>Username</strong> = Room Number (e.g., "101", "202")</li>
          <li>✓ <strong>Password</strong> = "password" (default)</li>
          <li>✓ Each button creates 6 tenants (one per room)</li>
          <li>✓ Safe to click multiple times - prevents duplicates automatically</li>
          <li>✓ Tenant portal: Login with room number and password</li>
        </ul>
      </div>

      {/* Setup Buttons */}
      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Floor 1 */}
        <div className="card border-2 border-blue-200">
          <h3 className="text-xl font-bold mb-4">Floor 1 (Rooms 101-106)</h3>
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-sm font-semibold text-gray-700 mb-2">Tenants:</p>
            <ul className="text-sm text-gray-600 space-y-1">
              {floor1Tenants.map(t => (
                <li key={t.roomNumber}>Room {t.roomNumber} - {t.tenantName} (₹{t.rent})</li>
              ))}
            </ul>
          </div>
          <button
            onClick={() => setupFloor('1')}
            disabled={loading}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '⏳ Setting up...' : '🚀 Setup Floor 1'}
          </button>
        </div>

        {/* Floor 2 */}
        <div className="card border-2 border-purple-200">
          <h3 className="text-xl font-bold mb-4">Floor 2 (Rooms 201-206)</h3>
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-sm font-semibold text-gray-700 mb-2">Tenants:</p>
            <ul className="text-sm text-gray-600 space-y-1">
              {floor2Tenants.map(t => (
                <li key={t.roomNumber}>Room {t.roomNumber} - {t.tenantName} (₹{t.rent})</li>
              ))}
            </ul>
          </div>
          <button
            onClick={() => setupFloor('2')}
            disabled={loading}
            className="w-full bg-purple-500 hover:bg-purple-600 text-white font-bold py-3 px-6 rounded-lg disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '⏳ Setting up...' : '🚀 Setup Floor 2'}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className={`card ${result.success ? 'bg-green-50 border-2 border-green-300' : 'bg-red-50 border-2 border-red-300'}`}>
          {result.success ? (
            <>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-4xl">✅</span>
                <div>
                  <h3 className="text-2xl font-bold text-green-800">Setup Complete!</h3>
                  <p className="text-green-700">Created {result.count} tenants for Floor {result.floor}</p>
                </div>
              </div>

              <div className="bg-white border border-green-300 rounded-lg p-4 mb-4">
                <h4 className="font-bold text-gray-800 mb-3">📋 Tenant Login Credentials:</h4>
                <div className="space-y-3">
                  {result.tenants.map((tenant) => (
                    <div key={tenant.roomNumber} className="bg-gray-50 border border-gray-300 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-bold text-gray-800">
                          Room {tenant.roomNumber} - {tenant.tenantName}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-gray-600">Username:</p>
                          <p className="font-mono font-bold text-blue-600">{tenant.username}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Password:</p>
                          <p className="font-mono font-bold text-blue-600">{tenant.password}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-4">
                <p className="text-sm text-yellow-800">
                  <strong>💡 Share with tenants:</strong> Each tenant can login at the tenant portal using their room number as username and "password" as password.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-4xl">❌</span>
                <div>
                  <h3 className="text-2xl font-bold text-red-800">Setup Failed</h3>
                  <p className="text-red-700">{result.error}</p>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SetupTenants2026;
