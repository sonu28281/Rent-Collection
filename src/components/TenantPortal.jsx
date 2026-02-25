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

      // Fetch payment records - Simplified query without year filter
      const paymentsRef = collection(db, 'payments');
      const paymentsQuery = query(
        paymentsRef, 
        where('roomNumber', '==', tenantData.roomNumber)
      );
      const paymentsSnapshot = await getDocs(paymentsQuery);
      
      // Collect all records and sort in JavaScript
      const records = [];
      paymentsSnapshot.forEach((doc) => {
        records.push({ id: doc.id, ...doc.data() });
      });
      
      // Sort by year and month (descending), then take last 12
      records.sort((a, b) => {
        if (b.year !== a.year) return b.year - a.year;
        return b.month - a.month;
      });
      
      setPaymentRecords(records.slice(0, 12));

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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-3 sm:p-4">
        <div className="max-w-md w-full">
          {/* Login Card */}
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-6 sm:p-8">
            {/* Logo/Header */}
            <div className="text-center mb-6 sm:mb-8">
              <div className="text-4xl sm:text-5xl mb-2 sm:mb-3">🏠</div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-1 sm:mb-2">Tenant Portal</h1>
              <p className="text-sm sm:text-base text-gray-600">Login to view your records</p>
            </div>

            {/* Login Form */}
            <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5">
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
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-base border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-base border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                className="w-full bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-bold py-3 sm:py-3.5 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed text-base touch-manipulation"
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
      {/* Header - Mobile Optimized */}
      <div className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
              <span className="text-2xl sm:text-3xl flex-shrink-0">🏠</span>
              <div className="min-w-0 flex-1">
                <h1 className="text-base sm:text-xl font-bold text-gray-800 truncate">Tenant Portal</h1>
                <p className="text-xs sm:text-sm text-gray-600 truncate">Room {tenant?.roomNumber} - {tenant?.name}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-semibold py-2 px-3 sm:px-4 rounded-lg transition-colors text-xs sm:text-sm whitespace-nowrap flex-shrink-0 touch-manipulation"
            >
              🚪 Logout
            </button>
          </div>
        </div>
      </div>

      {/* Main Content - Mobile Optimized */}
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading your data...</p>
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {/* Due Date Alert - Mobile Optimized */}
            <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg shadow-lg p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="flex items-center gap-3 sm:gap-4 flex-1 w-full">
                  <div className="text-3xl sm:text-5xl">📅</div>
                  <div className="flex-1">
                    <h3 className="text-lg sm:text-xl font-bold mb-1">Next Payment Due</h3>
                    <p className="text-white/90 text-xs sm:text-sm">Monthly rent payment</p>
                  </div>
                </div>
                <div className="text-center bg-white/20 backdrop-blur-sm rounded-lg px-4 sm:px-6 py-3 sm:py-4 w-full sm:w-auto">
                  <p className="text-white/80 text-xs sm:text-sm mb-1">Due Date</p>
                  <p className="text-3xl sm:text-4xl font-bold">{tenant?.dueDate || room?.dueDate || 'N/A'}</p>
                  <p className="text-white/80 text-xs mt-1">of every month</p>
                </div>
              </div>
            </div>

            {/* Room Info Card - Mobile Optimized */}
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-3 sm:mb-4">📍 Room Information</h2>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-blue-50 rounded-lg p-3 sm:p-4">
                  <p className="text-xs sm:text-sm text-blue-700 mb-1">Room Number</p>
                  <p className="text-xl sm:text-2xl font-bold text-blue-900">{room?.roomNumber || tenant?.roomNumber}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3 sm:p-4">
                  <p className="text-xs sm:text-sm text-green-700 mb-1">Monthly Rent</p>
                  <p className="text-xl sm:text-2xl font-bold text-green-900">₹{(tenant?.currentRent || room?.rent || 0).toLocaleString('en-IN')}</p>
                </div>
              </div>

              {/* Electricity Info - Mobile Optimized */}
              {room && (
                <div className="mt-3 sm:mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-yellow-900 mb-2 sm:mb-3 text-sm sm:text-base">⚡ Electricity Meter</h3>
                  <div className="grid grid-cols-3 gap-2 sm:gap-3 text-xs sm:text-sm">
                    <div>
                      <p className="text-yellow-700 mb-1">Meter No.</p>
                      <p className="font-mono font-bold text-yellow-900 text-xs sm:text-sm break-all">{room.electricityMeterNo || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-yellow-700 mb-1">Current</p>
                      <p className="font-mono font-bold text-yellow-900">{room.currentReading || 0}</p>
                    </div>
                    <div>
                      <p className="text-yellow-700 mb-1">Previous</p>
                      <p className="font-mono font-bold text-yellow-900">{room.previousReading || 0}</p>
                    </div>
                  </div>
                  {room.currentReading > 0 && room.previousReading >= 0 && (
                    <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-yellow-200">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                        <span className="text-xs sm:text-sm text-yellow-700">Units Consumed:</span>
                        <span className="text-base sm:text-lg font-bold text-yellow-900">
                          {room.currentReading - room.previousReading} units
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Payment Records - Mobile Optimized */}
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800">💰 Payment History</h2>
                <span className="text-xs sm:text-sm text-gray-600">
                  {paymentRecords.length} record{paymentRecords.length !== 1 ? 's' : ''}
                </span>
              </div>
              
              {paymentRecords.length === 0 ? (
                <div className="text-center py-6 sm:py-8 bg-gray-50 rounded-lg">
                  <div className="text-4xl sm:text-5xl mb-2 sm:mb-3">📋</div>
                  <p className="text-gray-600 font-semibold text-sm sm:text-base">No payment records yet</p>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">Your payment history will appear here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {paymentRecords.map((record) => {
                    const total = (record.rent || 0) + (record.electricity || 0);
                    const isPaid = record.status === 'paid';
                    const isPending = record.status === 'pending';
                    const isOverdue = record.status === 'overdue';
                    
                    return (
                      <div 
                        key={record.id} 
                        className={`border-2 rounded-lg p-3 sm:p-4 transition-all ${
                          isPaid ? 'border-green-300 bg-green-50' :
                          isPending ? 'border-yellow-300 bg-yellow-50' :
                          isOverdue ? 'border-red-300 bg-red-50' :
                          'border-gray-300 bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2 sm:mb-3">
                          <div className="flex-1 min-w-0 pr-2">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mb-1 sm:mb-2">
                              <h3 className="text-base sm:text-lg font-bold text-gray-800">
                                {getMonthName(record.month)} {record.year}
                              </h3>
                              {getStatusBadge(record.status)}
                            </div>
                            
                            {/* Payment Date */}
                            {record.paidAt && isPaid && (
                              <p className="text-xs sm:text-sm text-green-700 mb-1">
                                ✅ <span className="font-semibold">
                                  {new Date(record.paidAt).toLocaleDateString('en-IN', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric'
                                  })}
                                </span>
                              </p>
                            )}
                            
                            {/* Payment Method */}
                            {record.paymentMethod && isPaid && (
                              <p className="text-xs sm:text-sm text-gray-600">
                                💳 <span className="font-semibold">{record.paymentMethod}</span>
                              </p>
                            )}
                          </div>
                          
                          <div className="text-right flex-shrink-0">
                            <p className="text-xl sm:text-2xl font-bold text-gray-900">₹{total.toLocaleString('en-IN')}</p>
                            <p className="text-xs text-gray-500">Total</p>
                          </div>
                        </div>
                        
                        {/* Breakdown - Mobile Optimized */}
                        <div className="grid grid-cols-2 gap-2 sm:gap-3 pt-2 sm:pt-3 border-t border-gray-200">
                          <div className="bg-white/50 rounded p-2">
                            <p className="text-xs text-gray-600 mb-1">Rent</p>
                            <p className="font-bold text-gray-800 text-sm sm:text-base">₹{(record.rent || 0).toLocaleString('en-IN')}</p>
                          </div>
                          <div className="bg-white/50 rounded p-2">
                            <p className="text-xs text-gray-600 mb-1">Electricity</p>
                            <p className="font-bold text-gray-800 text-sm sm:text-base">
                              ₹{(record.electricity || 0).toLocaleString('en-IN')}
                              {record.units > 0 && (
                                <span className="text-xs text-gray-500 block sm:inline sm:ml-1">({record.units} units)</span>
                              )}
                            </p>
                          </div>
                        </div>
                        
                        {/* Notes */}
                        {record.notes && (
                          <div className="mt-3 pt-3 border-t border-gray-200">
                            <p className="text-xs text-gray-600 mb-1">📝 Note:</p>
                            <p className="text-sm text-gray-700 italic">{record.notes}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Make Payment Section - Mobile Optimized */}
            {activeUPI && (
              <div className="bg-gradient-to-br from-green-500 to-emerald-600 text-white rounded-lg shadow-lg p-4 sm:p-6">
                <div className="text-center mb-4 sm:mb-6">
                  <div className="text-4xl sm:text-5xl mb-2 sm:mb-3">💳</div>
                  <h2 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2">Make a Payment</h2>
                  <p className="text-white/90 text-sm sm:text-base">Use any method to pay your rent</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                  {/* UPI Payment Details - Mobile Optimized */}
                  <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 sm:p-5 border-2 border-white/20">
                    <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                      <div className="bg-white/20 rounded-full p-2 sm:p-3">
                        <span className="text-xl sm:text-2xl">📱</span>
                      </div>
                      <h3 className="text-lg sm:text-xl font-bold">UPI Payment</h3>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="bg-white/10 rounded-lg p-3">
                        <p className="text-white/70 text-xs sm:text-sm mb-1">UPI ID</p>
                        <p className="font-mono font-bold text-base sm:text-lg break-all">{activeUPI.upiId}</p>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(activeUPI.upiId);
                            alert('✅ UPI ID copied to clipboard!');
                          }}
                          className="mt-2 w-full bg-white/20 hover:bg-white/30 active:bg-white/40 text-white font-semibold py-3 px-4 rounded transition-colors text-sm touch-manipulation"
                        >
                          📋 Copy UPI ID
                        </button>
                      </div>
                      
                      {activeUPI.accountName && (
                        <div className="bg-white/10 rounded-lg p-3">
                          <p className="text-white/70 text-xs sm:text-sm mb-1">Account Name</p>
                          <p className="font-semibold text-sm sm:text-base">{activeUPI.accountName}</p>
                        </div>
                      )}
                      
                      <div className="bg-white/10 rounded-lg p-3">
                        <p className="text-white/70 text-xs sm:text-sm mb-2">💡 How to pay:</p>
                        <ol className="text-xs sm:text-sm space-y-1 text-white/90 list-decimal list-inside leading-relaxed">
                          <li className="mb-1">Open any UPI app (PhonePe, GPay, Paytm)</li>
                          <li className="mb-1">Enter the UPI ID above</li>
                          <li className="mb-1">Enter amount and pay</li>
                          <li>Share payment screenshot with manager</li>
                        </ol>
                      </div>
                    </div>
                  </div>

                  {/* QR Code Payment - Mobile Optimized */}
                  {activeUPI.qrCode && (
                    <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 sm:p-5 border-2 border-white/20">
                      <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
                        <div className="bg-white/20 rounded-full p-2 sm:p-3">
                          <span className="text-xl sm:text-2xl">📷</span>
                        </div>
                        <h3 className="text-lg sm:text-xl font-bold">Scan QR Code</h3>
                      </div>
                      
                      <div className="flex flex-col items-center">
                        <div className="bg-white p-3 sm:p-4 rounded-xl shadow-xl mb-3 sm:mb-4">
                          <img 
                            src={activeUPI.qrCode} 
                            alt="UPI QR Code" 
                            className="w-48 h-48 sm:w-56 sm:h-56 rounded-lg"
                          />
                        </div>
                        <div className="bg-white/10 rounded-lg p-3 w-full">
                          <p className="text-white/70 text-xs sm:text-sm mb-2">📷 How to scan:</p>
                          <ol className="text-xs sm:text-sm space-y-1 text-white/90 list-decimal list-inside leading-relaxed">
                            <li className="mb-1">Open any UPI app scanner</li>
                            <li className="mb-1">Scan this QR code</li>
                            <li>Enter amount and complete payment</li>
                          </ol>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Important Note - Mobile Optimized */}
                <div className="mt-4 sm:mt-6 bg-white/10 backdrop-blur-sm border-2 border-white/30 rounded-lg p-3 sm:p-4">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <span className="text-xl sm:text-2xl flex-shrink-0">⚠️</span>
                    <div className="flex-1">
                      <h4 className="font-bold mb-1 text-sm sm:text-base">Important Note</h4>
                      <ul className="text-xs sm:text-sm text-white/90 space-y-1">
                        <li>• Pay on or before {tenant?.dueDate || 'due date'} of every month</li>
                        <li>• Send payment screenshot to property manager</li>
                        <li>• Payment updated within 24 hours</li>
                        <li>• Keep receipts for your records</li>
                      </ul>
                    </div>
                  </div>
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
