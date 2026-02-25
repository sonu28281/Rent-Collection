import { useState } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Tenant Portal - Username/Password Login
 * Version: 2.1.0 (Feb 25, 2026 - Fixed payment display & due date logic)
 * 
 * Login:
 * - Username = Room Number (e.g., "101")
 * - Password = Set during setup (default: "password")
 * 
 * Changes:
 * - Fixed payment record display (showing all records, not just 12)
 * - Fixed due date logic (shows green when current month paid)
 * - Added detailed console logging for debugging
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
  
  // UI state for collapsible cards
  const [expandedCard, setExpandedCard] = useState(null);
  
  // Payment form state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [meterReading, setMeterReading] = useState('');
  const [paymentProcessing, setPaymentProcessing] = useState(false);

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
      console.log('👤 Fetching data for tenant:', {
        name: tenantData.name,
        roomNumber: tenantData.roomNumber,
        roomNumberType: typeof tenantData.roomNumber
      });
      
      // Convert roomNumber to appropriate type for queries
      const roomNumberAsNumber = typeof tenantData.roomNumber === 'string' 
        ? parseInt(tenantData.roomNumber, 10) 
        : tenantData.roomNumber;
      const roomNumberAsString = String(tenantData.roomNumber);
      
      console.log('🔢 Converted room numbers:', {
        asNumber: roomNumberAsNumber,
        asString: roomNumberAsString
      });
      
      // Fetch room details - try both number and string
      const roomsRef = collection(db, 'rooms');
      let roomQuery = query(roomsRef, where('roomNumber', '==', roomNumberAsNumber));
      let roomSnapshot = await getDocs(roomQuery);
      
      console.log('🏠 Room query result (number):', roomSnapshot.size);
      
      // If not found with number, try with string
      if (roomSnapshot.empty) {
        console.log('⚠️ Room not found with number, trying string...');
        roomQuery = query(roomsRef, where('roomNumber', '==', roomNumberAsString));
        roomSnapshot = await getDocs(roomQuery);
        console.log('🏠 Room query result (string):', roomSnapshot.size);
      }
      
      if (!roomSnapshot.empty) {
        const roomData = { id: roomSnapshot.docs[0].id, ...roomSnapshot.docs[0].data() };
        console.log('✅ Room found:', {
          roomNumber: roomData.roomNumber,
          currentReading: roomData.currentReading,
          rent: roomData.rent
        });
        setRoom(roomData);
      } else {
        console.log('❌ Room not found!');
      }

      // Fetch payment records - Filter by room AND tenant name
      // This ensures tenant only sees their own payment history, not previous tenants
      const paymentsRef = collection(db, 'payments');
      const paymentsQuery = query(
        paymentsRef, 
        where('roomNumber', '==', roomNumberAsNumber)
      );
      
      console.log('🔍 Fetching payments for room:', roomNumberAsNumber);
      console.log('👤 Filtering for tenant:', tenantData.name);
      const paymentsSnapshot = await getDocs(paymentsQuery);
      console.log('📊 Total payments fetched from DB:', paymentsSnapshot.size);
      
      // Collect records and filter by tenant name
      const records = [];
      paymentsSnapshot.forEach((doc) => {
        const data = doc.data();
        // Only include payments made by current tenant
        // Match by tenantNameSnapshot field
        if (data.tenantNameSnapshot === tenantData.name || data.tenantName === tenantData.name) {
          records.push({ id: doc.id, ...data });
        }
      });
      
      console.log('📋 Records for current tenant:', records.length);
      console.log('🔍 Tenant name match filter:', tenantData.name);
      
      // Log some raw data before sorting
      const sample2026 = records.filter(r => r.year === 2026);
      console.log('🔍 2026 records for this tenant:', sample2026.length);
      if (sample2026.length > 0) {
        console.log('Sample 2026 records:', sample2026.map(r => ({ 
          month: r.month, 
          year: r.year, 
          status: r.status,
          tenantName: r.tenantNameSnapshot || r.tenantName 
        })));
      }
      
      // Sort by year and month (descending)
      records.sort((a, b) => {
        const yearDiff = b.year - a.year;
        if (yearDiff !== 0) return yearDiff;
        return b.month - a.month;
      });
      
      console.log('🔝 Top 5 payments after sort:', records.slice(0, 5).map(r => `${r.month}/${r.year} (${r.status})`));
      
      // Show all records, not just 12
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

  // Calculate next due date and payment status
  const getNextDueDate = () => {
    // If payment records not loaded yet, show loading state
    if (!paymentRecords || paymentRecords.length === 0) {
      return {
        dueDateStr: 'Loading...',
        status: 'due',
        dueDay: tenant?.dueDate || 20,
        statusText: 'Loading payment status...'
      };
    }
    
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDay = today.getDate();
    const dueDay = tenant?.dueDate || 20;
    
    // Check if current month payment exists and is paid
    const currentMonthPayment = paymentRecords.find(
      p => p.year === currentYear && p.month === currentMonth
    );
    
    // Debug logging
    console.log('🔍 Due Date Check:', {
      currentYear,
      currentMonth,
      currentDay,
      dueDay,
      paymentRecordsCount: paymentRecords.length,
      currentMonthPayment: currentMonthPayment ? {
        year: currentMonthPayment.year,
        month: currentMonthPayment.month,
        status: currentMonthPayment.status
      } : 'Not found'
    });
    
    let nextDueMonth, nextDueYear;
    let status = 'pending';
    let statusText = 'Payment Pending';
    
    // Check if current month is already paid
    if (currentMonthPayment && currentMonthPayment.status === 'paid') {
      // ✅ Current month paid - Show NEXT month's due date
      if (currentMonth === 12) {
        nextDueMonth = 1;
        nextDueYear = currentYear + 1;
      } else {
        nextDueMonth = currentMonth + 1;
        nextDueYear = currentYear;
      }
      status = 'paid';
      statusText = 'Current Month Paid ✅';
    } else if (currentDay <= dueDay) {
      // Payment due this month, still within due date
      nextDueMonth = currentMonth;
      nextDueYear = currentYear;
      status = 'due';
      statusText = 'Payment Due This Month';
    } else {
      // After due date and not paid - OVERDUE
      nextDueMonth = currentMonth;
      nextDueYear = currentYear;
      status = 'overdue';
      statusText = 'Payment Overdue!';
    }
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dueDateStr = `${dueDay} ${monthNames[nextDueMonth - 1]} ${nextDueYear}`;
    
    return { dueDateStr, status, dueDay, statusText };
  };

  // Toggle card expansion
  const toggleCard = (cardId) => {
    setExpandedCard(expandedCard === cardId ? null : cardId);
  };

  // Calculate electricity amount
  const calculateElectricity = (currentReading) => {
    const prevReading = room?.currentReading || 0;
    const units = Math.max(0, currentReading - prevReading);
    const ratePerUnit = 8.5; // Default rate
    const electricityAmount = units * ratePerUnit;
    return { units, electricityAmount };
  };

  // Handle meter reading submit
  const handleMeterReadingSubmit = () => {
    const reading = parseFloat(meterReading);
    if (!reading || reading <= (room?.currentReading || 0)) {
      alert('⚠️ Please enter a valid meter reading greater than current reading');
      return;
    }
    
    const { units, electricityAmount } = calculateElectricity(reading);
    const rentAmount = tenant?.currentRent || room?.rent || 0;
    const totalAmount = rentAmount + electricityAmount;
    
    setPaymentProcessing(true);
    
    // Show payment details
    const confirmMsg = `📊 Payment Summary:\n\n` +
      `Rent: ₹${rentAmount}\n` +
      `Electricity: ${units} units × ₹8.5 = ₹${electricityAmount.toFixed(2)}\n` +
      `Total: ₹${totalAmount.toFixed(2)}\n\n` +
      `After payment, share screenshot with property manager.\n` +
      `Meter reading: ${reading} units`;
    
    alert(confirmMsg);
    setPaymentProcessing(false);
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
            {/* Due Date Alert - Mobile Optimized with Smart Logic */}
            {(() => {
              const dueInfo = getNextDueDate();
              const statusColors = {
                paid: 'from-green-500 to-emerald-600',
                due: 'from-blue-500 to-indigo-600',
                overdue: 'from-orange-500 to-red-600'
              };
              const statusIcons = {
                paid: '✅',
                due: '📅',
                overdue: '⚠️'
              };
              
              return (
                <div className={`bg-gradient-to-r ${statusColors[dueInfo.status]} text-white rounded-lg shadow-lg p-4 sm:p-6`}>
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="flex items-center gap-3 sm:gap-4 flex-1 w-full">
                      <div className="text-3xl sm:text-5xl">{statusIcons[dueInfo.status]}</div>
                      <div className="flex-1">
                        <h3 className="text-lg sm:text-xl font-bold mb-1">{dueInfo.statusText}</h3>
                        <p className="text-white/90 text-xs sm:text-sm">
                          {dueInfo.status === 'paid' ? 'Next payment due on' : 'Monthly rent payment'}
                        </p>
                      </div>
                    </div>
                    <div className="text-center bg-white/20 backdrop-blur-sm rounded-lg px-4 sm:px-6 py-3 sm:py-4 w-full sm:w-auto">
                      <p className="text-white/80 text-xs sm:text-sm mb-1">
                        {dueInfo.status === 'paid' ? 'Next Due' : 'Due Date'}
                      </p>
                      <p className="text-xl sm:text-2xl font-bold">{dueInfo.dueDateStr}</p>
                      {dueInfo.status === 'overdue' && (
                        <p className="text-white/90 text-xs mt-1 font-semibold">Please pay soon!</p>
                      )}
                      {dueInfo.status === 'paid' && (
                        <p className="text-white/90 text-xs mt-1 font-semibold">Thank you! 🎉</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Quick Payment Action - NEW */}
            {!showPaymentForm && (
              <button
                onClick={() => setShowPaymentForm(true)}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-4 px-6 rounded-lg shadow-lg transition-all transform hover:scale-105 active:scale-95 touch-manipulation"
              >
                💳 Make Payment Now
              </button>
            )}

            {/* Payment Form with Meter Reading - NEW */}
            {showPaymentForm && activeUPI && (
              <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 border-2 border-green-500">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-800">💳 Make Payment</h2>
                  <button
                    onClick={() => setShowPaymentForm(false)}
                    className="text-gray-500 hover:text-gray-700 font-bold text-xl"
                  >
                    ✕
                  </button>
                </div>

                {/* Meter Reading Input */}
                <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    ⚡ Enter Current Meter Reading
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={meterReading}
                      onChange={(e) => setMeterReading(e.target.value)}
                      placeholder={`Current: ${room?.currentReading || 0}`}
                      className="flex-1 px-4 py-3 text-lg font-mono border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      min={room?.currentReading || 0}
                    />
                    <button
                      onClick={handleMeterReadingSubmit}
                      disabled={!meterReading || paymentProcessing}
                      className="bg-green-500 hover:bg-green-600 active:bg-green-700 text-white font-bold px-6 py-3 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      Calculate
                    </button>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    Previous reading: {room?.currentReading || 0} | Rate: ₹8.5/unit
                  </p>
                </div>

                {/* Payment Amount Summary */}
                {meterReading && parseFloat(meterReading) > (room?.currentReading || 0) && (
                  <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <h3 className="font-semibold text-blue-900 mb-2">Payment Amount:</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Rent:</span>
                        <span className="font-bold">₹{(tenant?.currentRent || room?.rent || 0).toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Electricity ({calculateElectricity(parseFloat(meterReading)).units} units):</span>
                        <span className="font-bold">₹{calculateElectricity(parseFloat(meterReading)).electricityAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-blue-300 text-lg">
                        <span className="font-bold">Total:</span>
                        <span className="font-bold text-green-600">
                          ₹{((tenant?.currentRent || room?.rent || 0) + calculateElectricity(parseFloat(meterReading)).electricityAmount).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* QR Code */}
                {activeUPI.qrCode && (
                  <div className="text-center mb-4">
                    <p className="text-sm font-semibold text-gray-700 mb-3">Scan to Pay:</p>
                    <div className="bg-white p-3 sm:p-4 rounded-xl border-2 border-gray-300 inline-block">
                      <img 
                        src={activeUPI.qrCode} 
                        alt="UPI QR Code" 
                        className="w-48 h-48 sm:w-56 sm:h-56 rounded-lg"
                      />
                    </div>
                  </div>
                )}

                {/* UPI ID */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                  <p className="text-xs text-gray-600 mb-1">Or pay via UPI ID:</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono font-bold text-sm flex-1 break-all">{activeUPI.upiId}</p>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(activeUPI.upiId);
                        alert('✅ UPI ID copied!');
                      }}
                      className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-3 rounded text-xs whitespace-nowrap"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                {/* Instructions */}
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-orange-900 mb-1">⚠️ After Payment:</p>
                  <ul className="text-xs text-orange-800 space-y-1">
                    <li>✓ Take screenshot of payment confirmation</li>
                    <li>✓ Share with property manager on WhatsApp</li>
                    <li>✓ Mention your room number and meter reading</li>
                    <li>✓ Payment will be updated within 24 hours</li>
                  </ul>
                </div>
              </div>
            )}

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

            {/* Payment Records - Collapsible Mobile-Friendly Cards */}
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
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
                <div className="space-y-2">
                  {paymentRecords.map((record) => {
                    const total = (record.rent || 0) + (record.electricity || 0);
                    const isPaid = record.status === 'paid';
                    const isPending = record.status === 'pending';
                    const isOverdue = record.status === 'overdue';
                    const isExpanded = expandedCard === record.id;
                    
                    return (
                      <div 
                        key={record.id} 
                        className={`border-2 rounded-lg transition-all cursor-pointer ${
                          isPaid ? 'border-green-300 bg-green-50 hover:bg-green-100' :
                          isPending ? 'border-yellow-300 bg-yellow-50 hover:bg-yellow-100' :
                          isOverdue ? 'border-red-300 bg-red-50 hover:bg-red-100' :
                          'border-gray-300 bg-gray-50 hover:bg-gray-100'
                        }`}
                      >
                        {/* Compact Header - Always Visible */}
                        <div 
                          onClick={() => toggleCard(record.id)}
                          className="flex items-center justify-between p-3"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="text-xl flex-shrink-0">
                              {isPaid ? '✅' : isPending ? '⏳' : '❌'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm sm:text-base font-bold text-gray-800 truncate">
                                {getMonthName(record.month)} {record.year}
                              </h3>
                              <p className="text-xs text-gray-600">
                                {isPaid ? 'Paid' : isPending ? 'Pending' : 'Overdue'}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="text-right">
                              <p className="text-base sm:text-lg font-bold text-gray-900">₹{total.toLocaleString('en-IN')}</p>
                            </div>
                            <span className="text-gray-400 text-xl">
                              {isExpanded ? '▼' : '▶'}
                            </span>
                          </div>
                        </div>
                        
                        {/* Expanded Details - Show on Click */}
                        {isExpanded && (
                          <div className="px-3 pb-3 space-y-3 border-t border-gray-200 pt-3">
                            {/* Payment Date */}
                            {record.paidAt && isPaid && (
                              <div className="bg-white/50 rounded p-2">
                                <p className="text-xs text-gray-600 mb-1">Payment Date:</p>
                                <p className="text-sm font-semibold text-green-700">
                                  {new Date(record.paidAt).toLocaleDateString('en-IN', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric'
                                  })}
                                </p>
                              </div>
                            )}
                            
                            {/* Breakdown */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="bg-white/50 rounded p-2">
                                <p className="text-xs text-gray-600 mb-1">Rent</p>
                                <p className="font-bold text-gray-800 text-sm">₹{(record.rent || 0).toLocaleString('en-IN')}</p>
                              </div>
                              <div className="bg-white/50 rounded p-2">
                                <p className="text-xs text-gray-600 mb-1">Electricity</p>
                                <p className="font-bold text-gray-800 text-sm">₹{(record.electricity || 0).toLocaleString('en-IN')}</p>
                              </div>
                            </div>
                            
                            {/* Meter Readings */}
                            {(record.oldReading || record.currentReading || record.units) && (
                              <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
                                <p className="text-xs font-semibold text-yellow-900 mb-2">⚡ Meter Details:</p>
                                <div className="grid grid-cols-3 gap-2 text-xs">
                                  <div>
                                    <p className="text-yellow-700">Previous</p>
                                    <p className="font-mono font-bold text-yellow-900">{record.oldReading || 0}</p>
                                  </div>
                                  <div>
                                    <p className="text-yellow-700">Current</p>
                                    <p className="font-mono font-bold text-yellow-900">{record.currentReading || 0}</p>
                                  </div>
                                  <div>
                                    <p className="text-yellow-700">Units</p>
                                    <p className="font-mono font-bold text-yellow-900">{record.units || 0}</p>
                                  </div>
                                </div>
                                {record.ratePerUnit && (
                                  <p className="text-xs text-yellow-700 mt-1">
                                    Rate: ₹{record.ratePerUnit}/unit
                                  </p>
                                )}
                              </div>
                            )}
                            
                            {/* Payment Method */}
                            {record.paymentMethod && isPaid && (
                              <div className="bg-white/50 rounded p-2">
                                <p className="text-xs text-gray-600 mb-1">Payment Method:</p>
                                <p className="text-sm font-semibold text-gray-800">
                                  💳 {record.paymentMethod}
                                </p>
                              </div>
                            )}
                            
                            {/* Notes */}
                            {record.notes && (
                              <div className="bg-white/50 rounded p-2">
                                <p className="text-xs text-gray-600 mb-1">📝 Note:</p>
                                <p className="text-sm text-gray-700 italic">{record.notes}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Contact & Support Info */}
            <div className="bg-gradient-to-br from-gray-700 to-gray-900 text-white rounded-lg shadow-lg p-4 sm:p-6">
              <div className="text-center mb-4">
                <div className="text-3xl sm:text-4xl mb-2">📞</div>
                <h2 className="text-xl sm:text-2xl font-bold mb-1">Need Help?</h2>
                <p className="text-white/80 text-sm">Contact property manager</p>
              </div>

              <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg p-4">
                <h3 className="font-bold mb-3 text-sm">📋 Payment Instructions:</h3>
                <ul className="text-xs sm:text-sm text-white/90 space-y-2">
                  <li>✓ Click "Make Payment Now" button above</li>
                  <li>✓ Enter your current meter reading</li>
                  <li>✓ Calculate total amount</li>
                  <li>✓ Scan QR code or use UPI ID to pay</li>
                  <li>✓ Share payment screenshot with manager</li>
                  <li>✓ Payment will be updated within 24 hours</li>
                </ul>
              </div>

              <div className="mt-4 bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-3">
                <p className="text-xs text-yellow-100">
                  <strong>⚠️ Important:</strong> Always provide your meter reading along with payment proof for accurate billing.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TenantPortal;
