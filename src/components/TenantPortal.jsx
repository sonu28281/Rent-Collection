import { useEffect, useRef, useState } from 'react';
import { collection, query, where, getDocs, limit, doc, getDoc, setDoc } from 'firebase/firestore';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import SubmitPayment from './SubmitPayment';
import TenantCheckoutRequest from './TenantCheckoutRequest';
import googlePayLogo from '../assets/payment-icons/google-pay.svg';
import phonePeLogo from '../assets/payment-icons/phonepe.svg';
import Tesseract from 'tesseract.js';
import LiveDateTime from './ui/LiveDateTime';
import { scanDocument } from '../utils/documentScanner';

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
  
  // History tab state (payments or meters)
  const [historyTab, setHistoryTab] = useState('payments');
  
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
  const [showCheckoutRequest, setShowCheckoutRequest] = useState(false);
  const [portalLanguage, setPortalLanguage] = useState(() => localStorage.getItem(TENANT_PORTAL_LANG_KEY) || 'en');
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );
  const [startingDigiLockerKyc, setStartingDigiLockerKyc] = useState(false);
  const [digiLockerError, setDigiLockerError] = useState('');
  const [kycCallbackStatus, setKycCallbackStatus] = useState('idle');
  const [kycCallbackMessage, setKycCallbackMessage] = useState('');
  const [hiddenRejectedSubmissionIds, setHiddenRejectedSubmissionIds] = useState(new Set());
  const [currentKycStep, setCurrentKycStep] = useState(1); // Track current active KYC step (1, 2, or 3)
  const [tenantProfile, setTenantProfile] = useState({
    firstName: '',
    lastName: '',
    phoneNumber: '',
    occupation: '',
    // Aadhaar (Required - both sides)
    aadharFrontImage: '',
    aadharBackImage: '',
    aadharNumber: '',
    aadharExtractedNumber: '',
    aadharDocStatus: 'not_uploaded',
    aadharDocReason: '',
    aadharNameMatched: false,
    aadharDocConfidence: 0,
    // Secondary ID (PAN or DL - user selects)
    secondaryIdType: 'PAN', // 'PAN' or 'DL'
    secondaryIdNumber: '', // Manual entry
    // PAN fields
    panImage: '',
    panExtractedNumber: '',
    panDocStatus: 'not_uploaded',
    panDocReason: '',
    panNameMatched: false,
    panDocConfidence: 0,
    // DL fields
    dlImage: '',
    dlNumber: '',
    dlExtractedNumber: '',
    dlDocStatus: 'not_uploaded',
    dlDocReason: '',
    dlNameMatched: false,
    dlDocConfidence: 0,
    // Other
    selfieImage: '',
    agreementAccepted: false,
    agreementSignature: '',
    agreementSignedAt: null
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [ocrAnalyzing, setOcrAnalyzing] = useState(false);
  const signatureCanvasRef = useRef(null);
  const [isSigning, setIsSigning] = useState(false);
  
  // Camera capture refs
  const aadharFrontFileInputRef = useRef(null);
  const aadharFrontCameraInputRef = useRef(null);
  const aadharBackFileInputRef = useRef(null);
  const aadharBackCameraInputRef = useRef(null);
  const panFileInputRef = useRef(null);
  const panCameraInputRef = useRef(null);
  const dlFileInputRef = useRef(null);
  const dlCameraInputRef = useRef(null);
  const selfieFileInputRef = useRef(null);
  const selfieCameraInputRef = useRef(null);
  
  // Open camera directly (creates a fresh input to force camera on mobile)
  const openCameraForField = (field, facing = 'environment') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = facing; // 'environment' = back camera, 'user' = front camera
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) handleProfileFileChange(field, file);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  };

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
  const normalizeDl = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

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

  const extractDlFromText = (text) => {
    const raw = String(text || '').toUpperCase().replace(/[^A-Z0-9\s-]/g, ' ');
    const compact = raw.replace(/[\s-]/g, '');
    const dlMatch = compact.match(/[A-Z]{2}[0-9]{2}[0-9A-Z]{9,13}/);
    return dlMatch?.[0] ? normalizeDl(dlMatch[0]) : '';
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

    if (docType === 'dl') {
      next.dlDocStatus = verificationResult.status;
      next.dlDocReason = verificationResult.reason;
      next.dlNameMatched = !!verificationResult.nameMatched;
      next.dlExtractedNumber = verificationResult.extractedNumber || '';
      next.dlDocConfidence = verificationResult.confidence || 0;
      if (verificationResult.extractedNumber) {
        next.dlNumber = verificationResult.extractedNumber;
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
        if (docType === 'dl') return { ...prev, dlDocStatus: 'checking', dlDocReason: 'Checking OCR...' };
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
        : docType === 'pan'
          ? extractPanFromText(rawText)
          : extractDlFromText(rawText);

      const expectedNumber = docType === 'pan'
        ? normalizePan(tenantProfile.secondaryIdNumber)
        : docType === 'dl'
          ? normalizeDl(tenantProfile.secondaryIdNumber)
          : normalizeAadhar(tenantProfile.aadharNumber);

      let status = 'verified';
      let reason = 'Document verified successfully.';

      if (!extractedNumber) {
        status = 'number_not_found';
        reason = `${docType === 'aadhar' ? 'Aadhaar' : docType === 'pan' ? 'PAN' : 'Driving License'} number not detected in document.`;
      } else if ((docType === 'pan' || docType === 'dl') && expectedNumber && expectedNumber !== extractedNumber) {
        status = 'number_mismatch';
        reason = 'Uploaded document number does not match the manually entered ID number.';
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

  // 3-Step KYC Progress Tracking
  const getKycStepProgress = () => {
    // Step 1: Basic Details
    const step1_firstName = !!tenantProfile.firstName;
    const step1_lastName = !!tenantProfile.lastName;
    const step1_phoneNumber = !!tenantProfile.phoneNumber;
    const step1_occupation = !!tenantProfile.occupation;
    const step1Complete = step1_firstName && step1_lastName && step1_phoneNumber && step1_occupation;
    
    // Step 2: Document Upload (Aadhaar both sides + Secondary ID + Selfie + OCR verified)
    const step2_aadharFrontUploaded = !!tenantProfile.aadharFrontImage;
    const step2_aadharBackUploaded = !!tenantProfile.aadharBackImage;
    const step2_aadharOcrVerified = tenantProfile.aadharDocStatus === 'verified';
    const step2_aadharComplete = step2_aadharFrontUploaded && step2_aadharBackUploaded && step2_aadharOcrVerified;
    
    const step2_secondaryIdNumber = !!tenantProfile.secondaryIdNumber;
    const step2_secondaryIdUploaded = tenantProfile.secondaryIdType === 'PAN' 
      ? !!tenantProfile.panImage 
      : !!tenantProfile.dlImage;
    const step2_secondaryOcrVerified = tenantProfile.secondaryIdType === 'PAN'
      ? tenantProfile.panDocStatus === 'verified'
      : tenantProfile.dlDocStatus === 'verified';
    const step2_secondaryIdComplete = step2_secondaryIdNumber && step2_secondaryIdUploaded && step2_secondaryOcrVerified;
    
    const step2_selfieUploaded = !!tenantProfile.selfieImage;
    
    // Complete if: Aadhaar (both + OCR) + Secondary ID (number + image + OCR) + Selfie
    const step2Complete = step2_aadharComplete && step2_secondaryIdComplete && step2_selfieUploaded;
    const step2Partial = step2_aadharFrontUploaded || step2_aadharBackUploaded || step2_secondaryIdUploaded || step2_selfieUploaded;
    
    // Step 3: DigiLocker Verification
    const kycData = tenant?.kyc || {};
    const step3Complete = kycData.verified && kycData.verifiedBy === 'DigiLocker';
    
    // Agreement (final requirement)
    const agreementComplete = !!tenantProfile.agreementAccepted && !!tenantProfile.agreementSignature;
    
    return {
      step1: {
        complete: step1Complete,
        items: { firstName: step1_firstName, lastName: step1_lastName, phone: step1_phoneNumber, occupation: step1_occupation },
        label: 'Step 1: Fill Details',
        description: 'Complete your basic information'
      },
      step2: {
        complete: step2Complete,
        items: {
          aadharFront: step2_aadharFrontUploaded,
          aadharBack: step2_aadharBackUploaded,
          aadharOcr: step2_aadharOcrVerified,
          secondaryId: step2_secondaryIdUploaded,
          secondaryIdNumber: step2_secondaryIdNumber,
          secondaryOcr: step2_secondaryOcrVerified,
          selfie: step2_selfieUploaded
        },
        partial: step2Partial,
        label: 'Step 2: Upload & Verify Documents',
        description: 'Upload documents — OCR auto-verify hoga'
      },
      step3: {
        complete: step3Complete,
        enabled: step1Complete && step2Complete,
        label: 'Step 3: DigiLocker KYC',
        description: 'Final verification via DigiLocker'
      },
      agreement: {
        complete: agreementComplete,
        enabled: step1Complete && step2Complete && step3Complete,
        label: 'Sign Agreement',
        description: 'Accept terms and sign digitally'
      },
      overall: {
        stepsCompleted: [step1Complete, step2Complete, step3Complete, agreementComplete].filter(Boolean).length,
        totalSteps: 4,
        percentage: Math.round(([step1Complete, step2Complete, step3Complete, agreementComplete].filter(Boolean).length / 4) * 100)
      }
    };
  };

  const getProfileCompletion = () => {
    const aadharVerified = tenantProfile.aadharDocStatus === 'verified' && !!tenantProfile.aadharExtractedNumber && !!tenantProfile.aadharFrontImage;
    const panVerified = tenantProfile.panDocStatus === 'verified' && !!tenantProfile.panExtractedNumber && !!tenantProfile.panImage;
    const dlVerified = tenantProfile.dlDocStatus === 'verified' && !!tenantProfile.dlExtractedNumber && !!tenantProfile.dlImage;
    const secondaryIdVerified = tenantProfile.secondaryIdType === 'PAN' ? panVerified : dlVerified;
    const checklist = [
      !!tenantProfile.firstName,
      !!tenantProfile.lastName,
      !!tenantProfile.phoneNumber,
      !!tenantProfile.occupation,
      !!tenantProfile.aadharFrontImage,
      !!tenantProfile.aadharBackImage,
      aadharVerified,
      (tenantProfile.secondaryIdType === 'PAN' ? !!tenantProfile.panImage : !!tenantProfile.dlImage),
      !!tenantProfile.secondaryIdNumber,
      secondaryIdVerified,
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
            aadharDocStatus: prev.aadharFrontImage ? 'recheck_needed' : prev.aadharDocStatus,
            panDocStatus: prev.panImage ? 'recheck_needed' : prev.panDocStatus,
            dlDocStatus: prev.dlImage ? 'recheck_needed' : prev.dlDocStatus,
            aadharDocReason: prev.aadharFrontImage ? 'Name changed. Please re-upload/recheck Aadhaar.' : prev.aadharDocReason,
            panDocReason: prev.panImage ? 'Name changed. Please re-upload/recheck PAN.' : prev.panDocReason,
            dlDocReason: prev.dlImage ? 'Name changed. Please re-upload/recheck DL.' : prev.dlDocReason
          }
        : {}),
      ...(field === 'secondaryIdType'
        ? {
            secondaryIdNumber: '',
            panImage: value === 'PAN' ? prev.panImage : '',
            panDocStatus: value === 'PAN' ? prev.panDocStatus : 'not_uploaded',
            panDocReason: value === 'PAN' ? prev.panDocReason : '',
            panExtractedNumber: value === 'PAN' ? prev.panExtractedNumber : '',
            dlImage: value === 'DL' ? prev.dlImage : '',
            dlDocStatus: value === 'DL' ? prev.dlDocStatus : 'not_uploaded',
            dlDocReason: value === 'DL' ? prev.dlDocReason : '',
            dlExtractedNumber: value === 'DL' ? prev.dlExtractedNumber : ''
          }
        : {})
    }));
  };

  const handleProfileFileChange = async (field, file) => {
    if (!file) return;
    try {
      const rawDataUrl = await toDataUrl(file);

      // Apply document scanning for ID documents (not selfie)
      const isSelfie = field === 'selfieImage';
      const scannedDataUrl = await scanDocument(rawDataUrl, { isSelfie });

      const nextProfile = {
        ...tenantProfile,
        [field]: scannedDataUrl
      };

      setTenantProfile((prev) => ({
        ...prev,
        [field]: scannedDataUrl,
        ...(field === 'aadharFrontImage'
          ? {
              aadharDocStatus: 'checking',
              aadharDocReason: 'Checking Aadhaar front OCR...',
              aadharExtractedNumber: '',
              aadharNameMatched: false,
              aadharDocConfidence: 0
            }
          : {}),
        ...(field === 'aadharBackImage'
          ? {
              aadharDocReason: 'Aadhaar back uploaded.'
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
          : {}),
        ...(field === 'dlImage'
          ? {
              dlDocStatus: 'checking',
              dlDocReason: 'Checking OCR...',
              dlExtractedNumber: '',
              dlNameMatched: false,
              dlDocConfidence: 0
            }
          : {})
      }));

      if (field === 'aadharFrontImage') {
        await verifyKycDocument('aadhar', nextProfile.aadharFrontImage, { updateState: true });
      }
      if (field === 'panImage') {
        await verifyKycDocument('pan', nextProfile.panImage, { updateState: true });
      }
      if (field === 'dlImage') {
        await verifyKycDocument('dl', nextProfile.dlImage, { updateState: true });
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
      
      // Check for DigiLocker KYC data
      const kycData = tenantData?.kyc || {};
      const hasDigiLockerData = kycData.verified && kycData.verifiedBy === 'DigiLocker';
      
      setTenantProfile({
        firstName: profileData.firstName || (hasDigiLockerData && kycData.name ? splitName(kycData.name).firstName : '') || split.firstName || '',
        lastName: profileData.lastName || (hasDigiLockerData && kycData.name ? splitName(kycData.name).lastName : '') || split.lastName || '',
        phoneNumber: profileData.phoneNumber || tenantData.phone || '',
        occupation: profileData.occupation || '',
        aadharNumber: profileData.aadharNumber || (kycData.aadhaar?.aadhaarNumber || ''),
        aadharFrontImage: profileData.aadharFrontImage || profileData.aadharImage || '',
        aadharBackImage: profileData.aadharBackImage || '',
        secondaryIdType: profileData.secondaryIdType || 'PAN',
        secondaryIdNumber: profileData.secondaryIdNumber || '',
        panImage: profileData.panImage || '',
        dlImage: profileData.dlImage || '',
        dlNumber: profileData.dlNumber || '',
        selfieImage: profileData.selfieImage || '',
        aadharDocStatus: hasDigiLockerData && kycData.aadhaar ? 'verified' : (profileData.aadharDocStatus || (profileData.aadharFrontImage || profileData.aadharImage ? 'recheck_needed' : 'not_uploaded')),
        panDocStatus: profileData.panDocStatus || (profileData.panImage ? 'recheck_needed' : 'not_uploaded'),
        dlDocStatus: profileData.dlDocStatus || (profileData.dlImage ? 'recheck_needed' : 'not_uploaded'),
        aadharDocReason: hasDigiLockerData && kycData.aadhaar ? 'Verified via DigiLocker' : (profileData.aadharDocReason || ''),
        panDocReason: profileData.panDocReason || '',
        dlDocReason: profileData.dlDocReason || '',
        aadharNameMatched: hasDigiLockerData ? true : !!profileData.aadharNameMatched,
        panNameMatched: !!profileData.panNameMatched,
        dlNameMatched: !!profileData.dlNameMatched,
        aadharExtractedNumber: kycData.aadhaar?.aadhaarNumber || profileData.aadharExtractedNumber || profileData.aadharNumber || '',
        panExtractedNumber: profileData.panExtractedNumber || profileData.panNumber || '',
        dlExtractedNumber: profileData.dlExtractedNumber || profileData.dlNumber || '',
        aadharDocConfidence: hasDigiLockerData ? 100 : Number(profileData.aadharDocConfidence || 0),
        panDocConfidence: Number(profileData.panDocConfidence || 0),
        dlDocConfidence: Number(profileData.dlDocConfidence || 0),
        agreementAccepted: !!profileData.agreementAccepted,
        agreementSignature: profileData.agreementSignature || '',
        agreementSignedAt: profileData.agreementSignedAt || null
      });
      
      console.log('✅ Tenant profile loaded', {
        hasDigiLockerKYC: hasDigiLockerData,
        hasAadhaar: !!kycData.aadhaar
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

      if (profileForSave.aadharFrontImage && profileForSave.aadharDocStatus !== 'verified') {
        const aadharResult = await verifyKycDocument('aadhar', profileForSave.aadharFrontImage, { updateState: false });
        profileForSave = applyDocVerificationToProfile(profileForSave, 'aadhar', aadharResult);
      }

      if (profileForSave.secondaryIdType === 'PAN' && profileForSave.panImage && profileForSave.panDocStatus !== 'verified') {
        const panResult = await verifyKycDocument('pan', profileForSave.panImage, { updateState: false });
        profileForSave = applyDocVerificationToProfile(profileForSave, 'pan', panResult);
      }

      if (profileForSave.secondaryIdType === 'DL' && profileForSave.dlImage && profileForSave.dlDocStatus !== 'verified') {
        const dlResult = await verifyKycDocument('dl', profileForSave.dlImage, { updateState: false });
        profileForSave = applyDocVerificationToProfile(profileForSave, 'dl', dlResult);
      }

      setTenantProfile(profileForSave);

      const profilePayload = {
        ...profileForSave,
        tenantId: tenant.id,
        roomNumber: tenant.roomNumber || null,
        fullName: `${profileForSave.firstName} ${profileForSave.lastName}`.trim(),
        aadharNumber: profileForSave.aadharExtractedNumber || profileForSave.aadharNumber || '',
        panNumber: profileForSave.panExtractedNumber || profileForSave.panNumber || '',
        dlNumber: profileForSave.dlExtractedNumber || profileForSave.dlNumber || '',
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
    const secondaryImage = tenantProfile.secondaryIdType === 'PAN' ? tenantProfile.panImage : tenantProfile.dlImage;
    if (!tenantProfile.aadharFrontImage && !secondaryImage) {
      alert('Please upload Aadhaar front or selected secondary ID image first.');
      return;
    }

    setOcrAnalyzing(true);
    try {
      let profileForAnalysis = { ...tenantProfile };

      if (profileForAnalysis.aadharFrontImage) {
        const aadharResult = await verifyKycDocument('aadhar', profileForAnalysis.aadharFrontImage, { updateState: false });
        profileForAnalysis = applyDocVerificationToProfile(profileForAnalysis, 'aadhar', aadharResult);
      }

      if (profileForAnalysis.secondaryIdType === 'PAN' && profileForAnalysis.panImage) {
        const panResult = await verifyKycDocument('pan', profileForAnalysis.panImage, { updateState: false });
        profileForAnalysis = applyDocVerificationToProfile(profileForAnalysis, 'pan', panResult);
      }

      if (profileForAnalysis.secondaryIdType === 'DL' && profileForAnalysis.dlImage) {
        const dlResult = await verifyKycDocument('dl', profileForAnalysis.dlImage, { updateState: false });
        profileForAnalysis = applyDocVerificationToProfile(profileForAnalysis, 'dl', dlResult);
      }

      setTenantProfile(profileForAnalysis);

      if (tenant?.id) {
        await setDoc(doc(db, 'tenantProfiles', tenant.id), {
          aadharDocStatus: profileForAnalysis.aadharDocStatus,
          panDocStatus: profileForAnalysis.panDocStatus,
          dlDocStatus: profileForAnalysis.dlDocStatus,
          aadharDocReason: profileForAnalysis.aadharDocReason,
          panDocReason: profileForAnalysis.panDocReason,
          dlDocReason: profileForAnalysis.dlDocReason,
          aadharNameMatched: profileForAnalysis.aadharNameMatched,
          panNameMatched: profileForAnalysis.panNameMatched,
          dlNameMatched: profileForAnalysis.dlNameMatched,
          aadharExtractedNumber: profileForAnalysis.aadharExtractedNumber,
          panExtractedNumber: profileForAnalysis.panExtractedNumber,
          dlExtractedNumber: profileForAnalysis.dlExtractedNumber,
          aadharNumber: profileForAnalysis.aadharExtractedNumber || profileForAnalysis.aadharNumber || '',
          panNumber: profileForAnalysis.panExtractedNumber || profileForAnalysis.panNumber || '',
          dlNumber: profileForAnalysis.dlExtractedNumber || profileForAnalysis.dlNumber || '',
          aadharDocConfidence: profileForAnalysis.aadharDocConfidence || 0,
          panDocConfidence: profileForAnalysis.panDocConfidence || 0,
          dlDocConfidence: profileForAnalysis.dlDocConfidence || 0,
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
          console.log('✅ DigiLocker popup closed, refreshing tenant data...');
          setStartingDigiLockerKyc(false);
          
          // Refresh tenant document from Firestore to get updated KYC status
          setTimeout(async () => {
            if (tenant?.id) {
              console.log('🔄 Refreshing tenant document after popup close...');
              const refreshedTenant = await refreshTenantFromFirestore(tenant.id);
              
              // If tenant was refreshed successfully, also refresh room/payment data
              if (refreshedTenant) {
                console.log('🔄 Now fetching room and payment data...');
                await fetchTenantData(refreshedTenant);
              } else {
                console.warn('⚠️ Tenant refresh failed, trying with existing tenant object');
                await fetchTenantData(tenant);
              }
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

      // Debug: Log all callback parameters
      console.log('🔍 DigiLocker callback received:');
      console.log('  URL:', location.href);
      console.log('  Code:', code ? '✅ Present' : '❌ Missing');
      console.log('  State:', state ? '✅ Present' : '❌ Missing');
      console.log('  Error:', oauthError || 'None');
      console.log('  All params:', Object.fromEntries(params.entries()));

      if (oauthError) {
        setKycCallbackStatus('error');
        setKycCallbackMessage(`DigiLocker returned error: ${oauthError}`);
        // Store error for onboarding parent window
        localStorage.setItem('digilocker_kyc_result', JSON.stringify({ success: false, error: oauthError }));
        if (window.opener && !window.opener.closed) {
          setTimeout(() => window.close(), 1500);
        } else {
          setTimeout(() => navigate('/tenant-portal', { replace: true }), 1500);
        }
        return;
      }

      if (!code || !state) {
        setKycCallbackStatus('error');
        setKycCallbackMessage('Missing code/state in callback URL.');
        localStorage.setItem('digilocker_kyc_result', JSON.stringify({ success: false, error: 'DigiLocker ne code/state nahi diya.' }));
        if (window.opener && !window.opener.closed) {
          setTimeout(() => window.close(), 2000);
        } else {
          setTimeout(() => navigate('/tenant-portal', { replace: true }), 3000);
        }
        return;
      }

      // ─── Check for pending state: try both onboarding and tenant portal keys ───
      const ONBOARDING_KYC_KEY = 'kycPendingState';
      let pending = null;
      let isOnboardingFlow = false;

      // Try onboarding key first
      try {
        const raw = localStorage.getItem(ONBOARDING_KYC_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.state && parsed?.source === 'onboarding') {
            pending = parsed;
            isOnboardingFlow = true;
          }
        }
      } catch { /* ignore */ }

      // Fall back to tenant portal key
      if (!pending) {
        try {
          const raw = localStorage.getItem(KYC_PENDING_KEY);
          pending = raw ? JSON.parse(raw) : null;
        } catch {
          pending = null;
        }
      }

      console.log('🔍 Pending state:', { isOnboardingFlow, hasState: !!pending?.state, hasTenantId: !!pending?.tenantId });

      // ─── ONBOARDING FLOW: No tenantId, exchange code → profile client-side ───
      if (isOnboardingFlow && pending?.state) {
        // Validate state matches
        if (state !== pending.state) {
          setKycCallbackStatus('error');
          setKycCallbackMessage('State mismatch. Please try again.');
          localStorage.setItem('digilocker_kyc_result', JSON.stringify({ success: false, error: 'State mismatch — dobara try karein.' }));
          localStorage.removeItem(ONBOARDING_KYC_KEY);
          if (window.opener) setTimeout(() => window.close(), 2000);
          return;
        }

        try {
          // Step 1: Exchange authorization code for tokens
          setKycCallbackMessage('Exchanging authorization code...');
          const exchangeUrl = `${DEFAULT_KYC_FUNCTION_BASE_URL}/exchangeAuthorizationCode`;
          const exchangeBody = { code };
          if (pending.codeVerifier) exchangeBody.codeVerifier = pending.codeVerifier;

          const exchangeResp = await fetch(exchangeUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(exchangeBody),
          });
          const exchangeData = await exchangeResp.json().catch(() => ({}));

          if (!exchangeResp.ok || !exchangeData?.success) {
            throw new Error(exchangeData?.message || 'Token exchange failed.');
          }

          const accessToken = exchangeData?.data?.accessToken;
          if (!accessToken) {
            throw new Error('Token exchange succeeded but no access token received.');
          }

          // Step 2: Fetch user profile
          setKycCallbackMessage('Fetching DigiLocker profile...');
          const profileUrl = `${DEFAULT_KYC_FUNCTION_BASE_URL}/fetchUserProfile`;
          const profileResp = await fetch(profileUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken }),
          });
          const profileData = await profileResp.json().catch(() => ({}));

          const profile = profileData?.data?.profile || profileData?.data || {};
          const name = profile?.name || profile?.digilockerName || '';
          const dob = profile?.dob || profile?.dateOfBirth || '';

          // Store result for the parent (TenantOnboarding) window
          localStorage.setItem('digilocker_kyc_result', JSON.stringify({
            success: true,
            name,
            dob,
            verifiedAt: new Date().toISOString(),
          }));
          localStorage.removeItem(ONBOARDING_KYC_KEY);

          setKycCallbackStatus('success');
          setKycCallbackMessage('✅ DigiLocker verification successful! Closing...');
          if (window.opener && !window.opener.closed) {
            setTimeout(() => window.close(), 800);
          }
        } catch (err) {
          console.error('Onboarding KYC callback failed:', err);
          localStorage.setItem('digilocker_kyc_result', JSON.stringify({
            success: false,
            error: err?.message || 'Verification fail ho gaya.',
          }));
          localStorage.removeItem(ONBOARDING_KYC_KEY);
          setKycCallbackStatus('error');
          setKycCallbackMessage(err?.message || 'Verification failed.');
          if (window.opener && !window.opener.closed) {
            setTimeout(() => window.close(), 2000);
          }
        }
        return;
      }

      // ─── TENANT PORTAL FLOW: Requires tenantId ───
      if (!pending?.tenantId || !pending?.state) {
        setKycCallbackStatus('error');
        setKycCallbackMessage('KYC session missing. Please start verification again.');
        if (window.opener && !window.opener.closed) {
          localStorage.setItem('digilocker_kyc_result', JSON.stringify({ success: false, error: 'KYC session missing.' }));
          setTimeout(() => window.close(), 1500);
        } else {
          setTimeout(() => navigate('/tenant-portal', { replace: true }), 1500);
        }
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

  // Sync DigiLocker KYC data to tenant profile
  const syncDigiLockerDataToProfile = (kycData) => {
    if (!kycData) return;

    const updates = {};
    
    // Extract name from DigiLocker
    if (kycData.name) {
      const split = splitName(kycData.name);
      if (split.firstName && !tenantProfile.firstName) {
        updates.firstName = split.firstName;
      }
      if (split.lastName && !tenantProfile.lastName) {
        updates.lastName = split.lastName;
      }
    }

    // Extract Aadhaar number from DigiLocker (if available)
    if (kycData.aadhaar?.aadhaarNumber && !tenantProfile.aadharExtractedNumber) {
      updates.aadharExtractedNumber = kycData.aadhaar.aadhaarNumber;
      updates.aadharNumber = kycData.aadhaar.aadhaarNumber;
      updates.aadharDocStatus = 'verified';
      updates.aadharDocReason = 'Verified via DigiLocker';
    }

    // Update profile if we have any changes
    if (Object.keys(updates).length > 0) {
      console.log('📥 Syncing DigiLocker data to profile:', updates);
      setTenantProfile(prev => ({
        ...prev,
        ...updates
      }));
      
      // Auto-save profile with DigiLocker data
      if (tenant?.id) {
        const profileRef = doc(db, 'tenantProfiles', tenant.id);
        setDoc(profileRef, updates, { merge: true })
          .then(() => console.log('✅ DigiLocker data synced to profile'))
          .catch(err => console.error('❌ Failed to sync DigiLocker data:', err));
      }
    }
  };

  // Refresh tenant document from Firestore (used after KYC verification)
  const refreshTenantFromFirestore = async (currentTenantId) => {
    if (!currentTenantId) {
      console.warn('⚠️ Cannot refresh tenant: No tenant ID provided');
      return null;
    }

    try {
      console.log('🔄 Refreshing tenant data from Firestore for ID:', currentTenantId);
      
      const tenantDocRef = doc(db, 'tenants', currentTenantId);
      const tenantDocSnap = await getDoc(tenantDocRef);
      
      if (!tenantDocSnap.exists()) {
        console.error('❌ Tenant document not found:', currentTenantId);
        return null;
      }
      
      const refreshedTenantData = { id: tenantDocSnap.id, ...tenantDocSnap.data() };
      console.log('✅ Tenant data refreshed:', {
        id: refreshedTenantData.id,
        name: refreshedTenantData.name,
        kycVerified: refreshedTenantData.kyc?.verified || false,
        kycVerifiedAt: refreshedTenantData.kyc?.verifiedAt || null,
        hasAadhaar: !!refreshedTenantData.kyc?.aadhaar
      });
      
      setTenant(refreshedTenantData);
      
      // Sync DigiLocker KYC data to profile form
      if (refreshedTenantData.kyc) {
        syncDigiLockerDataToProfile(refreshedTenantData.kyc);
      }
      
      return refreshedTenantData;
    } catch (error) {
      console.error('❌ Error refreshing tenant data:', error);
      return null;
    }
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
      aadharFrontImage: '',
      aadharBackImage: '',
      aadharNumber: '',
      secondaryIdType: 'PAN',
      secondaryIdNumber: '',
      panNumber: '',
      panImage: '',
      dlImage: '',
      dlNumber: '',
      selfieImage: '',
      aadharDocStatus: 'not_uploaded',
      panDocStatus: 'not_uploaded',
      dlDocStatus: 'not_uploaded',
      aadharDocReason: '',
      panDocReason: '',
      dlDocReason: '',
      aadharNameMatched: false,
      panNameMatched: false,
      dlNameMatched: false,
      aadharExtractedNumber: '',
      panExtractedNumber: '',
      dlExtractedNumber: '',
      aadharDocConfidence: 0,
      panDocConfidence: 0,
      dlDocConfidence: 0,
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

  // This tenant's electricity rate: their per-tenant custom rate if set, else the
  // global rate. (Admins can set a custom ₹/unit for a specific tenant.)
  const effectiveElectricityRate = Number(tenant?.customElectricityRate) || globalElectricityRate;

  // Calculate electricity amount
  const calculateElectricity = (oldReading, currentReading) => {
    const units = Math.max(0, currentReading - oldReading);
    const ratePerUnit = effectiveElectricityRate;
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
    // Find the LAST PAYMENT where electricity was actually charged/billed (not just last month)
    const filteredRecords = roomNumber !== null
      ? paymentRecords.filter((record) => {
          // Must match room number
          if (String(record.roomNumber) !== String(roomNumber)) return false;
          
          // Must have electricity charged OR meter readings present
          const hasElectricityCharge = Number(record.electricity ?? record.electricityAmount ?? 0) > 0;
          const hasMeterReadings = Number(record.currentReading ?? record.meterReading ?? 0) > 0;
          
          return hasElectricityCharge || hasMeterReadings;
        })
      : [];
    
    const roomMatch = filteredRecords.length > 0
      ? filteredRecords.sort((a, b) => getMonthIndex(Number(b.year), Number(b.month)) - getMonthIndex(Number(a.year), Number(a.month)))[0]
      : null;

    const roomEntry = roomNumber !== null
      ? roomsData.find((entry) => String(entry.roomNumber) === String(roomNumber))
      : room;

    // Priority order: Last electricity payment reading > Room data > 0
    const candidateReadings = [
      roomMatch ? Number(roomMatch.currentReading ?? roomMatch.meterReading ?? roomMatch.oldReading ?? roomMatch.previousReading) : null,
      roomEntry?.currentReading,
      roomEntry?.previousReading,
      0
    ];

    const reading = candidateReadings
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value) && value >= 0);

    return Number.isFinite(reading) ? reading : 0;
  };

  // Prepare meter readings and open submit payment modal
  const handleOpenSubmitPayment = () => {
    console.log('\n🚀 Opening Submit Payment modal...');
    
    const prevReadings = {};
    const currReadings = {};
    
    // Calculate meter readings for all rooms
    roomsData.forEach((roomEntry) => {
      const roomNum = String(roomEntry.roomNumber);
      const previousReading = getLastMonthClosingReading(roomNum);
      prevReadings[roomNum] = previousReading;
      currReadings[roomNum] = 0; // Current reading starts at 0, user will input
      
      console.log(`  Room ${roomNum}: Previous Reading = ${previousReading}`);
    });
    
    console.log('📊 Meter readings prepared:', { prevReadings, currReadings });
    
    setPreviousMeterReadings(prevReadings);
    setCurrentMeterReadings(currReadings);
    setShowSubmitPayment(true);
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
          year: record.year,
          month: record.month,
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
          year: reading.year || (dateObj && !Number.isNaN(dateObj.getTime()) ? dateObj.getFullYear() : new Date().getFullYear()),
          month: reading.month || (dateObj && !Number.isNaN(dateObj.getTime()) ? dateObj.getMonth() + 1 : new Date().getMonth() + 1),
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

      // Use the best available payment date: paidDate (set by the app) first,
      // then paymentDate/paidAt. Records from 2026-03+ store it in paidDate, so
      // reading only paidAt hid the payment date for those months.
      const recordPaidDate = record.paidDate || record.paymentDate || record.paidAt;
      if (recordPaidDate && (!accumulator[key].paidAt || new Date(recordPaidDate) > new Date(accumulator[key].paidAt))) {
        accumulator[key].paidAt = recordPaidDate;
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
          <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl p-5 sm:p-6">
            {/* Logo/Header */}
            <div className="text-center mb-4">
                <div className="flex justify-end mb-1">
                  <button
                    type="button"
                    onClick={togglePortalLanguage}
                    className="px-3 py-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700"
                  >
                    {portalLanguage === 'en' ? '🇮🇳 हिंदी' : '🇬🇧 English'}
                  </button>
                </div>
              <div className="text-3xl sm:text-4xl mb-1">🏠</div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-800 mb-0.5">Tenant Portal</h1>
                <p className="text-sm text-gray-600">{t('Login to view your records', 'अपने रिकॉर्ड देखने के लिए लॉगिन करें')}</p>
            </div>

            {/* Login Form */}
            <form onSubmit={handleLogin} className="space-y-3">
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
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  {t('Room Number', 'रूम नंबर')}
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your room number (e.g., 101)"
                  className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  {t('Password', 'पासवर्ड')}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                className="w-full bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-bold py-2.5 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed text-sm touch-manipulation"
              >
                {loggingIn ? t('⏳ Logging in...', '⏳ लॉगिन हो रहा है...') : t('🔐 Login', '🔐 लॉगिन')}
              </button>
            </form>

            {/* Help Text */}
            <div className="mt-3 pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-500 text-center">
                {t(
                  'Your room number is your username. Contact property manager if you forgot your password.',
                  'आपका रूम नंबर ही आपका यूज़रनेम है। पासवर्ड भूलने पर प्रॉपर्टी मैनेजर से संपर्क करें।'
                )}
              </p>
            </div>

            {/* New Tenant Onboarding */}
            <div className="mt-3 pt-3 border-t border-gray-200 text-center">
              <p className="text-xs text-gray-500 mb-1.5">
                {t('New tenant? Complete KYC to get started.', 'नए किराएदार? KYC पूरा करके शुरू करें।')}
              </p>
              <button
                onClick={() => navigate('/onboarding')}
                className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded-lg text-sm transition-colors"
              >
                {t('🏠 New Tenant? Sign Up / Onboard', '🏠 नए किराएदार? रजिस्टर करें')}
              </button>
            </div>
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
            <div className="flex items-center gap-1.5 sm:gap-2">
              <LiveDateTime className="hidden sm:block" />
              {/* KYC status chip (red = incomplete, green = verified) */}
              {(() => {
                const kycProgress = getKycStepProgress();
                const kycDone = kycProgress.overall.stepsCompleted === kycProgress.overall.totalSteps;
                return (
                  <button
                    type="button"
                    onClick={() => navigate('/kyc')}
                    title={kycDone ? t('KYC Verified', 'KYC सत्यापित') : `KYC Incomplete (${kycProgress.overall.stepsCompleted}/${kycProgress.overall.totalSteps})`}
                    className={`font-semibold py-2 px-3 rounded-lg text-xs sm:text-sm whitespace-nowrap transition-colors ${kycDone ? 'bg-green-100 hover:bg-green-200 text-green-800' : 'bg-red-100 hover:bg-red-200 text-red-800'}`}
                  >
                    {kycDone ? '🟢 KYC' : '🔴 KYC'}
                  </button>
                );
              })()}
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
          <LiveDateTime className="sm:hidden mt-1" />
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
            {/* KYC status moved to the header chip (red/green) */}

            {/* Checkout Request Button - Show if tenant is active and hasn't requested checkout */}
            {tenant?.status !== 'checkout_requested' && tenant?.status !== 'inactive' && tenant?.isActive !== false && (
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">Planning to Move Out?</h3>
                    <p className="text-sm text-gray-600">Submit a checkout request to start the settlement process</p>
                  </div>
                  <button
                    onClick={() => setShowCheckoutRequest(true)}
                    className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-lg hover:from-orange-600 hover:to-red-600 transition-colors font-medium whitespace-nowrap"
                  >
                    Request Checkout
                  </button>
                </div>
              </div>
            )}

            {/* Checkout Request Pending Notice */}
            {tenant?.status === 'checkout_requested' && (
              <div className="bg-orange-50 border-2 border-orange-300 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="text-3xl">⏳</div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-orange-900 mb-1">Checkout Request Pending</h3>
                    <p className="text-sm text-orange-800">Your checkout request has been submitted and is awaiting admin approval.</p>
                    {tenant.proposedCheckoutDate && (
                      <p className="text-sm text-orange-700 mt-2">
                        <strong>Proposed Date:</strong> {new Date(tenant.proposedCheckoutDate).toLocaleDateString('en-IN')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

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

            {(() => {
              if (!paymentRecords || paymentRecords.length === 0) return null;
              const paidSet = new Set(
                paymentRecords
                  .filter((p) => p.status === 'paid' && p.year && p.month)
                  .map((p) => `${Number(p.year)}-${Number(p.month)}`)
              );
              const todayD = new Date();
              const curIdx = todayD.getFullYear() * 12 + todayD.getMonth();
              const ci = tenant?.checkInDate ? new Date(tenant.checkInDate) : null;
              const ciIdx = ci && !isNaN(ci.getTime()) ? ci.getFullYear() * 12 + ci.getMonth() : curIdx;
              const pendingMonths = [];
              for (let idx = Math.max(ciIdx, curIdx - 23); idx <= curIdx; idx++) {
                const y = Math.floor(idx / 12);
                const m = (idx % 12) + 1;
                if (!paidSet.has(`${y}-${m}`)) {
                  pendingMonths.push({ key: `${y}-${m}`, label: `${new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' })} ${y}` });
                }
              }
              if (pendingMonths.length === 0) return null;
              return (
                <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
                  <p className="text-sm font-bold text-amber-900">
                    ⚠️ {t(`${pendingMonths.length} month${pendingMonths.length > 1 ? 's' : ''} of rent pending`, `आपके ${pendingMonths.length} महीने का किराया बाकी है`)}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {pendingMonths.map((pm) => (
                      <span key={pm.key} className="text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300 rounded px-2 py-1">
                        {pm.label}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-amber-800 mt-2">
                    {t('Please clear these pending months to stay up to date.', 'कृपया इन बकाया महीनों का किराया जमा करें।')}
                  </p>
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

            {/* Old inline KYC section removed — now at /kyc page */}

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
                      <div className="mt-2 pt-2 border-t border-green-300">
                        <p className="text-[10px] text-green-700 flex items-center gap-1">
                          <span className="font-bold">⚡ Rate:</span>
                          <span className="bg-orange-500 text-white px-2 py-0.5 rounded font-bold">₹{effectiveElectricityRate}/unit</span>
                        </p>
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
                    onClick={handleOpenSubmitPayment}
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
                    Previous reading is auto-filled room-wise from last month closing readings (tenant cannot edit) | Rate: ₹{effectiveElectricityRate}/unit
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
                  <div className="flex items-center justify-between mb-2 sm:mb-3">
                    <h3 className="font-semibold text-yellow-900 text-sm sm:text-base">⚡ Electricity Meter</h3>
                    <div className="bg-orange-500 text-white px-3 py-1 rounded-lg shadow-sm">
                      <p className="text-xs font-bold">₹{effectiveElectricityRate}/unit</p>
                    </div>
                  </div>
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

            {/* History Tabs Section - Combined Payment & Meter History */}
            <div className="bg-white rounded-lg shadow-md overflow-hidden">
              {/* Tabs Header */}
              <div className="border-b border-gray-200">
                <div className="flex">
                  <button
                    onClick={() => setHistoryTab('payments')}
                    className={`flex-1 px-4 py-3 sm:px-6 sm:py-4 text-sm sm:text-base font-semibold transition-all ${
                      historyTab === 'payments'
                        ? 'bg-blue-500 text-white border-b-4 border-blue-700'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    💰 Payment History
                  </button>
                  <button
                    onClick={() => setHistoryTab('meters')}
                    className={`flex-1 px-4 py-3 sm:px-6 sm:py-4 text-sm sm:text-base font-semibold transition-all ${
                      historyTab === 'meters'
                        ? 'bg-blue-500 text-white border-b-4 border-blue-700'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    📚 Meter Reading
                  </button>
                </div>
              </div>

              {/* Tab Content */}
              <div className="p-4 sm:p-6">
                {/* Meter Reading History Tab */}
                {historyTab === 'meters' && (() => {
                  const fullTimeline = getMeterHistoryTimeline();
                  const roomTabs = (roomsData || []).map((entry) => String(entry.roomNumber));
                  const hasRoomTabs = roomTabs.length > 1;
                  const filteredTimeline = hasRoomTabs && selectedMeterRoomTab !== 'all'
                    ? fullTimeline.filter((entry) => String(entry.roomNumber) === String(selectedMeterRoomTab))
                    : fullTimeline;

                  // Calculate totals
                  const totalElectricityPaid = filteredTimeline.reduce((sum, entry) => sum + Number(entry.electricityAmount || 0), 0);
                  const totalUnits = filteredTimeline.reduce((sum, entry) => sum + Number(entry.unitsConsumed || 0), 0);

                  return (
                    <>
                      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-xl sm:text-2xl font-bold text-gray-800">📚 Meter Reading History</h2>
                          <span className="bg-orange-500 text-white px-3 py-1 rounded-lg shadow-md text-xs sm:text-sm font-bold">
                            ₹{effectiveElectricityRate}/unit
                          </span>
                        </div>
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

                      {/* Summary Cards */}
                      {filteredTimeline.length > 0 && (
                        <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Card 1: Total Electricity Paid */}
                          <div className="bg-gradient-to-br from-yellow-500 to-orange-500 text-white rounded-lg p-4 shadow-md">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-2xl">⚡</span>
                              <p className="text-xs font-semibold opacity-90">Total Electricity Paid</p>
                            </div>
                            <p className="text-2xl font-bold">₹{totalElectricityPaid.toLocaleString('en-IN')}</p>
                            <p className="text-xs opacity-80 mt-1">Till Date</p>
                          </div>

                          {/* Card 2: Total Units Consumed */}
                          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-lg p-4 shadow-md">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-2xl">🔌</span>
                              <p className="text-xs font-semibold opacity-90">Total Units Consumed</p>
                            </div>
                            <p className="text-2xl font-bold">{totalUnits.toLocaleString('en-IN')} kWh</p>
                            <p className="text-xs opacity-80 mt-1">Till Date</p>
                          </div>
                        </div>
                      )}

                      {filteredTimeline.length === 0 ? (
                        <div className="text-center py-6 bg-gray-50 rounded-lg">
                          <p className="text-sm text-gray-600">No meter history available yet.</p>
                        </div>
                      ) : (() => {
                        // Group meter readings by year and month
                        const metersByYear = filteredTimeline.reduce((acc, entry) => {
                          const year = entry.year || new Date().getFullYear();
                          if (!acc[year]) {
                            acc[year] = [];
                          }
                          acc[year].push(entry);
                          return acc;
                        }, {});

                        // Sort years in descending order (latest first)
                        const sortedYears = Object.keys(metersByYear).sort((a, b) => Number(b) - Number(a));

                        return (
                          <div className="space-y-4">
                            {sortedYears.map((year) => (
                              <div key={`meter_year_${year}`} className="space-y-2">
                                {/* Year Header */}
                                <div className="sticky top-0 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-4 py-2 rounded-lg shadow-md z-10">
                                  <div className="flex items-center justify-between">
                                    <h3 className="text-base sm:text-lg font-bold">⚡ Year {year}</h3>
                                    <span className="text-xs sm:text-sm bg-white/20 px-2 py-1 rounded">
                                      {metersByYear[year].length} reading{metersByYear[year].length !== 1 ? 's' : ''}
                                    </span>
                                  </div>
                                </div>

                                {/* Year's Meter Reading Cards */}
                                <div className="space-y-2">
                                  {metersByYear[year].map((entry) => (
                                    <div 
                                      key={entry.id} 
                                      className="border-2 border-indigo-200 bg-indigo-50 rounded-lg p-3"
                                    >
                                      {/* Card Header */}
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                          <span className="text-lg">⚡</span>
                                          <div>
                                            <p className="text-sm font-bold text-indigo-900 bg-indigo-200 px-2 py-1 rounded inline-block">
                                              {entry.monthLabel}
                                            </p>
                                            <p className="text-xs text-gray-600 mt-1">
                                              Room {entry.roomNumber || '-'}
                                            </p>
                                          </div>
                                        </div>
                                        <div className="text-right">
                                          <div className="flex items-center justify-end gap-2">
                                            <p className="text-base font-bold text-indigo-900">₹{Number(entry.electricityAmount || 0).toFixed(2)}</p>
                                            <p className="text-[9px] text-orange-700 font-semibold bg-orange-100 px-1.5 py-0.5 rounded whitespace-nowrap">
                                              {entry.unitsConsumed} Units × ₹{effectiveElectricityRate}
                                            </p>
                                          </div>
                                          <p className="text-[10px] text-gray-500 mt-1">
                                            {entry.source === 'meter_reading' ? 'meter record' : 'payment history'}
                                          </p>
                                        </div>
                                      </div>

                                      {/* Meter Details Grid */}
                                      <div className="grid grid-cols-3 gap-2">
                                        <div className="bg-white/70 rounded p-2">
                                          <p className="text-[10px] text-gray-600">Previous</p>
                                          <p className="text-sm font-mono font-bold text-gray-800">{entry.previousReading}</p>
                                        </div>
                                        <div className="bg-white/70 rounded p-2">
                                          <p className="text-[10px] text-gray-600">Current</p>
                                          <p className="text-sm font-mono font-bold text-gray-800">{entry.currentReading}</p>
                                        </div>
                                        <div className="bg-white/70 rounded p-2">
                                          <p className="text-[10px] text-gray-600">Units</p>
                                          <p className="text-sm font-bold text-indigo-900">{entry.unitsConsumed}</p>
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </>
                  );
                })()}

                {/* Payment History Tab */}
                {historyTab === 'payments' && (() => {
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
                        const paidWithElectricity = monthlyPaymentGroups.filter((group) => group.status === 'paid' && Number(group.totalElectricity || 0) > 0);
                        const lastElectricityPaid = paidWithElectricity[0] || null;
                        
                        return (
                          <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {/* Card 1: Total Rent Paid */}
                            <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-lg p-4 shadow-md">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-2xl">🏠</span>
                                <p className="text-xs font-semibold opacity-90">Total Rent Paid</p>
                              </div>
                              <p className="text-2xl font-bold">₹{summary.rentPaid.toLocaleString('en-IN')}</p>
                              <p className="text-xs opacity-80 mt-1">Till Date</p>
                            </div>

                            {/* Card 2: Total Electricity Paid */}
                            <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-lg p-4 shadow-md">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-2xl">⚡</span>
                                <p className="text-xs font-semibold opacity-90">Total Electricity Paid</p>
                              </div>
                              <p className="text-2xl font-bold">₹{summary.electricityPaid.toLocaleString('en-IN')}</p>
                              <p className="text-xs opacity-80 mt-1">Till Date</p>
                            </div>

                            {/* Card 3: Last Month Paid */}
                            <div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-lg p-4 shadow-md">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="text-2xl">✅</span>
                                <p className="text-xs font-semibold opacity-90">Last Rent+Elec Paid</p>
                              </div>
                              <p className="text-lg font-bold">
                                {lastElectricityPaid
                                  ? `${getMonthName(lastElectricityPaid.month)} ${lastElectricityPaid.year}`
                                  : 'Not Yet'}
                              </p>
                              <p className="text-xs opacity-80 mt-1">
                                {lastElectricityPaid
                                  ? `₹${lastElectricityPaid.totalAmount.toLocaleString('en-IN')}`
                                  : 'No payment with electricity'}
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
              ) : (() => {
                // Group payments by year
                const paymentsByYear = monthlyPaymentGroups.reduce((acc, group) => {
                  const year = group.year;
                  if (!acc[year]) {
                    acc[year] = [];
                  }
                  acc[year].push(group);
                  return acc;
                }, {});

                // Sort years in descending order (latest first)
                const sortedYears = Object.keys(paymentsByYear).sort((a, b) => Number(b) - Number(a));

                return (
                  <div className="space-y-4">
                    {sortedYears.map((year) => (
                      <div key={`year_${year}`} className="space-y-2">
                        {/* Year Header */}
                        <div className="sticky top-0 bg-gradient-to-r from-gray-700 to-gray-800 text-white px-4 py-2 rounded-lg shadow-md z-10">
                          <div className="flex items-center justify-between">
                            <h3 className="text-base sm:text-lg font-bold">📅 Year {year}</h3>
                            <span className="text-xs sm:text-sm bg-white/20 px-2 py-1 rounded">
                              {paymentsByYear[year].length} month{paymentsByYear[year].length !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </div>

                        {/* Year's Payment Cards */}
                        <div className="space-y-2">
                          {paymentsByYear[year].map((group) => {
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
                        {/* Compact Header - Always Visible (single row; facts fill the empty middle) */}
                        <div
                          onClick={() => toggleCard(groupCardId)}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3"
                        >
                          {/* Month + status */}
                          <div className="flex items-center gap-2 min-w-0 order-1 sm:w-52 sm:flex-shrink-0">
                            <span className="text-xl flex-shrink-0">
                              {isRentElectricityPaid ? '✅' : isOnlyRentPaid ? '⚠️' : isPaid ? '✅' : isPending ? '⏳' : '❌'}
                            </span>
                            <div className="min-w-0">
                              <h3 className="text-sm sm:text-base font-bold text-gray-800 truncate">
                                {getMonthName(group.month)} {group.year}
                              </h3>
                              <p className="text-xs text-gray-600 truncate">
                                {paymentTypeText}
                              </p>
                            </div>
                          </div>

                          {/* Quick facts — fixed-width columns so they line up across rows; wrap below on mobile */}
                          <div className="order-3 sm:order-2 w-full sm:w-auto sm:flex-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
                            <span className="sm:w-28"><span className="text-gray-500">Rent </span><span className="font-semibold text-gray-800">₹{Number(group.totalRent || 0).toLocaleString('en-IN')}</span></span>
                            <span className="sm:w-36"><span className="text-gray-500">Electricity </span><span className="font-semibold text-gray-800">₹{Number(group.totalElectricity || 0).toLocaleString('en-IN')}</span></span>
                            {group.paidAt && isPaid && (
                              <span className="sm:w-40"><span className="text-gray-500">Paid </span><span className="font-semibold text-green-700">{new Date(group.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span></span>
                            )}
                          </div>

                          {/* Total + arrow */}
                          <div className="flex items-center gap-2 flex-shrink-0 ml-auto order-2 sm:order-3">
                            <p className="text-base sm:text-lg font-bold text-gray-900">₹{total.toLocaleString('en-IN')}</p>
                            <span className="text-gray-400 text-xl">
                              {isExpanded ? '▼' : '▶'}
                            </span>
                          </div>
                        </div>
                        
                        {/* Expanded Details - Show on Click (compact) */}
                        {isExpanded && (
                          <div className="px-3 pb-2 pt-2 border-t border-gray-200 space-y-2 text-xs">
                            {isOnlyRentPaid && (
                              <div className="bg-amber-50 border border-amber-200 rounded px-2 py-1 font-semibold text-amber-900">
                                ⚠️ Rent received for this month. Electricity still pending.
                              </div>
                            )}

                            {/* Payment method (rent, electricity & paid date are in the header) */}
                            {group.records.some((recordItem) => recordItem.paymentMethod) && isPaid && (
                              <p><span className="text-gray-500">Method: </span><span className="font-semibold text-gray-800">💳 {group.records.find((recordItem) => recordItem.paymentMethod)?.paymentMethod}</span></p>
                            )}

                            {/* Room-wise — only when there is more than one room */}
                            {group.records.length > 1 && (
                              <div className="bg-indigo-50 border border-indigo-200 rounded px-2 py-1">
                                <p className="font-semibold text-indigo-900 mb-1">🏠 Room-wise</p>
                                <div className="space-y-1">
                                  {group.records.map((recordItem) => (
                                    <div key={`room_break_${recordItem.id}`} className="grid grid-cols-4 gap-2 bg-white/70 rounded px-2 py-0.5">
                                      <span className="font-semibold text-indigo-900">Room {recordItem.roomNumber || '-'}</span>
                                      <span>Rent ₹{Number(recordItem.rent || 0).toFixed(0)}</span>
                                      <span>Elec ₹{Number(recordItem.electricity || 0).toFixed(0)}</span>
                                      <span className="font-semibold">₹{(Number(recordItem.rent || 0) + Number(recordItem.electricity || 0)).toFixed(0)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Meter Readings */}
                            {group.records.some((recordItem) => recordItem.oldReading || recordItem.currentReading || recordItem.units) && (
                              <div className="bg-yellow-50 border border-yellow-200 rounded px-2 py-1">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="font-semibold text-yellow-900">⚡ Meter</p>
                                  <span className="text-[10px] font-bold text-orange-700 bg-orange-200 px-1.5 py-0.5 rounded">@₹{effectiveElectricityRate}/unit</span>
                                </div>
                                <div className="space-y-1">
                                  {group.records.map((recordItem) => (
                                    <div key={`meter_${recordItem.id}`} className="grid grid-cols-4 gap-2 bg-white/70 rounded px-2 py-0.5">
                                      <span className="font-semibold text-yellow-900">R{recordItem.roomNumber || '-'}</span>
                                      <span>Prev {recordItem.oldReading || 0}</span>
                                      <span>Curr {recordItem.currentReading || 0}</span>
                                      <span>Units {recordItem.units || recordItem.unitsConsumed || 0}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Notes */}
                            {group.notes && (
                              <p><span className="text-gray-500">📝 Note: </span><span className="italic text-gray-700">{group.notes}</span></p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
                    </>
                  );
                })()}
              </div>
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
            electricityRate={effectiveElectricityRate}
            language={portalLanguage}
            previousMeterReadings={previousMeterReadings}
            currentMeterReadings={currentMeterReadings}
            onClose={() => setShowSubmitPayment(false)}
            onSuccess={() => {
              // Reload tenant data after successful submission
              setShowSubmitPayment(false);
              // Optionally refresh data here
            }}
          />
        )}

        {/* Checkout Request Modal */}
        {showCheckoutRequest && (
          <TenantCheckoutRequest
            tenant={tenant}
            room={room}
            onClose={() => setShowCheckoutRequest(false)}
            onSuccess={() => {
              setShowCheckoutRequest(false);
              setToast({ type: 'success', message: '✅ Checkout request submitted successfully! Admin will review it soon.' });
              // Reload tenant data to update checkout status
              if (tenant?.id) {
                getDoc(doc(db, 'tenants', tenant.id)).then(docSnap => {
                  if (docSnap.exists()) {
                    setTenant({ id: docSnap.id, ...docSnap.data() });
                  }
                });
              }
            }}
          />
        )}
      </div>
    </div>
  );
};

export default TenantPortal;
