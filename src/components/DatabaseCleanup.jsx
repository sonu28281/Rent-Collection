import React, { useState } from 'react';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * DatabaseCleanup Component
 * 
 * Admin-only tool to clear transactional data from Firebase
 * - Deletes all payments
 * - Deletes all importLogs
 * - Preserves essential data (rooms, tenants, settings, admin, bankAccounts)
 */
function DatabaseCleanup() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [roomCleanupLoading, setRoomCleanupLoading] = useState(false);
  const [invalidRooms, setInvalidRooms] = useState([]);
  const [allRooms, setAllRooms] = useState([]);
  const [selectedRooms, setSelectedRooms] = useState([]);
  const [showManualDelete, setShowManualDelete] = useState(false);

  /**
   * Get document counts from collections
   */
  const getStats = async () => {
    try {
      const [payments, importLogs, rooms, tenants, settings, bankAccounts] = await Promise.all([
        getDocs(collection(db, 'payments')),
        getDocs(collection(db, 'importLogs')),
        getDocs(collection(db, 'rooms')),
        getDocs(collection(db, 'tenants')),
        getDocs(collection(db, 'settings')),
        getDocs(collection(db, 'bankAccounts'))
      ]);

      return {
        payments: payments.size,
        importLogs: importLogs.size,
        rooms: rooms.size,
        tenants: tenants.size,
        settings: settings.size,
        bankAccounts: bankAccounts.size,
        totalToDelete: payments.size + importLogs.size
      };
    } catch (err) {
      console.error('Error getting stats:', err);
      throw err;
    }
  };

  /**
   * Find invalid rooms (not in the valid range)
   */
  const findInvalidRooms = async () => {
    try {
      setRoomCleanupLoading(true);
      const validRoomNumbers = [101, 102, 103, 104, 105, 106, 201, 202, 203, 204, 205, 206];
      
      const roomsRef = collection(db, 'rooms');
      const snapshot = await getDocs(roomsRef);
      
      const invalid = [];
      snapshot.forEach((docSnap) => {
        const roomData = docSnap.data();
        const roomNumber = Number(roomData.roomNumber);
        
        if (!validRoomNumbers.includes(roomNumber)) {
          invalid.push({
            id: docSnap.id,
            roomNumber: roomNumber,
            status: roomData.status,
            tenantName: roomData.tenantName || 'N/A'
          });
        }
      });
      
      setInvalidRooms(invalid);
      return invalid;
    } catch (err) {
      console.error('Error finding invalid rooms:', err);
      setError('Failed to scan rooms: ' + err.message);
      return [];
    } finally {
      setRoomCleanupLoading(false);
    }
  };

  /**
   * Remove invalid rooms from database
   */
  const removeInvalidRooms = async () => {
    if (!window.confirm(`⚠️ Delete ${invalidRooms.length} invalid room(s)?\\n\\nThis cannot be undone.`)) {
      return;
    }

    try {
      setRoomCleanupLoading(true);
      const batch = writeBatch(db);
      
      invalidRooms.forEach((room) => {
        batch.delete(doc(db, 'rooms', room.id));
      });
      
      await batch.commit();
      
      alert(`✅ Successfully deleted ${invalidRooms.length} invalid room(s)!`);
      setInvalidRooms([]);
      
      // Refresh stats
      if (stats) {
        const newStats = await getStats();
        setStats(newStats);
      }
    } catch (err) {
      console.error('Error removing invalid rooms:', err);
      setError('Failed to remove rooms: ' + err.message);
    } finally {
      setRoomCleanupLoading(false);
    }
  };

  /**
   * Load all rooms for manual deletion
   */
  const loadAllRooms = async () => {
    try {
      setRoomCleanupLoading(true);
      const roomsRef = collection(db, 'rooms');
      const snapshot = await getDocs(roomsRef);
      
      const rooms = [];
      snapshot.forEach((docSnap) => {
        const roomData = docSnap.data();
        rooms.push({
          id: docSnap.id,
          roomNumber: Number(roomData.roomNumber) || roomData.roomNumber,
          status: roomData.status || 'unknown',
          tenantName: roomData.tenantName || 'N/A',
          rent: roomData.rent || 0,
          floor: roomData.floor || 'N/A'
        });
      });
      
      // Sort by room number
      rooms.sort((a, b) => {
        const numA = Number(a.roomNumber) || 0;
        const numB = Number(b.roomNumber) || 0;
        return numA - numB;
      });
      
      setAllRooms(rooms);
      setShowManualDelete(true);
    } catch (err) {
      console.error('Error loading rooms:', err);
      setError('Failed to load rooms: ' + err.message);
    } finally {
      setRoomCleanupLoading(false);
    }
  };

  /**
   * Toggle room selection
   */
  const toggleRoomSelection = (roomId) => {
    setSelectedRooms(prev => {
      if (prev.includes(roomId)) {
        return prev.filter(id => id !== roomId);
      } else {
        return [...prev, roomId];
      }
    });
  };

  /**
   * Select/Deselect all rooms
   */
  const toggleSelectAll = () => {
    if (selectedRooms.length === allRooms.length) {
      setSelectedRooms([]);
    } else {
      setSelectedRooms(allRooms.map(room => room.id));
    }
  };

  /**
   * Delete selected rooms
   */
  const deleteSelectedRooms = async () => {
    if (selectedRooms.length === 0) {
      alert('⚠️ Please select at least one room to delete');
      return;
    }

    if (!window.confirm(`⚠️ Delete ${selectedRooms.length} room(s)?\\n\\nThis cannot be undone.`)) {
      return;
    }

    try {
      setRoomCleanupLoading(true);
      const batch = writeBatch(db);
      
      selectedRooms.forEach((roomId) => {
        batch.delete(doc(db, 'rooms', roomId));
      });
      
      await batch.commit();
      
      alert(`✅ Successfully deleted ${selectedRooms.length} room(s)!`);
      
      // Reload rooms list
      setSelectedRooms([]);
      await loadAllRooms();
      
      // Refresh stats
      if (stats) {
        const newStats = await getStats();
        setStats(newStats);
      }
    } catch (err) {
      console.error('Error deleting rooms:', err);
      setError('Failed to delete rooms: ' + err.message);
    } finally {
      setRoomCleanupLoading(false);
    }
  };

  /**
   * Delete all documents from a collection in batches
   */
  const clearCollection = async (collectionName, onProgress) => {
    const collectionRef = collection(db, collectionName);
    const snapshot = await getDocs(collectionRef);
    const totalDocs = snapshot.size;
    
    if (totalDocs === 0) {
      return 0;
    }
    
    let deletedCount = 0;
    let batch = writeBatch(db);
    let batchCount = 0;
    
    for (const docSnap of snapshot.docs) {
      batch.delete(doc(db, collectionName, docSnap.id));
      batchCount++;
      
      // Firestore batch limit is 500 operations
      if (batchCount === 500) {
        await batch.commit();
        deletedCount += batchCount;
        onProgress && onProgress(collectionName, deletedCount, totalDocs);
        batch = writeBatch(db);
        batchCount = 0;
      }
    }
    
    // Commit remaining documents
    if (batchCount > 0) {
      await batch.commit();
      deletedCount += batchCount;
    }
    
    return deletedCount;
  };

  /**
   * Load current database statistics
   */
  const handleLoadStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const currentStats = await getStats();
      setStats(currentStats);
    } catch (err) {
      setError('Failed to load database statistics: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Perform the cleanup operation
   */
  const handleCleanup = async () => {
    setLoading(true);
    setError(null);
    setShowConfirm(false);
    
    try {
      const startTime = Date.now();
      
      // Track progress
      const progress = { payments: 0, importLogs: 0 };
      
      const onProgress = (collectionName, current, total) => {
        progress[collectionName] = current;
        console.log(`Deleting ${collectionName}: ${current}/${total}`);
      };
      
      // Delete payments
      const deletedPayments = await clearCollection('payments', onProgress);
      
      // Delete import logs
      const deletedLogs = await clearCollection('importLogs', onProgress);
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      // Update stats
      const newStats = await getStats();
      setStats(newStats);
      
      alert(
        `✅ Cleanup Completed!\n\n` +
        `Deleted:\n` +
        `• ${deletedPayments} payment records\n` +
        `• ${deletedLogs} import logs\n\n` +
        `Time taken: ${duration} seconds\n\n` +
        `Database is ready for fresh import!`
      );
      
    } catch (err) {
      console.error('Cleanup error:', err);
      setError('Cleanup failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <span className="text-3xl">🗑️</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Database Cleanup</h1>
            <p className="text-sm text-gray-600">Clear transactional data to free up Firebase quota</p>
          </div>
        </div>

        {/* Warning Banner */}
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6">
          <div className="flex items-start">
            <span className="text-2xl mr-3">⚠️</span>
            <div>
              <h3 className="text-red-800 font-semibold mb-1">Warning: Destructive Operation</h3>
              <p className="text-red-700 text-sm">
                This will permanently delete ALL payment records and import logs. 
                Essential data (rooms, tenants, settings) will be preserved.
              </p>
            </div>
          </div>
        </div>

        {/* Room Cleanup Section */}
        <div className="bg-orange-50 border-2 border-orange-300 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3 mb-3">
            <span className="text-2xl">🏠</span>
            <div className="flex-1">
              <h3 className="text-orange-800 font-semibold mb-1">Clean Up Invalid Rooms</h3>
              <p className="text-orange-700 text-sm mb-3">
                Remove rooms that don't belong to your property (only 101-106 and 201-206 are valid)
              </p>
              
              <div className="flex gap-2">
                <button
                  onClick={findInvalidRooms}
                  disabled={roomCleanupLoading}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
                >
                  {roomCleanupLoading ? '⏳ Scanning...' : '🔍 Scan for Invalid Rooms'}
                </button>
                <button
                  onClick={loadAllRooms}
                  disabled={roomCleanupLoading}
                  className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
                >
                  {roomCleanupLoading ? '⏳ Loading...' : '📋 Manual Delete'}
                </button>
              </div>
            </div>
          </div>

          {invalidRooms.length > 0 && (
            <div className="bg-white border border-orange-200 rounded-lg p-3 mt-3">
              <h4 className="font-semibold text-orange-900 mb-2">
                ⚠️ Found {invalidRooms.length} Invalid Room(s):
              </h4>
              <div className="space-y-2 mb-3 max-h-40 overflow-y-auto">
                {invalidRooms.map((room) => (
                  <div key={room.id} className="flex items-center justify-between text-sm bg-orange-50 p-2 rounded">
                    <div>
                      <span className="font-semibold text-orange-800">Room {room.roomNumber}</span>
                      <span className="text-gray-600 ml-2">• {room.status}</span>
                      {room.tenantName !== 'N/A' && (
                        <span className="text-gray-600 ml-2">• {room.tenantName}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={removeInvalidRooms}
                disabled={roomCleanupLoading}
                className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
              >
                {roomCleanupLoading ? '⏳ Deleting...' : `🗑️ Delete ${invalidRooms.length} Invalid Room(s)`}
              </button>
            </div>
          )}

          {invalidRooms.length === 0 && !roomCleanupLoading && invalidRooms !== null && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-3 text-center text-green-800 text-sm">
              ✅ No invalid rooms found! All rooms are valid (101-106, 201-206)
            </div>
          )}
        </div>

        {/* Manual Room Deletion Modal */}
        {showManualDelete && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-800">🗑️ Manual Room Deletion</h3>
                  <p className="text-sm text-gray-600 mt-1">Select rooms to delete from database</p>
                </div>
                <button
                  onClick={() => {
                    setShowManualDelete(false);
                    setSelectedRooms([]);
                  }}
                  className="text-gray-500 hover:text-gray-700 text-2xl"
                >
                  ✕
                </button>
              </div>

              {allRooms.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <div className="text-5xl mb-2">🏠</div>
                  <p>No rooms found in database</p>
                </div>
              ) : (
                <>
                  {/* Select All */}
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedRooms.length === allRooms.length && allRooms.length > 0}
                        onChange={toggleSelectAll}
                        className="w-5 h-5"
                      />
                      <span className="font-semibold text-gray-800">
                        Select All ({selectedRooms.length} of {allRooms.length} selected)
                      </span>
                    </label>
                  </div>

                  {/* Room List */}
                  <div className="space-y-2 mb-4 max-h-96 overflow-y-auto">
                    {allRooms.map((room) => (
                      <div
                        key={room.id}
                        className={`border rounded-lg p-3 transition-all ${
                          selectedRooms.includes(room.id)
                            ? 'bg-red-50 border-red-300'
                            : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedRooms.includes(room.id)}
                            onChange={() => toggleRoomSelection(room.id)}
                            className="w-5 h-5 mt-1"
                          />
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-bold text-lg text-gray-800">
                                Room {room.roomNumber}
                              </span>
                              <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                room.status === 'filled'
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}>
                                {room.status}
                              </span>
                            </div>
                            <div className="text-sm text-gray-600 space-y-1">
                              <div className="flex gap-4">
                                <span>👤 Tenant: {room.tenantName}</span>
                                <span>🏢 Floor: {room.floor}</span>
                              </div>
                              {room.rent > 0 && (
                                <div>💰 Rent: ₹{room.rent.toLocaleString('en-IN')}</div>
                              )}
                            </div>
                          </div>
                        </label>
                      </div>
                    ))}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowManualDelete(false);
                        setSelectedRooms([]);
                      }}
                      className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-lg"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={deleteSelectedRooms}
                      disabled={selectedRooms.length === 0 || roomCleanupLoading}
                      className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      {roomCleanupLoading ? '⏳ Deleting...' : `🗑️ Delete ${selectedRooms.length} Room(s)`}
                    </button>
                  </div>

                  <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p className="text-yellow-800 text-sm">
                      ⚠️ <strong>Warning:</strong> Deleted rooms cannot be recovered. Make sure you want to remove these rooms permanently.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Load Stats Button */}
        {!stats && (
          <button
            onClick={handleLoadStats}
            disabled={loading}
            className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? '⏳ Loading...' : '📊 Load Database Statistics'}
          </button>
        )}

        {/* Statistics Display */}
        {stats && (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold text-gray-800 mb-3">Current Database State</h3>
              
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">💳 Payments:</span>
                  <span className={`font-bold ${stats.payments > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {stats.payments} records {stats.payments > 0 ? '(will delete)' : '(empty)'}
                  </span>
                </div>
                
                <div className="flex justify-between items-center">
                  <span className="text-gray-700">📋 Import Logs:</span>
                  <span className={`font-bold ${stats.importLogs > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {stats.importLogs} records {stats.importLogs > 0 ? '(will delete)' : '(empty)'}
                  </span>
                </div>
                
                <div className="border-t border-gray-300 my-2"></div>
                
                <div className="flex justify-between items-center font-semibold text-lg">
                  <span className="text-gray-800">Total to Delete:</span>
                  <span className="text-red-600">{stats.totalToDelete} documents</span>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-gray-300">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">✅ Will Keep (Essential Data):</h4>
                <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                  <div>🏠 Rooms: {stats.rooms}</div>
                  <div>👥 Tenants: {stats.tenants}</div>
                  <div>⚙️ Settings: {stats.settings}</div>
                  <div>🏦 Bank Accounts: {stats.bankAccounts}</div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleLoadStats}
                disabled={loading}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                🔄 Refresh Stats
              </button>
              
              {stats.totalToDelete > 0 && (
                <button
                  onClick={() => setShowConfirm(true)}
                  disabled={loading}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {loading ? '⏳ Cleaning...' : '🗑️ Clean Database'}
                </button>
              )}
              
              {stats.totalToDelete === 0 && (
                <div className="flex-1 bg-green-100 text-green-800 font-semibold py-3 px-6 rounded-lg text-center">
                  ✨ Database Already Clean
                </div>
              )}
            </div>
          </div>
        )}

        {/* Confirmation Modal */}
        {showConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md mx-4">
              <h3 className="text-xl font-bold text-gray-800 mb-4">⚠️ Confirm Cleanup</h3>
              <p className="text-gray-700 mb-6">
                Are you sure you want to delete <strong>{stats.totalToDelete}</strong> documents?
                <br /><br />
                This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCleanup}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg"
                >
                  Yes, Delete All
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Info Section */}
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">ℹ️ What gets deleted?</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>All payment records (including historical data)</li>
            <li>All import logs and backup history</li>
          </ul>
          
          <h3 className="font-semibold text-blue-900 mt-3 mb-2">✅ What is preserved?</h3>
          <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
            <li>Room configurations</li>
            <li>Tenant information</li>
            <li>Settings and bank account details</li>
            <li>Admin authentication</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default DatabaseCleanup;
