import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, addDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { useDialog } from './ui/DialogProvider';
import Tesseract from 'tesseract.js';

const VerifyPayments = () => {
  const { currentUser } = useAuth();
  const { showAlert, showConfirm, showPrompt } = useDialog();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending'); // pending, verified, rejected, all
  const [editingSubmission, setEditingSubmission] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [ocrChecks, setOcrChecks] = useState({});
  const [ocrRunningBulk, setOcrRunningBulk] = useState(false);

  const normalizeUtr = (value) => String(value || '').replace(/\s+/g, '').toUpperCase();
  const isValidUtr = (value) => /^[A-Z0-9]{10,30}$/.test(value);
  const getSubmissionUtr = (submission) => submission?.utr || submission?.transactionId || submission?.upiRefNo || submission?.upiRef || '';
  const getSubmissionScreenshot = (submission) => submission?.screenshot || submission?.paymentScreenshot || submission?.proofScreenshot || submission?.proofImageUrl || '';

  const extractUtrFromOcrText = (text) => {
    const safeText = String(text || '').toUpperCase();
    if (!safeText) return '';

    const contextualPatterns = [
      /(?:UTR|UPI\s*REF(?:ERENCE)?|TRANSACTION\s*ID|TXN\s*ID|REF(?:ERENCE)?\s*NO)[\s:#-]*([A-Z0-9]{10,30})/g,
      /(?:RRN|REF\.?\s*NO\.?)[\s:#-]*([A-Z0-9]{10,30})/g
    ];

    for (const pattern of contextualPatterns) {
      const match = pattern.exec(safeText);
      if (match?.[1]) {
        const candidate = normalizeUtr(match[1]);
        if (isValidUtr(candidate)) return candidate;
      }
    }

    const genericMatches = safeText.match(/[A-Z0-9]{10,30}/g) || [];
    const candidate = genericMatches.find((value) => {
      const cleaned = normalizeUtr(value);
      if (!isValidUtr(cleaned)) return false;
      if (/^(SUCCESS|PAYMENT|UPI|CREDIT|DEBIT|APPROVED|COMPLETED)$/.test(cleaned)) return false;
      return true;
    });

    return candidate ? normalizeUtr(candidate) : '';
  };

  const runOcrUtrCheck = async (submission) => {
    const screenshotProof = getSubmissionScreenshot(submission);
    const enteredUtr = normalizeUtr(getSubmissionUtr(submission));

    if (!screenshotProof) {
      setOcrChecks((prev) => ({
        ...prev,
        [submission.id]: { status: 'no_screenshot', extractedUtr: '', enteredUtr }
      }));
      return;
    }

    setOcrChecks((prev) => ({
      ...prev,
      [submission.id]: { status: 'checking', extractedUtr: '', enteredUtr }
    }));

    try {
      const ocrResult = await Tesseract.recognize(screenshotProof, 'eng');
      const text = ocrResult?.data?.text || '';
      const confidence = Number(ocrResult?.data?.confidence || 0);
      const extractedUtr = extractUtrFromOcrText(text);

      if (!extractedUtr) {
        setOcrChecks((prev) => ({
          ...prev,
          [submission.id]: { status: 'not_found', extractedUtr: '', enteredUtr, confidence }
        }));
        return;
      }

      const isMatch = !!enteredUtr && normalizeUtr(extractedUtr) === normalizeUtr(enteredUtr);
      setOcrChecks((prev) => ({
        ...prev,
        [submission.id]: {
          status: isMatch ? 'matched' : 'mismatch',
          extractedUtr,
          enteredUtr,
          confidence
        }
      }));
    } catch (ocrError) {
      console.error('OCR check error:', ocrError);
      setOcrChecks((prev) => ({
        ...prev,
        [submission.id]: { status: 'error', extractedUtr: '', enteredUtr }
      }));
    }
  };

  const runBulkOcrCheck = async () => {
    const pendingWithScreenshots = submissions.filter((submission) => {
      if (submission.status !== 'pending') return false;
      return !!getSubmissionScreenshot(submission);
    });

    if (pendingWithScreenshots.length === 0) {
      await showAlert('No pending submissions with screenshot found for OCR check.', { title: 'OCR Check', intent: 'warning' });
      return;
    }

    try {
      setOcrRunningBulk(true);
      for (const submission of pendingWithScreenshots) {
        await runOcrUtrCheck(submission);
      }
    } finally {
      setOcrRunningBulk(false);
    }
  };

  const getOcrBadge = (submissionId) => {
    const check = ocrChecks[submissionId];
    if (!check) return { text: 'Not Checked', className: 'bg-gray-100 text-gray-700' };

    const map = {
      checking: { text: 'Checking...', className: 'bg-blue-100 text-blue-800' },
      matched: { text: 'UTR Matched ✅', className: 'bg-green-100 text-green-800' },
      mismatch: { text: 'UTR Mismatch ⚠️', className: 'bg-amber-100 text-amber-800' },
      not_found: { text: 'UTR Not Found', className: 'bg-orange-100 text-orange-800' },
      no_screenshot: { text: 'No Screenshot', className: 'bg-red-100 text-red-700' },
      error: { text: 'OCR Error', className: 'bg-red-100 text-red-700' }
    };

    return map[check.status] || { text: 'Not Checked', className: 'bg-gray-100 text-gray-700' };
  };

  const fetchSubmissions = useCallback(async () => {
    try {
      setLoading(true);
      const submissionsRef = collection(db, 'paymentSubmissions');
      
      let submissionsQuery;
      if (filter === 'all') {
        submissionsQuery = query(submissionsRef);
      } else {
        submissionsQuery = query(submissionsRef, where('status', '==', filter));
      }
      
      const snapshot = await getDocs(submissionsQuery);
      const data = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
      });

      data.sort((a, b) => {
        const aTime = a?.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const bTime = b?.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        return bTime - aTime;
      });
      
      setSubmissions(data);
    } catch (error) {
      console.error('Error fetching submissions:', error);
      await showAlert('Failed to load submissions', { title: 'Load Error', intent: 'error' });
    } finally {
      setLoading(false);
    }
  }, [filter, showAlert]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  const handleApprove = async (submission) => {
    const approved = await showConfirm(
      `Approve payment from ${submission.tenantName} (Room ${submission.roomNumber})?\n\nAmount: ₹${submission.paidAmount}`,
      { title: 'Approve Payment', confirmLabel: 'Approve', intent: 'warning' }
    );
    if (!approved) {
      return;
    }

    const normalizedUtr = normalizeUtr(getSubmissionUtr(submission));
    const screenshotProof = getSubmissionScreenshot(submission);
    if (!isValidUtr(normalizedUtr)) {
      await showAlert('Cannot approve: valid UTR is required (10-30 letters/numbers).', { title: 'Approval Blocked', intent: 'error' });
      return;
    }

    if (!screenshotProof) {
      await showAlert('Cannot approve: payment screenshot proof is missing.', { title: 'Approval Blocked', intent: 'error' });
      return;
    }

    const hasRoomBreakdown = Array.isArray(submission.roomBreakdown) && submission.roomBreakdown.length > 0;
    const previousReading = Number(submission.previousReading ?? 0);
    const currentReading = Number(submission.meterReading ?? submission.currentReading ?? 0);
    const unitsConsumed = Number.isFinite(currentReading) && Number.isFinite(previousReading)
      ? Math.max(0, currentReading - previousReading)
      : 0;

    try {
      setProcessing(true);

      const submissionGroupId = `sub_${submission.id}`;
      const nowIso = new Date().toISOString();

      if (hasRoomBreakdown) {
        for (const roomEntry of submission.roomBreakdown) {
          const roomPrevious = Number(roomEntry.previousReading ?? 0);
          const roomCurrent = Number(roomEntry.currentReading ?? roomEntry.meterReading ?? 0);
          const roomUnits = Number.isFinite(roomCurrent) && Number.isFinite(roomPrevious)
            ? Math.max(0, roomCurrent - roomPrevious)
            : Number(roomEntry.unitsConsumed ?? 0);
          const roomRent = Number(roomEntry.rentAmount ?? 0);
          const roomElectricity = Number(roomEntry.electricityAmount ?? 0);
          const roomTotal = Number(roomEntry.totalAmount ?? (roomRent + roomElectricity));
          const roomNumber = roomEntry.roomNumber;

          await addDoc(collection(db, 'payments'), {
            tenantId: submission.tenantId,
            tenantNameSnapshot: submission.tenantName,
            roomNumber,
            year: submission.year,
            month: submission.month,
            rent: roomRent,
            electricity: roomElectricity,
            paidAmount: roomTotal,
            oldReading: roomPrevious,
            currentReading: roomCurrent,
            previousReading: roomPrevious,
            meterReading: roomCurrent,
            units: roomUnits,
            unitsConsumed: roomUnits,
            paidDate: submission.paidDate,
            paymentMethod: 'UPI',
            utr: normalizedUtr,
            screenshot: screenshotProof,
            notes: submission.notes,
            status: 'paid',
            isMultiRoomPayment: true,
            sourceSubmissionId: submission.id,
            submissionGroupId,
            createdAt: nowIso,
            verifiedBy: currentUser?.email || 'admin',
            verifiedAt: nowIso
          });

          if (Number.isFinite(roomCurrent) && roomCurrent > 0) {
            const roomsRef = collection(db, 'rooms');
            const roomQuery = query(roomsRef, where('roomNumber', '==', roomNumber));
            const roomSnapshot = await getDocs(roomQuery);

            if (!roomSnapshot.empty) {
              await updateDoc(doc(db, 'rooms', roomSnapshot.docs[0].id), {
                currentReading: roomCurrent,
                lastUpdated: nowIso
              });
            }
          }
        }
      } else {
        await addDoc(collection(db, 'payments'), {
          tenantId: submission.tenantId,
          tenantNameSnapshot: submission.tenantName,
          roomNumber: submission.roomNumber,
          year: submission.year,
          month: submission.month,
          rent: submission.rentAmount,
          electricity: submission.electricityAmount,
          paidAmount: submission.paidAmount,
          oldReading: previousReading,
          currentReading,
          previousReading,
          meterReading: currentReading,
          units: unitsConsumed,
          unitsConsumed,
          paidDate: submission.paidDate,
          paymentMethod: 'UPI',
          utr: normalizedUtr,
          screenshot: screenshotProof,
          notes: submission.notes,
          status: 'paid',
          sourceSubmissionId: submission.id,
          createdAt: nowIso,
          verifiedBy: currentUser?.email || 'admin',
          verifiedAt: nowIso
        });

        // Update room meter reading if provided
        if (submission.meterReading && submission.meterReading > 0) {
          const roomsRef = collection(db, 'rooms');
          const roomQuery = query(roomsRef, where('roomNumber', '==', submission.roomNumber));
          const roomSnapshot = await getDocs(roomQuery);

          if (!roomSnapshot.empty) {
            await updateDoc(doc(db, 'rooms', roomSnapshot.docs[0].id), {
              currentReading: submission.meterReading,
              lastUpdated: nowIso
            });
          }
        }
      }

      // Update submission status
      await updateDoc(doc(db, 'paymentSubmissions', submission.id), {
        status: 'verified',
        utr: normalizedUtr,
        screenshot: screenshotProof,
        verifiedBy: currentUser?.email || 'admin',
        verifiedAt: new Date().toISOString()
      });

      await showAlert('✅ Payment approved and recorded successfully!', { title: 'Payment Verified', intent: 'success' });
      fetchSubmissions();
    } catch (error) {
      console.error('Error approving payment:', error);
      await showAlert('Failed to approve payment. Please try again.', { title: 'Approval Failed', intent: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async (submission) => {
    const reason = await showPrompt(
      `Reject payment from ${submission.tenantName}?\n\nEnter reason for rejection:`,
      {
        title: 'Reject Payment',
        placeholder: 'Enter rejection reason',
        required: true,
        confirmLabel: 'Reject',
        intent: 'warning'
      }
    );
    if (!reason?.trim()) return;

    try {
      setProcessing(true);

      await updateDoc(doc(db, 'paymentSubmissions', submission.id), {
        status: 'rejected',
        rejectionReason: reason.trim(),
        verifiedBy: currentUser?.email || 'admin',
        verifiedAt: new Date().toISOString()
      });

      await showAlert('❌ Payment submission rejected.', { title: 'Submission Rejected', intent: 'warning' });
      fetchSubmissions();
    } catch (error) {
      console.error('Error rejecting payment:', error);
      await showAlert('Failed to reject payment. Please try again.', { title: 'Reject Failed', intent: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const handleEdit = (submission) => {
    setEditingSubmission({ ...submission });
  };

  const handleSaveEdit = async () => {
    if (!editingSubmission) return;

    try {
      setProcessing(true);

      const previousReading = parseFloat(editingSubmission.previousReading) || 0;
      const meterReading = parseFloat(editingSubmission.meterReading) || 0;
      const unitsConsumed = Math.max(0, meterReading - previousReading);

      await updateDoc(doc(db, 'paymentSubmissions', editingSubmission.id), {
        paidAmount: parseFloat(editingSubmission.paidAmount),
        rentAmount: parseFloat(editingSubmission.rentAmount),
        electricityAmount: parseFloat(editingSubmission.electricityAmount),
        previousReading,
        meterReading,
        unitsConsumed,
        paidDate: editingSubmission.paidDate,
        utr: editingSubmission.utr,
        notes: editingSubmission.notes,
        updatedAt: new Date().toISOString()
      });

      await showAlert('✅ Submission updated successfully!', { title: 'Updated', intent: 'success' });
      setEditingSubmission(null);
      fetchSubmissions();
    } catch (error) {
      console.error('Error updating submission:', error);
      await showAlert('Failed to update submission. Please try again.', { title: 'Update Failed', intent: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = async (submission) => {
    const confirmed = await showConfirm(
      `Delete this submission from ${submission.tenantName}?\n\nThis action cannot be undone.`,
      { title: 'Delete Submission', confirmLabel: 'Delete', intent: 'warning' }
    );
    if (!confirmed) {
      return;
    }

    try {
      setProcessing(true);
      await deleteDoc(doc(db, 'paymentSubmissions', submission.id));
      await showAlert('🗑️ Submission deleted.', { title: 'Deleted', intent: 'success' });
      fetchSubmissions();
    } catch (error) {
      console.error('Error deleting submission:', error);
      await showAlert('Failed to delete submission. Please try again.', { title: 'Delete Failed', intent: 'error' });
    } finally {
      setProcessing(false);
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: { text: 'Pending', class: 'bg-yellow-100 text-yellow-800' },
      verified: { text: 'Verified', class: 'bg-green-100 text-green-800' },
      rejected: { text: 'Rejected', class: 'bg-red-100 text-red-800' }
    };
    const badge = badges[status] || { text: status, class: 'bg-gray-100 text-gray-800' };
    return <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badge.class}`}>{badge.text}</span>;
  };

  if (loading) {
    return (
      <div className="p-4 lg:p-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading submissions...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">🔍 Verify Payments</h1>
        <p className="text-gray-600">Review and approve tenant payment submissions</p>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto">
        {['pending', 'verified', 'rejected', 'all'].map((filterType) => (
          <button
            key={filterType}
            onClick={() => setFilter(filterType)}
            className={`px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap transition ${
              filter === filterType
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {filterType.charAt(0).toUpperCase() + filterType.slice(1)}
            {filterType !== 'all' && (
              <span className="ml-2 bg-white bg-opacity-30 px-2 py-0.5 rounded-full text-xs">
                {submissions.filter(s => s.status === filterType).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mb-4">
        <button
          type="button"
          onClick={runBulkOcrCheck}
          disabled={ocrRunningBulk}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {ocrRunningBulk ? 'Running OCR Check...' : 'Run OCR UTR Check (Pending)'}
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-yellow-800">
            {submissions.filter(s => s.status === 'pending').length}
          </div>
          <div className="text-sm text-yellow-700">Pending Review</div>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-green-800">
            {submissions.filter(s => s.status === 'verified').length}
          </div>
          <div className="text-sm text-green-700">Verified</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="text-2xl font-bold text-red-800">
            {submissions.filter(s => s.status === 'rejected').length}
          </div>
          <div className="text-sm text-red-700">Rejected</div>
        </div>
      </div>

      {/* Submissions List */}
      {submissions.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <div className="text-6xl mb-4">📭</div>
          <h3 className="text-xl font-semibold text-gray-700 mb-2">No submissions found</h3>
          <p className="text-gray-500">
            {filter === 'pending' ? 'All caught up! No pending payments to review.' : `No ${filter} submissions.`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map((submission) => (
            (() => {
              const safeUtr = getSubmissionUtr(submission);
              const screenshotProof = getSubmissionScreenshot(submission);
              const totalPayable = Number(submission.rentAmount || 0) + Number(submission.electricityAmount || 0);
              const paidAmount = Number(submission.paidAmount || 0);
              const balanceAmount = Math.max(totalPayable - paidAmount, 0);
              const isPartial = paidAmount > 0 && paidAmount < totalPayable;

              return (
            <div key={submission.id} className="bg-white rounded-lg shadow-md border-2 border-gray-200 overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-6 py-3 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">{submission.tenantName}</h3>
                  <p className="text-sm text-white text-opacity-90">
                    Room{Array.isArray(submission.roomNumbers) && submission.roomNumbers.length > 1 ? 's' : ''} {Array.isArray(submission.roomNumbers) && submission.roomNumbers.length > 0 ? submission.roomNumbers.join(', ') : submission.roomNumber}
                  </p>
                </div>
                <div className="text-right">
                  {getStatusBadge(submission.status)}
                  <p className="text-xs text-white text-opacity-90 mt-1">
                    {new Date(submission.submittedAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Body */}
              <div className="p-6">
                <div className="mb-3 flex items-center gap-2">
                  {(() => {
                    const badge = getOcrBadge(submission.id);
                    return (
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${badge.className}`}>
                        OCR: {badge.text}
                      </span>
                    );
                  })()}
                  {submission.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => runOcrUtrCheck(submission)}
                      disabled={ocrChecks[submission.id]?.status === 'checking'}
                      className="text-xs font-semibold px-3 py-1 rounded-md bg-indigo-100 text-indigo-800 hover:bg-indigo-200 disabled:opacity-60"
                    >
                      {ocrChecks[submission.id]?.status === 'checking' ? 'Checking...' : 'Check Screenshot UTR'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Payment Date</label>
                    <p className="text-sm font-bold">{submission.paidDate}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Month/Year</label>
                    <p className="text-sm font-bold">{submission.month}/{submission.year}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">UTR Number</label>
                    <p className="text-sm font-mono font-bold">{safeUtr || '-'}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Rent Amount</label>
                    <p className="text-sm font-bold">₹{submission.rentAmount?.toLocaleString('en-IN')}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Electricity</label>
                    <p className="text-sm font-bold">₹{submission.electricityAmount?.toFixed(2)}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Total Paid</label>
                    <p className="text-lg font-bold text-green-600">₹{paidAmount.toLocaleString('en-IN')}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Total Payable</label>
                    <p className="text-sm font-bold">₹{totalPayable.toLocaleString('en-IN')}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Balance</label>
                    <p className={`text-sm font-bold ${balanceAmount > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                      ₹{balanceAmount.toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-semibold">Meter Reading</label>
                    <p className="text-sm font-bold">{submission.previousReading} → {submission.meterReading} ({submission.unitsConsumed} units)</p>
                  </div>
                </div>

                {isPartial && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                    <p className="text-sm font-semibold text-amber-900">⚠️ Partial Payment</p>
                    <p className="text-sm text-amber-800">Paid ₹{paidAmount.toLocaleString('en-IN')} out of ₹{totalPayable.toLocaleString('en-IN')} • Balance ₹{balanceAmount.toLocaleString('en-IN')}</p>
                  </div>
                )}

                {ocrChecks[submission.id]?.status && ocrChecks[submission.id]?.status !== 'checking' && (
                  <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 mb-4">
                    <p className="text-xs font-semibold text-indigo-800 mb-1">OCR UTR Check</p>
                    <p className="text-xs text-indigo-800">Entered UTR: {normalizeUtr(getSubmissionUtr(submission)) || '-'}</p>
                    <p className="text-xs text-indigo-800">Extracted UTR: {ocrChecks[submission.id]?.extractedUtr || '-'}</p>
                    {typeof ocrChecks[submission.id]?.confidence === 'number' && (
                      <p className="text-xs text-indigo-700 mt-1">OCR Confidence: {ocrChecks[submission.id].confidence.toFixed(1)}%</p>
                    )}
                  </div>
                )}

                {Array.isArray(submission.roomBreakdown) && submission.roomBreakdown.length > 0 && (
                  <div className="mb-4">
                    <label className="text-xs text-gray-500 font-semibold block mb-2">Room-wise Breakdown</label>
                    <div className="overflow-x-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs sm:text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left">Room</th>
                            <th className="px-3 py-2 text-right">Old</th>
                            <th className="px-3 py-2 text-right">Current</th>
                            <th className="px-3 py-2 text-right">Units</th>
                            <th className="px-3 py-2 text-right">Rent</th>
                            <th className="px-3 py-2 text-right">Electricity</th>
                            <th className="px-3 py-2 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {submission.roomBreakdown.map((entry, index) => (
                            <tr key={`${submission.id}_room_${index}`} className="border-t border-gray-100">
                              <td className="px-3 py-2 font-semibold">{entry.roomNumber}</td>
                              <td className="px-3 py-2 text-right font-mono">{entry.previousReading}</td>
                              <td className="px-3 py-2 text-right font-mono">{entry.currentReading}</td>
                              <td className="px-3 py-2 text-right">{entry.unitsConsumed ?? Math.max(0, Number(entry.currentReading || 0) - Number(entry.previousReading || 0))}</td>
                              <td className="px-3 py-2 text-right">₹{Number(entry.rentAmount || 0).toFixed(2)}</td>
                              <td className="px-3 py-2 text-right">₹{Number(entry.electricityAmount || 0).toFixed(2)}</td>
                              <td className="px-3 py-2 text-right font-semibold">₹{Number(entry.totalAmount || (Number(entry.rentAmount || 0) + Number(entry.electricityAmount || 0))).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {submission.notes && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                    <label className="text-xs text-blue-700 font-semibold">Notes</label>
                    <p className="text-sm text-blue-900">{submission.notes}</p>
                  </div>
                )}

                {screenshotProof && (
                  <div className="mb-4">
                    <label className="text-xs text-gray-500 font-semibold block mb-2">Screenshot</label>
                    {String(screenshotProof).startsWith('data:image') ? (
                      <a
                        href={screenshotProof}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block"
                      >
                        <img
                          src={screenshotProof}
                          alt="Payment screenshot"
                          className="max-h-56 w-auto rounded-lg border border-gray-300"
                        />
                      </a>
                    ) : (
                      <a 
                        href={screenshotProof} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline text-sm"
                      >
                        📸 View Screenshot
                      </a>
                    )}
                  </div>
                )}

                {!screenshotProof && (
                  <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-sm text-red-800">Screenshot proof not found in this submission.</p>
                  </div>
                )}

                {submission.status === 'rejected' && submission.rejectionReason && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                    <label className="text-xs text-red-700 font-semibold">Rejection Reason</label>
                    <p className="text-sm text-red-900">{submission.rejectionReason}</p>
                  </div>
                )}

                {/* Actions */}
                {submission.status === 'pending' && (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => handleApprove(submission)}
                      disabled={processing}
                      className="bg-green-500 hover:bg-green-600 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
                    >
                      ✅ Approve & Record
                    </button>
                    {(!Array.isArray(submission.roomBreakdown) || submission.roomBreakdown.length === 0) && (
                      <button
                        onClick={() => handleEdit(submission)}
                        disabled={processing}
                        className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
                      >
                        ✏️ Edit
                      </button>
                    )}
                    <button
                      onClick={() => handleReject(submission)}
                      disabled={processing}
                      className="bg-red-500 hover:bg-red-600 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
                    >
                      ❌ Reject
                    </button>
                  </div>
                )}

                {submission.status !== 'pending' && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDelete(submission)}
                      disabled={processing}
                      className="bg-gray-500 hover:bg-gray-600 text-white font-semibold px-4 py-2 rounded-lg transition text-sm disabled:opacity-50"
                    >
                      🗑️ Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
              );
            })()
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingSubmission && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-blue-600 text-white px-6 py-4 rounded-t-lg">
              <h3 className="text-xl font-bold">✏️ Edit Submission</h3>
              <p className="text-sm text-white text-opacity-90">Room {editingSubmission.roomNumber} - {editingSubmission.tenantName}</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Date</label>
                  <input
                    type="date"
                    value={editingSubmission.paidDate}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, paidDate: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Previous Reading</label>
                  <input
                    type="number"
                    value={editingSubmission.previousReading || 0}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, previousReading: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Current Meter Reading</label>
                  <input
                    type="number"
                    value={editingSubmission.meterReading}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, meterReading: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Rent Amount</label>
                  <input
                    type="number"
                    value={editingSubmission.rentAmount}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, rentAmount: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Electricity Amount</label>
                  <input
                    type="number"
                    value={editingSubmission.electricityAmount}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, electricityAmount: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Total Paid</label>
                  <input
                    type="number"
                    value={editingSubmission.paidAmount}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, paidAmount: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-green-300 rounded-lg font-bold"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">UTR Number</label>
                  <input
                    type="text"
                    value={editingSubmission.utr}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, utr: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
                <textarea
                  value={editingSubmission.notes}
                  onChange={(e) => setEditingSubmission({ ...editingSubmission, notes: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-gray-300 rounded-lg resize-none"
                  rows="3"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setEditingSubmission(null)}
                  className="flex-1 px-4 py-2 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={processing}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg disabled:opacity-50"
                >
                  {processing ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VerifyPayments;
