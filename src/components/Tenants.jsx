import { useState, useEffect } from 'react';
import { collection, getDocs, updateDoc, deleteDoc, doc, query, where, orderBy, addDoc, setDoc, getDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import TenantForm from './TenantForm';
import { useDialog } from './ui/DialogProvider';
import useResponsiveViewMode from '../utils/useResponsiveViewMode';
import {
  calculateElectricityCharges,
  calculatePendingRent,
  calculateSettlement,
  getLastMeterReading,
  validateCheckoutRequest,
  formatCurrency,
  generateCheckoutSummary
} from '../utils/checkoutUtils';

const Tenants = () => {
  const { showConfirm, showAlert } = useDialog();
  const [tenants, setTenants] = useState([]);
  const [applicants, setApplicants] = useState([]); // KYC applicants (not yet tenants)
  const [checkoutRequests, setCheckoutRequests] = useState([]); // Checkout requests
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const [filter, setFilter] = useState('all'); // all, active, inactive
  const [kycFilter, setKycFilter] = useState('all'); // all, verified, not_verified
  const [floorFilter, setFloorFilter] = useState('all'); // all, floor1, floor2
  const [categoryFilter, setCategoryFilter] = useState('tenants'); // tenants, applicants, checkouts
  const [viewingKyc, setViewingKyc] = useState(null); // Applicant whose KYC to view
  const [assigningRoom, setAssigningRoom] = useState(null); // Applicant being assigned a room
  const [assignRoomNumber, setAssignRoomNumber] = useState('');
  const [assignRent, setAssignRent] = useState('');
  const [assigningInProgress, setAssigningInProgress] = useState(false);
  const { viewMode, setViewMode } = useResponsiveViewMode('tenants-view-mode', 'table');
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [selectedTenantHistory, setSelectedTenantHistory] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [mergeTargetTenantId, setMergeTargetTenantId] = useState('');
  const [mergeSourceTenantId, setMergeSourceTenantId] = useState('');
  const [mergingTenants, setMergingTenants] = useState(false);
  const [isFloorFilterExpanded, setIsFloorFilterExpanded] = useState(false);
  
  // Checkout request states
  const [processingRequest, setProcessingRequest] = useState(null);
  const [showSettlementModal, setShowSettlementModal] = useState(false);
  const [settlementData, setSettlementData] = useState(null);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [summaryData, setSummaryData] = useState(null);
  const [finalMeterReading, setFinalMeterReading] = useState('');
  const [ratePerUnit, setRatePerUnit] = useState(9);
  const [extraCharges, setExtraCharges] = useState(0);
  const [damageCharges, setDamageCharges] = useState(0);
  const [adjustDeposit, setAdjustDeposit] = useState(true);
  const [adminRemarks, setAdminRemarks] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const updateViewport = () => {
      const isMobile = mediaQuery.matches;
      setIsMobileViewport(isMobile);
      if (isMobile) {
        setFloorFilter('all');
      }
    };

    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);

    return () => {
      mediaQuery.removeEventListener('change', updateViewport);
    };
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Fetch tenants
      const tenantsRef = collection(db, 'tenants');
      const tenantsQuery = query(tenantsRef, orderBy('createdAt', 'desc'));
      const tenantsSnapshot = await getDocs(tenantsQuery);
      
      const tenantsData = [];
      tenantsSnapshot.forEach((doc) => {
        tenantsData.push({ id: doc.id, ...doc.data() });
      });
      
      // Fetch rooms
      const roomsRef = collection(db, 'rooms');
      const roomsSnapshot = await getDocs(roomsRef);
      
      const roomsData = [];
      roomsSnapshot.forEach((doc) => {
        roomsData.push({ id: doc.id, ...doc.data() });
      });

      // Fetch applicants (tenantApplications)
      const applicationsRef = collection(db, 'tenantApplications');
      const applicationsQuery = query(applicationsRef, orderBy('submittedAt', 'desc'));
      let applicantsData = [];
      try {
        const applicationsSnapshot = await getDocs(applicationsQuery);
        applicationsSnapshot.forEach((doc) => {
          applicantsData.push({ id: doc.id, ...doc.data() });
        });
      } catch (appErr) {
        // tenantApplications collection may not exist yet — ignore
        console.warn('Could not fetch tenantApplications:', appErr.message);
      }

      // Fetch checkout requests (all statuses for admin management)
      const checkoutRequestsRef = collection(db, 'checkoutRequests');
      const checkoutRequestsQuery = query(checkoutRequestsRef, orderBy('requestedAt', 'desc'));
      let checkoutRequestsData = [];
      try {
        const checkoutSnapshot = await getDocs(checkoutRequestsQuery);
        console.log('📋 Total checkout requests in database:', checkoutSnapshot.size);
        for (const docSnap of checkoutSnapshot.docs) {
          const request = { id: docSnap.id, ...docSnap.data() };
          console.log(`  🚪 Request: ${request.tenantName} (Room: ${request.roomNumber}, Status: ${request.status || 'NO STATUS'})`);
          
          // Fetch tenant details
          if (request.tenantId) {
            const tenantDoc = await getDoc(doc(db, 'tenants', request.tenantId));
            if (tenantDoc.exists()) {
              request.tenant = { id: tenantDoc.id, ...tenantDoc.data() };
            }
          }
          
          checkoutRequestsData.push(request);
        }
      } catch (checkoutErr) {
        console.warn('Could not fetch checkout requests:', checkoutErr.message);
      }
      
      setTenants(tenantsData);
      setRooms(roomsData);
      setApplicants(applicantsData);
      setCheckoutRequests(checkoutRequestsData);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load tenants. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTenant = () => {
    setEditingTenant(null);
    setShowForm(true);
  };

  const handleEditTenant = (tenant) => {
    setEditingTenant(tenant);
    setShowForm(true);
  };

  const handleFormClose = () => {
    setShowForm(false);
    setEditingTenant(null);
  };

  const handleFormSuccess = () => {
    setShowForm(false);
    setEditingTenant(null);
    fetchData();
  };

  const getAssignedRooms = (tenantRecord) => {
    if (Array.isArray(tenantRecord?.assignedRooms) && tenantRecord.assignedRooms.length > 0) {
      return tenantRecord.assignedRooms.map((room) => String(room));
    }
    if (tenantRecord?.roomNumber !== undefined && tenantRecord?.roomNumber !== null && tenantRecord?.roomNumber !== '') {
      return [String(tenantRecord.roomNumber)];
    }
    return [];
  };

  const getTenantById = (tenantId) => tenants.find((tenantRecord) => tenantRecord.id === tenantId) || null;

  const mergeTenantAccounts = async () => {
    if (!mergeTargetTenantId || !mergeSourceTenantId) {
      await showAlert('Please select both target and source tenant for merge.', { title: 'Selection Required', intent: 'warning' });
      return;
    }

    if (mergeTargetTenantId === mergeSourceTenantId) {
      await showAlert('Target and source tenant must be different.', { title: 'Invalid Merge', intent: 'warning' });
      return;
    }

    const targetTenant = getTenantById(mergeTargetTenantId);
    const sourceTenant = getTenantById(mergeSourceTenantId);

    if (!targetTenant || !sourceTenant) {
      await showAlert('Selected tenant record not found. Please refresh and try again.', { title: 'Tenant Missing', intent: 'error' });
      return;
    }

    const targetRooms = getAssignedRooms(targetTenant);
    const sourceRooms = getAssignedRooms(sourceTenant);
    const mergedRooms = [...new Set([...targetRooms, ...sourceRooms])].sort((a, b) => Number(a) - Number(b));

    const confirmed = await showConfirm(
      `Merge "${sourceTenant.name}" into "${targetTenant.name}"?\n\nTarget rooms: ${targetRooms.join(', ') || '-'}\nSource rooms: ${sourceRooms.join(', ') || '-'}\nMerged rooms: ${mergedRooms.join(', ') || '-'}\n\nSource tenant will be marked inactive after merge.`,
      { title: 'Confirm Tenant Merge', confirmLabel: 'Merge Now', intent: 'warning' }
    );

    if (!confirmed) {
      return;
    }

    setMergingTenants(true);

    try {
      // 1) Update target tenant with merged room assignments
      await updateDoc(doc(db, 'tenants', targetTenant.id), {
        assignedRooms: mergedRooms,
        roomNumber: mergedRooms[0] || targetTenant.roomNumber || '',
        isActive: true,
        updatedAt: new Date().toISOString(),
        mergedFromTenantIds: [...new Set([...(targetTenant.mergedFromTenantIds || []), sourceTenant.id])]
      });

      // 2) Move tenant-linked records from source tenantId -> target tenantId
      const moveRecordsByTenantId = async (collectionName, extraPayload = {}) => {
        const snapshot = await getDocs(query(collection(db, collectionName), where('tenantId', '==', sourceTenant.id)));
        const updatePromises = snapshot.docs.map((snapshotDoc) => {
          const existing = snapshotDoc.data();
          return updateDoc(snapshotDoc.ref, {
            tenantId: targetTenant.id,
            tenantName: targetTenant.name,
            tenantNameSnapshot: targetTenant.name,
            mergedFromTenantId: sourceTenant.id,
            mergedAt: new Date().toISOString(),
            ...extraPayload,
            ...(existing.roomNumbers ? { roomNumbers: [...new Set([...(existing.roomNumbers || []), ...mergedRooms])] } : {})
          });
        });
        await Promise.all(updatePromises);
      };

      await moveRecordsByTenantId('payments');
      await moveRecordsByTenantId('paymentSubmissions');
      await moveRecordsByTenantId('electricityReadings');

      // 3) Ensure merged rooms point to target tenant
      const roomsRef = collection(db, 'rooms');
      for (const roomNumber of mergedRooms) {
        const roomAsNumber = Number.parseInt(roomNumber, 10);
        const queryCandidates = [
          query(roomsRef, where('roomNumber', '==', roomNumber))
        ];
        if (Number.isFinite(roomAsNumber)) {
          queryCandidates.unshift(query(roomsRef, where('roomNumber', '==', roomAsNumber)));
        }

        let roomSnapshot = null;
        for (const roomQuery of queryCandidates) {
          const snapshot = await getDocs(roomQuery);
          if (!snapshot.empty) {
            roomSnapshot = snapshot;
            break;
          }
        }

        if (!roomSnapshot?.empty) {
          await updateDoc(roomSnapshot.docs[0].ref, {
            status: 'filled',
            currentTenantId: targetTenant.id,
            lastStatusUpdatedAt: new Date().toISOString()
          });
        }
      }

      // 4) Deactivate source tenant (keep audit/history)
      await updateDoc(doc(db, 'tenants', sourceTenant.id), {
        isActive: false,
        assignedRooms: [],
        roomNumber: '',
        mergedIntoTenantId: targetTenant.id,
        mergedIntoTenantName: targetTenant.name,
        mergedAt: new Date().toISOString()
      });

      setMergeSourceTenantId('');
      setMergeTargetTenantId('');
      await fetchData();
      await showAlert('Tenant accounts merged successfully.', { title: 'Merge Complete', intent: 'success' });
    } catch (error) {
      console.error('Error merging tenants:', error);
      await showAlert('Failed to merge tenant accounts. Please try again.', { title: 'Merge Failed', intent: 'error' });
    } finally {
      setMergingTenants(false);
    }
  };

  const handleDeleteTenant = async (tenantRecord) => {
    const confirmed = await showConfirm('Are you sure you want to delete this tenant?', {
      title: 'Delete Tenant',
      confirmLabel: 'Delete',
      intent: 'warning'
    });
    if (!confirmed) {
      return;
    }

    try {
      // Delete tenant
      await deleteDoc(doc(db, 'tenants', tenantRecord.id));
      
      // Update all assigned rooms to vacant
      const assignedRooms = getAssignedRooms(tenantRecord);
      if (assignedRooms.length > 0) {
        const roomsRef = collection(db, 'rooms');
        for (const roomNumber of assignedRooms) {
          const roomNumberAsNumber = Number.parseInt(roomNumber, 10);
          const queryCandidates = [
            query(roomsRef, where('roomNumber', '==', roomNumber))
          ];
          if (Number.isFinite(roomNumberAsNumber)) {
            queryCandidates.unshift(query(roomsRef, where('roomNumber', '==', roomNumberAsNumber)));
          }

          let roomSnapshot = null;
          for (const roomQuery of queryCandidates) {
            const snapshot = await getDocs(roomQuery);
            if (!snapshot.empty) {
              roomSnapshot = snapshot;
              break;
            }
          }

          if (!roomSnapshot?.empty) {
            const roomDoc = roomSnapshot.docs[0];
            await updateDoc(doc(db, 'rooms', roomDoc.id), {
              status: 'vacant',
              currentTenantId: null
            });
          }
        }
      }
      
      fetchData();
      await showAlert('Tenant deleted successfully', { title: 'Deleted', intent: 'success' });
    } catch (err) {
      console.error('Error deleting tenant:', err);
      await showAlert('Failed to delete tenant. Please try again.', { title: 'Delete Failed', intent: 'error' });
    }
  };

  const handleResetKyc = async (tenant) => {
    const isKycVerified = tenant?.kyc?.verified === true;
    
    if (!isKycVerified) {
      await showAlert('This tenant is not KYC verified yet.', { 
        title: 'Not Verified', 
        intent: 'info' 
      });
      return;
    }

    const confirmed = await showConfirm(
      `Reset KYC status for ${tenant.name}? They will need to verify again with DigiLocker.`,
      {
        title: 'Reset KYC Status',
        confirmLabel: 'Reset KYC',
        intent: 'warning'
      }
    );
    
    if (!confirmed) {
      return;
    }

    try {
      const tenantRef = doc(db, 'tenants', tenant.id);
      await updateDoc(tenantRef, {
        'kyc.verified': false,
        'kyc.verifiedBy': null,
        'kyc.verifiedAt': null,
        'kyc.resetAt': new Date().toISOString(),
        'kyc.resetReason': 'Admin reset'
      });
      
      fetchData();
      await showAlert('KYC status reset successfully. Tenant can now verify again.', { 
        title: 'KYC Reset', 
        intent: 'success' 
      });
    } catch (err) {
      console.error('Error resetting KYC:', err);
      await showAlert('Failed to reset KYC status. Please try again.', { 
        title: 'Reset Failed', 
        intent: 'error' 
      });
    }
  };

  const handleViewHistory = async (tenant) => {
    setSelectedTenantHistory(tenant);
    setLoadingHistory(true);
    
    try {
      const paymentsRef = collection(db, 'payments');
      const assignedRooms = getAssignedRooms(tenant);

      const paymentDocs = new Map();

      // 1) Best match by tenantId (most reliable for current data)
      if (tenant.id) {
        const tenantIdQuery = query(paymentsRef, where('tenantId', '==', tenant.id));
        const tenantIdSnapshot = await getDocs(tenantIdQuery);
        tenantIdSnapshot.forEach((doc) => paymentDocs.set(doc.id, doc));
      }

      // 2) Fallback by assigned room numbers (supports old records with no tenantId)
      const roomQueries = [];
      assignedRooms.forEach((roomNumber) => {
        roomQueries.push(query(paymentsRef, where('roomNumber', '==', roomNumber)));

        const roomNumberAsNumber = Number.parseInt(roomNumber, 10);
        if (Number.isFinite(roomNumberAsNumber)) {
          roomQueries.push(query(paymentsRef, where('roomNumber', '==', roomNumberAsNumber)));
        }
      });

      const roomSnapshots = await Promise.all(roomQueries.map((roomQuery) => getDocs(roomQuery)));
      roomSnapshots.forEach((snapshot) => {
        snapshot.forEach((doc) => paymentDocs.set(doc.id, doc));
      });

      const tenantName = (tenant.name || '').trim().toLowerCase();

      const payments = Array.from(paymentDocs.values())
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((payment) => {
          if (payment.tenantId && tenant.id && payment.tenantId === tenant.id) {
            return true;
          }

          const snapshotName = (payment.tenantNameSnapshot || '').trim().toLowerCase();
          const legacyName = (payment.tenantName || '').trim().toLowerCase();

          return Boolean(tenantName) && (snapshotName === tenantName || legacyName === tenantName);
        })
        .sort((a, b) => {
          const yearDiff = Number(b.year || 0) - Number(a.year || 0);
          if (yearDiff !== 0) return yearDiff;
          return Number(b.month || 0) - Number(a.month || 0);
        });

      setPaymentHistory(payments);
    } catch (err) {
      console.error('Error fetching payment history:', err);
      await showAlert('Failed to load payment history', { title: 'History Error', intent: 'error' });
      setPaymentHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleCloseHistory = () => {
    setSelectedTenantHistory(null);
    setPaymentHistory([]);
  };

  // ── Applicant Handlers ──
  const handleAssignRoomToApplicant = async () => {
    if (!assigningRoom || !assignRoomNumber || !assignRent) return;
    const applicant = assigningRoom;

    const confirmed = await showConfirm(
      `Assign Room ${assignRoomNumber} to ${applicant.fullName || applicant.firstName || 'Applicant'} with rent ₹${Number(assignRent).toLocaleString('en-IN')}?`,
      { title: 'Confirm Room Assignment', intent: 'info' }
    );
    if (!confirmed) return;

    setAssigningInProgress(true);
    try {
      const roomNum = assignRoomNumber;
      const rent = Number(assignRent);
      const name = applicant.fullName || `${applicant.firstName || ''} ${applicant.lastName || ''}`.trim() || 'Unknown';
      const username = roomNum;
      const password = `rent${roomNum}`;
      const token = `tenant_${roomNum}_${Date.now()}`;

      // Create tenant document
      const tenantPayload = {
        name,
        phone: applicant.phone || '',
        roomNumber: roomNum,
        assignedRooms: [roomNum],
        currentRent: rent,
        baseRent: rent,
        checkInDate: new Date().toISOString().split('T')[0],
        isActive: true,
        username,
        password,
        token,
        dueDate: '1',
        securityDeposit: 0,
        annualIncreasePercentage: 0,
        preferredLanguage: 'hi',
        createdAt: new Date().toISOString(),
        createdFrom: 'applicant_conversion',
        applicationId: applicant.id,
        // Copy KYC data
        kyc: {
          verified: !!(applicant.digiLocker?.data?.verified || applicant.digiLocker?.verified || applicant.digiLocker?.status === 'verified'),
          verifiedBy: (applicant.digiLocker?.data?.verified || applicant.digiLocker?.verified || applicant.digiLocker?.status === 'verified') ? 'DigiLocker' : null,
          verifiedAt: applicant.digiLocker?.verifiedAt || applicant.digiLocker?.data?.verifiedAt || null,
          aadhaarQr: applicant.aadhaarQr || null,
          crossVerification: applicant.crossVerification || null,
          documents: {
            aadhaarFront: applicant.aadharFrontImage || null,
            aadhaarBack: applicant.aadharBackImage || null,
            selfie: applicant.selfieImage || null,
            panCard: applicant.panImage || null,
            drivingLicense: applicant.dlImage || null,
          },
          digiLocker: applicant.digiLocker || null,
        },
        kycStatus: (applicant.digiLocker?.data?.verified || applicant.digiLocker?.verified || applicant.digiLocker?.status === 'verified') ? 'completed' : 'pending',
      };

      const tenantRef = await addDoc(collection(db, 'tenants'), tenantPayload);

      // Update application status
      await updateDoc(doc(db, 'tenantApplications', applicant.id), {
        status: 'approved',
        approvedAt: new Date().toISOString(),
        assignedTenantId: tenantRef.id,
        assignedRoom: roomNum,
      });

      await showAlert(`✅ ${name} is now a tenant in Room ${roomNum}!`, { title: 'Success', intent: 'success' });
      setAssigningRoom(null);
      setAssignRoomNumber('');
      setAssignRent('');
      setCategoryFilter('tenants');
      fetchData();
    } catch (err) {
      console.error('Error assigning room:', err);
      await showAlert(`Failed to assign room: ${err.message}`, { title: 'Error', intent: 'error' });
    } finally {
      setAssigningInProgress(false);
    }
  };

  const handleDeleteApplicant = async (applicant) => {
    const name = applicant.fullName || applicant.firstName || 'Applicant';
    const confirmed = await showConfirm(
      `Delete applicant "${name}"? This cannot be undone.`,
      { title: 'Delete Applicant', intent: 'danger' }
    );
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, 'tenantApplications', applicant.id));
      await showAlert(`Applicant "${name}" deleted.`, { title: 'Deleted', intent: 'success' });
      fetchData();
    } catch (err) {
      console.error('Error deleting applicant:', err);
      await showAlert(`Failed: ${err.message}`, { title: 'Error', intent: 'error' });
    }
  };

  // ════════════════════ CHECKOUT REQUEST HANDLERS ════════════════════

  const handleRejectCheckout = async (request) => {
    const confirmed = await showConfirm(
      `Are you sure you want to reject the checkout request from ${request.tenantName}?`,
      { title: 'Cancel Checkout Request', intent: 'warning' }
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

      await showAlert('Checkout request cancelled', { intent: 'success' });
      fetchData();
    } catch (error) {
      console.error('❌ Error rejecting checkout request:', error);
      console.error('Error details:', error.code, error.message);
      await showAlert(`Failed to cancel request: ${error.message}`, { intent: 'error' });
    }
  };

  const handleDeleteCheckoutRequest = async (request) => {
    const confirmed = await showConfirm(
      `Delete checkout request from ${request.tenantName}?\n\nThis will permanently remove the request.`,
      { title: 'Delete Checkout Request', intent: 'danger', confirmLabel: 'Delete' }
    );

    if (!confirmed) return;

    try {
      console.log('🗑️ Deleting checkout request:', request.id);

      // Delete the checkout request
      await deleteDoc(doc(db, 'checkoutRequests', request.id));

      // Reset tenant status if needed
      if (request.tenantId) {
        await setDoc(doc(db, 'tenants', request.tenantId), {
          status: 'active',
          checkoutRequestId: null,
          proposedCheckoutDate: null,
          updatedAt: serverTimestamp()
        }, { merge: true });
        console.log('✅ Tenant status reset to active');
      }

      await showAlert('Checkout request deleted', { intent: 'success' });
      fetchData();
    } catch (error) {
      console.error('❌ Error deleting checkout request:', error);
      await showAlert(`Failed to delete request: ${error.message}`, { intent: 'error' });
    }
  };

  const handleApproveCheckout = async (request) => {
    setProcessingRequest(request);

    try {
      // Fetch all necessary data
      const tenant = request.tenant;
      if (!tenant) {
        await showAlert('Tenant data not found', { intent: 'error' });
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
      await showAlert('Failed to prepare settlement', { intent: 'error' });
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
      await showAlert(validation.errors.join(', '), { intent: 'error' });
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

      // 4. Update checkout request status (only if not force checkout)
      if (!request.isForceCheckout && request.id) {
        const requestRef = doc(db, 'checkoutRequests', request.id);
        batch.set(requestRef, {
          status: 'completed',
          completedAt: serverTimestamp(),
          completedBy: 'admin',
          settlementId: settlementRef.id
        }, { merge: true });
      }

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
      fetchData();
    } catch (error) {
      console.error('Error finalizing checkout:', error);
      await showAlert('Failed to finalize checkout. Please try again.', { intent: 'error' });
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

  // Force checkout - admin initiated checkout without tenant request
  const handleForceCheckout = async (tenant) => {
    const confirmed = await showConfirm(
      `Force checkout for ${tenant.name}?\n\nThis will initiate checkout process without tenant request. Use this when tenant leaves without formal checkout request.`,
      { title: 'Force Checkout', intent: 'warning' }
    );

    if (!confirmed) return;

    setProcessingRequest(tenant);

    try {
      // Fetch room
      const assignedRooms = getAssignedRooms(tenant);
      const roomNumber = assignedRooms[0] || tenant.roomNumber;
      
      const roomsSnapshot = await getDocs(query(collection(db, 'rooms'), where('roomNumber', '==', roomNumber)));
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
      const lastReading = getLastMeterReading(meterRecords, tenant.id, roomNumber);

      // Calculate pending rent up to today
      const { pendingRent, unpaidMonths } = calculatePendingRent(
        paymentRecords,
        tenant,
        new Date().toISOString().split('T')[0] // Today's date
      );

      // Get electricity rate from settings
      const settingsDoc = await getDoc(doc(db, 'settings', 'global'));
      let electricityRate = 9;
      if (settingsDoc.exists()) {
        electricityRate = settingsDoc.data().electricityRate || 9;
      }

      // Prepare settlement data (use fake request object)
      setSettlementData({
        request: {
          proposedCheckoutDate: new Date().toISOString().split('T')[0],
          roomNumber: roomNumber,
          finalMeterReadingDraft: lastReading,
          isForceCheckout: true // Flag to indicate this is force checkout
        },
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
      setFinalMeterReading(lastReading || '');
      setRatePerUnit(electricityRate);
      setExtraCharges(0);
      setDamageCharges(0);
      setAdjustDeposit(true);
      setAdminRemarks('Force checkout initiated by admin');

      setShowSettlementModal(true);
    } catch (error) {
      console.error('Error preparing force checkout:', error);
      await showAlert('Failed to prepare checkout settlement', { intent: 'error' });
    } finally {
      setProcessingRequest(null);
    }
  };

  // Available rooms for assignment (not occupied by active tenants)
  const getAvailableRooms = () => {
    const occupiedRoomNumbers = new Set();
    tenants.forEach(t => {
      if (t.isActive) {
        const assigned = getAssignedRooms(t);
        assigned.forEach(r => occupiedRoomNumbers.add(r));
      }
    });
    return rooms.filter(r => !occupiedRoomNumbers.has(String(r.roomNumber)));
  };

  const filteredTenants = tenants.filter(tenant => {
    // Active/Inactive filter
    let matchesActiveFilter = true;
    if (filter === 'active') matchesActiveFilter = tenant.isActive;
    if (filter === 'inactive') matchesActiveFilter = !tenant.isActive;

    // KYC filter
    const isKycVerified = tenant?.kyc?.verified === true && tenant?.kyc?.verifiedBy === 'DigiLocker';
    let matchesKycFilter = true;
    if (kycFilter === 'verified') matchesKycFilter = isKycVerified;
    if (kycFilter === 'not_verified') matchesKycFilter = !isKycVerified;
    
    // Floor filter
    let matchesFloorFilter = true;
    const assignedRoomNumbers = getAssignedRooms(tenant).map((room) => Number.parseInt(room, 10));

    if (floorFilter === 'floor1') {
      matchesFloorFilter = assignedRoomNumbers.some((roomNum) => roomNum >= 101 && roomNum <= 106);
    }
    if (floorFilter === 'floor2') {
      matchesFloorFilter = assignedRoomNumbers.some((roomNum) => roomNum >= 201 && roomNum <= 206);
    }
    
    return matchesActiveFilter && matchesKycFilter && matchesFloorFilter;
  });

  const getRoomNumberValue = (roomNumber) => {
    const parsed = Number.parseInt(roomNumber, 10);
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  };

  const sortedTenants = [...filteredTenants].sort((a, b) => {
    const primaryRoomA = getAssignedRooms(a)[0] || a.roomNumber;
    const primaryRoomB = getAssignedRooms(b)[0] || b.roomNumber;
    const roomDiff = getRoomNumberValue(primaryRoomA) - getRoomNumberValue(primaryRoomB);
    if (roomDiff !== 0) return roomDiff;
    return (a.name || '').localeCompare(b.name || '');
  });

  const stats = {
    total: tenants.length,
    active: tenants.filter(t => t.isActive).length,
    inactive: tenants.filter(t => !t.isActive).length,
    kycVerified: tenants.filter((t) => t?.kyc?.verified === true && t?.kyc?.verifiedBy === 'DigiLocker').length,
    kycNotVerified: tenants.filter((t) => !(t?.kyc?.verified === true && t?.kyc?.verifiedBy === 'DigiLocker')).length,
    floor1: tenants.filter(t => {
      const assignedRoomNumbers = getAssignedRooms(t).map((room) => Number.parseInt(room, 10));
      return assignedRoomNumbers.some((roomNum) => roomNum >= 101 && roomNum <= 106);
    }).length,
    floor2: tenants.filter(t => {
      const assignedRoomNumbers = getAssignedRooms(t).map((room) => Number.parseInt(room, 10));
      return assignedRoomNumbers.some((roomNum) => roomNum >= 201 && roomNum <= 206);
    }).length,
    applicants: applicants.length,
    applicantsPending: applicants.filter(a => a.status === 'pending_approval').length,
    applicantsApproved: applicants.filter(a => a.status === 'approved').length,
    checkoutRequests: checkoutRequests.length,
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading tenants...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 lg:p-8">
        <div className="card bg-red-50 border border-red-200">
          <p className="text-red-700">{error}</p>
          <button onClick={fetchData} className="btn-primary mt-4">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 pb-24 md:pb-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">👥 Tenants Management</h2>
          <p className="text-gray-600">Manage all tenants and room assignments</p>
        </div>
        <button onClick={handleAddTenant} className="btn-primary">
          ➕ Add New Tenant
        </button>
      </div>

      {/* Category Toggle: Tenants / Applicants / Checkout Requests */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setCategoryFilter('tenants')}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
            categoryFilter === 'tenants'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          👥 Tenants ({stats.total})
        </button>
        <button
          onClick={() => setCategoryFilter('applicants')}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all relative ${
            categoryFilter === 'applicants'
              ? 'bg-orange-500 text-white shadow-lg shadow-orange-200'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          📋 Applicants ({stats.applicants})
          {stats.applicantsPending > 0 && categoryFilter !== 'applicants' && (
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {stats.applicantsPending}
            </span>
          )}
        </button>
        <button
          onClick={() => setCategoryFilter('checkouts')}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all relative ${
            categoryFilter === 'checkouts'
              ? 'bg-red-600 text-white shadow-lg shadow-red-200'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          🚪 Checkout Requests ({stats.checkoutRequests})
          {stats.checkoutRequests > 0 && categoryFilter !== 'checkouts' && (
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center animate-pulse">
              {stats.checkoutRequests}
            </span>
          )}
        </button>
      </div>

      {categoryFilter === 'tenants' ? (
      <>
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">Total Tenants</p>
              <p className="text-3xl font-bold mt-1">{stats.total}</p>
            </div>
            <div className="text-4xl">👥</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">Active Tenants</p>
              <p className="text-3xl font-bold mt-1">{stats.active}</p>
            </div>
            <div className="text-4xl">✅</div>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-gray-500 to-gray-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-100 text-sm">Inactive Tenants</p>
              <p className="text-3xl font-bold mt-1">{stats.inactive}</p>
            </div>
            <div className="text-4xl">📋</div>
          </div>
        </div>
      </div>

      {/* Filters Section - Compact Single Row */}
      <div className="card mb-4">
        <div className="flex flex-col gap-4">
          {/* All Filters in One Row - Wraps on Mobile */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 text-sm">
            {/* Status Filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-gray-600 uppercase tracking-wide whitespace-nowrap">Status:</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFilter('all')}
                  className={`font-semibold transition ${
                    filter === 'all'
                      ? 'text-primary underline underline-offset-4'
                      : 'text-gray-600 hover:text-primary'
                  }`}
                >
                  All ({stats.total})
                </button>
                <span className="text-gray-400">|</span>
                <button
                  onClick={() => setFilter('active')}
                  className={`font-semibold transition ${
                    filter === 'active'
                      ? 'text-green-600 underline underline-offset-4'
                      : 'text-gray-600 hover:text-green-600'
                  }`}
                >
                  Active ({stats.active})
                </button>
                <span className="text-gray-400">|</span>
                <button
                  onClick={() => setFilter('inactive')}
                  className={`font-semibold transition ${
                    filter === 'inactive'
                      ? 'text-gray-600 underline underline-offset-4'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Inactive ({stats.inactive})
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden lg:block h-6 w-px bg-gray-300"></div>

            {/* KYC Filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-gray-600 uppercase tracking-wide whitespace-nowrap">KYC:</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setKycFilter('all')}
                  className={`font-semibold transition ${
                    kycFilter === 'all'
                      ? 'text-emerald-600 underline underline-offset-4'
                      : 'text-gray-600 hover:text-emerald-600'
                  }`}
                >
                  All ({stats.total})
                </button>
                <span className="text-gray-400">|</span>
                <button
                  onClick={() => setKycFilter('verified')}
                  className={`font-semibold transition ${
                    kycFilter === 'verified'
                      ? 'text-green-600 underline underline-offset-4'
                      : 'text-gray-600 hover:text-green-600'
                  }`}
                >
                  ✅ Verified ({stats.kycVerified})
                </button>
                <span className="text-gray-400">|</span>
                <button
                  onClick={() => setKycFilter('not_verified')}
                  className={`font-semibold transition ${
                    kycFilter === 'not_verified'
                      ? 'text-amber-600 underline underline-offset-4'
                      : 'text-gray-600 hover:text-amber-600'
                  }`}
                >
                  ⏳ Not Verified ({stats.kycNotVerified})
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="hidden lg:block h-6 w-px bg-gray-300"></div>

            {/* View Mode */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-600 uppercase tracking-wide whitespace-nowrap">View:</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setViewMode('card')}
                  className={`font-semibold transition flex items-center gap-1 ${
                    viewMode === 'card'
                      ? 'text-orange-600 underline underline-offset-4'
                      : 'text-gray-600 hover:text-orange-600'
                  }`}
                >
                  <span>🎴</span> Cards
                </button>
                <span className="text-gray-400">|</span>
                <button
                  onClick={() => setViewMode('table')}
                  className={`font-semibold transition flex items-center gap-1 ${
                    viewMode === 'table'
                      ? 'text-orange-600 underline underline-offset-4'
                      : 'text-gray-600 hover:text-orange-600'
                  }`}
                >
                  <span>📋</span> Table
                </button>
              </div>
            </div>
          </div>

          {/* Merge Section - Better Mobile Layout */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 pt-3 border-t border-gray-200 lg:border-t-0 lg:pt-0 lg:border-l-2 lg:border-amber-300 lg:pl-4">
            <span className="text-xs font-bold text-amber-900 whitespace-nowrap">🧩 Merge:</span>
            <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
              <select
                value={mergeTargetTenantId}
                onChange={(event) => setMergeTargetTenantId(event.target.value)}
                disabled={mergingTenants}
                className="px-2 py-1.5 text-xs border border-amber-300 rounded-lg bg-white w-28 sm:max-w-[120px]"
              >
                <option value="">Target</option>
                {tenants.map((tenant) => (
                  <option key={`target_${tenant.id}`} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
              <span className="text-gray-400">→</span>
              <select
                value={mergeSourceTenantId}
                onChange={(event) => setMergeSourceTenantId(event.target.value)}
                disabled={mergingTenants}
                className="px-2 py-1.5 text-xs border border-amber-300 rounded-lg bg-white w-28 sm:max-w-[120px]"
              >
                <option value="">Source</option>
                {tenants.map((tenant) => (
                  <option key={`source_${tenant.id}`} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
              <button
                onClick={mergeTenantAccounts}
                disabled={mergingTenants}
                className="bg-amber-600 hover:bg-amber-700 text-white font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 text-xs whitespace-nowrap"
              >
                {mergingTenants ? '...' : 'Merge'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tenants List */}
      {filteredTenants.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-6xl mb-4">👥</div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">
            {filter === 'all' ? 'No Tenants Yet' : `No ${filter} tenants found`}
          </h3>
          <p className="text-gray-600 mb-4">
            {filter === 'all' 
              ? 'Add your first tenant to get started'
              : 'Try adjusting your filter'}
          </p>
          {filter === 'all' && (
            <button onClick={handleAddTenant} className="btn-primary">
              ➕ Add First Tenant
            </button>
          )}
        </div>
      ) : (isMobileViewport || viewMode === 'card') ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sortedTenants.map(tenant => (
            <TenantCard
              key={tenant.id}
              tenant={tenant}
              onEdit={() => handleEditTenant(tenant)}
              onDelete={() => handleDeleteTenant(tenant)}
              onViewHistory={() => handleViewHistory(tenant)}
              onResetKyc={() => handleResetKyc(tenant)}
              onForceCheckout={() => handleForceCheckout(tenant)}
            />
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tenant</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Room</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rent</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Check-In</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Username</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Password</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">KYC</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sortedTenants.map(tenant => {
                const isKycVerified = tenant?.kyc?.verified === true && tenant?.kyc?.verifiedBy === 'DigiLocker';
                // Calculate duration
                const calculateDuration = () => {
                  if (!tenant.checkInDate) return '-';
                  try {
                    const checkIn = new Date(tenant.checkInDate);
                    const now = new Date();
                    let years = now.getFullYear() - checkIn.getFullYear();
                    let months = now.getMonth() - checkIn.getMonth();
                    if (months < 0) {
                      years--;
                      months += 12;
                    }
                    if (years === 0 && months === 0) return 'New';
                    if (years === 0) return `${months}m`;
                    if (months === 0) return `${years}y`;
                    return `${years}y ${months}m`;
                  } catch (e) {
                    return '-';
                  }
                };

                return (
                  <tr key={tenant.id} className={tenant.isActive ? 'bg-green-50' : 'bg-gray-50'}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-gray-900">{tenant.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                        🏠 {getAssignedRooms(tenant).join(', ') || tenant.roomNumber || '-'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {tenant.phone || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                      {tenant.currentRent ? `₹${tenant.currentRent.toLocaleString('en-IN')}` : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {tenant.checkInDate ? new Date(tenant.checkInDate).toLocaleDateString('en-IN') : '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">
                        🕐 {calculateDuration()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <code className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-mono">
                        {tenant.username || getAssignedRooms(tenant)[0] || tenant.roomNumber}
                      </code>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <code className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded font-mono">
                        {tenant.password || 'password'}
                      </code>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        tenant.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {tenant.isActive ? '✅ Active' : '📋 Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        isKycVerified ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {isKycVerified ? '✅ Verified' : '⚠️ Not Verified'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleViewHistory(tenant)}
                          className="text-purple-600 hover:text-purple-900 font-medium"
                          title="View History"
                        >
                          📊
                        </button>
                        <button 
                          onClick={() => handleEditTenant(tenant)}
                          className="text-blue-600 hover:text-blue-900 font-medium"
                          title="Edit"
                        >
                          ✏️
                        </button>
                        {tenant.isActive && (
                          <button 
                            onClick={() => handleForceCheckout(tenant)}
                            className="text-red-600 hover:text-red-900 font-medium"
                            title="Force Checkout"
                          >
                            🚪
                          </button>
                        )}
                        {isKycVerified && (
                          <button 
                            onClick={() => handleResetKyc(tenant)}
                            className="text-orange-600 hover:text-orange-900 font-medium"
                            title="Reset KYC"
                          >
                            🔄
                          </button>
                        )}
                        <button 
                          onClick={() => handleDeleteTenant(tenant)}
                          className="text-red-600 hover:text-red-900 font-medium"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </> 
      ) : categoryFilter === 'applicants' ? (
      /* ════════ APPLICANTS VIEW ════════ */
      <>
      {/* Applicant Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-100 text-sm">Total Applicants</p>
              <p className="text-3xl font-bold mt-1">{stats.applicants}</p>
            </div>
            <div className="text-4xl">📋</div>
          </div>
        </div>
        <div className="card bg-gradient-to-br from-yellow-500 to-yellow-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-yellow-100 text-sm">Pending Approval</p>
              <p className="text-3xl font-bold mt-1">{stats.applicantsPending}</p>
            </div>
            <div className="text-4xl">⏳</div>
          </div>
        </div>
        <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">Approved (Room Assigned)</p>
              <p className="text-3xl font-bold mt-1">{stats.applicantsApproved}</p>
            </div>
            <div className="text-4xl">✅</div>
          </div>
        </div>
      </div>

      {/* Applicants List */}
      {applicants.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-6xl mb-4">📋</div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">No Applicants Yet</h3>
          <p className="text-gray-600 mb-2">When someone completes KYC via the onboarding link, they'll appear here.</p>
          <p className="text-sm text-gray-500">Share the onboarding link: <code className="bg-gray-100 px-2 py-1 rounded">{window.location.origin}/onboarding</code></p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {applicants.map(applicant => (
            <ApplicantCard
              key={applicant.id}
              applicant={applicant}
              onViewKyc={() => setViewingKyc(applicant)}
              onAssignRoom={() => { setAssigningRoom(applicant); setAssignRoomNumber(''); setAssignRent(''); }}
              onDelete={() => handleDeleteApplicant(applicant)}
            />
          ))}
        </div>
      )}
      </>
      ) : categoryFilter === 'checkouts' ? (
      /* ════════ CHECKOUT REQUESTS VIEW ════════ */
      <>
      {/* Checkout Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="card bg-gradient-to-br from-yellow-500 to-yellow-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-yellow-100 text-sm">Pending</p>
              <p className="text-3xl font-bold mt-1">{checkoutRequests.filter(r => r.status === 'pending').length}</p>
            </div>
            <div className="text-4xl">⏳</div>
          </div>
        </div>
        <div className="card bg-gradient-to-br from-red-500 to-red-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-red-100 text-sm">Rejected</p>
              <p className="text-3xl font-bold mt-1">{checkoutRequests.filter(r => r.status === 'rejected').length}</p>
            </div>
            <div className="text-4xl">❌</div>
          </div>
        </div>
        <div className="card bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">Completed</p>
              <p className="text-3xl font-bold mt-1">{checkoutRequests.filter(r => r.status === 'completed').length}</p>
            </div>
            <div className="text-4xl">✅</div>
          </div>
        </div>
        <div className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">Total</p>
              <p className="text-3xl font-bold mt-1">{checkoutRequests.length}</p>
            </div>
            <div className="text-4xl">📊</div>
          </div>
        </div>
      </div>

      {/* Checkout Requests List */}
      {checkoutRequests.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-6xl mb-4">🚪</div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">No Checkout Requests</h3>
          <p className="text-gray-600">When tenants request checkout, they will appear here for approval.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Pending Requests */}
          {checkoutRequests.filter(r => !r.status || r.status === 'pending').length > 0 && (
            <>
              <h4 className="text-sm font-semibold text-gray-700 text-yellow-700">⏳ PENDING REQUESTS</h4>
              <div className="grid gap-4">
                {checkoutRequests.filter(r => !r.status || r.status === 'pending').map((request) => (
                  <div key={request.id} className="bg-white rounded-lg shadow-sm border-l-4 border-l-yellow-400 border border-gray-200 p-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <h3 className="text-lg font-semibold text-gray-900">{request.tenantName}</h3>
                          <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded">
                            Room {request.roomNumber}
                          </span>
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs font-medium rounded">
                            {request.status ? request.status.charAt(0).toUpperCase() + request.status.slice(1) : 'Pending'}
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
                          onClick={() => handleApproveCheckout(request)}
                          disabled={processingRequest === request}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium whitespace-nowrap"
                        >
                          {processingRequest === request ? 'Processing...' : 'Approve & Settle'}
                        </button>
                        <button
                          onClick={() => handleRejectCheckout(request)}
                          className="px-4 py-2 border-2 border-orange-400 text-orange-700 rounded-lg hover:bg-orange-50 transition-colors text-sm font-medium whitespace-nowrap"
                        >
                          ❌ Cancel Request
                        </button>
                        <button
                          onClick={() => handleDeleteCheckoutRequest(request)}
                          className="px-4 py-2 border-2 border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors text-sm font-medium whitespace-nowrap"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Other Requests (Rejected/Completed) */}
          {checkoutRequests.filter(r => r.status && r.status !== 'pending').length > 0 && (
            <>
              <h4 className="text-sm font-semibold text-gray-700 mt-6">📋 OTHER REQUESTS</h4>
              <div className="grid gap-4">
                {checkoutRequests.filter(r => r.status !== 'pending').map((request) => (
                  <div key={request.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 opacity-75">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-3 flex-wrap">
                          <h3 className="text-lg font-semibold text-gray-900">{request.tenantName}</h3>
                          <span className="px-2 py-1 bg-orange-100 text-orange-700 text-xs font-medium rounded">
                            Room {request.roomNumber}
                          </span>
                          <span className={`px-2 py-1 text-xs font-medium rounded ${
                            request.status === 'rejected' ? 'bg-red-100 text-red-700' :
                            request.status === 'completed' ? 'bg-green-100 text-green-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {request.status?.charAt(0).toUpperCase() + request.status?.slice(1) || 'Unknown'}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600">Proposed Checkout:</span>
                            <p className="font-medium text-gray-900">
                              {new Date(request.proposedCheckoutDate).toLocaleDateString('en-IN')}
                            </p>
                          </div>
                          <div>
                            <span className="text-gray-600">Requested On:</span>
                            <p className="font-medium text-gray-900">
                              {request.requestedAt ? new Date(request.requestedAt.toDate()).toLocaleDateString('en-IN') : '-'}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 ml-4">
                        <button
                          onClick={() => handleDeleteCheckoutRequest(request)}
                          className="px-4 py-2 border-2 border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors text-sm font-medium whitespace-nowrap"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      </>
      ) : null}

      {/* Floating Floor Switcher - Mobile */}
      {isMobileViewport && categoryFilter === 'tenants' && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-white/95 backdrop-blur border border-gray-200 rounded-full shadow-lg px-2 py-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFloorFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${floorFilter === 'all' ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFloorFilter('floor1')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${floorFilter === 'floor1' ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            Floor 1
          </button>
          <button
            type="button"
            onClick={() => setFloorFilter('floor2')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${floorFilter === 'floor2' ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            Floor 2
          </button>
        </div>
      )}

      {/* Floating Floor Switcher - Desktop (Collapsible) */}
      {!isMobileViewport && categoryFilter === 'tenants' && (
        <div className="fixed bottom-8 right-8 z-50">
          {!isFloorFilterExpanded ? (
            /* Collapsed - Small Floating Button */
            <button
              type="button"
              onClick={() => setIsFloorFilterExpanded(true)}
              className="group bg-gradient-to-br from-blue-500 to-indigo-600 text-white p-4 rounded-full shadow-2xl hover:shadow-3xl hover:scale-110 transition-all duration-300"
              title="Floor Filter"
            >
              <div className="flex flex-col items-center">
                <span className="text-2xl">🏢</span>
                <span className="text-[10px] font-bold mt-0.5 opacity-90">
                  {floorFilter === 'all' ? 'All' : floorFilter === 'floor1' ? 'F1' : 'F2'}
                </span>
              </div>
            </button>
          ) : (
            /* Expanded - Full Filter Options */
            <div className="bg-white/95 backdrop-blur border-2 border-gray-300 rounded-2xl shadow-2xl overflow-hidden animate-slideIn">
              <div className="bg-gradient-to-r from-blue-500 to-indigo-500 px-4 py-2 flex items-center justify-between">
                <p className="text-xs font-bold text-white uppercase tracking-wider">🏢 Floor Filter</p>
                <button
                  type="button"
                  onClick={() => setIsFloorFilterExpanded(false)}
                  className="text-white hover:text-gray-200 text-lg font-bold"
                  title="Minimize"
                >
                  ✕
                </button>
              </div>
              <div className="p-2 space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setFloorFilter('all');
                    setIsFloorFilterExpanded(false);
                  }}
                  className={`w-full px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center justify-between ${
                    floorFilter === 'all'
                      ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-lg'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <span>All Floors</span>
                  <span className="text-xs">({stats.total})</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFloorFilter('floor1');
                    setIsFloorFilterExpanded(false);
                  }}
                  className={`w-full px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center justify-between ${
                    floorFilter === 'floor1'
                      ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <span>Ground Floor</span>
                  <span className="text-xs">({stats.floor1})</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFloorFilter('floor2');
                    setIsFloorFilterExpanded(false);
                  }}
                  className={`w-full px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center justify-between ${
                    floorFilter === 'floor2'
                      ? 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white shadow-lg'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <span>First Floor</span>
                  <span className="text-xs">({stats.floor2})</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tenant Form Modal */}
      {showForm && (
        <TenantForm
          tenant={editingTenant}
          rooms={rooms}
          tenants={tenants}
          onClose={handleFormClose}
          onSuccess={handleFormSuccess}
        />
      )}

      {/* Payment History Modal */}
      {selectedTenantHistory && (
        <PaymentHistoryModal
          tenant={selectedTenantHistory}
          payments={paymentHistory}
          loading={loadingHistory}
          onClose={handleCloseHistory}
        />
      )}

      {/* KYC Detail Modal */}
      {viewingKyc && (
        <KycDetailModal
          applicant={viewingKyc}
          onClose={() => setViewingKyc(null)}
        />
      )}

      {/* Room Assignment Modal */}
      {assigningRoom && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
            <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">🏠 Assign Room</h2>
                  <p className="text-orange-100 text-sm mt-1">
                    {assigningRoom.fullName || assigningRoom.firstName || 'Applicant'}
                  </p>
                </div>
                <button onClick={() => setAssigningRoom(null)} className="text-white hover:bg-white/20 rounded-full p-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Select Room</label>
                <select
                  value={assignRoomNumber}
                  onChange={(e) => setAssignRoomNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">-- Select Room --</option>
                  {getAvailableRooms().map(r => (
                    <option key={r.id} value={String(r.roomNumber)}>
                      Room {r.roomNumber} {r.floor ? `(Floor ${r.floor})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Monthly Rent (₹)</label>
                <input
                  type="number"
                  value={assignRent}
                  onChange={(e) => setAssignRent(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                <p className="font-semibold mb-1">Auto-generated credentials:</p>
                <p>Username: <code className="bg-blue-100 px-1 rounded">{assignRoomNumber || '---'}</code></p>
                <p>Password: <code className="bg-blue-100 px-1 rounded">{assignRoomNumber ? `rent${assignRoomNumber}` : '---'}</code></p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setAssigningRoom(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssignRoomToApplicant}
                  disabled={!assignRoomNumber || !assignRent || assigningInProgress}
                  className="flex-1 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg disabled:opacity-50 transition"
                >
                  {assigningInProgress ? 'Assigning...' : '✅ Assign Room'}
                </button>
              </div>
            </div>
          </div>
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

const PaymentHistoryModal = ({ tenant, payments, loading, onClose }) => {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // Calculate totals
  const totalCollected = payments.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-screen overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold mb-1">📊 Payment History</h2>
              <p className="text-blue-100">{tenant.name} - Room {tenant.roomNumber}</p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          {/* Summary Stats */}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="bg-white bg-opacity-20 rounded-lg p-3">
              <p className="text-blue-100 text-sm">Total Collected</p>
              <p className="text-2xl font-bold">₹{totalCollected.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-white bg-opacity-20 rounded-lg p-3">
              <p className="text-blue-100 text-sm">Total Payments</p>
              <p className="text-2xl font-bold">{payments.length}</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                <p className="text-gray-600">Loading payment history...</p>
              </div>
            </div>
          ) : payments.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">📄</div>
              <h3 className="text-xl font-semibold text-gray-800 mb-2">No Payment History</h3>
              <p className="text-gray-600">This tenant has no payment records yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Period</th>
                    <th className="px-4 py-3 text-right font-semibold">Rent</th>
                    <th className="px-4 py-3 text-right font-semibold">Electricity</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-right font-semibold">Paid</th>
                    <th className="px-4 py-3 text-left font-semibold">Payment Date</th>
                    <th className="px-4 py-3 text-center font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => {
                    const rent = payment.rent || 0;
                    const electricity = payment.electricity || 0;
                    const total = rent + electricity;
                    const paid = payment.paidAmount || 0;
                    const isPaid = payment.status === 'paid';
                    
                    return (
                      <tr key={payment.id} className="border-b hover:bg-gray-50">
                        <td className="px-4 py-3 font-semibold">
                          {monthNames[payment.month - 1]} {payment.year}
                        </td>
                        <td className="px-4 py-3 text-right">₹{rent.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-right">₹{electricity.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-right font-semibold">₹{total.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-right font-bold text-green-600">
                          ₹{paid.toLocaleString('en-IN')}
                        </td>
                        <td className="px-4 py-3">
                          {payment.paymentDate || payment.paidAt 
                            ? new Date(payment.paymentDate || payment.paidAt).toLocaleDateString('en-IN')
                            : '-'
                          }
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${
                            isPaid && paid > 0
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {isPaid && paid > 0 ? '✅ Paid' : '❌ Pending'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 bg-gray-50 flex justify-end">
          <button
            onClick={onClose}
            className="btn-primary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const TenantCard = ({ tenant, onEdit, onDelete, onViewHistory, onResetKyc, onForceCheckout }) => {
  const { showAlert, showPrompt } = useDialog();
  const isActive = tenant.isActive;
  const isKycVerified = tenant?.kyc?.verified === true && tenant?.kyc?.verifiedBy === 'DigiLocker';
  const assignedRooms = Array.isArray(tenant?.assignedRooms) && tenant.assignedRooms.length > 0
    ? tenant.assignedRooms.map((room) => String(room))
    : (tenant?.roomNumber ? [String(tenant.roomNumber)] : []);
  const primaryRoom = assignedRooms[0] || tenant.roomNumber;
  
  // Calculate living duration
  const calculateDuration = () => {
    if (!tenant.checkInDate) return null;
    
    try {
      const checkIn = new Date(tenant.checkInDate);
      const now = new Date();
      
      let years = now.getFullYear() - checkIn.getFullYear();
      let months = now.getMonth() - checkIn.getMonth();
      
      if (months < 0) {
        years--;
        months += 12;
      }
      
      if (years === 0 && months === 0) {
        return 'New tenant';
      } else if (years === 0) {
        return `${months} month${months > 1 ? 's' : ''}`;
      } else if (months === 0) {
        return `${years} year${years > 1 ? 's' : ''}`;
      } else {
        return `${years}y ${months}m`;
      }
    } catch (e) {
      return null;
    }
  };
  
  const duration = calculateDuration();
  
  // Copy credentials to clipboard
  const copyCredentials = async () => {
    const portalUrl = `${window.location.origin}/tenant-portal`;
    const roomLabel = assignedRooms.length > 0 ? assignedRooms.join(', ') : String(tenant.roomNumber || '-');
    const text = `🏠 Tenant Portal Access\n\nPortal URL: ${portalUrl}\n\nRooms: ${roomLabel}\nUsername: ${tenant.username || primaryRoom}\nPassword: ${tenant.password || 'password'}\n\n📱 Login and check your payment status!`;
    try {
      await navigator.clipboard.writeText(text);
      await showAlert('✅ Credentials & Portal URL copied!\n\nShare these with the tenant.', {
        title: 'Copied',
        intent: 'success'
      });
    } catch {
      await showPrompt('Copy these credentials manually:', {
        title: 'Manual Copy',
        defaultValue: text,
        confirmLabel: 'Close'
      });
    }
  };
  
  return (
    <div className={`card p-4 border-2 transition-all ${
      isActive 
        ? 'border-green-300 bg-green-50' 
        : 'border-gray-300 bg-gray-50'
    }`}>
      {/* Header - Name & Status */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="text-lg font-bold text-gray-800 mb-2">
            {tenant.name}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
              isActive
                ? 'bg-green-500 text-white'
                : 'bg-gray-500 text-white'
            }`}>
              {isActive ? '✅ Active' : '📋 Inactive'}
            </span>
            {assignedRooms.length > 0 && (
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-blue-500 text-white">
                🏠 Room {assignedRooms.join(', ')}
              </span>
            )}
            {duration && (
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-purple-500 text-white">
                🕐 {duration}
              </span>
            )}
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
              isKycVerified ? 'bg-green-600 text-white' : 'bg-amber-500 text-white'
            }`}>
              {isKycVerified ? '🛡️ KYC Verified' : '🛡️ KYC Pending'}
            </span>
          </div>
        </div>
      </div>

      {/* Tenant Information */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between py-2 border-b border-gray-300">
          <span className="text-sm font-medium text-gray-600">📱 Phone</span>
          <span className="text-sm font-semibold text-gray-800">{tenant.phone || '-'}</span>
        </div>
        
        {tenant.currentRent && (
          <div className="flex items-center justify-between py-2 border-b border-gray-300">
            <span className="text-sm font-medium text-gray-600">💵 Monthly Rent</span>
            <span className="text-sm font-semibold text-gray-800">
              ₹{tenant.currentRent.toLocaleString('en-IN')}
            </span>
          </div>
        )}
        
        {tenant.dueDate && (
          <div className="flex items-center justify-between py-2 border-b border-gray-300">
            <span className="text-sm font-medium text-gray-600">📅 Due Date</span>
            <span className="text-sm font-semibold text-orange-700">
              {tenant.dueDate} of every month
            </span>
          </div>
        )}
        
        {tenant.checkInDate && (
          <div className="flex items-center justify-between py-2 border-b border-gray-300">
            <span className="text-sm font-medium text-gray-600">📅 Check-in Date</span>
            <span className="text-sm font-semibold text-gray-800">
              {new Date(tenant.checkInDate).toLocaleDateString('en-IN')}
            </span>
          </div>
        )}
      </div>

      {/* Quick Actions - Simplified */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={() => {
            const portalUrl = `${window.location.origin}/tenant-portal`;
            window.open(portalUrl, '_blank');
          }}
          className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white px-4 py-3 rounded-lg font-bold transition-all text-sm shadow-md"
          title="Open Tenant Portal"
        >
          🚀 Tenant Portal
        </button>
        <button 
          onClick={copyCredentials} 
          className="bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white px-4 py-3 rounded-lg font-bold transition-all text-sm shadow-md"
          title="Copy Login Details"
        >
          📋 Copy Login
        </button>
      </div>

      {/* Login Credentials - Compact */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-2 mb-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-blue-600 font-semibold">User:</span>
            <span className="font-mono font-bold text-blue-900">{tenant.username || primaryRoom}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-blue-600 font-semibold">Pass:</span>
            <span className="font-mono font-bold text-blue-900">{tenant.password || 'password'}</span>
          </div>
        </div>
      </div>

      {/* Action Buttons - Minimized */}
      <div className="grid gap-2 grid-cols-2">
        <button 
          onClick={onViewHistory} 
          className="bg-purple-100 hover:bg-purple-200 text-purple-700 px-3 py-2 rounded-lg font-semibold transition text-xs border border-purple-300"
          title="View History"
        >
          📊 History
        </button>
        <button 
          onClick={onEdit} 
          className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-2 rounded-lg font-semibold transition text-xs border border-blue-300"
          title="Edit Tenant"
        >
          ✏️ Edit
        </button>
        {isActive && (
          <button 
            onClick={onForceCheckout}
            className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg font-semibold transition text-xs border border-red-300"
            title="Force Checkout"
          >
            🚪 Checkout
          </button>
        )}
        {isKycVerified && (
          <button 
            onClick={onResetKyc} 
            className="bg-orange-100 hover:bg-orange-200 text-orange-700 px-3 py-2 rounded-lg font-semibold transition text-xs border border-orange-300"
            title="Reset KYC"
          >
            🔄 Reset KYC
          </button>
        )}
        <button 
          onClick={onDelete} 
          className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg font-semibold transition text-xs border border-red-300"
          title="Delete Tenant"
        >
          🗑️ Delete
        </button>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════
// ApplicantCard — displays a KYC applicant (stranger)
// ════════════════════════════════════════════════════════════
const ApplicantCard = ({ applicant, onViewKyc, onAssignRoom, onDelete }) => {
  const name = applicant.fullName || `${applicant.firstName || ''} ${applicant.lastName || ''}`.trim() || 'Unknown';
  const hasAadhaarQr = !!applicant.aadhaarQr;
  const hasDocuments = !!(applicant.aadharFrontImage || applicant.aadharBackImage || applicant.selfieImage);
  const hasDigiLocker = !!(applicant.digiLocker?.data?.verified || applicant.digiLocker?.verified || applicant.digiLocker?.status === 'verified');
  const isApproved = applicant.status === 'approved';

  const submittedDate = applicant.submittedAt
    ? new Date(applicant.submittedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '-';

  return (
    <div className={`card p-4 border-2 transition-all ${
      isApproved
        ? 'border-green-300 bg-green-50'
        : 'border-orange-300 bg-orange-50'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="text-lg font-bold text-gray-800 mb-2">{name}</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
              isApproved
                ? 'bg-green-500 text-white'
                : 'bg-orange-500 text-white'
            }`}>
              {isApproved ? '✅ Approved' : '⏳ Pending'}
            </span>
            {isApproved && applicant.assignedRoom && (
              <span className="px-3 py-1 rounded-full text-sm font-semibold bg-blue-500 text-white">
                🏠 Room {applicant.assignedRoom}
              </span>
            )}
            <span className="px-3 py-1 rounded-full text-sm font-semibold bg-gray-400 text-white">
              📅 {submittedDate}
            </span>
          </div>
        </div>
      </div>

      {/* Info rows */}
      <div className="space-y-2 mb-3">
        <div className="flex items-center justify-between py-2 border-b border-gray-300">
          <span className="text-sm font-medium text-gray-600">📱 Phone</span>
          <span className="text-sm font-semibold text-gray-800">{applicant.phone || '-'}</span>
        </div>
        {applicant.occupation && (
          <div className="flex items-center justify-between py-2 border-b border-gray-300">
            <span className="text-sm font-medium text-gray-600">💼 Occupation</span>
            <span className="text-sm font-semibold text-gray-800">{applicant.occupation}</span>
          </div>
        )}
        {applicant.address && (
          <div className="flex items-center justify-between py-2 border-b border-gray-300">
            <span className="text-sm font-medium text-gray-600">📍 Address</span>
            <span className="text-sm font-semibold text-gray-800 text-right max-w-[60%] truncate">{applicant.address}</span>
          </div>
        )}
      </div>

      {/* KYC status badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
          hasAadhaarQr ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {hasAadhaarQr ? '✅' : '❌'} Aadhaar QR
        </span>
        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
          hasDocuments ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {hasDocuments ? '✅' : '❌'} Documents
        </span>
        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
          hasDigiLocker ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {hasDigiLocker ? '✅' : '❌'} DigiLocker
        </span>
        {applicant.crossVerification && (
          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
            applicant.crossVerification.overallStatus === 'verified' ? 'bg-green-100 text-green-700' : applicant.crossVerification.overallStatus === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {applicant.crossVerification.overallStatus === 'verified' ? '✅' : applicant.crossVerification.overallStatus === 'rejected' ? '❌' : '⚠️'} Cross-Check
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={onViewKyc}
          className="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-2 rounded-lg font-semibold transition text-xs border border-blue-300"
        >
          🔍 View KYC
        </button>
        {!isApproved && (
          <button
            onClick={onAssignRoom}
            className="bg-orange-100 hover:bg-orange-200 text-orange-700 px-3 py-2 rounded-lg font-semibold transition text-xs border border-orange-300"
          >
            🏠 Assign Room
          </button>
        )}
        <button
          onClick={onDelete}
          className="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg font-semibold transition text-xs border border-red-300"
        >
          🗑️ Delete
        </button>
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════
// KycDetailModal — shows full KYC data for an applicant
// ════════════════════════════════════════════════════════════
const KycDetailModal = ({ applicant, onClose }) => {
  const name = applicant.fullName || `${applicant.firstName || ''} ${applicant.lastName || ''}`.trim() || 'Unknown';
  const qr = applicant.aadhaarQr || {};
  const cross = applicant.crossVerification || {};
  const dl = applicant.digiLocker || {};
  const dlVerified = !!(dl.data?.verified || dl.verified || dl.status === 'verified');

  // Helper to render address (may be string or object)
  const formatAddress = (addr) => {
    if (!addr) return '';
    if (typeof addr === 'string') return addr;
    if (typeof addr === 'object') {
      const parts = [addr.house, addr.street, addr.landmark, addr.locality, addr.vtc, addr.district, addr.state, addr.pincode].filter(Boolean);
      return parts.join(', ') || JSON.stringify(addr);
    }
    return String(addr);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">🛡️ KYC Details</h2>
              <p className="text-blue-200 text-sm mt-1">{name}</p>
            </div>
            <button onClick={onClose} className="text-white hover:bg-white/20 rounded-full p-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Personal Info */}
          <section>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Personal Information</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Name:</span> <span className="font-semibold">{name}</span></div>
              <div><span className="text-gray-500">Phone:</span> <span className="font-semibold">{applicant.phone || '-'}</span></div>
              <div><span className="text-gray-500">DOB:</span> <span className="font-semibold">{applicant.dob || qr.dob || '-'}</span></div>
              <div><span className="text-gray-500">Gender:</span> <span className="font-semibold">{applicant.gender || qr.gender || '-'}</span></div>
              <div><span className="text-gray-500">Occupation:</span> <span className="font-semibold">{applicant.occupation || '-'}</span></div>
              <div><span className="text-gray-500">Emergency:</span> <span className="font-semibold">{applicant.emergencyContact || '-'}</span></div>
              {(applicant.address || qr.address) && (
                <div className="col-span-2"><span className="text-gray-500">Address:</span> <span className="font-semibold">{formatAddress(applicant.address || qr.address)}</span></div>
              )}
            </div>
          </section>

          {/* Aadhaar QR Data */}
          {Object.keys(qr).length > 0 && (
            <section>
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Aadhaar QR Data</h3>
              <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
                {qr.name && <div><span className="text-gray-500">Name:</span> <span className="font-semibold">{qr.name}</span></div>}
                {qr.dob && <div><span className="text-gray-500">DOB:</span> <span className="font-semibold">{qr.dob}</span></div>}
                {qr.gender && <div><span className="text-gray-500">Gender:</span> <span className="font-semibold">{qr.gender}</span></div>}
                {(qr.maskedAadhaar || qr.uid) && <div><span className="text-gray-500">Aadhaar:</span> <span className="font-semibold font-mono">{qr.maskedAadhaar || (qr.uid ? `XXXX-XXXX-${String(qr.uid).slice(-4)}` : '')}</span></div>}
                {qr.address && <div><span className="text-gray-500">Address:</span> <span className="font-semibold">{formatAddress(qr.address)}</span></div>}
                {qr.photo && (
                  <div className="mt-2">
                    <span className="text-gray-500 block mb-1">QR Photo:</span>
                    <img src={qr.photo} alt="QR Photo" className="w-20 h-20 rounded-lg object-cover border" />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Cross Verification */}
          {Object.keys(cross).length > 0 && (
            <section>
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Cross Verification</h3>
              <div className={`rounded-lg p-3 text-sm ${cross.overallStatus === 'verified' ? 'bg-green-50 border border-green-200' : cross.overallStatus === 'rejected' ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
                <p className="font-semibold mb-1">
                  {cross.overallStatus === 'verified' ? '✅ Verified' : cross.overallStatus === 'rejected' ? '❌ Rejected' : cross.overallStatus === 'flagged' ? '⚠️ Flagged' : '⏳ Pending'}
                </p>
                {cross.flags && cross.flags.length > 0 && (
                  <ul className="mt-2 space-y-1 text-gray-700">
                    {cross.flags.map((f, i) => (
                      <li key={i} className={f.type === 'error' ? 'text-red-700' : f.type === 'warning' ? 'text-amber-700' : 'text-gray-700'}>
                        {f.type === 'error' ? '❌' : f.type === 'warning' ? '⚠️' : '✅'} <strong>{f.label}:</strong> {f.message}
                      </li>
                    ))}
                  </ul>
                )}
                {cross.qrVsTypedName && <p className="text-gray-600 mt-1">Name check: {cross.qrVsTypedName}</p>}
                {cross.qrVsOcrAadhaarNo && <p className="text-gray-600">Aadhaar # check: {cross.qrVsOcrAadhaarNo}</p>}
              </div>
            </section>
          )}

          {/* DigiLocker */}
          <section>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">DigiLocker</h3>
            <div className={`rounded-lg p-3 text-sm ${dlVerified ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}>
              <p className="font-semibold">
                {dlVerified ? '✅ DigiLocker Verified' : '❌ Not Verified'}
              </p>
              <p className="text-gray-600 mt-1">Status: {dl.status || '-'}</p>
              {(dl.data?.name || dl.name) && <p className="text-gray-600">Name: {dl.data?.name || dl.name}</p>}
              {(dl.data?.dob || dl.dob) && <p className="text-gray-600">DOB: {dl.data?.dob || dl.dob}</p>}
              {(dl.data?.gender || dl.gender) && <p className="text-gray-600">Gender: {dl.data?.gender || dl.gender}</p>}
              {(dl.verifiedAt || dl.data?.verifiedAt) && <p className="text-gray-600">Verified at: {new Date(dl.verifiedAt || dl.data?.verifiedAt).toLocaleString('en-IN')}</p>}
            </div>
          </section>

          {/* Documents */}
          <section>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Uploaded Documents</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {applicant.aadharFrontImage && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Aadhaar Front</p>
                  <img src={applicant.aadharFrontImage} alt="Aadhaar Front" className="rounded-lg border w-full h-32 object-cover" />
                </div>
              )}
              {applicant.aadharBackImage && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Aadhaar Back</p>
                  <img src={applicant.aadharBackImage} alt="Aadhaar Back" className="rounded-lg border w-full h-32 object-cover" />
                </div>
              )}
              {applicant.selfieImage && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Selfie</p>
                  <img src={applicant.selfieImage} alt="Selfie" className="rounded-lg border w-full h-32 object-cover" />
                </div>
              )}
              {applicant.panImage && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">PAN Card</p>
                  <img src={applicant.panImage} alt="PAN" className="rounded-lg border w-full h-32 object-cover" />
                </div>
              )}
              {applicant.dlImage && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">Driving License</p>
                  <img src={applicant.dlImage} alt="DL" className="rounded-lg border w-full h-32 object-cover" />
                </div>
              )}
              {!applicant.aadharFrontImage && !applicant.aadharBackImage && !applicant.selfieImage && !applicant.panImage && !applicant.dlImage && (
                <p className="text-gray-500 text-sm col-span-full">No documents uploaded</p>
              )}
            </div>
          </section>

          {/* Agreement */}
          {applicant.agreementAccepted && (
            <section>
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3">Agreement</h3>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm">
                <p className="font-semibold text-green-700">✅ Agreement Accepted</p>
                {applicant.agreementSignature && (
                  <div className="mt-2">
                    <p className="text-gray-500 text-xs mb-1">Signature:</p>
                    <img src={applicant.agreementSignature} alt="Signature" className="border rounded h-16 bg-white" />
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 bg-gray-50 flex justify-end flex-shrink-0">
          <button onClick={onClose} className="btn-primary">Close</button>
        </div>
      </div>
    </div>
  );
};

export default Tenants;
