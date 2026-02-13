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
 * Get count of pending payments
 */
export const getPendingPaymentCount = async () => {
  try {
    const paymentsRef = collection(db, 'payments');
    const paymentsSnapshot = await getDocs(
      query(paymentsRef, where('status', '==', 'pending'))
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
      total += Number(data.totalAmount) || 0;
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
    const paymentsSnapshot = await getDocs(
      query(paymentsRef, where('status', '==', 'paid'))
    );

    const yearlyData = {};

    paymentsSnapshot.forEach((doc) => {
      const data = doc.data();
      const year = data.year;
      const amount = Number(data.totalAmount) || 0;

      if (!yearlyData[year]) {
        yearlyData[year] = {
          year,
          totalIncome: 0,
          rentIncome: 0,
          electricityIncome: 0,
          paymentCount: 0
        };
      }

      yearlyData[year].totalIncome += amount;
      yearlyData[year].rentIncome += Number(data.rentAmount) || 0;
      yearlyData[year].electricityIncome += Number(data.electricityAmount) || 0;
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
    const paymentsSnapshot = await getDocs(
      query(
        paymentsRef,
        where('status', '==', 'paid'),
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
        monthlyData[monthIndex].totalIncome += Number(data.totalAmount) || 0;
        monthlyData[monthIndex].rentIncome += Number(data.rentAmount) || 0;
        monthlyData[monthIndex].electricityIncome += Number(data.electricityAmount) || 0;
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
    const paymentsSnapshot = await getDocs(
      query(paymentsRef, where('status', '==', 'paid'))
    );

    let total = 0;
    paymentsSnapshot.forEach((doc) => {
      const data = doc.data();
      total += Number(data.totalAmount) || 0;
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
