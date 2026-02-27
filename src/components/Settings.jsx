import { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

const Settings = () => {
  const [settings, setSettings] = useState(null);
  const [electricityRate, setElectricityRate] = useState('');
  const [historyEditDeleteEnabled, setHistoryEditDeleteEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    fetchSettings();
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
        setHistoryEditDeleteEnabled(settingsData.historyEditDeleteEnabled === true);
      } else {
        // No settings exist yet, set defaults
        setElectricityRate('9');
        setHistoryEditDeleteEnabled(false);
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
        historyEditDeleteEnabled,
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

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h4 className="font-semibold text-yellow-900 mb-2">🛡️ History Edit/Delete Control</h4>
            <label className="inline-flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={historyEditDeleteEnabled}
                onChange={(e) => setHistoryEditDeleteEnabled(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm text-yellow-900 font-semibold">
                Enable Edit/Delete actions on History page
              </span>
            </label>
            <p className="text-xs text-yellow-800 mt-2">
              When disabled, history records can be viewed but not edited or deleted.
            </p>
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

      {/* Month End Backup */}
      <div className="card max-w-2xl mt-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="text-4xl">🗂️</div>
          <div>
            <h3 className="text-xl font-bold text-gray-800">Month-End Backup Download</h3>
            <p className="text-sm text-gray-600">Create monthly backup on month&apos;s last day after full rent collection</p>
          </div>
        </div>

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
          <p className="text-sm text-orange-900 font-semibold mb-1">Rule:</p>
          <ul className="text-sm text-orange-800 space-y-1">
            <li>• Backup can run only on the last day of current month</li>
            <li>• All current month payment records must be fully paid</li>
            <li>• Backup file name format: 28 Feb 2026</li>
          </ul>
        </div>

        <button
          type="button"
          onClick={handleMonthlyBackupDownload}
          disabled={backupInProgress || restoreInProgress}
          className="btn-primary"
        >
          {backupInProgress ? '⏳ Creating Backup...' : '📥 Create & Download Month-End Backup'}
        </button>

        <div className="mt-5 pt-5 border-t border-gray-200">
          <h4 className="font-semibold text-gray-800 mb-2">♻️ Restore from Downloaded Backup</h4>
          <p className="text-sm text-gray-600 mb-3">
            Upload backup CSV (downloaded from this section) to restore records back into payment history.
          </p>
          <label className="btn-secondary inline-flex items-center cursor-pointer">
            {restoreInProgress ? '⏳ Restoring...' : '📤 Upload Backup CSV & Restore'}
            <input
              type="file"
              accept=".csv"
              onChange={handleRestoreBackupFile}
              className="hidden"
              disabled={restoreInProgress || backupInProgress}
            />
          </label>
          <p className="text-xs text-red-600 mt-2">
            ⚠️ Restore can overwrite existing records for matching document IDs.
          </p>
        </div>

        <div className="mt-5 pt-5 border-t border-gray-200">
          <h4 className="font-semibold text-gray-800 mb-2">🕘 Backup History</h4>
          {backupHistoryLoading ? (
            <p className="text-sm text-gray-500">Loading backup history...</p>
          ) : backupHistory.length === 0 ? (
            <p className="text-sm text-gray-500">No month-end backups yet.</p>
          ) : (
            <div className="space-y-2 max-h-56 overflow-auto pr-1">
              {backupHistory.slice(0, 12).map((backup) => (
                <div key={backup.id} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-800">{backup.backupDateLabel || backup.fileName || 'Monthly Backup'}</p>
                    <span className="text-xs text-gray-500">{backup.recordCount || 0} records</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">
                    {backup.year || '-'} / {backup.month || '-'} • {backup.fileName || 'No file name'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
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
    </div>
  );
};

export default Settings;
