import { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

const Settings = () => {
  const [settings, setSettings] = useState(null);
  const [electricityRate, setElectricityRate] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  
  // Database Cleanup States
  const [showCleanupConfirm, setShowCleanupConfirm] = useState(false);
  const [cleanupText, setCleanupText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [recordCounts, setRecordCounts] = useState({ payments: 0, importLogs: 0, roomStatusLogs: 0 });
  const [cleanupProgress, setCleanupProgress] = useState('');

  useEffect(() => {
    fetchSettings();
    fetchRecordCounts();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const settingsRef = collection(db, 'settings');
      const settingsSnapshot = await getDocs(settingsRef);
      
      if (!settingsSnapshot.empty) {
        const settingsData = { id: settingsSnapshot.docs[0].id, ...settingsSnapshot.docs[0].data() };
        setSettings(settingsData);
        setElectricityRate(settingsData.electricityRate || '9');
      } else {
        // No settings exist yet, set defaults
        setElectricityRate('9');
      }
      
      setLoading(false);
    } catch (err) {
      console.error('Error fetching settings:', err);
      setError('Failed to load settings. Please try again.');
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    
    const rate = parseFloat(electricityRate);
    if (isNaN(rate) || rate < 0) {
      setError('Please enter a valid positive number for electricity rate');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage('');

      const settingsData = {
        electricityRate: rate,
        updatedAt: new Date().toISOString()
      };

      if (settings && settings.id) {
        // Update existing settings
        await updateDoc(doc(db, 'settings', settings.id), settingsData);
      } else {
        // Create new settings document with fixed ID
        await setDoc(doc(db, 'settings', 'global'), {
          ...settingsData,
          createdAt: new Date().toISOString()
        });
      }

      setSuccessMessage('✅ Settings saved successfully!');
      fetchSettings();
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error saving settings:', err);
      setError('Failed to save settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Fetch record counts for cleanup confirmation
  const fetchRecordCounts = async () => {
    try {
      const paymentsSnapshot = await getDocs(collection(db, 'payments'));
      const importLogsSnapshot = await getDocs(collection(db, 'importLogs'));
      const roomStatusLogsSnapshot = await getDocs(collection(db, 'roomStatusLogs'));
      
      setRecordCounts({
        payments: paymentsSnapshot.size,
        importLogs: importLogsSnapshot.size,
        roomStatusLogs: roomStatusLogsSnapshot.size
      });
    } catch (err) {
      console.error('Error fetching record counts:', err);
    }
  };

  // Handle database cleanup
  const handleCleanupDatabase = async () => {
    if (cleanupText !== 'DELETE') {
      setError('Please type DELETE to confirm cleanup');
      return;
    }

    try {
      setDeleting(true);
      setError(null);
      setSuccessMessage('');
      setCleanupProgress('Starting cleanup...');

      // Delete all payments
      setCleanupProgress(`Deleting ${recordCounts.payments} payment records...`);
      const paymentsSnapshot = await getDocs(collection(db, 'payments'));
      
      let deletedCount = 0;
      const batchSize = 500; // Firestore batch limit
      let batch = writeBatch(db);
      let operationCount = 0;

      for (const docSnapshot of paymentsSnapshot.docs) {
        batch.delete(docSnapshot.ref);
        operationCount++;
        deletedCount++;

        if (operationCount === batchSize) {
          await batch.commit();
          setCleanupProgress(`Deleted ${deletedCount} of ${recordCounts.payments} payment records...`);
          batch = writeBatch(db);
          operationCount = 0;
        }
      }

      if (operationCount > 0) {
        await batch.commit();
      }
      setCleanupProgress(`✅ Deleted ${deletedCount} payment records`);

      // Delete all import logs
      setCleanupProgress(`Deleting ${recordCounts.importLogs} import logs...`);
      const importLogsSnapshot = await getDocs(collection(db, 'importLogs'));
      
      deletedCount = 0;
      batch = writeBatch(db);
      operationCount = 0;

      for (const docSnapshot of importLogsSnapshot.docs) {
        batch.delete(docSnapshot.ref);
        operationCount++;
        deletedCount++;

        if (operationCount === batchSize) {
          await batch.commit();
          setCleanupProgress(`Deleted ${deletedCount} of ${recordCounts.importLogs} import logs...`);
          batch = writeBatch(db);
          operationCount = 0;
        }
      }

      if (operationCount > 0) {
        await batch.commit();
      }
      setCleanupProgress(`✅ Deleted ${deletedCount} import logs`);

      // Delete all room status logs
      setCleanupProgress(`Deleting ${recordCounts.roomStatusLogs} room status logs...`);
      const roomStatusLogsSnapshot = await getDocs(collection(db, 'roomStatusLogs'));
      
      deletedCount = 0;
      batch = writeBatch(db);
      operationCount = 0;

      for (const docSnapshot of roomStatusLogsSnapshot.docs) {
        batch.delete(docSnapshot.ref);
        operationCount++;
        deletedCount++;

        if (operationCount === batchSize) {
          await batch.commit();
          setCleanupProgress(`Deleted ${deletedCount} of ${recordCounts.roomStatusLogs} room status logs...`);
          batch = writeBatch(db);
          operationCount = 0;
        }
      }

      if (operationCount > 0) {
        await batch.commit();
      }

      setCleanupProgress('');
      setSuccessMessage('✅ Database cleanup completed successfully! All payment records, import logs, and room status logs have been deleted.');
      setShowCleanupConfirm(false);
      setCleanupText('');
      
      // Refresh counts
      await fetchRecordCounts();
      
      // Clear success message after 5 seconds
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (err) {
      console.error('Error cleaning up database:', err);
      setError('Failed to cleanup database. Please try again.');
      setCleanupProgress('');
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading settings...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">⚙️ Settings</h2>
        <p className="text-gray-600">Configure global application settings</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="card bg-red-50 border border-red-200 mb-6">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Success Message */}
      {successMessage && (
        <div className="card bg-green-50 border border-green-200 mb-6">
          <p className="text-green-700">{successMessage}</p>
        </div>
      )}

      {/* Electricity Settings Card */}
      <div className="card max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="text-4xl">⚡</div>
          <div>
            <h3 className="text-xl font-bold text-gray-800">Electricity Rate</h3>
            <p className="text-sm text-gray-600">Default rate per unit (kWh) for all tenants</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Rate per Unit (₹/kWh)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 font-semibold">
                ₹
              </span>
              <input
                type="number"
                step="0.01"
                value={electricityRate}
                onChange={(e) => setElectricityRate(e.target.value)}
                className="input-field pl-8"
                placeholder="8.00"
                required
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              💡 This rate will be used by default for all tenants unless overridden for individual tenants
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-semibold text-blue-900 mb-2">📋 How it works:</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Set the default electricity rate per unit (kWh)</li>
              <li>• You can override this rate for individual tenants in the Electricity module</li>
              <li>• Electricity charges = (Current Reading - Previous Reading) × Rate</li>
              <li>• Charges are automatically added to monthly records</li>
            </ul>
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button 
              type="submit" 
              className="btn-primary"
              disabled={saving}
            >
              {saving ? '💾 Saving...' : '💾 Save Settings'}
            </button>
            <button 
              type="button" 
              onClick={fetchSettings}
              className="btn-secondary"
              disabled={saving}
            >
              🔄 Reset
            </button>
          </div>
        </form>
      </div>

      {/* Additional Info */}
      <div className="card max-w-2xl mt-6 bg-gray-50">
        <div className="flex items-start gap-3">
          <div className="text-3xl">ℹ️</div>
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">About Settings</h4>
            <p className="text-sm text-gray-600 mb-2">
              Settings are stored globally and apply to all tenants by default. 
              Individual tenant overrides can be set in the Electricity module.
            </p>
            <p className="text-xs text-gray-500">
              Last updated: {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString('en-IN') : 'Never'}
            </p>
          </div>
        </div>
      </div>

      {/* Danger Zone - Database Cleanup */}
      <div className="card max-w-2xl mt-6 border-2 border-red-300 bg-red-50">
        <div className="flex items-center gap-3 mb-6">
          <div className="text-4xl">⚠️</div>
          <div>
            <h3 className="text-xl font-bold text-red-800">Danger Zone</h3>
            <p className="text-sm text-red-700">Irreversible actions that will permanently delete data</p>
          </div>
        </div>

        <div className="bg-white border border-red-200 rounded-lg p-4 mb-4">
          <h4 className="font-semibold text-gray-800 mb-3">🗑️ Database Cleanup</h4>
          <p className="text-sm text-gray-700 mb-3">
            Delete all payment records, import logs, and room status logs from the database. 
            This will allow you to start fresh with a new CSV import.
          </p>
          
          <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3 mb-4">
            <p className="font-semibold text-yellow-900 mb-2">⚠️ Warning:</p>
            <ul className="text-sm text-yellow-800 space-y-1">
              <li>• This action cannot be undone</li>
              <li>• All payment history will be permanently deleted</li>
              <li>• Import logs will be removed</li>
              <li>• Room status change history will be erased</li>
              <li>• Rooms and Tenants data will be preserved</li>
            </ul>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
            <h5 className="font-semibold text-gray-800 mb-2">📊 Current Database Status:</h5>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="bg-white rounded p-2 border border-gray-200">
                <p className="text-gray-600">Payment Records</p>
                <p className="text-2xl font-bold text-blue-600">{recordCounts.payments}</p>
              </div>
              <div className="bg-white rounded p-2 border border-gray-200">
                <p className="text-gray-600">Import Logs</p>
                <p className="text-2xl font-bold text-green-600">{recordCounts.importLogs}</p>
              </div>
              <div className="bg-white rounded p-2 border border-gray-200">
                <p className="text-gray-600">Status Logs</p>
                <p className="text-2xl font-bold text-purple-600">{recordCounts.roomStatusLogs}</p>
              </div>
            </div>
          </div>

          {!showCleanupConfirm ? (
            <button
              onClick={() => setShowCleanupConfirm(true)}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200"
              disabled={deleting}
            >
              🗑️ Cleanup Database
            </button>
          ) : (
            <div className="space-y-3">
              <div className="bg-red-100 border-2 border-red-400 rounded-lg p-4">
                <p className="font-bold text-red-900 mb-2">⚠️ FINAL CONFIRMATION</p>
                <p className="text-sm text-red-800 mb-3">
                  You are about to permanently delete <strong>{recordCounts.payments + recordCounts.importLogs + recordCounts.roomStatusLogs}</strong> records.
                  This action cannot be undone.
                </p>
                <p className="text-sm font-semibold text-red-900 mb-2">
                  Type <span className="bg-red-200 px-2 py-1 rounded font-mono">DELETE</span> to confirm:
                </p>
                <input
                  type="text"
                  value={cleanupText}
                  onChange={(e) => setCleanupText(e.target.value)}
                  className="w-full px-3 py-2 border-2 border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
                  placeholder="Type DELETE here"
                  disabled={deleting}
                />
              </div>

              {cleanupProgress && (
                <div className="bg-blue-50 border border-blue-300 rounded-lg p-3">
                  <p className="text-sm text-blue-800 font-semibold">{cleanupProgress}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleCleanupDatabase}
                  className="bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={deleting || cleanupText !== 'DELETE'}
                >
                  {deleting ? '🗑️ Deleting...' : '✅ Confirm Cleanup'}
                </button>
                <button
                  onClick={() => {
                    setShowCleanupConfirm(false);
                    setCleanupText('');
                    setError(null);
                  }}
                  className="bg-gray-500 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200"
                  disabled={deleting}
                >
                  ❌ Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
