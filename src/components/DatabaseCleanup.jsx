import { useState } from 'react';
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
