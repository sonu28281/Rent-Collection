import { useEffect, useRef, useState } from 'react';
import { collection, query, where, getDocs, limit, doc, getDoc, setDoc } from 'firebase/firestore';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import SubmitPayment from './SubmitPayment';
import googlePayLogo from '../assets/payment-icons/google-pay.svg';
import phonePeLogo from '../assets/payment-icons/phonepe.svg';
import Tesseract from 'tesseract.js';

/**
 * Tenant Portal - Username/Password Login
 * Version: 2.1.0 (Feb 25, 2026 - Fixed payment display & due date logic)
 * 
 * Login:
 * - Username = Room Number (e.g., "101")
 * - Password = Set during setup (default: "password")
 * 
 * Changes:
 * - Fixed payment record display (showing all records, not just 12)
 * - Fixed due date logic (shows green when current month paid)
 * - Added detailed console logging for debugging
 */
const TenantPortal = () => {
  const REMEMBER_ME_KEY = 'tenant_portal_saved_login_v1';
  const TENANT_PORTAL_LANG_KEY = 'tenant_portal_language_v1';
  const KYC_PENDING_KEY = 'digilocker_kyc_pending_v1';
  const DEFAULT_KYC_FUNCTION_BASE_URL = `${window.location.origin}/.netlify/functions`;

  // Login state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
    const DEFAULT_ELECTRICITY_RATE = 9; // Default electricity rate
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);

  // Tenant data state
  const [tenant, setTenant] = useState(null);
  const [room, setRoom] = useState(null);
  const [roomsData, setRoomsData] = useState([]);
  const [paymentRecords, setPaymentRecords] = useState([]);
  const [meterHistoryRecords, setMeterHistoryRecords] = useState([]);
  const [activeUPI, setActiveUPI] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pendingSubmissions, setPendingSubmissions] = useState([]);
  const [latestSubmission, setLatestSubmission] = useState(null);
  const [tenantDirectPayEnabled, setTenantDirectPayEnabled] = useState(false);
  const [globalElectricityRate, setGlobalElectricityRate] = useState(DEFAULT_ELECTRICITY_RATE);
  
  // UI state for collapsible cards
  const [expandedCard, setExpandedCard] = useState(null);
  
  // Payment form state
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [previousMeterReadings, setPreviousMeterReadings] = useState({});
  const [currentMeterReadings, setCurrentMeterReadings] = useState({});
  const [selectedMeterRoomTab, setSelectedMeterRoomTab] = useState('all');
  const [paymentProcessing] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  
  // Submit payment modal state
  const [showSubmitPayment, setShowSubmitPayment] = useState(false);
  const [portalLanguage, setPortalLanguage] = useState(() => localStorage.getItem(TENANT_PORTAL_LANG_KEY) || 'en');
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [startingDigiLockerKyc, setStartingDigiLockerKyc] = useState(false);
  const [digiLockerError, setDigiLockerError] = useState('');
  const [kycCallbackStatus, setKycCallbackStatus] = useState('idle');
  const [kycCallbackMessage, setKycCallbackMessage] = useState('');
  const [hiddenRejectedSubmissionIds, setHiddenRejectedSubmissionIds] = useState(new Set());
  const [tenantProfile, setTenantProfile] = useState({
    firstName: '',
    lastName: '',
    phoneNumber: '',
    occupation: '',
    aadharNumber: '',
    panNumber: '',
    aadharImage: '',
    panImage: '',
    selfieImage: '',
    aadharDocStatus: 'not_uploaded',
    panDocStatus: 'not_uploaded',
    aadharDocReason: '',
    panDocReason: '',
    aadharNameMatched: false,
    panNameMatched: false,
    aadharExtractedNumber: '',
    panExtractedNumber: '',
    aadharDocConfidence: 0,
    panDocConfidence: 0,
    agreementAccepted: false,
    agreementSignature: '',
    agreementSignedAt: null
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [ocrAnalyzing, setOcrAnalyzing] = useState(false);
  const signatureCanvasRef = useRef(null);
  const [isSigning, setIsSigning] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const t = (en, hi) => (portalLanguage === 'hi' ? hi : en);

  const togglePortalLanguage = () => {
    setPortalLanguage((prev) => (prev === 'en' ? 'hi' : 'en'));
  };

  const getTenantNotifiedKey = (tenantId) => `tenant_notified_events_${tenantId || 'guest'}_v1`;
  const getTenantHiddenRejectedKey = (tenantId) => `tenant_hidden_rejected_${tenantId || 'guest'}_v1`;

  const getNotifiedEventIds = (tenantId) => {
    try {
      const raw = localStorage.getItem(getTenantNotifiedKey(tenantId));
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  };

  const saveNotifiedEventIds = (tenantId, idSet) => {
    localStorage.setItem(getTenantNotifiedKey(tenantId), JSON.stringify(Array.from(idSet)));
  };

  const getHiddenRejectedIds = (tenantId) => {
    try {
      const raw = localStorage.getItem(getTenantHiddenRejectedKey(tenantId));
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  };

  const saveHiddenRejectedIds = (tenantId, idSet) => {
    localStorage.setItem(getTenantHiddenRejectedKey(tenantId), JSON.stringify(Array.from(idSet)));
  };

  const requestNotificationPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  const splitName = (fullName = '') => {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { firstName: '', lastName: '' };
    if (parts.length === 1) return { firstName: parts[0], lastName: '' };
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(' ')
    };
  };

  const toDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const normalizeDocText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normalizeAadhar = (value) => String(value || '').replace(/\D/g, '').slice(0, 12);
  const normalizePan = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  const getExpectedNameTokens = () => {
    const fromProfile = `${tenantProfile.firstName || ''} ${tenantProfile.lastName || ''}`.trim();
    const sourceName = fromProfile || String(tenant?.name || '').trim();
    return sourceName
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
  };

  const extractAadharNumberFromText = (text) => {
    const dense = String(text || '').replace(/\s+/g, ' ');
    const grouped = dense.match(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/);
    if (grouped?.[0]) return normalizeAadhar(grouped[0]);

    const plain = dense.match(/\b\d{12}\b/);
    if (plain?.[0]) return normalizeAadhar(plain[0]);
    return '';
  };

  const extractPanFromText = (text) => {
    const match = String(text || '').toUpperCase().match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/);
    return match?.[0] ? normalizePan(match[0]) : '';
  };

  const applyDocVerificationToProfile = (profile, docType, verificationResult) => {
    const next = { ...profile };
    if (docType === 'aadhar') {
      next.aadharDocStatus = verificationResult.status;
      next.aadharDocReason = verificationResult.reason;
      next.aadharNameMatched = !!verificationResult.nameMatched;
      next.aadharExtractedNumber = verificationResult.extractedNumber || '';
      next.aadharDocConfidence = verificationResult.confidence || 0;
      if (verificationResult.extractedNumber) {
        next.aadharNumber = verificationResult.extractedNumber;
      }
    }

    if (docType === 'pan') {
      next.panDocStatus = verificationResult.status;
      next.panDocReason = verificationResult.reason;
      next.panNameMatched = !!verificationResult.nameMatched;
      next.panExtractedNumber = verificationResult.extractedNumber || '';
      next.panDocConfidence = verificationResult.confidence || 0;
      if (verificationResult.extractedNumber) {
        next.panNumber = verificationResult.extractedNumber;
      }
    }

    return next;
  };

  const verifyKycDocument = async (docType, imageDataUrl, options = { updateState: true }) => {
    if (!imageDataUrl) {
      return {
        status: 'not_uploaded',
        reason: 'Document image not uploaded.',
        extractedNumber: '',
        nameMatched: false,
        confidence: 0
      };
    }

    if (options.updateState) {
      setTenantProfile((prev) => {
        if (docType === 'aadhar') return { ...prev, aadharDocStatus: 'checking', aadharDocReason: 'Checking OCR...' };
        return { ...prev, panDocStatus: 'checking', panDocReason: 'Checking OCR...' };
      });
    }

    try {
      const ocrResult = await Tesseract.recognize(imageDataUrl, 'eng');
      const rawText = String(ocrResult?.data?.text || '');
      const confidence = Number(ocrResult?.data?.confidence || 0);
      const normalizedText = normalizeDocText(rawText);
      const expectedTokens = getExpectedNameTokens();
      const nameMatched = expectedTokens.length === 0 || expectedTokens.every((token) => normalizedText.includes(token));

      const extractedNumber = docType === 'aadhar'
        ? extractAadharNumberFromText(rawText)
        : extractPanFromText(rawText);

      let status = 'verified';
      let reason = 'Document verified successfully.';

      if (!extractedNumber) {
        status = 'number_not_found';
        reason = `${docType === 'aadhar' ? 'Aadhaar' : 'PAN'} number not detected in document.`;
      } else if (!nameMatched) {
        status = 'name_mismatch';
        reason = 'Uploaded document name does not match tenant profile name.';
      }

      const result = { status, reason, extractedNumber, nameMatched, confidence };

      if (options.updateState) {
        setTenantProfile((prev) => applyDocVerificationToProfile(prev, docType, result));
      }

      return result;
    } catch (error) {
      console.error(`OCR verification failed for ${docType}:`, error);
      const result = {
        status: 'error',
        reason: 'OCR failed. Please upload a clear image.',
        extractedNumber: '',
        nameMatched: false,
        confidence: 0
      };

      if (options.updateState) {
        setTenantProfile((prev) => applyDocVerificationToProfile(prev, docType, result));
      }

      return result;
    }
  };

  const getCanvasPoint = (event) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();

    if (event.touches && event.touches[0]) {
      return {
        x: event.touches[0].clientX - rect.left,
        y: event.touches[0].clientY - rect.top
      };
    }

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const startSignature = (event) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const point = getCanvasPoint(event);
    if (!point) return;

    const context = canvas.getContext('2d');
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 2;
    context.strokeStyle = '#111827';
    context.beginPath();
    context.moveTo(point.x, point.y);
    setIsSigning(true);
  };

  const moveSignature = (event) => {
    if (!isSigning) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;

    const point = getCanvasPoint(event);
    if (!point) return;

    const context = canvas.getContext('2d');
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const stopSignature = () => {
    if (!isSigning) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    setIsSigning(false);

    const dataUrl = canvas.toDataURL('image/png');
    setTenantProfile((prev) => ({
      ...prev,
      agreementSignature: dataUrl,
      agreementSignedAt: new Date().toISOString()
    }));
  };

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    setTenantProfile((prev) => ({
      ...prev,
      agreementSignature: '',
      agreementSignedAt: null
    }));
  };

  const getProfileCompletion = () => {
    const aadharVerified = tenantProfile.aadharDocStatus === 'verified' && !!tenantProfile.aadharExtractedNumber && !!tenantProfile.aadharImage;
    const panVerified = tenantProfile.panDocStatus === 'verified' && !!tenantProfile.panExtractedNumber && !!tenantProfile.panImage;
    const checklist = [
      !!tenantProfile.firstName,
      !!tenantProfile.lastName,
      !!tenantProfile.phoneNumber,
      !!tenantProfile.occupation,
      aadharVerified,
      panVerified,
      !!tenantProfile.selfieImage,
      !!tenantProfile.agreementAccepted,
      !!tenantProfile.agreementSignature
    ];

    const filled = checklist.filter(Boolean).length;
    const total = checklist.length;
    const percentage = Math.round((filled / total) * 100);
    return { filled, total, percentage };
  };

  const handleProfileChange = (field, value) => {
    setTenantProfile((prev) => ({
      ...prev,
      [field]: value,
      ...(field === 'firstName' || field === 'lastName'
        ? {
            aadharDocStatus: prev.aadharImage ? 'recheck_needed' : prev.aadharDocStatus,
            panDocStatus: prev.panImage ? 'recheck_needed' : prev.panDocStatus,
            aadharDocReason: prev.aadharImage ? 'Name changed. Please re-upload/recheck Aadhaar.' : prev.aadharDocReason,
            panDocReason: prev.panImage ? 'Name changed. Please re-upload/recheck PAN.' : prev.panDocReason
          }
        : {})
    }));
  };

  const handleProfileFileChange = async (field, file) => {
    if (!file) return;
    try {
      const dataUrl = await toDataUrl(file);
      const nextProfile = {
        ...tenantProfile,
        [field]: dataUrl
      };

      setTenantProfile((prev) => ({
        ...prev,
        [field]: dataUrl,
        ...(field === 'aadharImage'
          ? {
              aadharDocStatus: 'checking',
              aadharDocReason: 'Checking OCR...',
              aadharExtractedNumber: '',
              aadharNameMatched: false,
              aadharDocConfidence: 0
            }
          : {}),
        ...(field === 'panImage'
          ? {
              panDocStatus: 'checking',
              panDocReason: 'Checking OCR...',
              panExtractedNumber: '',
              panNameMatched: false,
              panDocConfidence: 0
            }
          : {})
      }));

      if (field === 'aadharImage') {
        await verifyKycDocument('aadhar', nextProfile.aadharImage, { updateState: true });
      }
      if (field === 'panImage') {
        await verifyKycDocument('pan', nextProfile.panImage, { updateState: true });
      }
    } catch (fileError) {
      console.error('Profile file read error:', fileError);
      alert('Failed to read file. Please try again.');
    }
  };

  const loadTenantProfile = async (tenantData) => {
    if (!tenantData?.id) return;
    setProfileLoading(true);
    try {
      const profileRef = doc(db, 'tenantProfiles', tenantData.id);
      const profileSnap = await getDoc(profileRef);
      const profileData = profileSnap.exists() ? profileSnap.data() : {};

      const split = splitName(tenantData?.name || '');
      setTenantProfile({
        firstName: profileData.firstName || split.firstName || '',
        lastName: profileData.lastName || split.lastName || '',
        phoneNumber: profileData.phoneNumber || tenantData.phone || '',
        occupation: profileData.occupation || '',
        aadharNumber: profileData.aadharNumber || '',
        panNumber: profileData.panNumber || '',
        aadharImage: profileData.aadharImage || '',
        panImage: profileData.panImage || '',
        selfieImage: profileData.selfieImage || '',
        aadharDocStatus: profileData.aadharDocStatus || (profileData.aadharImage ? 'recheck_needed' : 'not_uploaded'),
        panDocStatus: profileData.panDocStatus || (profileData.panImage ? 'recheck_needed' : 'not_uploaded'),
        aadharDocReason: profileData.aadharDocReason || '',
        panDocReason: profileData.panDocReason || '',
        aadharNameMatched: !!profileData.aadharNameMatched,
        panNameMatched: !!profileData.panNameMatched,
        aadharExtractedNumber: profileData.aadharExtractedNumber || profileData.aadharNumber || '',
        panExtractedNumber: profileData.panExtractedNumber || profileData.panNumber || '',
        aadharDocConfidence: Number(profileData.aadharDocConfidence || 0),
        panDocConfidence: Number(profileData.panDocConfidence || 0),
        agreementAccepted: !!profileData.agreementAccepted,
        agreementSignature: profileData.agreementSignature || '',
        agreementSignedAt: profileData.agreementSignedAt || null
      });
    } catch (profileError) {
      console.error('Error loading tenant profile:', profileError);
    } finally {
      setProfileLoading(false);
    }
  };

  const saveTenantProfile = async () => {
    if (!tenant?.id) return;
    setProfileSaving(true);
    try {
      let profileForSave = { ...tenantProfile };

      if (profileForSave.aadharImage && profileForSave.aadharDocStatus !== 'verified') {
        const aadharResult = await verifyKycDocument('aadhar', profileForSave.aadharImage, { updateState: false });
        profileForSave = applyDocVerificationToProfile(profileForSave, 'aadhar', aadharResult);
      }

      if (profileForSave.panImage && profileForSave.panDocStatus !== 'verified') {
        const panResult = await verifyKycDocument('pan', profileForSave.panImage, { updateState: false });
        profileForSave = applyDocVerificationToProfile(profileForSave, 'pan', panResult);
      }

      setTenantProfile(profileForSave);

      const profilePayload = {
        ...profileForSave,
        tenantId: tenant.id,
        roomNumber: tenant.roomNumber || null,
        fullName: `${profileForSave.firstName} ${profileForSave.lastName}`.trim(),
        aadharNumber: profileForSave.aadharExtractedNumber || profileForSave.aadharNumber || '',
        panNumber: profileForSave.panExtractedNumber || profileForSave.panNumber || '',
        updatedAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'tenantProfiles', tenant.id), profilePayload, { merge: true });
      alert('✅ Profile saved successfully.');
    } catch (saveError) {
      console.error('Error saving tenant profile:', saveError);
      alert('Failed to save profile. Please try again.');
    } finally {
      setProfileSaving(false);
    }
  };

  const runKycOcrAnalysis = async () => {
    if (!tenantProfile.aadharImage && !tenantProfile.panImage) {
      alert('Please upload Aadhaar or PAN image first.');
      return;
    }

    setOcrAnalyzing(true);
    try {
      let profileForAnalysis = { ...tenantProfile };

      if (profileForAnalysis.aadharImage) {
        const aadharResult = await verifyKycDocument('aadhar', profileForAnalysis.aadharImage, { updateState: false });
        profileForAnalysis = applyDocVerificationToProfile(profileForAnalysis, 'aadhar', aadharResult);
      }

      if (profileForAnalysis.panImage) {
        const panResult = await verifyKycDocument('pan', profileForAnalysis.panImage, { updateState: false });
        profileForAnalysis = applyDocVerificationToProfile(profileForAnalysis, 'pan', panResult);
      }

      setTenantProfile(profileForAnalysis);

      if (tenant?.id) {
        await setDoc(doc(db, 'tenantProfiles', tenant.id), {
          aadharDocStatus: profileForAnalysis.aadharDocStatus,
          panDocStatus: profileForAnalysis.panDocStatus,
          aadharDocReason: profileForAnalysis.aadharDocReason,
          panDocReason: profileForAnalysis.panDocReason,
          aadharNameMatched: profileForAnalysis.aadharNameMatched,
          panNameMatched: profileForAnalysis.panNameMatched,
          aadharExtractedNumber: profileForAnalysis.aadharExtractedNumber,
          panExtractedNumber: profileForAnalysis.panExtractedNumber,
          aadharNumber: profileForAnalysis.aadharExtractedNumber || profileForAnalysis.aadharNumber || '',
          panNumber: profileForAnalysis.panExtractedNumber || profileForAnalysis.panNumber || '',
          aadharDocConfidence: profileForAnalysis.aadharDocConfidence || 0,
          panDocConfidence: profileForAnalysis.panDocConfidence || 0,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      }

      alert('OCR analysis completed. Verification statuses updated.');
    } catch (analysisError) {
      console.error('Error running KYC OCR analysis:', analysisError);
      alert('OCR analysis failed. Please try again.');
    } finally {
      setOcrAnalyzing(false);
    }
  };

  const notifyTenant = (eventId, title, body) => {
    if (!tenant?.id) return;
    const notified = getNotifiedEventIds(tenant.id);
    if (notified.has(eventId)) return;

    notified.add(eventId);
    saveNotifiedEventIds(tenant.id, notified);

    showToast(body, 'info');

    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;

    const notification = new Notification(title, {
      body,
      tag: eventId
    });

    notification.onclick = () => {
      window.focus();
      window.location.href = '/tenant-portal';
      notification.close();
    };
  };

  useEffect(() => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink && manifestLink.getAttribute('href') !== '/manifest-tenant.webmanifest') {
      manifestLink.setAttribute('href', '/manifest-tenant.webmanifest');
    }

    const appleTitleMeta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitleMeta) {
      appleTitleMeta.setAttribute('content', 'Tenant Portal');
    }

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    setIsAppInstalled(isStandalone);

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
    };

    const onAppInstalled = () => {
      setIsAppInstalled(true);
      setInstallPromptEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(TENANT_PORTAL_LANG_KEY, portalLanguage);
  }, [portalLanguage]);

  useEffect(() => {
    if (!isLoggedIn || typeof Notification === 'undefined') return;

    if (Notification.permission === 'default') {
      Notification.requestPermission().then((permission) => {
        setNotificationPermission(permission);
      }).catch(() => {
        setNotificationPermission('denied');
      });
    } else {
      setNotificationPermission(Notification.permission);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn || !tenant?.id || loading) return;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const dueInfo = getNextDueDate();

    if (dueInfo.status === 'overdue') {
      notifyTenant(
        `due_overdue_${tenant.id}_${currentYear}_${currentMonth}`,
        '⚠️ Rent Due Alert',
        `Aapka rent due date cross ho gaya hai. कृपया payment submit करें.`
      );
    }

    const isRejectedVisible = latestSubmission?.status === 'rejected' && !hiddenRejectedSubmissionIds.has(latestSubmission.id);

    if (isRejectedVisible) {
      notifyTenant(
        `payment_rejected_${latestSubmission.id}`,
        '❌ Payment Rejected',
        'Aapki last payment reject ho gayi hai. कृपया सही screenshot + UTR ke saath dubara submit karein.'
      );
    }

    if (latestSubmission?.status === 'verified') {
      notifyTenant(
        `payment_verified_${latestSubmission.id}`,
        '✅ Payment Verified',
        'Aapki payment verify ho gayi hai aur aapke account me add kar di gayi hai. Thank you!'
      );
    }
  }, [isLoggedIn, tenant?.id, loading, latestSubmission, pendingSubmissions, hiddenRejectedSubmissionIds]);

  useEffect(() => {
    if (!tenant?.id) {
      setHiddenRejectedSubmissionIds(new Set());
      return;
    }
    setHiddenRejectedSubmissionIds(getHiddenRejectedIds(tenant.id));
  }, [tenant?.id]);

  const handleHideRejectedNotice = (submissionId) => {
    if (!tenant?.id || !submissionId) return;
    const updated = new Set(hiddenRejectedSubmissionIds);
    updated.add(submissionId);
    setHiddenRejectedSubmissionIds(updated);
    saveHiddenRejectedIds(tenant.id, updated);
  };

  useEffect(() => {
    const roomTabs = (roomsData || []).map((entry) => String(entry.roomNumber));
    if (roomTabs.length <= 1) {
      setSelectedMeterRoomTab('all');
      return;
    }

    if (!roomTabs.includes(selectedMeterRoomTab)) {
      setSelectedMeterRoomTab(roomTabs[0]);
    }
  }, [roomsData, selectedMeterRoomTab]);

  const showToast = (message, type = 'info') => {
    setToast({ message, type });

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 3600);
  };

  const saveRememberedLogin = (savedUsername, savedPassword) => {
    localStorage.setItem(REMEMBER_ME_KEY, JSON.stringify({
      username: savedUsername,
      password: savedPassword,
      rememberMe: true
    }));
  };

  const clearRememberedLogin = () => {
    localStorage.removeItem(REMEMBER_ME_KEY);
  };

  const getKycInitiateUrl = () => {
    const direct = import.meta.env.VITE_KYC_INITIATE_URL;
    if (direct) return String(direct);

    const base = import.meta.env.VITE_KYC_FUNCTION_BASE_URL;
    if (base) return `${String(base).replace(/\/$/, '')}/initiateKyc`;

    return `${DEFAULT_KYC_FUNCTION_BASE_URL}/initiateKyc`;
  };

  const getKycCallbackHandlerUrl = () => {
    const direct = import.meta.env.VITE_KYC_CALLBACK_HANDLER_URL;
    if (direct) return String(direct);

    const base = import.meta.env.VITE_KYC_FUNCTION_BASE_URL;
    if (base) return `${String(base).replace(/\/$/, '')}/handleKycCallback`;

    return `${DEFAULT_KYC_FUNCTION_BASE_URL}/handleKycCallback`;
  };

  const startDigiLockerVerification = async () => {
    console.log('🔵 Button clicked! Starting DigiLocker verification...');
    console.log('🔵 Tenant object:', tenant);
    console.log('🔵 Tenant ID:', tenant?.id);
    
    if (!tenant?.id) {
      console.error('❌ KYC: No tenant ID');
      setDigiLockerError('Please login first to verify KYC');
      return;
    }

    const initiateUrl = getKycInitiateUrl();
    console.log('🔍 KYC Initiate URL:', initiateUrl);
    
    if (!initiateUrl) {
      setDigiLockerError('KYC initiate URL missing. Set VITE_KYC_INITIATE_URL or VITE_KYC_FUNCTION_BASE_URL.');
      return;
    }

    setStartingDigiLockerKyc(true);
    setDigiLockerError('');
    try {
      // Add cache-busting timestamp to prevent cached 500 errors
      const cacheBustedUrl = `${initiateUrl}${initiateUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
      console.log('📡 Fetching:', cacheBustedUrl);
      
      const response = await fetch(cacheBustedUrl, { 
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      
      console.log('📥 Response status:', response.status, response.statusText);
      console.log('📥 Response headers:', Object.fromEntries(response.headers.entries()));
      
      const rawText = await response.text();
      console.log('📥 Response body (raw):', rawText.substring(0, 500));
      
      let payload = {};
      try {
        payload = JSON.parse(rawText);
        console.log('✅ Parsed JSON:', payload);
      } catch (parseError) {
        console.error('❌ JSON parse failed:', parseError);
        console.error('❌ Raw response was:', rawText);
        throw new Error('Server returned invalid JSON');
      }
      
      const payloadData = payload?.data || {};
      const authorizationUrl = payload?.authorizationUrl || payloadData?.authorizationUrl;
      const state = payload?.state || payloadData?.state;
      const codeVerifier = payload?.codeVerifier || payloadData?.codeVerifier;
      const stateCreatedAt = payloadData?.stateCreatedAt || Date.now();

      console.log('🔍 Extracted values:', { 
        ok: response.ok, 
        authorizationUrl: authorizationUrl?.substring(0, 100), 
        state,
        stateCreatedAt,
        hasCodeVerifier: !!codeVerifier
      });

      if (!response.ok || !authorizationUrl || !state) {
        const errorMsg = payload?.message || payload?.error || 'Unable to initiate DigiLocker verification';
        console.error('❌ Validation failed:', errorMsg);
        throw new Error(errorMsg);
      }

      console.log('✅ Saving to localStorage and opening popup...');
      localStorage.setItem(KYC_PENDING_KEY, JSON.stringify({
        tenantId: tenant.id,
        state: String(state),
        codeVerifier: codeVerifier ? String(codeVerifier) : undefined,
        stateCreatedAt: Number(stateCreatedAt)
      }));
      
      console.log('🚀 Opening DigiLocker popup window...');
      
      // Open DigiLocker in popup window (better UX - user stays on site)
      const popupWidth = 600;
      const popupHeight = 700;
      const left = (window.screen.width - popupWidth) / 2;
      const top = (window.screen.height - popupHeight) / 2;
      const popupFeatures = `width=${popupWidth},height=${popupHeight},left=${left},top=${top},toolbar=no,menubar=no,location=no,status=no,resizable=yes,scrollbars=yes`;
      
      const popup = window.open(authorizationUrl, 'DigiLockerKYC', popupFeatures);
      
      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }

      // Monitor popup closure and check KYC status
      const checkPopupClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkPopupClosed);
          console.log('✅ DigiLocker popup closed, checking verification status...');
          setStartingDigiLockerKyc(false);
          
          // Refresh tenant data to check if KYC was completed
          setTimeout(() => {
            if (tenant?.id) {
              fetchTenantData(tenant);
            }
          }, 1000);
        }
      }, 500);

      // Also set timeout to clear interval after 10 minutes
      setTimeout(() => {
        clearInterval(checkPopupClosed);
        if (!popup.closed) {
          popup.close();
        }
        setStartingDigiLockerKyc(false);
      }, 600000); // 10 minutes

    } catch (error) {
      console.error('❌ DigiLocker initiate failed:', error);
      console.error('❌ Error stack:', error.stack);
      setDigiLockerError(error?.message || 'Unable to start DigiLocker verification. Please try again.');
    } finally {
      setStartingDigiLockerKyc(false);
    }
  };

  useEffect(() => {
    const processKycCallback = async () => {
      if (location.pathname !== '/kyc/callback') return;

      setKycCallbackStatus('processing');
      setKycCallbackMessage('Processing DigiLocker verification...');

      const params = new URLSearchParams(location.search || '');
      const code = params.get('code');
      const state = params.get('state');
      const oauthError = params.get('error') || params.get('error_description');

      if (oauthError) {
        setKycCallbackStatus('error');
        setKycCallbackMessage(`DigiLocker returned error: ${oauthError}`);
        setTimeout(() => navigate('/tenant-portal', { replace: true }), 1500);
        return;
      }

      if (!code || !state) {
        setKycCallbackStatus('error');
        setKycCallbackMessage('Missing code/state in callback URL.');
        setTimeout(() => navigate('/tenant-portal', { replace: true }), 1500);
        return;
      }

      let pending = null;
      try {
        const raw = localStorage.getItem(KYC_PENDING_KEY);
        pending = raw ? JSON.parse(raw) : null;
      } catch {
        pending = null;
      }

      if (!pending?.tenantId || !pending?.state) {
        setKycCallbackStatus('error');
        setKycCallbackMessage('KYC session missing. Please start verification again.');
        setTimeout(() => navigate('/tenant-portal', { replace: true }), 1500);
        return;
      }

      const callbackUrl = getKycCallbackHandlerUrl();
      if (!callbackUrl) {
        setKycCallbackStatus('error');
        setKycCallbackMessage('KYC callback URL missing. Set VITE_KYC_CALLBACK_HANDLER_URL or VITE_KYC_FUNCTION_BASE_URL.');
        return;
      }

      try {
        const requestBody = {
          tenantId: pending.tenantId,
          code,
          state,
          expectedState: pending.state,
          stateCreatedAt: pending.stateCreatedAt
        };
        
        // Add codeVerifier for PKCE if present
        if (pending.codeVerifier) {
          requestBody.codeVerifier = pending.codeVerifier;
        }
        
        const response = await fetch(callbackUrl, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
          },
          body: JSON.stringify(requestBody)
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.message || payload?.error || 'KYC verification failed');
        }

        localStorage.removeItem(KYC_PENDING_KEY);
        const payloadKyc = payload?.data?.kyc || null;
        setTenant((prev) => {
          if (!prev || prev.id !== pending.tenantId) return prev;
          return {
            ...prev,
            kyc: {
              ...(prev.kyc || {}),
              ...(payloadKyc || {})
            }
          };
        });
        setKycCallbackStatus('success');
        
        // Check if we're in a popup window
        if (window.opener && !window.opener.closed) {
          // We're in a popup - close it and let parent window refresh
          setKycCallbackMessage('DigiLocker verification completed successfully. Closing...');
          setTimeout(() => {
            window.close();
          }, 800);
        } else {
          // Full page redirect scenario (fallback)
          setKycCallbackMessage('DigiLocker verification completed successfully. Redirecting...');
          setTimeout(() => navigate('/tenant-portal', { replace: true }), 1200);
        }
      } catch (error) {
        console.error('KYC callback processing failed:', error);
        setKycCallbackStatus('error');
        setKycCallbackMessage(error?.message || 'Unable to complete KYC callback. Please retry.');
        
        // If in popup and error occurs, still close after showing error
        if (window.opener && !window.opener.closed) {
          setTimeout(() => {
            window.close();
          }, 3000);
        }
      }
    };

    processKycCallback();
  }, [location.pathname, location.search, navigate]);

  const getAssignedRoomNumbers = (tenantData) => {
    if (Array.isArray(tenantData?.assignedRooms) && tenantData.assignedRooms.length > 0) {
      return tenantData.assignedRooms.map((roomNumber) => String(roomNumber));
    }
    if (tenantData?.roomNumber !== undefined && tenantData?.roomNumber !== null && tenantData?.roomNumber !== '') {
      return [String(tenantData.roomNumber)];
    }
    return [];
  };

  const performLogin = async (inputUsername, inputPassword, options = {}) => {
    const trimmedUsername = inputUsername.trim();
    const { silent = false } = options;

    setLoggingIn(true);
    if (!silent) {
      setLoginError('');
    }

    try {
      const tenantsRef = collection(db, 'tenants');
      const loginQuery = query(
        tenantsRef,
        where('username', '==', trimmedUsername),
        where('password', '==', inputPassword),
        where('isActive', '==', true)
      );

      const snapshot = await getDocs(loginQuery);

      if (snapshot.empty) {
        if (!silent) {
          setLoginError('Invalid username or password. Please check and try again.');
        }
        return false;
      }

      const tenantData = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
      setTenant(tenantData);
      setIsLoggedIn(true);

      if (rememberMe) {
        saveRememberedLogin(trimmedUsername, inputPassword);
      } else {
        clearRememberedLogin();
      }

      await fetchTenantData(tenantData);
      return true;
    } catch (error) {
      console.error('Login error:', error);
      if (!silent) {
        setLoginError('Login failed. Please try again.');
      }
      return false;
    } finally {
      setLoggingIn(false);
    }
  };

  useEffect(() => {
    try {
      const savedRaw = localStorage.getItem(REMEMBER_ME_KEY);
      if (!savedRaw) {
        return;
      }

      const saved = JSON.parse(savedRaw);
      if (!saved?.rememberMe || !saved?.username || !saved?.password) {
        clearRememberedLogin();
        return;
      }

      setRememberMe(true);
      setUsername(saved.username);
      setPassword(saved.password);
      performLogin(saved.username, saved.password, { silent: true });
    } catch (error) {
      console.error('Remember me load error:', error);
      clearRememberedLogin();
    }
  }, []);

  const handleInstallApp = async () => {
    if (!installPromptEvent) {
      return;
    }

    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
  };

  // Handle login
  const handleLogin = async (e) => {
    e.preventDefault();
    await performLogin(username, password);
  };

  // Fetch tenant data after login
  const fetchTenantData = async (tenantData) => {
    setLoading(true);

    try {
      console.log('👤 Fetching data for tenant:', {
        name: tenantData.name,
        roomNumber: tenantData.roomNumber,
        assignedRooms: getAssignedRoomNumbers(tenantData)
      });

      const assignedRooms = getAssignedRoomNumbers(tenantData);
      
      console.log('🔢 Assigned room numbers:', assignedRooms);

      // Fetch global electricity rate from settings
      const settingsRef = collection(db, 'settings');
      const settingsSnapshot = await getDocs(settingsRef);
      if (!settingsSnapshot.empty) {
        const globalSettingsDoc = settingsSnapshot.docs.find((docItem) => docItem.id === 'global');
        const settingsData = (globalSettingsDoc || settingsSnapshot.docs[0]).data();
        const configuredRate = Number(settingsData?.electricityRate);
        const directPayFlag = settingsData?.tenantDirectPayEnabled;
        const fallbackFromMode = String(settingsData?.paymentMode || '').toLowerCase() === 'automatic';
        setGlobalElectricityRate(Number.isFinite(configuredRate) && configuredRate > 0 ? configuredRate : DEFAULT_ELECTRICITY_RATE);
        setTenantDirectPayEnabled(typeof directPayFlag === 'boolean' ? directPayFlag : fallbackFromMode);
      } else {
        setGlobalElectricityRate(DEFAULT_ELECTRICITY_RATE);
        setTenantDirectPayEnabled(false);
      }
      
      // Fetch all assigned room details (number/string tolerant)
      const roomsRef = collection(db, 'rooms');
      const fetchedRooms = [];

      for (const assignedRoom of assignedRooms) {
        const roomAsNumber = Number.parseInt(assignedRoom, 10);
        const roomQueries = [query(roomsRef, where('roomNumber', '==', assignedRoom))];

        if (Number.isFinite(roomAsNumber)) {
          roomQueries.unshift(query(roomsRef, where('roomNumber', '==', roomAsNumber)));
        }

        let foundRoom = null;
        for (const roomQuery of roomQueries) {
          const roomSnapshot = await getDocs(roomQuery);
          if (!roomSnapshot.empty) {
            foundRoom = { id: roomSnapshot.docs[0].id, ...roomSnapshot.docs[0].data() };
            break;
          }
        }

        if (foundRoom) {
          fetchedRooms.push(foundRoom);
        }
      }

      fetchedRooms.sort((a, b) => Number(a.roomNumber) - Number(b.roomNumber));
      setRoomsData(fetchedRooms);
      setRoom(fetchedRooms[0] || null);

      // Fetch payment records - Try multiple approaches
      const paymentsRef = collection(db, 'payments');
      
      console.log('🔍 Fetching payments for tenant:', {
        tenantId: tenantData.id,
        tenantName: tenantData.name,
        assignedRooms
      });

      const roomSnapshots = await Promise.all(
        assignedRooms.flatMap((assignedRoom) => {
          const roomAsNumber = Number.parseInt(assignedRoom, 10);
          const queryList = [getDocs(query(paymentsRef, where('roomNumber', '==', assignedRoom)))];
          if (Number.isFinite(roomAsNumber)) {
            queryList.push(getDocs(query(paymentsRef, where('roomNumber', '==', roomAsNumber))));
          }
          return queryList;
        })
      );

      // Merge both results, avoid duplicates by tracking IDs
      const paymentDocs = new Map();
      roomSnapshots.forEach((snapshot) => {
        snapshot.forEach((doc) => paymentDocs.set(doc.id, doc));
      });
      
      console.log('📊 Total unique payments:', paymentDocs.size);
      
      // Collect records - be more lenient with tenant matching
      const records = [];
      const allRoomPayments = [];
      
      paymentDocs.forEach((doc) => {
        const data = { id: doc.id, ...doc.data() };
        allRoomPayments.push(data);
        
        // Match by tenant - check multiple criteria
        // Accept payment if ANY of these match:
        // 1. tenantId matches (if present)
        // 2. tenantName matches
        // 3. tenantNameSnapshot matches
        const matchesTenant = 
          (data.tenantId && data.tenantId === tenantData.id) ||
          (!data.tenantId && (data.tenantName === tenantData.name || data.tenantNameSnapshot === tenantData.name));
        
        if (matchesTenant) {
          records.push(data);
          console.log('✅ Payment matched for tenant:', {
            month: data.month,
            year: data.year,
            status: data.status,
            paidAmount: data.paidAmount,
            hasTenantId: !!data.tenantId,
            matchedBy: data.tenantId ? 'tenantId' : 'name'
          });
        } else {
          console.log('⏭️  Payment skipped (tenant mismatch):', {
            month: data.month,
            year: data.year,
            paymentTenantId: data.tenantId,
            paymentTenantName: data.tenantName || data.tenantNameSnapshot,
            currentTenantId: tenantData.id,
            currentTenantName: tenantData.name
          });
        }
      });
      
      console.log('📊 Total payments for this room:', allRoomPayments.length);
      console.log('📊 Payments matched to current tenant:', records.length);
      
      // If still no records found for current tenant, try by tenantId directly
      if (records.length === 0) {
        console.log('⚠️ No payments found by room+tenant match, trying direct tenantId query...');
        const tenantIdQuery = query(
          paymentsRef,
          where('tenantId', '==', tenantData.id)
        );
        const tenantIdSnapshot = await getDocs(tenantIdQuery);
        console.log('📊 Payments found by tenantId query:', tenantIdSnapshot.size);
        
        tenantIdSnapshot.forEach((doc) => {
          const data = { id: doc.id, ...doc.data() };
          records.push(data);
          console.log('✅ Payment added:', {
            month: data.month,
            year: data.year,
            status: data.status,
            paidAmount: data.paidAmount
          });
        });
      }
      
      // If STILL no records, show what we have for debugging
      if (records.length === 0 && allRoomPayments.length > 0) {
        console.log('⚠️ No tenant match! Room has payments but none matched tenant.');
        console.log('💡 Room payments tenantIds:', allRoomPayments.map(p => ({
          id: p.id,
          tenantId: p.tenantId,
          tenantName: p.tenantNameSnapshot || p.tenantName,
          month: p.month,
          year: p.year
        })));
        console.log('💡 Looking for tenantId:', tenantData.id);
        console.log('💡 Looking for tenantName:', tenantData.name);
      }
      
      console.log('📋 Records for current tenant:', records.length);
      console.log('🔍 Tenant name match filter:', tenantData.name);
      
      // Log some raw data before sorting
      const sample2026 = records.filter(r => r.year === 2026);
      console.log('🔍 2026 records for this tenant:', sample2026.length);
      if (sample2026.length > 0) {
        console.log('Sample 2026 records:', sample2026.map(r => ({ 
          month: r.month, 
          year: r.year, 
          status: r.status,
          tenantName: r.tenantNameSnapshot || r.tenantName 
        })));
      }
      
      // Sort by year and month (descending)
      records.sort((a, b) => {
        const yearDiff = b.year - a.year;
        if (yearDiff !== 0) return yearDiff;
        return b.month - a.month;
      });
      
      console.log('🔝 Top 5 payments after sort:', records.slice(0, 5).map(r => `${r.month}/${r.year} (${r.status})`));
      
      // Show all records, not just 12
      setPaymentRecords(records);

      // Fetch dedicated meter history entries for this tenant
      const readingsRef = collection(db, 'electricityReadings');
      const readingsByTenantIdQuery = query(readingsRef, where('tenantId', '==', tenantData.id));
      const readingsSnapshot = await getDocs(readingsByTenantIdQuery);

      const meterHistory = [];
      readingsSnapshot.forEach((doc) => {
        meterHistory.push({ id: doc.id, ...doc.data(), source: 'meter_reading' });
      });

      setMeterHistoryRecords(meterHistory);

      // Fetch all submissions for tenant and derive latest + current month pending
      const submissionsRef = collection(db, 'paymentSubmissions');
      const submissionsQuery = query(submissionsRef, where('tenantId', '==', tenantData.id));
      const submissionsSnapshot = await getDocs(submissionsQuery);
      const submissions = [];
      submissionsSnapshot.forEach((doc) => {
        submissions.push({ id: doc.id, ...doc.data() });
      });

      const sortedSubmissions = submissions.sort((a, b) => {
        const aTime = a?.submittedAt ? new Date(a.submittedAt).getTime() : 0;
        const bTime = b?.submittedAt ? new Date(b.submittedAt).getTime() : 0;
        return bTime - aTime;
      });

      setLatestSubmission(sortedSubmissions[0] || null);

      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;

      setPendingSubmissions(
        sortedSubmissions.filter(
          (submission) =>
            submission.status === 'pending' &&
            Number(submission.year) === currentYear &&
            Number(submission.month) === currentMonth
        )
      );

      // Fetch active UPI
      const upiRef = collection(db, 'bankAccounts');
      const upiQuery = query(upiRef, where('isActive', '==', true), limit(1));
      const upiSnapshot = await getDocs(upiQuery);
      
      if (!upiSnapshot.empty) {
        setActiveUPI({ id: upiSnapshot.docs[0].id, ...upiSnapshot.docs[0].data() });
      }

      await loadTenantProfile(tenantData);
    } catch (error) {
      console.error('Error loading tenant data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Handle logout
  const handleLogout = () => {
    setIsLoggedIn(false);
    setTenant(null);
    setRoom(null);
    setRoomsData([]);
    setPaymentRecords([]);
    setMeterHistoryRecords([]);
    setPendingSubmissions([]);
    setLatestSubmission(null);
    setActiveUPI(null);
    setUsername('');
    setPassword('');
    setPreviousMeterReadings({});
    setCurrentMeterReadings({});
    setTenantProfile({
      firstName: '',
      lastName: '',
      phoneNumber: '',
      occupation: '',
      aadharNumber: '',
      panNumber: '',
      aadharImage: '',
      panImage: '',
      selfieImage: '',
      aadharDocStatus: 'not_uploaded',
      panDocStatus: 'not_uploaded',
      aadharDocReason: '',
      panDocReason: '',
      aadharNameMatched: false,
      panNameMatched: false,
      aadharExtractedNumber: '',
      panExtractedNumber: '',
      aadharDocConfidence: 0,
      panDocConfidence: 0,
      agreementAccepted: false,
      agreementSignature: '',
      agreementSignedAt: null
    });
  };

  // Calculate next due date and payment status
  const getNextDueDate = () => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-12
    const currentDay = today.getDate();
    const dueDay = tenant?.dueDate || 20;
    
    // If payment records not loaded yet, show loading state
    if (!paymentRecords || paymentRecords.length === 0) {
      console.log('⚠️ No payment records loaded yet');
      return {
        dueDateStr: 'Loading...',
        status: 'due',
        dueDay: dueDay,
        statusText: 'Loading payment status...',
        overdueDays: 0
      };
    }
    
    // Check if current month payment exists and is paid
    // Handle both number and string types for year/month
    const currentMonthPayment = paymentRecords.find(
      p => {
        const pYear = typeof p.year === 'string' ? parseInt(p.year) : p.year;
        const pMonth = typeof p.month === 'string' ? parseInt(p.month) : p.month;
        return pYear === currentYear && pMonth === currentMonth;
      }
    );
    
    // Enhanced Debug logging
    console.log('🔍 Due Date Check:', {
      currentYear,
      currentMonth,
      currentDay,
      dueDay,
      paymentRecordsCount: paymentRecords.length,
      currentMonthPayment: currentMonthPayment ? {
        id: currentMonthPayment.id,
        year: currentMonthPayment.year,
        yearType: typeof currentMonthPayment.year,
        month: currentMonthPayment.month,
        monthType: typeof currentMonthPayment.month,
        status: currentMonthPayment.status,
        paidAmount: currentMonthPayment.paidAmount,
        tenantId: currentMonthPayment.tenantId,
        roomNumber: currentMonthPayment.roomNumber
      } : 'NOT FOUND'
    });
    
    // Log all payment records for debugging
    if (paymentRecords.length > 0) {
      console.log('📋 All Payment Records:', paymentRecords.map(p => ({
        month: p.month,
        year: p.year,
        status: p.status,
        paidAmount: p.paidAmount
      })));
    }
    
    let nextDueMonth, nextDueYear;
    let status = 'pending';
    let statusText = 'Payment Pending';
    let overdueDays = 0;
    
    // Check if current month is already paid (check both status AND paidAmount)
    // For paidAmount: Accept if rent field exists when paidAmount is missing
    const isPaid = currentMonthPayment && 
                   currentMonthPayment.status === 'paid' && 
                   ((currentMonthPayment.paidAmount || 0) > 0 || (currentMonthPayment.rent || 0) > 0);

    const hasPendingSubmission = pendingSubmissions.length > 0;
    
    console.log('💰 Payment Status Check:', {
      hasPayment: !!currentMonthPayment,
      status: currentMonthPayment?.status,
      paidAmount: currentMonthPayment?.paidAmount,
      rent: currentMonthPayment?.rent,
      hasPendingSubmission,
      isPaid: isPaid
    });
    
    if (isPaid) {
      // ✅ Current month paid - Show NEXT month's due date
      if (currentMonth === 12) {
        nextDueMonth = 1;
        nextDueYear = currentYear + 1;
      } else {
        nextDueMonth = currentMonth + 1;
        nextDueYear = currentYear;
      }
      status = 'paid';
      statusText = 'Current Month Paid ✅';
      console.log('✅ Status: PAID - Next due:', `${nextDueMonth}/${nextDueYear}`);
    } else if (hasPendingSubmission) {
      nextDueMonth = currentMonth;
      nextDueYear = currentYear;
      status = 'pending';
      statusText = 'Payment Verification Pending ⏳';
      console.log('⏳ Status: PENDING VERIFICATION');
    } else if (currentDay <= dueDay) {
      // Payment due this month, still within due date
      nextDueMonth = currentMonth;
      nextDueYear = currentYear;
      status = 'due';
      statusText = 'Payment Due This Month';
      console.log('📅 Status: DUE - Within due date');
    } else {
      // After due date and not paid - OVERDUE
      nextDueMonth = currentMonth;
      nextDueYear = currentYear;
      status = 'overdue';
      statusText = 'Payment Overdue!';

      const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
      const safeDueDay = Math.min(dueDay, daysInMonth);
      const dueDate = new Date(currentYear, currentMonth - 1, safeDueDay);
      const todayStart = new Date(currentYear, currentMonth - 1, currentDay);
      const diffMs = todayStart.getTime() - dueDate.getTime();
      overdueDays = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

      console.log('⚠️ Status: OVERDUE - Past due date');
    }
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dueDateStr = `${dueDay} ${monthNames[nextDueMonth - 1]} ${nextDueYear}`;
    
    return { dueDateStr, status, dueDay, statusText, overdueDays };
  };

  // Toggle card expansion
  const toggleCard = (cardId) => {
    setExpandedCard(expandedCard === cardId ? null : cardId);
  };

  // Calculate electricity amount
  const calculateElectricity = (oldReading, currentReading) => {
    const units = Math.max(0, currentReading - oldReading);
    const ratePerUnit = globalElectricityRate; // Use global electricity rate
    const electricityAmount = units * ratePerUnit;
    return { units, electricityAmount };
  };

  // Copy UPI ID to clipboard
  const copyUPIId = () => {
    if (activeUPI?.upiId) {
      navigator.clipboard.writeText(activeUPI.upiId).then(() => {
        alert('✅ UPI ID copied to clipboard!');
      }).catch(() => {
        alert('❌ Failed to copy. Please copy manually.');
      });
    }
  };

  const getPayableAmount = () => {
    const effectiveRooms = roomsData.length > 0
      ? roomsData
      : (room ? [room] : []);

    if (effectiveRooms.length === 0) {
      return null;
    }

    const perRoom = [];
    let rentAmount = 0;
    let totalUnits = 0;
    let electricityAmount = 0;

    for (const roomEntry of effectiveRooms) {
      const roomKey = String(roomEntry.roomNumber);
      const oldReading = Number(previousMeterReadings[roomKey]);
      const currentReading = Number(currentMeterReadings[roomKey]);

      if (!Number.isFinite(oldReading) || oldReading < 0) {
        return null;
      }

      if (!Number.isFinite(currentReading) || currentReading < oldReading) {
        return null;
      }

      const roomRent = Number(roomEntry?.rent ?? 0);
      const { units, electricityAmount: roomElectricity } = calculateElectricity(oldReading, currentReading);

      rentAmount += roomRent;
      totalUnits += units;
      electricityAmount += roomElectricity;

      perRoom.push({
        roomNumber: roomEntry.roomNumber,
        oldReading,
        currentReading,
        units,
        rentAmount: roomRent,
        electricityAmount: roomElectricity,
        totalAmount: roomRent + roomElectricity
      });
    }

    if (!rentAmount && tenant?.currentRent) {
      rentAmount = Number(tenant.currentRent) || 0;
    }

    const totalAmount = rentAmount + electricityAmount;

    return {
      perRoom,
      units: totalUnits,
      rentAmount,
      electricityAmount,
      totalAmount
    };
  };

  const getCurrentMonthPayableFromRecords = () => {
    if (!paymentRecords || paymentRecords.length === 0) return null;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    const currentMonthRecords = paymentRecords.filter((record) => {
      const recordYear = Number(record.year);
      const recordMonth = Number(record.month);
      return recordYear === currentYear && recordMonth === currentMonth;
    });

    if (currentMonthRecords.length === 0) return null;

    const totals = currentMonthRecords.reduce((sum, record) => {
      const rent = Number(record.rent) || 0;
      const electricity = Number(record.electricity) || 0;
      const totalAmount = Number(record.total || record.totalAmount) || (rent + electricity);
      const paidAmount = Number(record.paidAmount) || 0;

      return {
        rent: sum.rent + rent,
        electricity: sum.electricity + electricity,
        total: sum.total + totalAmount,
        paid: sum.paid + paidAmount
      };
    }, { rent: 0, electricity: 0, total: 0, paid: 0 });

    return {
      ...totals,
      due: Math.max(totals.total - totals.paid, 0)
    };
  };

  const getBrowserContext = () => {
    const userAgent = navigator.userAgent || '';
    const isAndroid = /Android/i.test(userAgent);
    const isIOS = /iPhone|iPad|iPod/i.test(userAgent);

    const likelyInAppBrowser = /Instagram|FBAN|FBAV|FB_IAB|Messenger|Line|Twitter|wv\)|WebView|WhatsApp/i.test(userAgent)
      && !/Chrome|CriOS|EdgA|SamsungBrowser|Firefox|OPR/i.test(userAgent);

    return { userAgent, isAndroid, isIOS, likelyInAppBrowser };
  };

  const openInChrome = () => {
    const { isAndroid } = getBrowserContext();

    if (!isAndroid) {
      showToast('Please open this page in Chrome browser, then tap PhonePe / Google Pay.', 'warning');
      return;
    }

    try {
      const currentUrl = new URL(window.location.href);
      const scheme = currentUrl.protocol.replace(':', '');
      const pathWithQuery = `${currentUrl.host}${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
      const chromeIntent = `intent://${pathWithQuery}#Intent;scheme=${scheme};package=com.android.chrome;end`;
      window.location.assign(chromeIntent);
    } catch {
      showToast('Please open this page in Chrome manually, then retry payment.', 'warning');
    }
  };

  const openSpecificUPIApp = (appType) => {
    const payable = getPayableAmount();

    if (!payable) {
      alert('⚠️ Enter valid Previous and Current meter readings for all assigned rooms first');
      return;
    }

    const sanitizedUpiId = String(activeUPI?.upiId || '').trim().toLowerCase();
    const isValidUpiId = /^[a-z0-9._-]{2,}@[a-z]{2,}$/i.test(sanitizedUpiId);

    if (!sanitizedUpiId || !isValidUpiId) {
      alert('❌ UPI ID not available');
      return;
    }

    const { rentAmount, electricityAmount, totalAmount } = payable;

    const roomLabel = payable.perRoom.map((entry) => entry.roomNumber).join(', ');
    const upiParams = new URLSearchParams({
      pa: sanitizedUpiId,
      pn: String(activeUPI.nickname || 'Property Owner').trim(),
      am: Number(totalAmount).toFixed(2),
      cu: 'INR',
      tn: `Rooms ${roomLabel} Rent Electricity`
    });
    const params = upiParams.toString();
    const genericUpiLink = `upi://pay?${params}`;

    const { isAndroid, likelyInAppBrowser } = getBrowserContext();

    if (likelyInAppBrowser) {
      showToast('Open this page in Chrome first. In-app browsers may block PhonePe/Google Pay.', 'warning');
    }

    const packageMap = {
      gpay: 'com.google.android.apps.nbu.paisa.user',
      phonepe: 'com.phonepe.app'
    };

    const targetPackage = packageMap[appType];
    const appIntentLink = targetPackage
      ? `intent://upi/pay?${params}#Intent;scheme=upi;package=${targetPackage};end`
      : null;

    const primaryLink = isAndroid && appIntentLink ? appIntentLink : genericUpiLink;

    window.location.assign(primaryLink);

    setTimeout(() => {
      if (document.visibilityState !== 'hidden') {
        window.location.assign(genericUpiLink);
      }
    }, isAndroid && appIntentLink ? 1400 : 900);

    setTimeout(() => {
      showToast(
        `Launching payment app. Total ₹${totalAmount.toFixed(2)} (Rent ₹${rentAmount}, Electricity ₹${electricityAmount.toFixed(2)}). If not opened, use Other UPI App or Open in Chrome.`,
        'success'
      );
    }, 450);
  };
  
  // Open UPI payment link
  const openUPIPayment = () => {
    openSpecificUPIApp('generic');
  };

  const getYearMonthLabel = (year, month) => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const safeMonth = Number(month);
    const monthLabel = monthNames[safeMonth - 1] || `M${safeMonth}`;
    return `${monthLabel} ${year}`;
  };

  const getMonthIndex = (year, month) => (Number(year) * 12) + Number(month);

  const extractMeterSnapshot = (record) => {
    const oldReading = Number(record.oldReading ?? record.previousReading);
    const currentReading = Number(record.currentReading ?? record.meterReading);
    const electricityAmount = Number(record.electricity ?? record.electricityAmount ?? 0);
    const unitsFromRecord = Number(record.units ?? record.unitsConsumed);

    const hasReadings = Number.isFinite(oldReading) && Number.isFinite(currentReading) && currentReading >= oldReading;
    const units = Number.isFinite(unitsFromRecord)
      ? Math.max(0, unitsFromRecord)
      : (hasReadings ? Math.max(0, currentReading - oldReading) : 0);

    const hasElectricityBill = electricityAmount > 0 || units > 0;

    return {
      oldReading: hasReadings ? oldReading : null,
      currentReading: hasReadings ? currentReading : null,
      electricityAmount: Number.isFinite(electricityAmount) ? electricityAmount : 0,
      units,
      hasElectricityBill,
      isProperBill: hasReadings && hasElectricityBill && record.status === 'paid'
    };
  };

  const getElectricityBillingHealth = () => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;
    const currentMonthIndex = getMonthIndex(currentYear, currentMonth);

    const properRecords = paymentRecords
      .filter((record) => {
        const snapshot = extractMeterSnapshot(record);
        return snapshot.isProperBill;
      })
      .sort((a, b) => getMonthIndex(Number(b.year), Number(b.month)) - getMonthIndex(Number(a.year), Number(a.month)));

    const lastProperRecord = properRecords[0] || null;

    if (!lastProperRecord) {
      const checkInDate = tenant?.checkInDate ? new Date(tenant.checkInDate) : null;
      const hasValidCheckIn = checkInDate && !Number.isNaN(checkInDate.getTime());
      const checkInMonthIndex = hasValidCheckIn
        ? getMonthIndex(checkInDate.getFullYear(), checkInDate.getMonth() + 1)
        : null;

      const fallbackMonths = hasValidCheckIn
        ? Math.max(1, currentMonthIndex - checkInMonthIndex + 1)
        : Math.max(1, paymentRecords.length || 1);

      return {
        status: 'overdue',
        monthsPending: fallbackMonths,
        lastRecord: null,
        snapshot: null,
        message: 'No previous proper electricity bill record found. Please submit electricity bill with meter reading.'
      };
    }

    const lastYear = Number(lastProperRecord.year);
    const lastMonth = Number(lastProperRecord.month);
    const lastMonthIndex = getMonthIndex(lastYear, lastMonth);
    const monthsPending = Math.max(0, currentMonthIndex - lastMonthIndex);

    if (monthsPending === 0) {
      const currentSnapshot = extractMeterSnapshot(lastProperRecord);
      return {
        status: 'healthy',
        monthsPending: 0,
        lastRecord: lastProperRecord,
        snapshot: currentSnapshot,
        message: 'Great! You are paying rent + electricity on time every month.'
      };
    }

    return {
      status: 'overdue',
      monthsPending,
      lastRecord: lastProperRecord,
      snapshot: extractMeterSnapshot(lastProperRecord),
      message: `Electricity bill pending for ${monthsPending} month${monthsPending > 1 ? 's' : ''}.`
    };
  };

  const getLastMonthClosingReading = (roomNumber = null) => {
    const roomMatch = roomNumber !== null
      ? paymentRecords
          .filter((record) => String(record.roomNumber) === String(roomNumber))
          .sort((a, b) => getMonthIndex(Number(b.year), Number(b.month)) - getMonthIndex(Number(a.year), Number(a.month)))[0]
      : null;

    const roomEntry = roomNumber !== null
      ? roomsData.find((entry) => String(entry.roomNumber) === String(roomNumber))
      : room;

    const candidateReadings = [
      roomMatch ? Number(roomMatch.currentReading ?? roomMatch.meterReading ?? roomMatch.oldReading ?? roomMatch.previousReading) : null,
      getElectricityBillingHealth().snapshot?.currentReading,
      roomEntry?.currentReading,
      roomEntry?.previousReading,
      0
    ];

    const reading = candidateReadings
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value) && value >= 0);

    return Number.isFinite(reading) ? reading : 0;
  };

  // Get month name
  const getMonthName = (monthNum) => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[monthNum - 1] || monthNum;
  };

  const getMeterHistoryTimeline = () => {
    const fromPayments = paymentRecords
      .map((record) => {
        const previousReading = Number(record.oldReading ?? record.previousReading);
        const currentReading = Number(record.currentReading ?? record.meterReading);
        const unitsConsumed = Number(record.units ?? record.unitsConsumed ?? 0);
        const electricityAmount = Number(record.electricity ?? record.electricityAmount ?? 0);

        const hasReadings = Number.isFinite(previousReading) && Number.isFinite(currentReading) && currentReading >= previousReading;
        if (!hasReadings) return null;

        return {
          id: `payment_${record.id}`,
          source: 'payment_history',
          date: record.paidDate || record.paymentDate || record.paidAt || record.createdAt || null,
          monthLabel: record.year && record.month ? `${getMonthName(Number(record.month))} ${record.year}` : 'Unknown',
          roomNumber: String(record.roomNumber ?? room?.roomNumber ?? tenant?.roomNumber ?? ''),
          previousReading,
          currentReading,
          unitsConsumed: Number.isFinite(unitsConsumed) ? unitsConsumed : Math.max(0, currentReading - previousReading),
          electricityAmount: Number.isFinite(electricityAmount) ? electricityAmount : 0
        };
      })
      .filter(Boolean);

    const fromMeterReadings = meterHistoryRecords
      .map((reading) => {
        const previousReading = Number(reading.previousReading);
        const currentReading = Number(reading.currentReading);
        const unitsConsumed = Number(reading.unitsConsumed ?? 0);
        const totalCharge = Number(reading.totalCharge ?? 0);

        const hasReadings = Number.isFinite(previousReading) && Number.isFinite(currentReading) && currentReading >= previousReading;
        if (!hasReadings) return null;

        const readingDate = reading.readingDate || reading.createdAt || null;
        const dateObj = readingDate ? new Date(readingDate) : null;

        return {
          id: `reading_${reading.id}`,
          source: 'meter_reading',
          date: readingDate,
          monthLabel: dateObj && !Number.isNaN(dateObj.getTime())
            ? dateObj.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
            : 'Unknown',
          roomNumber: String(reading.roomNumber ?? room?.roomNumber ?? tenant?.roomNumber ?? ''),
          previousReading,
          currentReading,
          unitsConsumed: Number.isFinite(unitsConsumed) ? unitsConsumed : Math.max(0, currentReading - previousReading),
          electricityAmount: Number.isFinite(totalCharge) ? totalCharge : 0
        };
      })
      .filter(Boolean);

    const merged = [...fromMeterReadings, ...fromPayments]
      .sort((a, b) => {
        const aTime = a.date ? new Date(a.date).getTime() : 0;
        const bTime = b.date ? new Date(b.date).getTime() : 0;
        return bTime - aTime;
      });

    const seen = new Set();
    const deduped = [];

    merged.forEach((item) => {
      const key = `${item.monthLabel}_${item.previousReading}_${item.currentReading}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    });

    return deduped;
  };

  const getMonthlyPaymentGroups = () => {
    const grouped = paymentRecords.reduce((accumulator, record) => {
      const year = Number(record.year || 0);
      const month = Number(record.month || 0);
      const key = `${year}-${month}`;

      if (!accumulator[key]) {
        accumulator[key] = {
          key,
          year,
          month,
          records: [],
          totalRent: 0,
          totalElectricity: 0,
          totalAmount: 0,
          paidAmount: 0,
          status: 'paid',
          paidAt: null,
          notes: ''
        };
      }

      const rent = Number(record.rent || 0);
      const electricity = Number(record.electricity ?? record.electricityAmount ?? 0);
      const paidAmount = Number(record.paidAmount || 0);
      const total = rent + electricity;

      accumulator[key].records.push(record);
      accumulator[key].totalRent += rent;
      accumulator[key].totalElectricity += electricity;
      accumulator[key].totalAmount += total;
      accumulator[key].paidAmount += paidAmount;

      if (record.paidAt && (!accumulator[key].paidAt || new Date(record.paidAt) > new Date(accumulator[key].paidAt))) {
        accumulator[key].paidAt = record.paidAt;
      }

      if (!accumulator[key].notes && record.notes) {
        accumulator[key].notes = record.notes;
      }

      if (record.status === 'overdue') {
        accumulator[key].status = 'overdue';
      } else if (record.status === 'pending' && accumulator[key].status !== 'overdue') {
        accumulator[key].status = 'pending';
      }

      return accumulator;
    }, {});

    return Object.values(grouped)
      .map((group) => ({
        ...group,
        records: [...group.records].sort((a, b) => Number(a.roomNumber) - Number(b.roomNumber))
      }))
      .sort((a, b) => {
        const yearDiff = Number(b.year) - Number(a.year);
        if (yearDiff !== 0) return yearDiff;
        return Number(b.month) - Number(a.month);
      });
  };

  const getPaidAmountSummary = () => {
    return paymentRecords.reduce((acc, record) => {
      if (record.status !== 'paid') {
        return acc;
      }

      acc.rentPaid += Number(record.rent || 0);
      acc.electricityPaid += Number(record.electricity ?? record.electricityAmount ?? 0);
      return acc;
    }, { rentPaid: 0, electricityPaid: 0 });
  };

  if (location.pathname === '/kyc/callback') {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <div className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full text-center border border-gray-200">
          <h2 className="text-xl font-bold text-gray-800 mb-2">DigiLocker KYC Callback</h2>
          <p className="text-sm text-gray-600 mb-4">
            {kycCallbackStatus === 'processing'
              ? 'Please wait while we verify your DigiLocker response.'
              : (kycCallbackStatus === 'success' ? 'Verification successful.' : 'Verification could not be completed.')}
          </p>

          {kycCallbackStatus === 'processing' && (
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mx-auto mb-4"></div>
          )}

          {kycCallbackMessage && (
            <p className={`text-sm ${kycCallbackStatus === 'error' ? 'text-red-700' : 'text-gray-700'}`}>
              {kycCallbackMessage}
            </p>
          )}

          {kycCallbackStatus === 'error' && (
            <button
              type="button"
              onClick={() => navigate('/tenant-portal', { replace: true })}
              className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg text-sm"
            >
              Back to Tenant Portal
            </button>
          )}
        </div>
      </div>
    );
  }

  // ============ LOGIN SCREEN ============
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-3 sm:p-4">
        <div className="max-w-md w-full">
          {/* Login Card */}
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-6 sm:p-8">
            {/* Logo/Header */}
            <div className="text-center mb-6 sm:mb-8">
                <div className="flex justify-end mb-2">
                  <button
                    type="button"
                    onClick={togglePortalLanguage}
                    className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700"
                  >
                    {portalLanguage === 'en' ? '🇮🇳 हिंदी' : '🇬🇧 English'}
                  </button>
                </div>
              <div className="text-4xl sm:text-5xl mb-2 sm:mb-3">🏠</div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-1 sm:mb-2">Tenant Portal</h1>
                <p className="text-sm sm:text-base text-gray-600">{t('Login to view your records', 'अपने रिकॉर्ड देखने के लिए लॉगिन करें')}</p>
            </div>

            {/* Login Form */}
            <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5">
              {installPromptEvent && !isAppInstalled && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                  <p className="text-xs sm:text-sm text-indigo-800 mb-2">📱 Install app on your phone for one-tap access every month.</p>
                  <button
                    type="button"
                    onClick={handleInstallApp}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 rounded-lg text-sm"
                  >
                    Add to Home Screen
                  </button>
                </div>
              )}

              {/* Username */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('Room Number', 'रूम नंबर')}
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your room number (e.g., 101)"
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-base border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                  autoFocus
                />
              </div>

              {/* Remember Me */}
              <label className="flex items-center gap-2 text-sm text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setRememberMe(checked);
                    if (!checked) {
                      clearRememberedLogin();
                    }
                  }}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {t('Remember me on this phone', 'इस फोन पर लॉगिन याद रखें')}
              </label>

              {/* Password */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  {t('Password', 'पासवर्ड')}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-3 sm:px-4 py-2.5 sm:py-3 text-base border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              {/* Error Message */}
              {loginError && (
                <div className="bg-red-50 border border-red-300 rounded-lg p-3">
                  <p className="text-sm text-red-700">{loginError}</p>
                </div>
              )}

              {/* Login Button */}
              <button
                type="submit"
                disabled={loggingIn}
                className="w-full bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-bold py-3 sm:py-3.5 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed text-base touch-manipulation"
              >
                {loggingIn ? t('⏳ Logging in...', '⏳ लॉगिन हो रहा है...') : t('🔐 Login', '🔐 लॉगिन')}
              </button>
            </form>

            {/* Help Text */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-xs text-gray-500 text-center">
                {t(
                  'Your room number is your username. Contact property manager if you forgot your password.',
                  'आपका रूम नंबर ही आपका यूज़रनेम है। पासवर्ड भूलने पर प्रॉपर्टी मैनेजर से संपर्क करें।'
                )}
              </p>
            </div>
          </div>

          {/* Additional Info */}
          <div className="mt-4 text-center">
            <p className="text-sm text-gray-600">
              {t('First time logging in? Default password is:', 'पहली बार लॉगिन कर रहे हैं? डिफ़ॉल्ट पासवर्ड है:')} <strong>password</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ============ MAIN DASHBOARD (After Login) ============
  return (
    <div className="min-h-screen bg-gray-100">
      {toast && (
        <div className="fixed top-3 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-md z-50">
          <div className={`rounded-lg shadow-lg border px-4 py-3 text-sm font-medium ${
            toast.type === 'warning'
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : toast.type === 'success'
                ? 'bg-green-50 border-green-300 text-green-900'
                : 'bg-blue-50 border-blue-300 text-blue-900'
          }`}>
            {toast.message}
          </div>
        </div>
      )}

      {/* Header - Mobile Optimized */}
      <div className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
              <span className="text-2xl sm:text-3xl flex-shrink-0">🏠</span>
              <div className="min-w-0 flex-1">
                <h1 className="text-base sm:text-xl font-bold text-gray-800 truncate">Tenant Portal</h1>
                <p className="text-xs sm:text-sm text-gray-600 truncate">Room {tenant?.roomNumber} - {tenant?.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {notificationPermission !== 'granted' && (
                <button
                  type="button"
                  onClick={requestNotificationPermission}
                  className="bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-semibold py-2 px-3 rounded-lg text-xs sm:text-sm whitespace-nowrap"
                >
                  🔔 Notify On
                </button>
              )}
              <button
                type="button"
                onClick={togglePortalLanguage}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2 px-3 rounded-lg text-xs sm:text-sm whitespace-nowrap"
              >
                {portalLanguage === 'en' ? 'हिंदी' : 'English'}
              </button>
              <button
                onClick={handleLogout}
                className="bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-semibold py-2 px-3 sm:px-4 rounded-lg transition-colors text-xs sm:text-sm whitespace-nowrap flex-shrink-0 touch-manipulation"
              >
                {t('🚪 Logout', '🚪 लॉगआउट')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Mobile Optimized */}
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading your data...</p>
          </div>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {(() => {
              const kycInfo = tenant?.kyc || {};
              const isVerified = kycInfo.verified === true && kycInfo.verifiedBy === 'DigiLocker';
              const verifiedDateValue = kycInfo.verifiedAt?.seconds
                ? new Date(kycInfo.verifiedAt.seconds * 1000)
                : (kycInfo.verifiedAt ? new Date(kycInfo.verifiedAt) : null);
              const verifiedDate = verifiedDateValue && !Number.isNaN(verifiedDateValue.getTime())
                ? verifiedDateValue.toLocaleDateString('en-IN')
                : null;

              console.log('🔍 KYC Render Check:', {
                hasTenant: !!tenant,
                tenantId: tenant?.id,
                kycInfo,
                isVerified,
                buttonWillShow: !isVerified
              });

              return (
                <div className={`rounded-lg shadow-md p-4 sm:p-5 border ${isVerified ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-lg sm:text-xl font-bold text-gray-800">🛡️ DigiLocker KYC</h3>
                      {isVerified ? (
                        <div className="mt-1">
                          <p className="text-sm font-semibold text-green-700">✅ Verified by DigiLocker</p>
                          <p className="text-xs text-green-700">
                            {verifiedDate ? `Verification Date: ${verifiedDate}` : 'Verification completed'}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-600 mt-1">Complete KYC to verify your identity securely.</p>
                      )}
                    </div>

                    {!isVerified && (
                      <button
                        type="button"
                        onClick={(e) => {
                          console.log('🔴 BUTTON CLICKED!', e);
                          startDigiLockerVerification();
                        }}
                        disabled={startingDigiLockerKyc}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg text-sm disabled:opacity-60"
                      >
                        {startingDigiLockerKyc ? 'Starting...' : 'Verify with DigiLocker'}
                      </button>
                    )}
                  </div>

                  {digiLockerError && (
                    <p className="text-xs text-red-700 mt-2">{digiLockerError}</p>
                  )}
                </div>
              );
            })()}

            {/* Due Date Alert - Mobile Optimized with Smart Logic */}
            {(() => {
              const dueInfo = getNextDueDate();
              const electricityHealth = getElectricityBillingHealth();
              const isElectricityPending = electricityHealth.status !== 'healthy';
              const statusColors = {
                paid: 'from-green-500 to-emerald-600',
                pending: 'from-amber-500 to-orange-600',
                due: 'from-blue-500 to-indigo-600',
                overdue: 'from-orange-500 to-red-600'
              };
              const statusIcons = {
                paid: '✅',
                pending: '⏳',
                due: '📅',
                overdue: '⚠️'
              };
              
              return (
                <div className={`bg-gradient-to-r ${statusColors[dueInfo.status]} text-white rounded-lg shadow-lg p-4 sm:p-6`}>
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="flex items-center gap-3 sm:gap-4 flex-1 w-full">
                      <div className="text-3xl sm:text-5xl">{statusIcons[dueInfo.status]}</div>
                      <div className="flex-1">
                        <h3 className="text-lg sm:text-xl font-bold mb-1">{dueInfo.statusText}</h3>
                        <p className="text-white/90 text-xs sm:text-sm">
                          {dueInfo.status === 'paid' ? 'Next payment due on' : 'Monthly rent payment'}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full sm:w-auto">
                      <div className="text-center bg-white/20 backdrop-blur-sm rounded-lg px-4 sm:px-6 py-3 sm:py-4">
                        <p className="text-white/80 text-xs sm:text-sm mb-1">
                          {dueInfo.status === 'paid' ? 'Next Due' : 'Due Date'}
                        </p>
                        <p className="text-xl sm:text-2xl font-bold">{dueInfo.dueDateStr}</p>
                        {dueInfo.status === 'overdue' && (
                          <>
                            <p className="text-white/95 text-xs mt-1 font-semibold">
                              Overdue by {dueInfo.overdueDays} day{dueInfo.overdueDays > 1 ? 's' : ''}
                            </p>
                            <p className="text-white/90 text-xs mt-1 font-semibold">Please pay soon!</p>
                          </>
                        )}
                        {dueInfo.status === 'paid' && (
                          <p className="text-white/90 text-xs mt-1 font-semibold">Thank you! 🎉</p>
                        )}
                      </div>

                      <div className={`text-center backdrop-blur-sm rounded-lg px-4 sm:px-6 py-3 sm:py-4 ${isElectricityPending ? 'bg-gradient-to-br from-red-600/75 to-rose-700/80 border-2 border-red-200/70 shadow-lg shadow-red-900/30' : 'bg-white/20'}`}>
                        <p className="text-white/80 text-xs sm:text-sm mb-1">Electricity</p>
                        <p className="text-base sm:text-lg font-bold">
                          {isElectricityPending ? 'Pending ⚠️' : 'On Track ✅'}
                        </p>
                        {isElectricityPending && typeof electricityHealth.monthsPending === 'number' ? (
                          <p className="text-white/90 text-xs mt-1 font-semibold">
                            {electricityHealth.monthsPending} month{electricityHealth.monthsPending > 1 ? 's' : ''} due
                          </p>
                        ) : (
                          <p className="text-white/90 text-xs mt-1 font-semibold">All clear</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3">
              <p className="text-sm font-bold text-red-800">
                ⚠️ ध्यान दें: आपने payment कर दी हो तब भी, जब तक आप &quot;Submit Payment for Verification&quot; नहीं करेंगे,
                आपकी payment सिस्टम में रिकॉर्ड नहीं होगी।
              </p>
            </div>

            {latestSubmission?.status === 'rejected' && !hiddenRejectedSubmissionIds.has(latestSubmission.id) && (
              <div className="bg-gradient-to-r from-red-50 to-rose-50 border-2 border-red-300 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-bold text-red-900">❌ आपकी पिछली payment reject (decline) हो गई है</p>
                  <button
                    type="button"
                    onClick={() => handleHideRejectedNotice(latestSubmission.id)}
                    className="text-xs font-semibold text-red-700 hover:text-red-900 underline"
                  >
                    Hide
                  </button>
                </div>
                <p className="text-xs text-red-800 mt-1">
                  Month: {getMonthName(Number(latestSubmission.month))} {latestSubmission.year}
                </p>
                {latestSubmission.rejectionReason && (
                  <p className="text-xs text-red-800 mt-1">Reason: {latestSubmission.rejectionReason}</p>
                )}
                <p className="text-xs text-red-700 mt-2">कृपया सही screenshot और UTR के साथ दोबारा submit करें।</p>
              </div>
            )}

            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              {(() => {
                const completion = getProfileCompletion();
                const radius = 46;
                const circumference = 2 * Math.PI * radius;
                const strokeOffset = circumference - (completion.percentage / 100) * circumference;

                return (
                  <>
                    <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                      <div>
                        <h2 className="text-xl sm:text-2xl font-bold text-gray-800">🪪 Tenant KYC Profile</h2>
                        <p className="text-sm text-gray-600 mt-1">Fill your details, upload documents, and sign rent agreement.</p>
                        <button
                          type="button"
                          onClick={runKycOcrAnalysis}
                          disabled={ocrAnalyzing || profileSaving || profileLoading}
                          className="mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-3 py-1.5 rounded-lg text-xs sm:text-sm disabled:opacity-60"
                        >
                          {ocrAnalyzing ? 'Analyzing OCR...' : '🔍 Run OCR Analysis'}
                        </button>
                      </div>
                      <div className="relative w-[110px] h-[110px] flex-shrink-0">
                        <svg width="110" height="110" viewBox="0 0 110 110" className="-rotate-90">
                          <circle cx="55" cy="55" r={radius} stroke="#E5E7EB" strokeWidth="10" fill="none" />
                          <circle
                            cx="55"
                            cy="55"
                            r={radius}
                            stroke="#2563EB"
                            strokeWidth="10"
                            fill="none"
                            strokeDasharray={circumference}
                            strokeDashoffset={strokeOffset}
                            strokeLinecap="round"
                            style={{ transition: 'stroke-dashoffset 0.4s ease' }}
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                          <p className="text-2xl font-bold text-gray-900">{completion.percentage}%</p>
                          <p className="text-xs text-gray-600">Profile Complete</p>
                          <p className="text-[11px] text-gray-500">{completion.filled}/{completion.total}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">First Name</label>
                        <input
                          type="text"
                          value={tenantProfile.firstName}
                          onChange={(e) => handleProfileChange('firstName', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          placeholder="Enter first name"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Last Name</label>
                        <input
                          type="text"
                          value={tenantProfile.lastName}
                          onChange={(e) => handleProfileChange('lastName', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          placeholder="Enter last name"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Phone Number</label>
                        <input
                          type="tel"
                          value={tenantProfile.phoneNumber}
                          onChange={(e) => handleProfileChange('phoneNumber', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          placeholder="Enter phone"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Occupation</label>
                        <input
                          type="text"
                          value={tenantProfile.occupation}
                          onChange={(e) => handleProfileChange('occupation', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          placeholder="Enter occupation"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Aadhar Number</label>
                        <input
                          type="text"
                          value={tenantProfile.aadharExtractedNumber || tenantProfile.aadharNumber}
                          readOnly
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50"
                          placeholder="Auto-extracted from Aadhaar"
                        />
                        <p className="text-[11px] text-gray-500 mt-1">Auto extracted from uploaded Aadhaar.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">PAN Number</label>
                        <input
                          type="text"
                          value={tenantProfile.panExtractedNumber || tenantProfile.panNumber}
                          readOnly
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm uppercase bg-gray-50"
                          placeholder="Auto-extracted from PAN"
                        />
                        <p className="text-[11px] text-gray-500 mt-1">Auto extracted from uploaded PAN.</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                      <div className="border border-gray-200 rounded-lg p-3">
                        <label className="block text-xs font-semibold text-gray-700 mb-2">Upload Aadhar</label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleProfileFileChange('aadharImage', e.target.files?.[0])}
                          className="w-full text-xs"
                        />
                        {tenantProfile.aadharImage && (
                          <img src={tenantProfile.aadharImage} alt="Aadhar" className="mt-2 h-20 w-full object-cover rounded border" />
                        )}
                        <div className="mt-2">
                          <p className={`text-[11px] font-semibold ${tenantProfile.aadharDocStatus === 'verified' ? 'text-green-700' : tenantProfile.aadharDocStatus === 'checking' ? 'text-blue-700' : 'text-red-700'}`}>
                            Aadhaar Check: {tenantProfile.aadharDocStatus === 'verified' ? 'Verified ✅' : tenantProfile.aadharDocStatus === 'checking' ? 'Checking...' : tenantProfile.aadharDocStatus === 'recheck_needed' ? 'Recheck Needed' : 'Not Verified'}
                          </p>
                          {tenantProfile.aadharDocReason && <p className="text-[11px] text-gray-600">{tenantProfile.aadharDocReason}</p>}
                        </div>
                      </div>

                      <div className="border border-gray-200 rounded-lg p-3">
                        <label className="block text-xs font-semibold text-gray-700 mb-2">Upload PAN</label>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleProfileFileChange('panImage', e.target.files?.[0])}
                          className="w-full text-xs"
                        />
                        {tenantProfile.panImage && (
                          <img src={tenantProfile.panImage} alt="PAN" className="mt-2 h-20 w-full object-cover rounded border" />
                        )}
                        <div className="mt-2">
                          <p className={`text-[11px] font-semibold ${tenantProfile.panDocStatus === 'verified' ? 'text-green-700' : tenantProfile.panDocStatus === 'checking' ? 'text-blue-700' : 'text-red-700'}`}>
                            PAN Check: {tenantProfile.panDocStatus === 'verified' ? 'Verified ✅' : tenantProfile.panDocStatus === 'checking' ? 'Checking...' : tenantProfile.panDocStatus === 'recheck_needed' ? 'Recheck Needed' : 'Not Verified'}
                          </p>
                          {tenantProfile.panDocReason && <p className="text-[11px] text-gray-600">{tenantProfile.panDocReason}</p>}
                        </div>
                      </div>

                      <div className="border border-gray-200 rounded-lg p-3">
                        <label className="block text-xs font-semibold text-gray-700 mb-2">Selfie (Current Photo)</label>
                        <input
                          type="file"
                          accept="image/*"
                          capture="user"
                          onChange={(e) => handleProfileFileChange('selfieImage', e.target.files?.[0])}
                          className="w-full text-xs"
                        />
                        {tenantProfile.selfieImage && (
                          <img src={tenantProfile.selfieImage} alt="Selfie" className="mt-2 h-20 w-full object-cover rounded border" />
                        )}
                      </div>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                      <p className="text-xs font-semibold text-amber-900 mb-2">📄 Rent Agreement (Digital Acceptance)</p>
                      <p className="text-xs text-amber-800 leading-relaxed mb-3">
                        I confirm that the information provided is correct, and I agree to pay rent/electricity on time as per lodge terms.
                      </p>
                      <label className="flex items-center gap-2 text-sm text-amber-900 font-semibold mb-3">
                        <input
                          type="checkbox"
                          checked={tenantProfile.agreementAccepted}
                          onChange={(e) => handleProfileChange('agreementAccepted', e.target.checked)}
                        />
                        I accept the rent agreement terms.
                      </label>

                      <div className="bg-white border border-amber-300 rounded-lg p-2">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-700">Digital Signature</p>
                          <button
                            type="button"
                            onClick={clearSignature}
                            className="text-xs font-semibold text-red-700 hover:underline"
                          >
                            Clear
                          </button>
                        </div>
                        <canvas
                          ref={signatureCanvasRef}
                          width={640}
                          height={180}
                          className="w-full h-28 border border-gray-300 rounded touch-none"
                          onMouseDown={startSignature}
                          onMouseMove={moveSignature}
                          onMouseUp={stopSignature}
                          onMouseLeave={stopSignature}
                          onTouchStart={(e) => { e.preventDefault(); startSignature(e); }}
                          onTouchMove={(e) => { e.preventDefault(); moveSignature(e); }}
                          onTouchEnd={(e) => { e.preventDefault(); stopSignature(); }}
                        />
                        {tenantProfile.agreementSignedAt && (
                          <p className="text-[11px] text-gray-500 mt-1">Signed on: {new Date(tenantProfile.agreementSignedAt).toLocaleString('en-IN')}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-gray-500">
                        Existing tenant data auto-prefilled where available. New tenants can fill fresh KYC details.
                      </p>
                      <button
                        type="button"
                        onClick={saveTenantProfile}
                        disabled={profileSaving || profileLoading}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg text-sm disabled:opacity-60"
                      >
                        {profileSaving ? 'Saving...' : profileLoading ? 'Loading...' : '💾 Save Profile'}
                      </button>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Quick Payment Action - NEW */}
            {!showPaymentForm && (() => {
              const dueInfo = getNextDueDate();
              const isCurrentMonthPaid = dueInfo.status === 'paid';
              const isVerificationPending = dueInfo.status === 'pending';
              const currentMonthPayable = getCurrentMonthPayableFromRecords();
              const canShowDirectPayButton = tenantDirectPayEnabled && !isCurrentMonthPaid && !isVerificationPending;
              const effectiveRooms = roomsData.length > 0
                ? roomsData
                : (room ? [room] : []);
              
              return (
                <>
                  {/* Current Month Payable Summary */}
                  {currentMonthPayable && (
                    <div className="w-full bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-300 rounded-lg p-4 mb-3">
                      <p className="text-xs text-green-800 font-semibold mb-1">इस महीने का भुगतान (Current Month)</p>
                      <p className="text-2xl font-bold text-green-900 mb-2">₹{currentMonthPayable.due.toLocaleString('en-IN')}</p>
                      <div className="grid grid-cols-2 gap-2 text-xs text-green-800">
                        <p>Rent: <span className="font-semibold">₹{currentMonthPayable.rent.toLocaleString('en-IN')}</span></p>
                        <p>Electricity: <span className="font-semibold">₹{currentMonthPayable.electricity.toLocaleString('en-IN')}</span></p>
                        <p>Total: <span className="font-semibold">₹{currentMonthPayable.total.toLocaleString('en-IN')}</span></p>
                        <p>Paid: <span className="font-semibold">₹{currentMonthPayable.paid.toLocaleString('en-IN')}</span></p>
                      </div>
                    </div>
                  )}

                  {canShowDirectPayButton && (
                    <button
                      onClick={() => {
                        if (!activeUPI) {
                          alert('⚠️ Payment setup not available. Please contact property manager.');
                          return;
                        }

                        const initialPrevious = {};
                        const initialCurrent = {};
                        effectiveRooms.forEach((roomEntry) => {
                          const roomKey = String(roomEntry.roomNumber);
                          const oldReading = getLastMonthClosingReading(roomEntry.roomNumber);
                          initialPrevious[roomKey] = String(oldReading);
                          initialCurrent[roomKey] = '';
                        });

                        setPreviousMeterReadings(initialPrevious);
                        setCurrentMeterReadings(initialCurrent);
                        setShowPaymentForm(true);
                      }}
                      className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-4 px-6 rounded-lg shadow-lg transition-all transform hover:scale-105 active:scale-95 touch-manipulation mb-3"
                    >
                      💳 Make Payment Now
                    </button>
                  )}
                  
                  {/* Pending Verification Message */}
                  {isVerificationPending && (
                    <div className="w-full bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-lg p-4 mb-3 text-center">
                      <div className="text-3xl mb-2">⏳</div>
                      <p className="text-amber-800 font-bold text-lg mb-1">Verification in Progress</p>
                      <p className="text-amber-700 text-sm">You already submitted payment details. Please wait for admin verification.</p>
                    </div>
                  )}
                  
                  {/* Submit Payment Proof Button - Always available */}
                  <button
                    onClick={() => setShowSubmitPayment(true)}
                    className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold py-4 px-6 rounded-lg shadow-lg transition-all transform hover:scale-105 active:scale-95 touch-manipulation"
                  >
                    📝 Submit Payment for Verification
                  </button>

                  <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-xs font-bold text-blue-900 mb-1">महत्वपूर्ण निर्देश (Payment के बाद):</p>
                    <ul className="text-xs text-blue-800 space-y-1">
                      <li>1) अपनी Google Pay / PhonePe / किसी भी payment app से payment करें।</li>
                      <li>2) Payment successful होने के बाद screenshot लें।</li>
                      <li>3) Tenant Portal में screenshot upload करें।</li>
                      <li>4) UTR / Transaction ID copy करके form में भरें और verification के लिए submit करें।</li>
                    </ul>
                    <p className="text-[11px] text-blue-700 mt-2">
                      UTR कहाँ मिलेगा: Payment app में transaction details / history खोलें। वहाँ UTR, UPI Ref No, या Transaction ID नाम से 12-22 digit/alphanumeric code दिखता है।
                    </p>
                  </div>
                </>
              );
            })()}

            {/* Payment Form with Meter Reading - NEW */}
            {showPaymentForm && (
              <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6 border-2 border-green-500">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-800">💳 Make Payment</h2>
                  <button
                    onClick={() => {
                      setShowPaymentForm(false);
                      setPreviousMeterReadings({});
                      setCurrentMeterReadings({});
                    }}
                    className="text-gray-500 hover:text-gray-700 font-bold text-xl"
                  >
                    ✕
                  </button>
                </div>

                {!activeUPI ? (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-red-700 font-semibold mb-2">❌ Payment Setup Not Available</p>
                    <p className="text-sm text-red-600">Please contact the property manager to set up UPI payment details.</p>
                  </div>
                ) : (
                  <>

                {/* Meter Reading Inputs */}
                <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    ⚡ Enter Meter Readings
                  </label>
                  <div className="space-y-3">
                    {(roomsData.length > 0 ? roomsData : (room ? [room] : [])).map((roomEntry) => {
                      const roomKey = String(roomEntry.roomNumber);
                      const oldReading = previousMeterReadings[roomKey] || '';
                      const currentReading = currentMeterReadings[roomKey] || '';

                      return (
                        <div key={roomKey} className="bg-white rounded-lg border border-yellow-200 p-3">
                          <p className="text-sm font-semibold text-gray-800 mb-2">Room {roomEntry.roomNumber}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input
                              type="number"
                              value={oldReading}
                              placeholder="Previous Reading"
                              className="px-4 py-3 text-lg font-mono border-2 border-gray-300 rounded-lg bg-gray-100 text-gray-700 cursor-not-allowed"
                              min="0"
                              readOnly
                            />
                            <input
                              type="number"
                              value={currentReading}
                              onChange={(event) => {
                                setCurrentMeterReadings((prev) => ({
                                  ...prev,
                                  [roomKey]: event.target.value
                                }));
                              }}
                              placeholder="Current Reading"
                              className="px-4 py-3 text-lg font-mono border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                              min={Number(oldReading) || 0}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    Previous reading is auto-filled room-wise from last month closing readings (tenant cannot edit) | Rate: ₹{globalElectricityRate}/unit
                  </p>
                </div>

                {/* Payment Amount Summary - Always show when meter reading entered */}
                {getPayableAmount() && (
                  <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <h3 className="font-semibold text-blue-900 mb-2">Payment Amount:</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Rent:</span>
                        <span className="font-bold">₹{getPayableAmount().rentAmount.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Electricity ({getPayableAmount().units} units):</span>
                        <span className="font-bold">₹{getPayableAmount().electricityAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between pt-2 border-t border-blue-300 text-lg">
                        <span className="font-bold">Total:</span>
                        <span className="font-bold text-green-600">
                          ₹{getPayableAmount().totalAmount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* QR Code */}
                {activeUPI.qrCode && (
                  <div className="text-center mb-4">
                    <p className="text-sm font-semibold text-gray-700 mb-3">Or Scan QR Code:</p>
                    <div className="bg-white p-3 sm:p-4 rounded-xl border-2 border-gray-300 inline-block">
                      <img 
                        src={activeUPI.qrCode} 
                        alt="UPI QR Code" 
                        className="w-48 h-48 sm:w-56 sm:h-56 rounded-lg"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Open any UPI app and scan this code</p>
                  </div>
                )}

                {/* Pay Buttons - Google Pay + PhonePe */}
                {getPayableAmount() && (
                  <div className="mb-4">
                    {(() => {
                      const browserContext = getBrowserContext();
                      const shouldDisableGenericUpi = browserContext.likelyInAppBrowser;

                      return (
                        <>
                    <p className="text-sm font-semibold text-gray-700 mb-2">
                      Payable Amount: <span className="text-green-600 text-lg">₹{getPayableAmount().totalAmount.toFixed(2)}</span>
                    </p>
                    <p className="text-xs text-gray-500 mb-3">Choose app and tap once to open with prefilled UPI details</p>

                    {shouldDisableGenericUpi && (
                      <div className="mb-3 p-3 rounded-lg border border-amber-300 bg-amber-50">
                        <p className="text-xs font-semibold text-amber-900">⚠️ You are in an in-app browser (WhatsApp/Instagram).</p>
                        <p className="text-xs text-amber-800 mt-1">PhonePe/Google Pay may fail here. Open this page in Chrome for reliable payment app launch.</p>
                        <button
                          onClick={openInChrome}
                          className="mt-2 w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold py-2 px-3 rounded-md"
                        >
                          Open in Chrome
                        </button>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={() => openSpecificUPIApp('gpay')}
                        disabled={paymentProcessing}
                        className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold py-3 sm:py-4 px-4 rounded-lg shadow-lg transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex flex-col items-center leading-tight gap-1.5 sm:gap-2">
                          <img
                            src={googlePayLogo}
                            alt="Google Pay"
                            className="h-7 sm:h-8 w-auto bg-white rounded-full px-1.5 py-1"
                          />
                          <span className="text-xs font-bold text-blue-50">Pay ₹{getPayableAmount().totalAmount.toFixed(2)}</span>
                        </div>
                      </button>

                      <button
                        onClick={() => openSpecificUPIApp('phonepe')}
                        disabled={paymentProcessing}
                        className="w-full bg-gradient-to-r from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700 text-white font-bold py-3 sm:py-4 px-4 rounded-lg shadow-lg transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <div className="flex flex-col items-center leading-tight gap-1.5 sm:gap-2">
                          <img
                            src={phonePeLogo}
                            alt="PhonePe"
                            className="h-7 sm:h-8 w-auto bg-white rounded-full px-1.5 py-1"
                          />
                          <span className="text-xs font-bold text-purple-50">Pay ₹{getPayableAmount().totalAmount.toFixed(2)}</span>
                        </div>
                      </button>
                    </div>

                    <button
                      onClick={openUPIPayment}
                      disabled={paymentProcessing || shouldDisableGenericUpi}
                      className="w-full mt-3 bg-gray-800 hover:bg-gray-900 text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        📱 Other UPI App • Pay ₹{getPayableAmount().totalAmount.toFixed(2)}
                    </button>

                    {shouldDisableGenericUpi && (
                      <p className="text-[11px] text-amber-700 mt-2">
                        Generic UPI launch is disabled in this app view. Use Google Pay / PhonePe buttons or open in Chrome.
                      </p>
                    )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* UPI ID */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                  <p className="text-xs text-gray-600 mb-1">Or pay via UPI ID:</p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono font-bold text-sm flex-1 break-all">{activeUPI.upiId}</p>
                    <button
                      onClick={copyUPIId}
                      className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-3 rounded text-xs whitespace-nowrap"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                {/* Instructions */}
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-orange-900 mb-1">⚠️ After Payment:</p>
                  <ul className="text-xs text-orange-800 space-y-1">
                    <li>✓ Take screenshot of payment confirmation</li>
                    <li>✓ Share with property manager on WhatsApp</li>
                    <li>✓ Mention your room number and meter reading</li>
                    <li>✓ Payment will be updated within 24 hours</li>
                  </ul>
                </div>
                </>
                )}
              </div>
            )}

            {/* Room Info Card - Mobile Optimized */}
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-3 sm:mb-4">📍 Room Information</h2>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-blue-50 rounded-lg p-3 sm:p-4">
                  <p className="text-xs sm:text-sm text-blue-700 mb-1">Assigned Rooms</p>
                  <p className="text-xl sm:text-2xl font-bold text-blue-900">
                    {(roomsData.length > 0 ? roomsData.map((entry) => entry.roomNumber).join(', ') : (room?.roomNumber || tenant?.roomNumber || '-'))}
                  </p>
                </div>
                <div className="bg-green-50 rounded-lg p-3 sm:p-4">
                  <p className="text-xs sm:text-sm text-green-700 mb-1">Total Monthly Rent</p>
                  <p className="text-xl sm:text-2xl font-bold text-green-900">
                    ₹{(
                      (roomsData.length > 0
                        ? roomsData.reduce((sum, entry) => sum + (Number(entry?.rent) || 0), 0)
                        : (Number(tenant?.currentRent) || Number(room?.rent) || 0)
                      )
                    ).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>

              {/* Electricity Info - Mobile Optimized */}
              {(roomsData.length > 0 ? roomsData : (room ? [room] : [])).length > 0 && (
                <div className="mt-3 sm:mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4">
                  <h3 className="font-semibold text-yellow-900 mb-2 sm:mb-3 text-sm sm:text-base">⚡ Electricity Meter</h3>
                  <div className="space-y-2">
                    {(roomsData.length > 0 ? roomsData : (room ? [room] : [])).map((roomEntry) => (
                      <div key={String(roomEntry.roomNumber)} className="bg-white rounded-lg border border-yellow-200 p-2 sm:p-3">
                        <div className="grid grid-cols-4 gap-2 sm:gap-3 text-xs sm:text-sm">
                          <div>
                            <p className="text-yellow-700 mb-1">Room</p>
                            <p className="font-bold text-yellow-900">{roomEntry.roomNumber}</p>
                          </div>
                          <div>
                            <p className="text-yellow-700 mb-1">Meter No.</p>
                            <p className="font-mono font-bold text-yellow-900 text-xs sm:text-sm break-all">{roomEntry.electricityMeterNo || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-yellow-700 mb-1">Current</p>
                            <p className="font-mono font-bold text-yellow-900">{roomEntry.currentReading || 0}</p>
                          </div>
                          <div>
                            <p className="text-yellow-700 mb-1">Old (This Month)</p>
                            <p className="font-mono font-bold text-yellow-900">{getLastMonthClosingReading(roomEntry.roomNumber)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Meter History Access - Read Only */}
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              {(() => {
                const fullTimeline = getMeterHistoryTimeline();
                const roomTabs = (roomsData || []).map((entry) => String(entry.roomNumber));
                const hasRoomTabs = roomTabs.length > 1;
                const filteredTimeline = hasRoomTabs && selectedMeterRoomTab !== 'all'
                  ? fullTimeline.filter((entry) => String(entry.roomNumber) === String(selectedMeterRoomTab))
                  : fullTimeline;

                return (
                  <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800">📚 Meter Reading History</h2>
                <span className="text-xs sm:text-sm text-gray-600">
                  {filteredTimeline.length} record{filteredTimeline.length !== 1 ? 's' : ''}
                </span>
              </div>

              {hasRoomTabs && (
                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    onClick={() => setSelectedMeterRoomTab('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      selectedMeterRoomTab === 'all'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    All Meters
                  </button>
                  {roomTabs.map((roomNumber) => (
                    <button
                      key={`meter_tab_${roomNumber}`}
                      onClick={() => setSelectedMeterRoomTab(roomNumber)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        selectedMeterRoomTab === roomNumber
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                      }`}
                    >
                      MTR {roomNumber}
                    </button>
                  ))}
                </div>
              )}

              {filteredTimeline.length === 0 ? (
                <div className="text-center py-6 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600">No meter history available yet.</p>
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto border border-gray-200 rounded-lg">
                  <table className="w-full text-xs sm:text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Room</th>
                        <th className="px-3 py-2 text-left font-semibold text-gray-700">Month</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Old</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Current</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Units</th>
                        <th className="px-3 py-2 text-right font-semibold text-gray-700">Electricity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTimeline.map((entry) => (
                        <tr key={entry.id} className="border-t border-gray-100">
                          <td className="px-3 py-2 font-semibold text-gray-700">{entry.roomNumber || '-'}</td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-gray-800">{entry.monthLabel}</div>
                            <div className="text-[10px] text-gray-500">
                              {entry.source === 'meter_reading' ? 'meter record' : 'payment history'}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{entry.previousReading}</td>
                          <td className="px-3 py-2 text-right font-mono">{entry.currentReading}</td>
                          <td className="px-3 py-2 text-right">{entry.unitsConsumed}</td>
                          <td className="px-3 py-2 text-right font-semibold">₹{Number(entry.electricityAmount || 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
                  </>
                );
              })()}
            </div>

            {/* Payment Records - Collapsible Mobile-Friendly Cards */}
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-6">
              {(() => {
                const monthlyPaymentGroups = getMonthlyPaymentGroups();

                return (
                  <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl sm:text-2xl font-bold text-gray-800">💰 Payment History</h2>
                <span className="text-xs sm:text-sm text-gray-600">
                  {monthlyPaymentGroups.length} month{monthlyPaymentGroups.length !== 1 ? 's' : ''}
                </span>
              </div>

              {paymentRecords.length > 0 && (() => {
                const summary = getPaidAmountSummary();
                return (
                  <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <p className="text-xs text-blue-700 font-semibold mb-1">🏠 Total Rent Paid (Till Date)</p>
                      <p className="text-lg font-bold text-blue-900">₹{summary.rentPaid.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                      <p className="text-xs text-purple-700 font-semibold mb-1">⚡ Total Electricity Paid (Till Date)</p>
                      <p className="text-lg font-bold text-purple-900">₹{summary.electricityPaid.toLocaleString('en-IN')}</p>
                    </div>
                  </div>
                );
              })()}

              {paymentRecords.length > 0 && (() => {
                const paidWithElectricity = monthlyPaymentGroups.filter((group) => group.status === 'paid' && Number(group.totalElectricity || 0) > 0);
                const lastElectricityPaid = paidWithElectricity[0] || null;

                return (
                  <div className="mb-4">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <p className="text-xs text-green-700 font-semibold mb-1">✅ Rent + Electricity Paid</p>
                      <p className="text-sm font-bold text-green-900">
                        {lastElectricityPaid
                          ? `Last: ${getMonthName(lastElectricityPaid.month)} ${lastElectricityPaid.year}`
                          : 'No electricity-paid month yet'}
                      </p>
                    </div>
                  </div>
                );
              })()}
              
              {paymentRecords.length === 0 ? (
                <div className="text-center py-6 sm:py-8 bg-gray-50 rounded-lg">
                  <div className="text-4xl sm:text-5xl mb-2 sm:mb-3">📋</div>
                  <p className="text-gray-600 font-semibold text-sm sm:text-base">No payment records yet</p>
                  <p className="text-xs sm:text-sm text-gray-500 mt-1">Your payment history will appear here</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {monthlyPaymentGroups.map((group) => {
                    const total = group.totalAmount;
                    const isPaid = group.status === 'paid';
                    const isPending = group.status === 'pending';
                    const isOverdue = group.status === 'overdue';
                    const groupCardId = `group_${group.year}_${group.month}`;
                    const isExpanded = expandedCard === groupCardId;
                    const isRentElectricityPaid = isPaid && Number(group.totalElectricity || 0) > 0;
                    const isOnlyRentPaid = isPaid && Number(group.totalElectricity || 0) <= 0;

                    const paymentTypeText = isRentElectricityPaid
                      ? 'Rent + Electricity Paid'
                      : isOnlyRentPaid
                      ? 'Rent Paid • Electricity Pending'
                      : isPaid
                      ? 'Paid'
                      : isPending
                      ? 'Pending'
                      : 'Overdue';
                    
                    return (
                      <div 
                        key={groupCardId} 
                        className={`border-2 rounded-lg transition-all cursor-pointer ${
                          isRentElectricityPaid ? 'border-green-300 bg-green-50 hover:bg-green-100' :
                          isOnlyRentPaid ? 'border-amber-300 bg-amber-50 hover:bg-amber-100' :
                          isPaid ? 'border-green-300 bg-green-50 hover:bg-green-100' :
                          isPending ? 'border-yellow-300 bg-yellow-50 hover:bg-yellow-100' :
                          isOverdue ? 'border-red-300 bg-red-50 hover:bg-red-100' :
                          'border-gray-300 bg-gray-50 hover:bg-gray-100'
                        }`}
                      >
                        {/* Compact Header - Always Visible */}
                        <div 
                          onClick={() => toggleCard(groupCardId)}
                          className="flex items-center justify-between p-3"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="text-xl flex-shrink-0">
                              {isRentElectricityPaid ? '✅' : isOnlyRentPaid ? '⚠️' : isPaid ? '✅' : isPending ? '⏳' : '❌'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm sm:text-base font-bold text-gray-800 truncate">
                                {getMonthName(group.month)} {group.year}
                              </h3>
                              <p className="text-xs text-gray-600">
                                {paymentTypeText}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="text-right">
                              <p className="text-base sm:text-lg font-bold text-gray-900">₹{total.toLocaleString('en-IN')}</p>
                            </div>
                            <span className="text-gray-400 text-xl">
                              {isExpanded ? '▼' : '▶'}
                            </span>
                          </div>
                        </div>
                        
                        {/* Expanded Details - Show on Click */}
                        {isExpanded && (
                          <div className="px-3 pb-3 space-y-3 border-t border-gray-200 pt-3">
                            {isOnlyRentPaid && (
                              <div className="bg-amber-50 border border-amber-200 rounded p-2">
                                <p className="text-xs font-semibold text-amber-900">
                                  ⚠️ Rent payment received for this month. Electricity bill is still pending.
                                </p>
                              </div>
                            )}

                            {/* Payment Date */}
                            {group.paidAt && isPaid && (
                              <div className="bg-white/50 rounded p-2">
                                <p className="text-xs text-gray-600 mb-1">Payment Date:</p>
                                <p className="text-sm font-semibold text-green-700">
                                  {new Date(group.paidAt).toLocaleDateString('en-IN', {
                                    day: 'numeric',
                                    month: 'short',
                                    year: 'numeric'
                                  })}
                                </p>
                              </div>
                            )}
                            
                            {/* Breakdown */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="bg-white/50 rounded p-2">
                                <p className="text-xs text-gray-600 mb-1">Rent</p>
                                <p className="font-bold text-gray-800 text-sm">₹{Number(group.totalRent || 0).toLocaleString('en-IN')}</p>
                              </div>
                              <div className="bg-white/50 rounded p-2">
                                <p className="text-xs text-gray-600 mb-1">Electricity</p>
                                <p className="font-bold text-gray-800 text-sm">₹{Number(group.totalElectricity || 0).toLocaleString('en-IN')}</p>
                              </div>
                            </div>

                            {/* Room-wise Breakdown */}
                            <div className="bg-indigo-50 border border-indigo-200 rounded p-2">
                              <p className="text-xs font-semibold text-indigo-900 mb-2">🏠 Room-wise Breakout:</p>
                              <div className="space-y-1">
                                {group.records.map((recordItem) => (
                                  <div key={`room_break_${recordItem.id}`} className="grid grid-cols-4 gap-2 text-xs bg-white/70 rounded px-2 py-1">
                                    <p className="font-semibold text-indigo-900">Room {recordItem.roomNumber || '-'}</p>
                                    <p>Rent ₹{Number(recordItem.rent || 0).toFixed(2)}</p>
                                    <p>Elec ₹{Number(recordItem.electricity || 0).toFixed(2)}</p>
                                    <p className="font-semibold">Total ₹{(Number(recordItem.rent || 0) + Number(recordItem.electricity || 0)).toFixed(2)}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                            
                            {/* Meter Readings */}
                            {group.records.some((recordItem) => recordItem.oldReading || recordItem.currentReading || recordItem.units) && (
                              <div className="bg-yellow-50 border border-yellow-200 rounded p-2">
                                <p className="text-xs font-semibold text-yellow-900 mb-2">⚡ Meter Details:</p>
                                <div className="space-y-1 text-xs">
                                  {group.records.map((recordItem) => (
                                    <div key={`meter_${recordItem.id}`} className="grid grid-cols-4 gap-2 bg-white/70 rounded px-2 py-1">
                                      <p className="font-semibold text-yellow-900">R{recordItem.roomNumber || '-'}</p>
                                      <p>Prev {recordItem.oldReading || 0}</p>
                                      <p>Curr {recordItem.currentReading || 0}</p>
                                      <p>Units {recordItem.units || recordItem.unitsConsumed || 0}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* Payment Method */}
                            {group.records.some((recordItem) => recordItem.paymentMethod) && isPaid && (
                              <div className="bg-white/50 rounded p-2">
                                <p className="text-xs text-gray-600 mb-1">Payment Method:</p>
                                <p className="text-sm font-semibold text-gray-800">
                                  💳 {group.records.find((recordItem) => recordItem.paymentMethod)?.paymentMethod}
                                </p>
                              </div>
                            )}
                            
                            {/* Notes */}
                            {group.notes && (
                              <div className="bg-white/50 rounded p-2">
                                <p className="text-xs text-gray-600 mb-1">📝 Note:</p>
                                <p className="text-sm text-gray-700 italic">{group.notes}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
                  </>
                );
              })()}
            </div>

            {/* Contact & Support Info */}
            <div className="bg-gradient-to-br from-gray-700 to-gray-900 text-white rounded-lg shadow-lg p-4 sm:p-6">
              <div className="text-center mb-4">
                <div className="text-3xl sm:text-4xl mb-2">📞</div>
                <h2 className="text-xl sm:text-2xl font-bold mb-1">Need Help?</h2>
                <p className="text-white/80 text-sm">Contact property manager</p>
              </div>

              <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-lg p-4">
                <h3 className="font-bold mb-3 text-sm">📋 Payment Instructions:</h3>
                <ul className="text-xs sm:text-sm text-white/90 space-y-2">
                  <li>✓ &quot;Make Payment Now&quot; button shows only when payment is due</li>
                  <li>✓ Once paid, button is hidden and shows ✅ confirmation</li>
                  <li>✓ Enter current meter reading before payment</li>
                  <li>✓ Scan QR code or use UPI ID to pay</li>
                  <li>✓ After payment, click &quot;Submit Payment for Verification&quot;</li>
                  <li>✓ Admin will verify within 24 hours</li>
                </ul>
              </div>

              <div className="mt-4 bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-3">
                <p className="text-xs text-yellow-100">
                  <strong>⚠️ Important:</strong> Always provide your meter reading along with payment proof for accurate billing.
                </p>
                <p className="text-xs text-yellow-100 mt-2">
                  <strong>⚠️ जरूरी सूचना:</strong> केवल payment करने से entry record नहीं होगी। Payment record कराने के लिए
                  &quot;Submit Payment for Verification&quot; में screenshot और UTR submit करना अनिवार्य है।
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* Submit Payment Modal */}
        {showSubmitPayment && (
          <SubmitPayment
            tenant={tenant}
            room={room}
            rooms={roomsData}
            electricityRate={globalElectricityRate}
            language={portalLanguage}
            onClose={() => setShowSubmitPayment(false)}
            onSuccess={() => {
              // Reload tenant data after successful submission
              setShowSubmitPayment(false);
              // Optionally refresh data here
            }}
          />
        )}
      </div>
    </div>
  );
};

export default TenantPortal;
