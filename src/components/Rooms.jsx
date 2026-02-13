import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

const Rooms = () => {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // all, vacant, occupied

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
    } catch (err) {
      console.error('Error fetching rooms:', err);
      setError('Failed to load rooms. Please check Firestore rules.');
    } finally {
      setLoading(false);
    }
  };

  const filteredRooms = rooms.filter(room => {
    if (filter === 'all') return true;
    return room.status === filter;
  });

  const stats = {
    total: rooms.length,
    vacant: rooms.filter(r => r.status === 'vacant').length,
    occupied: rooms.filter(r => r.status === 'occupied').length
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
        <p className="text-gray-600">View and manage all 12 rooms</p>
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

        <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">Vacant Rooms</p>
              <p className="text-3xl font-bold mt-1">{stats.vacant}</p>
            </div>
            <div className="text-4xl">✅</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-100 text-sm">Occupied Rooms</p>
              <p className="text-3xl font-bold mt-1">{stats.occupied}</p>
            </div>
            <div className="text-4xl">🔑</div>
          </div>
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="card mb-6">
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
                ? 'bg-green-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Vacant ({stats.vacant})
          </button>
          <button
            onClick={() => setFilter('occupied')}
            className={`px-4 py-2 rounded-lg font-semibold transition ${
              filter === 'occupied'
                ? 'bg-orange-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            Occupied ({stats.occupied})
          </button>
        </div>
      </div>

      {/* Rooms Grid */}
      {filteredRooms. length === 0 ? (
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
        <>
          {/* Floor 1 */}
          <div className="mb-8">
            <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
              <span className="bg-blue-500 text-white px-3 py-1 rounded-lg mr-2">
                Floor 1
              </span>
              <span className="text-gray-500 text-sm">
                ({filteredRooms.filter(r => r.floor === 1).length} rooms)
              </span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredRooms
                .filter(room => room.floor === 1)
                .map(room => (
                  <RoomCard key={room.id} room={room} />
                ))}
            </div>
          </div>

          {/* Floor 2 */}
          <div>
            <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
              <span className="bg-purple-500 text-white px-3 py-1 rounded-lg mr-2">
                Floor 2
              </span>
              <span className="text-gray-500 text-sm">
                ({filteredRooms.filter(r => r.floor === 2).length} rooms)
              </span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredRooms
                .filter(room => room.floor === 2)
                .map(room => (
                  <RoomCard key={room.id} room={room} />
                ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const RoomCard = ({ room }) => {
  const isVacant = room.status === 'vacant';
  
  return (
    <div className={`card border-2 transition-all hover:shadow-lg ${
      isVacant 
        ? 'border-green-300 bg-green-50' 
        : 'border-orange-300 bg-orange-50'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-2xl font-bold text-gray-800">
            Room {room.roomNumber}
          </h4>
          <p className="text-sm text-gray-600">
            Floor {room.floor}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
          isVacant
            ? 'bg-green-500 text-white'
            : 'bg-orange-500 text-white'
        }`}>
          {isVacant ? '✅ Vacant' : '🔑 Occupied'}
        </span>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Default Rent:</span>
          <span className="font-semibold text-gray-800">
            ₹{room.defaultRent?.toLocaleString('en-IN') || 'N/A'}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Meter No:</span>
          <span className="font-semibold text-gray-800">
            {room.electricityMeterNo || 'N/A'}
          </span>
        </div>
      </div>

      {isVacant ? (
        <button className="btn-primary w-full text-sm">
          Assign Tenant
        </button>
      ) : (
        <button className="btn-secondary w-full text-sm">
          View Details
        </button>
      )}
    </div>
  );
};

export default Rooms;
