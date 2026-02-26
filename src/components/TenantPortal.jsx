import { useEffect, useState } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import SubmitPayment from './SubmitPayment';
import googlePayLogo from '../assets/payment-icons/google-pay.svg';
import phonePeLogo from '../assets/payment-icons/phonepe.svg';

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
  const REMEMBER_ME_KEY = 'tenant_portal_saved_login_v1';

  // Login state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
    const DEFAULT_ELECTRICITY_RATE = 9; // Default electricity rate
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);

  // Tenant data state
  const [tenant, setTenant] = useState(null);
  const [room, setRoom] = useState(null);
  const [paymentRecords, setPaymentRecords] = useState([]);
  const [meterHistoryRecords, setMeterHistoryRecords] = useState([]);
  const [activeUPI, setActiveUPI] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingSubmissions, setPendingSubmissions] = useState([]);
  const [globalElectricityRate, setGlobalElectricityRate] = useState(DEFAULT_ELECTRICITY_RATE);
  
  // UI state for collapsible cards
  const [expandedCard, setExpandedCard] = useState(null);
  
  // Payment form state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [previousMeterReading, setPreviousMeterReading] = useState('');
  const [currentMeterReading, setCurrentMeterReading] = useState('');
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  
  // Submit payment modal state
  const [showSubmitPayment, setShowSubmitPayment] = useState(false);

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    setIsAppInstalled(isStandalone);

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
    };

    const onAppInstalled = () => {
      setIsAppInstalled(true);
      setInstallPromptEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const saveRememberedLogin = (savedUsername, savedPassword) => {
    localStorage.setItem(REMEMBER_ME_KEY, JSON.stringify({
      username: savedUsername,
      password: savedPassword,
      rememberMe: true
    }));
  };

  const clearRememberedLogin = () => {
    localStorage.removeItem(REMEMBER_ME_KEY);
  };

  const performLogin = async (inputUsername, inputPassword, options = {}) => {
    const trimmedUsername = inputUsername.trim();
    const { silent = false } = options;

    setLoggingIn(true);
    if (!silent) {
      setLoginError('');
    }

    try {
      const tenantsRef = collection(db, 'tenants');
      const loginQuery = query(
        tenantsRef,
        where('username', '==', trimmedUsername),
        where('password', '==', inputPassword),
        where('isActive', '==', true)
      );

      const snapshot = await getDocs(loginQuery);

      if (snapshot.empty) {
        if (!silent) {
          setLoginError('Invalid username or password. Please check and try again.');
        }
        return false;
      }

      const tenantData = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
      setTenant(tenantData);
      setIsLoggedIn(true);

      if (rememberMe) {
        saveRememberedLogin(trimmedUsername, inputPassword);
      } else {
        clearRememberedLogin();
      }

      await fetchTenantData(tenantData);
      return true;
    } catch (error) {
      console.error('Login error:', error);
      if (!silent) {
        setLoginError('Login failed. Please try again.');
      }
      return false;
    } finally {
      setLoggingIn(false);
    }
  };

  useEffect(() => {
    try {
      const savedRaw = localStorage.getItem(REMEMBER_ME_KEY);
      if (!savedRaw) {
        return;
      }

      const saved = JSON.parse(savedRaw);
      if (!saved?.rememberMe || !saved?.username || !saved?.password) {
        clearRememberedLogin();
        return;
      }

      setRememberMe(true);
      setUsername(saved.username);
      setPassword(saved.password);
      performLogin(saved.username, saved.password, { silent: true });
    } catch (error) {
      console.error('Remember me load error:', error);
      clearRememberedLogin();
    }
  }, []);

  const handleInstallApp = async () => {
    if (!installPromptEvent) {
      return;
    }

    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
  };

  // Handle login
  const handleLogin = async (e) => {
    e.preventDefault();
    await performLogin(username, password);
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

      // Fetch global electricity rate from settings
      const settingsRef = collection(db, 'settings');
      const settingsSnapshot = await getDocs(settingsRef);
      if (!settingsSnapshot.empty) {
        const settingsData = settingsSnapshot.docs[0].data();
        const configuredRate = Number(settingsData?.electricityRate);
        setGlobalElectricityRate(Number.isFinite(configuredRate) && configuredRate > 0 ? configuredRate : DEFAULT_ELECTRICITY_RATE);
      } else {
        setGlobalElectricityRate(DEFAULT_ELECTRICITY_RATE);
      }
      
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

      // Fetch payment records - Try multiple approaches
      const paymentsRef = collection(db, 'payments');
      
      console.log('🔍 Fetching payments for tenant:', {
        tenantId: tenantData.id,
        tenantName: tenantData.name,
        roomNumber: roomNumberAsNumber
      });
      
      // Fetch BOTH number AND string roomNumber types (merge results)
      // This handles historical payments (number) AND new payments (string)
      const numberQuery = query(
        paymentsRef, 
        where('roomNumber', '==', roomNumberAsNumber)
      );
      const stringQuery = query(
        paymentsRef, 
        where('roomNumber', '==', roomNumberAsString)
      );
      
      const [numberSnapshot, stringSnapshot] = await Promise.all([
        getDocs(numberQuery),
        getDocs(stringQuery)
      ]);
      
      console.log('📊 Payments with roomNumber as NUMBER:', numberSnapshot.size);
      console.log('📊 Payments with roomNumber as STRING:', stringSnapshot.size);
      
      // Merge both results, avoid duplicates by tracking IDs
      const paymentDocs = new Map();
      numberSnapshot.forEach(doc => paymentDocs.set(doc.id, doc));
      stringSnapshot.forEach(doc => paymentDocs.set(doc.id, doc));
      
      console.log('📊 Total unique payments:', paymentDocs.size);
      
      // Collect records - be more lenient with tenant matching
      const records = [];
      const allRoomPayments = [];
      
      paymentDocs.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() };
        allRoomPayments.push(data);
        
        // Match by tenant - check multiple criteria
        // Accept payment if ANY of these match:
        // 1. tenantId matches (if present)
        // 2. tenantName matches
        // 3. tenantNameSnapshot matches
        const matchesTenant = 
          (data.tenantId && data.tenantId === tenantData.id) ||
          (!data.tenantId && (data.tenantName === tenantData.name || data.tenantNameSnapshot === tenantData.name));
        
        if (matchesTenant) {
          records.push(data);
          console.log('✅ Payment matched for tenant:', {
            month: data.month,
            year: data.year,
            status: data.status,
            paidAmount: data.paidAmount,
            hasTenantId: !!data.tenantId,
            matchedBy: data.tenantId ? 'tenantId' : 'name'
          });
        } else {
          console.log('⏭️  Payment skipped (tenant mismatch):', {
            month: data.month,
            year: data.year,
            paymentTenantId: data.tenantId,
            paymentTenantName: data.tenantName || data.tenantNameSnapshot,
            currentTenantId: tenantData.id,
            currentTenantName: tenantData.name
          });
        }
      });
      
      console.log('📊 Total payments for this room:', allRoomPayments.length);
      console.log('📊 Payments matched to current tenant:', records.length);
      
      // If still no records found for current tenant, try by tenantId directly
      if (records.length === 0) {
        console.log('⚠️ No payments found by room+tenant match, trying direct tenantId query...');
        const tenantIdQuery = query(
          paymentsRef,
          where('tenantId', '==', tenantData.id)
        );
        const tenantIdSnapshot = await getDocs(tenantIdQuery);
        console.log('📊 Payments found by tenantId query:', tenantIdSnapshot.size);
        
        tenantIdSnapshot.forEach((doc) => {
          const data = { id: doc.id, ...doc.data() };
          records.push(data);
          console.log('✅ Payment added:', {
            month: data.month,
            year: data.year,
            status: data.status,
            paidAmount: data.paidAmount
          });
        });
      }
      
      // If STILL no records, show what we have for debugging
      if (records.length === 0 && allRoomPayments.length > 0) {
        console.log('⚠️ No tenant match! Room has payments but none matched tenant.');
        console.log('💡 Room payments tenantIds:', allRoomPayments.map(p => ({
          id: p.id,
          tenantId: p.tenantId,
          tenantName: p.tenantNameSnapshot || p.tenantName,
          month: p.month,
          year: p.year
        })));
        console.log('💡 Looking for tenantId:', tenantData.id);
        console.log('💡 Looking for tenantName:', tenantData.name);
      }
      
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

      // Fetch dedicated meter history entries for this tenant
      const readingsRef = collection(db, 'electricityReadings');
      const readingsByTenantIdQuery = query(readingsRef, where('tenantId', '==', tenantData.id));
      const readingsSnapshot = await getDocs(readingsByTenantIdQuery);

      const meterHistory = [];
      readingsSnapshot.forEach((doc) => {
        meterHistory.push({ id: doc.id, ...doc.data(), source: 'meter_reading' });
      });

      setMeterHistoryRecords(meterHistory);

      // Fetch pending submissions for current tenant and month
      const submissionsRef = collection(db, 'paymentSubmissions');
      const currentDate = new Date();
      const submissionsQuery = query(
        submissionsRef,
        where('tenantId', '==', tenantData.id),
        where('year', '==', currentDate.getFullYear()),
        where('month', '==', currentDate.getMonth() + 1)
      );
      const submissionsSnapshot = await getDocs(submissionsQuery);
      const submissions = [];
      submissionsSnapshot.forEach((doc) => {
        submissions.push({ id: doc.id, ...doc.data() });
      });
      setPendingSubmissions(submissions.filter(s => s.status === 'pending'));

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
    setMeterHistoryRecords([]);
    setPendingSubmissions([]);
    setActiveUPI(null);
    setUsername('');
    setPassword('');
  };

  // Calculate next due date and payment status
  const getNextDueDate = () => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDay = today.getDate();
    const dueDay = tenant?.dueDate || 20;
    
    // If payment records not loaded yet, show loading state
    if (!paymentRecords || paymentRecords.length === 0) {
      console.log('⚠️ No payment records loaded yet');
      return {
        dueDateStr: 'Loading...',
        status: 'due',
        dueDay: dueDay,
        statusText: 'Loading payment status...',
        overdueDays: 0
      };
    }
    
    // Check if current month payment exists and is paid
    // Handle both number and string types for year/month
    const currentMonthPayment = paymentRecords.find(
      p => {
        const pYear = typeof p.year === 'string' ? parseInt(p.year) : p.year;
        const pMonth = typeof p.month === 'string' ? parseInt(p.month) : p.month;
        return pYear === currentYear && pMonth === currentMonth;
      }
    );
    
    // Enhanced Debug logging
    console.log('🔍 Due Date Check:', {
      currentYear,
      currentMonth,
      currentDay,
      dueDay,
      paymentRecordsCount: paymentRecords.length,
      currentMonthPayment: currentMonthPayment ? {
        id: currentMonthPayment.id,
        year: currentMonthPayment.year,
        yearType: typeof currentMonthPayment.year,
        month: currentMonthPayment.month,
        monthType: typeof currentMonthPayment.month,
        status: currentMonthPayment.status,
        paidAmount: currentMonthPayment.paidAmount,
        tenantId: currentMonthPayment.tenantId,
        roomNumber: currentMonthPayment.roomNumber
      } : 'NOT FOUND'
    });
    
    // Log all payment records for debugging
    if (paymentRecords.length > 0) {
      console.log('📋 All Payment Records:', paymentRecords.map(p => ({
        month: p.month,
        year: p.year,
        status: p.status,
        paidAmount: p.paidAmount
      })));
    }
    
    let nextDueMonth, nextDueYear;
    let status = 'pending';
    let statusText = 'Payment Pending';
    let overdueDays = 0;
    
    // Check if current month is already paid (check both status AND paidAmount)
    // For paidAmount: Accept if rent field exists when paidAmount is missing
    const isPaid = currentMonthPayment && 
                   currentMonthPayment.status === 'paid' && 
                   ((currentMonthPayment.paidAmount || 0) > 0 || (currentMonthPayment.rent || 0) > 0);

    const hasPendingSubmission = pendingSubmissions.length > 0;
    
    console.log('💰 Payment Status Check:', {
      hasPayment: !!currentMonthPayment,
      status: currentMonthPayment?.status,
      paidAmount: currentMonthPayment?.paidAmount,
      rent: currentMonthPayment?.rent,
      hasPendingSubmission,
      isPaid: isPaid
    });
    
    if (isPaid) {
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
      console.log('✅ Status: PAID - Next due:', `${nextDueMonth}/${nextDueYear}`);
    } else if (hasPendingSubmission) {
      nextDueMonth = currentMonth;
      nextDueYear = currentYear;
      status = 'pending';
      statusText = 'Payment Verification Pending ⏳';
      console.log('⏳ Status: PENDING VERIFICATION');
    } else if (currentDay <= dueDay) {
      // Payment due this month, still within due date
      nextDueMonth = currentMonth;
      nextDueYear = currentYear;
      status = 'due';
      statusText = 'Payment Due This Month';
      console.log('📅 Status: DUE - Within due date');
    } else {
      // After due date and not paid - OVERDUE
      nextDueMonth = currentMonth;
      nextDueYear = currentYear;
      status = 'overdue';
      statusText = 'Payment Overdue!';

      const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
      const safeDueDay = Math.min(dueDay, daysInMonth);
      const dueDate = new Date(currentYear, currentMonth - 1, safeDueDay);
      const todayStart = new Date(currentYear, currentMonth - 1, currentDay);
      const diffMs = todayStart.getTime() - dueDate.getTime();
      overdueDays = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

      console.log('⚠️ Status: OVERDUE - Past due date');
    }
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dueDateStr = `${dueDay} ${monthNames[nextDueMonth - 1]} ${nextDueYear}`;
    
    return { dueDateStr, status, dueDay, statusText, overdueDays };
  };

  // Toggle card expansion
  const toggleCard = (cardId) => {
    setExpandedCard(expandedCard === cardId ? null : cardId);
  };

  // Calculate electricity amount
  const calculateElectricity = (oldReading, currentReading) => {
    const units = Math.max(0, currentReading - oldReading);
    const ratePerUnit = globalElectricityRate; // Use global electricity rate
    const electricityAmount = units * ratePerUnit;
    return { units, electricityAmount };
  };

  // Handle meter reading submit
  const handleMeterReadingSubmit = () => {
    const oldReading = Number(previousMeterReading);
    const currentReading = Number(currentMeterReading);

    if (!Number.isFinite(oldReading) || oldReading < 0) {
      alert('⚠️ Please enter a valid previous reading');
      return;
    }

    if (!Number.isFinite(currentReading) || currentReading < oldReading) {
      alert('⚠️ Current reading must be greater than or equal to previous reading');
      return;
    }
  };
  
  // Copy UPI ID to clipboard
  const copyUPIId = () => {
    if (activeUPI?.upiId) {
      navigator.clipboard.writeText(activeUPI.upiId).then(() => {
        alert('✅ UPI ID copied to clipboard!');
      }).catch(() => {
        alert('❌ Failed to copy. Please copy manually.');
      });
    }
  };

  const getPayableAmount = () => {
    const oldReading = Number(previousMeterReading);
    const currentReading = Number(currentMeterReading);

    if (!Number.isFinite(oldReading) || oldReading < 0) {
      return null;
    }

    if (!Number.isFinite(currentReading) || currentReading < oldReading) {
      return null;
    }

    const { units, electricityAmount } = calculateElectricity(oldReading, currentReading);
    const rentAmount = tenant?.currentRent || room?.rent || 0;
    const totalAmount = rentAmount + electricityAmount;

    return {
      oldReading,
      currentReading,
      units,
      rentAmount,
      electricityAmount,
      totalAmount
    };
  };

  const openSpecificUPIApp = (appType) => {
    const payable = getPayableAmount();

    if (!payable) {
      alert('⚠️ Enter valid Previous and Current meter readings first');
      return;
    }

    if (!activeUPI?.upiId) {
      alert('❌ UPI ID not available');
      return;
    }

    const { rentAmount, electricityAmount, totalAmount } = payable;

    const params = `pa=${encodeURIComponent(activeUPI.upiId)}&pn=${encodeURIComponent(activeUPI.nickname || 'Property Owner')}&am=${totalAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Room ${tenant.roomNumber} - Rent+Electricity`)}`;
    const genericUpiLink = `upi://pay?${params}`;

    let deepLink = genericUpiLink;
    if (appType === 'gpay') {
      deepLink = `tez://upi/pay?${params}`;
    }
    if (appType === 'phonepe') {
      deepLink = `phonepe://pay?${params}`;
    }

    window.location.href = deepLink;

    setTimeout(() => {
      if (document.visibilityState !== 'hidden') {
        window.location.href = genericUpiLink;
      }
    }, 1200);

    setTimeout(() => {
      alert(
        `📊 Payment Details:\n\n` +
        `Rent: ₹${rentAmount}\n` +
        `Electricity: ₹${electricityAmount.toFixed(2)}\n` +
        `Total: ₹${totalAmount.toFixed(2)}\n\n` +
        `✅ Amount and UPI ID auto-filled.\n` +
        `Now just tap "Pay" in your UPI app.`
      );
    }, 500);
  };
  
  // Open UPI payment link
  const openUPIPayment = () => {
    openSpecificUPIApp('generic');
  };

  const getYearMonthLabel = (year, month) => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const safeMonth = Number(month);
    const monthLabel = monthNames[safeMonth - 1] || `M${safeMonth}`;
    return `${monthLabel} ${year}`;
  };

  const getMonthIndex = (year, month) => (Number(year) * 12) + Number(month);

  const extractMeterSnapshot = (record) => {
    const oldReading = Number(record.oldReading ?? record.previousReading);
    const currentReading = Number(record.currentReading ?? record.meterReading);
    const electricityAmount = Number(record.electricity ?? record.electricityAmount ?? 0);
    const unitsFromRecord = Number(record.units ?? record.unitsConsumed);

    const hasReadings = Number.isFinite(oldReading) && Number.isFinite(currentReading) && currentReading >= oldReading;
    const units = Number.isFinite(unitsFromRecord)
      ? Math.max(0, unitsFromRecord)
      : (hasReadings ? Math.max(0, currentReading - oldReading) : 0);

    const hasElectricityBill = electricityAmount > 0 || units > 0;

    return {
      oldReading: hasReadings ? oldReading : null,
      currentReading: hasReadings ? currentReading : null,
      electricityAmount: Number.isFinite(electricityAmount) ? electricityAmount : 0,
      units,
      hasElectricityBill,
      isProperBill: hasReadings && hasElectricityBill && record.status === 'paid'
    };
  };

  const getElectricityBillingHealth = () => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentMonthIndex = getMonthIndex(currentYear, currentMonth);

    const properRecords = paymentRecords
      .filter((record) => {
        const snapshot = extractMeterSnapshot(record);
        return snapshot.isProperBill;
      })
      .sort((a, b) => getMonthIndex(Number(b.year), Number(b.month)) - getMonthIndex(Number(a.year), Number(a.month)));

    const lastProperRecord = properRecords[0] || null;

    if (!lastProperRecord) {
      const checkInDate = tenant?.checkInDate ? new Date(tenant.checkInDate) : null;
      const hasValidCheckIn = checkInDate && !Number.isNaN(checkInDate.getTime());
      const checkInMonthIndex = hasValidCheckIn
        ? getMonthIndex(checkInDate.getFullYear(), checkInDate.getMonth() + 1)
        : null;

      const fallbackMonths = hasValidCheckIn
        ? Math.max(1, currentMonthIndex - checkInMonthIndex + 1)
        : Math.max(1, paymentRecords.length || 1);

      return {
        status: 'overdue',
        monthsPending: fallbackMonths,
        lastRecord: null,
        snapshot: null,
        message: 'No previous proper electricity bill record found. Please submit electricity bill with meter reading.'
      };
    }

    const lastYear = Number(lastProperRecord.year);
    const lastMonth = Number(lastProperRecord.month);
    const lastMonthIndex = getMonthIndex(lastYear, lastMonth);
    const monthsPending = Math.max(0, currentMonthIndex - lastMonthIndex);

    if (monthsPending === 0) {
      const currentSnapshot = extractMeterSnapshot(lastProperRecord);
      return {
        status: 'healthy',
        monthsPending: 0,
        lastRecord: lastProperRecord,
        snapshot: currentSnapshot,
        message: 'Great! You are paying rent + electricity on time every month.'
      };
    }

    return {
      status: 'overdue',
      monthsPending,
      lastRecord: lastProperRecord,
      snapshot: extractMeterSnapshot(lastProperRecord),
      message: `Electricity bill pending for ${monthsPending} month${monthsPending > 1 ? 's' : ''}.`
    };
  };

  const getLastMonthClosingReading = () => {
    const candidateReadings = [
      getElectricityBillingHealth().snapshot?.currentReading,
      room?.currentReading,
      room?.previousReading,
      0
    ];

    const reading = candidateReadings
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value) && value >= 0);

    return Number.isFinite(reading) ? reading : 0;
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

  const getMeterHistoryTimeline = () => {
    const fromPayments = paymentRecords
      .map((record) => {
        const previousReading = Number(record.oldReading ?? record.previousReading);
        const currentReading = Number(record.currentReading ?? record.meterReading);
        const unitsConsumed = Number(record.units ?? record.unitsConsumed ?? 0);
        const electricityAmount = Number(record.electricity ?? record.electricityAmount ?? 0);

        const hasReadings = Number.isFinite(previousReading) && Number.isFinite(currentReading) && currentReading >= previousReading;
        if (!hasReadings) return null;

        return {
          id: `payment_${record.id}`,
          source: 'payment_history',
          date: record.paidDate || record.paymentDate || record.paidAt || record.createdAt || null,
          monthLabel: record.year && record.month ? `${getMonthName(Number(record.month))} ${record.year}` : 'Unknown',
          previousReading,
          currentReading,
          unitsConsumed: Number.isFinite(unitsConsumed) ? unitsConsumed : Math.max(0, currentReading - previousReading),
          electricityAmount: Number.isFinite(electricityAmount) ? electricityAmount : 0
        };
      })
      .filter(Boolean);

    const fromMeterReadings = meterHistoryRecords
      .map((reading) => {
        const previousReading = Number(reading.previousReading);
        const currentReading = Number(reading.currentReading);
        const unitsConsumed = Number(reading.unitsConsumed ?? 0);
        const totalCharge = Number(reading.totalCharge ?? 0);

        const hasReadings = Number.isFinite(previousReading) && Number.isFinite(currentReading) && currentReading >= previousReading;
        if (!hasReadings) return null;

        const readingDate = reading.readingDate || reading.createdAt || null;
        const dateObj = readingDate ? new Date(readingDate) : null;

        return {
          id: `reading_${reading.id}`,
          source: 'meter_reading',
          date: readingDate,
          monthLabel: dateObj && !Number.isNaN(dateObj.getTime())
            ? dateObj.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
            : 'Unknown',
          previousReading,
          currentReading,
          unitsConsumed: Number.isFinite(unitsConsumed) ? unitsConsumed : Math.max(0, currentReading - previousReading),
          electricityAmount: Number.isFinite(totalCharge) ? totalCharge : 0
        };
      })
      .filter(Boolean);

    const merged = [...fromMeterReadings, ...fromPayments]
      .sort((a, b) => {
        const aTime = a.date ? new Date(a.date).getTime() : 0;
        const bTime = b.date ? new Date(b.date).getTime() : 0;
        return bTime - aTime;
      });

    const seen = new Set();
    const deduped = [];

    merged.forEach((item) => {
      const key = `${item.monthLabel}_${item.previousReading}_${item.currentReading}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    });

    return deduped;
  };

  const isRentElectricityPaidRecord = (record) => {
    const electricityAmount = Number(record.electricity ?? record.electricityAmount ?? 0);
    const units = Number(record.units ?? record.unitsConsumed ?? 0);
    return record.status === 'paid' && (electricityAmount > 0 || units > 0);
  };

  const isOnlyRentPaidRecord = (record) => {
    const electricityAmount = Number(record.electricity ?? record.electricityAmount ?? 0);
    const units = Number(record.units ?? record.unitsConsumed ?? 0);
    return record.status === 'paid' && electricityAmount <= 0 && units <= 0;
  };

  const getPaidAmountSummary = () => {
    return paymentRecords.reduce((acc, record) => {
      if (record.status !== 'paid') {
        return acc;
      }

      acc.rentPaid += Number(record.rent || 0);
      acc.electricityPaid += Number(record.electricity ?? record.electricityAmount ?? 0);
      return acc;
    }, { rentPaid: 0, electricityPaid: 0 });
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
              {installPromptEvent && !isAppInstalled && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                  <p className="text-xs sm:text-sm text-indigo-800 mb-2">📱 Install app on your phone for one-tap access every month.</p>
                  <button
                    type="button"
                    onClick={handleInstallApp}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 rounded-lg text-sm"
                  >
                    Add to Home Screen
                  </button>
                </div>
              )}

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

              {/* Remember Me */}
              <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setRememberMe(checked);
                    if (!checked) {
                      clearRememberedLogin();
                    }
                  }}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Remember me on this phone
              </label>

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
              const electricityHealth = getElectricityBillingHealth();
              const statusColors = {
                paid: 'from-green-500 to-emerald-600',
                pending: 'from-amber-500 to-orange-600',
                due: 'from-blue-500 to-indigo-600',
                overdue: 'from-orange-500 to-red-600'
              };
              const statusIcons = {
                paid: '✅',
                pending: '⏳',
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
                        <>
                          <p className="text-white/95 text-xs mt-1 font-semibold">
                            Overdue by {dueInfo.overdueDays} day{dueInfo.overdueDays > 1 ? 's' : ''}
                          </p>
                          <p className="text-white/90 text-xs mt-1 font-semibold">Please pay soon!</p>
                        </>
                      )}
                      {dueInfo.status === 'paid' && (
                        <p className="text-white/90 text-xs mt-1 font-semibold">Thank you! 🎉</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Electricity Billing Health */}
            {(() => {
              const electricityHealth = getElectricityBillingHealth();
              const isHealthy = electricityHealth.status === 'healthy';
              const lastRecord = electricityHealth.lastRecord;
              const snapshot = electricityHealth.snapshot;

              return (
                <div className={`rounded-lg border-2 p-4 ${
                  isHealthy
                    ? 'bg-green-50 border-green-300'
                    : 'bg-red-50 border-red-300'
                }`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={`font-bold text-sm sm:text-base ${isHealthy ? 'text-green-900' : 'text-red-900'}`}>
                        {isHealthy ? '✅ Electricity Billing On Track' : '⚠️ Electricity Billing Pending'}
                      </p>
                      <p className={`text-xs sm:text-sm mt-1 ${isHealthy ? 'text-green-800' : 'text-red-800'}`}>
                        {electricityHealth.message}
                      </p>
                    </div>
                    {!isHealthy && typeof electricityHealth.monthsPending === 'number' && (
                      <div className="px-3 py-1.5 rounded-full bg-red-100 border border-red-300 text-red-800 text-xs font-bold whitespace-nowrap">
                        {electricityHealth.monthsPending} month{electricityHealth.monthsPending > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>

                  {lastRecord && snapshot && (
                    <div className={`mt-3 rounded-lg p-3 border ${isHealthy ? 'bg-green-100 border-green-200' : 'bg-white border-red-200'}`}>
                      <p className={`text-xs font-semibold mb-2 ${isHealthy ? 'text-green-900' : 'text-red-900'}`}>
                        Last Proper Electricity Bill: {getYearMonthLabel(lastRecord.year, lastRecord.month)}
                      </p>
                      <div className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
                        <div>
                          <p className={isHealthy ? 'text-green-700' : 'text-red-700'}>Old</p>
                          <p className="font-mono font-bold">{snapshot.oldReading ?? '-'}</p>
                        </div>
                        <div>
                          <p className={isHealthy ? 'text-green-700' : 'text-red-700'}>Current</p>
                          <p className="font-mono font-bold">{snapshot.currentReading ?? '-'}</p>
                        </div>
                        <div>
                          <p className={isHealthy ? 'text-green-700' : 'text-red-700'}>Units</p>
                          <p className="font-mono font-bold">{snapshot.units}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Quick Payment Action - NEW */}
            {!showPaymentForm && (() => {
              const dueInfo = getNextDueDate();
              const isCurrentMonthPaid = dueInfo.status === 'paid';
              const isVerificationPending = dueInfo.status === 'pending';
              const shouldDisablePayment = isCurrentMonthPaid || isVerificationPending;
              const oldReadingForThisMonth = getLastMonthClosingReading();
              
              return (
                <>
                  {/* Make Payment Button - Only show if current month NOT paid */}
                  {!shouldDisablePayment && (
                    <button
                      onClick={() => {
                        console.log('Make Payment clicked!');
                        console.log('Active UPI:', activeUPI);
                        console.log('Room:', room);
                        if (!activeUPI) {
                          alert('⚠️ Payment setup not available. Please contact property manager.');
                          return;
                        }
                        setPreviousMeterReading(String(oldReadingForThisMonth));
                        setCurrentMeterReading('');
                        setShowPaymentForm(true);
                      }}
                      className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-4 px-6 rounded-lg shadow-lg transition-all transform hover:scale-105 active:scale-95 touch-manipulation mb-3"
                    >
                      💳 Make Payment Now
                    </button>
                  )}
                  
                  {/* Pending Verification Message */}
                  {isVerificationPending && (
                    <div className="w-full bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-lg p-4 mb-3 text-center">
                      <div className="text-3xl mb-2">⏳</div>
                      <p className="text-amber-800 font-bold text-lg mb-1">Verification in Progress</p>
                      <p className="text-amber-700 text-sm">You already submitted payment details. Please wait for admin verification.</p>
                    </div>
                  )}
                  
                  {/* Submit Payment Proof Button - Always available */}
                  <button
                    onClick={() => setShowSubmitPayment(true)}
                    className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold py-4 px-6 rounded-lg shadow-lg transition-all transform hover:scale-105 active:scale-95 touch-manipulation"
                  >
                    📝 Submit Payment for Verification
                  </button>
                  <p className="text-xs text-gray-500 text-center mt-2">
                    💡 Already paid outside? Submit details here for verification
                  </p>
                </>
              );
            })()}

            {/* Payment Form with Meter Reading - NEW */}
            {showPaymentForm && (
              <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 border-2 border-green-500">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-800">💳 Make Payment</h2>
                  <button
                    onClick={() => {
                      setShowPaymentForm(false);
                      setPreviousMeterReading('');
                      setCurrentMeterReading('');
                    }}
                    className="text-gray-500 hover:text-gray-700 font-bold text-xl"
                  >
                    ✕
                  </button>
                </div>

                {!activeUPI ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-red-700 font-semibold mb-2">❌ Payment Setup Not Available</p>
                    <p className="text-sm text-red-600">Please contact the property manager to set up UPI payment details.</p>
                  </div>
                ) : (
                  <>

                {/* Meter Reading Inputs */}
                <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    ⚡ Enter Meter Readings
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="number"
                      value={previousMeterReading}
                      placeholder="Previous Reading"
                      className="px-4 py-3 text-lg font-mono border-2 border-gray-300 rounded-lg bg-gray-100 text-gray-700 cursor-not-allowed"
                      min="0"
                      readOnly
                    />
                    <input
                      type="number"
                      value={currentMeterReading}
                      onChange={(e) => setCurrentMeterReading(e.target.value)}
                      placeholder="Current Reading"
                      className="px-4 py-3 text-lg font-mono border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      min={Number(previousMeterReading) || 0}
                    />
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    Previous reading is auto-filled from last month closing reading (tenant cannot edit) | Rate: ₹{globalElectricityRate}/unit
                  </p>
                </div>

                {/* Payment Amount Summary - Always show when meter reading entered */}
                {getPayableAmount() && (
                  <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <h3 className="font-semibold text-blue-900 mb-2">Payment Amount:</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Rent:</span>
                        <span className="font-bold">₹{(tenant?.currentRent || room?.rent || 0).toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Electricity ({getPayableAmount().units} units):</span>
                        <span className="font-bold">₹{getPayableAmount().electricityAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-blue-300 text-lg">
                        <span className="font-bold">Total:</span>
                        <span className="font-bold text-green-600">
                          ₹{getPayableAmount().totalAmount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* QR Code */}
                {activeUPI.qrCode && (
                  <div className="text-center mb-4">
                    <p className="text-sm font-semibold text-gray-700 mb-3">Or Scan QR Code:</p>
                    <div className="bg-white p-3 sm:p-4 rounded-xl border-2 border-gray-300 inline-block">
                      <img 
                        src={activeUPI.qrCode} 
                        alt="UPI QR Code" 
                        className="w-48 h-48 sm:w-56 sm:h-56 rounded-lg"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Open any UPI app and scan this code</p>
                  </div>
                )}

                {/* Pay Buttons - Google Pay + PhonePe */}
                {getPayableAmount() && (
                  <div className="mb-4">
                    <p className="text-sm font-semibold text-gray-700 mb-2">
                      Payable Amount: <span className="text-green-600 text-lg">₹{getPayableAmount().totalAmount.toFixed(2)}</span>
                    </p>
                    <p className="text-xs text-gray-500 mb-3">Choose app and tap once to open with prefilled UPI details</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={() => openSpecificUPIApp('gpay')}
                        disabled={paymentProcessing}
                        className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold py-3 sm:py-4 px-4 rounded-lg shadow-lg transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex flex-col items-center leading-tight gap-1.5 sm:gap-2">
                          <img
                            src={googlePayLogo}
                            alt="Google Pay"
                            className="h-7 sm:h-8 w-auto bg-white rounded-full px-1.5 py-1"
                          />
                          <span className="text-xs font-bold text-blue-50">Pay ₹{getPayableAmount().totalAmount.toFixed(2)}</span>
                        </div>
                      </button>

                      <button
                        onClick={() => openSpecificUPIApp('phonepe')}
                        disabled={paymentProcessing}
                        className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-bold py-3 sm:py-4 px-4 rounded-lg shadow-lg transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex flex-col items-center leading-tight gap-1.5 sm:gap-2">
                          <img
                            src={phonePeLogo}
                            alt="PhonePe"
                            className="h-7 sm:h-8 w-auto bg-white rounded-full px-1.5 py-1"
                          />
                          <span className="text-xs font-bold text-purple-50">Pay ₹{getPayableAmount().totalAmount.toFixed(2)}</span>
                        </div>
                      </button>
                    </div>

                    <button
                      onClick={openUPIPayment}
                      disabled={paymentProcessing}
                      className="w-full mt-3 bg-gray-800 hover:bg-gray-900 text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        📱 Other UPI App • Pay ₹{getPayableAmount().totalAmount.toFixed(2)}
                    </button>
                  </div>
                )}

                {/* UPI ID */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                  <p className="text-xs text-gray-600 mb-1">Or pay via UPI ID:</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono font-bold text-sm flex-1 break-all">{activeUPI.upiId}</p>
                    <button
                      onClick={copyUPIId}
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
                </>
                )}
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
                      <p className="text-yellow-700 mb-1">Old (This Month)</p>
                      <p className="font-mono font-bold text-yellow-900">{getLastMonthClosingReading()}</p>
                    </div>
                  </div>
                  {room.currentReading > 0 && getLastMonthClosingReading() >= 0 && (
                    <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-yellow-200">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1">
                        <span className="text-xs sm:text-sm text-yellow-700">Units Consumed:</span>
                        <span className="text-base sm:text-lg font-bold text-yellow-900">
                          {Math.max(0, (Number(room.currentReading) || 0) - getLastMonthClosingReading())} units
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Meter History Access - Read Only */}
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800">📚 Meter Reading History</h2>
                <span className="text-xs sm:text-sm text-gray-600">
                  {getMeterHistoryTimeline().length} record{getMeterHistoryTimeline().length !== 1 ? 's' : ''}
                </span>
              </div>

              {getMeterHistoryTimeline().length === 0 ? (
                <div className="text-center py-6 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">No meter history available yet.</p>
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-xs sm:text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Month</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Old</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Current</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Units</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Electricity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {getMeterHistoryTimeline().map((entry) => (
                        <tr key={entry.id} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-gray-800">{entry.monthLabel}</div>
                            <div className="text-[10px] text-gray-500">
                              {entry.source === 'meter_reading' ? 'meter record' : 'payment history'}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{entry.previousReading}</td>
                          <td className="px-3 py-2 text-right font-mono">{entry.currentReading}</td>
                          <td className="px-3 py-2 text-right">{entry.unitsConsumed}</td>
                          <td className="px-3 py-2 text-right font-semibold">₹{Number(entry.electricityAmount || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

              {paymentRecords.length > 0 && (() => {
                const summary = getPaidAmountSummary();
                return (
                  <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <p className="text-xs text-blue-700 font-semibold mb-1">🏠 Total Rent Paid (Till Date)</p>
                      <p className="text-lg font-bold text-blue-900">₹{summary.rentPaid.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                      <p className="text-xs text-purple-700 font-semibold mb-1">⚡ Total Electricity Paid (Till Date)</p>
                      <p className="text-lg font-bold text-purple-900">₹{summary.electricityPaid.toLocaleString('en-IN')}</p>
                    </div>
                  </div>
                );
              })()}

              {paymentRecords.length > 0 && (() => {
                const paidWithElectricity = paymentRecords.filter(isRentElectricityPaidRecord);
                const lastElectricityPaid = paidWithElectricity[0] || null;

                return (
                  <div className="mb-4">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <p className="text-xs text-green-700 font-semibold mb-1">✅ Rent + Electricity Paid</p>
                      <p className="text-sm font-bold text-green-900">
                        {lastElectricityPaid
                          ? `Last: ${getMonthName(lastElectricityPaid.month)} ${lastElectricityPaid.year}`
                          : 'No electricity-paid month yet'}
                      </p>
                    </div>
                  </div>
                );
              })()}
              
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
                    const isRentElectricityPaid = isRentElectricityPaidRecord(record);
                    const isOnlyRentPaid = isOnlyRentPaidRecord(record);

                    const paymentTypeText = isRentElectricityPaid
                      ? 'Rent + Electricity Paid'
                      : isOnlyRentPaid
                      ? 'Rent Paid • Electricity Pending'
                      : isPaid
                      ? 'Paid'
                      : isPending
                      ? 'Pending'
                      : 'Overdue';
                    
                    return (
                      <div 
                        key={record.id} 
                        className={`border-2 rounded-lg transition-all cursor-pointer ${
                          isRentElectricityPaid ? 'border-green-300 bg-green-50 hover:bg-green-100' :
                          isOnlyRentPaid ? 'border-amber-300 bg-amber-50 hover:bg-amber-100' :
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
                              {isRentElectricityPaid ? '✅' : isOnlyRentPaid ? '⚠️' : isPaid ? '✅' : isPending ? '⏳' : '❌'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm sm:text-base font-bold text-gray-800 truncate">
                                {getMonthName(record.month)} {record.year}
                              </h3>
                              <p className="text-xs text-gray-600">
                                {paymentTypeText}
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
                            {isOnlyRentPaid && (
                              <div className="bg-amber-50 border border-amber-200 rounded p-2">
                                <p className="text-xs font-semibold text-amber-900">
                                  ⚠️ Rent payment received for this month. Electricity bill is still pending.
                                </p>
                              </div>
                            )}

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
                  <li>✓ "Make Payment Now" button shows only when payment is due</li>
                  <li>✓ Once paid, button is hidden and shows ✅ confirmation</li>
                  <li>✓ Enter current meter reading before payment</li>
                  <li>✓ Scan QR code or use UPI ID to pay</li>
                  <li>✓ After payment, click "Submit Payment for Verification"</li>
                  <li>✓ Admin will verify within 24 hours</li>
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
        
        {/* Submit Payment Modal */}
        {showSubmitPayment && (
          <SubmitPayment
            tenant={tenant}
            room={room}
            electricityRate={globalElectricityRate}
            onClose={() => setShowSubmitPayment(false)}
            onSuccess={() => {
              // Reload tenant data after successful submission
              setShowSubmitPayment(false);
              // Optionally refresh data here
            }}
          />
        )}
      </div>
    </div>
  );
};

export default TenantPortal;
