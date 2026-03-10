import { useState, useEffect, Fragment } from 'react';
import { collection, getDocs, updateDoc, deleteDoc, doc, query, where, orderBy, addDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import TenantForm from './TenantForm';
import AdminCheckoutPanel from './AdminCheckoutPanel';
import { useDialog } from './ui/DialogProvider';
import useResponsiveViewMode from '../utils/useResponsiveViewMode';

const Tenants = () => {
  const { showConfirm, showAlert } = useDialog();
  const [tenants, setTenants] = useState([]);
  const [applicants, setApplicants] = useState([]); // KYC applicants (not yet tenants)
  const [checkoutCount, setCheckoutCount] = useState(0);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingTenant, setEditingTenant] = useState(null);
  const [filter, setFilter] = useState('active'); // active only (past tenants are on TenantHistory page)
  const [kycFilter, setKycFilter] = useState('all'); // all, verified, not_verified
  const [floorFilter, setFloorFilter] = useState('all'); // all, floor1, floor2
  const [categoryFilter, setCategoryFilter] = useState('tenants'); // tenants, applicants, checkout
  const [viewingKyc, setViewingKyc] = useState(null); // Applicant whose KYC to view
  const [assigningRoom, setAssigningRoom] = useState(null); // Applicant being assigned a room
  const [assignRoomNumber, setAssignRoomNumber] = useState('');
  const [assignRent, setAssignRent] = useState('');
  const [assigningInProgress, setAssigningInProgress] = useState(false);
  const { viewMode, setViewMode } = useResponsiveViewMode('tenants-view-mode', 'table');
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [selectedTenantHistory, setSelectedTenantHistory] = useState(null);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [electricityHistory, setElectricityHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [mergeTargetTenantId, setMergeTargetTenantId] = useState('');
  const [mergeSourceTenantId, setMergeSourceTenantId] = useState('');
  const [mergingTenants, setMergingTenants] = useState(false);

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
      
      setTenants(tenantsData);
      setRooms(roomsData);
      setApplicants(applicantsData);

      // Fetch pending checkout requests count
      try {
        const checkoutSnapshot = await getDocs(query(collection(db, 'checkoutRequests'), where('status', '==', 'pending')));
        setCheckoutCount(checkoutSnapshot.size);
      } catch (checkoutErr) {
        console.warn('Could not fetch checkoutRequests:', checkoutErr.message);
      }
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
      `Merge "${sourceTenant.name}" into "${targetTenant.name}"?\n\nTarget rooms: ${targetRooms.join(', ') || '-'}\nSource rooms: ${sourceRooms.join(', ') || '-'}\nMerged rooms: ${mergedRooms.join(', ') || '-'}\n\nSource tenant will become a past tenant after merge.`,
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

      // Build electricity unit history from two sources:
      // 1) electricityReadings collection (direct meter readings)
      // 2) payments collection (meter fields embedded in each payment)
      try {
        const readingsRef = collection(db, 'electricityReadings');
        const readingDocs = new Map();

        // Source 1: direct electricityReadings by tenantId
        if (tenant.id) {
          const snap = await getDocs(query(readingsRef, where('tenantId', '==', tenant.id)));
          snap.forEach(d => readingDocs.set(d.id, { id: d.id, ...d.data(), source: 'electricityReadings' }));
        }

        // Source 2: extract meter readings embedded in payment records
        const toDate = (val) => {
          if (!val) return new Date(0);
          const d = new Date(val);
          return isNaN(d.getTime()) ? new Date(0) : d;
        };

        payments.forEach(payment => {
          const previousReading = Number(payment.oldReading ?? payment.previousReading);
          const currentReading = Number(payment.currentReading ?? payment.meterReading);
          const unitsConsumed = Number(payment.units ?? payment.unitsConsumed ?? 0);
          const totalCharge = Number(payment.electricity ?? payment.electricityAmount ?? 0);

          const validReadings = Number.isFinite(previousReading) && Number.isFinite(currentReading) && currentReading >= previousReading;
          const validElectricity = totalCharge > 0 || unitsConsumed > 0;

          if (!validReadings || !validElectricity) return;

          const recordDate = payment.paidDate || payment.paymentDate || payment.createdAt || payment.paidAt;
          const monthLabel = (payment.year && payment.month)
            ? `${new Date(Number(payment.year), Number(payment.month) - 1, 1).toLocaleDateString('en-IN', { month: 'short' })} ${payment.year}`
            : (recordDate ? new Date(recordDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '');

          const key = `payment_${payment.id}`;
          readingDocs.set(key, {
            id: key,
            tenantId: tenant.id,
            roomNumber: tenant.roomNumber,
            readingDate: recordDate,
            monthLabel,
            previousReading,
            currentReading,
            unitsConsumed: Number.isFinite(unitsConsumed) ? unitsConsumed : Math.max(0, currentReading - previousReading),
            ratePerUnit: Number(payment.ratePerUnit) || null,
            totalCharge,
            source: 'payments',
            year: payment.year,
            month: payment.month,
          });
        });

        // Deduplicate by monthLabel+currentReading+previousReading
        const seen = new Set();
        const readings = Array.from(readingDocs.values())
          .sort((a, b) => toDate(b.readingDate) - toDate(a.readingDate))
          .filter(r => {
            const dedupeKey = `${r.monthLabel}_${r.currentReading}_${r.previousReading}`;
            if (seen.has(dedupeKey)) return false;
            seen.add(dedupeKey);
            return true;
          });

        setElectricityHistory(readings);
      } catch (elErr) {
        console.warn('Could not fetch electricity readings:', elErr.message);
        setElectricityHistory([]);
      }
    } catch (err) {
      console.error('Error fetching payment history:', err);
      await showAlert('Failed to load payment history', { title: 'History Error', intent: 'error' });
      setPaymentHistory([]);
      setElectricityHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleCloseHistory = () => {
    setSelectedTenantHistory(null);
    setPaymentHistory([]);
    setElectricityHistory([]);
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
    // Always show only active tenants — past tenants are on TenantHistory page
    if (!tenant.isActive) return false;

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
    
    return matchesKycFilter && matchesFloorFilter;
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

      {/* Category Toggle: Tenants / Applicants */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setCategoryFilter('tenants')}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
            categoryFilter === 'tenants'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          👥 Tenants ({stats.active})
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
          onClick={() => setCategoryFilter('checkout')}
          className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all relative ${categoryFilter === 'checkout' ? 'bg-red-500 text-white shadow-lg shadow-red-200' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          🚪 Checkout Requests ({checkoutCount})
          {checkoutCount > 0 && categoryFilter !== 'checkout' && (
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {checkoutCount}
            </span>
          )}
        </button>
      </div>

      {categoryFilter === 'checkout' ? (
        <AdminCheckoutPanel />
      ) : categoryFilter === 'tenants' ? (
      <>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="card py-3 bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-xs">Total Active</p>
              <p className="text-2xl font-bold">{stats.active}</p>
            </div>
            <div className="text-3xl">👥</div>
          </div>
        </div>

        <div className="card py-3 bg-gradient-to-br from-green-500 to-green-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-xs">KYC Verified</p>
              <p className="text-2xl font-bold">{stats.kycVerified}</p>
            </div>
            <div className="text-3xl">✅</div>
          </div>
        </div>

        <div className="card py-3 bg-gradient-to-br from-amber-500 to-amber-600 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-amber-100 text-xs">KYC Pending</p>
              <p className="text-2xl font-bold">{stats.kycNotVerified}</p>
            </div>
            <div className="text-3xl">⚠️</div>
          </div>
        </div>
      </div>

      {/* Floor Vacancy Bar */}
      {rooms.length > 0 && (() => {
        const isOcc = r => r.status === 'occupied' || r.status === 'filled';
        const f1Rooms = rooms.filter(r => r.roomNumber >= 101 && r.roomNumber <= 106);
        const f2Rooms = rooms.filter(r => r.roomNumber >= 201 && r.roomNumber <= 206);
        const f1Vacant = f1Rooms.filter(r => !isOcc(r)).length;
        const f2Vacant = f2Rooms.filter(r => !isOcc(r)).length;
        return (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className={`card py-2 px-3 border-2 ${f1Vacant > 0 ? 'border-orange-300 bg-orange-50' : 'border-green-300 bg-green-50'}`}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Ground Floor (101–106)</p>
              <div className="flex gap-0.5 mb-1">
                {f1Rooms.map(r => (
                  <div key={r.id} title={`Room ${r.roomNumber}: ${r.status || 'vacant'}`}
                    className={`flex-1 h-4 rounded text-[9px] font-bold flex items-center justify-center text-white ${!isOcc(r) ? 'bg-orange-400' : 'bg-green-500'}`}>
                    {r.roomNumber}
                  </div>
                ))}
              </div>
              <p className={`text-sm font-bold ${f1Vacant > 0 ? 'text-orange-700' : 'text-green-700'}`}>
                {f1Vacant > 0 ? `🔓 ${f1Vacant} vacant` : '✅ All occupied'}
                <span className="text-xs font-normal text-gray-500 ml-1">({f1Rooms.length - f1Vacant}/{f1Rooms.length} occupied)</span>
              </p>
            </div>
            <div className={`card py-2 px-3 border-2 ${f2Vacant > 0 ? 'border-orange-300 bg-orange-50' : 'border-green-300 bg-green-50'}`}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">First Floor (201–206)</p>
              <div className="flex gap-0.5 mb-1">
                {f2Rooms.map(r => (
                  <div key={r.id} title={`Room ${r.roomNumber}: ${r.status || 'vacant'}`}
                    className={`flex-1 h-4 rounded text-[9px] font-bold flex items-center justify-center text-white ${!isOcc(r) ? 'bg-orange-400' : 'bg-green-500'}`}>
                    {r.roomNumber}
                  </div>
                ))}
              </div>
              <p className={`text-sm font-bold ${f2Vacant > 0 ? 'text-orange-700' : 'text-green-700'}`}>
                {f2Vacant > 0 ? `🔓 ${f2Vacant} vacant` : '✅ All occupied'}
                <span className="text-xs font-normal text-gray-500 ml-1">({f2Rooms.length - f2Vacant}/{f2Rooms.length} occupied)</span>
              </p>
            </div>
          </div>
        );
      })()}

      {/* Filters & Tools */}
      <div className="card mb-4">
        {/* Filters row */}
        <div className="flex flex-wrap gap-4">

          {/* KYC Filter */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">KYC Status</span>
            <div className="flex gap-1.5">
              {[
                { key: 'all', label: 'All' },
                { key: 'verified', label: `✅ Verified (${stats.kycVerified})` },
                { key: 'not_verified', label: `⚠️ Pending (${stats.kycNotVerified})` },
              ].map(f => (
                <button key={f.key} onClick={() => setKycFilter(f.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                    kycFilter === f.key
                      ? f.key === 'verified' ? 'bg-green-600 text-white' : f.key === 'not_verified' ? 'bg-amber-600 text-white' : 'bg-emerald-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >{f.label}</button>
              ))}
            </div>
          </div>

          {/* Floor Filter (desktop only) */}
          <div className="hidden md:flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Floor</span>
            <div className="flex gap-1.5">
              {[
                { key: 'all', label: 'All Floors' },
                { key: 'floor1', label: `🏠 Floor 1 (${stats.floor1})` },
                { key: 'floor2', label: `🏢 Floor 2 (${stats.floor2})` },
              ].map(f => (
                <button key={f.key} onClick={() => setFloorFilter(f.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                    floorFilter === f.key
                      ? f.key === 'floor1' ? 'bg-blue-500 text-white' : f.key === 'floor2' ? 'bg-indigo-500 text-white' : 'bg-purple-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >{f.label}</button>
              ))}
            </div>
          </div>

          {/* View Mode (desktop only) */}
          <div className="hidden md:flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">View</span>
            <div className="flex gap-1.5">
              <button onClick={() => setViewMode('card')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${viewMode === 'card' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >🎴 Card</button>
              <button onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${viewMode === 'table' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >📋 Table</button>
            </div>
          </div>

        </div>

        {/* Merge Duplicate Tenants - collapsible */}
        <details className="border-t border-gray-100 mt-3 pt-3">
          <summary className="cursor-pointer text-xs font-semibold text-amber-700 hover:text-amber-900 select-none inline-flex items-center gap-1">
            🧩 Merge Duplicate Tenants
          </summary>
          <div className="mt-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
            <p className="text-xs text-amber-800 mb-2">Source tenant deactivated, records move to target.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
              <select value={mergeTargetTenantId} onChange={(e) => setMergeTargetTenantId(e.target.value)} disabled={mergingTenants}
                className="w-full px-2 py-1.5 text-xs border border-amber-300 rounded-lg bg-white">
                <option value="">Target (keep)</option>
                {tenants.map((t) => (
                  <option key={`target_${t.id}`} value={t.id}>{t.name} ({getAssignedRooms(t).join(', ') || '-'}) {t.isActive ? '' : '[Past]'}</option>
                ))}
              </select>
              <select value={mergeSourceTenantId} onChange={(e) => setMergeSourceTenantId(e.target.value)} disabled={mergingTenants}
                className="w-full px-2 py-1.5 text-xs border border-amber-300 rounded-lg bg-white">
                <option value="">Source (merge into target)</option>
                {tenants.map((t) => (
                  <option key={`source_${t.id}`} value={t.id}>{t.name} ({getAssignedRooms(t).join(', ') || '-'}) {t.isActive ? '' : '[Past]'}</option>
                ))}
              </select>
            </div>
            <button onClick={mergeTenantAccounts} disabled={mergingTenants}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 text-xs">
              {mergingTenants ? 'Merging...' : 'Merge Tenants'}
            </button>
          </div>
        </details>
      </div>

      {/* Tenants List */}
      {filteredTenants.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-6xl mb-4">👥</div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">No Active Tenants</h3>
          <p className="text-gray-600 mb-4">Add your first tenant to get started</p>
          <button onClick={handleAddTenant} className="btn-primary">
            ➕ Add First Tenant
          </button>
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
                        {tenant.isActive ? '✅ Active' : '📋 Past'}
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
      ) : (
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
      )}

      {isMobileViewport && categoryFilter === 'tenants' && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-white/95 backdrop-blur border border-gray-200 rounded-full shadow-lg px-2 py-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFloorFilter('all')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full ${floorFilter === 'all' ? 'bg-primary text-white' : 'text-gray-700'}`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFloorFilter('floor1')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full ${floorFilter === 'floor1' ? 'bg-primary text-white' : 'text-gray-700'}`}
          >
            Floor 1
          </button>
          <button
            type="button"
            onClick={() => setFloorFilter('floor2')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full ${floorFilter === 'floor2' ? 'bg-primary text-white' : 'text-gray-700'}`}
          >
            Floor 2
          </button>
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
          electricityReadings={electricityHistory}
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
    </div>
  );
};

export const PaymentHistoryModal = ({ tenant, payments, electricityReadings = [], loading, onClose }) => {
  const [activeTab, setActiveTab] = useState('payments'); // 'payments' | 'electricity'
  const [expandedRows, setExpandedRows] = useState(new Set()); // Track expanded rows by period key
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const totalCollected = payments.reduce((sum, p) => sum + (p.paidAmount || 0), 0);
  const totalUnits = electricityReadings.reduce((sum, r) => sum + (Number(r.unitsConsumed) || 0), 0);

  // Check if tenant has multiple rooms
  const isMultiRoom = tenant.roomCount > 1 || 
                      (Array.isArray(tenant.roomNumbers) && tenant.roomNumbers.length > 1) ||
                      (Array.isArray(tenant.assignedRooms) && tenant.assignedRooms.length > 1);

  // Group payments by month+year for multi-room tenants
  const groupedPayments = isMultiRoom ? (() => {
    const groups = new Map();
    
    payments.forEach(payment => {
      const periodKey = `${payment.year}-${payment.month}`;
      if (!groups.has(periodKey)) {
        groups.set(periodKey, {
          periodKey,
          year: payment.year,
          month: payment.month,
          payments: [],
          totalRent: 0,
          totalElectricity: 0,
          totalAmount: 0,
          totalPaid: 0,
          paymentDate: payment.paymentDate || payment.paidAt,
          status: payment.status
        });
      }
      
      const group = groups.get(periodKey);
      group.payments.push(payment);
      group.totalRent += Number(payment.rent || 0);
      group.totalElectricity += Number(payment.electricity || 0);
      group.totalAmount += Number(payment.rent || 0) + Number(payment.electricity || 0);
      group.totalPaid += Number(payment.paidAmount || 0);
      
      // Update status to 'paid' if any payment is paid
      if (payment.status === 'paid') {
        group.status = 'paid';
      }
      
      // Use latest payment date
      const paymentTime = payment.paymentDate || payment.paidAt;
      if (paymentTime) {
        const currentTime = group.paymentDate;
        if (!currentTime || new Date(paymentTime) > new Date(currentTime)) {
          group.paymentDate = paymentTime;
        }
      }
    });
    
    return Array.from(groups.values()).sort((a, b) => {
      const yearDiff = Number(b.year) - Number(a.year);
      if (yearDiff !== 0) return yearDiff;
      return Number(b.month) - Number(a.month);
    });
  })() : payments;

  const toggleRow = (periodKey) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(periodKey)) {
        newSet.delete(periodKey);
      } else {
        newSet.add(periodKey);
      }
      return newSet;
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-screen overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold mb-1">📊 Tenant History</h2>
              <p className="text-blue-100">{tenant.name} - Room {tenant.roomNumber}</p>
            </div>
            <button onClick={onClose} className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-3 mt-4">
            <div className="bg-white bg-opacity-20 rounded-lg p-3">
              <p className="text-blue-100 text-xs">Total Collected</p>
              <p className="text-xl font-bold">₹{totalCollected.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-white bg-opacity-20 rounded-lg p-3">
              <p className="text-blue-100 text-xs">Total Payments</p>
              <p className="text-xl font-bold">{payments.length}</p>
            </div>
            <div className="bg-white bg-opacity-20 rounded-lg p-3">
              <p className="text-blue-100 text-xs">Total Units</p>
              <p className="text-xl font-bold">{totalUnits} <span className="text-sm font-normal">units</span></p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-gray-50">
          <button
            onClick={() => setActiveTab('payments')}
            className={`flex-1 py-3 text-sm font-semibold transition ${
              activeTab === 'payments'
                ? 'border-b-2 border-blue-500 text-blue-600 bg-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            💰 Payment History ({payments.length})
          </button>
          <button
            onClick={() => setActiveTab('electricity')}
            className={`flex-1 py-3 text-sm font-semibold transition ${
              activeTab === 'electricity'
                ? 'border-b-2 border-blue-500 text-blue-600 bg-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            ⚡ Electricity Unit History ({electricityReadings.length})
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                <p className="text-gray-600">Loading history...</p>
              </div>
            </div>
          ) : activeTab === 'payments' ? (
            payments.length === 0 ? (
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
                    {isMultiRoom ? (
                      // Multi-room tenant: Show grouped payments with expandable rows
                      groupedPayments.map((group) => {
                        const isExpanded = expandedRows.has(group.periodKey);
                        const isPaidGroup = group.status === 'paid' && group.totalPaid > 0;
                        
                        return (
                          <Fragment key={group.periodKey}>
                            {/* Main row (collapsed view - shows totals) */}
                            <tr 
                              onClick={() => toggleRow(group.periodKey)}
                              className="border-b hover:bg-blue-50 cursor-pointer transition-colors"
                            >
                              <td className="px-4 py-3 font-semibold">
                                <div className="flex items-center gap-2">
                                  <span className="text-blue-600">
                                    {isExpanded ? '▼' : '▶'}
                                  </span>
                                  {monthNames[group.month - 1]} {group.year}
                                  {group.payments.length > 1 && (
                                    <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-semibold">
                                      {group.payments.length} rooms
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right font-semibold">₹{group.totalRent.toLocaleString('en-IN')}</td>
                              <td className="px-4 py-3 text-right font-semibold">₹{group.totalElectricity.toLocaleString('en-IN')}</td>
                              <td className="px-4 py-3 text-right font-bold">₹{group.totalAmount.toLocaleString('en-IN')}</td>
                              <td className="px-4 py-3 text-right font-bold text-green-600">
                                ₹{group.totalPaid.toLocaleString('en-IN')}
                              </td>
                              <td className="px-4 py-3">
                                {group.paymentDate
                                  ? new Date(group.paymentDate).toLocaleDateString('en-IN')
                                  : '-'}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                  isPaidGroup ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}>
                                  {isPaidGroup ? '✅ Paid' : '❌ Pending'}
                                </span>
                              </td>
                            </tr>
                            
                            {/* Expanded rows (room-wise breakdown) */}
                            {isExpanded && group.payments.map((payment) => {
                              const rent = payment.rent || 0;
                              const electricity = payment.electricity || 0;
                              const total = rent + electricity;
                              const paid = payment.paidAmount || 0;
                              const isPaid = payment.status === 'paid';
                              const units = payment.units || payment.unitsConsumed || 0;
                              const currentReading = payment.currentReading || payment.meterReading || 0;
                              const previousReading = payment.previousReading || payment.oldReading || 0;
                              
                              return (
                                <tr key={payment.id} className="bg-gray-50 border-b">
                                  <td className="px-4 py-2 pl-12 text-sm text-gray-700">
                                    <span className="font-medium">🏠 Room {payment.roomNumber}</span>
                                  </td>
                                  <td className="px-4 py-2 text-right text-sm">₹{rent.toLocaleString('en-IN')}</td>
                                  <td className="px-4 py-2 text-right text-sm">
                                    <div>₹{electricity.toLocaleString('en-IN')}</div>
                                    {units > 0 && (
                                      <div className="text-xs text-gray-500">
                                        {units} units ({previousReading} → {currentReading})
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-2 text-right text-sm">₹{total.toLocaleString('en-IN')}</td>
                                  <td className="px-4 py-2 text-right text-sm text-green-600 font-semibold">
                                    ₹{paid.toLocaleString('en-IN')}
                                  </td>
                                  <td className="px-4 py-2 text-sm">
                                    {payment.paymentDate || payment.paidAt
                                      ? new Date(payment.paymentDate || payment.paidAt).toLocaleDateString('en-IN')
                                      : '-'}
                                  </td>
                                  <td className="px-4 py-2 text-center">
                                    <span className={`px-2 py-0.5 rounded text-xs ${
                                      isPaid && paid > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                    }`}>
                                      {isPaid && paid > 0 ? '✅' : '❌'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </Fragment>
                        );
                      })
                    ) : (
                      // Single-room tenant: Show normal rows
                      payments.map((payment) => {
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
                                : '-'}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                isPaid && paid > 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                              }`}>
                                {isPaid && paid > 0 ? '✅ Paid' : '❌ Pending'}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            /* Electricity Unit History Tab */
            electricityReadings.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">⚡</div>
                <h3 className="text-xl font-semibold text-gray-800 mb-2">No Electricity Records</h3>
                <p className="text-gray-600">No meter reading records found for this tenant.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-blue-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-gray-700">Month</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-700">Prev</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-700">Current</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-700">Units</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-700">Rate/Unit</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-700">Charge</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-100">
                    {electricityReadings.map((reading) => {
                      const unitsConsumed = Number(reading.unitsConsumed ?? 0);
                      const totalCharge = Number(reading.totalCharge ?? 0);
                      const ratePerUnit = reading.ratePerUnit != null
                        ? Number(reading.ratePerUnit)
                        : (unitsConsumed > 0 && totalCharge > 0 ? totalCharge / unitsConsumed : null);
                      const label = reading.monthLabel || (() => {
                        const d = reading.readingDate || reading.createdAt;
                        return d ? new Date(d).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '-';
                      })();
                      return (
                        <tr key={reading.id} className="hover:bg-blue-50">
                          <td className="px-4 py-3 font-semibold">
                            {label}
                            {reading.source === 'payments' && (
                              <span className="ml-1 text-xs text-gray-400">(bill)</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">{reading.previousReading ?? '-'}</td>
                          <td className="px-4 py-3 text-right font-mono text-blue-600 font-semibold">{reading.currentReading ?? '-'}</td>
                          <td className="px-4 py-3 text-right font-semibold text-blue-600">{unitsConsumed}</td>
                          <td className="px-4 py-3 text-right text-purple-600 font-semibold">
                            {ratePerUnit != null ? `₹${ratePerUnit.toFixed(2)}` : '-'}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-green-600">₹{totalCharge.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 bg-gray-50 flex justify-end">
          <button onClick={onClose} className="btn-primary">Close</button>
        </div>
      </div>
    </div>
  );
};

const TenantCard = ({ tenant, onEdit, onDelete, onViewHistory, onResetKyc }) => {
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
              {isActive ? '✅ Active' : '📋 Past'}
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
      <div className={`grid gap-2 ${isKycVerified ? 'grid-cols-2' : 'grid-cols-3'}`}>
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
