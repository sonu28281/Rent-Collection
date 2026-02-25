import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';

const TenantPortal = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState(null);
  const [room, setRoom] = useState(null);
  const [paymentRecords, setPaymentRecords] = useState([]);
  const [activeUPI, setActiveUPI] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (token) {
      fetchTenantData();
    }
  }, [token]);

  const fetchTenantData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Validate token and fetch tenant
      const tenantsRef = collection(db, 'tenants');
      const tenantQuery = query(tenantsRef, where('uniqueToken', '==', token));
      const tenantSnapshot = await getDocs(tenantQuery);

      if (tenantSnapshot.empty) {
        setError('Invalid access token. Please contact admin.');
        setLoading(false);
        return;
      }

      const tenantData = { id: tenantSnapshot.docs[0].id, ...tenantSnapshot.docs[0].data() };
      
      // Check if tenant is active
      if (!tenantData.isActive) {
        setError('Your account is inactive. Please contact admin.');
        setLoading(false);
        return;
      }

      setTenant(tenantData);

      // Fetch room details
      if (tenantData.roomNumber) {
        const roomsRef = collection(db, 'rooms');
        const roomQuery = query(roomsRef, where('roomNumber', '==', tenantData.roomNumber));
        const roomSnapshot = await getDocs(roomQuery);
        
        if (!roomSnapshot.empty) {
          setRoom({ id: roomSnapshot.docs[0].id, ...roomSnapshot.docs[0].data() });
        }
      }

      // Fetch payment records from payments collection
      const paymentsRef = collection(db, 'payments');
      const paymentsQuery = query(
        paymentsRef, 
        where('roomNumber', '==', tenantData.roomNumber),
        where('year', '>=', 2024), // Only show recent records
        orderBy('year', 'desc'),
        orderBy('month', 'desc'),
        limit(12) // Last 12 months
      );
      const paymentsSnapshot = await getDocs(paymentsQuery);
      
      const records = [];
      paymentsSnapshot.forEach((doc) => {
        records.push({ id: doc.id, ...doc.data() });
      });
      setPaymentRecords(records);

      // Fetch active UPI
      const upiRef = collection(db, 'bankAccounts');
      const upiQuery = query(upiRef, where('isActive', '==', true), limit(1));
      const upiSnapshot = await getDocs(upiQuery);
      
      if (!upiSnapshot.empty) {
        setActiveUPI({ id: upiSnapshot.docs[0].id, ...upiSnapshot.docs[0].data() });
      }

      setLoading(false);
    } catch (err) {
      console.error('Error fetching tenant data:', err);
      setError('Failed to load your information. Please try again later.');
      setLoading(false);
    }
  };

  const calculateTotalDues = () => {
    return paymentRecords
      .filter(record => record.status !== 'paid')
      .reduce((total, record) => {
        const rent = Number(record.rent) || 0;
        const electricity = Number(record.electricity) || 0;
        const paidAmount = Number(record.paidAmount) || 0;
        const totalAmount = rent + electricity;
        return total + (totalAmount - paidAmount);
      }, 0);
  };

  const getStatusBadge = (status) => {
    const badges = {
      paid: { bg: 'bg-green-100', text: 'text-green-800', label: '✅ Paid' },
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: '⏳ Pending' },
      overdue: { bg: 'bg-red-100', text: 'text-red-800', label: '⚠️ Overdue' }
    };
    
    const badge = badges[status] || badges.pending;
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
    );
  };

  const getMonthName = (monthNum) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[monthNum - 1] || monthNum;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600 text-lg">Loading your information...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
        <div className="card max-w-md w-full text-center bg-white">
          <div className="text-6xl mb-4">🔒</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Access Denied</h2>
          <p className="text-red-600 mb-4">{error}</p>
          <button 
            onClick={() => navigate('/')}
            className="btn-primary"
          >
            Go to Homepage
          </button>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-4">
        <div className="card max-w-md w-full text-center">
          <div className="text-6xl mb-4">❓</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">No Data Found</h2>
          <p className="text-gray-600">Unable to load tenant information.</p>
        </div>
      </div>
    );
  }

  const totalDues = calculateTotalDues();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50">
      {/* Header */}
      <div className="bg-white shadow-md">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Tenant Portal</h1>
              <p className="text-sm text-gray-600">Autoxweb Rent Management</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">Welcome,</p>
              <p className="font-semibold text-gray-800">{tenant.name}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* Tenant Info Card */}
        <div className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold mb-2">{tenant.name}</h2>
              <div className="space-y-1 text-blue-100">
                <p>📱 {tenant.phone}</p>
                {room && <p>🏠 Room {room.roomNumber} - Floor {room.floor}</p>}
                <p>📅 Check-in: {new Date(tenant.checkInDate).toLocaleDateString('en-IN')}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-blue-100 text-sm">Monthly Rent</p>
              <p className="text-3xl font-bold">₹{tenant.currentRent?.toLocaleString('en-IN')}</p>
            </div>
          </div>
        </div>

        {/* Dues Summary */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={`card ${totalDues > 0 ? 'bg-red-50 border-2 border-red-300' : 'bg-green-50 border-2 border-green-300'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm mb-1 ${totalDues > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  Total Pending Dues
                </p>
                <p className={`text-3xl font-bold ${totalDues > 0 ? 'text-red-700' : 'text-green-700'}`}>
                  ₹{totalDues.toLocaleString('en-IN')}
                </p>
              </div>
              <div className="text-5xl">
                {totalDues > 0 ? '⚠️' : '✅'}
              </div>
            </div>
          </div>

          <div className="card bg-blue-50 border-2 border-blue-300">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-600 mb-1">Security Deposit</p>
                <p className="text-3xl font-bold text-blue-700">
                  ₹{(tenant.securityDeposit || 0).toLocaleString('en-IN')}
                </p>
              </div>
              <div className="text-5xl">🔒</div>
            </div>
          </div>
        </div>

        {/* Meter Reading Card */}
        {room && (
          <div className="card bg-gradient-to-br from-purple-500 to-purple-600 text-white">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              ⚡ Electricity Meter
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white bg-opacity-20 rounded-lg p-3">
                <p className="text-purple-100 text-xs mb-1">Current Reading</p>
                <p className="text-2xl font-bold">{room.currentReading || 0}</p>
              </div>
              <div className="bg-white bg-opacity-20 rounded-lg p-3">
                <p className="text-purple-100 text-xs mb-1">Previous Reading</p>
                <p className="text-2xl font-bold">{room.previousReading || 0}</p>
              </div>
              <div className="bg-white bg-opacity-20 rounded-lg p-3">
                <p className="text-purple-100 text-xs mb-1">Units Used</p>
                <p className="text-2xl font-bold">{(room.currentReading || 0) - (room.previousReading || 0)}</p>
              </div>
              <div className="bg-white bg-opacity-20 rounded-lg p-3">
                <p className="text-purple-100 text-xs mb-1">Rate per Unit</p>
                <p className="text-2xl font-bold">₹{room.ratePerUnit || 0}</p>
              </div>
            </div>
            <p className="text-purple-100 text-sm mt-4">
              💡 Electricity charges are calculated based on units consumed
            </p>
          </div>
        )}

        {/* Active UPI for Payment */}
        {activeUPI && (
          <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
              💳 Pay Via UPI
            </h3>
            <div className="bg-white bg-opacity-20 rounded-lg p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-green-100 text-sm mb-1">UPI ID</p>
                  <p className="text-xl font-bold break-all">{activeUPI.upiId}</p>
                  {activeUPI.nickname && (
                    <p className="text-green-100 text-sm mt-1">({activeUPI.nickname})</p>
                  )}
                </div>
                {activeUPI.qrImageUrl && (
                  <div className="flex items-center justify-center">
                    <div className="bg-white p-3 rounded-lg">
                      <img 
                        src={activeUPI.qrImageUrl} 
                        alt="UPI QR Code" 
                        className="w-32 h-32"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <p className="text-green-100 text-sm mt-4">
              💡 Scan QR code or use UPI ID to make payment. Save the screenshot and contact admin.
            </p>
          </div>
        )}

        {/* Payment History */}
        <div className="card">
          <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
            📊 Payment History
          </h3>
          
          {paymentRecords.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <div className="text-5xl mb-2">📋</div>
              <p>No payment records yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {paymentRecords.map((record) => {
                const rent = Number(record.rent) || 0;
                const electricity = Number(record.electricity) || 0;
                const total = rent + electricity;
                const paid = Number(record.paidAmount) || 0;
                const balance = total - paid;
                const units = record.units || 0;
                
                return (
                  <div 
                    key={record.id}
                    className={`border rounded-lg p-4 transition hover:shadow-md ${
                      record.status === 'paid' ? 'bg-green-50 border-green-200' :
                      record.status === 'partial' ? 'bg-yellow-50 border-yellow-200' :
                      'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-bold text-gray-800">
                          {getMonthName(record.month)} {record.year}
                        </p>
                        {record.date && (
                          <p className="text-sm text-gray-600">
                            Date: {record.date}
                          </p>
                        )}
                      </div>
                      {getStatusBadge(record.status)}
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="text-gray-600">Rent:</span>
                        <span className="font-semibold ml-2">₹{rent.toLocaleString('en-IN')}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Units:</span>
                        <span className="font-semibold ml-2">{units}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Electricity:</span>
                        <span className="font-semibold ml-2">₹{electricity.toLocaleString('en-IN')}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">Paid:</span>
                        <span className="font-semibold ml-2">₹{paid.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="col-span-2 mt-2 pt-2 border-t border-gray-300">
                        <span className="text-gray-700 font-semibold">Total:</span>
                        <span className="font-bold text-lg ml-2">₹{total.toLocaleString('en-IN')}</span>
                      </div>
                      {balance > 0 && (
                        <div className="col-span-2">
                          <span className="text-red-600 font-semibold">Balance Due:</span>
                          <span className="font-bold text-lg ml-2 text-red-600">₹{balance.toLocaleString('en-IN')}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Contact Info */}
        <div className="card bg-gray-50 border border-gray-200 text-center">
          <p className="text-sm text-gray-600 mb-2">Need help or have questions?</p>
          <p className="text-gray-800 font-semibold">Contact Property Manager</p>
          <p className="text-sm text-gray-500 mt-2">
            🔒 This is your secure tenant portal. Do not share your access link.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TenantPortal;
