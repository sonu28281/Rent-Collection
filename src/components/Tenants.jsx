import { useState, useEffect } from 'react';
import { collection, getDocs, updateDoc, deleteDoc, doc, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import TenantForm from './TenantForm';
import { useDialog } from './ui/DialogProvider';

const Tenants = () => {
  const { showConfirm, showAlert } = useDialog();
  const [tenants, setTenants] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const [filter, setFilter] = useState('all'); // all, active, inactive
  const [floorFilter, setFloorFilter] = useState('all'); // all, floor1, floor2
  const [viewMode, setViewMode] = useState('card'); // card, detail
  const [selectedTenantHistory, setSelectedTenantHistory] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [mergeTargetTenantId, setMergeTargetTenantId] = useState('');
  const [mergeSourceTenantId, setMergeSourceTenantId] = useState('');
  const [mergingTenants, setMergingTenants] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch tenants
      const tenantsRef = collection(db, 'tenants');
      const tenantsQuery = query(tenantsRef, orderBy('createdAt', 'desc'));
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
      
      setTenants(tenantsData);
      setRooms(roomsData);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load tenants. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTenant = () => {
    setEditingTenant(null);
    setShowForm(true);
  };

  const handleEditTenant = (tenant) => {
    setEditingTenant(tenant);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingTenant(null);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setEditingTenant(null);
    fetchData();
  };

  const getAssignedRooms = (tenantRecord) => {
    if (Array.isArray(tenantRecord?.assignedRooms) && tenantRecord.assignedRooms.length > 0) {
      return tenantRecord.assignedRooms.map((room) => String(room));
    }
    if (tenantRecord?.roomNumber !== undefined && tenantRecord?.roomNumber !== null && tenantRecord?.roomNumber !== '') {
      return [String(tenantRecord.roomNumber)];
    }
    return [];
  };

  const getTenantById = (tenantId) => tenants.find((tenantRecord) => tenantRecord.id === tenantId) || null;

  const mergeTenantAccounts = async () => {
    if (!mergeTargetTenantId || !mergeSourceTenantId) {
      await showAlert('Please select both target and source tenant for merge.', { title: 'Selection Required', intent: 'warning' });
      return;
    }

    if (mergeTargetTenantId === mergeSourceTenantId) {
      await showAlert('Target and source tenant must be different.', { title: 'Invalid Merge', intent: 'warning' });
      return;
    }

    const targetTenant = getTenantById(mergeTargetTenantId);
    const sourceTenant = getTenantById(mergeSourceTenantId);

    if (!targetTenant || !sourceTenant) {
      await showAlert('Selected tenant record not found. Please refresh and try again.', { title: 'Tenant Missing', intent: 'error' });
      return;
    }

    const targetRooms = getAssignedRooms(targetTenant);
    const sourceRooms = getAssignedRooms(sourceTenant);
    const mergedRooms = [...new Set([...targetRooms, ...sourceRooms])].sort((a, b) => Number(a) - Number(b));

    const confirmed = await showConfirm(
      `Merge "${sourceTenant.name}" into "${targetTenant.name}"?\n\nTarget rooms: ${targetRooms.join(', ') || '-'}\nSource rooms: ${sourceRooms.join(', ') || '-'}\nMerged rooms: ${mergedRooms.join(', ') || '-'}\n\nSource tenant will be marked inactive after merge.`,
      { title: 'Confirm Tenant Merge', confirmLabel: 'Merge Now', intent: 'warning' }
    );

    if (!confirmed) {
      return;
    }

    setMergingTenants(true);

    try {
      // 1) Update target tenant with merged room assignments
      await updateDoc(doc(db, 'tenants', targetTenant.id), {
        assignedRooms: mergedRooms,
        roomNumber: mergedRooms[0] || targetTenant.roomNumber || '',
        isActive: true,
        updatedAt: new Date().toISOString(),
        mergedFromTenantIds: [...new Set([...(targetTenant.mergedFromTenantIds || []), sourceTenant.id])]
      });

      // 2) Move tenant-linked records from source tenantId -> target tenantId
      const moveRecordsByTenantId = async (collectionName, extraPayload = {}) => {
        const snapshot = await getDocs(query(collection(db, collectionName), where('tenantId', '==', sourceTenant.id)));
        const updatePromises = snapshot.docs.map((snapshotDoc) => {
          const existing = snapshotDoc.data();
          return updateDoc(snapshotDoc.ref, {
            tenantId: targetTenant.id,
            tenantName: targetTenant.name,
            tenantNameSnapshot: targetTenant.name,
            mergedFromTenantId: sourceTenant.id,
            mergedAt: new Date().toISOString(),
            ...extraPayload,
            ...(existing.roomNumbers ? { roomNumbers: [...new Set([...(existing.roomNumbers || []), ...mergedRooms])] } : {})
          });
        });
        await Promise.all(updatePromises);
      };

      await moveRecordsByTenantId('payments');
      await moveRecordsByTenantId('paymentSubmissions');
      await moveRecordsByTenantId('electricityReadings');

      // 3) Ensure merged rooms point to target tenant
      const roomsRef = collection(db, 'rooms');
      for (const roomNumber of mergedRooms) {
        const roomAsNumber = Number.parseInt(roomNumber, 10);
        const queryCandidates = [
          query(roomsRef, where('roomNumber', '==', roomNumber))
        ];
        if (Number.isFinite(roomAsNumber)) {
          queryCandidates.unshift(query(roomsRef, where('roomNumber', '==', roomAsNumber)));
        }

        let roomSnapshot = null;
        for (const roomQuery of queryCandidates) {
          const snapshot = await getDocs(roomQuery);
          if (!snapshot.empty) {
            roomSnapshot = snapshot;
            break;
          }
        }

        if (!roomSnapshot?.empty) {
          await updateDoc(roomSnapshot.docs[0].ref, {
            status: 'filled',
            currentTenantId: targetTenant.id,
            lastStatusUpdatedAt: new Date().toISOString()
          });
        }
      }

      // 4) Deactivate source tenant (keep audit/history)
      await updateDoc(doc(db, 'tenants', sourceTenant.id), {
        isActive: false,
        assignedRooms: [],
        roomNumber: '',
        mergedIntoTenantId: targetTenant.id,
        mergedIntoTenantName: targetTenant.name,
        mergedAt: new Date().toISOString()
      });

      setMergeSourceTenantId('');
      setMergeTargetTenantId('');
      await fetchData();
      await showAlert('Tenant accounts merged successfully.', { title: 'Merge Complete', intent: 'success' });
    } catch (error) {
      console.error('Error merging tenants:', error);
      await showAlert('Failed to merge tenant accounts. Please try again.', { title: 'Merge Failed', intent: 'error' });
    } finally {
      setMergingTenants(false);
    }
  };

  const handleDeleteTenant = async (tenantRecord) => {
    const confirmed = await showConfirm('Are you sure you want to delete this tenant?', {
      title: 'Delete Tenant',
      confirmLabel: 'Delete',
      intent: 'warning'
    });
    if (!confirmed) {
      return;
    }

    try {
      // Delete tenant
      await deleteDoc(doc(db, 'tenants', tenantRecord.id));
      
      // Update all assigned rooms to vacant
      const assignedRooms = getAssignedRooms(tenantRecord);
      if (assignedRooms.length > 0) {
        const roomsRef = collection(db, 'rooms');
        for (const roomNumber of assignedRooms) {
          const roomNumberAsNumber = Number.parseInt(roomNumber, 10);
          const queryCandidates = [
            query(roomsRef, where('roomNumber', '==', roomNumber))
          ];
          if (Number.isFinite(roomNumberAsNumber)) {
            queryCandidates.unshift(query(roomsRef, where('roomNumber', '==', roomNumberAsNumber)));
          }

          let roomSnapshot = null;
          for (const roomQuery of queryCandidates) {
            const snapshot = await getDocs(roomQuery);
            if (!snapshot.empty) {
              roomSnapshot = snapshot;
              break;
            }
          }

          if (!roomSnapshot?.empty) {
            const roomDoc = roomSnapshot.docs[0];
            await updateDoc(doc(db, 'rooms', roomDoc.id), {
              status: 'vacant',
              currentTenantId: null
            });
          }
        }
      }
      
      fetchData();
      await showAlert('Tenant deleted successfully', { title: 'Deleted', intent: 'success' });
    } catch (err) {
      console.error('Error deleting tenant:', err);
      await showAlert('Failed to delete tenant. Please try again.', { title: 'Delete Failed', intent: 'error' });
    }
  };

  const handleViewHistory = async (tenant) => {
    setSelectedTenantHistory(tenant);
    setLoadingHistory(true);
    
    try {
      const paymentsRef = collection(db, 'payments');
      const assignedRooms = getAssignedRooms(tenant);

      const paymentDocs = new Map();

      // 1) Best match by tenantId (most reliable for current data)
      if (tenant.id) {
        const tenantIdQuery = query(paymentsRef, where('tenantId', '==', tenant.id));
        const tenantIdSnapshot = await getDocs(tenantIdQuery);
        tenantIdSnapshot.forEach((doc) => paymentDocs.set(doc.id, doc));
      }

      // 2) Fallback by assigned room numbers (supports old records with no tenantId)
      const roomQueries = [];
      assignedRooms.forEach((roomNumber) => {
        roomQueries.push(query(paymentsRef, where('roomNumber', '==', roomNumber)));

        const roomNumberAsNumber = Number.parseInt(roomNumber, 10);
        if (Number.isFinite(roomNumberAsNumber)) {
          roomQueries.push(query(paymentsRef, where('roomNumber', '==', roomNumberAsNumber)));
        }
      });

      const roomSnapshots = await Promise.all(roomQueries.map((roomQuery) => getDocs(roomQuery)));
      roomSnapshots.forEach((snapshot) => {
        snapshot.forEach((doc) => paymentDocs.set(doc.id, doc));
      });

      const tenantName = (tenant.name || '').trim().toLowerCase();

      const payments = Array.from(paymentDocs.values())
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((payment) => {
          if (payment.tenantId && tenant.id && payment.tenantId === tenant.id) {
            return true;
          }

          const snapshotName = (payment.tenantNameSnapshot || '').trim().toLowerCase();
          const legacyName = (payment.tenantName || '').trim().toLowerCase();

          return Boolean(tenantName) && (snapshotName === tenantName || legacyName === tenantName);
        })
        .sort((a, b) => {
          const yearDiff = Number(b.year || 0) - Number(a.year || 0);
          if (yearDiff !== 0) return yearDiff;
          return Number(b.month || 0) - Number(a.month || 0);
        });

      setPaymentHistory(payments);
    } catch (err) {
      console.error('Error fetching payment history:', err);
      await showAlert('Failed to load payment history', { title: 'History Error', intent: 'error' });
      setPaymentHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleCloseHistory = () => {
    setSelectedTenantHistory(null);
    setPaymentHistory([]);
  };

  const filteredTenants = tenants.filter(tenant => {
    // Active/Inactive filter
    let matchesActiveFilter = true;
    if (filter === 'active') matchesActiveFilter = tenant.isActive;
    if (filter === 'inactive') matchesActiveFilter = !tenant.isActive;
    
    // Floor filter
    let matchesFloorFilter = true;
    const assignedRoomNumbers = getAssignedRooms(tenant).map((room) => Number.parseInt(room, 10));

    if (floorFilter === 'floor1') {
      matchesFloorFilter = assignedRoomNumbers.some((roomNum) => roomNum >= 101 && roomNum <= 106);
    }
    if (floorFilter === 'floor2') {
      matchesFloorFilter = assignedRoomNumbers.some((roomNum) => roomNum >= 201 && roomNum <= 206);
    }
    
    return matchesActiveFilter && matchesFloorFilter;
  });

  const getRoomNumberValue = (roomNumber) => {
    const parsed = Number.parseInt(roomNumber, 10);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  };

  const sortedTenants = [...filteredTenants].sort((a, b) => {
    const primaryRoomA = getAssignedRooms(a)[0] || a.roomNumber;
    const primaryRoomB = getAssignedRooms(b)[0] || b.roomNumber;
    const roomDiff = getRoomNumberValue(primaryRoomA) - getRoomNumberValue(primaryRoomB);
    if (roomDiff !== 0) return roomDiff;
    return (a.name || '').localeCompare(b.name || '');
  });

  const stats = {
    total: tenants.length,
    active: tenants.filter(t => t.isActive).length,
    inactive: tenants.filter(t => !t.isActive).length,
    floor1: tenants.filter(t => {
      const assignedRoomNumbers = getAssignedRooms(t).map((room) => Number.parseInt(room, 10));
      return assignedRoomNumbers.some((roomNum) => roomNum >= 101 && roomNum <= 106);
    }).length,
    floor2: tenants.filter(t => {
      const assignedRoomNumbers = getAssignedRooms(t).map((room) => Number.parseInt(room, 10));
      return assignedRoomNumbers.some((roomNum) => roomNum >= 201 && roomNum <= 206);
    }).length
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading tenants...</p>
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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">👥 Tenants Management</h2>
          <p className="text-gray-600">Manage all tenants and room assignments</p>
        </div>
        <button onClick={handleAddTenant} className="btn-primary">
          ➕ Add New Tenant
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">Total Tenants</p>
              <p className="text-3xl font-bold mt-1">{stats.total}</p>
            </div>
            <div className="text-4xl">👥</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">Active Tenants</p>
              <p className="text-3xl font-bold mt-1">{stats.active}</p>
            </div>
            <div className="text-4xl">✅</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-gray-500 to-gray-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-100 text-sm">Inactive Tenants</p>
              <p className="text-3xl font-bold mt-1">{stats.inactive}</p>
            </div>
            <div className="text-4xl">📋</div>
          </div>
        </div>
      </div>

      {/* Filter Buttons */}
      <div className="card mb-6 space-y-4">
        {/* Active/Inactive Filters */}
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
              All Tenants ({stats.total})
            </button>
            <button
              onClick={() => setFilter('active')}
              className={`px-4 py-2 rounded-lg font-semibold transition ${
                filter === 'active'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Active ({stats.active})
            </button>
            <button
              onClick={() => setFilter('inactive')}
              className={`px-4 py-2 rounded-lg font-semibold transition ${
                filter === 'inactive'
                  ? 'bg-gray-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Inactive ({stats.inactive})
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

        {/* View Mode Toggle */}
        <div>
          <label className="text-sm font-semibold text-gray-700 mb-2 block">View Mode</label>
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode('card')}
              className={`px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2 ${
                viewMode === 'card'
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              <span>🎴</span> Card View
            </button>
            <button
              onClick={() => setViewMode('detail')}
              className={`px-4 py-2 rounded-lg font-semibold transition flex items-center gap-2 ${
                viewMode === 'detail'
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              <span>📋</span> Detail View
            </button>
          </div>
        </div>
      </div>

      {/* Merge Tenant Accounts */}
      <div className="card mb-6 border-2 border-amber-200 bg-amber-50">
        <h3 className="text-lg font-bold text-amber-900 mb-3">🧩 Merge Duplicate Tenants</h3>
        <p className="text-sm text-amber-800 mb-3">
          Use this when the same person was added twice. Source tenant will be deactivated and records will move to target tenant.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-xs font-semibold text-amber-900 mb-1">Target Tenant (keep this)</label>
            <select
              value={mergeTargetTenantId}
              onChange={(event) => setMergeTargetTenantId(event.target.value)}
              disabled={mergingTenants}
              className="w-full px-3 py-2 border border-amber-300 rounded-lg bg-white"
            >
              <option value="">Select target tenant</option>
              {tenants.map((tenant) => (
                <option key={`target_${tenant.id}`} value={tenant.id}>
                  {tenant.name} ({getAssignedRooms(tenant).join(', ') || '-'}) {tenant.isActive ? '' : '[Inactive]'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-amber-900 mb-1">Source Tenant (merge this into target)</label>
            <select
              value={mergeSourceTenantId}
              onChange={(event) => setMergeSourceTenantId(event.target.value)}
              disabled={mergingTenants}
              className="w-full px-3 py-2 border border-amber-300 rounded-lg bg-white"
            >
              <option value="">Select source tenant</option>
              {tenants.map((tenant) => (
                <option key={`source_${tenant.id}`} value={tenant.id}>
                  {tenant.name} ({getAssignedRooms(tenant).join(', ') || '-'}) {tenant.isActive ? '' : '[Inactive]'}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={mergeTenantAccounts}
          disabled={mergingTenants}
          className="bg-amber-600 hover:bg-amber-700 text-white font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
        >
          {mergingTenants ? 'Merging...' : 'Merge Tenants'}
        </button>
      </div>

      {/* Tenants List */}
      {filteredTenants.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-6xl mb-4">👥</div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">
            {filter === 'all' ? 'No Tenants Yet' : `No ${filter} tenants found`}
          </h3>
          <p className="text-gray-600 mb-4">
            {filter === 'all' 
              ? 'Add your first tenant to get started'
              : 'Try adjusting your filter'}
          </p>
          {filter === 'all' && (
            <button onClick={handleAddTenant} className="btn-primary">
              ➕ Add First Tenant
            </button>
          )}
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sortedTenants.map(tenant => (
            <TenantCard
              key={tenant.id}
              tenant={tenant}
              onEdit={() => handleEditTenant(tenant)}
              onDelete={() => handleDeleteTenant(tenant)}
              onViewHistory={() => handleViewHistory(tenant)}
            />
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tenant</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Room</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rent</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Check-In</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Password</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedTenants.map(tenant => {
                // Calculate duration
                const calculateDuration = () => {
                  if (!tenant.checkInDate) return '-';
                  try {
                    const checkIn = new Date(tenant.checkInDate);
                    const now = new Date();
                    let years = now.getFullYear() - checkIn.getFullYear();
                    let months = now.getMonth() - checkIn.getMonth();
                    if (months < 0) {
                      years--;
                      months += 12;
                    }
                    if (years === 0 && months === 0) return 'New';
                    if (years === 0) return `${months}m`;
                    if (months === 0) return `${years}y`;
                    return `${years}y ${months}m`;
                  } catch (e) {
                    return '-';
                  }
                };

                return (
                  <tr key={tenant.id} className={tenant.isActive ? 'bg-green-50' : 'bg-gray-50'}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-gray-900">{tenant.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                        🏠 {getAssignedRooms(tenant).join(', ') || tenant.roomNumber || '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {tenant.phone || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                      {tenant.currentRent ? `₹${tenant.currentRent.toLocaleString('en-IN')}` : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {tenant.checkInDate ? new Date(tenant.checkInDate).toLocaleDateString('en-IN') : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                        🕐 {calculateDuration()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <code className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-mono">
                        {tenant.username || getAssignedRooms(tenant)[0] || tenant.roomNumber}
                      </code>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <code className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-mono">
                        {tenant.password || 'password'}
                      </code>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        tenant.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {tenant.isActive ? '✅ Active' : '📋 Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleViewHistory(tenant)}
                          className="text-purple-600 hover:text-purple-900 font-medium"
                          title="View History"
                        >
                          📊
                        </button>
                        <button 
                          onClick={() => handleEditTenant(tenant)}
                          className="text-blue-600 hover:text-blue-900 font-medium"
                          title="Edit"
                        >
                          ✏️
                        </button>
                        <button 
                          onClick={() => handleDeleteTenant(tenant)}
                          className="text-red-600 hover:text-red-900 font-medium"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tenant Form Modal */}
      {showForm && (
        <TenantForm
          tenant={editingTenant}
          rooms={rooms}
          tenants={tenants}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}

      {/* Payment History Modal */}
      {selectedTenantHistory && (
        <PaymentHistoryModal
          tenant={selectedTenantHistory}
          payments={paymentHistory}
          loading={loadingHistory}
          onClose={handleCloseHistory}
        />
      )}
    </div>
  );
};

const PaymentHistoryModal = ({ tenant, payments, loading, onClose }) => {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // Calculate totals
  const totalCollected = payments.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
  const totalBilled = payments.reduce((sum, p) => sum + ((p.rent || 0) + (p.electricity || 0)), 0);
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-screen overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold mb-1">📊 Payment History</h2>
              <p className="text-blue-100">{tenant.name} - Room {tenant.roomNumber}</p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="bg-white bg-opacity-20 rounded-lg p-3">
              <p className="text-blue-100 text-sm">Total Collected</p>
              <p className="text-2xl font-bold">₹{totalCollected.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-white bg-opacity-20 rounded-lg p-3">
              <p className="text-blue-100 text-sm">Total Payments</p>
              <p className="text-2xl font-bold">{payments.length}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                <p className="text-gray-600">Loading payment history...</p>
              </div>
            </div>
          ) : payments.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">📄</div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">No Payment History</h3>
              <p className="text-gray-600">This tenant has no payment records yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Period</th>
                    <th className="px-4 py-3 text-right font-semibold">Rent</th>
                    <th className="px-4 py-3 text-right font-semibold">Electricity</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-right font-semibold">Paid</th>
                    <th className="px-4 py-3 text-left font-semibold">Payment Date</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => {
                    const rent = payment.rent || 0;
                    const electricity = payment.electricity || 0;
                    const total = rent + electricity;
                    const paid = payment.paidAmount || 0;
                    const isPaid = payment.status === 'paid';
                    
                    return (
                      <tr key={payment.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 font-semibold">
                          {monthNames[payment.month - 1]} {payment.year}
                        </td>
                        <td className="px-4 py-3 text-right">₹{rent.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-right">₹{electricity.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-right font-semibold">₹{total.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-right font-bold text-green-600">
                          ₹{paid.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3">
                          {payment.paymentDate || payment.paidAt 
                            ? new Date(payment.paymentDate || payment.paidAt).toLocaleDateString('en-IN')
                            : '-'
                          }
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            isPaid && paid > 0
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {isPaid && paid > 0 ? '✅ Paid' : '❌ Pending'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="btn-primary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const TenantCard = ({ tenant, onEdit, onDelete, onViewHistory }) => {
  const { showAlert, showPrompt } = useDialog();
  const isActive = tenant.isActive;
  const assignedRooms = Array.isArray(tenant?.assignedRooms) && tenant.assignedRooms.length > 0
    ? tenant.assignedRooms.map((room) => String(room))
    : (tenant?.roomNumber ? [String(tenant.roomNumber)] : []);
  const primaryRoom = assignedRooms[0] || tenant.roomNumber;
  
  // Calculate living duration
  const calculateDuration = () => {
    if (!tenant.checkInDate) return null;
    
    try {
      const checkIn = new Date(tenant.checkInDate);
      const now = new Date();
      
      let years = now.getFullYear() - checkIn.getFullYear();
      let months = now.getMonth() - checkIn.getMonth();
      
      if (months < 0) {
        years--;
        months += 12;
      }
      
      if (years === 0 && months === 0) {
        return 'New tenant';
      } else if (years === 0) {
        return `${months} month${months > 1 ? 's' : ''}`;
      } else if (months === 0) {
        return `${years} year${years > 1 ? 's' : ''}`;
      } else {
        return `${years}y ${months}m`;
      }
    } catch (e) {
      return null;
    }
  };
  
  const duration = calculateDuration();
  
  // Copy credentials to clipboard
  const copyCredentials = async () => {
    const portalUrl = `${window.location.origin}/tenant-portal`;
    const roomLabel = assignedRooms.length > 0 ? assignedRooms.join(', ') : String(tenant.roomNumber || '-');
    const text = `🏠 Tenant Portal Access\n\nPortal URL: ${portalUrl}\n\nRooms: ${roomLabel}\nUsername: ${tenant.username || primaryRoom}\nPassword: ${tenant.password || 'password'}\n\n📱 Login and check your payment status!`;
    try {
      await navigator.clipboard.writeText(text);
      await showAlert('✅ Credentials & Portal URL copied!\n\nShare these with the tenant.', {
        title: 'Copied',
        intent: 'success'
      });
    } catch {
      await showPrompt('Copy these credentials manually:', {
        title: 'Manual Copy',
        defaultValue: text,
        confirmLabel: 'Close'
      });
    }
  };
  
  return (
    <div className={`card p-4 border-2 transition-all ${
      isActive 
        ? 'border-green-300 bg-green-50' 
        : 'border-gray-300 bg-gray-50'
    }`}>
      {/* Header - Name & Status */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="text-lg font-bold text-gray-800 mb-2">
            {tenant.name}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
              isActive
                ? 'bg-green-500 text-white'
                : 'bg-gray-500 text-white'
            }`}>
              {isActive ? '✅ Active' : '📋 Inactive'}
            </span>
            {assignedRooms.length > 0 && (
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-blue-500 text-white">
                🏠 Room {assignedRooms.join(', ')}
              </span>
            )}
            {duration && (
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-purple-500 text-white">
                🕐 {duration}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tenant Information */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between py-2 border-b border-gray-300">
          <span className="text-sm font-medium text-gray-600">📱 Phone</span>
          <span className="text-sm font-semibold text-gray-800">{tenant.phone || '-'}</span>
        </div>
        
        {tenant.currentRent && (
          <div className="flex items-center justify-between py-2 border-b border-gray-300">
            <span className="text-sm font-medium text-gray-600">💵 Monthly Rent</span>
            <span className="text-sm font-semibold text-gray-800">
              ₹{tenant.currentRent.toLocaleString('en-IN')}
            </span>
          </div>
        )}
        
        {tenant.dueDate && (
          <div className="flex items-center justify-between py-2 border-b border-gray-300">
            <span className="text-sm font-medium text-gray-600">📅 Due Date</span>
            <span className="text-sm font-semibold text-orange-700">
              {tenant.dueDate} of every month
            </span>
          </div>
        )}
        
        {tenant.checkInDate && (
          <div className="flex items-center justify-between py-2 border-b border-gray-300">
            <span className="text-sm font-medium text-gray-600">📅 Check-in Date</span>
            <span className="text-sm font-semibold text-gray-800">
              {new Date(tenant.checkInDate).toLocaleDateString('en-IN')}
            </span>
          </div>
        )}
      </div>

      {/* Quick Actions - Simplified */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={() => {
            const portalUrl = `${window.location.origin}/tenant-portal`;
            window.open(portalUrl, '_blank');
          }}
          className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-4 py-3 rounded-lg font-bold transition-all text-sm shadow-md"
          title="Open Tenant Portal"
        >
          🚀 Tenant Portal
        </button>
        <button 
          onClick={copyCredentials} 
          className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-4 py-3 rounded-lg font-bold transition-all text-sm shadow-md"
          title="Copy Login Details"
        >
          📋 Copy Login
        </button>
      </div>

      {/* Login Credentials - Compact */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 mb-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-blue-600 font-semibold">User:</span>
            <span className="font-mono font-bold text-blue-900">{tenant.username || primaryRoom}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-blue-600 font-semibold">Pass:</span>
            <span className="font-mono font-bold text-blue-900">{tenant.password || 'password'}</span>
          </div>
        </div>
      </div>

      {/* Action Buttons - Minimized */}
      <div className="grid grid-cols-3 gap-2">
        <button 
          onClick={onViewHistory} 
          className="bg-purple-100 hover:bg-purple-200 text-purple-700 px-3 py-2 rounded-lg font-semibold transition text-xs border border-purple-300"
          title="View History"
        >
          📊 History
        </button>
        <button 
          onClick={onEdit} 
          className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-2 rounded-lg font-semibold transition text-xs border border-blue-300"
          title="Edit Tenant"
        >
          ✏️ Edit
        </button>
        <button 
          onClick={onDelete} 
          className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg font-semibold transition text-xs border border-red-300"
          title="Delete Tenant"
        >
          🗑️ Delete
        </button>
      </div>
    </div>
  );
};

export default Tenants;
