import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { db } from '../firebase';
import { collection, addDoc, doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import Tesseract from 'tesseract.js';
import { Html5Qrcode } from 'html5-qrcode';
import { parseAadhaarQr, crossVerify, formatQrDataForDisplay, maskAadhaar } from '../utils/aadhaarQrParser';
import { scanDocument } from '../utils/documentScanner';
import { detectDevice, getCameraPermissionInstructions, checkCameraPermission } from '../utils/deviceDetection';

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
  const [scannerLoading, setScannerLoading] = useState(false);
  const [qrScanned, setQrScanned] = useState(false);
  const [qrData, setQrData] = useState(null);
  const [qrError, setQrError] = useState('');
  const [qrDisplayData, setQrDisplayData] = useState(null);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const qrScannerRef = useRef(null);
  const scannerInitializing = useRef(false); // Prevent double-initialization
  const frameCountIntervalRef = useRef(null); // Track frame processing
  const qrRegionRef = useRef(null);
  
  // Device detection and camera permission
  const [deviceInfo, setDeviceInfo] = useState(() => detectDevice());
  const [showPermissionHelp, setShowPermissionHelp] = useState(false);
  const [cameraPermissionStatus, setCameraPermissionStatus] = useState('unknown');

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

  // Camera viewfinder state
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraField, setCameraField] = useState('');
  const [cameraFacing, setCameraFacing] = useState('environment');
  const cameraVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);

  // Step 4: Agreement
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [signature, setSignature] = useState('');
  const [signedAt, setSignedAt] = useState(null);
  const [isSigning, setIsSigning] = useState(false);
  const signatureCanvasRef = useRef(null);

  // Step 4: DigiLocker KYC
  const [digiLockerStatus, setDigiLockerStatus] = useState('not_started'); // not_started, loading, verified, error, skipped
  const [digiLockerError, setDigiLockerError] = useState('');
  const [digiLockerData, setDigiLockerData] = useState(null);
  const KYC_PENDING_KEY = 'kycPendingState';

  const DEFAULT_KYC_FUNCTION_BASE_URL = `${window.location.origin}/.netlify/functions`;

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
    const raw = String(text || '');
    const dense = raw.replace(/\s+/g, ' ');

    // 1. Standard format: 1234 5678 9012 (with word boundaries)
    const grouped = dense.match(/\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/);
    if (grouped?.[0]) return normalizeAadhar(grouped[0]);

    // 2. Plain 12 digits
    const plain = dense.match(/\d{12}/);
    if (plain?.[0]) return normalizeAadhar(plain[0]);

    // 3. OCR artifact cleanup: O→0, l/I→1, S→5, B→8, G→6, Z→2, T→7, q→9
    const cleaned = raw
      .replace(/[oO]/g, '0').replace(/[lI|]/g, '1').replace(/[sS]/g, '5')
      .replace(/[B]/g, '8').replace(/[G]/g, '6').replace(/[Z]/g, '2')
      .replace(/[T]/g, '7').replace(/[q]/g, '9')
      .replace(/\s+/g, ' ');
    const retryGrouped = cleaned.match(/\d{4}[\s.-]?\d{4}[\s.-]?\d{4}/);
    if (retryGrouped?.[0]) return normalizeAadhar(retryGrouped[0]);

    // 4. Relaxed: find any 4-digit groups separated by spaces/garbage in lines
    const lines = raw.split('\n');
    for (const line of lines) {
      // Try to find 3 groups of 4 digits on the same line
      const digits = line.replace(/[^\d\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const groups = digits.match(/(\d{4})/g);
      if (groups && groups.length >= 3) {
        const candidate = groups.slice(0, 3).join('');
        if (candidate.length === 12) return normalizeAadhar(candidate);
      }
    }

    // 5. Last resort: collect all digits, find any 12-digit substring
    const allDigits = raw.replace(/\D/g, '');
    if (allDigits.length >= 12) {
      // Prefer the last 12 digits (Aadhaar number is usually at bottom of card)
      const twelve = allDigits.slice(-12);
      return normalizeAadhar(twelve);
    }
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
  const isStep4Complete = agreementAccepted && signature && (digiLockerStatus === 'verified' || digiLockerStatus === 'skipped');

  // ─── QR SCANNER ─────────────────────────────────────────────────────────

  const startQrScanner = async () => {
    // Prevent double-initialization (React StrictMode can cause double-mounting)
    if (scannerInitializing.current) {
      console.log('⚠️ Scanner already initializing, skipping...');
      return;
    }

    scannerInitializing.current = true;
    setQrError('');
    setQrScanning(true);
    setScannerLoading(true);
    setShowPermissionHelp(false);

    console.log('🎥 Starting QR scanner...');

    try {
      // First, cleanup any existing scanner instance
      if (qrScannerRef.current) {
        try {
          console.log('Cleaning up existing scanner...');
          await qrScannerRef.current.stop();
          qrScannerRef.current.clear();
          qrScannerRef.current = null;
          // Small delay to ensure cleanup completes
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          console.log('Previous scanner cleanup error (ignored):', e.message);
        }
      }

      // Check if camera API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera not supported by this browser. Please use Chrome, Firefox, or Safari.');
      }

      // Get device info
      const device = detectDevice();

      // Request camera permission
      try {
        console.log(`Requesting camera permission on ${device.deviceName} (${device.browserName})`);
        
        // Use basic constraints for better compatibility
        const stream = await navigator.mediaDevices.getUserMedia({ 
          video: {
            facingMode: 'environment'
          }
        });
        
        // Permission granted! Stop the test stream
        stream.getTracks().forEach(track => track.stop());
        
        // Store permission status
        localStorage.setItem('cameraPermissionGranted', 'true');
        localStorage.setItem('cameraPermissionGrantedAt', new Date().toISOString());
        setCameraPermissionStatus('granted');
        
        // Small delay to ensure camera is fully released
        await new Promise(resolve => setTimeout(resolve, 200));
        
      } catch (permErr) {
        console.error('Camera permission error:', permErr);
        
        // Store denied status
        localStorage.setItem('cameraPermissionGranted', 'false');
        localStorage.setItem('cameraPermissionDeniedAt', new Date().toISOString());
        setCameraPermissionStatus('denied');
        
        // Handle specific error types
        if (permErr.name === 'NotAllowedError' || permErr.name === 'PermissionDeniedError') {
          setShowPermissionHelp(true);
          throw new Error('Camera permission denied. Please see instructions below.');
        } else if (permErr.name === 'NotFoundError') {
          throw new Error('No camera found. Please make sure your device has a camera.');
        } else if (permErr.name === 'NotReadableError') {
          throw new Error('Camera is already in use by another application. Please close other apps and try again.');
        } else if (permErr.name === 'OverconstrainedError') {
          // Try again with most basic constraints
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(track => track.stop());
            localStorage.setItem('cameraPermissionGranted', 'true');
            setCameraPermissionStatus('granted');
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch {
            setShowPermissionHelp(true);
            throw new Error('Camera constraints not supported. Please see instructions below.');
          }
        } else {
          setShowPermissionHelp(true);
          throw new Error(`Camera access failed: ${permErr.message || 'Unknown error'}`);
        }
      }

      const regionId = 'qr-reader-region';
      
      // Verify DOM element exists
      const scannerDiv = document.getElementById(regionId);
      if (!scannerDiv) {
        throw new Error('Scanner container not found in DOM. Please refresh and try again.');
      }
      
      // Clear any existing content in scanner div (prevents conflicts)
      scannerDiv.innerHTML = '';
      console.log('✅ Scanner div found and cleared:', scannerDiv);
      
      // Small delay for DOM to be ready
      await new Promise((r) => setTimeout(r, 300));
      
      const scanner = new Html5Qrcode(regionId);
      qrScannerRef.current = scanner;
      console.log('✅ Html5Qrcode scanner object created');

      // Get available cameras
      const devices = await Html5Qrcode.getCameras();
      if (!devices || devices.length === 0) {
        throw new Error('No camera found on this device.');
      }

      console.log(`Found ${devices.length} camera(s)`);

      // Select back camera if available (for mobile), otherwise use first camera
      let selectedCamera = devices[0].id;
      for (const device of devices) {
        if (device.label.toLowerCase().includes('back') || 
            device.label.toLowerCase().includes('rear') ||
            device.label.toLowerCase().includes('environment')) {
          selectedCamera = device.id;
          console.log('Selected back camera:', device.label);
          break;
        }
      }

      // Calculate responsive QR box size - larger for better detection
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const minEdge = Math.min(viewportWidth, viewportHeight);
      const qrboxSize = Math.floor(minEdge * 0.75); // 75% of viewport for better detection
      console.log(`📐 QR Box Size: ${qrboxSize}x${qrboxSize}px (Viewport: ${viewportWidth}x${viewportHeight})`);

      const scanConfig = {
        fps: 10, // Stable 10 FPS for better accuracy
        qrbox: { width: qrboxSize, height: qrboxSize }, // Larger detection area
        disableFlip: false, // Try both normal and mirrored
        rememberLastUsedCamera: true,
        showTorchButtonIfSupported: true,
        showZoomSliderIfSupported: true,
        defaultZoomValueIfSupported: 1.5,
        // IMPORTANT: Enable ALL barcode formats for Aadhaar QR compatibility
        // Some Aadhaar QRs may need multiple format decoders
        // Leave formatsToSupport undefined to enable all formats
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true // Use native browser barcode API if available
        }
      };

      console.log('📷 Starting scanner with config:', scanConfig);

      let frameCount = 0;
      let lastLogTime = Date.now();
      frameCountIntervalRef.current = setInterval(() => {
        frameCount++;
        const now = Date.now();
        if (frameCount % 50 === 0) { // Log every 5 seconds (50 frames at 10 FPS)
          const elapsed = (now - lastLogTime) / 1000;
          const actualFps = 50 / elapsed;
          console.log(`📊 Scanner active - ${frameCount} frames (${Math.round(frameCount/10)}s) | FPS: ${actualFps.toFixed(1)}`);
          lastLogTime = now;
        }
      }, 100);

      await scanner.start(
        selectedCamera, // Use camera ID instead of constraints object
        scanConfig,
        (decodedText) => {
          // QR code scanned successfully
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('🎉 QR CODE DETECTED! Scanner success callback fired!');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          
          if (frameCountIntervalRef.current) {
            clearInterval(frameCountIntervalRef.current);
            frameCountIntervalRef.current = null;
          }
          
          console.log('📊 QR Data Stats:');
          console.log('  - Length:', decodedText.length);
          console.log('  - Type:', typeof decodedText);
          console.log('  - First 200 chars:', decodedText.substring(0, 200));
          console.log('  - Is Numeric?', /^\d+$/.test(decodedText));
          console.log('  - Has XML?', decodedText.includes('<'));
          
          try {
            console.log('🔄 Calling handleQrResult...');
            handleQrResult(decodedText);
            console.log('✅ handleQrResult completed');
            
            console.log('🛑 Stopping scanner...');
            stopQrScanner();
            console.log('✅ Scanner stopped');
          } catch (err) {
            console.error('❌ ERROR in success callback:', err);
            console.error('Stack:', err.stack);
          }
        },
        (errorMessage) => {
          // Scan failed (no QR in frame) — this fires continuously
          // These are NORMAL errors while scanning - only log unusual ones
          
          // Ignore common scanning errors
          if (errorMessage && (
            errorMessage.includes('NotFoundException') ||
            errorMessage.includes('No MultiFormat Readers') ||
            errorMessage.includes('error = B:')
          )) {
            // Silent - these are expected during active scanning
            return;
          }
          
          // Log first 5 attempts for debugging
          if (frameCount <= 5) {
            console.log(`🔍 Scan attempt ${frameCount}: ${errorMessage}`);
          }
          
          // Log only unusual errors
          if (errorMessage && errorMessage.trim()) {
            console.warn('⚠️ Unusual scan error:', errorMessage);
          }
        }
      );
      
      console.log('✅ QR scanner started successfully with camera:', selectedCamera);
      
      // Check if video element is created and displaying
      setTimeout(() => {
        const scannerDiv = document.getElementById('qr-reader-region');
        if (scannerDiv) {
          const video = scannerDiv.querySelector('video');
          if (video) {
            console.log('📹 Video element found:', {
              width: video.videoWidth,
              height: video.videoHeight,
              playing: !video.paused,
              currentTime: video.currentTime,
              readyState: video.readyState
            });
          } else {
            console.error('❌ No video element found in scanner div!');
          }
          
          const qrShadedRegion = scannerDiv.querySelector('#qr-shaded-region');
          if (qrShadedRegion) {
            console.log('✅ QR shaded region (green box) found');
          } else {
            console.warn('⚠️ QR shaded region (green box) NOT found - may not be visible');
          }
        }
      }, 500);
      
      // Wait for video to stabilize before hiding loading overlay
      // Reduced delay to 1 second for better UX
      setTimeout(() => {
        // Double-check scanner still exists before updating state
        if (qrScannerRef.current && document.getElementById('qr-reader-region')) {
          setScannerLoading(false);
          scannerInitializing.current = false; // Scanner fully initialized
          console.log('✅ Scanner ready - Point QR code at camera now!');
          console.log('📱 Green box should be visible for QR alignment');
        } else {
          console.warn('⚠️ Scanner was stopped before initialization completed');
        }
      }, 1000); // 1 second delay to let video fully initialize
      
    } catch (err) {
      console.error('QR Scanner error:', err);
      scannerInitializing.current = false; // Reset flag on error
      setQrError(
        `❌ ${err?.message || 'Unknown camera error. Try uploading QR image instead.'}`
      );
      setQrScanning(false);
      setScannerLoading(false);
    }
  };

  // Toggle flashlight/torch
  const toggleFlashlight = async () => {
    try {
      const scannerDiv = document.getElementById('qr-reader-region');
      if (!scannerDiv) {
        console.warn('Scanner div not found');
        return;
      }

      const video = scannerDiv.querySelector('video');
      if (!video || !video.srcObject) {
        console.warn('Video element or stream not found');
        showToast('⚠️ Camera not active', 'error');
        return;
      }

      const stream = video.srcObject;
      const track = stream.getVideoTracks()[0];
      
      if (!track) {
        console.warn('Video track not found');
        return;
      }

      // Check if torch is supported
      const capabilities = track.getCapabilities();
      if (!capabilities.torch) {
        console.warn('Flashlight not supported on this device');
        showToast('⚠️ Flashlight not supported on your device', 'error');
        return;
      }

      // Toggle torch
      const newState = !flashlightOn;
      await track.applyConstraints({
        advanced: [{ torch: newState }]
      });
      
      setFlashlightOn(newState);
      console.log(`💡 Flashlight ${newState ? 'ON' : 'OFF'}`);
      showToast(`💡 Flashlight ${newState ? 'ON' : 'OFF'}`, 'success');
    } catch (err) {
      console.error('Flashlight toggle error:', err);
      showToast('⚠️ Could not toggle flashlight', 'error');
    }
  };

  const stopQrScanner = async () => {
    console.log('🛑 Stopping QR scanner...');
    
    // Reset flashlight state
    setFlashlightOn(false);
    
    // Clear frame counting interval
    if (frameCountIntervalRef.current) {
      clearInterval(frameCountIntervalRef.current);
      frameCountIntervalRef.current = null;
    }
    
    // Set states first to hide UI elements
    setQrScanning(false);
    setScannerLoading(false);
    scannerInitializing.current = false;
    
    // Small delay to allow React to update DOM
    await new Promise(r => setTimeout(r, 100));
    
    try {
      if (qrScannerRef.current) {
        const scannerElement = document.getElementById('qr-reader-region');
        
        // Only proceed if scanner element still exists in DOM
        if (!scannerElement) {
          console.warn('⚠️ Scanner element not found in DOM, skipping cleanup');
          qrScannerRef.current = null;
          return;
        }

        // Try to stop scanner (this releases camera)
        try {
          await qrScannerRef.current.stop();
          console.log('✅ Scanner stopped successfully');
        } catch (stopErr) {
          console.log('⚠️ Stop error (ignored):', stopErr.message);
        }
        
        // DO NOT call clear() - it causes removeChild errors
        // Instead, manually clean up the div content after a delay
        setTimeout(() => {
          const scannerDiv = document.getElementById('qr-reader-region');
          if (scannerDiv && scannerDiv.parentNode) {
            // Safely remove all child nodes
            while (scannerDiv.firstChild) {
              try {
                scannerDiv.removeChild(scannerDiv.firstChild);
              } catch (e) {
                console.log('Child removal skipped');
                break;
              }
            }
          }
        }, 500);
        
        qrScannerRef.current = null;
        console.log('✅ Scanner reference cleared');
      }
    } catch (err) {
      console.log('Scanner cleanup error (ignored):', err.message);
    }
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
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 handleQrResult() called');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Raw text length:', rawText?.length);
    
    try {
      console.log('📝 Calling parseAadhaarQr()...');
      const parsed = parseAadhaarQr(rawText);
      console.log('✅ parseAadhaarQr() returned:', parsed);

      if (parsed.success) {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ AADHAAR QR PARSED SUCCESSFULLY!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📋 Parsed Data:');
        console.log('  - QR Type:', parsed.qrType);
        console.log('  - Name:', parsed.name);
        console.log('  - DOB/YOB:', parsed.dob);
        console.log('  - Gender:', parsed.gender);
        console.log('  - UID/Last4:', parsed.uid);
        
        console.log('🔄 Setting state: setQrData...');
        setQrData(parsed);
        console.log('✅ setQrData done');
        
        console.log('🔄 Setting state: setQrScanned(true)...');
        setQrScanned(true);
        console.log('✅ setQrScanned done');
        
        console.log('🔄 Setting state: setQrDisplayData...');
        setQrDisplayData(formatQrDataForDisplay(parsed));
        console.log('✅ setQrDisplayData done');
        
        console.log('🔔 Showing success toast...');
        showToast('✅ Aadhaar QR scanned successfully!', 'success');
        console.log('✅ Toast shown');

        // Auto-fill form if name is from QR
        if (parsed.name) {
          console.log('📝 Auto-filling name from QR...');
          const parts = parsed.name.split(/\s+/);
          setFormData((prev) => ({
            ...prev,
            firstName: prev.firstName || parts[0] || '',
            lastName: prev.lastName || parts.slice(1).join(' ') || '',
          }));
          console.log('✅ Name auto-filled');
        }
        
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ ALL DONE - QR PROCESSING COMPLETE!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      } else {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('❌ QR PARSING FAILED!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('Error:', parsed.error);
        console.log('Raw data preview:', rawText.substring(0, 100));
        setQrError(parsed.error || '❌ Failed to parse QR code data.');
        showToast('❌ This is not an Aadhaar QR code', 'error');
        setQrScanned(false);
      }
    } catch (error) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('❌ EXCEPTION IN handleQrResult()!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('Error:', error);
      console.error('Stack:', error.stack);
      showToast('❌ Error processing QR code', 'error');
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
    // Global error handler for unhandled promise rejections from scanner
    const handleUnhandledRejection = (event) => {
      if (event.reason?.message?.includes('AbortError') || 
          event.reason?.message?.includes('play()') ||
          event.reason?.name === 'AbortError') {
        console.warn('⚠️ Caught AbortError from scanner (ignored):', event.reason);
        event.preventDefault(); // Prevent error from crashing the app
      }
    };

    // Global error handler for removeChild errors
    const handleError = (event) => {
      if (event.error?.message?.includes('removeChild') ||
          event.message?.includes('removeChild')) {
        console.warn('⚠️ Caught removeChild error (ignored):', event.error || event.message);
        event.preventDefault(); // Prevent error from crashing the app
        return true;
      }
    };

    // Handle visibility change (tab switch, minimize, etc)
    const handleVisibilityChange = () => {
      if (document.hidden && qrScannerRef.current) {
        console.log('⚠️ Page hidden while scanner active');
      } else if (!document.hidden && qrScannerRef.current) {
        console.log('✅ Page visible again');
      }
    };

    // Handle page unload/navigation
    const handleBeforeUnload = () => {
      if (qrScannerRef.current) {
        console.log('⚠️ Page unloading - cleaning up scanner');
        try {
          // Only stop, don't call clear()
          qrScannerRef.current.stop().catch(() => {});
        } catch { /* ignore */ }
      }
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      
      // Clear frame count interval
      if (frameCountIntervalRef.current) {
        clearInterval(frameCountIntervalRef.current);
        frameCountIntervalRef.current = null;
      }
      
      // Cleanup scanner on unmount - only stop, never clear
      if (qrScannerRef.current) {
        try {
          qrScannerRef.current.stop().catch(() => {});
        } catch (err) {
          console.log('Unmount cleanup error (ignored):', err.message);
        }
        qrScannerRef.current = null;
      }
      scannerInitializing.current = false;
    };
  }, []);

  // ─── DOCUMENT UPLOAD + OCR ──────────────────────────────────────────────

  // ─── IN-APP CAMERA ────────────────────────────────────────────────────

  const openCameraForField = async (field, facing = 'environment') => {
    setCameraField(field);
    setCameraFacing(facing);
    setCameraOpen(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      // Stream is ready — attach to video element. Use a small retry loop
      // because the <video> element may not be in the DOM yet after setState.
      const attachStream = () => {
        const video = cameraVideoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute('autoplay', '');
          video.setAttribute('playsinline', '');
          video.play().catch(() => {});
        } else {
          // Video element not mounted yet, retry
          requestAnimationFrame(attachStream);
        }
      };
      attachStream();
    } catch (err) {
      console.error('Camera access error:', err);
      showToast(
        err.name === 'NotAllowedError'
          ? '❌ Camera permission denied. Please allow camera access.'
          : `❌ Camera error: ${err.message}`,
        'error',
      );
      setCameraOpen(false);
    }
  };

  const closeCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setCameraOpen(false);
    setCameraField('');
  };

  const capturePhoto = async () => {
    const video = cameraVideoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const rawDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    closeCamera();

    // Process through document scanner (Adobe Scan-like enhancement)
    try {
      const isSelfie = cameraField === 'selfieImage';
      const scannedUrl = await scanDocument(rawDataUrl, { isSelfie });
      setDocuments((prev) => ({ ...prev, [cameraField]: scannedUrl }));

      if (cameraField === 'aadharFrontImage') runOcrVerification('aadhar', scannedUrl);
      else if (cameraField === 'panImage') runOcrVerification('pan', scannedUrl);
      else if (cameraField === 'dlImage') runOcrVerification('dl', scannedUrl);
    } catch {
      showToast('❌ Failed to process captured photo', 'error');
    }
  };

  // ─── REMOVE DOCUMENT ──────────────────────────────────────────────────

  const removeDocument = (field) => {
    setDocuments((prev) => {
      const updated = { ...prev, [field]: '' };
      // Clear related OCR status
      if (field === 'aadharFrontImage') {
        updated.aadharDocStatus = 'not_uploaded';
        updated.aadharDocReason = '';
        updated.aadharDocConfidence = 0;
        updated.aadharExtractedNumber = '';
        updated.aadharNameMatched = false;
      } else if (field === 'panImage') {
        updated.panDocStatus = 'not_uploaded';
        updated.panDocReason = '';
        updated.panDocConfidence = 0;
        updated.panExtractedNumber = '';
        updated.panNameMatched = false;
      } else if (field === 'dlImage') {
        updated.dlDocStatus = 'not_uploaded';
        updated.dlDocReason = '';
        updated.dlDocConfidence = 0;
        updated.dlExtractedNumber = '';
        updated.dlNameMatched = false;
      }
      return updated;
    });
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

      if (!extractedNumber && confidence < 60) {
        // Low OCR confidence — don't block, just warn
        status = 'verified';
        reason = `⚠️ OCR confidence low (${Math.round(confidence)}%). Photo clear hai to koi issue nahi.`;
      } else if (!extractedNumber) {
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
        // Try to extract just the name from OCR text instead of passing raw dump
        // Look for name near known labels on Aadhaar card
        let ocrExtractedName = '';
        const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].toLowerCase();
          // If this line contains a name-like label, next line might be the name
          if (/\b(name|naam|नाम)\b/i.test(line)) {
            // Check if name is on same line after colon, or on next line
            const afterColon = lines[i].split(/[:\/]/)[1]?.trim();
            if (afterColon && /[A-Za-z]{2,}/.test(afterColon)) {
              ocrExtractedName = afterColon;
            } else if (i + 1 < lines.length && /^[A-Za-z\s.'-]{3,}$/.test(lines[i + 1].trim())) {
              ocrExtractedName = lines[i + 1].trim();
            }
            break;
          }
          // Also check if a line looks like a name (just letters, 2+ words)
          if (!ocrExtractedName && /^[A-Za-z][A-Za-z\s.'-]{4,}$/.test(lines[i]) && lines[i].split(/\s+/).length >= 2) {
            ocrExtractedName = lines[i];
          }
        }
        
        const verification = crossVerify(
          qrData,
          { name: ocrExtractedName || rawText, aadhaarNumber: extractedNumber, confidence },
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

  // ─── DIGILOCKER VERIFICATION ───────────────────────────────────────────

  const startDigiLockerVerification = async () => {
    setDigiLockerStatus('loading');
    setDigiLockerError('');

    try {
      const initiateUrl = `${DEFAULT_KYC_FUNCTION_BASE_URL}/initiateKyc?t=${Date.now()}`;
      const response = await fetch(initiateUrl, {
        method: 'GET',
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      });

      const rawText = await response.text();
      let payload = {};
      try {
        payload = JSON.parse(rawText);
      } catch {
        throw new Error('Server ne invalid response diya.');
      }

      const payloadData = payload?.data || {};
      const authorizationUrl = payload?.authorizationUrl || payloadData?.authorizationUrl;
      const state = payload?.state || payloadData?.state;
      const codeVerifier = payload?.codeVerifier || payloadData?.codeVerifier;

      if (!response.ok || !authorizationUrl || !state) {
        throw new Error(payload?.message || 'DigiLocker initiate fail hua.');
      }

      // Save state for callback
      localStorage.setItem(KYC_PENDING_KEY, JSON.stringify({
        state: String(state),
        codeVerifier: codeVerifier ? String(codeVerifier) : undefined,
        stateCreatedAt: Date.now(),
        source: 'onboarding',
      }));

      // Open DigiLocker popup
      const popupWidth = 600;
      const popupHeight = 700;
      const left = (window.screen.width - popupWidth) / 2;
      const top = (window.screen.height - popupHeight) / 2;
      const popup = window.open(
        authorizationUrl,
        'DigiLockerKYC',
        `width=${popupWidth},height=${popupHeight},left=${left},top=${top},toolbar=no,menubar=no,location=no,status=no,resizable=yes,scrollbars=yes`,
      );

      if (!popup) {
        throw new Error('Popup block ho gaya. Please allow popups for this site.');
      }

      // Monitor popup closure
      const checkInterval = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkInterval);
          // Check if callback stored verification data
          const storedKyc = localStorage.getItem('digilocker_kyc_result');
          if (storedKyc) {
            try {
              const kycResult = JSON.parse(storedKyc);
              if (kycResult.success) {
                setDigiLockerStatus('verified');
                setDigiLockerData({
                  name: kycResult.name || '',
                  dob: kycResult.dob || '',
                  verifiedAt: kycResult.verifiedAt || new Date().toISOString(),
                });
              } else {
                setDigiLockerStatus('error');
                setDigiLockerError(kycResult.error || 'Verification fail hua.');
              }
            } catch {
              setDigiLockerStatus('error');
              setDigiLockerError('DigiLocker result read nahi ho paya.');
            }
            localStorage.removeItem('digilocker_kyc_result');
          } else {
            // Popup closed without result — user might have cancelled
            setDigiLockerStatus('not_started');
            showToast('DigiLocker window band ho gaya. Dobara try karein.', 'info');
          }
        }
      }, 500);

      // Timeout after 10 minutes
      setTimeout(() => {
        clearInterval(checkInterval);
        if (!popup.closed) popup.close();
        if (digiLockerStatus === 'loading') {
          setDigiLockerStatus('not_started');
        }
      }, 600000);

    } catch (err) {
      console.error('DigiLocker initiate failed:', err);
      setDigiLockerStatus('error');
      setDigiLockerError(err?.message || 'DigiLocker verification start nahi ho paya.');
    }
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

        // DigiLocker KYC
        digiLocker: {
          status: digiLockerStatus,
          data: digiLockerData || null,
          verifiedAt: digiLockerData?.verifiedAt || null,
        },

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
    { num: 4, label: 'Verify', icon: '🏛️', complete: !!isStep4Complete },
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

      {/* ─── CAMERA VIEWFINDER OVERLAY ─── */}
      {cameraOpen && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col">
          {/* Camera feed */}
          <div className="flex-1 relative overflow-hidden">
            <video
              ref={(el) => {
                cameraVideoRef.current = el;
                // When React mounts the video element and stream is ready, attach it
                if (el && cameraStreamRef.current && !el.srcObject) {
                  el.srcObject = cameraStreamRef.current;
                  el.play().catch(() => {});
                }
              }}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
              style={{ transform: cameraFacing === 'user' ? 'scaleX(-1)' : 'none' }}
            />
            {/* Document frame guide (not shown for selfie) */}
            {cameraField !== 'selfieImage' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[85%] aspect-[1.6/1] border-2 border-white/70 rounded-lg shadow-lg"
                     style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)' }}>
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1 rounded-full whitespace-nowrap">
                    📄 Align document inside the frame
                  </div>
                  {/* Corner markers */}
                  <div className="absolute top-0 left-0 w-6 h-6 border-t-3 border-l-3 border-white rounded-tl-md" />
                  <div className="absolute top-0 right-0 w-6 h-6 border-t-3 border-r-3 border-white rounded-tr-md" />
                  <div className="absolute bottom-0 left-0 w-6 h-6 border-b-3 border-l-3 border-white rounded-bl-md" />
                  <div className="absolute bottom-0 right-0 w-6 h-6 border-b-3 border-r-3 border-white rounded-br-md" />
                </div>
              </div>
            )}
            {/* Selfie — clean camera, no overlay guide */}
            {cameraField === 'selfieImage' && (
              <div className="absolute inset-0 flex items-start justify-center pointer-events-none">
                <div className="mt-[10%] bg-black/50 text-white text-sm px-4 py-2 rounded-full">
                  🤳 Apna chehra camera ke saamne rakhein
                </div>
              </div>
            )}
          </div>

          {/* Bottom controls */}
          <div className="bg-black/80 px-4 py-5 flex items-center justify-between safe-area-bottom">
            <button
              onClick={closeCamera}
              className="text-white text-sm font-semibold px-4 py-2"
              type="button"
            >
              ✕ Cancel
            </button>
            <button
              onClick={capturePhoto}
              className="w-16 h-16 rounded-full border-4 border-white bg-white/20 hover:bg-white/40 transition-colors flex items-center justify-center"
              type="button"
            >
              <div className="w-12 h-12 rounded-full bg-white" />
            </button>
            <div className="w-16" /> {/* Spacer for centering */}
          </div>
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
                <p className="text-xs text-amber-800 leading-relaxed mb-2">
                  <strong>🔒 Why QR Scan?</strong> The QR code on your Aadhaar card contains UIDAI digitally signed data. 
                  This prevents fake documents and auto-verifies your name, DOB, gender, and address.
                </p>
                <div className="mt-3 pt-3 border-t border-amber-300">
                  <p className="text-xs font-bold text-amber-900 mb-2">📍 QR Code kahan hai?</p>
                  <ul className="text-xs text-amber-800 space-y-1 ml-4">
                    <li>• <strong>Front side</strong> par - Photo ke neeche, left corner mein</li>
                    <li>• Square black & white pattern jaisa dikhta hai</li>
                    <li>• Finger size ka (approx 1.5cm x 1.5cm)</li>
                  </ul>
                </div>
              </div>

              {!qrScanned ? (
                <>
                  {/* QR Scanner Region - Keep in DOM always to prevent unmount issues */}
                  <div 
                    className={`relative ${qrScanning ? 'block' : 'hidden'}`} 
                    key="qr-scanner-container"
                  >
                    {/* Scanning Tips */}
                    <div className="bg-blue-600 text-white p-3 rounded-t-lg">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-sm font-bold">📱 Scanning Instructions:</p>
                        {!scannerLoading && (
                          <span className="text-xs bg-green-400 text-green-900 px-2 py-0.5 rounded-full font-semibold animate-pulse">
                            ● LIVE
                          </span>
                        )}
                      </div>
                      <ul className="text-xs space-y-1.5">
                        <li>✓ <strong>💡 Top-left button</strong> se flashlight ON/OFF karein</li>
                        <li>✓ <strong>Flashlight ON karke</strong> scan karein - better results milenge</li>
                        <li>✓ Card ko <strong>flat & straight</strong> pakdein - tilted nahi</li>
                        <li>✓ QR code ko <strong>green box ke center</strong> mein align karein</li>
                        <li>✓ Distance: <strong>10-15cm</strong> (6 inches) - bahut paas ya door nahi</li>
                        <li>✓ <strong>2-3 seconds steady</strong> rakhen - camera focus hone do</li>
                        <li>✓ Agar scanning nahi ho rahi, card ko <strong>thoda move</strong> karein</li>
                      </ul>
                    </div>
                    <div 
                      id="qr-reader-region" 
                      key="qr-reader-region-div"
                      className="rounded-b-lg overflow-hidden bg-black relative"
                      style={{ 
                        width: '100%', 
                        minHeight: '400px',
                        maxHeight: '600px'
                      }}
                    >
                      {scannerLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black bg-opacity-70 z-10">
                          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-white mb-4"></div>
                          <p className="text-white text-sm font-semibold">📷 Initializing camera...</p>
                          <p className="text-gray-300 text-xs mt-2">Please wait a moment</p>
                        </div>
                      )}
                      
                      {/* Custom Green Box Overlay - Always visible when scanning */}
                      {!scannerLoading && qrScanning && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-15">
                          {/* Light overlay with transparent center - reduced darkness */}
                          <div className="absolute inset-0 bg-black bg-opacity-20"></div>
                          
                          {/* Green scanning box */}
                          <div 
                            className="relative border-4 border-green-500 rounded-lg shadow-2xl"
                            style={{
                              width: '75vw',
                              height: '75vw',
                              maxWidth: '380px',
                              maxHeight: '380px',
                              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.25), 0 0 15px rgba(34, 197, 94, 0.6)'
                            }}
                          >
                            {/* Corner markers */}
                            <div className="absolute -top-2 -left-2 w-8 h-8 border-t-4 border-l-4 border-green-400"></div>
                            <div className="absolute -top-2 -right-2 w-8 h-8 border-t-4 border-r-4 border-green-400"></div>
                            <div className="absolute -bottom-2 -left-2 w-8 h-8 border-b-4 border-l-4 border-green-400"></div>
                            <div className="absolute -bottom-2 -right-2 w-8 h-8 border-b-4 border-r-4 border-green-400"></div>
                            
                            {/* Center crosshair */}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="text-green-400 text-4xl font-bold opacity-30">+</div>
                            </div>
                            
                            {/* Scanning animation line */}
                            <div 
                              className="absolute left-0 right-0 h-0.5 bg-green-400 opacity-75"
                              style={{
                                animation: 'scan-line 2s linear infinite',
                                boxShadow: '0 0 10px rgba(34, 197, 94, 0.8)'
                              }}
                            ></div>
                          </div>
                        </div>
                      )}
                      
                      {/* Flashlight Toggle Button - Top Left */}
                      {!scannerLoading && qrScanning && (
                        <button
                          onClick={toggleFlashlight}
                          className={`absolute top-4 left-4 z-30 px-4 py-2 rounded-full shadow-lg font-bold text-sm transition-all pointer-events-auto ${
                            flashlightOn 
                              ? 'bg-yellow-400 text-gray-900 animate-pulse' 
                              : 'bg-gray-800 text-white border-2 border-gray-600'
                          }`}
                        >
                          {flashlightOn ? '💡 ON' : '💡 OFF'}
                        </button>
                      )}
                      
                      {/* Scanning Active Indicator */}
                      {!scannerLoading && qrScanning && (
                        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20">
                          <div className="bg-green-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 animate-pulse">
                            <div className="w-2 h-2 bg-white rounded-full animate-ping"></div>
                            <span className="text-xs font-bold">🔍 Scanning Active</span>
                          </div>
                        </div>
                      )}
                      
                      {/* Instructions Overlay */}
                      {!scannerLoading && qrScanning && (
                        <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20 max-w-xs">
                          <div className="bg-black bg-opacity-70 text-white px-4 py-2 rounded-lg text-center">
                            <p className="text-xs font-semibold">📱 QR code ko GREEN BOX ke andar align karein</p>
                            <p className="text-[10px] text-gray-300 mt-1">Auto-detect hoga jab focus hoga</p>
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={stopQrScanner}
                      className="mt-2 w-full bg-red-500 hover:bg-red-600 text-white font-bold py-2 rounded-lg text-sm"
                    >
                      ✕ Stop Scanner
                    </button>
                  </div>

                  {/* Hidden div for image-based scan */}
                  <div id="qr-reader-region-upload" className="hidden" />

                  <div className={`space-y-3 ${qrScanning ? 'hidden' : 'block'}`}>
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

                  {qrError && (
                    <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 space-y-3">
                      <p className="text-sm font-bold text-red-900 mb-2">{qrError}</p>
                      
                      {/* Device-Specific Instructions */}
                      {showPermissionHelp && (() => {
                        const instructions = getCameraPermissionInstructions();
                        return (
                          <div className="bg-white rounded-lg p-4 border border-red-200">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="text-2xl">{deviceInfo.isIOS ? '📱' : deviceInfo.isAndroid ? '🤖' : '💻'}</span>
                              <h4 className="font-bold text-gray-900">{instructions.title}</h4>
                            </div>
                            
                            <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-3">
                              <p className="text-xs font-semibold text-blue-900 mb-2">
                                🔍 Detected: {deviceInfo.deviceName} • {deviceInfo.browserName} {deviceInfo.isPWA ? '• Installed App' : ''}
                              </p>
                            </div>
                            
                            <div className="space-y-2 text-sm">
                              <p className="font-semibold text-gray-800">Follow these steps:</p>
                              <ol className="space-y-2 ml-4">
                                {instructions.steps.map((step, index) => (
                                  <li key={index} className="flex gap-2">
                                    <span className="font-bold text-primary">{index + 1}.</span>
                                    <span className="text-gray-700">{step}</span>
                                  </li>
                                ))}
                              </ol>
                              <div className="bg-amber-50 border border-amber-200 rounded p-2 mt-3">
                                <p className="text-xs text-amber-800">
                                  <strong>📌 Note:</strong> {instructions.note}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                      
                      {/* General Troubleshooting */}
                      {!showPermissionHelp && (
                        <div className="text-xs text-red-700 space-y-1.5">
                          <p className="font-semibold">💡 Troubleshooting Tips:</p>
                          <ul className="ml-4 space-y-1">
                            <li>• Make sure no other app is using the camera</li>
                            <li>• Try closing other tabs/apps that might be using camera</li>
                            <li>• Use the <strong>"Upload Image"</strong> option instead</li>
                            <li>• Refresh the page and try again</li>
                          </ul>
                        </div>
                      )}
                      
                      <button
                        onClick={() => {
                          setQrError('');
                          setShowPermissionHelp(false);
                          // Clear any existing scanner
                          if (qrScannerRef.current) {
                            try {
                              qrScannerRef.current.stop();
                              qrScannerRef.current.clear();
                              qrScannerRef.current = null;
                            } catch (e) {
                              console.error('Error clearing scanner:', e);
                            }
                          }
                        }}
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold py-2 px-4 rounded-lg text-sm transition-colors"
                      >
                        🔄 Clear Error & Try Again
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* QR Scanned Successfully - Aadhaar Card Design */
                <div className="space-y-3">
                  {/* ─── AADHAAR CARD ─── */}
                  <div className="border-2 border-gray-300 rounded-xl overflow-hidden shadow-lg bg-white max-w-sm mx-auto">
                    {/* Top Header - Saffron/Orange */}
                    <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-lg">🏛️</span>
                        <div>
                          <p className="text-[10px] text-white/90 leading-tight font-medium">भारत सरकार</p>
                          <p className="text-[9px] text-white/80 leading-tight">Government of India</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-white tracking-wider">aadhaar</p>
                        <p className="text-[9px] text-white/80">आधार</p>
                      </div>
                    </div>
                    
                    {/* Verified Badge */}
                    <div className="bg-green-50 border-b border-green-200 px-3 py-1.5 flex items-center gap-1.5">
                      <span className="text-green-600 text-sm">✅</span>
                      <span className="text-[11px] font-semibold text-green-700">QR Verified — Data from UIDAI Signed QR Code</span>
                    </div>
                    
                    {qrDisplayData && (
                      <>
                        {/* Main Body - Photo + Details */}
                        <div className="px-4 py-3">
                          <div className="flex gap-3">
                            {/* Photo Section */}
                            <div className="flex-shrink-0">
                              {qrDisplayData.photo ? (
                                <div className="w-[80px] h-[100px] border-2 border-gray-300 rounded bg-gray-50 overflow-hidden">
                                  <img
                                    src={qrDisplayData.photo}
                                    alt="Aadhaar Photo"
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      // JPEG2000 not supported — try as generic image
                                      if (!e.target.dataset.retried) {
                                        e.target.dataset.retried = 'true';
                                        // Try without specific MIME type
                                        const src = e.target.src;
                                        if (src.includes('image/jp2')) {
                                          e.target.src = src.replace('image/jp2', 'image/jpeg');
                                          return;
                                        }
                                      }
                                      // Show fallback person silhouette
                                      e.target.style.display = 'none';
                                      const parent = e.target.parentElement;
                                      if (parent) {
                                        parent.innerHTML = `
                                          <div class="w-full h-full flex flex-col items-center justify-center bg-gray-100 text-gray-400">
                                            <svg class="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
                                              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                                            </svg>
                                            <span class="text-[8px] mt-1 text-center leading-tight">Photo in QR<br/>(JP2 format)</span>
                                          </div>
                                        `;
                                      }
                                    }}
                                  />
                                </div>
                              ) : (
                                <div className="w-[80px] h-[100px] border-2 border-gray-300 rounded bg-gray-100 flex flex-col items-center justify-center text-gray-400">
                                  <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                                  </svg>
                                  <span className="text-[8px] mt-0.5">No Photo</span>
                                </div>
                              )}
                            </div>
                            
                            {/* Details Section */}
                            <div className="flex-1 min-w-0">
                              {/* Name */}
                              <div className="mb-2">
                                <p className="text-[10px] text-gray-500 leading-tight">Name / नाम</p>
                                <p className="text-sm font-bold text-gray-900 leading-tight">{qrDisplayData.name}</p>
                              </div>
                              
                              {/* DOB */}
                              {qrDisplayData.dob !== 'N/A' && (
                                <div className="mb-1.5">
                                  <p className="text-[10px] text-gray-500 leading-tight">DOB / जन्म तिथि</p>
                                  <p className="text-xs font-semibold text-gray-800">{qrDisplayData.dob}</p>
                                </div>
                              )}
                              
                              {/* Gender */}
                              <div className="mb-1.5">
                                <p className="text-[10px] text-gray-500 leading-tight">Gender / लिंग</p>
                                <p className="text-xs font-semibold text-gray-800">
                                  {qrDisplayData.gender}
                                  {qrDisplayData.gender === 'Male' && ' / पुरुष'}
                                  {qrDisplayData.gender === 'Female' && ' / महिला'}
                                </p>
                              </div>
                            </div>
                          </div>
                          
                          {/* Address */}
                          {qrDisplayData.address !== 'N/A' && (
                            <div className="mt-2 pt-2 border-t border-gray-200">
                              <p className="text-[10px] text-gray-500 leading-tight">Address / पता</p>
                              <p className="text-[11px] text-gray-700 leading-snug mt-0.5">{qrDisplayData.address}</p>
                            </div>
                          )}
                        </div>
                        
                        {/* Aadhaar Number - Bottom Section */}
                        <div className="bg-gradient-to-r from-red-600 to-red-700 px-4 py-2.5 text-center">
                          <p className="text-[9px] text-white/70 mb-0.5">Aadhaar No / आधार नंबर</p>
                          <p className="text-xl font-bold text-white tracking-[0.2em] font-mono">{qrDisplayData.aadhaarNumber}</p>
                        </div>
                        
                        {/* Footer */}
                        <div className="bg-gray-50 px-3 py-1.5 flex items-center justify-between border-t">
                          <span className="text-[9px] text-gray-500">{qrDisplayData.qrType}</span>
                          <span className="text-[9px] text-gray-400">{qrDisplayData.scannedAt}</span>
                        </div>
                      </>
                    )}

                    {qrDisplayData?.hasWarning && (
                      <div className="bg-yellow-50 border-t border-yellow-200 px-3 py-2">
                        <p className="text-[11px] text-yellow-700">⚠️ {qrDisplayData.warning}</p>
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
                onRemove={() => removeDocument('aadharFrontImage')}
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
                onRemove={() => removeDocument('aadharBackImage')}
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
                  onRemove={() => removeDocument('panImage')}
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
                  onRemove={() => removeDocument('dlImage')}
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
                onRemove={() => removeDocument('selfieImage')}
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

          {/* ── STEP 4: DigiLocker KYC + Agreement + Signature ── */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-300 rounded-xl p-4">
                <h2 className="text-lg font-bold text-purple-900 mb-1">✅ Step 4: DigiLocker Verification & Agreement</h2>
                <p className="text-sm text-purple-700">DigiLocker se verify karein aur agreement sign karein.</p>
              </div>

              {/* DigiLocker KYC Section */}
              <div className={`border-2 rounded-xl p-4 ${
                digiLockerStatus === 'verified' ? 'bg-green-50 border-green-300' :
                digiLockerStatus === 'error' ? 'bg-red-50 border-red-300' :
                digiLockerStatus === 'skipped' ? 'bg-gray-50 border-gray-300' :
                'bg-blue-50 border-blue-300'
              }`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">🏛️</span>
                  <div>
                    <h3 className="text-sm font-bold text-gray-800">DigiLocker eKYC Verification</h3>
                    <p className="text-[11px] text-gray-600">Govt. of India DigiLocker se identity verify karein</p>
                  </div>
                </div>

                {digiLockerStatus === 'not_started' && (
                  <div className="space-y-3">
                    <div className="bg-white rounded-lg p-3 border text-xs text-gray-600 space-y-1">
                      <p>🔒 DigiLocker aapka Aadhaar, PAN aur doosre documents ko digitally verify karta hai.</p>
                      <p>📱 Aapko DigiLocker login karna hoga (mobile OTP se).</p>
                      <p>✅ Verification ke baad aapka KYC auto-complete ho jaayega.</p>
                    </div>
                    <button
                      onClick={startDigiLockerVerification}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <span>🇮🇳</span> DigiLocker se Verify Karein
                    </button>
                    {mode !== 'tenant' && (
                      <button
                        onClick={() => setDigiLockerStatus('skipped')}
                        className="w-full text-xs text-gray-500 hover:text-gray-700 underline"
                      >
                        Skip DigiLocker (baad me bhi kar sakte hain)
                      </button>
                    )}
                  </div>
                )}

                {digiLockerStatus === 'loading' && (
                  <div className="flex items-center justify-center gap-2 py-4">
                    <span className="animate-spin text-xl">⏳</span>
                    <span className="text-sm text-blue-700 font-semibold">DigiLocker se connect ho raha hai...</span>
                  </div>
                )}

                {digiLockerStatus === 'verified' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-green-700">
                      <span className="text-xl">✅</span>
                      <span className="font-bold text-sm">DigiLocker Verification Successful!</span>
                    </div>
                    {digiLockerData && (
                      <div className="bg-white rounded-lg p-3 border border-green-200 text-xs space-y-1">
                        {digiLockerData.name && <p>Name: <strong>{digiLockerData.name}</strong></p>}
                        {digiLockerData.dob && <p>DOB: <strong>{digiLockerData.dob}</strong></p>}
                        <p>Verified at: <strong>{new Date(digiLockerData.verifiedAt).toLocaleString('en-IN')}</strong></p>
                      </div>
                    )}
                  </div>
                )}

                {digiLockerStatus === 'error' && (
                  <div className="space-y-2">
                    <p className="text-sm text-red-700">❌ {digiLockerError || 'Verification fail ho gaya.'}</p>
                    <button
                      onClick={() => { setDigiLockerStatus('not_started'); setDigiLockerError(''); }}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Dobara try karein
                    </button>
                  </div>
                )}

                {digiLockerStatus === 'skipped' && (
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">⏭️ DigiLocker verification skip kiya gaya</p>
                    <button
                      onClick={() => setDigiLockerStatus('not_started')}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Verify karein
                    </button>
                  </div>
                )}
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

const DocumentUploadCard = ({ label, field, image, status, reason, confidence, isProcessing, onFileChange, onCamera, onRemove, isSelfie = false }) => {
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
            onClick={onRemove}
            className="text-xs text-red-500 hover:underline"
            type="button"
          >
            🗑️ Remove & Re-capture
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => onCamera()}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg text-xs transition-colors"
            type="button"
          >
            📷 {isSelfie ? 'Take Selfie' : 'Scan Document'}
          </button>
          <label className="flex-1 cursor-pointer">
            <div className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-2.5 rounded-lg text-xs text-center transition-colors border border-gray-300">
              📁 Gallery / File
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
