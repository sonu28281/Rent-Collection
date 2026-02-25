import { useState, useEffect } from 'react';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import TenantForm from './TenantForm';

const Tenants = () => {
  const [tenants, setTenants] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const [filter, setFilter] = useState('all'); // all, active, inactive

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

  const handleDeleteTenant = async (tenantId, roomNumber) => {
    if (!window.confirm('Are you sure you want to delete this tenant?')) {
      return;
    }

    try {
      // Delete tenant
      await deleteDoc(doc(db, 'tenants', tenantId));
      
      // Update room status to vacant if tenant had a room
      if (roomNumber) {
        const roomsRef = collection(db, 'rooms');
        const roomQuery = query(roomsRef, where('roomNumber', '==', roomNumber));
        const roomSnapshot = await getDocs(roomQuery);
        
        if (!roomSnapshot.empty) {
          const roomDoc = roomSnapshot.docs[0];
          await updateDoc(doc(db, 'rooms', roomDoc.id), {
            status: 'vacant'
          });
        }
      }
      
      fetchData();
      alert('Tenant deleted successfully');
    } catch (err) {
      console.error('Error deleting tenant:', err);
      alert('Failed to delete tenant. Please try again.');
    }
  };

  const handleCopyPortalLink = (token) => {
    const portalUrl = `${window.location.origin}/t/${token}`;
    navigator.clipboard.writeText(portalUrl).then(() => {
      alert('✅ Portal link copied to clipboard!\n\nShare this link with the tenant.');
    }).catch((err) => {
      console.error('Failed to copy:', err);
      prompt('Copy this link:', portalUrl);
    });
  };

  const handleSendWhatsApp = (phone, token, tenantName) => {
    if (!phone) {
      alert('⚠️ Phone number not available for this tenant.\n\nPlease add their phone number first.');
      return;
    }

    // Clean phone number (remove spaces, dashes, etc.)
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    
    // Add country code if not present (assuming India +91)
    const phoneWithCode = cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone;
    
    // Create portal URL
    const portalUrl = `${window.location.origin}/t/${token}`;
    
    // Create WhatsApp message
    const message = `Hello ${tenantName}! 👋\n\nYour tenant portal is ready! You can view your room details, meter readings, and payment history using this link:\n\n${portalUrl}\n\n🔐 This link is secure and only for you.\n\n- Autoxweb Rent Management`;
    
    // Encode message for URL
    const encodedMessage = encodeURIComponent(message);
    
    // Create WhatsApp URL
    const whatsappUrl = `https://wa.me/${phoneWithCode}?text=${encodedMessage}`;
    
    // Open WhatsApp in new tab
    window.open(whatsappUrl, '_blank');
  };

  const filteredTenants = tenants.filter(tenant => {
    if (filter === 'all') return true;
    if (filter === 'active') return tenant.isActive;
    if (filter === 'inactive') return !tenant.isActive;
    return true;
  });

  const stats = {
    total: tenants.length,
    active: tenants.filter(t => t.isActive).length,
    inactive: tenants.filter(t => !t.isActive).length
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
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredTenants.map(tenant => (
            <TenantCard
              key={tenant.id}
              tenant={tenant}
              onEdit={() => handleEditTenant(tenant)}
              onDelete={() => handleDeleteTenant(tenant.id, tenant.roomNumber)}
              onCopyPortalLink={() => handleCopyPortalLink(tenant.uniqueToken)}
              onSendWhatsApp={() => handleSendWhatsApp(tenant.phone, tenant.uniqueToken, tenant.name)}
            />
          ))}
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
    </div>
  );
};

const TenantCard = ({ tenant, onEdit, onDelete, onCopyPortalLink, onSendWhatsApp }) => {
  const isActive = tenant.isActive;
  
  return (
    <div className={`card border-2 transition-all ${
      isActive 
        ? 'border-green-300 bg-green-50' 
        : 'border-gray-300 bg-gray-50'
    }`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-bold text-gray-800 mb-1">
            {tenant.name}
          </h3>
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
              isActive
                ? 'bg-green-500 text-white'
                : 'bg-gray-500 text-white'
            }`}>
              {isActive ? '✅ Active' : '📋 Inactive'}
            </span>
            {tenant.roomNumber && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500 text-white">
                🏠 Room {tenant.roomNumber}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">📱 Phone:</span>
          <span className="font-semibold text-gray-800">{tenant.phone}</span>
        </div>
        
        {tenant.baseRent && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">💰 Base Rent:</span>
            <span className="font-semibold text-gray-800">
              ₹{tenant.baseRent.toLocaleString('en-IN')}
            </span>
          </div>
        )}
        
        {tenant.currentRent && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">💵 Current Rent:</span>
            <span className="font-semibold text-gray-800">
              ₹{tenant.currentRent.toLocaleString('en-IN')}
            </span>
          </div>
        )}
        
        {tenant.checkInDate && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">📅 Check-in:</span>
            <span className="font-semibold text-gray-800">
              {new Date(tenant.checkInDate).toLocaleDateString('en-IN')}
            </span>
          </div>
        )}
        
        {tenant.checkOutDate && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">📅 Check-out:</span>
            <span className="font-semibold text-gray-800">
              {new Date(tenant.checkOutDate).toLocaleDateString('en-IN')}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button onClick={onCopyPortalLink} className="btn-secondary flex-1 text-sm" title="Copy tenant portal link">
            🔗 Link
          </button>
          <button onClick={onSendWhatsApp} className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg font-semibold transition flex-1 text-sm" title="Send portal link via WhatsApp">
            📱 WhatsApp
          </button>
        </div>
        <div className="flex gap-2">
          <button onClick={onEdit} className="btn-primary flex-1 text-sm">
            ✏️ Edit
          </button>
          <button onClick={onDelete} className="btn-secondary flex-1 text-sm">
            🗑️ Delete
          </button>
        </div>
      </div>
    </div>
  );
};

export default Tenants;
