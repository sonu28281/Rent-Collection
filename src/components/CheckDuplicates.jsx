import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { VALID_ROOM_NUMBERS } from '../utils/roomValidation';

/**
 * Check and Remove Duplicate Rooms & Tenants
 * Ensures only 12 rooms exist (101-106, 201-206)
 */
const CheckDuplicates = () => {
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch all rooms
      const roomsRef = collection(db, 'rooms');
      const roomsQuery = query(roomsRef, orderBy('roomNumber'));
      const roomsSnapshot = await getDocs(roomsQuery);
      const roomsData = roomsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      // Fetch all tenants
      const tenantsRef = collection(db, 'tenants');
      const tenantsQuery = query(tenantsRef, orderBy('roomNumber'));
      const tenantsSnapshot = await getDocs(tenantsQuery);
      const tenantsData = tenantsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setRooms(roomsData);
      setTenants(tenantsData);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCleanupDuplicates = async () => {
    setDeleting(true);
    setResult(null);

    const results = {
      roomsDeleted: [],
      tenantsDeleted: [],
      roomsKept: [],
      tenantsKept: [],
      errors: []
    };

    try {
      // Use validation utility for valid room numbers
      const validRoomNumbers = VALID_ROOM_NUMBERS;

      // Track which room numbers we've already kept
      const keptRoomNumbers = new Set();
      const keptTenantRoomNumbers = new Set();

      // Clean up rooms - keep only first record for each room number
      for (const room of rooms) {
        if (!validRoomNumbers.includes(room.roomNumber)) {
          // Invalid room number - delete
          try {
            await deleteDoc(doc(db, 'rooms', room.id));
            results.roomsDeleted.push(`Room ${room.roomNumber} (invalid room number)`);
          } catch (error) {
            results.errors.push(`Failed to delete room ${room.roomNumber}: ${error.message}`);
          }
        } else if (keptRoomNumbers.has(room.roomNumber)) {
          // Duplicate - delete
          try {
            await deleteDoc(doc(db, 'rooms', room.id));
            results.roomsDeleted.push(`Room ${room.roomNumber} (duplicate)`);
          } catch (error) {
            results.errors.push(`Failed to delete duplicate room ${room.roomNumber}: ${error.message}`);
          }
        } else {
          // First occurrence - keep
          keptRoomNumbers.add(room.roomNumber);
          results.roomsKept.push(`Room ${room.roomNumber}`);
        }
      }

      // Clean up tenants - keep only first record for each room number
      for (const tenant of tenants) {
        if (!validRoomNumbers.includes(tenant.roomNumber)) {
          // Invalid room number - delete
          try {
            await deleteDoc(doc(db, 'tenants', tenant.id));
            results.tenantsDeleted.push(`Tenant ${tenant.name} - Room ${tenant.roomNumber} (invalid room number)`);
          } catch (error) {
            results.errors.push(`Failed to delete tenant ${tenant.name}: ${error.message}`);
          }
        } else if (keptTenantRoomNumbers.has(tenant.roomNumber)) {
          // Duplicate - delete
          try {
            await deleteDoc(doc(db, 'tenants', tenant.id));
            results.tenantsDeleted.push(`Tenant ${tenant.name} - Room ${tenant.roomNumber} (duplicate)`);
          } catch (error) {
            results.errors.push(`Failed to delete duplicate tenant ${tenant.name}: ${error.message}`);
          }
        } else {
          // First occurrence - keep
          keptTenantRoomNumbers.add(tenant.roomNumber);
          results.tenantsKept.push(`Tenant ${tenant.name} - Room ${tenant.roomNumber}`);
        }
      }

      setResult(results);
      
      // Refresh data
      await fetchData();
    } catch (error) {
      console.error('Error cleaning up duplicates:', error);
      results.errors.push(`Fatal error: ${error.message}`);
      setResult(results);
    } finally {
      setDeleting(false);
    }
  };

  // Group rooms by room number to show duplicates
  const roomGroups = {};
  rooms.forEach(room => {
    if (!roomGroups[room.roomNumber]) {
      roomGroups[room.roomNumber] = [];
    }
    roomGroups[room.roomNumber].push(room);
  });

  // Group tenants by room number to show duplicates
  const tenantGroups = {};
  tenants.forEach(tenant => {
    if (!tenantGroups[tenant.roomNumber]) {
      tenantGroups[tenant.roomNumber] = [];
    }
    tenantGroups[tenant.roomNumber].push(tenant);
  });

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <div className="bg-white rounded-lg shadow-lg p-6 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <div className="bg-white rounded-lg shadow-lg p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">🔍 Check & Remove Duplicates</h1>
          <p className="text-gray-600">
            Building has exactly 12 rooms: Floor 1 (101-106), Floor 2 (201-206)
          </p>
        </div>

        {/* CRITICAL WARNING if more than 12 */}
        {(rooms.length > 12 || tenants.length > 12) && (
          <div className="bg-red-100 border-4 border-red-500 rounded-lg p-6 mb-6 animate-pulse">
            <h3 className="text-2xl font-bold text-red-900 mb-2">🚨 ALERT: Extra Records Detected!</h3>
            <p className="text-red-800 text-lg">
              <strong>Building has only 12 rooms (101-106, 201-206)</strong>
            </p>
            <p className="text-red-700 mt-2">
              Duplicates must be removed immediately to prevent data corruption.
            </p>
          </div>
        )}

        {/* Current Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className={`p-4 rounded-lg border-2 ${rooms.length === 12 ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
            <h3 className="font-bold text-lg mb-1">
              {rooms.length === 12 ? '✅' : '❌'} Rooms Count
            </h3>
            <p className="text-3xl font-bold">{rooms.length}</p>
            <p className="text-sm text-gray-600">Expected: 12 rooms (Fixed since 2018)</p>
          </div>

          <div className={`p-4 rounded-lg border-2 ${tenants.length === 12 ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
            <h3 className="font-bold text-lg mb-1">
              {tenants.length === 12 ? '✅' : '❌'} Tenants Count
            </h3>
            <p className="text-3xl font-bold">{tenants.length}</p>
            <p className="text-sm text-gray-600">Expected: 12 tenants (max capacity)</p>
          </div>
        </div>

        {/* Duplicate Rooms */}
        {Object.values(roomGroups).some(group => group.length > 1) && (
          <div className="bg-red-50 border border-red-300 rounded-lg p-4 mb-4">
            <h3 className="font-bold text-red-900 mb-3">⚠️ Duplicate Rooms Found:</h3>
            <div className="space-y-2">
              {Object.entries(roomGroups)
                .filter(([, group]) => group.length > 1)
                .map(([roomNumber, group]) => (
                  <div key={roomNumber} className="bg-white rounded p-2 border border-red-200">
                    <p className="font-semibold text-red-800">
                      Room {roomNumber}: {group.length} records found
                    </p>
                    <ul className="ml-4 text-sm text-red-700">
                      {group.map((room, idx) => (
                        <li key={room.id}>
                          #{idx + 1}: ID {room.id.substring(0, 8)}... - {room.isOccupied ? 'Occupied' : 'Vacant'}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Duplicate Tenants */}
        {Object.values(tenantGroups).some(group => group.length > 1) && (
          <div className="bg-red-50 border border-red-300 rounded-lg p-4 mb-4">
            <h3 className="font-bold text-red-900 mb-3">⚠️ Duplicate Tenants Found:</h3>
            <div className="space-y-2">
              {Object.entries(tenantGroups)
                .filter(([, group]) => group.length > 1)
                .map(([roomNumber, group]) => (
                  <div key={roomNumber} className="bg-white rounded p-2 border border-red-200">
                    <p className="font-semibold text-red-800">
                      Room {roomNumber}: {group.length} tenants found
                    </p>
                    <ul className="ml-4 text-sm text-red-700">
                      {group.map((tenant, idx) => (
                        <li key={tenant.id}>
                          #{idx + 1}: {tenant.name} - Username: {tenant.username} - ID: {tenant.id.substring(0, 8)}...
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Action Button */}
        {!result && (rooms.length > 12 || tenants.length > 12) && (
          <button
            onClick={handleCleanupDuplicates}
            disabled={deleting}
            className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {deleting ? '⏳ Cleaning Up...' : '🧹 Remove All Duplicates (Keep First Record)'}
          </button>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {result.roomsDeleted.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h3 className="font-bold text-orange-800 mb-2">🗑️ Rooms Deleted ({result.roomsDeleted.length})</h3>
                <ul className="text-orange-700 text-sm space-y-1 list-disc list-inside max-h-40 overflow-y-auto">
                  {result.roomsDeleted.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.tenantsDeleted.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <h3 className="font-bold text-orange-800 mb-2">🗑️ Tenants Deleted ({result.tenantsDeleted.length})</h3>
                <ul className="text-orange-700 text-sm space-y-1 list-disc list-inside max-h-40 overflow-y-auto">
                  {result.tenantsDeleted.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.roomsKept.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-bold text-green-800 mb-2">✅ Rooms Kept ({result.roomsKept.length})</h3>
                <ul className="text-green-700 text-sm space-y-1 list-disc list-inside max-h-40 overflow-y-auto">
                  {result.roomsKept.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.tenantsKept.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <h3 className="font-bold text-green-800 mb-2">✅ Tenants Kept ({result.tenantsKept.length})</h3>
                <ul className="text-green-700 text-sm space-y-1 list-disc list-inside max-h-40 overflow-y-auto">
                  {result.tenantsKept.map((item, idx) => (
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

            <button
              onClick={() => {
                setResult(null);
                fetchData();
              }}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg transition-colors"
            >
              🔄 Check Again
            </button>
          </div>
        )}

        {/* Success - No Duplicates */}
        {!result && rooms.length === 12 && tenants.length === 12 && (
          <div className="bg-green-50 border border-green-300 rounded-lg p-6 text-center">
            <p className="text-green-800 text-xl font-bold mb-2">✅ Perfect!</p>
            <p className="text-green-700">Exactly 12 rooms and 12 tenants. No duplicates found.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckDuplicates;
