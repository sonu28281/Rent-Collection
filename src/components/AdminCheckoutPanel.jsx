import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy, doc, getDoc, updateDoc, setDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import {
  calculateElectricityCharges,
  calculatePendingRent,
  calculateSettlement,
  getLastMeterReading,
  validateCheckoutRequest,
  formatCurrency,
  generateCheckoutSummary
} from '../utils/checkoutUtils';
import { useDialog } from './ui/DialogProvider';

/**
 * AdminCheckoutPanel Component
 * 
 * Admin interface for managing tenant checkout requests:
 * - View pending checkout requests
 * - Approve/Reject requests
 * - Calculate final settlement
 * - Process checkout with atomic batch operations
 */
const AdminCheckoutPanel = () => {
  const { showConfirm, showAlert } = useDialog();
  const [checkoutRequests, setCheckoutRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingRequest, setProcessingRequest] = useState(null);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [settlementData, setSettlementData] = useState(null);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryData, setSummaryData] = useState(null);

  // Settlement form fields
  const [finalMeterReading, setFinalMeterReading] = useState('');
  const [ratePerUnit, setRatePerUnit] = useState(9);
  const [extraCharges, setExtraCharges] = useState(0);
  const [damageCharges, setDamageCharges] = useState(0);
  const [adjustDeposit, setAdjustDeposit] = useState(true);
  const [adminRemarks, setAdminRemarks] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchCheckoutRequests();
  }, []);

  const fetchCheckoutRequests = async () => {
    try {
      setLoading(true);

      // Fetch all pending checkout requests
      const requestsRef = collection(db, 'checkoutRequests');
      const requestsQuery = query(requestsRef, where('status', '==', 'pending'), orderBy('requestedAt', 'desc'));
      const requestsSnapshot = await getDocs(requestsQuery);

      const requestsData = [];
      for (const docSnap of requestsSnapshot.docs) {
        const request = { id: docSnap.id, ...docSnap.data() };
        
        // Fetch tenant details
        if (request.tenantId) {
          const tenantDoc = await getDoc(doc(db, 'tenants', request.tenantId));
          if (tenantDoc.exists()) {
            request.tenant = { id: tenantDoc.id, ...tenantDoc.data() };
          }
        }

        requestsData.push(request);
      }

      setCheckoutRequests(requestsData);
    } catch (error) {
      console.error('Error fetching checkout requests:', error);
      showAlert('Failed to load checkout requests', { intent: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async (request) => {
    const confirmed = await showConfirm(
      `Are you sure you want to reject the checkout request from ${request.tenantName}?`,
      { title: 'Reject Checkout Request', intent: 'warning' }
    );

    if (!confirmed) return;

    try {
      console.log('🚫 Rejecting checkout request:', request.id);

      // Update checkout request status
      await setDoc(doc(db, 'checkoutRequests', request.id), {
        status: 'rejected',
        rejectedAt: serverTimestamp(),
        rejectedBy: 'admin'
      }, { merge: true });

      // Update tenant status back to active - use setDoc with merge
      if (request.tenantId) {
        await setDoc(doc(db, 'tenants', request.tenantId), {
          status: 'active',
          checkoutRequestId: null,
          proposedCheckoutDate: null,
          updatedAt: serverTimestamp()
        }, { merge: true });
        console.log('✅ Tenant status reset to active');
      }

      await showAlert('Checkout request rejected', { intent: 'success' });
      fetchCheckoutRequests();
    } catch (error) {
      console.error('❌ Error rejecting checkout request:', error);
      console.error('Error details:', error.code, error.message);
      showAlert(`Failed to reject request: ${error.message}`, { intent: 'error' });
    }
  };

  const handleApprove = async (request) => {
    setProcessingRequest(request);

    try {
      // Fetch all necessary data
      const tenant = request.tenant;
      if (!tenant) {
        showAlert('Tenant data not found', { intent: 'error' });
        return;
      }

      // Fetch room
      const roomsSnapshot = await getDocs(query(collection(db, 'rooms'), where('roomNumber', '==', request.roomNumber)));
      let room = null;
      if (!roomsSnapshot.empty) {
        room = { id: roomsSnapshot.docs[0].id, ...roomsSnapshot.docs[0].data() };
      }

      // Fetch payment records
      const paymentsSnapshot = await getDocs(query(collection(db, 'payments'), where('tenantId', '==', tenant.id)));
      const paymentRecords = [];
      paymentsSnapshot.forEach(doc => {
        paymentRecords.push({ id: doc.id, ...doc.data() });
      });

      // Fetch meter history
      const meterSnapshot = await getDocs(query(collection(db, 'meterHistory'), where('tenantId', '==', tenant.id)));
      const meterRecords = [];
      meterSnapshot.forEach(doc => {
        meterRecords.push({ id: doc.id, ...doc.data() });
      });

      // Get last meter reading
      const lastReading = getLastMeterReading(meterRecords, tenant.id, request.roomNumber);

      // Calculate pending rent
      const { pendingRent, unpaidMonths } = calculatePendingRent(
        paymentRecords,
        tenant,
        request.proposedCheckoutDate
      );

      // Get electricity rate from settings
      const settingsDoc = await getDoc(doc(db, 'settings', 'global'));
      let electricityRate = 9;
      if (settingsDoc.exists()) {
        electricityRate = settingsDoc.data().electricityRate || 9;
      }

      // Prepare settlement data
      setSettlementData({
        request,
        tenant,
        room,
        paymentRecords,
        meterRecords,
        lastReading,
        pendingRent,
        unpaidMonths,
        electricityRate
      });

      // Pre-fill form
      setFinalMeterReading(request.finalMeterReadingDraft || lastReading || '');
      setRatePerUnit(electricityRate);
      setExtraCharges(0);
      setDamageCharges(0);
      setAdjustDeposit(true);
      setAdminRemarks('');

      setShowSettlementModal(true);
    } catch (error) {
      console.error('Error preparing settlement:', error);
      showAlert('Failed to prepare settlement', { intent: 'error' });
    } finally {
      setProcessingRequest(null);
    }
  };

  const calculateCurrentSettlement = () => {
    if (!settlementData) return null;

    const { lastReading, pendingRent, tenant } = settlementData;

    // Calculate electricity charges
    const { units, electricityCharges } = calculateElectricityCharges(
      finalMeterReading || lastReading,
      lastReading,
      ratePerUnit
    );

    // Calculate settlement
    const settlement = calculateSettlement({
      pendingRent,
      electricityCharges,
      extraCharges: parseFloat(extraCharges) || 0,
      damageCharges: parseFloat(damageCharges) || 0,
      securityDeposit: tenant.securityDeposit || 0,
      adjustDeposit
    });

    return { ...settlement, units, electricityCharges };
  };

  const handleFinalizeCheckout = async () => {
    if (!settlementData) return;

    const settlement = calculateCurrentSettlement();
    const { request, tenant, room } = settlementData;

    // Validate
    const validation = validateCheckoutRequest({
      tenant,
      room,
      checkoutDate: request.proposedCheckoutDate
    });

    if (!validation.isValid) {
      showAlert(validation.errors.join(', '), { intent: 'error' });
      return;
    }

    // Confirm
    const confirmed = await showConfirm(
      `Final Amount: ${formatCurrency(settlement.finalPayable)}\n\nThis will:\n• Mark tenant as inactive\n• Set room as vacant\n• Create final settlement record\n\nProceed with checkout?`,
      { title: 'Confirm Checkout', intent: 'warning' }
    );

    if (!confirmed) return;

    try {
      setProcessing(true);

      // Use Firestore batch for atomic operations
      const batch = writeBatch(db);

      // 1. Create final settlement payment record
      const settlementRef = doc(collection(db, 'payments'));
      batch.set(settlementRef, {
        tenantId: tenant.id,
        tenantName: tenant.name,
        roomNumber: request.roomNumber,
        amount: settlement.finalPayable,
        paymentType: 'checkout_settlement',
        isFinalSettlement: true,
        status: settlement.finalPayable <= 0 ? 'paid' : 'pending',
        checkoutDate: request.proposedCheckoutDate,
        finalMeterReading: parseFloat(finalMeterReading) || settlementData.lastReading,
        lastMeterReading: settlementData.lastReading,
        unitsConsumed: settlement.units,
        electricityCharges: settlement.electricityCharges,
        ratePerUnit: parseFloat(ratePerUnit),
        extraCharges: parseFloat(extraCharges) || 0,
        damageCharges: parseFloat(damageCharges) || 0,
        pendingRent: settlement.breakdown.pendingRent,
        depositAdjusted: adjustDeposit,
        depositAdjustedAmount: settlement.depositAdjustment,
        depositRefundable: settlement.depositRefundable,
        breakdown: settlement.breakdown,
        adminRemarks,
        createdAt: serverTimestamp(),
        createdBy: 'admin'
      });

      // 2. Update tenant status - use set with merge for new fields
      const tenantRef = doc(db, 'tenants', tenant.id);
      batch.set(tenantRef, {
        status: 'inactive',
        isActive: false,
        checkOutDate: request.proposedCheckoutDate,
        depositAdjustedAmount: settlement.depositAdjustment,
        depositReturned: true,
        checkoutSettlementId: settlementRef.id,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // 3. Update room status if exists - use set with merge for new fields
      if (room) {
        const roomRef = doc(db, 'rooms', room.id);
        batch.set(roomRef, {
          status: 'vacant',
          currentTenantId: null,
          lastStatusUpdatedAt: serverTimestamp()
        }, { merge: true });
      }

      // 4. Update checkout request status
      const requestRef = doc(db, 'checkoutRequests', request.id);
      batch.set(requestRef, {
        status: 'completed',
        completedAt: serverTimestamp(),
        completedBy: 'admin',
        settlementId: settlementRef.id
      }, { merge: true });

      // Commit batch
      await batch.commit();

      // Show success and summary
      setSummaryData({
        tenant,
        room,
        settlement,
        checkoutDate: request.proposedCheckoutDate,
        finalMeterReading: parseFloat(finalMeterReading) || settlementData.lastReading,
        lastMeterReading: settlementData.lastReading
      });

      setShowSettlementModal(false);
      setShowSummaryModal(true);

      await showAlert('Checkout completed successfully!', { intent: 'success' });
      fetchCheckoutRequests();
    } catch (error) {
      console.error('Error finalizing checkout:', error);
      showAlert('Failed to finalize checkout. Please try again.', { intent: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const downloadSummary = () => {
    if (!summaryData) return;

    const summary = generateCheckoutSummary(
      summaryData.settlement,
      summaryData.tenant,
      summaryData.checkoutDate
    );

    const blob = new Blob([summary], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `checkout-settlement-${summaryData.tenant.roomNumber}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading checkout requests...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Checkout Requests</h1>
        <p className="text-gray-600">Manage tenant checkout requests and settlements</p>
      </div>

      {/* Requests List */}
      {checkoutRequests.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-2">No Pending Requests</h3>
          <p className="text-gray-600">There are no checkout requests at the moment</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {checkoutRequests.map((request) => (
            <div key={request.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-lg font-semibold text-gray-900">{request.tenantName}</h3>
                    <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded">
                      Room {request.roomNumber}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600">Proposed Checkout:</span>
                      <p className="font-medium text-gray-900">
                        {new Date(request.proposedCheckoutDate).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                    {request.finalMeterReadingDraft && (
                      <div>
                        <span className="text-gray-600">Meter Reading:</span>
                        <p className="font-medium text-gray-900">{request.finalMeterReadingDraft}</p>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-600">Requested On:</span>
                      <p className="font-medium text-gray-900">
                        {request.requestedAt ? new Date(request.requestedAt.toDate()).toLocaleDateString('en-IN') : '-'}
                      </p>
                    </div>
                  </div>

                  {request.remarks && (
                    <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                      <span className="text-xs text-gray-600 font-medium">Remarks:</span>
                      <p className="text-sm text-gray-900 mt-1">{request.remarks}</p>
                    </div>
                  )}

                  {request.tenant && (
                    <div className="mt-3 flex gap-4 text-xs text-gray-600">
                      {request.tenant.checkInDate && (
                        <span>Check-in: {new Date(request.tenant.checkInDate).toLocaleDateString('en-IN')}</span>
                      )}
                      {request.tenant.securityDeposit > 0 && (
                        <span>Security Deposit: ₹{request.tenant.securityDeposit.toLocaleString('en-IN')}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 ml-4">
                  <button
                    onClick={() => handleApprove(request)}
                    disabled={processingRequest === request}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium whitespace-nowrap"
                  >
                    {processingRequest === request ? 'Processing...' : 'Approve & Settle'}
                  </button>
                  <button
                    onClick={() => handleReject(request)}
                    className="px-4 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors text-sm font-medium whitespace-nowrap"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Settlement Modal */}
      {showSettlementModal && settlementData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full my-8">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-green-500 to-teal-500 text-white px-6 py-4 rounded-t-lg">
              <h2 className="text-xl font-bold">Final Settlement</h2>
              <p className="text-sm text-white/90 mt-1">
                {settlementData.tenant.name} - Room {settlementData.request.roomNumber}
              </p>
            </div>

            {/* Modal Body */}
            <div className="p-6 max-h-[calc(100vh-200px)] overflow-y-auto">
              {/* Tenant Info */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 className="font-semibold text-blue-900 mb-2">Tenant Information</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-blue-700">Check-in Date:</span>
                    <p className="font-medium text-blue-900">
                      {settlementData.tenant.checkInDate ? new Date(settlementData.tenant.checkInDate).toLocaleDateString('en-IN') : '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-blue-700">Checkout Date:</span>
                    <p className="font-medium text-blue-900">
                      {new Date(settlementData.request.proposedCheckoutDate).toLocaleDateString('en-IN')}
                    </p>
                  </div>
                  <div>
                    <span className="text-blue-700">Security Deposit:</span>
                    <p className="font-medium text-blue-900">
                      ₹{(settlementData.tenant.securityDeposit || 0).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div>
                    <span className="text-blue-700">Current Rent:</span>
                    <p className="font-medium text-blue-900">
                      ₹{(settlementData.tenant.currentRent || 0).toLocaleString('en-IN')}
                    </p>
                  </div>
                </div>
              </div>

              {/* Pending Rent Warning */}
              {settlementData.unpaidMonths > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-yellow-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <div>
                      <p className="font-semibold text-yellow-900">Unpaid Rent: {settlementData.unpaidMonths} month(s)</p>
                      <p className="text-sm text-yellow-800 mt-1">
                        Total Pending: ₹{settlementData.pendingRent.toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Settlement Form */}
              <div className="space-y-4">
                {/* Meter Reading */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Last Meter Reading
                    </label>
                    <input
                      type="number"
                      value={settlementData.lastReading}
                      disabled
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Final Meter Reading <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      value={finalMeterReading}
                      onChange={(e) => setFinalMeterReading(e.target.value)}
                      min={settlementData.lastReading}
                      step="0.01"
                      required
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Rate Per Unit */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Rate Per Unit (₹)
                  </label>
                  <input
                    type="number"
                    value={ratePerUnit}
                    onChange={(e) => setRatePerUnit(e.target.value)}
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  />
                </div>

                {/* Extra and Damage Charges */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Extra Charges (₹)
                    </label>
                    <input
                      type="number"
                      value={extraCharges}
                      onChange={(e) => setExtraCharges(e.target.value)}
                      min="0"
                      step="0.01"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Damage Charges (₹)
                    </label>
                    <input
                      type="number"
                      value={damageCharges}
                      onChange={(e) => setDamageCharges(e.target.value)}
                      min="0"
                      step="0.01"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                  </div>
                </div>

                {/* Adjust Security Deposit */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="adjustDeposit"
                    checked={adjustDeposit}
                    onChange={(e) => setAdjustDeposit(e.target.checked)}
                    className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                  />
                  <label htmlFor="adjustDeposit" className="text-sm font-medium text-gray-700 cursor-pointer">
                    Adjust Security Deposit (deduct charges from deposit)
                  </label>
                </div>

                {/* Admin Remarks */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Admin Remarks
                  </label>
                  <textarea
                    value={adminRemarks}
                    onChange={(e) => setAdminRemarks(e.target.value)}
                    rows="3"
                    placeholder="Any notes about this checkout..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
                  />
                </div>

                {/* Settlement Summary */}
                {(() => {
                  const current = calculateCurrentSettlement();
                  if (!current) return null;

                  return (
                    <div className="bg-gradient-to-r from-gray-50 to-gray-100 border border-gray-300 rounded-lg p-4">
                      <h3 className="font-semibold text-gray-900 mb-3">Settlement Summary</h3>
                      <div className="space-y-2 text-sm">
                        {current.breakdown.pendingRent > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Pending Rent:</span>
                            <span className="font-medium text-gray-900">{formatCurrency(current.breakdown.pendingRent)}</span>
                          </div>
                        )}
                        {current.units > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Electricity ({current.units.toFixed(2)} units @ ₹{ratePerUnit}):</span>
                            <span className="font-medium text-gray-900">{formatCurrency(current.electricityCharges)}</span>
                          </div>
                        )}
                        {current.breakdown.extraCharges > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Extra Charges:</span>
                            <span className="font-medium text-gray-900">{formatCurrency(current.breakdown.extraCharges)}</span>
                          </div>
                        )}
                        {current.breakdown.damageCharges > 0 && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">Damage Charges:</span>
                            <span className="font-medium text-gray-900">{formatCurrency(current.breakdown.damageCharges)}</span>
                          </div>
                        )}
                        <div className="border-t border-gray-300 pt-2">
                          <div className="flex justify-between font-semibold">
                            <span className="text-gray-700">Subtotal:</span>
                            <span className="text-gray-900">{formatCurrency(current.breakdown.subtotal)}</span>
                          </div>
                        </div>
                        {adjustDeposit && current.depositAdjustment > 0 && (
                          <div className="flex justify-between text-green-600">
                            <span>Deposit Adjustment:</span>
                            <span className="font-medium">- {formatCurrency(current.depositAdjustment)}</span>
                          </div>
                        )}
                        <div className="border-t border-gray-300 pt-2">
                          <div className="flex justify-between text-lg font-bold">
                            <span className="text-gray-900">Final Amount:</span>
                            <span className={current.finalPayable >= 0 ? 'text-red-600' : 'text-green-600'}>
                              {current.finalPayable >= 0 ? 'To Collect: ' : 'To Refund: '}
                              {formatCurrency(Math.abs(current.finalPayable))}
                            </span>
                          </div>
                        </div>
                        {current.depositRefundable > 0 && (
                          <div className="flex justify-between text-green-600">
                            <span>Deposit Refundable:</span>
                            <span className="font-medium">{formatCurrency(current.depositRefundable)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 rounded-b-lg flex gap-3">
              <button
                onClick={() => setShowSettlementModal(false)}
                disabled={processing}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                onClick={handleFinalizeCheckout}
                disabled={processing || !finalMeterReading}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-green-500 to-teal-500 text-white rounded-lg hover:from-green-600 hover:to-teal-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {processing ? 'Processing...' : 'Finalize Checkout'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary Modal */}
      {showSummaryModal && summaryData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
            <div className="bg-gradient-to-r from-green-500 to-teal-500 text-white px-6 py-4 rounded-t-lg">
              <h2 className="text-xl font-bold">✅ Checkout Completed</h2>
            </div>

            <div className="p-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {summaryData.tenant.name} - Room {summaryData.room?.roomNumber || summaryData.tenant.roomNumber}
                </h3>
                <p className="text-gray-600">
                  Checkout Date: {new Date(summaryData.checkoutDate).toLocaleDateString('en-IN')}
                </p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2 text-sm mb-6">
                <div className="flex justify-between">
                  <span className="text-gray-600">Final Amount:</span>
                  <span className="font-bold text-lg text-gray-900">
                    {formatCurrency(summaryData.settlement.finalPayable)}
                  </span>
                </div>
                {summaryData.settlement.depositRefundable > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Deposit Refundable:</span>
                    <span className="font-medium">{formatCurrency(summaryData.settlement.depositRefundable)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600">Room Status:</span>
                  <span className="font-medium text-gray-900">Vacant</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Tenant Status:</span>
                  <span className="font-medium text-gray-900">Inactive</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowSummaryModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={downloadSummary}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-lg hover:from-blue-600 hover:to-indigo-600 transition-colors font-medium"
                >
                  Download Summary
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminCheckoutPanel;
