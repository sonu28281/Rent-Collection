import { collection, doc, getDocs, updateDoc, setDoc, query, where } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Check all tenants for pending rent increases
 * @returns {Array} List of tenants due for rent increase
 */
export const checkPendingIncreases = async () => {
  try {
    const tenantsRef = collection(db, 'tenants');
    const tenantsSnapshot = await getDocs(tenantsRef);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset to start of day
    
    const pendingIncreases = [];
    
    tenantsSnapshot.forEach((doc) => {
      const tenant = doc.data();
      
      // Only check active tenants
      if (!tenant.isActive) return;
      
      // Check if nextIncreaseDate exists and has passed
      if (tenant.nextIncreaseDate) {
        const increaseDate = new Date(tenant.nextIncreaseDate);
        increaseDate.setHours(0, 0, 0, 0);
        
        if (increaseDate <= today) {
          pendingIncreases.push({
            id: doc.id,
            ...tenant,
            daysPastDue: Math.floor((today - increaseDate) / (1000 * 60 * 60 * 24))
          });
        }
      }
    });
    
    return pendingIncreases;
  } catch (error) {
    console.error('Error checking pending increases:', error);
    throw error;
  }
};

/**
 * Apply rent increase to a single tenant
 * @param {string} tenantId - Tenant document ID
 * @param {Object} tenantData - Current tenant data
 * @returns {Object} Updated tenant data
 */
export const applyRentIncrease = async (tenantId, tenantData) => {
  try {
    const increasePercentage = tenantData.annualIncreasePercentage || 10; // Default 10%
    const oldRent = tenantData.currentRent;
    const newRent = Math.round(oldRent * (1 + increasePercentage / 100));
    
    // Calculate next increase date (1 year from last increase)
    const currentIncreaseDate = new Date(tenantData.nextIncreaseDate);
    const nextIncreaseDate = new Date(currentIncreaseDate);
    nextIncreaseDate.setFullYear(nextIncreaseDate.getFullYear() + 1);
    
    // Update tenant document
    const tenantRef = doc(db, 'tenants', tenantId);
    await updateDoc(tenantRef, {
      currentRent: newRent,
      nextIncreaseDate: nextIncreaseDate.toISOString().split('T')[0]
    });
    
    // Log the change
    const logId = `rent_increase_${tenantId}_${Date.now()}`;
    const logData = {
      actor: 'admin',
      action: 'rent_increase',
      payload: {
        tenantId,
        tenantName: tenantData.name,
        roomNumber: tenantData.roomNumber,
        oldRent,
        newRent,
        increasePercentage,
        previousIncreaseDate: tenantData.nextIncreaseDate,
        nextIncreaseDate: nextIncreaseDate.toISOString().split('T')[0]
      },
      status: 'success',
      timestamp: new Date().toISOString()
    };
    
    await setDoc(doc(db, 'logs', logId), logData);
    
    return {
      oldRent,
      newRent,
      increasePercentage,
      nextIncreaseDate: nextIncreaseDate.toISOString().split('T')[0]
    };
  } catch (error) {
    console.error('Error applying rent increase:', error);
    
    // Log the error
    const logId = `rent_increase_error_${tenantId}_${Date.now()}`;
    await setDoc(doc(db, 'logs', logId), {
      actor: 'admin',
      action: 'rent_increase',
      payload: {
        tenantId,
        error: error.message
      },
      status: 'error',
      timestamp: new Date().toISOString()
    });
    
    throw error;
  }
};

/**
 * Apply rent increases to all eligible tenants
 * @returns {Object} Summary of increases applied
 */
export const applyBulkRentIncreases = async () => {
  try {
    const pendingIncreases = await checkPendingIncreases();
    
    if (pendingIncreases.length === 0) {
      return {
        success: 0,
        failed: 0,
        message: 'No tenants due for rent increase'
      };
    }
    
    let successCount = 0;
    let failedCount = 0;
    const results = [];
    
    for (const tenant of pendingIncreases) {
      try {
        const result = await applyRentIncrease(tenant.id, tenant);
        successCount++;
        results.push({
          tenantName: tenant.name,
          roomNumber: tenant.roomNumber,
          ...result,
          status: 'success'
        });
      } catch (error) {
        failedCount++;
        results.push({
          tenantName: tenant.name,
          roomNumber: tenant.roomNumber,
          error: error.message,
          status: 'failed'
        });
      }
    }
    
    return {
      success: successCount,
      failed: failedCount,
      total: pendingIncreases.length,
      results
    };
  } catch (error) {
    console.error('Error in bulk rent increases:', error);
    throw error;
  }
};

/**
 * Get recent rent increase logs
 * @param {number} limit - Number of logs to fetch
 * @returns {Array} Recent rent increase logs
 */
export const getRecentRentIncreaseLogs = async (limit = 10) => {
  try {
    const logsRef = collection(db, 'logs');
    const logsQuery = query(
      logsRef,
      where('action', '==', 'rent_increase')
    );
    
    const logsSnapshot = await getDocs(logsQuery);
    
    const logs = [];
    logsSnapshot.forEach((doc) => {
      logs.push({ id: doc.id, ...doc.data() });
    });
    
    // Sort by timestamp descending
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    return logs.slice(0, limit);
  } catch (error) {
    console.error('Error fetching rent increase logs:', error);
    throw error;
  }
};
