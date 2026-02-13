import { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

const Electricity = () => {
  const [tenants, setTenants] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [meterReadings, setMeterReadings] = useState([]);
  const [globalRate, setGlobalRate] = useState(8);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch global electricity rate
      const settingsRef = collection(db, 'settings');
      const settingsSnapshot = await getDocs(settingsRef);
      if (!settingsSnapshot.empty) {
        const settings = settingsSnapshot.docs[0].data();
        setGlobalRate(settings.electricityRate || 8);
      }

      // Fetch active tenants
      const tenantsRef = collection(db, 'tenants');
      const tenantsQuery = query(tenantsRef, where('isActive', '==', true));
      const tenantsSnapshot = await getDocs(tenantsQuery);
      
      const tenantsData = [];
      tenantsSnapshot.forEach((doc) => {
        tenantsData.push({ id: doc.id, ...doc.data() });
      });

      // Fetch rooms
      const roomsRef = collection(db, 'rooms');
      const roomsSnapshot = await getDocs(roomsRef);
      
      const roomsData = [];
      roomsSnapshot.forEach((doc) => {
        roomsData.push({ id: doc.id, ...doc.data() });
      });

      // Fetch meter readings
      const readingsRef = collection(db, 'electricityReadings');
      const readingsSnapshot = await getDocs(readingsRef);
      
      const readingsData = [];
      readingsSnapshot.forEach((doc) => {
        readingsData.push({ id: doc.id, ...doc.data() });
      });

      setTenants(tenantsData);
      setRooms(roomsData);
      setMeterReadings(readingsData);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load data. Please try again.');
      setLoading(false);
    }
  };

  const handleAddReading = (tenant) => {
    setSelectedTenant(tenant);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setSelectedTenant(null);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setSelectedTenant(null);
    fetchData();
  };

  const getLatestReading = (tenantId) => {
    const tenantReadings = meterReadings
      .filter(r => r.tenantId === tenantId)
      .sort((a, b) => new Date(b.readingDate) - new Date(a.readingDate));
    
    return tenantReadings[0] || null;
  };

  const getRoomInfo = (roomNumber) => {
    return rooms.find(r => r.roomNumber === roomNumber);
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading electricity data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 lg:p-8">
        <div className="card bg-red-50 border border-red-200">
          <p className="text-red-700">{error}</p>
          <button onClick={fetchData} className="btn-primary mt-4">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">⚡ Electricity Management</h2>
        <p className="text-gray-600">Record meter readings and manage electricity charges</p>
      </div>

      {/* Global Rate Info */}
      <div className="card mb-6 bg-gradient-to-br from-yellow-500 to-orange-500 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-yellow-100 text-sm mb-1">Global Electricity Rate</p>
            <p className="text-3xl font-bold">₹{globalRate}/kWh</p>
          </div>
          <div className="text-5xl">⚡</div>
        </div>
        <p className="text-yellow-100 text-xs mt-3">
          💡 Default rate • Can be overridden per tenant • Change in Settings
        </p>
      </div>

      {/* Tenants List */}
      {tenants.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-6xl mb-4">⚡</div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">No Active Tenants</h3>
          <p className="text-gray-600">Add tenants first to manage their electricity readings</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {tenants.map(tenant => {
            const latestReading = getLatestReading(tenant.id);
            const roomInfo = getRoomInfo(tenant.roomNumber);
            
            return (
              <div key={tenant.id} className="card hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-800">{tenant.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm text-gray-600">
                        🏠 Room {tenant.roomNumber}
                      </span>
                      {roomInfo && (
                        <span className="text-xs text-gray-500">
                          (Floor {roomInfo.floor})
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                    ⚡ {tenant.electricityRateOverride || globalRate} ₹/kWh
                  </span>
                </div>

                {/* Meter Details */}
                {roomInfo?.electricityMeterNo && (
                  <div className="bg-gray-50 rounded-lg p-3 mb-4">
                    <p className="text-xs text-gray-600 mb-1">Meter Number</p>
                    <p className="font-mono font-semibold text-gray-800">
                      {roomInfo.electricityMeterNo}
                    </p>
                  </div>
                )}

                {/* Latest Reading */}
                {latestReading ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-xs text-green-600 mb-1">Latest Reading</p>
                        <p className="text-2xl font-bold text-green-700">
                          {latestReading.currentReading} kWh
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-green-600">Date</p>
                        <p className="text-sm font-semibold text-green-700">
                          {new Date(latestReading.readingDate).toLocaleDateString('en-IN')}
                        </p>
                      </div>
                    </div>
                    {latestReading.previousReading && (
                      <div className="pt-2 border-t border-green-300 text-xs text-green-700">
                        <div className="flex justify-between">
                          <span>Previous: {latestReading.previousReading} kWh</span>
                          <span>Units: {latestReading.unitsConsumed} kWh</span>
                        </div>
                        <div className="mt-1 font-semibold">
                          Charge: ₹{latestReading.totalCharge.toFixed(2)}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4 text-center">
                    <p className="text-sm text-yellow-700">📊 No readings recorded yet</p>
                  </div>
                )}

                <button
                  onClick={() => handleAddReading(tenant)}
                  className="btn-primary w-full"
                >
                  ➕ Add Meter Reading
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Reading Form Modal */}
      {showForm && selectedTenant && (
        <MeterReadingForm
          tenant={selectedTenant}
          latestReading={getLatestReading(selectedTenant.id)}
          globalRate={globalRate}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}
    </div>
  );
};

const MeterReadingForm = ({ tenant, latestReading, globalRate, onClose, onSuccess }) => {
  const [currentReading, setCurrentReading] = useState('');
  const [readingDate, setReadingDate] = useState(new Date().toISOString().split('T')[0]);
  const [rateOverride, setRateOverride] = useState(tenant.electricityRateOverride || '');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const effectiveRate = parseFloat(rateOverride) || globalRate;
  const previousReading = latestReading?.currentReading || 0;
  const unitsConsumed = currentReading ? Math.max(0, parseFloat(currentReading) - previousReading) : 0;
  const totalCharge = unitsConsumed * effectiveRate;

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const reading = parseFloat(currentReading);
    if (isNaN(reading) || reading < 0) {
      setError('Please enter a valid positive number for current reading');
      return;
    }

    if (reading < previousReading) {
      setError('Current reading cannot be less than previous reading');
      return;
    }

    try {
      setSaving(true);
      setError('');

      // Generate unique ID for meter reading
      const readingId = `${tenant.id}_${Date.now()}`;

      const readingData = {
        tenantId: tenant.id,
        tenantName: tenant.name,
        roomNumber: tenant.roomNumber,
        readingDate,
        previousReading,
        currentReading: reading,
        unitsConsumed,
        ratePerUnit: effectiveRate,
        totalCharge,
        notes: notes.trim(),
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'electricityReadings', readingId), readingData);

      alert('✅ Meter reading added successfully!');
      onSuccess();
    } catch (err) {
      console.error('Error saving meter reading:', err);
      setError('Failed to save meter reading. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-gray-800">⚡ Add Meter Reading</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">
              ×
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {/* Tenant Info */}
          <div className="bg-blue-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-blue-600 mb-1">Tenant</p>
            <p className="font-bold text-blue-900">{tenant.name}</p>
            <p className="text-sm text-blue-700">Room {tenant.roomNumber}</p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Previous Reading */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Previous Reading (kWh)
            </label>
            <input
              type="text"
              value={previousReading}
              className="input-field bg-gray-100"
              disabled
            />
          </div>

          {/* Current Reading */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Current Reading (kWh) *
            </label>
            <input
              type="number"
              step="0.01"
              value={currentReading}
              onChange={(e) => setCurrentReading(e.target.value)}
              className="input-field"
              placeholder="0.00"
              required
            />
          </div>

          {/* Reading Date */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Reading Date *
            </label>
            <input
              type="date"
              value={readingDate}
              onChange={(e) => setReadingDate(e.target.value)}
              className="input-field"
              required
            />
          </div>

          {/* Rate Override */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Rate Override (₹/kWh)
            </label>
            <input
              type="number"
              step="0.01"
              value={rateOverride}
              onChange={(e) => setRateOverride(e.target.value)}
              className="input-field"
              placeholder={`Default: ${globalRate}`}
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave empty to use global rate (₹{globalRate}/kWh)
            </p>
          </div>

          {/* Notes */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input-field"
              rows="2"
              placeholder="Any additional notes..."
            />
          </div>

          {/* Calculation Summary */}
          {currentReading && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <h4 className="font-semibold text-green-900 mb-2">📊 Calculation</h4>
              <div className="space-y-1 text-sm text-green-800">
                <div className="flex justify-between">
                  <span>Units Consumed:</span>
                  <span className="font-semibold">{unitsConsumed.toFixed(2)} kWh</span>
                </div>
                <div className="flex justify-between">
                  <span>Rate per Unit:</span>
                  <span className="font-semibold">₹{effectiveRate}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-green-300">
                  <span className="font-bold">Total Charge:</span>
                  <span className="font-bold text-lg">₹{totalCharge.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={saving}
            >
              {saving ? 'Saving...' : '💾 Save Reading'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Electricity;
