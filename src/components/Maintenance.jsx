import { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';

const Maintenance = () => {
  const [records, setRecords] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch maintenance records
      const maintenanceRef = collection(db, 'maintenance');
      const maintenanceSnapshot = await getDocs(query(maintenanceRef, orderBy('date', 'desc')));
      
      const recordsData = [];
      maintenanceSnapshot.forEach((doc) => {
        recordsData.push({ id: doc.id, ...doc.data() });
      });

      // Fetch rooms
      const roomsRef = collection(db, 'rooms');
      const roomsSnapshot = await getDocs(roomsRef);
      
      const roomsData = [];
      roomsSnapshot.forEach((doc) => {
        roomsData.push({ id: doc.id, ...doc.data() });
      });

      setRecords(recordsData);
      setRooms(roomsData);
      setLoading(false);
    } catch (err) {
      console.error('Error fetching maintenance data:', err);
      setError('Failed to load maintenance records. Please try again.');
      setLoading(false);
    }
  };

  const handleFormClose = () => {
    setShowForm(false);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    fetchData();
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading maintenance records...</p>
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

  const totalCost = records.reduce((sum, record) => sum + (record.cost || 0), 0);

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">🔧 Maintenance Records</h2>
          <p className="text-gray-600">Track repairs and maintenance expenses</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          ➕ Add Record
        </button>
      </div>

      {/* Stats */}
      <div className="card mb-6 bg-gradient-to-br from-purple-500 to-purple-600 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-purple-100 text-sm mb-1">Total Maintenance Cost</p>
            <p className="text-3xl font-bold">₹{totalCost.toLocaleString('en-IN')}</p>
          </div>
          <div className="text-5xl">🔧</div>
        </div>
        <p className="text-purple-100 text-xs mt-3">
          {records.length} record{records.length !== 1 ? 's' : ''} total
        </p>
      </div>

      {/* Records List */}
      {records.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-6xl mb-4">🔧</div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">No Maintenance Records</h3>
          <p className="text-gray-600 mb-4">Start tracking your maintenance expenses</p>
          <button onClick={() => setShowForm(true)} className="btn-primary">
            ➕ Add First Record
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {records.map(record => (
            <div key={record.id} className="card hover:shadow-lg transition">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">Room {record.roomNumber}</h3>
                  <p className="text-sm text-gray-600">
                    {new Date(record.date).toLocaleDateString('en-IN')}
                  </p>
                </div>
                <span className="text-lg font-bold text-purple-600">
                  ₹{record.cost.toLocaleString('en-IN')}
                </span>
              </div>
              
              <p className="text-gray-700 mb-3">{record.description}</p>
            </div>
          ))}
        </div>
      )}

      {/* Maintenance Form Modal */}
      {showForm && (
        <MaintenanceForm
          rooms={rooms}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}
    </div>
  );
};

const MaintenanceForm = ({ rooms, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    roomNumber: '',
    description: '',
    cost: '',
    date: new Date().toISOString().split('T')[0]
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.roomNumber) {
      setError('Please select a room');
      return;
    }

    if (!formData.description.trim()) {
      setError('Please enter a description');
      return;
    }

    if (!formData.cost || parseFloat(formData.cost) <= 0) {
      setError('Please enter a valid cost');
      return;
    }

    try {
      setSaving(true);
      setError('');

      const recordId = `maintenance_${Date.now()}`;

      const recordData = {
        roomNumber: formData.roomNumber,
        description: formData.description.trim(),
        cost: parseFloat(formData.cost),
        date: formData.date,
        billPhotoUrl: null, // Future: storage adapter
        createdAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'maintenance', recordId), recordData);

      alert('✅ Maintenance record added successfully!');
      onSuccess();
    } catch (err) {
      console.error('Error saving maintenance record:', err);
      setError('Failed to save record. Please try again.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        <div className="border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-gray-800">➕ Add Maintenance Record</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">
              ×
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Room Number */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Room Number *
            </label>
            <select
              name="roomNumber"
              value={formData.roomNumber}
              onChange={handleChange}
              className="input-field"
              required
            >
              <option value="">Select room</option>
              {rooms.map(room => (
                <option key={room.id} value={room.roomNumber}>
                  Room {room.roomNumber} - Floor {room.floor}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Description *
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              className="input-field"
              rows="3"
              placeholder="e.g., Fixed leaking pipe in bathroom"
              required
            />
          </div>

          {/* Cost */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Cost (₹) *
            </label>
            <input
              type="number"
              name="cost"
              value={formData.cost}
              onChange={handleChange}
              className="input-field"
              placeholder="500"
              min="0"
              step="0.01"
              required
            />
          </div>

          {/* Date */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Date *
            </label>
            <input
              type="date"
              name="date"
              value={formData.date}
              onChange={handleChange}
              className="input-field"
              required
            />
          </div>

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
              {saving ? 'Saving...' : '💾 Save Record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default Maintenance;
