import { useState, useEffect, Fragment } from 'react';
import { collection, getDocs, query, orderBy, where, doc, updateDoc, addDoc, writeBatch, serverTimestamp } from '../utils/firestoreCounted';
import { db, auth } from '../firebase';
import { validateRoomCount } from '../utils/roomValidation';
import { useDialog } from './ui/DialogProvider';
import ViewModeToggle from './ui/ViewModeToggle';
import useResponsiveViewMode from '../utils/useResponsiveViewMode';

const Rooms = () => {
  const { showConfirm } = useDialog();
  const [rooms, setRooms] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [meterReadings, setMeterReadings] = useState({}); // roomNumber → latest reading
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all'); // all, vacant, occupied
  const [floorFilter, setFloorFilter] = useState('all'); // all, floor1, floor2
  const { viewMode, setViewMode, isCardView } = useResponsiveViewMode('rooms-view-mode', 'table');
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [selectedRooms, setSelectedRooms] = useState(new Set());
  const [updating, setUpdating] = useState(false);
  // Modal: Occupied → Vacant (dues confirmation)
  const [vacantModal, setVacantModal] = useState(null); // room object
  const [vacantRentCleared, setVacantRentCleared] = useState(false);
  const [vacantElecCleared, setVacantElecCleared] = useState(false);
  const [vacantRemark, setVacantRemark] = useState('');
  // Modal: Vacant → Occupied (assign tenant)
  const [occupyModal, setOccupyModal] = useState(null); // room object
  const [occupyTenantId, setOccupyTenantId] = useState('');
  const [occupyRemark, setOccupyRemark] = useState('');
  // Expanded breakdown for multi-room rows
  const [expandedMultiRows, setExpandedMultiRows] = useState(new Set());
  const toggleMultiExpand = (key) => setExpandedMultiRows(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  useEffect(() => {
    fetchRooms();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const updateViewport = () => {
      const isMobile = mediaQuery.matches;
      setIsMobileViewport(isMobile);
      if (isMobile) {
        setFloorFilter('all');
      }
    };

    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);

    return () => {
      mediaQuery.removeEventListener('change', updateViewport);
    };
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

      // Fetch all tenants (for last tenant info on vacant rooms)
      const tenantsSnap = await getDocs(collection(db, 'tenants'));
      const tenantsData = tenantsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTenants(tenantsData);

      // Fetch latest meter reading per room from electricityReadings
      try {
        const readingsSnap = await getDocs(collection(db, 'electricityReadings'));
        const readingsByRoom = {};
        readingsSnap.docs.forEach(d => {
          const r = d.data();
          const rn = String(r.roomNumber ?? '');
          if (!rn) return;
          const existing = readingsByRoom[rn];
          const ts = r.date || r.readingDate || r.createdAt || '';
          if (!existing || ts > (existing.ts || '')) {
            readingsByRoom[rn] = { reading: r.currentReading ?? r.reading ?? r.endReading ?? null, ts };
          }
        });
        // Also check payments for last meter reading
        const paymentsSnap = await getDocs(collection(db, 'payments'));
        paymentsSnap.docs.forEach(d => {
          const p = d.data();
          const rn = String(p.roomNumber ?? '');
          if (!rn) return;
          const meterVal = p.currentMeterReading ?? p.endMeterReading ?? p.meterReading ?? null;
          if (meterVal === null) return;
          const ts = p.paidDate || p.paymentDate || `${p.year}-${String(p.month).padStart(2,'0')}` || '';
          const existing = readingsByRoom[rn];
          if (!existing || ts > (existing.ts || '')) {
            readingsByRoom[rn] = { reading: meterVal, ts };
          }
        });
        setMeterReadings(readingsByRoom);
      } catch (mErr) {
        console.warn('Could not fetch meter readings:', mErr.message);
      }
      
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
    if (isRoomOccupied(room)) {
      // Occupied → Vacant: show dues confirmation
      setVacantModal(room);
      setVacantRentCleared(false);
      setVacantElecCleared(false);
      setVacantRemark('');
    } else {
      // Vacant → Occupied: ask which tenant
      setOccupyModal(room);
      setOccupyTenantId('');
      setOccupyRemark('');
    }
  };

  const closeVacantModal = () => { setVacantModal(null); };
  const closeOccupyModal = () => { setOccupyModal(null); };

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

  const handleMarkVacant = async () => {
    if (!vacantModal) return;
    if (!vacantRentCleared || !vacantElecCleared) {
      alert('Please confirm that both rent dues and electricity dues are cleared before marking vacant.');
      return;
    }
    setUpdating(true);
    try {
      await updateRoomStatus(vacantModal.id, 'vacant', vacantRemark || 'Marked vacant by admin');
      closeVacantModal();
      fetchRooms();
    } catch {
      alert('Failed to update room status. Please try again.');
    } finally {
      setUpdating(false);
    }
  };

  const handleMarkOccupied = async () => {
    if (!occupyModal) return;
    setUpdating(true);
    try {
      const remark = occupyRemark || (occupyTenantId
        ? `Assigned to tenant: ${tenants.find(t => t.id === occupyTenantId)?.name || occupyTenantId}`
        : 'Marked occupied by admin');
      await updateRoomStatus(occupyModal.id, 'occupied', remark);
      // If a tenant was selected, update that tenant's roomNumber
      if (occupyTenantId) {
        const tenantRef = doc(db, 'tenants', occupyTenantId);
        await updateDoc(tenantRef, {
          roomNumber: occupyModal.roomNumber,
          isActive: true,
        });
      }
      closeOccupyModal();
      fetchRooms();
    } catch {
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

  // 'filled' (set by TenantForm) and 'occupied' (set by admin) both mean occupied
  const isRoomOccupied = (room) => room.status === 'occupied' || room.status === 'filled';
  const isRoomVacant = (room) => !isRoomOccupied(room);

  const filteredRooms = rooms.filter(room => {
    // Status filter
    let matchesStatusFilter = true;
    if (filter === 'occupied') {
      matchesStatusFilter = isRoomOccupied(room);
    } else if (filter === 'vacant') {
      matchesStatusFilter = isRoomVacant(room);
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
    vacant: rooms.filter(r => isRoomVacant(r)).length,
    occupied: rooms.filter(r => isRoomOccupied(r)).length,
    floor1: rooms.filter(r => r.roomNumber >= 101 && r.roomNumber <= 106).length,
    floor2: rooms.filter(r => r.roomNumber >= 201 && r.roomNumber <= 206).length,
    floor1Vacant: rooms.filter(r => r.roomNumber >= 101 && r.roomNumber <= 106 && isRoomVacant(r)).length,
    floor2Vacant: rooms.filter(r => r.roomNumber >= 201 && r.roomNumber <= 206 && isRoomVacant(r)).length,
  };

  // Helper: get enriched info for a room
  const getRoomInfo = (room) => {
    const rn = String(room.roomNumber);
    const isVacant = isRoomVacant(room);
    // Current tenant (occupied rooms) — also check assignedRooms array for multi-room tenants
    const currentTenant = !isVacant
      ? tenants.find(t => t.isActive && (
          String(t.roomNumber) === rn ||
          (Array.isArray(t.assignedRooms) && t.assignedRooms.map(String).includes(rn))
        ))
      : null;
    // Last tenant (vacant rooms)
    const pastTenants = tenants.filter(t => !t.isActive && String(t.roomNumber) === rn);
    const lastTenant = pastTenants.sort((a, b) => {
      const da = a.checkOutDate || '';
      const db2 = b.checkOutDate || '';
      return da > db2 ? -1 : 1;
    })[0] || null;
    // Last meter reading
    const meterInfo = meterReadings[rn] || null;
    return { currentTenant, lastTenant, meterInfo };
  };

  const fmtDate = (val) => {
    if (!val) return null;
    if (val.seconds) return new Date(val.seconds * 1000).toLocaleDateString('en-IN');
    const d = new Date(val);
    return isNaN(d) ? String(val) : d.toLocaleDateString('en-IN');
  };

  // lastStatusUpdatedAt only gets set the first time a room's status is toggled
  // via Mark Vacant/Occupied — most rooms were seeded with a status and never
  // toggled, so it reads "Never" even for long-occupied rooms. Fall back to the
  // tenant's check-in date (labelled differently, since it's a different fact)
  // instead of showing a bare, uninformative "Never".
  const formatLastUpdated = (lastUpdated, checkInFallback) => {
    if (lastUpdated) return `Updated: ${fmtDate(lastUpdated)}`;
    if (checkInFallback) return `Since: ${fmtDate(checkInFallback)}`;
    return 'Updated: Never';
  };

  // Per-room rent lookup (standalone so card/table breakdowns can use it too)
  const getPerRoomRent = (roomObj) => {
    if (roomObj.defaultRent) return Number(roomObj.defaultRent);
    const rn = String(roomObj.roomNumber);
    const byRoomNumber = tenants.find(t => String(t.roomNumber) === rn);
    if (byRoomNumber?.currentRent) return Number(byRoomNumber.currentRent);
    const byUsername = tenants.find(t => String(t.username) === rn);
    if (byUsername?.currentRent) return Number(byUsername.currentRent);
    return 0;
  };

  // Build display rows: multi-room tenants (assignedRooms array) are merged into one row
  const buildDisplayRows = (roomList) => {
    const rows = [];
    const handled = new Set();
    for (const room of roomList) {
      if (handled.has(room.id)) continue;
      const rn = String(room.roomNumber);
      const isVacant = isRoomVacant(room);
      const tenant = !isVacant
        ? tenants.find(t => t.isActive && (
            String(t.roomNumber) === rn ||
            (Array.isArray(t.assignedRooms) && t.assignedRooms.map(String).includes(rn))
          ))
        : null;
      if (tenant && Array.isArray(tenant.assignedRooms) && tenant.assignedRooms.length > 1) {
        // Multi-room tenant: merge all their rooms that appear in the filtered list
        const tnRooms = tenant.assignedRooms.map(String);
        const mergedRooms = roomList.filter(r => tnRooms.includes(String(r.roomNumber)));
        mergedRooms.forEach(r => handled.add(r.id));
        const totalRent = mergedRooms.reduce((s, r) => s + getPerRoomRent(r), 0);
        const getTs = (v) => v?.seconds ? v.seconds : (v ? new Date(v).getTime() / 1000 : 0);
        const latestUpdated = mergedRooms.reduce((best, r) => {
          if (!r.lastStatusUpdatedAt) return best;
          return !best || getTs(r.lastStatusUpdatedAt) > getTs(best) ? r.lastStatusUpdatedAt : best;
        }, null);
        const latestMeter = mergedRooms.reduce((best, r) => {
          const rm = meterReadings[String(r.roomNumber)];
          if (!rm) return best;
          return !best || (rm.ts || '') > (best.ts || '') ? rm : best;
        }, null);
        rows.push({
          key: `multi_${tenant.id}`,
          isMulti: true,
          rooms: mergedRooms,
          primaryRoom: mergedRooms[0],
          currentTenant: tenant,
          lastTenant: null,
          meterInfo: latestMeter,
          displayRent: totalRent || null,
          isVacant: false,
          roomLabel: mergedRooms.map(r => r.roomNumber).sort().join(' & '),
          meterLabel: mergedRooms.map(r => r.electricityMeterNo || '—').join(', '),
          lastUpdated: latestUpdated,
          checkInFallback: tenant.checkInDate || null,
        });
      } else {
        handled.add(room.id);
        const { currentTenant, lastTenant, meterInfo } = getRoomInfo(room);
        rows.push({
          key: room.id,
          isMulti: false,
          rooms: [room],
          primaryRoom: room,
          currentTenant,
          lastTenant,
          meterInfo,
          displayRent: room.defaultRent || currentTenant?.currentRent || null,
          isVacant,
          roomLabel: String(room.roomNumber),
          meterLabel: room.electricityMeterNo || 'N/A',
          lastUpdated: room.lastStatusUpdatedAt,
          checkInFallback: currentTenant?.checkInDate || null,
        });
      }
    }
    return rows;
  };

  // Toggle selection for all rooms in a row (handles multi-room merged rows)
  const toggleRowSelection = (roomIds) => {
    const newSel = new Set(selectedRooms);
    const allSelected = roomIds.every(id => newSel.has(id));
    if (allSelected) {
      roomIds.forEach(id => newSel.delete(id));
    } else {
      roomIds.forEach(id => newSel.add(id));
    }
    setSelectedRooms(newSel);
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
    <div className="p-4 lg:p-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">🏠 Rooms Management</h2>
        <p className="text-gray-600">View and manage all 12 rooms with occupancy status</p>
      </div>

      {/* Stats Strip — 3 metrics in one compact card instead of 3 large ones */}
      <div className="card !p-0 overflow-hidden mb-6">
        <div className="grid grid-cols-3 divide-x divide-white/20">
          <div className="flex items-center gap-3 bg-gradient-to-br from-blue-500 to-blue-600 text-white px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-lg shrink-0">🏠</div>
            <div className="min-w-0">
              <p className="text-blue-100 text-[11px] leading-tight">Total</p>
              <p className="text-xl font-bold leading-tight">{stats.total}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-gradient-to-br from-gray-500 to-gray-600 text-white px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-lg shrink-0">⬜</div>
            <div className="min-w-0">
              <p className="text-gray-100 text-[11px] leading-tight">Vacant</p>
              <p className="text-xl font-bold leading-tight">{stats.vacant}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-gradient-to-br from-green-500 to-green-600 text-white px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-lg shrink-0">✅</div>
            <div className="min-w-0">
              <p className="text-green-100 text-[11px] leading-tight">Occupied</p>
              <p className="text-xl font-bold leading-tight">{stats.occupied}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Floor Vacancy Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Floor 1 */}
        <div className={`card !p-4 border-2 ${stats.floor1Vacant > 0 ? 'border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30' : 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30'}`}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">Ground Floor (101–106)</p>
              <p className="text-lg font-bold text-gray-900 dark:text-slate-100 mt-0.5">
                {stats.floor1Vacant > 0
                  ? <span className="text-orange-700 dark:text-orange-400">🔓 {stats.floor1Vacant} Vacant</span>
                  : <span className="text-green-700 dark:text-green-400">✅ All Occupied</span>}
              </p>
            </div>
            <div className={`text-3xl ${stats.floor1Vacant > 0 ? 'text-orange-400' : 'text-green-400'}`}>
              {stats.floor1Vacant > 0 ? '🏚️' : '🏠'}
            </div>
          </div>
          <div className="flex gap-1">
            {rooms.filter(r => r.roomNumber >= 101 && r.roomNumber <= 106).map(r => (
              <div
                key={r.id}
                title={`Room ${r.roomNumber}`}
                className={`flex-1 h-5 rounded text-xs font-bold flex items-center justify-center text-white ${
                  isRoomVacant(r) ? 'bg-orange-400' : 'bg-green-500'
                }`}
              >
                {r.roomNumber}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">
            {stats.floor1 - stats.floor1Vacant}/{stats.floor1} occupied
          </p>
          {/* Vacant room quick-info */}
          {rooms.filter(r => r.roomNumber >= 101 && r.roomNumber <= 106 && isRoomVacant(r)).map(r => {
            const { lastTenant, meterInfo } = getRoomInfo(r);
            return (
              <div key={r.id} className="mt-2 pl-2 border-l-2 border-orange-300 dark:border-orange-700 text-xs text-gray-600 dark:text-slate-400 space-y-0.5">
                <span className="font-semibold text-orange-700 dark:text-orange-400">Room {r.roomNumber}:</span>
                {lastTenant
                  ? <> Last: <span className="font-medium text-gray-800 dark:text-slate-200">{lastTenant.name}</span>{lastTenant.checkOutDate ? <> · Checkout: <span className="font-medium">{fmtDate(lastTenant.checkOutDate)}</span></> : null}</>
                  : <> — no past tenant on record</>}
                {meterInfo?.reading != null && <> · Meter: <span className="font-medium">{meterInfo.reading} units</span></>}
              </div>
            );
          })}
        </div>

        {/* Floor 2 */}
        <div className={`card !p-4 border-2 ${stats.floor2Vacant > 0 ? 'border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30' : 'border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950/30'}`}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">First Floor (201–206)</p>
              <p className="text-lg font-bold text-gray-900 dark:text-slate-100 mt-0.5">
                {stats.floor2Vacant > 0
                  ? <span className="text-orange-700 dark:text-orange-400">🔓 {stats.floor2Vacant} Vacant</span>
                  : <span className="text-green-700 dark:text-green-400">✅ All Occupied</span>}
              </p>
            </div>
            <div className={`text-3xl ${stats.floor2Vacant > 0 ? 'text-orange-400' : 'text-green-400'}`}>
              {stats.floor2Vacant > 0 ? '🏚️' : '🏠'}
            </div>
          </div>
          <div className="flex gap-1">
            {rooms.filter(r => r.roomNumber >= 201 && r.roomNumber <= 206).map(r => (
              <div
                key={r.id}
                title={`Room ${r.roomNumber}`}
                className={`flex-1 h-5 rounded text-xs font-bold flex items-center justify-center text-white ${
                  isRoomVacant(r) ? 'bg-orange-400' : 'bg-green-500'
                }`}
              >
                {r.roomNumber}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">
            {stats.floor2 - stats.floor2Vacant}/{stats.floor2} occupied
          </p>
          {rooms.filter(r => r.roomNumber >= 201 && r.roomNumber <= 206 && isRoomVacant(r)).map(r => {
            const { lastTenant, meterInfo } = getRoomInfo(r);
            return (
              <div key={r.id} className="mt-2 pl-2 border-l-2 border-orange-300 dark:border-orange-700 text-xs text-gray-600 dark:text-slate-400 space-y-0.5">
                <span className="font-semibold text-orange-700 dark:text-orange-400">Room {r.roomNumber}:</span>
                {lastTenant
                  ? <> Last: <span className="font-medium text-gray-800 dark:text-slate-200">{lastTenant.name}</span>{lastTenant.checkOutDate ? <> · Checkout: <span className="font-medium">{fmtDate(lastTenant.checkOutDate)}</span></> : null}</>
                  : <> — no past tenant on record</>}
                {meterInfo?.reading != null && <> · Meter: <span className="font-medium">{meterInfo.reading} units</span></>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters + view + select-all — merged */}
      <div className="card mb-6 !p-0 overflow-hidden">
        {/* Status & Floor Filters + view toggle */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          {/* Status Filters */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mr-1">Status:</span>
            <button
              onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                filter === 'all'
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All ({stats.total})
            </button>
            <button
              onClick={() => setFilter('vacant')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                filter === 'vacant'
                  ? 'bg-gray-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Vacant ({stats.vacant})
            </button>
            <button
              onClick={() => setFilter('occupied')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                filter === 'occupied'
                  ? 'bg-green-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Occupied ({stats.occupied})
            </button>
          </div>

          {/* Floor Filters */}
          <div className="hidden md:flex items-center gap-1.5">
            <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide mr-1">Floor:</span>
            <button
              onClick={() => setFloorFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                floorFilter === 'all'
                  ? 'bg-purple-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFloorFilter('floor1')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                floorFilter === 'floor1'
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Ground ({stats.floor1})
            </button>
            <button
              onClick={() => setFloorFilter('floor2')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                floorFilter === 'floor2'
                  ? 'bg-indigo-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              First ({stats.floor2})
            </button>
          </div>

          {/* View toggle — pushed right */}
          <div className="hidden md:block ml-auto">
            <ViewModeToggle viewMode={viewMode} onChange={setViewMode} />
          </div>
        </div>

        {/* Select All (card / mobile view only) */}
        {(isMobileViewport || isCardView) && (
          <label className="flex items-center justify-between gap-2 cursor-pointer px-4 py-2.5 border-t border-gray-100 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-800/40">
            <span className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={selectedRooms.size === filteredRooms.length && filteredRooms.length > 0}
                onChange={toggleSelectAll}
                className="w-4 h-4 text-primary rounded"
              />
              Select All
            </span>
            {selectedRooms.size > 0 && (
              <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">{selectedRooms.size} selected</span>
            )}
          </label>
        )}

        {/* Bulk Actions */}
        {selectedRooms.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-gray-100 dark:border-slate-700 bg-blue-50 dark:bg-blue-950/30">
            <span className="font-semibold text-blue-900 dark:text-blue-200 text-sm">
              {selectedRooms.size} room(s) selected
            </span>
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => handleBulkUpdate('vacant')}
                disabled={updating}
                className="px-3 py-1.5 text-sm bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition disabled:opacity-50"
              >
                Mark Vacant
              </button>
              <button
                onClick={() => handleBulkUpdate('occupied')}
                disabled={updating}
                className="px-3 py-1.5 text-sm bg-green-500 text-white rounded-lg hover:bg-green-600 transition disabled:opacity-50"
              >
                Mark Occupied
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
      ) : (isMobileViewport || isCardView) ? (
        <div className="space-y-5">
          {(() => {
            const allRows = buildDisplayRows(filteredRooms);
            const floorOf = (row) => Number(row.primaryRoom?.roomNumber ?? row.rooms?.[0]?.roomNumber ?? 0) >= 200 ? 2 : 1;
            const groups = [
              { id: 1, label: 'Floor 1 · Ground Floor', icon: '🏠', grad: 'from-indigo-500 to-blue-500', rows: allRows.filter(r => floorOf(r) === 1) },
              { id: 2, label: 'Floor 2 · First Floor', icon: '🏢', grad: 'from-fuchsia-500 to-purple-500', rows: allRows.filter(r => floorOf(r) === 2) },
            ].filter(g => g.rows.length > 0);
            const renderCard = (row) => {
            const { key, isMulti, rooms: rowRooms, primaryRoom, currentTenant, lastTenant, meterInfo, displayRent, isVacant, roomLabel, meterLabel, lastUpdated, checkInFallback } = row;
            const rowIds = rowRooms.map(r => r.id);
            const allSelected = rowIds.every(id => selectedRooms.has(id));
            const expanded = expandedMultiRows.has(key);

            return (
              <div key={key} className={`rounded-xl border p-3 shadow-sm hover:shadow-md transition-all duration-200 ${
                allSelected
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-700'
                  : isMulti
                    ? 'border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/20'
                    : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800'
              }`}>
                {/* Header — room, status, checkbox */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="text-lg font-extrabold text-gray-900 dark:text-slate-100 leading-none">{roomLabel}</span>
                    <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-full ${
                      isVacant ? 'bg-gray-200 text-gray-700 dark:bg-slate-600 dark:text-slate-200' : 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                    }`}>
                      {isVacant ? '⬜ Vacant' : '✅ Occupied'}
                    </span>
                    {isMulti && <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold">🏠 Multi</span>}
                  </div>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => toggleRowSelection(rowIds)}
                    className="w-4 h-4 text-primary rounded mt-1 shrink-0"
                  />
                </div>

                {/* Info — tidy label/value rows */}
                <div className="mt-2.5 space-y-1 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-500 dark:text-slate-400">Rent</span>
                    <span className="font-bold text-gray-900 dark:text-slate-100">
                      {displayRent ? `₹${Number(displayRent).toLocaleString('en-IN')}` : 'N/A'}
                      {isMulti && displayRent ? <span className="text-xs text-indigo-500 dark:text-indigo-400 ml-1 font-normal">(comb.)</span> : null}
                      {isMulti && (
                        <button onClick={() => toggleMultiExpand(key)} className="ml-2 text-[10px] bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 rounded hover:bg-indigo-200 dark:hover:bg-indigo-900 font-semibold align-middle">
                          {expanded ? 'Hide ▲' : 'Breakout ▼'}
                        </button>
                      )}
                    </span>
                  </div>
                  {isMulti && expanded && (
                    <div className="bg-white dark:bg-slate-900/60 border border-indigo-200 dark:border-indigo-800 rounded-lg p-2 space-y-1">
                      {rowRooms.map(r => (
                        <div key={r.id} className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-indigo-800 dark:text-indigo-300">Room {r.roomNumber}</span>
                          <span className="text-gray-600 dark:text-slate-400">{r.electricityMeterNo || '—'}</span>
                          <span className="font-bold text-gray-900 dark:text-slate-100">₹{getPerRoomRent(r).toLocaleString('en-IN')}</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-xs font-bold border-t border-indigo-200 dark:border-indigo-800 pt-1 mt-1">
                        <span className="text-indigo-700 dark:text-indigo-300">Total</span>
                        <span className="text-gray-900 dark:text-slate-100">₹{Number(displayRent || 0).toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-gray-500 dark:text-slate-400">Meter</span>
                    <span className="font-semibold text-gray-900 dark:text-slate-100 truncate">{meterLabel}</span>
                  </div>
                  {!isVacant && currentTenant && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-gray-500 dark:text-slate-400">Tenant</span>
                      <span className="font-semibold text-green-700 dark:text-green-400 truncate">👤 {currentTenant.name}</span>
                    </div>
                  )}
                  {isVacant && lastTenant && (
                    <p className="text-xs text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/30 rounded px-2 py-1">
                      Last: <span className="font-semibold">{lastTenant.name}</span>
                      {lastTenant.checkOutDate && <> · {fmtDate(lastTenant.checkOutDate)}</>}
                    </p>
                  )}
                  {isVacant && meterInfo?.reading != null && (
                    <p className="text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 rounded px-2 py-1">
                      Last Meter: <span className="font-semibold">{meterInfo.reading} units</span>
                    </p>
                  )}
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-gray-400 dark:text-slate-500">{formatLastUpdated(lastUpdated, checkInFallback)}</span>
                  <button
                    onClick={() => openStatusModal(primaryRoom)}
                    className={`py-1 px-3 rounded-lg text-xs font-semibold border transition ${
                      isVacant
                        ? 'border-green-400 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/40'
                        : 'border-orange-400 text-orange-700 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40'
                    }`}
                  >
                    {isVacant ? '✅ Mark Occupied' : '⬜ Mark Vacant'}
                  </button>
                </div>
              </div>
            );
            };
            return groups.map((g) => (
              <div key={g.id}>
                <div className={`mb-3 flex items-center gap-3 rounded-xl bg-gradient-to-r ${g.grad} px-4 py-2.5 text-white shadow-sm`}>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 text-lg">{g.icon}</span>
                  <p className="font-bold">{g.label}</p>
                  <span className="ml-auto text-xs font-semibold bg-white/20 rounded-full px-2 py-0.5">{g.rows.length} {g.rows.length === 1 ? 'room' : 'rooms'}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
                  {g.rows.map(renderCard)}
                </div>
              </div>
            ));
          })()}
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-slate-200 dark:bg-slate-700 border-b-2 border-slate-300 dark:border-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedRooms.size === filteredRooms.length && filteredRooms.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 text-primary rounded"
                  />
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Room</th>
                <th className="px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Status</th>
                <th className="px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Tenant / Last Tenant</th>
                <th className="px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Default Rent</th>
                <th className="px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Meter No</th>
                <th className="px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Last Meter</th>
                <th className="px-4 py-3 text-left text-[11px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {buildDisplayRows(filteredRooms).map(row => {
                const { key, isMulti, rooms: rowRooms, primaryRoom, currentTenant, lastTenant, meterInfo, displayRent, isVacant, roomLabel, meterLabel, lastUpdated, checkInFallback } = row;
                const rowIds = rowRooms.map(r => r.id);
                const allSelected = rowIds.every(id => selectedRooms.has(id));
                const expanded = expandedMultiRows.has(key);

                return (
                  <Fragment key={key}>
                    <tr className={`${allSelected ? 'bg-blue-50 dark:bg-blue-950/30' : isMulti ? 'bg-indigo-50 dark:bg-indigo-950/20' : ''} hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors`}>
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => toggleRowSelection(rowIds)}
                          className="w-4 h-4 text-primary rounded"
                        />
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center min-w-[2.25rem] px-2 py-1 rounded-lg text-xs font-bold bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 shadow-sm ring-1 ring-gray-200 dark:ring-slate-600">{roomLabel}</span>
                          {isMulti && <span className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold">🏠 Multi-room</span>}
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <button
                          onClick={() => openStatusModal(primaryRoom)}
                          title={isVacant ? 'Click to mark Occupied' : 'Click to mark Vacant'}
                          className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full cursor-pointer border transition hover:shadow ${
                            isVacant
                              ? 'bg-gray-100 text-gray-800 border-gray-300 hover:bg-green-50 dark:hover:bg-green-950/40 hover:text-green-800 dark:hover:text-green-400'
                              : 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700 hover:bg-orange-50 dark:hover:bg-orange-950/40 hover:text-orange-800 dark:hover:text-orange-400'
                          }`}
                        >
                          {isVacant ? '⬜ Vacant' : '✅ Occupied'}
                        </button>
                      </td>
                      <td className="px-4 py-4 text-sm text-gray-900">
                        {!isVacant && currentTenant
                          ? <span className="text-green-700 dark:text-green-400 font-medium">👤 {currentTenant.name}{isMulti ? <span className="ml-1 text-xs text-indigo-600 dark:text-indigo-400">· Multi-room</span> : null}</span>
                          : lastTenant
                            ? <span className="text-orange-600 dark:text-orange-400 text-xs">
                                {lastTenant.name}
                                {lastTenant.checkOutDate && <><br/><span className="text-gray-400">out: {fmtDate(lastTenant.checkOutDate)}</span></>}
                              </span>
                            : <span className="text-gray-400 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        <div>{displayRent ? `₹${Number(displayRent).toLocaleString('en-IN')}` : 'N/A'}</div>
                        {isMulti && displayRent && (
                          <button
                            onClick={() => toggleMultiExpand(key)}
                            className="text-xs bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded hover:bg-indigo-200 dark:hover:bg-indigo-900 font-semibold mt-1"
                          >
                            {expanded ? 'Hide ▲' : 'Breakout ▼'}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                        {meterLabel}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                        {meterInfo?.reading != null ? `${meterInfo.reading} units` : '—'}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                        {formatLastUpdated(lastUpdated, checkInFallback)}
                      </td>
                    </tr>
                    {isMulti && expanded && (
                      <tr className="bg-indigo-50 dark:bg-indigo-950/20">
                        <td colSpan={8} className="px-8 py-3">
                          <div className="border border-indigo-200 dark:border-indigo-800 rounded-lg overflow-hidden">
                            <table className="w-full text-xs">
                              <thead className="bg-indigo-100 dark:bg-indigo-900/40">
                                <tr>
                                  <th className="px-2 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">Room</th>
                                  <th className="px-2 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">Meter No</th>
                                  <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">Rent</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white dark:bg-slate-900/60">
                                {rowRooms.map(r => (
                                  <tr key={r.id} className="border-t border-indigo-100 dark:border-indigo-800/60">
                                    <td className="px-3 py-2 font-semibold text-indigo-800 dark:text-indigo-300">{r.roomNumber}</td>
                                    <td className="px-3 py-2 text-gray-600">{r.electricityMeterNo || '—'}</td>
                                    <td className="px-3 py-2 text-right font-bold text-gray-900">₹{getPerRoomRent(r).toLocaleString('en-IN')}</td>
                                  </tr>
                                ))}
                                <tr className="border-t-2 border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/30">
                                  <td className="px-3 py-2 font-bold text-indigo-700 dark:text-indigo-300" colSpan={2}>Total</td>
                                  <td className="px-3 py-2 text-right font-bold text-indigo-900 dark:text-indigo-200">₹{Number(displayRent || 0).toLocaleString('en-IN')}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {isMobileViewport && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-white/95 backdrop-blur border border-gray-200 rounded-full shadow-lg px-2 py-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFloorFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full ${floorFilter === 'all' ? 'bg-primary text-white' : 'text-gray-700'}`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFloorFilter('floor1')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full ${floorFilter === 'floor1' ? 'bg-primary text-white' : 'text-gray-700'}`}
          >
            Floor 1
          </button>
          <button
            type="button"
            onClick={() => setFloorFilter('floor2')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full ${floorFilter === 'floor2' ? 'bg-primary text-white' : 'text-gray-700'}`}
          >
            Floor 2
          </button>
        </div>
      )}

      {/* Modal: Occupied → Vacant (dues confirmation) */}
      {vacantModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="text-lg font-bold text-gray-800">Mark Room {vacantModal.roomNumber} Vacant</h3>
                <p className="text-sm text-gray-500">Please confirm all dues are cleared</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
                <p className="text-sm font-semibold text-amber-800 mb-2">Dues Clearance Confirmation</p>
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={vacantRentCleared}
                    onChange={e => setVacantRentCleared(e.target.checked)}
                    className="w-5 h-5 rounded text-green-600"
                  />
                  <span className="text-sm text-amber-900">✅ All <strong>rent dues</strong> have been collected / cleared</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={vacantElecCleared}
                    onChange={e => setVacantElecCleared(e.target.checked)}
                    className="w-5 h-5 rounded text-green-600"
                  />
                  <span className="text-sm text-amber-900">✅ All <strong>electricity dues</strong> have been collected / cleared</span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Remark (Optional)</label>
                <textarea
                  value={vacantRemark}
                  onChange={e => setVacantRemark(e.target.value)}
                  placeholder="e.g. Tenant left, all dues cleared..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary"
                  rows="2"
                  disabled={updating}
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
              <button
                onClick={closeVacantModal}
                disabled={updating}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleMarkVacant}
                disabled={updating || !vacantRentCleared || !vacantElecCleared}
                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition disabled:opacity-40"
              >
                {updating ? 'Saving...' : '⬜ Mark Vacant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Vacant → Occupied (assign tenant) */}
      {occupyModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-3">
              <span className="text-2xl">🏠</span>
              <div>
                <h3 className="text-lg font-bold text-gray-800">Mark Room {occupyModal.roomNumber} Occupied</h3>
                <p className="text-sm text-gray-500">Assign a tenant (or skip)</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assign Tenant</label>
                <select
                  value={occupyTenantId}
                  onChange={e => setOccupyTenantId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary"
                  disabled={updating}
                >
                  <option value="">-- Select tenant (optional) --</option>
                  {tenants
                    .filter(t => t.isActive)
                    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                    .map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name}{t.roomNumber ? ` (Room ${t.roomNumber})` : ''}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">Selecting a tenant will update their room number to {occupyModal.roomNumber}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Remark (Optional)</label>
                <textarea
                  value={occupyRemark}
                  onChange={e => setOccupyRemark(e.target.value)}
                  placeholder="e.g. New tenant moved in..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary"
                  rows="2"
                  disabled={updating}
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
              <button
                onClick={closeOccupyModal}
                disabled={updating}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleMarkOccupied}
                disabled={updating}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
              >
                {updating ? 'Saving...' : '✅ Mark Occupied'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Rooms;
