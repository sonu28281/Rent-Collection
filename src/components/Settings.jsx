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
    <div className="p-4 lg:p-6">
      <div className="mb-5 flex flex-col gap-1">
        <h2 className="text-2xl lg:text-3xl font-bold text-gray-900">⚙️ Settings</h2>
        <p className="text-sm text-gray-600">Configure global controls from one screen</p>
      </div>

      {error && (
        <div className="card bg-red-50 border border-red-200 mb-4">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="card bg-green-50 border border-green-200 mb-4">
          <p className="text-green-700 text-sm">{successMessage}</p>
        </div>
      )}

      <form onSubmit={handleSave} className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="card xl:col-span-2">
          <div className="flex items-center gap-3 mb-4">
            <div className="text-3xl">⚡</div>
            <div>
              <h3 className="text-lg font-bold text-gray-800">Electricity Settings</h3>
              <p className="text-xs text-gray-600">Default tariff used across rent calculations</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                Applied as default where custom tenant rate is not set.
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <h4 className="font-semibold text-blue-900 text-sm mb-1">Quick Logic</h4>
              <p className="text-xs text-blue-800 leading-relaxed">
                Electricity charge = (Current Reading - Previous Reading) × Rate per unit.
                This amount is auto-added in monthly payment totals.
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-2xl">🛡️</div>
            <h3 className="text-base font-bold text-gray-800">History Control</h3>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={historyEditDeleteEnabled}
              onChange={(e) => setHistoryEditDeleteEnabled(e.target.checked)}
              className="w-4 h-4 mt-1"
            />
            <span className="text-sm text-gray-800 font-medium">
              Enable Edit/Delete actions on History page
            </span>
          </label>

          <p className="text-xs text-gray-600 mt-3">
            Keep this off for view-only protection. Turn on only when records must be corrected.
          </p>

          <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={saving}
            >
              {saving ? '💾 Saving...' : '💾 Save Settings'}
            </button>
            <button
              type="button"
              onClick={fetchSettings}
              className="btn-secondary w-full"
              disabled={saving}
            >
              🔄 Reset
            </button>
          </div>
        </div>
      </form>

      <div className="card mt-4 bg-gray-50 border border-gray-200">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">ℹ️</span>
            <p className="text-sm text-gray-700 font-medium">Global settings apply across all modules.</p>
          </div>
          <p className="text-xs text-gray-500">
            Last updated: {settings?.updatedAt ? new Date(settings.updatedAt).toLocaleString('en-IN') : 'Never'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Settings;
