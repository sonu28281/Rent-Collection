import { useState } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Tenant Portal - Username/Password Login
 * 
 * Login:
 * - Username = Room Number (e.g., "101")
 * - Password = Set during setup (default: "password")
 */
const TenantPortal = () => {
  // Login state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Tenant data state
  const [tenant, setTenant] = useState(null);
  const [room, setRoom] = useState(null);
  const [paymentRecords, setPaymentRecords] = useState([]);
  const [activeUPI, setActiveUPI] = useState(null);
  const [loading, setLoading] = useState(false);

  // Handle login
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError('');

    try {
      // Query for tenant with matching username and password
      const tenantsRef = collection(db, 'tenants');
      const loginQuery = query(
        tenantsRef,
        where('username', '==', username.trim()),
        where('password', '==', password),
        where('isActive', '==', true)
      );
      
      const snapshot = await getDocs(loginQuery);

      if (snapshot.empty) {
        setLoginError('Invalid username or password. Please check and try again.');
        setLoggingIn(false);
        return;
      }

      const tenantData = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
      setTenant(tenantData);
      setIsLoggedIn(true);

      // Fetch tenant's data
      await fetchTenantData(tenantData);
    } catch (error) {
      console.error('Login error:', error);
      setLoginError('Login failed. Please try again.');
    } finally {
      setLoggingIn(false);
    }
  };

  // Fetch tenant data after login
  const fetchTenantData = async (tenantData) => {
    setLoading(true);

    try {
      // Fetch room details
      const roomsRef = collection(db, 'rooms');
      const roomQuery = query(roomsRef, where('roomNumber', '==', tenantData.roomNumber));
      const roomSnapshot = await getDocs(roomQuery);
      
      if (!roomSnapshot.empty) {
        setRoom({ id: roomSnapshot.docs[0].id, ...roomSnapshot.docs[0].data() });
      }

      // Fetch payment records
      const paymentsRef = collection(db, 'payments');
      const paymentsQuery = query(
        paymentsRef, 
        where('roomNumber', '==', tenantData.roomNumber),
        where('year', '>=', 2024),
        orderBy('year', 'desc'),
        orderBy('month', 'desc'),
        limit(12)
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
    } catch (error) {
      console.error('Error loading tenant data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Handle logout
  const handleLogout = () => {
    setIsLoggedIn(false);
    setTenant(null);
    setRoom(null);
    setPaymentRecords([]);
    setActiveUPI(null);
    setUsername('');
    setPassword('');
  };

  // Get status badge
  const getStatusBadge = (status) => {
    const badges = {
      paid: { text: 'Paid', class: 'bg-green-100 text-green-800' },
      pending: { text: 'Pending', class: 'bg-yellow-100 text-yellow-800' },
      overdue: { text: 'Overdue', class: 'bg-red-100 text-red-800' }
    };
    const badge = badges[status] || { text: status, class: 'bg-gray-100 text-gray-800' };
    return <span className={`px-2 py-1 rounded-full text-xs font-semibold ${badge.class}`}>{badge.text}</span>;
  };

  // Get month name
  const getMonthName = (monthNum) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[monthNum - 1] || monthNum;
  };

  // ============ LOGIN SCREEN ============
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          {/* Login Card */}
          <div className="bg-white rounded-2xl shadow-xl p-8">
            {/* Logo/Header */}
            <div className="text-center mb-8">
              <div className="text-5xl mb-3">🏠</div>
              <h1 className="text-3xl font-bold text-gray-800 mb-2">Tenant Portal</h1>
              <p className="text-gray-600">Login to view your records</p>
            </div>

            {/* Login Form */}
            <form onSubmit={handleLogin} className="space-y-5">
              {/* Username */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Room Number
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your room number (e.g., 101)"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                  autoFocus
                />
              </div>

              {/* Password */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              {/* Error Message */}
              {loginError && (
                <div className="bg-red-50 border border-red-300 rounded-lg p-3">
                  <p className="text-sm text-red-700">{loginError}</p>
                </div>
              )}

              {/* Login Button */}
              <button
                type="submit"
                disabled={loggingIn}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loggingIn ? '⏳ Logging in...' : '🔐 Login'}
              </button>
            </form>

            {/* Help Text */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-xs text-gray-500 text-center">
                Your room number is your username. Contact property manager if you forgot your password.
              </p>
            </div>
          </div>

          {/* Additional Info */}
          <div className="mt-4 text-center">
            <p className="text-sm text-gray-600">
              First time logging in? Default password is: <strong>password</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ============ MAIN DASHBOARD (After Login) ============
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🏠</span>
            <div>
              <h1 className="text-xl font-bold text-gray-800">Tenant Portal</h1>
              <p className="text-sm text-gray-600">Room {tenant?.roomNumber} - {tenant?.name}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors text-sm"
          >
            🚪 Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading your data...</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Room Info Card */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">📍 Your Room</h2>
              <div className="grid md:grid-cols-3 gap-4">
                <div className="bg-blue-50 rounded-lg p-4">
                  <p className="text-sm text-blue-700 mb-1">Room Number</p>
                  <p className="text-2xl font-bold text-blue-900">{room?.roomNumber || tenant?.roomNumber}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4">
                  <p className="text-sm text-green-700 mb-1">Monthly Rent</p>
                  <p className="text-2xl font-bold text-green-900">₹{tenant?.currentRent || room?.rent || 0}</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-4">
                  <p className="text-sm text-purple-700 mb-1">Due Date</p>
                  <p className="text-2xl font-bold text-purple-900">{tenant?.dueDate || room?.dueDate || 'N/A'}</p>
                </div>
              </div>

              {/* Electricity Info */}
              {room && (
                <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <h3 className="font-semibold text-yellow-900 mb-2">⚡ Electricity Meter</h3>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-yellow-700">Meter Number</p>
                      <p className="font-mono font-bold text-yellow-900">{room.electricityMeterNo || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-yellow-700">Current Reading</p>
                      <p className="font-mono font-bold text-yellow-900">{room.currentReading || 0} units</p>
                    </div>
                    <div>
                      <p className="text-yellow-700">Previous Reading</p>
                      <p className="font-mono font-bold text-yellow-900">{room.previousReading || 0} units</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Payment Records */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">💰 Payment History</h2>
              
              {paymentRecords.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-lg">
                  <p className="text-gray-600">No payment records found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Month</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Rent</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Electricity</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Total</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {paymentRecords.map((record) => (
                        <tr key={record.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {getMonthName(record.month)} {record.year}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">₹{record.rent || 0}</td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            ₹{record.electricity || 0}
                            {record.units > 0 && (
                              <span className="text-xs text-gray-500 ml-1">({record.units} units)</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                            ₹{(record.rent || 0) + (record.electricity || 0)}
                          </td>
                          <td className="px-4 py-3 text-sm">{getStatusBadge(record.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Payment Info */}
            {activeUPI && (
              <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-2xl font-bold text-gray-800 mb-4">💳 Payment Information</h2>
                <div className="grid md:grid-cols-2 gap-6">
                  {/* UPI Details */}
                  <div className="bg-blue-50 rounded-lg p-4">
                    <h3 className="font-semibold text-blue-900 mb-3">UPI Payment</h3>
                    <div className="space-y-2">
                      <div>
                        <p className="text-sm text-blue-700">UPI ID</p>
                        <p className="font-mono font-bold text-blue-900">{activeUPI.upiId}</p>
                      </div>
                      {activeUPI.accountName && (
                        <div>
                          <p className="text-sm text-blue-700">Account Name</p>
                          <p className="font-semibold text-blue-900">{activeUPI.accountName}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* QR Code */}
                  {activeUPI.qrCode && (
                    <div className="bg-gray-50 rounded-lg p-4 flex flex-col items-center">
                      <h3 className="font-semibold text-gray-800 mb-3">Scan to Pay</h3>
                      <img 
                        src={activeUPI.qrCode} 
                        alt="UPI QR Code" 
                        className="w-48 h-48 border-4 border-white shadow-lg rounded-lg"
                      />
                      <p className="text-xs text-gray-500 mt-2 text-center">
                        Use any UPI app to scan and pay
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TenantPortal;
