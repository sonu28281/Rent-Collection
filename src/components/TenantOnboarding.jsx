import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../firebase';
import { collection, addDoc, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import Tesseract from 'tesseract.js';
import { Html5Qrcode } from 'html5-qrcode';
import { parseAadhaarQr, crossVerify, formatQrDataForDisplay, maskAadhaar } from '../utils/aadhaarQrParser';
import { scanDocument } from '../utils/documentScanner';

// ─── TENANT ONBOARDING / KYC PAGE ──────────────────────────────────────────
// 
// Two modes:
// 1. Standalone (/onboarding) — Public, no login. Saves to `tenantApplications`.
// 2. Tenant mode (/kyc) — Logged-in tenant. Saves to `tenantProfiles`.
//
// 4-step flow:
// Step 1: Basic Details
// Step 2: Aadhaar QR Scan (MANDATORY)
// Step 3: Document Upload + OCR + Cross-Verify
// Step 4: Agreement + Signature
// ────────────────────────────────────────────────────────────────────────────

const TenantOnboarding = ({ mode = 'standalone', tenantData = null, onComplete = null }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const ref = searchParams.get('ref') || '';

  // ─── STATE ──────────────────────────────────────────────────────────────

  const [currentStep, setCurrentStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  // Step 1: Basic Details
  const [formData, setFormData] = useState({
    firstName: tenantData?.name ? tenantData.name.split(' ')[0] : '',
    lastName: tenantData?.name ? tenantData.name.split(' ').slice(1).join(' ') : '',
    phone: tenantData?.phone || '',
    emergencyContact: '',
    occupation: '',
  });

  // Step 2: Aadhaar QR
  const [qrScanning, setQrScanning] = useState(false);
  const [qrScanned, setQrScanned] = useState(false);
  const [qrData, setQrData] = useState(null);
  const [qrError, setQrError] = useState('');
  const [qrDisplayData, setQrDisplayData] = useState(null);
  const qrScannerRef = useRef(null);
  const qrRegionRef = useRef(null);

  // Step 3: Documents
  const [documents, setDocuments] = useState({
    aadharFrontImage: '',
    aadharBackImage: '',
    aadharNumber: '',
    aadharExtractedNumber: '',
    aadharDocStatus: 'not_uploaded',
    aadharDocReason: '',
    aadharNameMatched: false,
    aadharDocConfidence: 0,
    secondaryIdType: 'PAN',
    secondaryIdNumber: '',
    panImage: '',
    panExtractedNumber: '',
    panDocStatus: 'not_uploaded',
    panDocReason: '',
    panNameMatched: false,
    panDocConfidence: 0,
    dlImage: '',
    dlExtractedNumber: '',
    dlDocStatus: 'not_uploaded',
    dlDocReason: '',
    dlNameMatched: false,
    dlDocConfidence: 0,
    selfieImage: '',
  });
  const [ocrProcessing, setOcrProcessing] = useState('');
  const [crossVerification, setCrossVerification] = useState(null);

  // Step 4: Agreement
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [signature, setSignature] = useState('');
  const [signedAt, setSignedAt] = useState(null);
  const [isSigning, setIsSigning] = useState(false);
  const signatureCanvasRef = useRef(null);

  // ─── HELPERS ────────────────────────────────────────────────────────────

  const showToast = (msg, type = 'info') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const toDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const normalizeDocText = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const normalizeAadhar = (v) => String(v || '').replace(/\D/g, '').slice(0, 12);
  const normalizePan = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const normalizeDl = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

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

  const getExpectedNameTokens = useCallback(() => {
    const fullName = `${formData.firstName} ${formData.lastName}`.trim();
    return fullName
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
  }, [formData.firstName, formData.lastName]);

  // ─── STEP VALIDATION ───────────────────────────────────────────────────

  const isStep1Complete = formData.firstName && formData.lastName && formData.phone && formData.occupation;
  const isStep2Complete = qrScanned && qrData?.success;
  const isStep3Complete = documents.aadharFrontImage && documents.aadharBackImage && documents.selfieImage
    && (documents.secondaryIdType === 'PAN' ? documents.panImage : documents.dlImage);
  const isStep4Complete = agreementAccepted && signature;

  // ─── QR SCANNER ─────────────────────────────────────────────────────────

  const startQrScanner = async () => {
    setQrError('');
    setQrScanning(true);

    try {
      const regionId = 'qr-reader-region';
      // Small delay for DOM
      await new Promise((r) => setTimeout(r, 300));
      
      const scanner = new Html5Qrcode(regionId);
      qrScannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          // QR code scanned successfully
          handleQrResult(decodedText);
          stopQrScanner();
        },
        () => {
          // Scan failed (no QR in frame) — ignore, keep scanning
        }
      );
    } catch (err) {
      console.error('QR Scanner error:', err);
      setQrError(
        err?.message?.includes('Permission')
          ? '❌ Camera permission denied. Please allow camera access and try again.'
          : `❌ Camera error: ${err?.message || 'Unknown error'}. Try uploading a QR image instead.`
      );
      setQrScanning(false);
    }
  };

  const stopQrScanner = async () => {
    try {
      if (qrScannerRef.current) {
        await qrScannerRef.current.stop();
        qrScannerRef.current.clear();
        qrScannerRef.current = null;
      }
    } catch {
      // Ignore stop errors
    }
    setQrScanning(false);
  };

  const handleQrImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setQrError('');
    try {
      const regionId = 'qr-reader-region-upload';
      const scanner = new Html5Qrcode(regionId);
      const result = await scanner.scanFile(file, true);
      scanner.clear();
      handleQrResult(result);
    } catch (err) {
      setQrError('❌ Could not read QR code from image. Make sure the QR code is clearly visible.');
    }
  };

  const handleQrResult = (rawText) => {
    const parsed = parseAadhaarQr(rawText);

    if (parsed.success) {
      setQrData(parsed);
      setQrScanned(true);
      setQrDisplayData(formatQrDataForDisplay(parsed));
      showToast('✅ Aadhaar QR scanned successfully!', 'success');

      // Auto-fill form if name is from QR
      if (parsed.name) {
        const parts = parsed.name.split(/\s+/);
        setFormData((prev) => ({
          ...prev,
          firstName: prev.firstName || parts[0] || '',
          lastName: prev.lastName || parts.slice(1).join(' ') || '',
        }));
      }
    } else {
      setQrError(parsed.error || '❌ Failed to parse QR code data.');
      setQrScanned(false);
    }
  };

  const resetQrScan = () => {
    stopQrScanner();
    setQrData(null);
    setQrScanned(false);
    setQrDisplayData(null);
    setQrError('');
    setCrossVerification(null);
  };

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (qrScannerRef.current) {
        try {
          qrScannerRef.current.stop();
          qrScannerRef.current.clear();
        } catch { /* ignore */ }
      }
    };
  }, []);

  // ─── DOCUMENT UPLOAD + OCR ──────────────────────────────────────────────

  const openCameraForField = (field, facing = 'environment') => {
    // Create a hidden file input with capture attribute to open camera directly
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // 'capture' attribute tells mobile browsers to open camera:
    // 'environment' = rear camera, 'user' = front camera (selfie)
    input.setAttribute('capture', facing);
    input.style.display = 'none';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) handleDocumentUpload(field, file);
      input.remove();
    };
    document.body.appendChild(input);
    // Small delay ensures the input is in the DOM before clicking
    setTimeout(() => input.click(), 50);
  };

  const handleDocumentUpload = async (field, file) => {
    if (!file) return;
    try {
      const rawDataUrl = await toDataUrl(file);
      const isSelfie = field === 'selfieImage';
      const scannedUrl = await scanDocument(rawDataUrl, { isSelfie });

      setDocuments((prev) => ({ ...prev, [field]: scannedUrl }));

      // Trigger OCR for document fields
      if (field === 'aadharFrontImage') {
        runOcrVerification('aadhar', scannedUrl);
      } else if (field === 'panImage') {
        runOcrVerification('pan', scannedUrl);
      } else if (field === 'dlImage') {
        runOcrVerification('dl', scannedUrl);
      }
    } catch (err) {
      console.error('File read error:', err);
      showToast('❌ Failed to read file', 'error');
    }
  };

  const runOcrVerification = async (docType, imageUrl) => {
    setOcrProcessing(docType);
    setDocuments((prev) => ({
      ...prev,
      ...(docType === 'aadhar' ? { aadharDocStatus: 'checking', aadharDocReason: 'OCR analyzing...' } : {}),
      ...(docType === 'pan' ? { panDocStatus: 'checking', panDocReason: 'OCR analyzing...' } : {}),
      ...(docType === 'dl' ? { dlDocStatus: 'checking', dlDocReason: 'OCR analyzing...' } : {}),
    }));

    try {
      const ocrResult = await Tesseract.recognize(imageUrl, 'eng');
      const rawText = String(ocrResult?.data?.text || '');
      const confidence = Number(ocrResult?.data?.confidence || 0);
      const normalizedText = normalizeDocText(rawText);
      const expectedTokens = getExpectedNameTokens();
      const nameMatched = expectedTokens.length === 0 || expectedTokens.every((t) => normalizedText.includes(t));

      const extractedNumber = docType === 'aadhar'
        ? extractAadharNumberFromText(rawText)
        : docType === 'pan'
          ? extractPanFromText(rawText)
          : extractDlFromText(rawText);

      const expectedNumber = docType === 'pan'
        ? normalizePan(documents.secondaryIdNumber)
        : docType === 'dl'
          ? normalizeDl(documents.secondaryIdNumber)
          : normalizeAadhar(documents.aadharNumber);

      let status = 'verified';
      let reason = '✅ Document verified successfully.';

      if (!extractedNumber) {
        status = 'number_not_found';
        reason = `${docType === 'aadhar' ? 'Aadhaar' : docType === 'pan' ? 'PAN' : 'DL'} number not detected. Upload a clearer image.`;
      } else if ((docType === 'pan' || docType === 'dl') && expectedNumber && expectedNumber !== extractedNumber) {
        status = 'number_mismatch';
        reason = 'Document number doesn\'t match entered number.';
      } else if (!nameMatched) {
        status = 'name_mismatch';
        reason = 'Name on document doesn\'t match your entered name.';
      }

      setDocuments((prev) => ({
        ...prev,
        ...(docType === 'aadhar' ? {
          aadharDocStatus: status,
          aadharDocReason: reason,
          aadharExtractedNumber: extractedNumber,
          aadharNameMatched: nameMatched,
          aadharDocConfidence: confidence,
          aadharNumber: extractedNumber || prev.aadharNumber,
        } : {}),
        ...(docType === 'pan' ? {
          panDocStatus: status,
          panDocReason: reason,
          panExtractedNumber: extractedNumber,
          panNameMatched: nameMatched,
          panDocConfidence: confidence,
        } : {}),
        ...(docType === 'dl' ? {
          dlDocStatus: status,
          dlDocReason: reason,
          dlExtractedNumber: extractedNumber,
          dlNameMatched: nameMatched,
          dlDocConfidence: confidence,
        } : {}),
      }));

      // Cross-verify with QR data
      if (qrData?.success && docType === 'aadhar') {
        const verification = crossVerify(
          qrData,
          { name: rawText, aadhaarNumber: extractedNumber },
          { firstName: formData.firstName, lastName: formData.lastName }
        );
        setCrossVerification(verification);
      }
    } catch (err) {
      console.error(`OCR failed for ${docType}:`, err);
      setDocuments((prev) => ({
        ...prev,
        ...(docType === 'aadhar' ? { aadharDocStatus: 'error', aadharDocReason: 'OCR failed. Upload clearer image.' } : {}),
        ...(docType === 'pan' ? { panDocStatus: 'error', panDocReason: 'OCR failed.' } : {}),
        ...(docType === 'dl' ? { dlDocStatus: 'error', dlDocReason: 'OCR failed.' } : {}),
      }));
    } finally {
      setOcrProcessing('');
    }
  };

  // ─── SIGNATURE ──────────────────────────────────────────────────────────

  const getCanvasPoint = (event) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (event.touches?.[0]) {
      return { x: event.touches[0].clientX - rect.left, y: event.touches[0].clientY - rect.top };
    }
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const startSignatureDraw = (e) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const pt = getCanvasPoint(e);
    if (!pt) return;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111827';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    setIsSigning(true);
  };

  const moveSignatureDraw = (e) => {
    if (!isSigning) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const pt = getCanvasPoint(e);
    if (!pt) return;
    canvas.getContext('2d').lineTo(pt.x, pt.y);
    canvas.getContext('2d').stroke();
  };

  const stopSignatureDraw = () => {
    if (!isSigning) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    setIsSigning(false);
    const dataUrl = canvas.toDataURL('image/png');
    setSignature(dataUrl);
    setSignedAt(new Date().toISOString());
  };

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setSignature('');
    setSignedAt(null);
  };

  // ─── SAVE / SUBMIT ─────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!isStep1Complete || !isStep2Complete || !isStep3Complete || !isStep4Complete) {
      showToast('❌ Please complete all steps before submitting.', 'error');
      return;
    }

    setSaving(true);
    try {
      const fullName = `${formData.firstName} ${formData.lastName}`.trim();

      const payload = {
        // Basic Info
        fullName,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone,
        emergencyContact: formData.emergencyContact,
        occupation: formData.occupation,
        dob: qrData?.dob || '',
        gender: qrData?.gender || '',
        address: qrData?.fullAddress || '',

        // Aadhaar QR Data
        aadhaarQr: {
          scanned: true,
          rawData: qrData?.rawData || '',
          qrType: qrData?.qrType || '',
          name: qrData?.name || '',
          uid: qrData?.uid || '',
          dob: qrData?.dob || '',
          gender: qrData?.gender || '',
          address: qrData?.address || {},
          photo: qrData?.photo || null,
          scannedAt: qrData?.scannedAt || '',
        },

        // Documents
        aadharFrontImage: documents.aadharFrontImage,
        aadharBackImage: documents.aadharBackImage,
        aadharNumber: documents.aadharExtractedNumber || documents.aadharNumber,
        aadharDocStatus: documents.aadharDocStatus,
        aadharDocReason: documents.aadharDocReason,
        aadharNameMatched: documents.aadharNameMatched,
        aadharDocConfidence: documents.aadharDocConfidence,
        secondaryIdType: documents.secondaryIdType,
        secondaryIdNumber: documents.secondaryIdNumber,
        panImage: documents.panImage,
        panExtractedNumber: documents.panExtractedNumber,
        panDocStatus: documents.panDocStatus,
        dlImage: documents.dlImage,
        dlExtractedNumber: documents.dlExtractedNumber,
        dlDocStatus: documents.dlDocStatus,
        selfieImage: documents.selfieImage,

        // Cross-verification
        crossVerification: crossVerification || {
          overallStatus: 'pending',
          flags: [],
        },

        // Agreement
        agreementAccepted,
        agreementSignature: signature,
        agreementSignedAt: signedAt,

        // Meta
        submittedAt: new Date().toISOString(),
        source: mode === 'tenant' ? 'tenant_portal' : 'onboarding_link',
        ref: ref || null,
      };

      if (mode === 'tenant' && tenantData?.id) {
        // Save to existing tenant's profile
        payload.tenantId = tenantData.id;
        payload.roomNumber = tenantData.roomNumber || null;
        payload.updatedAt = new Date().toISOString();

        await setDoc(doc(db, 'tenantProfiles', tenantData.id), payload, { merge: true });

        // Update tenant's kycStatus
        await setDoc(doc(db, 'tenants', tenantData.id), {
          kycStatus: 'completed',
        }, { merge: true });

        showToast('✅ KYC completed successfully!', 'success');

        if (onComplete) {
          onComplete();
        } else {
          setTimeout(() => navigate('/tenant-portal'), 1500);
        }
      } else {
        // Save to tenantApplications (new tenant)
        payload.status = 'pending_approval';
        payload.reviewedAt = null;
        payload.reviewedBy = null;
        payload.assignedTenantId = null;
        payload.notes = '';

        await addDoc(collection(db, 'tenantApplications'), payload);

        showToast('✅ Application submitted! Admin will review and assign your room.', 'success');
        setCurrentStep(5); // Show success screen
      }
    } catch (err) {
      console.error('Submit error:', err);
      showToast('❌ Failed to submit. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── STEP PROGRESS BAR ─────────────────────────────────────────────────

  const steps = [
    { num: 1, label: 'Details', icon: '📝', complete: !!isStep1Complete },
    { num: 2, label: 'Aadhaar QR', icon: '📷', complete: !!isStep2Complete },
    { num: 3, label: 'Documents', icon: '📄', complete: !!isStep3Complete },
    { num: 4, label: 'Agreement', icon: '✅', complete: !!isStep4Complete },
  ];

  // ─── RENDER ─────────────────────────────────────────────────────────────

  // Success Screen (after standalone submission)
  if (currentStep === 5) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-green-800 mb-2">Application Submitted!</h1>
          <p className="text-gray-600 mb-4">
            Your KYC onboarding application has been submitted successfully. 
            The admin will review your documents and assign you a room.
          </p>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
            <p className="text-sm text-green-800 font-semibold">📱 You will receive a call/message once approved.</p>
          </div>
          <p className="text-xs text-gray-500">You can close this page now.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-semibold
          ${toast.type === 'success' ? 'bg-green-600 text-white' : toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            {/* DigiLocker Official Logo */}
            <img
              src="https://www.digilocker.gov.in/assets/img/digilocker_logo.png"
              alt="DigiLocker"
              className="h-10 w-auto"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900">
                {mode === 'tenant' ? '🛡️ Complete Your KYC' : '🏠 Tenant Onboarding'}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {mode === 'tenant'
                  ? 'Complete KYC verification to activate your account.'
                  : 'Fill details, scan Aadhaar, upload documents, and sign agreement.'}
              </p>
            </div>
          </div>
          {/* DigiLocker Trust Badge */}
          <div className="mt-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="text-lg">🔐</span>
            <div>
              <p className="text-xs font-semibold text-blue-900">Powered by DigiLocker — Government of India</p>
              <p className="text-[10px] text-blue-700">Your identity is verified securely via UIDAI & DigiLocker (digilocker.gov.in). No data is shared with third parties.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Back to Login — below header, clean placement */}
      <div className="max-w-2xl mx-auto px-4 pt-3">
        <button
          onClick={() => navigate('/login')}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 font-medium transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Already have an account? <span className="underline">Login</span>
        </button>
      </div>

      {/* Step Progress */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-6">
          {steps.map((step, i) => (
            <React.Fragment key={step.num}>
              <button
                onClick={() => {
                  // Allow going back, but forward only if prev steps done
                  if (step.num <= currentStep || steps.slice(0, step.num - 1).every((s) => s.complete)) {
                    setCurrentStep(step.num);
                  }
                }}
                className={`flex flex-col items-center gap-1 transition-all ${
                  currentStep === step.num
                    ? 'scale-110'
                    : step.complete
                      ? 'opacity-80'
                      : 'opacity-40'
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold border-2
                  ${currentStep === step.num
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : step.complete
                      ? 'border-green-500 bg-green-50 text-green-600'
                      : 'border-gray-300 bg-gray-50 text-gray-400'
                  }`}>
                  {step.complete ? '✓' : step.icon}
                </div>
                <span className={`text-[10px] font-semibold ${currentStep === step.num ? 'text-blue-700' : 'text-gray-500'}`}>
                  {step.label}
                </span>
              </button>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${steps[i].complete ? 'bg-green-400' : 'bg-gray-200'}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-2xl shadow-lg p-4 sm:p-6">

          {/* ── STEP 1: Basic Details ── */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border-2 border-blue-300 rounded-xl p-4">
                <h2 className="text-lg font-bold text-blue-900 mb-1">📝 Step 1: Basic Details</h2>
                <p className="text-sm text-blue-700">Fill in your personal information.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">First Name *</label>
                  <input
                    type="text"
                    value={formData.firstName}
                    onChange={(e) => setFormData((p) => ({ ...p, firstName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"
                    placeholder="Rahul"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Last Name *</label>
                  <input
                    type="text"
                    value={formData.lastName}
                    onChange={(e) => setFormData((p) => ({ ...p, lastName: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"
                    placeholder="Kumar"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Phone Number *</label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"
                  placeholder="9876543210"
                  maxLength={10}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Emergency Contact</label>
                <input
                  type="tel"
                  value={formData.emergencyContact}
                  onChange={(e) => setFormData((p) => ({ ...p, emergencyContact: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"
                  placeholder="8765432109"
                  maxLength={10}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Occupation *</label>
                <input
                  type="text"
                  value={formData.occupation}
                  onChange={(e) => setFormData((p) => ({ ...p, occupation: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 focus:outline-none"
                  placeholder="Software Engineer, Student, etc."
                />
              </div>

              {/* QR auto-filled info */}
              {qrDisplayData && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-green-800 mb-1">✅ Auto-filled from Aadhaar QR:</p>
                  <p className="text-xs text-green-700">Name: {qrDisplayData.name}</p>
                  {qrData?.dob && <p className="text-xs text-green-700">DOB: {qrData.dob}</p>}
                  {qrData?.gender && <p className="text-xs text-green-700">Gender: {qrDisplayData.gender}</p>}
                </div>
              )}

              <button
                onClick={() => setCurrentStep(2)}
                disabled={!isStep1Complete}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg text-sm transition-colors"
              >
                Next → Scan Aadhaar QR
              </button>
            </div>
          )}

          {/* ── STEP 2: Aadhaar QR Scan ── */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-300 rounded-xl p-4">
                <h2 className="text-lg font-bold text-orange-900 mb-1">📷 Step 2: Scan Aadhaar QR Code</h2>
                <p className="text-sm text-orange-700">
                  Scan the QR code on your physical Aadhaar card. This is <strong>mandatory</strong> for identity verification.
                </p>
              </div>

              {/* Info box */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs text-amber-800 leading-relaxed">
                  <strong>🔒 Why QR Scan?</strong> The QR code on your Aadhaar card contains UIDAI digitally signed data. 
                  This prevents fake documents and auto-verifies your name, DOB, gender, and address.
                </p>
              </div>

              {!qrScanned ? (
                <>
                  {/* QR Scanner Region */}
                  {qrScanning && (
                    <div className="relative">
                      <div id="qr-reader-region" className="rounded-lg overflow-hidden" />
                      <button
                        onClick={stopQrScanner}
                        className="mt-2 w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded-lg text-sm"
                      >
                        ✕ Stop Scanner
                      </button>
                    </div>
                  )}

                  {/* Hidden div for image-based scan */}
                  <div id="qr-reader-region-upload" className="hidden" />

                  {!qrScanning && (
                    <div className="space-y-3">
                      <button
                        onClick={startQrScanner}
                        className="w-full bg-orange-600 hover:bg-orange-700 text-white font-bold py-4 rounded-xl text-base transition-colors flex items-center justify-center gap-2"
                      >
                        📷 Open Camera & Scan Aadhaar
                      </button>

                      <div className="text-center text-xs text-gray-400">— OR —</div>

                      <label className="block w-full cursor-pointer">
                        <div className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-lg text-sm text-center transition-colors border-2 border-dashed border-gray-300">
                          📁 Upload Aadhaar Image from Gallery
                        </div>
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={handleQrImageUpload}
                        />
                      </label>
                    </div>
                  )}

                  {qrError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-xs text-red-700">{qrError}</p>
                    </div>
                  )}
                </>
              ) : (
                /* QR Scanned Successfully */
                <div className="space-y-3">
                  <div className="bg-green-50 border-2 border-green-300 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-2xl">✅</span>
                      <h3 className="text-base font-bold text-green-800">Aadhaar QR Verified!</h3>
                    </div>
                    
                    {qrDisplayData && (
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Name:</span>
                          <span className="font-semibold text-gray-900">{qrDisplayData.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Aadhaar:</span>
                          <span className="font-semibold text-gray-900">{qrDisplayData.aadhaarNumber}</span>
                        </div>
                        {qrDisplayData.dob !== 'N/A' && (
                          <div className="flex justify-between">
                            <span className="text-gray-600">DOB:</span>
                            <span className="font-semibold text-gray-900">{qrDisplayData.dob}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-gray-600">Gender:</span>
                          <span className="font-semibold text-gray-900">{qrDisplayData.gender}</span>
                        </div>
                        {qrDisplayData.address !== 'N/A' && (
                          <div>
                            <span className="text-gray-600 text-xs">Address:</span>
                            <p className="text-xs text-gray-800 mt-0.5">{qrDisplayData.address}</p>
                          </div>
                        )}
                        {qrDisplayData.photo && (
                          <div className="text-center mt-2">
                            <img
                              src={qrDisplayData.photo}
                              alt="QR Photo"
                              className="w-20 h-24 object-cover rounded border mx-auto"
                              onError={(e) => {
                                // JPEG2000 not supported by browser — hide broken image
                                e.target.style.display = 'none';
                                const fallback = e.target.nextElementSibling;
                                if (fallback) fallback.textContent = '📷 Photo extracted (format not supported by browser)';
                              }}
                            />
                            <p className="text-[10px] text-gray-500 mt-1">Photo from Aadhaar QR</p>
                          </div>
                        )}
                        <div className="flex justify-between text-xs text-gray-500 mt-2 pt-2 border-t">
                          <span>QR Type:</span>
                          <span>{qrDisplayData.qrType}</span>
                        </div>
                      </div>
                    )}

                    {qrDisplayData?.hasWarning && (
                      <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded p-2">
                        <p className="text-xs text-yellow-700">⚠️ {qrDisplayData.warning}</p>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={resetQrScan}
                    className="text-xs text-gray-500 hover:text-red-600 underline"
                  >
                    Re-scan Aadhaar
                  </button>
                </div>
              )}

              {/* Navigation */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setCurrentStep(1)}
                  className="flex-1 bg-gray-400 hover:bg-gray-500 text-white font-bold py-3 rounded-lg text-sm transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setCurrentStep(3)}
                  disabled={!isStep2Complete}
                  className="flex-1 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg text-sm transition-colors"
                >
                  Next → Documents
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 3: Document Upload ── */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border-2 border-emerald-300 rounded-xl p-4">
                <h2 className="text-lg font-bold text-emerald-900 mb-1">📄 Step 3: Upload Documents</h2>
                <p className="text-sm text-emerald-700">Upload Aadhaar (front &amp; back), secondary ID, and selfie.</p>
              </div>

              {/* Cross-Verification Status */}
              {crossVerification && (
                <div className={`rounded-xl p-4 border-2 ${
                  crossVerification.overallStatus === 'verified' ? 'bg-green-50 border-green-300' :
                  crossVerification.overallStatus === 'flagged' ? 'bg-yellow-50 border-yellow-300' :
                  crossVerification.overallStatus === 'rejected' ? 'bg-red-50 border-red-300' :
                  'bg-gray-50 border-gray-300'
                }`}>
                  <p className="text-sm font-bold mb-2">
                    {crossVerification.overallStatus === 'verified' ? '✅ Sab kuch sahi hai! Document verified.' :
                     crossVerification.overallStatus === 'flagged' ? '⚠️ Kuch cheezein check karni hain:' :
                     crossVerification.overallStatus === 'rejected' ? '❌ Problem mili — neeche padh kar fix karein:' :
                     '⏳ Check ho raha hai...'}
                  </p>
                  {crossVerification.flags?.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {crossVerification.flags.map((flag, i) => {
                        // Support both old string flags and new object flags
                        const isObj = typeof flag === 'object';
                        const type = isObj ? flag.type : (flag.startsWith('✅') ? 'success' : flag.startsWith('⚠️') ? 'warning' : 'error');
                        const label = isObj ? flag.label : '';
                        const message = isObj ? flag.message : flag;
                        return (
                          <div key={i} className={`rounded-lg px-3 py-2 ${
                            type === 'success' ? 'bg-green-100 border border-green-300' :
                            type === 'warning' ? 'bg-yellow-100 border border-yellow-300' :
                            'bg-red-100 border border-red-300'
                          }`}>
                            {label && (
                              <p className={`text-xs font-bold mb-0.5 ${
                                type === 'success' ? 'text-green-800' :
                                type === 'warning' ? 'text-yellow-800' :
                                'text-red-800'
                              }`}>
                                {type === 'success' ? '✅' : type === 'warning' ? '⚠️' : '❌'} {label}
                              </p>
                            )}
                            <p className={`text-xs ${
                              type === 'success' ? 'text-green-700' :
                              type === 'warning' ? 'text-yellow-700' :
                              'text-red-700'
                            }`}>{message}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Aadhaar Front */}
              <DocumentUploadCard
                label="Aadhaar Card - Front *"
                field="aadharFrontImage"
                image={documents.aadharFrontImage}
                status={documents.aadharDocStatus}
                reason={documents.aadharDocReason}
                confidence={documents.aadharDocConfidence}
                isProcessing={ocrProcessing === 'aadhar'}
                onFileChange={(f) => handleDocumentUpload('aadharFrontImage', f)}
                onCamera={() => openCameraForField('aadharFrontImage')}
              />

              {/* Aadhaar Back */}
              <DocumentUploadCard
                label="Aadhaar Card - Back *"
                field="aadharBackImage"
                image={documents.aadharBackImage}
                status={null}
                reason=""
                isProcessing={false}
                onFileChange={(f) => handleDocumentUpload('aadharBackImage', f)}
                onCamera={() => openCameraForField('aadharBackImage')}
              />

              {/* Secondary ID Type Selector */}
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-semibold text-gray-700 mb-2">Secondary ID Type</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDocuments((p) => ({ ...p, secondaryIdType: 'PAN' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      documents.secondaryIdType === 'PAN'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-600 border border-gray-300'
                    }`}
                  >
                    PAN Card
                  </button>
                  <button
                    onClick={() => setDocuments((p) => ({ ...p, secondaryIdType: 'DL' }))}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                      documents.secondaryIdType === 'DL'
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-600 border border-gray-300'
                    }`}
                  >
                    Driving License
                  </button>
                </div>
              </div>

              {/* Secondary ID Number */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  {documents.secondaryIdType === 'PAN' ? 'PAN Number' : 'DL Number'}
                </label>
                <input
                  type="text"
                  value={documents.secondaryIdNumber}
                  onChange={(e) => setDocuments((p) => ({ ...p, secondaryIdNumber: e.target.value.toUpperCase() }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:ring-2 focus:ring-blue-300 focus:outline-none"
                  placeholder={documents.secondaryIdType === 'PAN' ? 'ABCDE1234F' : 'RJ1420200012345'}
                />
              </div>

              {/* Secondary ID Upload */}
              {documents.secondaryIdType === 'PAN' ? (
                <DocumentUploadCard
                  label="PAN Card Photo *"
                  field="panImage"
                  image={documents.panImage}
                  status={documents.panDocStatus}
                  reason={documents.panDocReason}
                  confidence={documents.panDocConfidence}
                  isProcessing={ocrProcessing === 'pan'}
                  onFileChange={(f) => handleDocumentUpload('panImage', f)}
                  onCamera={() => openCameraForField('panImage')}
                />
              ) : (
                <DocumentUploadCard
                  label="Driving License Photo *"
                  field="dlImage"
                  image={documents.dlImage}
                  status={documents.dlDocStatus}
                  reason={documents.dlDocReason}
                  confidence={documents.dlDocConfidence}
                  isProcessing={ocrProcessing === 'dl'}
                  onFileChange={(f) => handleDocumentUpload('dlImage', f)}
                  onCamera={() => openCameraForField('dlImage')}
                />
              )}

              {/* Selfie */}
              <DocumentUploadCard
                label="Selfie Photo *"
                field="selfieImage"
                image={documents.selfieImage}
                status={null}
                reason=""
                isProcessing={false}
                onFileChange={(f) => handleDocumentUpload('selfieImage', f)}
                onCamera={() => openCameraForField('selfieImage', 'user')}
                isSelfie
              />

              {/* Lighting Tips */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-blue-800 mb-1">💡 Tips for clear photos:</p>
                <ul className="text-xs text-blue-700 space-y-0.5 list-disc list-inside">
                  <li>Use good lighting (natural light works best)</li>
                  <li>Keep document flat — no bends or shadows</li>
                  <li>Ensure all text is readable</li>
                  <li>For selfie: face the camera, remove glasses</li>
                </ul>
              </div>

              {/* Navigation */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setCurrentStep(2)}
                  className="flex-1 bg-gray-400 hover:bg-gray-500 text-white font-bold py-3 rounded-lg text-sm transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setCurrentStep(4)}
                  disabled={!isStep3Complete}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg text-sm transition-colors"
                >
                  Next → Agreement
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: Agreement + Signature ── */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-300 rounded-xl p-4">
                <h2 className="text-lg font-bold text-purple-900 mb-1">✅ Step 4: Agreement & Signature</h2>
                <p className="text-sm text-purple-700">Accept terms and sign digitally.</p>
              </div>

              {/* Summary */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                <p className="text-xs font-semibold text-gray-800 mb-2">📋 Summary</p>
                <p className="text-xs text-gray-700">Name: <strong>{formData.firstName} {formData.lastName}</strong></p>
                <p className="text-xs text-gray-700">Phone: <strong>{formData.phone}</strong></p>
                <p className="text-xs text-gray-700">Occupation: <strong>{formData.occupation}</strong></p>
                {qrData?.uid && <p className="text-xs text-gray-700">Aadhaar: <strong>{maskAadhaar(qrData.uid)}</strong></p>}
                <p className="text-xs text-gray-700">QR Verified: <strong className="text-green-600">✅ Yes</strong></p>
                <p className="text-xs text-gray-700">
                  Documents: <strong className="text-green-600">
                    {[
                      documents.aadharFrontImage && 'Aadhaar Front',
                      documents.aadharBackImage && 'Aadhaar Back',
                      documents.panImage && 'PAN',
                      documents.dlImage && 'DL',
                      documents.selfieImage && 'Selfie',
                    ].filter(Boolean).join(', ')}
                  </strong>
                </p>
                {crossVerification && (
                  <p className="text-xs text-gray-700">
                    Cross-Verification: <strong className={
                      crossVerification.overallStatus === 'verified' ? 'text-green-600' :
                      crossVerification.overallStatus === 'flagged' ? 'text-yellow-600' :
                      'text-red-600'
                    }>
                      {crossVerification.overallStatus === 'verified' ? '✅ Passed' :
                       crossVerification.overallStatus === 'flagged' ? '⚠️ Flagged' :
                       crossVerification.overallStatus === 'rejected' ? '❌ Rejected' : '⏳ Pending'}
                    </strong>
                  </p>
                )}
              </div>

              {/* Agreement Text */}
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-amber-900 mb-2">📄 Rent Agreement (Digital Acceptance)</p>
                <p className="text-xs text-amber-800 leading-relaxed mb-3">
                  I confirm that the information provided is correct and truthful. I agree to:
                </p>
                <ul className="text-xs text-amber-800 space-y-1 list-disc list-inside mb-3">
                  <li>Pay rent and electricity charges on time as per lodge terms</li>
                  <li>Maintain the property in good condition</li>
                  <li>Follow all rules and regulations of the lodge</li>
                  <li>Provide accurate identity documents for verification</li>
                </ul>
                <label className="flex items-center gap-2 text-sm text-amber-900 font-semibold">
                  <input
                    type="checkbox"
                    checked={agreementAccepted}
                    onChange={(e) => setAgreementAccepted(e.target.checked)}
                  />
                  I accept the rent agreement terms.
                </label>
              </div>

              {/* Digital Signature */}
              <div className="bg-white border border-gray-300 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-gray-700">✍️ Digital Signature</p>
                  <button
                    type="button"
                    onClick={clearSignature}
                    className="text-xs font-semibold text-red-600 hover:underline"
                  >
                    Clear
                  </button>
                </div>
                <canvas
                  ref={signatureCanvasRef}
                  width={640}
                  height={180}
                  className="w-full h-28 border border-gray-300 rounded touch-none bg-gray-50"
                  onMouseDown={startSignatureDraw}
                  onMouseMove={moveSignatureDraw}
                  onMouseUp={stopSignatureDraw}
                  onMouseLeave={stopSignatureDraw}
                  onTouchStart={(e) => { e.preventDefault(); startSignatureDraw(e); }}
                  onTouchMove={(e) => { e.preventDefault(); moveSignatureDraw(e); }}
                  onTouchEnd={(e) => { e.preventDefault(); stopSignatureDraw(); }}
                />
                {signedAt && (
                  <p className="text-[10px] text-gray-500 mt-1">
                    Signed on: {new Date(signedAt).toLocaleString('en-IN')}
                  </p>
                )}
              </div>

              {/* Navigation */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setCurrentStep(3)}
                  className="flex-1 bg-gray-400 hover:bg-gray-500 text-white font-bold py-3 rounded-lg text-sm transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving || !isStep4Complete}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg text-sm transition-colors"
                >
                  {saving ? '⏳ Submitting...' : '🚀 Submit KYC'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center py-4 mt-4">
          <p className="text-xs text-gray-400">🔒 KYC verified via DigiLocker (Govt. of India). Your data is securely stored and only accessible to the admin.</p>
        </div>
      </div>
    </div>
  );
};


// ─── DOCUMENT UPLOAD CARD (Sub-component) ────────────────────────────────────

const DocumentUploadCard = ({ label, field, image, status, reason, confidence, isProcessing, onFileChange, onCamera, isSelfie = false }) => {
  const statusColors = {
    'verified': 'border-green-300 bg-green-50',
    'checking': 'border-yellow-300 bg-yellow-50',
    'number_not_found': 'border-orange-300 bg-orange-50',
    'number_mismatch': 'border-red-300 bg-red-50',
    'name_mismatch': 'border-orange-300 bg-orange-50',
    'error': 'border-red-300 bg-red-50',
    'not_uploaded': 'border-gray-200 bg-white',
  };

  const statusIcons = {
    'verified': '✅',
    'checking': '⏳',
    'number_not_found': '⚠️',
    'number_mismatch': '❌',
    'name_mismatch': '⚠️',
    'error': '❌',
  };

  return (
    <div className={`rounded-lg p-3 border-2 ${status ? (statusColors[status] || 'border-gray-200 bg-white') : 'border-gray-200 bg-white'}`}>
      <p className="text-xs font-semibold text-gray-700 mb-2">{label}</p>

      {image ? (
        <div className="space-y-2">
          <img src={image} alt={label} className="w-full max-h-40 object-contain rounded border" />
          
          {isProcessing && (
            <div className="flex items-center gap-2 text-xs text-yellow-700">
              <span className="animate-spin">⏳</span> OCR analyzing...
            </div>
          )}

          {status && status !== 'not_uploaded' && !isProcessing && (
            <div className="flex items-center gap-1 text-xs">
              <span>{statusIcons[status] || '📄'}</span>
              <span className={`font-semibold ${status === 'verified' ? 'text-green-700' : status === 'checking' ? 'text-yellow-700' : 'text-red-700'}`}>
                {reason}
              </span>
            </div>
          )}

          {confidence > 0 && (
            <p className="text-[10px] text-gray-500">OCR Confidence: {Math.round(confidence)}%</p>
          )}

          <button
            onClick={() => onFileChange(null)}
            className="text-xs text-red-500 hover:underline"
            type="button"
          >
            Remove & Re-upload
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onCamera()}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg text-xs transition-colors"
            type="button"
          >
            📷 {isSelfie ? 'Take Selfie' : 'Take Photo'}
          </button>
          <label className="flex-1 cursor-pointer">
            <div className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-lg text-xs text-center transition-colors border border-gray-300">
              📁 Gallery / PDF
            </div>
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFileChange(f);
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
};


export default TenantOnboarding;
