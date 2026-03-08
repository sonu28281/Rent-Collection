import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Get count of active tenants
 */
export const getActiveTenantCount = async () => {
  try {
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(query(tenantsRef, where('isActive', '==', true)));
    return tenantsSnapshot.size;
  } catch (error) {
    console.error('Error getting active tenant count:', error);
    return 0;
  }
};

/**
 * Get count of pending payments (unpaid or partial)
 */
export const getPendingPaymentCount = async () => {
  try {
    const paymentsRef = collection(db, 'payments');
    const paymentsSnapshot = await getDocs(
      query(
        paymentsRef,
        where('status', 'in', ['unpaid', 'partial', 'pending']) // Support both old and new status values
      )
    );
    return paymentsSnapshot.size;
  } catch (error) {
    console.error('Error getting pending payment count:', error);
    return 0;
  }
};

/**
 * Get current month's income from paid payments
 */
export const getCurrentMonthIncome = async () => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();

    const paymentsRef = collection(db, 'payments');
    const paymentsSnapshot = await getDocs(
      query(
        paymentsRef,
        where('status', '==', 'paid'),
        where('year', '==', currentYear),
        where('month', '==', currentMonth)
      )
    );

    let total = 0;
    paymentsSnapshot.forEach((doc) => {
      const data = doc.data();
      // Use paidAmount if available, otherwise totalAmount (backward compatibility)
      total += Number(data.paidAmount) || Number(data.totalAmount) || 0;
    });

    return total;
  } catch (error) {
    console.error('Error calculating current month income:', error);
    return 0;
  }
};

/**
 * Get year-wise income summary
 */
export const getYearlyIncomeSummary = async () => {
  try {
    const paymentsRef = collection(db, 'payments');
    // Get ALL payments regardless of status to show complete financial picture
    const paymentsSnapshot = await getDocs(paymentsRef);

    const yearlyData = {};

    paymentsSnapshot.forEach((doc) => {
      const data = doc.data();
      const year = data.year;
      // Use paidAmount for actual received money (handles partial payments correctly)
      const paidAmount = Number(data.paidAmount) || 0;
      
      // Calculate total from rent + electricity (don't trust stored total field)
      const rent = Number(data.rent || data.rentAmount) || 0;
      const electricity = Number(data.electricity || data.electricityAmount) || 0;
      const totalAmount = rent + electricity;

      // ONLY count payments where money was actually collected
      if (paidAmount <= 0) {
        return; // Skip payments with no collected amount
      }

      if (!yearlyData[year]) {
        yearlyData[year] = {
          year,
          totalIncome: 0,
          rentIncome: 0,
          electricityIncome: 0,
          paymentCount: 0
        };
      }

      // Add actual collected amount
      yearlyData[year].totalIncome += paidAmount;
      
      // Proportionally allocate paid amount to rent and electricity
      if (totalAmount > 0) {
        const paidRatio = paidAmount / totalAmount;
        yearlyData[year].rentIncome += rent * paidRatio;
        yearlyData[year].electricityIncome += electricity * paidRatio;
      } else {
        // If totalAmount is 0, add full paidAmount to rent (edge case)
        yearlyData[year].rentIncome += paidAmount;
      }
      
      yearlyData[year].paymentCount += 1;
    });

    // Convert to array and sort by year descending
    return Object.values(yearlyData).sort((a, b) => b.year - a.year);
  } catch (error) {
    console.error('Error calculating yearly income:', error);
    return [];
  }
};

/**
 * Get month-wise income for a specific year
 */
export const getMonthlyIncomeByYear = async (year) => {
  try {
    const paymentsRef = collection(db, 'payments');
    // Get ALL payments for the year regardless of status
    const paymentsSnapshot = await getDocs(
      query(
        paymentsRef,
        where('year', '==', year)
      )
    );

    const monthlyData = Array(12).fill(null).map((_, i) => ({
      month: i + 1,
      monthName: new Date(2000, i).toLocaleString('default', { month: 'short' }),
      totalIncome: 0,
      rentIncome: 0,
      electricityIncome: 0,
      paymentCount: 0
    }));

    paymentsSnapshot.forEach((doc) => {
      const data = doc.data();
      const monthIndex = data.month - 1; // 0-based index
      
      if (monthIndex >= 0 && monthIndex < 12) {
        // Use paidAmount for actual received money (handles partial payments)
        const paidAmount = Number(data.paidAmount) || 0;
        
        // ONLY count payments where money was actually collected
        if (paidAmount <= 0) {
          return; // Skip payments with no collected amount
        }
        
        // Calculate total from rent + electricity (don't trust stored total field)
        const rent = Number(data.rent || data.rentAmount) || 0;
        const electricity = Number(data.electricity || data.electricityAmount) || 0;
        const totalAmount = rent + electricity;
        
        // Add actual collected amount
        monthlyData[monthIndex].totalIncome += paidAmount;
        
        // Proportionally allocate paid amount to rent and electricity
        if (totalAmount > 0) {
          const paidRatio = paidAmount / totalAmount;
          monthlyData[monthIndex].rentIncome += rent * paidRatio;
          monthlyData[monthIndex].electricityIncome += electricity * paidRatio;
        } else {
          // If totalAmount is 0, add full paidAmount to rent (edge case)
          monthlyData[monthIndex].rentIncome += paidAmount;
        }
        
        monthlyData[monthIndex].paymentCount += 1;
      }
    });

    return monthlyData;
  } catch (error) {
    console.error('Error calculating monthly income:', error);
    return [];
  }
};

/**
 * Get total lifetime income
 */
export const getTotalLifetimeIncome = async () => {
  try {
    const paymentsRef = collection(db, 'payments');
    // Get ALL payments regardless of status
    const paymentsSnapshot = await getDocs(paymentsRef);

    let total = 0;
    paymentsSnapshot.forEach((doc) => {
      const data = doc.data();
      // Use paidAmount for actual received money (handles partial payments)
      const paidAmount = Number(data.paidAmount) || 0;
      
      // Calculate total from rent + electricity (don't trust stored total field)
      const rent = Number(data.rent || data.rentAmount) || 0;
      const electricity = Number(data.electricity || data.electricityAmount) || 0;
      const totalAmount = rent + electricity;
      
      total += paidAmount > 0 ? paidAmount : totalAmount;
    });

    return total;
  } catch (error) {
    console.error('Error calculating lifetime income:', error);
    return 0;
  }
};

/**
 * Get occupancy rate
 */
export const getOccupancyRate = async () => {
  try {
    const totalRooms = 12;
    const activeTenants = await getActiveTenantCount();
    return {
      occupied: activeTenants,
      vacant: totalRooms - activeTenants,
      rate: ((activeTenants / totalRooms) * 100).toFixed(1)
    };
  } catch (error) {
    console.error('Error calculating occupancy:', error);
    return { occupied: 0, vacant: 12, rate: '0.0' };
  }
};

/**
 * Get dashboard stats (all in one call for efficiency)
 */
export const getDashboardStats = async () => {
  try {
    const [
      activeTenants,
      pendingPayments,
      currentMonthIncome,
      totalIncome,
      occupancy
    ] = await Promise.all([
      getActiveTenantCount(),
      getPendingPaymentCount(),
      getCurrentMonthIncome(),
      getTotalLifetimeIncome(),
      getOccupancyRate()
    ]);

    return {
      activeTenants,
      pendingPayments,
      currentMonthIncome,
      totalIncome,
      occupancy
    };
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return {
      activeTenants: 0,
      pendingPayments: 0,
      currentMonthIncome: 0,
      totalIncome: 0,
      occupancy: { occupied: 0, vacant: 12, rate: '0.0' }
    };
  }
};

/**
 * Get today's collection (payments made today)
 */
export const getTodaysCollection = async () => {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0]; // Format: YYYY-MM-DD
    
    // Fetch all payments
    const paymentsRef = collection(db, 'payments');
    const paymentsSnapshot = await getDocs(paymentsRef);
    
    let todaysCollection = 0;
    let todaysPaymentCount = 0;
    
    paymentsSnapshot.forEach((doc) => {
      const data = doc.data();
      // Fallback: if paidAmount is missing but status=paid, use total/totalAmount
      const paidAmount = Number(data.paidAmount) ||
        (data.status === 'paid' ? Number(data.total || data.totalAmount) || 0 : 0);
      
      // Skip if no paid amount
      if (paidAmount <= 0) return;
      
      // Check if payment was made today
      let isTodaysPayment = false;
      
      // Check paidDate field (format: 'YYYY-MM-DD') - used by Payments.jsx & VerifyPayments.jsx
      if (data.paidDate === today) {
        isTodaysPayment = true;
      }
      
      // Check paymentDate field (format: 'YYYY-MM-DD')
      if (!isTodaysPayment && data.paymentDate === today) {
        isTodaysPayment = true;
      }
      
      // Also check paidAt field (ISO timestamp or date string)
      if (!isTodaysPayment && data.paidAt) {
        const paidAtDate = new Date(data.paidAt).toISOString().split('T')[0];
        if (paidAtDate === today) {
          isTodaysPayment = true;
        }
      }
      
      if (isTodaysPayment) {
        todaysCollection += paidAmount;
        todaysPaymentCount++;
      }
    });
    
    return {
      amount: todaysCollection,
      count: todaysPaymentCount,
      date: today
    };
  } catch (error) {
    console.error('Error calculating today\'s collection:', error);
    return {
      amount: 0,
      count: 0,
      date: new Date().toISOString().split('T')[0]
    };
  }
};

/**
 * Get month detailed summary with tenant information
 * @param {number} month - Optional month (1-12), defaults to current month
 * @param {number} year - Optional year, defaults to current year
 */
export const getCurrentMonthDetailedSummary = async (month = null, year = null) => {
  try {
    const now = new Date();
    const currentMonth = month || (now.getMonth() + 1); // 1-12
    const currentYear = year || now.getFullYear();

    // Fetch all active tenants
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(query(tenantsRef, where('isActive', '==', true)));
    
    // Fetch all current month payments
    const paymentsRef = collection(db, 'payments');
    const paymentsSnapshot = await getDocs(
      query(
        paymentsRef,
        where('year', '==', currentYear),
        where('month', '==', currentMonth)
      )
    );

    // Build normalized payments list for tenant-wise + room-wise matching
    const normalizedPayments = paymentsSnapshot.docs.map((paymentDoc) => {
      const paymentData = paymentDoc.data();
      return {
        id: paymentDoc.id,
        ...paymentData,
        roomNumber: paymentData.roomNumber !== undefined && paymentData.roomNumber !== null
          ? String(paymentData.roomNumber)
          : '',
        tenantId: paymentData.tenantId || null,
        tenantNameSnapshot: paymentData.tenantNameSnapshot || paymentData.tenantName || '',
        paidAmountValue: Number(paymentData.paidAmount) ||
          (paymentData.status === 'paid' ? Number(paymentData.total || paymentData.totalAmount) || 0 : 0),
        electricityValue: Number(paymentData.electricity || paymentData.electricityAmount) || 0,
        isPaidStatus: paymentData.status === 'paid' &&
          (Number(paymentData.paidAmount) || Number(paymentData.total) || Number(paymentData.totalAmount) || 0) > 0
      };
    });

    const getTenantRoomNumbers = (tenantData) => {
      if (Array.isArray(tenantData?.assignedRooms) && tenantData.assignedRooms.length > 0) {
        return tenantData.assignedRooms
          .map((roomNumber) => String(roomNumber))
          .filter(Boolean);
      }
      if (tenantData?.roomNumber !== undefined && tenantData?.roomNumber !== null && tenantData?.roomNumber !== '') {
        return [String(tenantData.roomNumber)];
      }
      return [];
    };

    // Build tenant payment summary
    const tenantList = [];
    let totalExpected = 0;
    let totalCollected = 0;
    let totalDue = 0;

    tenantsSnapshot.forEach((doc) => {
      const tenant = doc.data();
      const tenantRoomNumbers = getTenantRoomNumbers(tenant);
      const tenantNameNormalized = String(tenant.name || '').trim().toLowerCase();

      const tenantPayments = normalizedPayments.filter((payment) => {
        const byTenantId = payment.tenantId && payment.tenantId === doc.id;
        const byRoom = tenantRoomNumbers.length > 0 && tenantRoomNumbers.includes(payment.roomNumber);
        const byName = tenantNameNormalized && String(payment.tenantNameSnapshot || '').trim().toLowerCase() === tenantNameNormalized;
        return byTenantId || byRoom || byName;
      });

      const uniqueTenantPayments = Array.from(
        new Map(tenantPayments.map((payment) => [payment.id, payment])).values()
      );

      const roomWiseMap = {};
      tenantRoomNumbers.forEach((roomNumber) => {
        roomWiseMap[String(roomNumber)] = {
          roomNumber: String(roomNumber),
          rentAmount: Number(tenant.currentRent) || 0,  // fallback: per-room expected rent
          electricityAmount: 0,
          collectedAmount: 0,
          paymentRecordsCount: 0,
          latestPaidTimestamp: 0,
          latestPaidDate: null,
          status: 'pending'
        };
      });

      uniqueTenantPayments.forEach((payment) => {
        const roomKey = String(payment.roomNumber || '');
        if (!roomKey) return;

        if (!roomWiseMap[roomKey]) {
          roomWiseMap[roomKey] = {
            roomNumber: roomKey,
            rentAmount: Number(tenant.currentRent) || 0,
            electricityAmount: 0,
            collectedAmount: 0,
            paymentRecordsCount: 0,
            latestPaidTimestamp: 0,
            latestPaidDate: null,
            status: 'pending'
          };
        }

        // Rent is a fixed monthly amount — use payment record value if present, else keep initialised value
        const paymentRent = Number(payment.rent || payment.rentAmount) || 0;
        if (paymentRent > 0) {
          roomWiseMap[roomKey].rentAmount = paymentRent;
        }
        roomWiseMap[roomKey].electricityAmount += Number(payment.electricity || payment.electricityAmount) || 0;
        roomWiseMap[roomKey].collectedAmount += Number(payment.paidAmountValue) || 0;
        roomWiseMap[roomKey].paymentRecordsCount += 1;

        const paidAtStr = payment?.paidAt || payment?.paidDate || '';
        const paidAtTime = paidAtStr ? new Date(paidAtStr).getTime() : 0;
        if (payment.isPaidStatus && paidAtTime >= roomWiseMap[roomKey].latestPaidTimestamp) {
          roomWiseMap[roomKey].latestPaidTimestamp = paidAtTime;
          roomWiseMap[roomKey].latestPaidDate = paidAtStr ? new Date(paidAtStr).toLocaleDateString('en-IN') : null;
          roomWiseMap[roomKey].status = 'paid';
        }
      });

      const roomWiseSplit = Object.values(roomWiseMap).sort((firstRoom, secondRoom) => {
        const firstValue = Number(String(firstRoom.roomNumber).replace(/\D/g, '')) || 0;
        const secondValue = Number(String(secondRoom.roomNumber).replace(/\D/g, '')) || 0;
        return firstValue - secondValue;
      });

      const totalElectricity = uniqueTenantPayments.reduce((sum, payment) => sum + payment.electricityValue, 0);
      const rentFromRecords = uniqueTenantPayments.reduce(
        (sum, payment) => sum + (Number(payment.rent || payment.rentAmount) || 0),
        0
      );
      const collectedAmount = uniqueTenantPayments.reduce((sum, payment) => sum + payment.paidAmountValue, 0);
      const latestPaidRecord = uniqueTenantPayments
        .filter((payment) => payment.isPaidStatus)
        .sort((firstPayment, secondPayment) => {
          const firstTime = firstPayment?.paidAt ? new Date(firstPayment.paidAt).getTime() : 0;
          const secondTime = secondPayment?.paidAt ? new Date(secondPayment.paidAt).getTime() : 0;
          return secondTime - firstTime;
        })[0] || null;

      const paidRooms = new Set(
        uniqueTenantPayments
          .filter((payment) => payment.isPaidStatus)
          .map((payment) => String(payment.roomNumber))
      );

      const allRoomsPaid = tenantRoomNumbers.length > 0
        ? tenantRoomNumbers.every((room) => paidRooms.has(String(room)))
        : false;
      
      // Calculate expected rent with multi-room support
      const baseTenantRent = Number(tenant.currentRent) || 0;
      const expectedRent = rentFromRecords > 0
        ? rentFromRecords
        : (tenantRoomNumbers.length > 1 ? baseTenantRent * tenantRoomNumbers.length : baseTenantRent);
      const expectedElectricity = totalElectricity;
      const expectedTotal = expectedRent + expectedElectricity;
      
      // Calculate actual collected amount
      const dueAmount = Math.max(expectedTotal - collectedAmount, 0);
      
      // Payment status - Check BOTH status field AND actual collected amount
      // A payment is only considered 'paid' if status='paid' AND paidAmount > 0
      const status = (allRoomsPaid && collectedAmount > 0) ? 'paid' : 'pending';
      
      // Due Date Calculation (default to 5th of current month if not set)
      const dueDateOfMonth = tenant.dueDate || 5; // Default: 5th of each month
      const dueDate = new Date(currentYear, currentMonth - 1, dueDateOfMonth);
      const dueDateFormatted = dueDate.toLocaleDateString('en-IN');
      
      // Payment Date (actual date when payment was made)
      // Check paidAt (ISO timestamp from scripts) OR paidDate (string from Payments.jsx/VerifyPayments.jsx)
      const paidAtStr = latestPaidRecord?.paidAt || latestPaidRecord?.paidDate || null;
      const paidDate = paidAtStr ? new Date(paidAtStr).toLocaleDateString('en-IN') : null;
      const paidDateObj = paidAtStr ? new Date(paidAtStr) : null;
      
      // Delayed Status Detection
      let isDelayed = false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dueDate.setHours(0, 0, 0, 0);

      const msPerDay = 24 * 60 * 60 * 1000;
      const daysUntilDue = Math.round((dueDate - today) / msPerDay);
      let dueStatusText = '';
      let dueStatusColor = 'gray';

      if (status === 'paid') {
        // If paid, check if payment was made after due date
        if (paidDateObj) {
          paidDateObj.setHours(0, 0, 0, 0);
          isDelayed = paidDateObj > dueDate;
          const daysLate = Math.round((paidDateObj - dueDate) / msPerDay);
          if (isDelayed) {
            dueStatusText = daysLate === 1 ? 'Paid 1 day late' : `Paid ${daysLate} days late`;
            dueStatusColor = 'orange';
          } else {
            dueStatusText = 'Paid on time';
            dueStatusColor = 'green';
          }
        } else {
          dueStatusText = 'Paid';
          dueStatusColor = 'green';
        }
      } else {
        // If pending, check if due date has passed
        isDelayed = today > dueDate;
        if (isDelayed) {
          const daysOverdue = Math.abs(daysUntilDue);
          dueStatusText = daysOverdue === 1 ? 'Delayed by 1 day' : `Delayed by ${daysOverdue} days`;
          dueStatusColor = 'red';
        } else if (daysUntilDue === 0) {
          dueStatusText = 'Due today';
          dueStatusColor = 'orange';
        } else if (daysUntilDue === 1) {
          dueStatusText = 'Due tomorrow';
          dueStatusColor = 'yellow';
        } else if (daysUntilDue > 0 && daysUntilDue <= 3) {
          dueStatusText = `Due in ${daysUntilDue} days`;
          dueStatusColor = 'yellow';
        } else if (daysUntilDue > 3) {
          dueStatusText = `Due in ${daysUntilDue} days`;
          dueStatusColor = 'gray';
        }
      }
      
      tenantList.push({
        id: doc.id,
        name: tenant.name,
        roomNumber: tenant.roomNumber,
        roomNumbers: tenantRoomNumbers,
        roomCount: tenantRoomNumbers.length,
        expectedRent,
        expectedElectricity,
        expectedTotal,
        collectedAmount,
        dueAmount,
        status,
        dueDate: dueDateFormatted,
        paidDate,
        paidTimestamp: paidAtStr ? new Date(paidAtStr).getTime() : 0,
        isDelayed,
        dueStatusText,
        dueStatusColor,
        paymentMethod: latestPaidRecord ? latestPaidRecord.paymentMethod : null,
        paymentRecordsCount: uniqueTenantPayments.length,
        roomWiseSplit
      });
      
      totalExpected += expectedTotal;
      totalCollected += collectedAmount;
      totalDue += dueAmount;
    });

    // Sort: paid tenants first (by date), then pending by room number
    tenantList.sort((a, b) => {
      if (a.status === 'paid' && b.status !== 'paid') return -1;
      if (a.status !== 'paid' && b.status === 'paid') return 1;
      
      if (a.status === 'paid' && b.status === 'paid') {
        // Sort paid tenants by payment date (most recent first)
        if (a.paidDate && b.paidDate) {
          return b.paidDate.localeCompare(a.paidDate);
        }
      }
      
      // Sort by room number
      const roomA = typeof a.roomNumber === 'string' ? parseInt(a.roomNumber) : a.roomNumber;
      const roomB = typeof b.roomNumber === 'string' ? parseInt(b.roomNumber) : b.roomNumber;
      return roomA - roomB;
    });

    const paidTenants = tenantList.filter(t => t.status === 'paid');
    const pendingTenants = tenantList.filter(t => t.status !== 'paid');

    return {
      month: currentMonth,
      year: currentYear,
      totalExpected,
      totalCollected,
      totalDue,
      paidCount: paidTenants.length,
      pendingCount: pendingTenants.length,
      paidTenants,
      pendingTenants,
      allTenants: tenantList
    };
  } catch (error) {
    console.error('Error getting current month detailed summary:', error);
    return {
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
      totalExpected: 0,
      totalCollected: 0,
      totalDue: 0,
      paidCount: 0,
      pendingCount: 0,
      paidTenants: [],
      pendingTenants: [],
      allTenants: []
    };
  }
};

