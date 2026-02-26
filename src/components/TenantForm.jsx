import { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, doc, query, where, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, auth } from '../firebase';

const TenantForm = ({ tenant, rooms, tenants, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    roomNumber: '',
    assignedRooms: [],
    checkInDate: '',
    checkOutDate: '',
    dueDate: 20,
    baseRent: '',
    currentRent: '',
    securityDeposit: '',
    annualIncreasePercentage: 10,
    customElectricityRate: '',
    preferredLanguage: 'en',
    isActive: true
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
  const normalizeName = (value) => String(value || '').trim().toLowerCase();

  useEffect(() => {
    if (tenant) {
      const tenantAssignedRooms = Array.isArray(tenant.assignedRooms) && tenant.assignedRooms.length > 0
        ? tenant.assignedRooms
        : (tenant.roomNumber !== undefined && tenant.roomNumber !== null && tenant.roomNumber !== '' ? [tenant.roomNumber] : []);

      // Editing existing tenant
      setFormData({
        name: tenant.name || '',
        phone: tenant.phone || '',
        roomNumber: tenant.roomNumber || '',
        assignedRooms: tenantAssignedRooms.map((room) => String(room)),
        checkInDate: tenant.checkInDate ? tenant.checkInDate.split('T')[0] : '',
        checkOutDate: tenant.checkOutDate ? tenant.checkOutDate.split('T')[0] : '',
        dueDate: tenant.dueDate || 20,
        baseRent: tenant.baseRent || '',
        currentRent: tenant.currentRent || '',
        securityDeposit: tenant.securityDeposit || '',
        annualIncreasePercentage: tenant.annualIncreasePercentage || 10,
        customElectricityRate: tenant.customElectricityRate || '',
        preferredLanguage: tenant.preferredLanguage || 'en',
        isActive: tenant.isActive !== undefined ? tenant.isActive : true
      });
    }
  }, [tenant]);

  const getTenantAssignedRooms = (tenantRecord) => {
    if (Array.isArray(tenantRecord?.assignedRooms) && tenantRecord.assignedRooms.length > 0) {
      return tenantRecord.assignedRooms.map((room) => String(room));
    }
    if (tenantRecord?.roomNumber !== undefined && tenantRecord?.roomNumber !== null && tenantRecord?.roomNumber !== '') {
      return [String(tenantRecord.roomNumber)];
    }
    return [];
  };

  const isSamePerson = (tenantRecord, draftName, draftPhone) => {
    const tenantPhone = normalizePhone(tenantRecord?.phone);
    const inputPhone = normalizePhone(draftPhone);
    if (tenantPhone && inputPhone && tenantPhone === inputPhone) {
      return true;
    }

    const tenantName = normalizeName(tenantRecord?.name);
    const inputName = normalizeName(draftName);
    return Boolean(tenantName && inputName && tenantName === inputName);
  };

  const getConflictingTenantForRoom = (roomNumber) => {
    return tenants.find((tenantRecord) => {
      if (!tenantRecord?.isActive) return false;
      if (tenant && tenantRecord.id === tenant.id) return false;

      const assignedRooms = getTenantAssignedRooms(tenantRecord);
      const hasRoom = assignedRooms.includes(String(roomNumber));
      if (!hasRoom) return false;

      return !isSamePerson(tenantRecord, formData.name, formData.phone);
    }) || null;
  };

  const generateUniqueToken = () => {
    // Generate a 48-character hex token
    const array = new Uint8Array(24);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  };

  const calculateNextIncreaseDate = (checkInDate) => {
    if (!checkInDate) return null;
    const date = new Date(checkInDate);
    date.setFullYear(date.getFullYear() + 1);
    return date.toISOString();
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!formData.phone.trim()) {
      newErrors.phone = 'Phone is required';
    } else if (!/^[0-9]{10}$/.test(formData.phone.replace(/\s/g, ''))) {
      newErrors.phone = 'Phone must be 10 digits';
    } else {
      const inputPhone = normalizePhone(formData.phone);
      const duplicatePhoneTenant = tenants.find((tenantRecord) => {
        if (!tenantRecord?.isActive) return false;
        if (tenant && tenantRecord.id === tenant.id) return false;
        return normalizePhone(tenantRecord.phone) === inputPhone;
      });

      if (duplicatePhoneTenant && !tenant) {
        newErrors.phone = `This phone is already active under ${duplicatePhoneTenant.name}. Edit existing tenant or use Merge Duplicate Tenants.`;
      }
    }

    const selectedRooms = (formData.assignedRooms || []).map((room) => String(room));

    if (selectedRooms.length === 0) {
      newErrors.assignedRooms = 'At least one room must be selected';
    } else {
      // Check if any selected room is already assigned to another active tenant
      const isRoomOccupied = selectedRooms.some((selectedRoom) => Boolean(getConflictingTenantForRoom(selectedRoom)));
      
      if (isRoomOccupied) {
        newErrors.assignedRooms = 'One or more selected rooms are already occupied by another active tenant';
      }
    }

    if (!formData.checkInDate) {
      newErrors.checkInDate = 'Check-in date is required';
    }

    if (!formData.baseRent || parseFloat(formData.baseRent) <= 0) {
      newErrors.baseRent = 'Base rent must be greater than 0';
    }

    if (!formData.currentRent || parseFloat(formData.currentRent) <= 0) {
      newErrors.currentRent = 'Current rent must be greater than 0';
    }

    if (formData.checkOutDate && formData.checkInDate) {
      if (new Date(formData.checkOutDate) <= new Date(formData.checkInDate)) {
        newErrors.checkOutDate = 'Check-out date must be after check-in date';
      }
    }

    const dueDateValue = Number.parseInt(formData.dueDate, 10);
    if (!Number.isFinite(dueDateValue) || dueDateValue < 1 || dueDateValue > 31) {
      newErrors.dueDate = 'Due date must be between 1 and 31';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: '' }));
    }
  };

  const toggleAssignedRoom = (roomNumber) => {
    const roomAsString = String(roomNumber);
    const conflictingTenant = getConflictingTenantForRoom(roomAsString);
    if (conflictingTenant) {
      return;
    }

    const currentSelection = formData.assignedRooms || [];
    const nextSelection = currentSelection.includes(roomAsString)
      ? currentSelection.filter((room) => room !== roomAsString)
      : [...currentSelection, roomAsString];

    const sortedSelection = [...new Set(nextSelection)]
      .sort((a, b) => Number(a) - Number(b));

    setFormData((prev) => ({
      ...prev,
      assignedRooms: sortedSelection,
      roomNumber: sortedSelection[0] || ''
    }));

    if (errors.assignedRooms) {
      setErrors((prev) => ({ ...prev, assignedRooms: '' }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const normalizedAssignedRooms = [...new Set((formData.assignedRooms || []).map((room) => String(room)))]
        .sort((a, b) => Number(a) - Number(b));

      const primaryRoomNumber = normalizedAssignedRooms[0] || String(formData.roomNumber || '');

      const tenantData = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        roomNumber: primaryRoomNumber,
        assignedRooms: normalizedAssignedRooms,
        checkInDate: new Date(formData.checkInDate).toISOString(),
        checkOutDate: formData.checkOutDate ? new Date(formData.checkOutDate).toISOString() : null,
        dueDate: Number.parseInt(formData.dueDate, 10),
        isActive: formData.isActive,
        baseRent: parseFloat(formData.baseRent),
        currentRent: parseFloat(formData.currentRent),
        securityDeposit: formData.securityDeposit ? parseFloat(formData.securityDeposit) : 0,
        annualIncreasePercentage: parseFloat(formData.annualIncreasePercentage),
        nextIncreaseDate: calculateNextIncreaseDate(formData.checkInDate),
        customElectricityRate: formData.customElectricityRate ? parseFloat(formData.customElectricityRate) : null,
        preferredLanguage: formData.preferredLanguage
      };

      if (tenant) {
        const oldName = (tenant.name || '').trim();
        const newName = formData.name.trim();
        const oldAssignedRooms = getTenantAssignedRooms(tenant);

        // Update existing tenant
        // Generate uniqueToken if it doesn't exist (for older tenants)
        if (!tenant.uniqueToken) {
          tenantData.uniqueToken = generateUniqueToken();
        }
        
        await updateDoc(doc(db, 'tenants', tenant.id), tenantData);

        // Auto-clean duplicate same-person tenant entries (remove overlapping rooms)
        await reconcileDuplicateAssignments(normalizedAssignedRooms, tenant.id, formData.name, formData.phone);
        
        // Update room status for all assigned rooms
        await updateRoomStatusForAssignments(normalizedAssignedRooms, formData.isActive, {
          oldAssignedRooms,
          tenantId: tenant.id
        });

        if (oldName && newName && oldName !== newName) {
          await syncTenantNameAcrossCollections({
            tenantId: tenant.id,
            oldName,
            newName,
            oldRoomNumber: oldAssignedRooms[0] || tenant.roomNumber,
            newRoomNumber: primaryRoomNumber
          });
        }
        
        alert('Tenant updated successfully!');
      } else {
        // Create new tenant
        tenantData.uniqueToken = generateUniqueToken();
        tenantData.createdAt = new Date().toISOString();
        tenantData.agreementUrl = null;
        tenantData.kycAadharUrl = null;
        tenantData.kycPanUrl = null;
        
        const newTenantRef = await addDoc(collection(db, 'tenants'), tenantData);

        // Auto-clean duplicate same-person tenant entries (remove overlapping rooms)
        await reconcileDuplicateAssignments(normalizedAssignedRooms, newTenantRef.id, formData.name, formData.phone);
        
        // Update room status for all assigned rooms
        await updateRoomStatusForAssignments(normalizedAssignedRooms, formData.isActive, {
          oldAssignedRooms: [],
          tenantId: newTenantRef.id
        });
        
        alert('Tenant added successfully!');
      }

      onSuccess();
    } catch (error) {
      console.error('Error saving tenant:', error);
      alert('Failed to save tenant. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const reconcileDuplicateAssignments = async (newAssignedRooms, currentTenantId, draftName, draftPhone) => {
    const roomsSet = new Set((newAssignedRooms || []).map((room) => String(room)));
    if (roomsSet.size === 0) return;

    const updatePromises = tenants
      .filter((tenantRecord) => {
        if (!tenantRecord?.isActive) return false;
        if (tenantRecord.id === currentTenantId) return false;
        if (!isSamePerson(tenantRecord, draftName, draftPhone)) return false;

        const assignedRooms = getTenantAssignedRooms(tenantRecord);
        return assignedRooms.some((room) => roomsSet.has(String(room)));
      })
      .map(async (tenantRecord) => {
        const assignedRooms = getTenantAssignedRooms(tenantRecord);
        const remainingRooms = assignedRooms.filter((room) => !roomsSet.has(String(room)));

        await updateDoc(doc(db, 'tenants', tenantRecord.id), {
          assignedRooms: remainingRooms,
          roomNumber: remainingRooms[0] || '',
          isActive: remainingRooms.length > 0 ? tenantRecord.isActive : false,
          updatedAt: new Date().toISOString()
        });
      });

    await Promise.all(updatePromises);
  };

  const syncTenantNameAcrossCollections = async ({ tenantId, oldName, newName, oldRoomNumber, newRoomNumber }) => {
    const roomCandidates = [oldRoomNumber, newRoomNumber]
      .filter((value) => value !== undefined && value !== null && value !== '');

    const matchesRoom = (recordRoom) => {
      if (!roomCandidates.length) return true;
      return roomCandidates.some((room) => String(room) === String(recordRoom));
    };

    const syncConfig = [
      {
        collectionName: 'payments',
        nameFields: ['tenantName', 'tenantNameSnapshot'],
        includeTenantId: true,
      },
      {
        collectionName: 'paymentSubmissions',
        nameFields: ['tenantName'],
        includeTenantId: true,
      },
      {
        collectionName: 'electricityReadings',
        nameFields: ['tenantName'],
        includeTenantId: true,
      }
    ];

    for (const config of syncConfig) {
      try {
        const docsToUpdate = new Map();

        if (config.includeTenantId && tenantId) {
          const byTenantId = await getDocs(
            query(collection(db, config.collectionName), where('tenantId', '==', tenantId))
          );
          byTenantId.docs.forEach((snapshotDoc) => {
            docsToUpdate.set(snapshotDoc.id, snapshotDoc);
          });
        }

        for (const fieldName of config.nameFields) {
          const byOldName = await getDocs(
            query(collection(db, config.collectionName), where(fieldName, '==', oldName))
          );

          byOldName.docs.forEach((snapshotDoc) => {
            const data = snapshotDoc.data();
            if (data.tenantId && tenantId && data.tenantId !== tenantId) return;
            if (!data.tenantId && !matchesRoom(data.roomNumber)) return;
            docsToUpdate.set(snapshotDoc.id, snapshotDoc);
          });
        }

        if (docsToUpdate.size === 0) continue;

        const batch = writeBatch(db);
        docsToUpdate.forEach((snapshotDoc) => {
          const updatePayload = {
            tenantId,
            updatedAt: new Date().toISOString()
          };

          config.nameFields.forEach((fieldName) => {
            updatePayload[fieldName] = newName;
          });

          batch.update(snapshotDoc.ref, updatePayload);
        });

        await batch.commit();
      } catch (syncError) {
        console.error(`Error syncing ${config.collectionName} tenant rename:`, syncError);
      }
    }
  };

  const updateRoomStatusForAssignments = async (assignedRooms, isOccupied, options = {}) => {
    try {
      const user = auth.currentUser;
      const roomsRef = collection(db, 'rooms');

      const normalizeRoomList = (roomsList) => [...new Set((roomsList || [])
        .filter((room) => room !== undefined && room !== null && room !== '')
        .map((room) => String(room))
      )];

      const targetRooms = normalizeRoomList(assignedRooms);
      const oldRooms = normalizeRoomList(options.oldAssignedRooms);
      const roomsToVacate = oldRooms.filter((room) => !targetRooms.includes(room));
      const roomsToAssign = targetRooms;

      const updateRoomByNumber = async (roomNumber, status, remark) => {
        const asNumber = Number.parseInt(roomNumber, 10);
        const queryCandidates = [
          query(roomsRef, where('roomNumber', '==', roomNumber))
        ];

        if (Number.isFinite(asNumber)) {
          queryCandidates.unshift(query(roomsRef, where('roomNumber', '==', asNumber)));
        }

        let roomSnapshot = null;
        for (const roomQuery of queryCandidates) {
          const snapshot = await getDocs(roomQuery);
          if (!snapshot.empty) {
            roomSnapshot = snapshot;
            break;
          }
        }

        if (!roomSnapshot || roomSnapshot.empty) {
          return;
        }

        const roomDoc = roomSnapshot.docs[0];
        const oldStatus = roomDoc.data().status || 'vacant';

        await updateDoc(doc(db, 'rooms', roomDoc.id), {
          status,
          lastStatusUpdatedAt: serverTimestamp(),
          lastStatusUpdatedBy: user?.uid || 'system',
          currentTenantId: status === 'filled' && isOccupied ? (options.tenantId || null) : null
        });

        await addDoc(collection(db, 'roomStatusLogs'), {
          roomId: roomDoc.id,
          roomNumber,
          oldStatus,
          newStatus: status,
          changedBy: user?.uid || 'system',
          changedByEmail: user?.email || 'system',
          changedAt: serverTimestamp(),
          remark
        });
      };

      for (const roomNumber of roomsToAssign) {
        await updateRoomByNumber(roomNumber, isOccupied ? 'filled' : 'vacant', isOccupied ? 'Tenant assigned (multi-room)' : 'Tenant removed/checkout');
      }

      for (const roomNumber of roomsToVacate) {
        await updateRoomByNumber(roomNumber, 'vacant', 'Tenant moved to different room');
      }
    } catch (error) {
      console.error('Error updating room status:', error);
    }
  };

  const availableRooms = rooms.filter(room => {
    // Show vacant rooms or currently assigned rooms (when editing)
    const roomString = String(room.roomNumber);
    const selectedRooms = (formData.assignedRooms || []).map((value) => String(value));
    return room.status === 'vacant' || selectedRooms.includes(roomString);
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-800">
            {tenant ? '✏️ Edit Tenant' : '➕ Add New Tenant'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition"
            disabled={loading}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Basic Information</h3>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Full Name *
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className={`input-field ${errors.name ? 'border-red-500' : ''}`}
                placeholder="Enter tenant name"
                disabled={loading}
              />
              {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Phone Number *
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                className={`input-field ${errors.phone ? 'border-red-500' : ''}`}
                placeholder="10-digit phone number"
                disabled={loading}
              />
              {errors.phone && <p className="text-red-500 text-sm mt-1">{errors.phone}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Assigned Rooms *
              </label>
              <div className={`border rounded-lg p-3 max-h-52 overflow-y-auto ${errors.assignedRooms ? 'border-red-500' : 'border-gray-300'}`}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {rooms
                    .slice()
                    .sort((a, b) => Number(a.roomNumber) - Number(b.roomNumber))
                    .map((room) => {
                    const roomValue = String(room.roomNumber);
                    const checked = (formData.assignedRooms || []).includes(roomValue);
                    const conflictingTenant = getConflictingTenantForRoom(roomValue);
                    const isDisabled = Boolean(conflictingTenant) && !checked;

                    return (
                      <label key={room.id} className={`flex items-center gap-2 text-sm ${isDisabled ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAssignedRoom(roomValue)}
                          disabled={loading || isDisabled}
                          className="w-4 h-4 text-primary rounded"
                        />
                        <span>
                          Room {room.roomNumber} - Floor {room.floor}
                          {conflictingTenant
                            ? ` (Assigned: ${conflictingTenant.name})`
                            : ((room.status || 'vacant') === 'vacant' ? ' (Vacant)' : ' (Assigned)')}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Selected: {(formData.assignedRooms || []).length > 0 ? (formData.assignedRooms || []).join(', ') : 'None'}
              </p>
              {errors.assignedRooms && <p className="text-red-500 text-sm mt-1">{errors.assignedRooms}</p>}
            </div>
          </div>

          {/* Dates */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Dates</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Check-in Date *
                </label>
                <input
                  type="date"
                  name="checkInDate"
                  value={formData.checkInDate}
                  onChange={handleChange}
                  className={`input-field ${errors.checkInDate ? 'border-red-500' : ''}`}
                  disabled={loading}
                />
                {errors.checkInDate && <p className="text-red-500 text-sm mt-1">{errors.checkInDate}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Check-out Date (Optional)
                </label>
                <input
                  type="date"
                  name="checkOutDate"
                  value={formData.checkOutDate}
                  onChange={handleChange}
                  className={`input-field ${errors.checkOutDate ? 'border-red-500' : ''}`}
                  disabled={loading}
                />
                {errors.checkOutDate && <p className="text-red-500 text-sm mt-1">{errors.checkOutDate}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Monthly Due Date
                </label>
                <input
                  type="number"
                  name="dueDate"
                  value={formData.dueDate}
                  onChange={handleChange}
                  className={`input-field ${errors.dueDate ? 'border-red-500' : ''}`}
                  min="1"
                  max="31"
                  placeholder="20"
                  disabled={loading}
                />
                {errors.dueDate && <p className="text-red-500 text-sm mt-1">{errors.dueDate}</p>}
              </div>
            </div>
          </div>

          {/* Financial Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Financial Information</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Base Rent (₹) *
                </label>
                <input
                  type="number"
                  name="baseRent"
                  value={formData.baseRent}
                  onChange={handleChange}
                  className={`input-field ${errors.baseRent ? 'border-red-500' : ''}`}
                  placeholder="5000"
                  min="0"
                  step="100"
                  disabled={loading}
                />
                {errors.baseRent && <p className="text-red-500 text-sm mt-1">{errors.baseRent}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Current Rent (₹) *
                </label>
                <input
                  type="number"
                  name="currentRent"
                  value={formData.currentRent}
                  onChange={handleChange}
                  className={`input-field ${errors.currentRent ? 'border-red-500' : ''}`}
                  placeholder="5000"
                  min="0"
                  step="100"
                  disabled={loading}
                />
                {errors.currentRent && <p className="text-red-500 text-sm mt-1">{errors.currentRent}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Security Deposit (₹)
                </label>
                <input
                  type="number"
                  name="securityDeposit"
                  value={formData.securityDeposit}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="10000"
                  min="0"
                  step="100"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Annual Increase (%)
                </label>
                <input
                  type="number"
                  name="annualIncreasePercentage"
                  value={formData.annualIncreasePercentage}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="10"
                  min="0"
                  max="100"
                  step="0.1"
                  disabled={loading}
                />
              </div>
            </div>
          </div>

          {/* Additional Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">Additional Settings</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Custom Electricity Rate (₹/unit)
                </label>
                <input
                  type="number"
                  name="customElectricityRate"
                  value={formData.customElectricityRate}
                  onChange={handleChange}
                  className="input-field"
                  placeholder="Leave empty to use default"
                  min="0"
                  step="0.1"
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Preferred Language
                </label>
                <select
                  name="preferredLanguage"
                  value={formData.preferredLanguage}
                  onChange={handleChange}
                  className="input-field"
                  disabled={loading}
                >
                  <option value="en">English</option>
                  <option value="hi">Hindi</option>
                </select>
              </div>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                name="isActive"
                checked={formData.isActive}
                onChange={handleChange}
                className="w-4 h-4 text-primary rounded focus:ring-primary"
                disabled={loading}
              />
              <label className="ml-2 text-sm font-medium text-gray-700">
                Active Tenant
              </label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary flex-1"
              disabled={loading}
            >
              {loading ? 'Saving...' : (tenant ? 'Update Tenant' : 'Add Tenant')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TenantForm;
