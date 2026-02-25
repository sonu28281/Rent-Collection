import { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, doc, query, where, getDocs, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';

const TenantForm = ({ tenant, rooms, tenants, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    roomNumber: '',
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

  useEffect(() => {
    if (tenant) {
      // Editing existing tenant
      setFormData({
        name: tenant.name || '',
        phone: tenant.phone || '',
        roomNumber: tenant.roomNumber || '',
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
    }

    if (!formData.roomNumber) {
      newErrors.roomNumber = 'Room selection is required';
    } else {
      // Check if room is already assigned to another active tenant
      const isRoomOccupied = tenants.some(
        t => t.roomNumber === formData.roomNumber && 
        t.isActive && 
        (!tenant || t.id !== tenant.id)
      );
      
      if (isRoomOccupied) {
        newErrors.roomNumber = 'This room is already occupied by another tenant';
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

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);

    try {
      const tenantData = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        roomNumber: formData.roomNumber,
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
        // Update existing tenant
        // Generate uniqueToken if it doesn't exist (for older tenants)
        if (!tenant.uniqueToken) {
          tenantData.uniqueToken = generateUniqueToken();
        }
        
        await updateDoc(doc(db, 'tenants', tenant.id), tenantData);
        
        // Update room status (handle room change and active status change)
        const oldRoomNumber = tenant.roomNumber;
        const roomChanged = oldRoomNumber !== formData.roomNumber;
        
        if (roomChanged) {
          // Room changed: update both old and new room
          await updateRoomStatus(formData.roomNumber, formData.isActive, oldRoomNumber);
        } else {
          // Same room: update status based on isActive
          await updateRoomStatus(formData.roomNumber, formData.isActive);
        }
        
        alert('Tenant updated successfully!');
      } else {
        // Create new tenant
        tenantData.uniqueToken = generateUniqueToken();
        tenantData.createdAt = new Date().toISOString();
        tenantData.agreementUrl = null;
        tenantData.kycAadharUrl = null;
        tenantData.kycPanUrl = null;
        
        await addDoc(collection(db, 'tenants'), tenantData);
        
        // Update room status
        await updateRoomStatus(formData.roomNumber, formData.isActive);
        
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

  const updateRoomStatus = async (roomNumber, isOccupied, oldRoomNumber = null) => {
    try {
      const user = auth.currentUser;
      const roomsRef = collection(db, 'rooms');
      
      // Update new room status to filled
      if (roomNumber) {
        const roomQuery = query(roomsRef, where('roomNumber', '==', roomNumber));
        const roomSnapshot = await getDocs(roomQuery);
        
        if (!roomSnapshot.empty) {
          const roomDoc = roomSnapshot.docs[0];
          const oldStatus = roomDoc.data().status || 'vacant';
          const newStatus = isOccupied ? 'filled' : 'vacant';
          
          await updateDoc(doc(db, 'rooms', roomDoc.id), {
            status: newStatus,
            lastStatusUpdatedAt: serverTimestamp(),
            lastStatusUpdatedBy: user?.uid || 'system',
            ...(isOccupied ? { currentTenantId: tenant?.id || null } : { currentTenantId: null })
          });

          // Log status change
          await addDoc(collection(db, 'roomStatusLogs'), {
            roomId: roomDoc.id,
            roomNumber: roomNumber,
            oldStatus,
            newStatus,
            changedBy: user?.uid || 'system',
            changedByEmail: user?.email || 'system',
            changedAt: serverTimestamp(),
            remark: isOccupied ? 'Tenant assigned' : 'Tenant removed/checkout'
          });
        }
      }

      // Update old room status to vacant if room was changed
      if (oldRoomNumber && oldRoomNumber !== roomNumber) {
        const oldRoomQuery = query(roomsRef, where('roomNumber', '==', oldRoomNumber));
        const oldRoomSnapshot = await getDocs(oldRoomQuery);
        
        if (!oldRoomSnapshot.empty) {
          const oldRoomDoc = oldRoomSnapshot.docs[0];
          const oldStatus = oldRoomDoc.data().status || 'filled';
          
          await updateDoc(doc(db, 'rooms', oldRoomDoc.id), {
            status: 'vacant',
            lastStatusUpdatedAt: serverTimestamp(),
            lastStatusUpdatedBy: user?.uid || 'system',
            currentTenantId: null
          });

          // Log status change
          await addDoc(collection(db, 'roomStatusLogs'), {
            roomId: oldRoomDoc.id,
            roomNumber: oldRoomNumber,
            oldStatus,
            newStatus: 'vacant',
            changedBy: user?.uid || 'system',
            changedByEmail: user?.email || 'system',
            changedAt: serverTimestamp(),
            remark: 'Tenant moved to different room'
          });
        }
      }
    } catch (error) {
      console.error('Error updating room status:', error);
    }
  };

  const availableRooms = rooms.filter(room => {
    // Show vacant rooms or the current tenant's room
    return room.status === 'vacant' || (tenant && room.roomNumber === tenant.roomNumber);
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
                Room Number *
              </label>
              <select
                name="roomNumber"
                value={formData.roomNumber}
                onChange={handleChange}
                className={`input-field ${errors.roomNumber ? 'border-red-500' : ''}`}
                disabled={loading}
              >
                <option value="">Select a room</option>
                {availableRooms.map(room => (
                  <option key={room.id} value={room.roomNumber}>
                    Room {room.roomNumber} - Floor {room.floor} 
                    {(room.status || 'vacant') === 'vacant' ? ' (Vacant)' : ' (Currently Assigned)'}
                  </option>
                ))}
              </select>
              {errors.roomNumber && <p className="text-red-500 text-sm mt-1">{errors.roomNumber}</p>}
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
