import { useState, useEffect, useCallback, useMemo } from 'react';
import { collection, query, where, getDocs, getDoc, doc, updateDoc, addDoc, deleteDoc } from '../utils/firestoreCounted';
import { db } from '../firebase';
import { useAuth } from '../AuthContext';
import { useDialog } from './ui/DialogProvider';
import { getPriorPendingMonths, allocateMultiMonthPayment } from '../utils/financial';
import Tesseract from 'tesseract.js';

const VerifyPayments = () => {
  const { currentUser } = useAuth();
  const { showAlert, showConfirm, showPrompt } = useDialog();
  // Always holds the FULL unfiltered submissions list, so the stat cards (which
  // double as the filter switcher) can show true counts for every status, not
  // just the currently-selected one.
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending'); // pending, verified, rejected, all
  const [selectedMonth, setSelectedMonth] = useState('all'); // 'all' or 'YYYY-M'

  // Every distinct year-month found in the data, newest first, for the month picker.
  const monthOptions = useMemo(() => {
    const seen = new Map();
    allSubmissions.forEach((s) => {
      const y = Number(s.year);
      const m = Number(s.month);
      if (!Number.isFinite(y) || !Number.isFinite(m)) return;
      const key = `${y}-${m}`;
      if (!seen.has(key)) {
        seen.set(key, {
          key,
          label: new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        });
      }
    });
    return Array.from(seen.values()).sort((a, b) => {
      const [ay, am] = a.key.split('-').map(Number);
      const [by, bm] = b.key.split('-').map(Number);
      return (by - ay) || (bm - am);
    });
  }, [allSubmissions]);

  // Submissions for the selected month (any status) — the stat cards' base.
  const monthScopedSubmissions = useMemo(() => {
    if (selectedMonth === 'all') return allSubmissions;
    const [y, m] = selectedMonth.split('-').map(Number);
    return allSubmissions.filter((s) => Number(s.year) === y && Number(s.month) === m);
  }, [allSubmissions, selectedMonth]);

  // Month-scoped submissions further narrowed by the active status filter — what
  // the list below actually renders.
  const submissions = useMemo(
    () => (filter === 'all' ? monthScopedSubmissions : monthScopedSubmissions.filter((s) => s.status === filter)),
    [monthScopedSubmissions, filter]
  );
  const [editingSubmission, setEditingSubmission] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [ocrChecks, setOcrChecks] = useState({});
  const [ocrRunningBulk, setOcrRunningBulk] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [viewingScreenshot, setViewingScreenshot] = useState(null);
  const [expandedSubmissions, setExpandedSubmissions] = useState(new Set());

  const ADMIN_NOTIFIED_KEY = 'admin_notified_submission_ids_v1';

  const toggleSubmission = (submissionId) => {
    setExpandedSubmissions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(submissionId)) {
        newSet.delete(submissionId);
      } else {
        newSet.add(submissionId);
      }
      return newSet;
    });
  };

  const getNotifiedSubmissionIds = () => {
    try {
      const raw = localStorage.getItem(ADMIN_NOTIFIED_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  };

  const saveNotifiedSubmissionIds = (idSet) => {
    localStorage.setItem(ADMIN_NOTIFIED_KEY, JSON.stringify(Array.from(idSet)));
  };

  const requestNotificationPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  const notifyAdminForSubmission = (submission) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const amount = Number(submission?.paidAmount || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    const notification = new Notification('💰 New Payment Verification Request', {
      body: `${submission.tenantName || 'Tenant'} ne ₹${amount} send kiya hai. Verify karne ke liye tap karein.`,
      tag: `submission_${submission.id}`
    });

    notification.onclick = () => {
      window.focus();
      window.location.href = '/verify-payments';
      notification.close();
    };
  };

  const checkForNewVerificationRequests = useCallback(async () => {
    try {
      const pendingSnapshot = await getDocs(query(collection(db, 'paymentSubmissions'), where('status', '==', 'pending')));
      const notifiedIds = getNotifiedSubmissionIds();
      let changed = false;

      pendingSnapshot.forEach((pendingDoc) => {
        if (notifiedIds.has(pendingDoc.id)) return;
        const submission = { id: pendingDoc.id, ...pendingDoc.data() };
        notifyAdminForSubmission(submission);
        notifiedIds.add(pendingDoc.id);
        changed = true;
      });

      if (changed) {
        saveNotifiedSubmissionIds(notifiedIds);
      }
    } catch (notificationError) {
      console.error('Error checking new verification requests:', notificationError);
    }
  }, []);

  const normalizeUtr = (value) => String(value || '').replace(/\s+/g, '').toUpperCase();
  const isValidUtr = (value) => /^[A-Z0-9]{10,30}$/.test(value);
  const getSubmissionUtr = (submission) => submission?.utr || submission?.transactionId || submission?.upiRefNo || submission?.upiRef || '';
  const getSubmissionScreenshot = (submission) => submission?.screenshot || submission?.paymentScreenshot || submission?.proofScreenshot || submission?.proofImageUrl || '';
  const formatLocalIsoDate = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const normalizeDateString = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    const ymd = raw.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
    if (ymd) {
      const [, y, m, d] = ymd;
      return `${y}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
    }

    const dmy = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
    if (dmy) {
      const [, d, m, y] = dmy;
      const fullYear = y.length === 2 ? `20${y}` : y;
      return `${fullYear}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
    }

    const parsedDate = new Date(raw);
    if (!Number.isNaN(parsedDate.getTime())) {
      return formatLocalIsoDate(parsedDate);
    }

    return '';
  };

  const extractDateFromOcrText = (text) => {
    const safeText = String(text || '').toUpperCase();
    if (!safeText) return '';

    const monthMap = {
      JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
      JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
    };

    const dmyPattern = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/g;
    const ymdPattern = /(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/g;
    const monthNamePattern = /(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s*(\d{2,4})/g;

    let match;
    while ((match = ymdPattern.exec(safeText)) !== null) {
      const [, y, m, d] = match;
      const candidate = `${y}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
      if (normalizeDateString(candidate)) return candidate;
    }

    while ((match = dmyPattern.exec(safeText)) !== null) {
      const [, d, m, y] = match;
      const fullYear = y.length === 2 ? `20${y}` : y;
      const candidate = `${fullYear}-${String(Number(m)).padStart(2, '0')}-${String(Number(d)).padStart(2, '0')}`;
      if (normalizeDateString(candidate)) return candidate;
    }

    while ((match = monthNamePattern.exec(safeText)) !== null) {
      const [, d, mon, y] = match;
      const fullYear = y.length === 2 ? `20${y}` : y;
      const month = monthMap[mon];
      const candidate = `${fullYear}-${month}-${String(Number(d)).padStart(2, '0')}`;
      if (normalizeDateString(candidate)) return candidate;
    }

    return '';
  };

  useEffect(() => {
    if (typeof Notification === 'undefined') return;

    if (Notification.permission === 'default') {
      Notification.requestPermission().then((permission) => {
        setNotificationPermission(permission);
      }).catch(() => {
        setNotificationPermission('denied');
      });
    } else {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  const getSubmissionMonthYear = (submission) => {
    const now = new Date();
    return {
      year: Number(submission?.year) || now.getFullYear(),
      month: Number(submission?.month) || (now.getMonth() + 1)
    };
  };

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
    const enteredPaidDate = normalizeDateString(submission?.paidDate);
    const todayDate = formatLocalIsoDate(new Date());

    if (!screenshotProof) {
      setOcrChecks((prev) => ({
        ...prev,
        [submission.id]: { status: 'no_screenshot', extractedUtr: '', enteredUtr, extractedDate: '', enteredPaidDate, todayDate }
      }));
      return;
    }

    setOcrChecks((prev) => ({
      ...prev,
      [submission.id]: { status: 'checking', extractedUtr: '', enteredUtr, extractedDate: '', enteredPaidDate, todayDate }
    }));

    try {
      const ocrResult = await Tesseract.recognize(screenshotProof, 'eng');
      const text = ocrResult?.data?.text || '';
      const confidence = Number(ocrResult?.data?.confidence || 0);
      const extractedUtr = extractUtrFromOcrText(text);
      const extractedDate = extractDateFromOcrText(text);

      if (!extractedUtr) {
        setOcrChecks((prev) => ({
          ...prev,
          [submission.id]: { status: 'not_found', extractedUtr: '', enteredUtr, extractedDate, enteredPaidDate, todayDate, confidence }
        }));
        return;
      }

      const utrMatch = !!enteredUtr && normalizeUtr(extractedUtr) === normalizeUtr(enteredUtr);
      const hasExtractedDate = !!extractedDate;
      const paidDateMatch = !!enteredPaidDate && hasExtractedDate && extractedDate === enteredPaidDate;
      const todayMatch = hasExtractedDate && extractedDate === todayDate;

      let status = 'mismatch';
      if (!utrMatch) {
        status = 'mismatch';
      } else if (!hasExtractedDate) {
        status = 'date_not_found';
      } else if (!paidDateMatch) {
        status = 'date_mismatch';
      } else if (!todayMatch) {
        status = 'old_screenshot';
      } else {
        status = 'matched';
      }

      setOcrChecks((prev) => ({
        ...prev,
        [submission.id]: {
          status,
          extractedUtr,
          enteredUtr,
          extractedDate,
          enteredPaidDate,
          todayDate,
          paidDateMatch,
          todayMatch,
          confidence
        }
      }));
    } catch (ocrError) {
      console.error('OCR check error:', ocrError);
      setOcrChecks((prev) => ({
        ...prev,
        [submission.id]: { status: 'error', extractedUtr: '', enteredUtr, extractedDate: '', enteredPaidDate, todayDate }
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
      checking: { text: 'Checking...', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300' },
      matched: { text: 'UTR + Date Matched ✅', className: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' },
      mismatch: { text: 'UTR Mismatch ⚠️', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' },
      date_not_found: { text: 'Date Not Found ⚠️', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300' },
      date_mismatch: { text: 'Date Mismatch ⚠️', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' },
      old_screenshot: { text: 'Old Screenshot Date ⚠️', className: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' },
      not_found: { text: 'UTR Not Found', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300' },
      no_screenshot: { text: 'No Screenshot', className: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' },
      error: { text: 'OCR Error', className: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300' }
    };

    return map[check.status] || { text: 'Not Checked', className: 'bg-gray-100 text-gray-700' };
  };

  const fetchSubmissions = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch the whole collection (unfiltered) — it's small (pending review items,
      // cleared periodically) — so the stat cards always show true per-status
      // counts. The active filter/tab view is derived from this client-side.
      const submissionsRef = collection(db, 'paymentSubmissions');
      const snapshot = await getDocs(query(submissionsRef));
      const data = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
      });

      data.sort((a, b) => {
        const aTime = a?.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const bTime = b?.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        return bTime - aTime;
      });

      setAllSubmissions(data);
    } catch (error) {
      console.error('Error fetching submissions:', error);
      await showAlert('Failed to load submissions', { title: 'Load Error', intent: 'error' });
    } finally {
      setLoading(false);
    }
  }, [showAlert]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  useEffect(() => {
    if (notificationPermission !== 'granted') return;

    checkForNewVerificationRequests();
    const intervalId = setInterval(checkForNewVerificationRequests, 20000);
    return () => clearInterval(intervalId);
  }, [checkForNewVerificationRequests, notificationPermission]);

  const handleApprove = async (submission) => {
    if (submission?.isPlaceholder) {
      await showAlert('Tenant has not submitted payment proof yet. Approval is not possible.', { title: 'Awaiting Submission', intent: 'warning' });
      return;
    }

    const ocrStatus = ocrChecks[submission.id]?.status;
    if (ocrStatus === 'date_mismatch' || ocrStatus === 'old_screenshot') {
      const warningText = ocrStatus === 'date_mismatch'
        ? 'OCR check me screenshot date submitted payment date se match nahi ho rahi hai.'
        : 'OCR check me screenshot date aaj ki date se match nahi ho rahi (old screenshot risk).';

      const continueWithRisk = await showConfirm(
        `${warningText}\n\nKya aap phir bhi approve karna chahte hain?`,
        { title: 'OCR Date Risk Detected', confirmLabel: 'Approve Anyway', intent: 'warning' }
      );

      if (!continueWithRisk) {
        return;
      }
    }

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
      const approveWithoutValidUtr = await showConfirm(
        'UTR format invalid hai. Kya aap phir bhi approve karna chahte hain?',
        { title: 'Invalid UTR', confirmLabel: 'Approve Anyway', intent: 'warning' }
      );
      if (!approveWithoutValidUtr) {
        return;
      }
    }

    if (!screenshotProof) {
      const approveWithoutScreenshot = await showConfirm(
        'Screenshot missing hai. Kya aap phir bhi approve karna chahte hain?',
        { title: 'Missing Screenshot', confirmLabel: 'Approve Anyway', intent: 'warning' }
      );
      if (!approveWithoutScreenshot) {
        return;
      }
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
      const { year: submissionYear, month: submissionMonth } = getSubmissionMonthYear(submission);
      const monthPaymentsSnapshot = await getDocs(
        query(
          collection(db, 'payments'),
          where('year', '==', submissionYear),
          where('month', '==', submissionMonth)
        )
      );
      const monthPayments = monthPaymentsSnapshot.docs.map((monthPaymentDoc) => ({ id: monthPaymentDoc.id, ...monthPaymentDoc.data() }));

      // Strip undefined values — Firestore rejects them
      const cleanPayload = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

      const upsertPaymentForRoom = async (roomPayload) => {
        const existingRecord = monthPayments.find((payment) => {
          const roomMatches = String(payment.roomNumber) === String(roomPayload.roomNumber);
          const tenantMatches = payment.tenantId === submission.tenantId || (payment.tenantNameSnapshot === submission.tenantName);
          return roomMatches && tenantMatches;
        });

        const sanitized = cleanPayload(roomPayload);
        const statusToSet = roomPayload.status || 'paid';

        if (existingRecord) {
          await updateDoc(doc(db, 'payments', existingRecord.id), {
            ...sanitized,
            status: statusToSet,
            verifiedBy: currentUser?.email || 'admin',
            verifiedAt: nowIso,
            updatedAt: nowIso,
            sourceSubmissionId: submission.id,
            submissionGroupId
          });
        } else {
          await addDoc(collection(db, 'payments'), {
            ...sanitized,
            status: statusToSet,
            sourceSubmissionId: submission.id,
            submissionGroupId,
            createdAt: nowIso,
            verifiedBy: currentUser?.email || 'admin',
            verifiedAt: nowIso
          });
        }
      };

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

          await upsertPaymentForRoom({
            tenantId: submission.tenantId,
            tenantNameSnapshot: submission.tenantName,
            roomNumber,
            year: submissionYear,
            month: submissionMonth,
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
            utr: normalizedUtr || getSubmissionUtr(submission) || '',
            notes: submission.notes,
            isMultiRoomPayment: true
          });

          if (Number.isFinite(roomCurrent) && roomCurrent > 0) {
            try {
              const roomsRef = collection(db, 'rooms');
              const roomQuery = query(roomsRef, where('roomNumber', '==', roomNumber));
              const roomSnapshot = await getDocs(roomQuery);

              if (!roomSnapshot.empty) {
                await updateDoc(doc(db, 'rooms', roomSnapshot.docs[0].id), {
                  currentReading: roomCurrent,
                  lastUpdated: nowIso
                });
              }
            } catch (roomUpdateError) {
              console.warn('Room reading update skipped for room', roomNumber, roomUpdateError);
            }
          }
        }
      } else {
        // A tenant sometimes clears a backlog by paying several months in one
        // go. If this payment is bigger than just the submitted month's own
        // dues, check whether the tenant actually has unpaid earlier months —
        // if so, split the amount across those months (oldest first) instead
        // of recording it all against this one month, so each month gets its
        // own 'paid' record and stops showing as pending.
        const targetRent = Number(submission.rentAmount) || 0;
        const targetElectricity = Number(submission.electricityAmount) || 0;
        const paidAmount = Number(submission.paidAmount) || 0;

        let priorMonths = [];
        if (submission.tenantId && paidAmount > targetRent + targetElectricity + 1) {
          const tenantSnap = await getDoc(doc(db, 'tenants', submission.tenantId));
          if (tenantSnap.exists()) {
            const tenantData = { id: tenantSnap.id, ...tenantSnap.data() };
            const tenantPaymentsSnap = await getDocs(query(collection(db, 'payments'), where('tenantId', '==', submission.tenantId)));
            const tenantAllPayments = tenantPaymentsSnap.docs.map((paymentDoc) => paymentDoc.data());
            priorMonths = getPriorPendingMonths(tenantData, tenantAllPayments, submissionYear, submissionMonth);
          }
        }

        if (priorMonths.length > 0) {
          const allocations = allocateMultiMonthPayment(
            priorMonths,
            { year: submissionYear, month: submissionMonth, rent: targetRent, electricity: targetElectricity },
            paidAmount
          );

          for (const allocation of allocations) {
            if (allocation.paidAmount <= 0) continue;
            const isTargetMonth = allocation.year === submissionYear && allocation.month === submissionMonth;
            await upsertPaymentForRoom({
              tenantId: submission.tenantId,
              tenantNameSnapshot: submission.tenantName,
              roomNumber: submission.roomNumber,
              year: allocation.year,
              month: allocation.month,
              rent: allocation.rent,
              electricity: allocation.electricity,
              paidAmount: allocation.paidAmount,
              status: allocation.status,
              ...(isTargetMonth ? {
                oldReading: previousReading,
                currentReading,
                previousReading,
                meterReading: currentReading,
                units: unitsConsumed,
                unitsConsumed
              } : {}),
              paidDate: submission.paidDate,
              paymentMethod: 'UPI',
              utr: normalizedUtr || getSubmissionUtr(submission) || '',
              notes: submission.notes,
              isMultiMonthSplit: true,
              splitFromSubmissionId: submission.id,
              splitTotalAmount: paidAmount
            });
          }
        } else {
          await upsertPaymentForRoom({
            tenantId: submission.tenantId,
            tenantNameSnapshot: submission.tenantName,
            roomNumber: submission.roomNumber,
            year: submissionYear,
            month: submissionMonth,
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
            utr: normalizedUtr || getSubmissionUtr(submission) || '',
            notes: submission.notes
          });
        }

        // Update room meter reading if provided
        if (submission.meterReading && submission.meterReading > 0) {
          try {
            const roomsRef = collection(db, 'rooms');
            const roomQuery = query(roomsRef, where('roomNumber', '==', submission.roomNumber));
            const roomSnapshot = await getDocs(roomQuery);

            if (!roomSnapshot.empty) {
              await updateDoc(doc(db, 'rooms', roomSnapshot.docs[0].id), {
                currentReading: submission.meterReading,
                lastUpdated: nowIso
              });
            }
          } catch (roomUpdateError) {
            console.warn('Room reading update skipped for room', submission.roomNumber, roomUpdateError);
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
      pending: { text: 'Pending', class: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-300' },
      verified: { text: 'Verified', class: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300' },
      rejected: { text: 'Rejected', class: 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300' }
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
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100 mb-2">🔍 Verify Payments</h1>
          <p className="text-gray-600 dark:text-slate-400">Review and approve tenant payment submissions</p>
          {notificationPermission !== 'granted' && (
            <button
              type="button"
              onClick={requestNotificationPermission}
              className="mt-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2 rounded-lg"
            >
              Enable Admin Notifications
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-2 bg-white dark:bg-slate-700 border-2 border-gray-200 dark:border-slate-600 rounded-xl pl-3 pr-2 py-1.5 shadow-sm focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/40 transition">
            <span className="text-base">📅</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              aria-label="Filter by month"
              className="bg-transparent text-sm font-semibold text-gray-900 dark:text-slate-100 focus:outline-none cursor-pointer"
            >
              <option value="all">All Months</option>
              {monthOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={runBulkOcrCheck}
            disabled={ocrRunningBulk}
            className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-xl shadow-sm hover:shadow-md transition disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {ocrRunningBulk ? '⏳ Running OCR Check...' : '🔍 Run OCR UTR + Date Check (Pending)'}
          </button>
        </div>
      </div>

      {/* Stats Cards — click to filter, replaces the separate filter-tab pills */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <button
          type="button"
          onClick={() => setFilter('pending')}
          className={`group relative overflow-hidden text-left bg-gradient-to-br from-yellow-50 to-amber-100 dark:from-yellow-950/40 dark:to-amber-950/30 border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300 ${filter === 'pending' ? 'border-yellow-400 dark:border-yellow-500 ring-2 ring-yellow-300 dark:ring-yellow-700' : 'border-yellow-200 dark:border-yellow-800'}`}
        >
          <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-amber-200/40 dark:bg-amber-800/20 blur-xl" />
          <div className="relative flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold text-yellow-800 dark:text-yellow-300">
                {monthScopedSubmissions.filter(s => s.status === 'pending').length}
              </div>
              <div className="text-sm font-semibold text-yellow-700 dark:text-yellow-400">Pending Review</div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/70 dark:bg-slate-800/60 text-xl shadow-inner ring-1 ring-yellow-200 dark:ring-yellow-800 group-hover:scale-110 transition-transform">⏳</div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setFilter('verified')}
          className={`group relative overflow-hidden text-left bg-gradient-to-br from-green-50 to-emerald-100 dark:from-green-950/40 dark:to-emerald-950/30 border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300 ${filter === 'verified' ? 'border-green-400 dark:border-green-500 ring-2 ring-green-300 dark:ring-green-700' : 'border-green-200 dark:border-green-800'}`}
        >
          <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-emerald-200/40 dark:bg-emerald-800/20 blur-xl" />
          <div className="relative flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold text-green-800 dark:text-green-300">
                {monthScopedSubmissions.filter(s => s.status === 'verified').length}
              </div>
              <div className="text-sm font-semibold text-green-700 dark:text-green-400">Verified</div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/70 dark:bg-slate-800/60 text-xl shadow-inner ring-1 ring-green-200 dark:ring-green-800 group-hover:scale-110 transition-transform">✅</div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setFilter('rejected')}
          className={`group relative overflow-hidden text-left bg-gradient-to-br from-red-50 to-rose-100 dark:from-red-950/40 dark:to-rose-950/30 border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300 ${filter === 'rejected' ? 'border-red-400 dark:border-red-500 ring-2 ring-red-300 dark:ring-red-700' : 'border-red-200 dark:border-red-800'}`}
        >
          <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-rose-200/40 dark:bg-rose-800/20 blur-xl" />
          <div className="relative flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold text-red-800 dark:text-red-300">
                {monthScopedSubmissions.filter(s => s.status === 'rejected').length}
              </div>
              <div className="text-sm font-semibold text-red-700 dark:text-red-400">Rejected</div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/70 dark:bg-slate-800/60 text-xl shadow-inner ring-1 ring-red-200 dark:ring-red-800 group-hover:scale-110 transition-transform">❌</div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setFilter('all')}
          className={`group relative overflow-hidden text-left bg-gradient-to-br from-slate-50 to-gray-100 dark:from-slate-800 dark:to-slate-700 border rounded-2xl p-4 shadow-sm hover:shadow-md transition-all duration-300 ${filter === 'all' ? 'border-slate-400 dark:border-slate-500 ring-2 ring-slate-300 dark:ring-slate-600' : 'border-gray-200 dark:border-slate-700'}`}
        >
          <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-gray-300/30 dark:bg-slate-600/20 blur-xl" />
          <div className="relative flex items-center justify-between">
            <div>
              <div className="text-2xl font-bold text-gray-800 dark:text-slate-100">
                {monthScopedSubmissions.length}
              </div>
              <div className="text-sm font-semibold text-gray-600 dark:text-slate-300">All</div>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white/70 dark:bg-slate-800/60 text-xl shadow-inner ring-1 ring-gray-200 dark:ring-slate-600 group-hover:scale-110 transition-transform">📋</div>
          </div>
        </button>
      </div>

      {/* Submissions List */}
      {submissions.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-8 text-center">
          <div className="text-6xl mb-4">📭</div>
          <h3 className="text-xl font-semibold text-gray-700 dark:text-slate-200 mb-2">No submissions found</h3>
          <p className="text-gray-500 dark:text-slate-400">
            {filter === 'pending' ? 'All caught up! No pending payments to review' : `No ${filter} submissions`}
            {selectedMonth !== 'all' && ` for ${monthOptions.find((o) => o.key === selectedMonth)?.label || 'this month'}`}.
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
              const isExpanded = expandedSubmissions.has(submission.id);
              const ocrBadge = getOcrBadge(submission.id);

              return (
            <div key={submission.id} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm hover:shadow-md transition-shadow border border-gray-200 dark:border-slate-700 overflow-hidden">
              {/* Collapsed Header - Always Visible */}
              <div 
                onClick={() => toggleSubmission(submission.id)}
                className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-6 py-4 cursor-pointer hover:from-blue-600 hover:to-indigo-700 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold">{submission.tenantName}</h3>
                      <span className="text-xs bg-white bg-opacity-20 px-2 py-1 rounded">
                        Room {Array.isArray(submission.roomNumbers) && submission.roomNumbers.length > 0 ? submission.roomNumbers.join(', ') : submission.roomNumber}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="font-semibold">₹{paidAmount.toLocaleString('en-IN')}</span>
                      <span className="text-white text-opacity-80">•</span>
                      <span>{submission.paidDate || 'Date N/A'}</span>
                      <span className="text-white text-opacity-80">•</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${ocrBadge.className}`}>
                        {ocrBadge.text}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {getStatusBadge(submission.status)}
                    <svg 
                      className={`w-6 h-6 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Expanded Details - Only When Expanded */}
              {isExpanded && (
                <div className="p-4">
                  {/* Main Layout: Left Content + Right Screenshot */}
                  <div className="flex flex-col lg:flex-row gap-4">
                    
                    {/* Left Side: Details */}
                    <div className="flex-1 space-y-3">
                      
                      {/* OCR Check Button */}
                      {submission.status === 'pending' && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); runOcrUtrCheck(submission); }}
                            disabled={ocrChecks[submission.id]?.status === 'checking'}
                            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                          >
                            {ocrChecks[submission.id]?.status === 'checking' ? 'Checking...' : '🔍 Check Screenshot UTR + Date'}
                          </button>
                        </div>
                      )}

                      {/* Payment Details Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        <div className="bg-gray-50 dark:bg-slate-700/60 rounded-lg p-2.5 ring-1 ring-gray-200 dark:ring-slate-600">
                          <label className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase tracking-wide">Payment Date</label>
                          <p className="text-sm font-bold text-gray-900 dark:text-slate-100">{submission.paidDate || '-'}</p>
                        </div>
                        <div className="bg-gray-50 dark:bg-slate-700/60 rounded-lg p-2.5 ring-1 ring-gray-200 dark:ring-slate-600">
                          <label className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase tracking-wide">Month/Year</label>
                          <p className="text-sm font-bold text-gray-900 dark:text-slate-100">{submission.month}/{submission.year}</p>
                        </div>
                        <div className="bg-gray-50 dark:bg-slate-700/60 rounded-lg p-2.5 ring-1 ring-gray-200 dark:ring-slate-600">
                          <label className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase tracking-wide">UTR Number</label>
                          <p className="text-xs font-mono font-bold break-all text-gray-900 dark:text-slate-100">{safeUtr || '-'}</p>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-2.5 ring-1 ring-blue-200 dark:ring-blue-800">
                          <label className="text-[10px] text-blue-600 dark:text-blue-400 font-semibold uppercase tracking-wide">Rent</label>
                          <p className="text-sm font-bold text-blue-700 dark:text-blue-300">₹{submission.rentAmount?.toLocaleString('en-IN')}</p>
                        </div>
                        <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-2.5 ring-1 ring-purple-200 dark:ring-purple-800">
                          <label className="text-[10px] text-purple-600 dark:text-purple-400 font-semibold uppercase tracking-wide">Electricity</label>
                          <p className="text-sm font-bold text-purple-700 dark:text-purple-300">
                            ₹{submission.electricityAmount?.toFixed(2)}
                            {submission.unitsConsumed > 0 && submission.electricityAmount > 0 && (
                              <span className="text-[10px] font-normal text-purple-500 dark:text-purple-400 ml-1">
                                ({submission.unitsConsumed} × ₹{(submission.electricityAmount / submission.unitsConsumed).toFixed(1)}/unit)
                              </span>
                            )}
                          </p>
                        </div>
                        <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-2.5 ring-1 ring-green-200 dark:ring-green-800">
                          <label className="text-[10px] text-green-600 dark:text-green-400 font-semibold uppercase tracking-wide">Total Paid</label>
                          <p className="text-sm font-bold text-green-700 dark:text-green-300">₹{paidAmount.toLocaleString('en-IN')}</p>
                        </div>
                        <div className="bg-gray-50 dark:bg-slate-700/60 rounded-lg p-2.5 ring-1 ring-gray-200 dark:ring-slate-600">
                          <label className="text-[10px] text-gray-500 dark:text-slate-400 font-semibold uppercase tracking-wide">Total Payable</label>
                          <p className="text-sm font-bold text-gray-900 dark:text-slate-100">₹{totalPayable.toLocaleString('en-IN')}</p>
                        </div>
                        <div className={`rounded-lg p-2.5 ring-1 ${balanceAmount > 0 ? 'bg-amber-50 dark:bg-amber-950/30 ring-amber-200 dark:ring-amber-800' : 'bg-green-50 dark:bg-green-950/30 ring-green-200 dark:ring-green-800'}`}>
                          <label className={`text-[10px] font-semibold uppercase tracking-wide ${balanceAmount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>Balance</label>
                          <p className={`text-sm font-bold ${balanceAmount > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-green-700 dark:text-green-300'}`}>
                            ₹{balanceAmount.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div className="bg-indigo-50 dark:bg-indigo-950/30 rounded-lg p-2.5 ring-1 ring-indigo-200 dark:ring-indigo-800">
                          <label className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold uppercase tracking-wide">Meter Reading</label>
                          <p className="text-xs font-bold text-indigo-700 dark:text-indigo-300">{submission.previousReading} → {submission.meterReading} ({submission.unitsConsumed} Units)</p>
                        </div>
                      </div>

                      {/* Partial Payment Warning */}
                      {isPartial && (
                        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg p-2.5">
                          <p className="text-xs font-semibold text-amber-900 dark:text-amber-300">⚠️ Partial Payment: ₹{paidAmount.toLocaleString('en-IN')} / ₹{totalPayable.toLocaleString('en-IN')} • Balance: ₹{balanceAmount.toLocaleString('en-IN')}</p>
                        </div>
                      )}

                      {/* OCR Check Results with Visual Indicators */}
                      {ocrChecks[submission.id]?.status && ocrChecks[submission.id]?.status !== 'checking' && (
                        <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-300 dark:border-indigo-800 rounded-lg p-2">
                          <p className="text-xs font-bold text-indigo-900 dark:text-indigo-300 mb-1.5">🔍 OCR Verification:</p>
                          
                          {(() => {
                            const enteredUtr = normalizeUtr(getSubmissionUtr(submission));
                            const extractedUtr = ocrChecks[submission.id]?.extractedUtr || '';
                            const utrMatch = enteredUtr && extractedUtr && enteredUtr === extractedUtr;
                            
                            const enteredDate = ocrChecks[submission.id]?.enteredPaidDate || '';
                            const extractedDate = ocrChecks[submission.id]?.extractedDate || '';
                            const todayDate = ocrChecks[submission.id]?.todayDate || '';
                            const dateMatch = enteredDate && extractedDate && enteredDate === extractedDate;
                            const todayMatch = extractedDate && todayDate && extractedDate === todayDate;
                            
                            return (
                              <div className="space-y-1">
                                {/* UTR Check - One Line */}
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm">{utrMatch ? '✅' : '❌'}</span>
                                  <span className="text-[11px] font-semibold text-gray-700 dark:text-slate-300">UTR:</span>
                                  <span className={`text-[11px] font-mono ${utrMatch ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'} flex-1 truncate`}>
                                    {enteredUtr || '-'} {extractedUtr && `(OCR: ${extractedUtr})`}
                                  </span>
                                </div>
                                
                                {/* Payment Date Check - One Line */}
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm">{dateMatch ? '✅' : '❌'}</span>
                                  <span className="text-[11px] font-semibold text-gray-700 dark:text-slate-300">Date:</span>
                                  <span className={`text-[11px] ${dateMatch ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                                    {enteredDate || '-'} {extractedDate && `(OCR: ${extractedDate})`}
                                  </span>
                                </div>
                                
                                {/* Today Date Check - One Line */}
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm">{todayMatch ? '✅' : '❌'}</span>
                                  <span className="text-[11px] font-semibold text-gray-700 dark:text-slate-300">Today:</span>
                                  <span className={`text-[11px] ${todayMatch ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                                    {extractedDate || '-'} vs {todayDate || '-'}
                                  </span>
                                </div>
                                
                                {typeof ocrChecks[submission.id]?.confidence === 'number' && (
                                  <p className="text-[10px] text-gray-600 mt-1">Confidence: {ocrChecks[submission.id].confidence.toFixed(1)}%</p>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* Room Breakdown Table */}
                      {Array.isArray(submission.roomBreakdown) && submission.roomBreakdown.length > 0 && (
                        <div>
                          <label className="text-xs text-gray-500 font-semibold block mb-2">Room-wise Breakdown</label>
                          <div className="rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden">
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-200 dark:bg-slate-700 border-b-2 border-slate-300 dark:border-slate-600">
                                  <tr>
                                    <th className="px-2 py-1.5 text-left text-[10px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Room</th>
                                    <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Old</th>
                                    <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Current</th>
                                    <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Units</th>
                                    <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Rent</th>
                                    <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Elec</th>
                                    <th className="px-2 py-1.5 text-right text-[10px] font-extrabold uppercase tracking-wider text-gray-700 dark:text-slate-200">Total</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                                  {submission.roomBreakdown.map((entry, index) => {
                                    const units = entry.unitsConsumed ?? Math.max(0, Number(entry.currentReading || 0) - Number(entry.previousReading || 0));
                                    const elecAmount = Number(entry.electricityAmount || 0);
                                    const rate = units > 0 && elecAmount > 0 ? (elecAmount / units).toFixed(1) : 0;
                                    const totalAmount = Number(entry.totalAmount || (Number(entry.rentAmount || 0) + elecAmount));

                                    return (
                                      <tr key={`${submission.id}_room_${index}`}>
                                        <td className="px-2 py-1.5 font-semibold">{entry.roomNumber}</td>
                                        <td className="px-2 py-1.5 text-right font-mono">{entry.previousReading}</td>
                                        <td className="px-2 py-1.5 text-right font-mono">{entry.currentReading}</td>
                                        <td className="px-2 py-1.5 text-right">{units} Units</td>
                                        <td className="px-2 py-1.5 text-right">₹{Number(entry.rentAmount || 0).toLocaleString('en-IN')}</td>
                                        <td className="px-2 py-1.5 text-right">
                                          ₹{elecAmount.toLocaleString('en-IN')}
                                          {rate > 0 && (
                                            <div className="text-[9px] text-gray-500 dark:text-slate-400">({units}×₹{rate})</div>
                                          )}
                                        </td>
                                        <td className="px-2 py-1.5 text-right font-semibold">₹{totalAmount.toLocaleString('en-IN')}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Notes */}
                      {submission.notes && (
                        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-2.5">
                          <label className="text-xs text-blue-700 dark:text-blue-400 font-semibold">Notes</label>
                          <p className="text-xs text-blue-900 dark:text-blue-200">{submission.notes}</p>
                        </div>
                      )}

                      {/* Rejection Reason */}
                      {submission.status === 'rejected' && submission.rejectionReason && (
                        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-2.5">
                          <label className="text-xs text-red-700 dark:text-red-400 font-semibold">Rejection Reason</label>
                          <p className="text-xs text-red-900 dark:text-red-200">{submission.rejectionReason}</p>
                        </div>
                      )}
                    </div>

                    {/* Right Side: Screenshot */}
                    <div className="lg:w-80 flex-shrink-0">
                      {screenshotProof ? (
                        <div className="sticky top-4">
                          <label className="text-xs text-gray-500 dark:text-slate-400 font-semibold block mb-2">Payment Screenshot</label>
                          <div
                            onClick={(e) => { e.stopPropagation(); setViewingScreenshot(screenshotProof); }}
                            className="cursor-pointer rounded-lg overflow-hidden border-2 border-gray-300 dark:border-slate-600 hover:border-indigo-500 dark:hover:border-indigo-400 transition-all bg-gray-50 dark:bg-slate-700"
                          >
                            <img
                              src={screenshotProof}
                              alt="Payment screenshot"
                              className="w-full max-h-80 object-contain hover:opacity-90 transition-opacity"
                            />
                          </div>
                          <p className="text-xs text-gray-500 dark:text-slate-400 text-center mt-2">Click to view full size</p>
                        </div>
                      ) : (
                        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-3">
                          <p className="text-xs text-red-800 dark:text-red-300">❌ Screenshot not found</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-4 pt-3 border-t border-gray-200 dark:border-slate-700">
                    {submission.status === 'pending' && (
                      <div className="flex gap-2 flex-wrap">
                        {submission.awaitingSubmission ? (
                          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm font-semibold px-3 py-2 rounded-lg">
                            Awaiting tenant payment submission
                          </div>
                        ) : (
                          <>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleApprove(submission); }}
                          disabled={processing}
                          className="bg-green-500 hover:bg-green-600 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
                        >
                          ✅ Approve & Record
                        </button>
                        {(!Array.isArray(submission.roomBreakdown) || submission.roomBreakdown.length === 0) && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEdit(submission); }}
                            disabled={processing}
                            className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
                          >
                            ✏️ Edit
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleReject(submission); }}
                          disabled={processing}
                          className="bg-red-500 hover:bg-red-600 text-white font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
                        >
                          ❌ Reject
                        </button>
                          </>
                        )}
                      </div>
                    )}

                    {submission.status !== 'pending' && (
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(submission); }}
                          disabled={processing}
                          className="bg-gray-500 hover:bg-gray-600 text-white font-semibold px-4 py-2 rounded-lg transition text-sm disabled:opacity-50"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    )}
                  </div>
              </div>
              )}
            </div>
              );
            })()
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingSubmission && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="bg-blue-600 text-white px-6 py-4 rounded-t-lg">
              <h3 className="text-xl font-bold">✏️ Edit Submission</h3>
              <p className="text-sm text-white text-opacity-90">Room {editingSubmission.roomNumber} - {editingSubmission.tenantName}</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">Payment Date</label>
                  <input
                    type="date"
                    value={editingSubmission.paidDate}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, paidDate: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 [color-scheme:light] dark:[color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">Previous Reading</label>
                  <input
                    type="number"
                    value={editingSubmission.previousReading || 0}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, previousReading: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">Current Meter Reading</label>
                  <input
                    type="number"
                    value={editingSubmission.meterReading}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, meterReading: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">Rent Amount</label>
                  <input
                    type="number"
                    value={editingSubmission.rentAmount}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, rentAmount: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">Electricity Amount</label>
                  <input
                    type="number"
                    value={editingSubmission.electricityAmount}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, electricityAmount: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">Total Paid</label>
                  <input
                    type="number"
                    value={editingSubmission.paidAmount}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, paidAmount: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-green-300 dark:border-green-700 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">UTR Number</label>
                  <input
                    type="text"
                    value={editingSubmission.utr}
                    onChange={(e) => setEditingSubmission({ ...editingSubmission, utr: e.target.value })}
                    className="w-full px-3 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-200 mb-2">Notes</label>
                <textarea
                  value={editingSubmission.notes}
                  onChange={(e) => setEditingSubmission({ ...editingSubmission, notes: e.target.value })}
                  className="w-full px-3 py-2 border-2 border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 resize-none"
                  rows="3"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setEditingSubmission(null)}
                  className="flex-1 px-4 py-2 border-2 border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700"
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

      {/* Screenshot Viewer Modal */}
      {viewingScreenshot && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4"
          onClick={() => setViewingScreenshot(null)}
        >
          <div 
            className="relative max-w-full max-h-full bg-white rounded-lg shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setViewingScreenshot(null)}
              className="absolute top-2 right-2 z-10 w-10 h-10 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110"
              aria-label="Close"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            {/* Screenshot image */}
            <div className="overflow-auto max-h-[90vh]">
              <img
                src={viewingScreenshot}
                alt="Payment Screenshot - Full View"
                className="max-w-full max-h-[90vh] w-auto h-auto object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VerifyPayments;
