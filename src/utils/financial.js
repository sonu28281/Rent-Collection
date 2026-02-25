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
 * Get current month detailed summary with tenant information
 */
export const getCurrentMonthDetailedSummary = async () => {
  try {
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();

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

    // Create a map of payments by room number
    const paymentsMap = {};
    paymentsSnapshot.forEach((doc) => {
      const data = doc.data();
      paymentsMap[data.roomNumber] = {
        id: doc.id,
        ...data
      };
    });

    // Build tenant payment summary
    const tenantList = [];
    let totalExpected = 0;
    let totalCollected = 0;
    let totalDue = 0;

    tenantsSnapshot.forEach((doc) => {
      const tenant = doc.data();
      const roomNumber = typeof tenant.roomNumber === 'string' 
        ? parseInt(tenant.roomNumber, 10) 
        : tenant.roomNumber;
      
      const payment = paymentsMap[roomNumber];
      
      // Calculate expected rent (from tenant data or payment record)
      const expectedRent = tenant.currentRent || 0;
      const expectedElectricity = payment ? (payment.electricity || 0) : 0;
      const expectedTotal = expectedRent + expectedElectricity;
      
      // Calculate actual collected amount
      const collectedAmount = payment ? (payment.paidAmount || 0) : 0;
      const dueAmount = expectedTotal - collectedAmount;
      
      // Payment status
      const status = payment ? payment.status : 'pending';
      const paidDate = payment && payment.paidAt ? new Date(payment.paidAt).toLocaleDateString('en-IN') : null;
      
      tenantList.push({
        id: doc.id,
        name: tenant.name,
        roomNumber: tenant.roomNumber,
        expectedRent,
        expectedElectricity,
        expectedTotal,
        collectedAmount,
        dueAmount,
        status,
        paidDate,
        paymentMethod: payment ? payment.paymentMethod : null
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

