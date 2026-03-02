/**
 * Tenant Checkout System - Utility Functions
 * Version: 1.0.0
 * 
 * Functions for calculating final settlement amounts during tenant checkout.
 */

/**
 * Calculate electricity charges based on meter readings
 * @param {number} finalReading - Final meter reading at checkout
 * @param {number} lastReading - Last recorded meter reading
 * @param {number} ratePerUnit - Rate per unit of electricity
 * @returns {Object} - { units, electricityCharges, error }
 */
export const calculateElectricityCharges = (finalReading, lastReading, ratePerUnit) => {
  try {
    const final = parseFloat(finalReading) || 0;
    const last = parseFloat(lastReading) || 0;
    const rate = parseFloat(ratePerUnit) || 0;

    // Validate readings
    if (final < 0 || last < 0) {
      return { units: 0, electricityCharges: 0, error: 'Meter readings cannot be negative' };
    }

    // Calculate units consumed
    let units = final - last;
    
    // If negative units (meter reset or error), set to 0
    if (units < 0) {
      console.warn('⚠️ Negative units detected. Setting to 0. Final:', final, 'Last:', last);
      units = 0;
    }

    const electricityCharges = units * rate;

    return {
      units: Math.max(0, units),
      electricityCharges: Math.max(0, electricityCharges),
      error: null
    };
  } catch (error) {
    console.error('Error calculating electricity charges:', error);
    return { units: 0, electricityCharges: 0, error: error.message };
  }
};

/**
 * Calculate total pending rent for a tenant
 * @param {Array} paymentRecords - All payment records for the tenant
 * @param {Object} tenant - Tenant object with rent information
 * @param {Date} checkoutDate - Proposed checkout date
 * @returns {Object} - { pendingRent, unpaidMonths, details }
 */
export const calculatePendingRent = (paymentRecords, tenant, checkoutDate) => {
  try {
    const checkoutDateObj = new Date(checkoutDate);
    const checkInDateObj = new Date(tenant.checkInDate);
    
    if (!tenant.checkInDate) {
      return { pendingRent: 0, unpaidMonths: 0, details: [] };
    }

    const currentRent = parseFloat(tenant.currentRent) || 0;
    
    // Get all months between check-in and checkout
    const months = [];
    const current = new Date(checkInDateObj.getFullYear(), checkInDateObj.getMonth(), 1);
    const end = new Date(checkoutDateObj.getFullYear(), checkoutDateObj.getMonth(), 1);
    
    while (current <= end) {
      months.push({
        year: current.getFullYear(),
        month: current.getMonth() + 1,
        key: `${current.getFullYear()}-${current.getMonth() + 1}`
      });
      current.setMonth(current.getMonth() + 1);
    }

    // Check which months are paid
    const unpaidMonths = [];
    let totalPendingRent = 0;

    months.forEach(monthInfo => {
      const isPaid = paymentRecords.some(payment => 
        payment.year === monthInfo.year && 
        payment.month === monthInfo.month && 
        payment.status === 'paid'
      );

      if (!isPaid) {
        unpaidMonths.push(monthInfo);
        totalPendingRent += currentRent;
      }
    });

    return {
      pendingRent: totalPendingRent,
      unpaidMonths: unpaidMonths.length,
      details: unpaidMonths
    };
  } catch (error) {
    console.error('Error calculating pending rent:', error);
    return { pendingRent: 0, unpaidMonths: 0, details: [], error: error.message };
  }
};

/**
 * Calculate final settlement amount
 * @param {Object} params - { pendingRent, electricityCharges, extraCharges, damageCharges, securityDeposit, adjustDeposit }
 * @returns {Object} - { finalTotal, depositAdjustment, finalPayable, breakdown }
 */
export const calculateSettlement = (params) => {
  try {
    const {
      pendingRent = 0,
      electricityCharges = 0,
      extraCharges = 0,
      damageCharges = 0,
      securityDeposit = 0,
      adjustDeposit = false
    } = params;

    const finalTotal = 
      parseFloat(pendingRent) + 
      parseFloat(electricityCharges) + 
      parseFloat(extraCharges) + 
      parseFloat(damageCharges);

    let depositAdjustment = 0;
    let finalPayable = finalTotal;

    if (adjustDeposit) {
      depositAdjustment = Math.min(finalTotal, parseFloat(securityDeposit));
      finalPayable = finalTotal - depositAdjustment;
    }

    const breakdown = {
      pendingRent: parseFloat(pendingRent),
      electricityCharges: parseFloat(electricityCharges),
      extraCharges: parseFloat(extraCharges),
      damageCharges: parseFloat(damageCharges),
      subtotal: finalTotal,
      depositAdjustment: adjustDeposit ? depositAdjustment : 0,
      finalPayable: finalPayable
    };

    return {
      finalTotal,
      depositAdjustment,
      finalPayable,
      depositRefundable: adjustDeposit ? (parseFloat(securityDeposit) - depositAdjustment) : parseFloat(securityDeposit),
      breakdown
    };
  } catch (error) {
    console.error('Error calculating settlement:', error);
    return {
      finalTotal: 0,
      depositAdjustment: 0,
      finalPayable: 0,
      depositRefundable: 0,
      breakdown: {},
      error: error.message
    };
  }
};

/**
 * Get last meter reading for a tenant
 * @param {Array} meterRecords - All meter history records
 * @param {string} tenantId - Tenant ID
 * @param {string} roomNumber - Room number
 * @returns {number} - Last meter reading
 */
export const getLastMeterReading = (meterRecords, tenantId, roomNumber) => {
  try {
    // Filter records for this tenant/room and sort by date
    const relevantRecords = meterRecords
      .filter(record => 
        (record.tenantId === tenantId || record.roomNumber === roomNumber) &&
        record.currentReading !== undefined
      )
      .sort((a, b) => {
        const dateA = new Date(a.createdAt || a.readingDate);
        const dateB = new Date(b.createdAt || b.readingDate);
        return dateB - dateA; // Most recent first
      });

    if (relevantRecords.length > 0) {
      return parseFloat(relevantRecords[0].currentReading) || 0;
    }

    return 0;
  } catch (error) {
    console.error('Error getting last meter reading:', error);
    return 0;
  }
};

/**
 * Validate checkout request
 * @param {Object} params - { tenant, room, checkoutDate }
 * @returns {Object} - { isValid, errors }
 */
export const validateCheckoutRequest = (params) => {
  const { tenant, room, checkoutDate } = params;
  const errors = [];

  // Check if tenant is active
  if (!tenant) {
    errors.push('Tenant not found');
  } else if (tenant.status === 'inactive' || tenant.isActive === false) {
    errors.push('Tenant is already inactive');
  } else if (tenant.status === 'checkout_requested') {
    errors.push('Checkout request already pending');
  }

  // Check if room exists and is occupied
  if (!room) {
    errors.push('Room not found');
  } else if (room.status === 'vacant') {
    errors.push('Room is already vacant');
  }

  // Validate checkout date
  if (!checkoutDate) {
    errors.push('Checkout date is required');
  } else {
    const checkoutDateObj = new Date(checkoutDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (checkoutDateObj < today) {
      errors.push('Checkout date cannot be in the past');
    }

    if (tenant?.checkInDate) {
      const checkInDateObj = new Date(tenant.checkInDate);
      if (checkoutDateObj < checkInDateObj) {
        errors.push('Checkout date cannot be before check-in date');
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Format currency for display
 * @param {number} amount - Amount to format
 * @returns {string} - Formatted currency string
 */
export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amount || 0);
};

/**
 * Generate checkout summary text
 * @param {Object} settlement - Settlement calculation result
 * @param {Object} tenant - Tenant object
 * @param {string} checkoutDate - Checkout date
 * @returns {string} - Summary text
 */
export const generateCheckoutSummary = (settlement, tenant, checkoutDate) => {
  const { breakdown } = settlement;
  
  let summary = `CHECKOUT SETTLEMENT SUMMARY\n`;
  summary += `================================\n\n`;
  summary += `Tenant: ${tenant.name}\n`;
  summary += `Room: ${tenant.roomNumber}\n`;
  summary += `Checkout Date: ${new Date(checkoutDate).toLocaleDateString('en-IN')}\n\n`;
  summary += `CHARGES:\n`;
  summary += `--------------------------------\n`;
  if (breakdown.pendingRent > 0) summary += `Pending Rent: ${formatCurrency(breakdown.pendingRent)}\n`;
  if (breakdown.electricityCharges > 0) summary += `Electricity: ${formatCurrency(breakdown.electricityCharges)}\n`;
  if (breakdown.extraCharges > 0) summary += `Extra Charges: ${formatCurrency(breakdown.extraCharges)}\n`;
  if (breakdown.damageCharges > 0) summary += `Damage Charges: ${formatCurrency(breakdown.damageCharges)}\n`;
  summary += `--------------------------------\n`;
  summary += `Subtotal: ${formatCurrency(breakdown.subtotal)}\n\n`;
  
  if (breakdown.depositAdjustment > 0) {
    summary += `DEPOSIT ADJUSTMENT:\n`;
    summary += `--------------------------------\n`;
    summary += `Deposit Used: ${formatCurrency(breakdown.depositAdjustment)}\n\n`;
  }
  
  summary += `FINAL AMOUNT:\n`;
  summary += `--------------------------------\n`;
  summary += `${breakdown.finalPayable >= 0 ? 'To Pay' : 'To Refund'}: ${formatCurrency(Math.abs(breakdown.finalPayable))}\n`;
  
  if (settlement.depositRefundable > 0) {
    summary += `Deposit Refundable: ${formatCurrency(settlement.depositRefundable)}\n`;
  }
  
  return summary;
};
