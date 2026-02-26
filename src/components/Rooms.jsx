import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, doc, updateDoc, addDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { validateRoomCount } from '../utils/roomValidation';
import { useDialog } from './ui/DialogProvider';

const Rooms = () => {
  const { showConfirm } = useDialog();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // all, vacant, occupied
  const [floorFilter, setFloorFilter] = useState('all'); // all, floor1, floor2
  const [selectedRooms, setSelectedRooms] = useState(new Set());
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [modalRoom, setModalRoom] = useState(null);
  const [modalStatus, setModalStatus] = useState('');
  const [modalRemark, setModalRemark] = useState('');
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    fetchRooms();
  }, []);

  const fetchRooms = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const roomsRef = collection(db, 'rooms');
      const q = query(roomsRef, orderBy('roomNumber', 'asc'));
      const querySnapshot = await getDocs(q);
      
      const roomsData = [];
      querySnapshot.forEach((doc) => {
        roomsData.push({ id: doc.id, ...doc.data() });
      });
      
      setRooms(roomsData);
      
      // VALIDATION: Check room count
      const validation = validateRoomCount(roomsData.length);
      if (!validation.isValid) {
        console.warn(validation.message);
        if (validation.hasExtra) {
          setError(`⚠️ WARNING: ${validation.message}. Go to Settings → Check Duplicates to fix.`);
        }
      }
    } catch (err) {
      console.error('Error fetching rooms:', err);
      setError('Failed to load rooms. Please check Firestore rules.');
    } finally {
      setLoading(false);
    }
  };

  const openStatusModal = (room) => {
    setModalRoom(room);
    setModalStatus(room.status || 'vacant');
    setModalRemark('');
    setShowStatusModal(true);
  };

  const closeStatusModal = () => {
    setShowStatusModal(false);
    setModalRoom(null);
    setModalStatus('');
    setModalRemark('');
  };

  const updateRoomStatus = async (roomId, newStatus, remark = '') => {
    try {
      const user = auth.currentUser;
      const roomRef = doc(db, 'rooms', roomId);
      const room = rooms.find(r => r.id === roomId);
      const oldStatus = room?.status || 'vacant';

      // Update room status
      await updateDoc(roomRef, {
        status: newStatus,
        lastStatusUpdatedAt: serverTimestamp(),
        lastStatusUpdatedBy: user?.uid || 'system'
      });

      // Log the status change
      await addDoc(collection(db, 'roomStatusLogs'), {
        roomId,
        roomNumber: room?.roomNumber,
        oldStatus,
        newStatus,
        changedBy: user?.uid || 'system',
        changedByEmail: user?.email || 'system',
        changedAt: serverTimestamp(),
        remark: remark || null
      });

      return true;
    } catch (error) {
      console.error('Error updating room status:', error);
      throw error;
    }
  };

  const handleSaveStatus = async () => {
    if (!modalRoom) return;

    setUpdating(true);
    try {
      await updateRoomStatus(modalRoom.id, modalStatus, modalRemark);
      alert('Room status updated successfully!');
      closeStatusModal();
      fetchRooms(); // Refresh the room list
    } catch (error) {
      alert('Failed to update room status. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const handleBulkUpdate = async (newStatus) => {
    if (selectedRooms.size === 0) {
      alert('Please select at least one room');
      return;
    }

    const confirmed = await showConfirm(`Update ${selectedRooms.size} room(s) to "${newStatus}"?`, {
      title: 'Confirm Bulk Update',
      confirmLabel: 'Update',
      intent: 'warning'
    });
    if (!confirmed) {
      return;
    }

    setUpdating(true);
    try {
      const batch = writeBatch(db);
      const user = auth.currentUser;
      const timestamp = new Date();

      // Update rooms in batch
      selectedRooms.forEach(roomId => {
        const roomRef = doc(db, 'rooms', roomId);
        batch.update(roomRef, {
          status: newStatus,
          lastStatusUpdatedAt: timestamp,
          lastStatusUpdatedBy: user?.uid || 'system'
        });
      });

      await batch.commit();

      // Log status changes (individual logs)
      const logPromises = Array.from(selectedRooms).map(async (roomId) => {
        const room = rooms.find(r => r.id === roomId);
        return addDoc(collection(db, 'roomStatusLogs'), {
          roomId,
          roomNumber: room?.roomNumber,
          oldStatus: room?.status || 'vacant',
          newStatus,
          changedBy: user?.uid || 'system',
          changedByEmail: user?.email || 'system',
          changedAt: timestamp,
          remark: `Bulk update`
        });
      });

      await Promise.all(logPromises);

      alert(`${selectedRooms.size} room(s) updated successfully!`);
      setSelectedRooms(new Set());
      fetchRooms();
    } catch (error) {
      console.error('Error in bulk update:', error);
      alert('Failed to update rooms. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const toggleRoomSelection = (roomId) => {
    const newSelection = new Set(selectedRooms);
    if (newSelection.has(roomId)) {
      newSelection.delete(roomId);
    } else {
      newSelection.add(roomId);
    }
    setSelectedRooms(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedRooms.size === filteredRooms.length) {
      setSelectedRooms(new Set());
    } else {
      setSelectedRooms(new Set(filteredRooms.map(r => r.id)));
    }
  };

  const filteredRooms = rooms.filter(room => {
    // Status filter
    let matchesStatusFilter = true;
    if (filter !== 'all') {
      const roomStatus = room.status || 'vacant';
      matchesStatusFilter = roomStatus === filter;
    }
    
    // Floor filter
    let matchesFloorFilter = true;
    if (floorFilter === 'floor1') {
      matchesFloorFilter = room.roomNumber >= 101 && room.roomNumber <= 106;
    } else if (floorFilter === 'floor2') {
      matchesFloorFilter = room.roomNumber >= 201 && room.roomNumber <= 206;
    }
    
    return matchesStatusFilter && matchesFloorFilter;
  });

  const stats = {
    total: rooms.length,
    vacant: rooms.filter(r => (r.status || 'vacant') === 'vacant').length,
    occupied: rooms.filter(r => r.status === 'occupied').length,
    floor1: rooms.filter(r => r.roomNumber >= 101 && r.roomNumber <= 106).length,
    floor2: rooms.filter(r => r.roomNumber >= 201 && r.roomNumber <= 206).length
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading rooms...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card bg-red-50 border border-red-200">
        <p className="text-red-700">{error}</p>
        <button onClick={fetchRooms} className="btn-primary mt-4">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">🏠 Rooms Management</h2>
        <p className="text-gray-600">View and manage all 12 rooms with occupancy status</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">Total Rooms</p>
              <p className="text-3xl font-bold mt-1">{stats.total}</p>
            </div>
            <div className="text-4xl">🏠</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-gray-500 to-gray-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-100 text-sm">Vacant Rooms</p>
              <p className="text-3xl font-bold mt-1">{stats.vacant}</p>
            </div>
            <div className="text-4xl">⬜</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">Occupied Rooms</p>
              <p className="text-3xl font-bold mt-1">{stats.occupied}</p>
            </div>
            <div className="text-4xl">✅</div>
          </div>
        </div>
      </div>

      {/* Filter and Bulk Actions */}
      <div className="card mb-6 space-y-4">
        {/* Status Filters */}
        <div>
          <label className="text-sm font-semibold text-gray-700 mb-2 block">Status Filter</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded-lg font-semibold transition ${
                filter === 'all'
                  ? 'bg-primary text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              All Rooms ({stats.total})
            </button>
            <button
              onClick={() => setFilter('vacant')}
              className={`px-4 py-2 rounded-lg font-semibold transition ${
                filter === 'vacant'
                  ? 'bg-gray-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Vacant ({stats.vacant})
            </button>
            <button
              onClick={() => setFilter('occupied')}
              className={`px-4 py-2 rounded-lg font-semibold transition ${
                filter === 'occupied'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Occupied ({stats.occupied})
            </button>
          </div>
        </div>

        {/* Floor Filters */}
        <div>
          <label className="text-sm font-semibold text-gray-700 mb-2 block">Floor Filter</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFloorFilter('all')}
              className={`px-4 py-2 rounded-lg font-semibold transition ${
                floorFilter === 'all'
                  ? 'bg-purple-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              All Floors
            </button>
            <button
              onClick={() => setFloorFilter('floor1')}
              className={`px-4 py-2 rounded-lg font-semibold transition ${
                floorFilter === 'floor1'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Floor 1 (Ground) ({stats.floor1})
            </button>
            <button
              onClick={() => setFloorFilter('floor2')}
              className={`px-4 py-2 rounded-lg font-semibold transition ${
                floorFilter === 'floor2'
                  ? 'bg-indigo-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Floor 2 (First) ({stats.floor2})
            </button>
          </div>
        </div>

        {/* Bulk Actions */}
        {selectedRooms.size > 0 && (
          <div className="flex items-center gap-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <span className="font-semibold text-blue-900">
              {selectedRooms.size} room(s) selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => handleBulkUpdate('vacant')}
                disabled={updating}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
              >
                Mark as Vacant
              </button>
              <button
                onClick={() => handleBulkUpdate('occupied')}
                disabled={updating}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition disabled:opacity-50"
              >
                Mark as Occupied
              </button>
            </div>
          </div>
        )}
      </div>
      {/* Rooms Grid or Table */}
      {filteredRooms.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-600 text-lg mb-4">
            {filter === 'all' 
              ? 'No rooms found. Please set up Firestore rules first.' 
              : `No ${filter} rooms found.`}
          </p>
          {filter === 'all' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-2xl mx-auto mt-4">
              <p className="text-sm text-gray-700 mb-2">
                <strong>Setup Steps:</strong>
              </p>
              <ol className="text-left text-sm text-gray-700 space-y-2">
                <li>1. Set up Firestore rules (see FIRESTORE_SETUP.md)</li>
                <li>2. Run: <code className="bg-gray-800 text-green-400 px-2 py-1 rounded">npm run seed:rooms</code></li>
                <li>3. Refresh this page</li>
              </ol>
            </div>
          )}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedRooms.size === filteredRooms.length && filteredRooms.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 text-primary rounded"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Room
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Default Rent
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Meter No
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Updated
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredRooms.map(room => {
                const roomStatus = room.status || 'vacant';
                const isVacant = roomStatus === 'vacant';
                
                return (
                  <tr key={room.id} className={selectedRooms.has(room.id) ? 'bg-blue-50' : ''}>
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedRooms.has(room.id)}
                        onChange={() => toggleRoomSelection(room.id)}
                        className="w-4 h-4 text-primary rounded"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-gray-900">Room {room.roomNumber}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        isVacant
                          ? 'bg-gray-100 text-gray-800'
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {isVacant ? '⬜ Vacant' : '✅ Occupied'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      ₹{room.defaultRent?.toLocaleString('en-IN') || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {room.electricityMeterNo || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {room.lastStatusUpdatedAt 
                        ? new Date(room.lastStatusUpdatedAt.seconds * 1000).toLocaleDateString()
                        : 'Never'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => openStatusModal(room)}
                        className="text-primary hover:text-blue-700 font-medium"
                      >
                        Update Status
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Status Update Modal */}
      {showStatusModal && modalRoom && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-xl font-bold text-gray-800">
                Update Room {modalRoom.roomNumber} Status
              </h3>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Status *
                </label>
                <select
                  value={modalStatus}
                  onChange={(e) => setModalStatus(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  disabled={updating}
                >
                  <option value="vacant">Vacant</option>
                  <option value="occupied">Occupied</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Remark (Optional)
                </label>
                <textarea
                  value={modalRemark}
                  onChange={(e) => setModalRemark(e.target.value)}
                  placeholder="Add notes about this status change..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
                  rows="3"
                  disabled={updating}
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  <strong>Current Status:</strong> {modalRoom.status || 'vacant'}
                </p>
                <p className="text-sm text-blue-800 mt-1">
                  <strong>New Status:</strong> {modalStatus}
                </p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
              <button
                onClick={closeStatusModal}
                disabled={updating}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveStatus}
                disabled={updating}
                className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {updating ? 'Saving...' : 'Save Status'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Rooms;
