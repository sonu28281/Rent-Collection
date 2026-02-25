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
  const [selectedTenantHistory, setSelectedTenantHistory] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

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

  const handleViewHistory = async (tenant) => {
    setSelectedTenantHistory(tenant);
    setLoadingHistory(true);
    
    try {
      // Fetch payment history for this tenant
      const paymentsRef = collection(db, 'payments');
      const paymentsQuery = query(
        paymentsRef,
        where('tenantNameSnapshot', '==', tenant.name),
        orderBy('year', 'desc'),
        orderBy('month', 'desc')
      );
      
      const paymentsSnapshot = await getDocs(paymentsQuery);
      const payments = [];
      
      paymentsSnapshot.forEach((doc) => {
        payments.push({ id: doc.id, ...doc.data() });
      });
      
      setPaymentHistory(payments);
    } catch (err) {
      console.error('Error fetching payment history:', err);
      alert('Failed to load payment history');
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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filteredTenants.map(tenant => (
            <TenantCard
              key={tenant.id}
              tenant={tenant}
              onEdit={() => handleEditTenant(tenant)}
              onDelete={() => handleDeleteTenant(tenant.id, tenant.roomNumber)}
              onViewHistory={() => handleViewHistory(tenant)}
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
  const isActive = tenant.isActive;
  
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
  const copyCredentials = () => {
    const text = `Room: ${tenant.roomNumber}\nUsername: ${tenant.username}\nPassword: ${tenant.password}`;
    navigator.clipboard.writeText(text)
      .then(() => alert('✅ Credentials copied!\n\nShare these with the tenant.'))
      .catch(() => prompt('Copy these credentials:', text));
  };
  
  return (
    <div className={`card p-3 border-2 transition-all ${
      isActive 
        ? 'border-green-300 bg-green-50' 
        : 'border-gray-300 bg-gray-50'
    }`}>
      {/* Header - Name & Status */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h3 className="text-base font-bold text-gray-800 mb-1">
            {tenant.name}
          </h3>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              isActive
                ? 'bg-green-500 text-white'
                : 'bg-gray-500 text-white'
            }`}>
              {isActive ? '✅ Active' : '📋 Inactive'}
            </span>
            {tenant.roomNumber && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-500 text-white">
                🏠 {tenant.roomNumber}
              </span>
            )}
            {duration && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-500 text-white">
                🕐 {duration}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Compact Info Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
        <div className="flex justify-between">
          <span className="text-gray-600">📱</span>
          <span className="font-semibold text-gray-800">{tenant.phone || '-'}</span>
        </div>
        
        {tenant.currentRent && (
          <div className="flex justify-between">
            <span className="text-gray-600">💵</span>
            <span className="font-semibold text-gray-800">
              ₹{tenant.currentRent.toLocaleString('en-IN')}
            </span>
          </div>
        )}
        
        {tenant.checkInDate && (
          <div className="flex justify-between col-span-2">
            <span className="text-gray-600">📅 Check-in:</span>
            <span className="font-semibold text-gray-800">
              {new Date(tenant.checkInDate).toLocaleDateString('en-IN')}
            </span>
          </div>
        )}
      </div>

      {/* Login Credentials - Compact */}
      <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-2">
        <div className="text-[10px] font-bold text-blue-800 mb-1">🔐 PORTAL LOGIN</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-blue-600 text-[10px]">User:</span>
            <span className="font-mono font-bold text-blue-900">{tenant.username || tenant.roomNumber}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-blue-600 text-[10px]">Pass:</span>
            <span className="font-mono font-bold text-blue-900">{tenant.password || 'password'}</span>
          </div>
        </div>
      </div>

      {/* Action Buttons - Compact */}
      <div className="grid grid-cols-4 gap-1">
        <button 
          onClick={onViewHistory} 
          className="bg-purple-500 hover:bg-purple-600 text-white px-2 py-1.5 rounded font-semibold transition text-xs"
          title="View History"
        >
          📊
        </button>
        <button 
          onClick={copyCredentials} 
          className="bg-blue-500 hover:bg-blue-600 text-white px-2 py-1.5 rounded font-semibold transition text-xs"
          title="Copy Credentials"
        >
          📋
        </button>
        <button 
          onClick={onEdit} 
          className="btn-primary px-2 py-1.5 text-xs rounded"
          title="Edit Tenant"
        >
          ✏️
        </button>
        <button 
          onClick={onDelete} 
          className="btn-secondary px-2 py-1.5 text-xs rounded"
          title="Delete Tenant"
        >
          🗑️
        </button>
      </div>
    </div>
  );
};

export default Tenants;
