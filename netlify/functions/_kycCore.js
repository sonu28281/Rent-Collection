import admin from 'firebase-admin';
import crypto from 'crypto';
import { 
  listIssuedDocuments, 
  findAadhaarDocument, 
  fetchDocument, 
  parseAadhaarXML 
} from './_kycDocuments.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.KYC_API_TIMEOUT_MS || 12000);
const DEFAULT_STATE_TTL_SECONDS = Number(process.env.KYC_STATE_TTL_SECONDS || 600);

const json = (statusCode, payload, extraHeaders = {}) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    ...extraHeaders
  },
  body: JSON.stringify(payload)
});

const buildCorsHeaders = (event) => ({
  'Access-Control-Allow-Origin': event?.headers?.origin || '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  Vary: 'Origin'
});

const standardizedResponse = (success, stage, message, data = {}) => ({
  success,
  stage,
  message,
  data
});

const safeErrorMessage = (error) => {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  return error.message || 'Unexpected failure';
};

const randomState = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// PKCE (Proof Key for Code Exchange) helpers for OAuth 2.0 security
const generateCodeVerifier = () => {
  // Generate random 43-128 character string (using 64 bytes = 128 hex chars, then slice to 128)
  return crypto.randomBytes(64).toString('hex').slice(0, 128);
};

const generateCodeChallenge = (verifier) => {
  // SHA256 hash of verifier, then base64url encode
  return crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
};

const normalizeScopes = (value) => {
  if (!value || typeof value !== 'string') {
    return 'openid';
  }
  // Split by space, trim, and join back
  const scopes = value.split(/\s+/).map(s => s.trim()).filter(Boolean).join(' ');
  return scopes || 'openid';
};

const resolveConfig = () => {
  const clientId = process.env.DIGILOCKER_CLIENT_ID || process.env.CLIENT_ID || '';
  const clientSecret = process.env.DIGILOCKER_CLIENT_SECRET || process.env.CLIENT_SECRET || '';
  const redirectUri = process.env.DIGILOCKER_REDIRECT_URI || process.env.REDIRECT_URI || '';
  const authorizationEndpoint = process.env.DIGILOCKER_AUTHORIZATION_ENDPOINT || process.env.AUTHORIZATION_ENDPOINT || '';
  const tokenEndpoint = process.env.DIGILOCKER_TOKEN_ENDPOINT || process.env.TOKEN_ENDPOINT || '';
  const profileEndpoint = process.env.DIGILOCKER_PROFILE_ENDPOINT || process.env.PROFILE_ENDPOINT || '';
  const scopes = normalizeScopes(process.env.DIGILOCKER_SCOPES || process.env.SCOPES || 'openid profile');

  return {
    clientId,
    clientSecret,
    redirectUri,
    authorizationEndpoint,
    tokenEndpoint,
    profileEndpoint,
    scopes
  };
};

const getMissingOAuthFields = (cfg, requirements = {}) => {
  const missing = [];
  if (requirements.clientId && !cfg.clientId) missing.push('DIGILOCKER_CLIENT_ID');
  if (requirements.clientSecret && !cfg.clientSecret) missing.push('DIGILOCKER_CLIENT_SECRET');
  if (requirements.redirectUri && !isUsableUrl(cfg.redirectUri)) missing.push('DIGILOCKER_REDIRECT_URI');
  if (requirements.authorizationEndpoint && !isUsableUrl(cfg.authorizationEndpoint)) missing.push('DIGILOCKER_AUTHORIZATION_ENDPOINT');
  if (requirements.tokenEndpoint && !isUsableUrl(cfg.tokenEndpoint)) missing.push('DIGILOCKER_TOKEN_ENDPOINT');
  if (requirements.profileEndpoint && !isUsableUrl(cfg.profileEndpoint)) missing.push('DIGILOCKER_PROFILE_ENDPOINT');
  return missing;
};

const isUsableUrl = (value) => {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || /^PASTE_/i.test(trimmed)) return false;
  return /^https:\/\//i.test(trimmed);
};

const isKycTestMode = () => {
  const isProductionDeploy = String(process.env.CONTEXT || '').toLowerCase() === 'production';
  if (isProductionDeploy) {
    return false;
  }

  const envFlag = String(process.env.KYC_TEST_MODE || '').toLowerCase() === 'true';
  const testByMissingConfig = String(process.env.KYC_TEST_IF_CONFIG_MISSING || 'false').toLowerCase() === 'true';
  return envFlag || testByMissingConfig;
};

const getAdminApp = () => {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON for Firestore write');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON');
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id;
  if (!projectId) {
    throw new Error('Missing FIREBASE_PROJECT_ID for Firestore write');
  }

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId
  });
};

const extractProfileValue = (profile, keys = []) => {
  for (const key of keys) {
    const value = profile?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const normalizeString = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .replace(/[^a-z0-9\s]/gi, '');  // Remove special characters
};

const normalizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return '';
  // Extract only digits
  const digits = phone.replace(/\D/g, '');
  // Return last 10 digits (Indian mobile number)
  return digits.slice(-10);
};

const validateKycMatch = async ({ tenantId, profile, documentData }) => {
  const app = getAdminApp();
  const db = admin.firestore(app);

  // Fetch tenant document
  const tenantDoc = await db.collection('tenants').doc(tenantId).get();
  if (!tenantDoc.exists) {
    throw new Error('Tenant not found');
  }

  const tenant = tenantDoc.data();
  const tenantName = tenant?.name || '';
  const tenantPhone = tenant?.phone || tenant?.phoneNumber || '';

  // Fetch tenantProfile document (Step 1 filled data)
  const profileRef = await db.collection('tenantProfiles').doc(tenantId).get();
  const profileData = profileRef.exists ? profileRef.data() : {};
  
  // Get filled form data from Step 1
  const filledFirstName = profileData.firstName || '';
  const filledLastName = profileData.lastName || '';
  const filledFullName = `${filledFirstName} ${filledLastName}`.trim();
  const filledPhone = profileData.phoneNumber || tenantPhone;

  // Extract DigiLocker data
  const normalizedProfile = profile?.profile || profile || {};
  const digilockerName = extractProfileValue(normalizedProfile, ['fullName', 'name']);
  const digilockerPhone = extractProfileValue(normalizedProfile, ['mobile', 'mobileNumber', 'phone', 'phoneNumber']);
  
  // Also check Aadhaar document for name/phone if available
  const aadhaarName = documentData?.name || '';

  console.log('🔍 Validation check:', {
    tenant: { name: tenantName, phone: tenantPhone },
    filledForm: { name: filledFullName, phone: filledPhone },
    digilocker: { name: digilockerName, phone: digilockerPhone },
    aadhaar: { name: aadhaarName }
  });

  // Normalize names for comparison
  const normalizedTenantName = normalizeString(tenantName);
  const normalizedFilledName = normalizeString(filledFullName);
  const normalizedDigilockerName = normalizeString(digilockerName);
  const normalizedAadhaarName = normalizeString(aadhaarName);

  // Priority: Check against filled form name first, then tenant name
  const nameToCheck = normalizedFilledName || normalizedTenantName;
  
  // Check if DigiLocker name matches filled form or tenant name
  const nameMatch = 
    (normalizedDigilockerName && nameToCheck.includes(normalizedDigilockerName)) ||
    (normalizedDigilockerName && normalizedDigilockerName.includes(nameToCheck)) ||
    (normalizedAadhaarName && nameToCheck.includes(normalizedAadhaarName)) ||
    (normalizedAadhaarName && normalizedAadhaarName.includes(nameToCheck));

  if (!nameMatch) {
    const checkedName = filledFullName || tenantName;
    const errorMsg = `❌ Name mismatch! Your filled name: "${checkedName}" | DigiLocker name: "${digilockerName || aadhaarName}" | Names must match for security. Please use DigiLocker account with your own name.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  console.log('✅ Name validation passed');

  // Validate phone number if both are available
  const phoneToCheck = filledPhone || tenantPhone;
  let phoneMatch = false;
  if (phoneToCheck && digilockerPhone) {
    const normalizedCheckedPhone = normalizePhone(phoneToCheck);
    const normalizedDigilockerPhone = normalizePhone(digilockerPhone);

    if (normalizedCheckedPhone && normalizedDigilockerPhone && normalizedCheckedPhone !== normalizedDigilockerPhone) {
      const errorMsg = `❌ Mobile number mismatch! Your phone: "${phoneToCheck}" | DigiLocker phone: "${digilockerPhone}" | Numbers must match for security.`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    phoneMatch = true;
    console.log('✅ Phone validation passed');
  } else {
    console.log('ℹ️ Phone validation skipped (not enough data)');
  }

  // Return validation details for storage
  return { 
    nameMatch: true, 
    phoneMatch,
    validationDetails: {
      filledName: filledFullName || tenantName,
      digilockerName: digilockerName || aadhaarName,
      filledPhone: phoneToCheck,
      digilockerPhone: digilockerPhone || '',
      validatedAt: new Date().toISOString(),
      validationSource: filledFullName ? 'form_data' : 'tenant_name'
    }
  };
};

const writeKycToFirestore = async ({ tenantId, profile, tokenPayload, documentData, validationDetails }) => {
  const app = getAdminApp();
  const db = admin.firestore(app);

  const normalizedProfile = profile?.profile || profile || {};
  const name = extractProfileValue(normalizedProfile, ['fullName', 'name']);
  const dob = extractProfileValue(normalizedProfile, ['dob', 'dateOfBirth']);
  const address = extractProfileValue(normalizedProfile, ['address', 'permanentAddress']);
  const digilockerTxnId = tokenPayload?.transaction_id || tokenPayload?.txn_id || '';

  const kycData = {
    verified: true,
    verifiedBy: 'DigiLocker',
    verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    name,
    dob,
    address,
    digilockerTxnId
  };
  
  // Add Aadhaar document data if available
  if (documentData) {
    kycData.aadhaar = documentData;
    kycData.hasDocuments = true;
  }
  
  // Add validation details for transparency
  if (validationDetails) {
    kycData.validation = {
      filledName: validationDetails.filledName,
      digilockerName: validationDetails.digilockerName,
      filledPhone: validationDetails.filledPhone,
      digilockerPhone: validationDetails.digilockerPhone,
      nameMatch: validationDetails.nameMatch || true,
      phoneMatch: validationDetails.phoneMatch || false,
      validatedAt: validationDetails.validatedAt,
      validationSource: validationDetails.validationSource
    };
  }

  await db.collection('tenants').doc(tenantId).set({
    kyc: kycData
  }, { merge: true });

  return {
    verified: true,
    verifiedBy: 'DigiLocker',
    verifiedAt: new Date().toISOString(),
    name,
    dob,
    address,
    digilockerTxnId,
    ...(documentData ? { aadhaar: documentData, hasDocuments: true } : {})
  };
};

const withTimeout = async (operation, timeoutMs, timeoutMessage) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const validateStateWindow = ({ state, expectedState, stateCreatedAt }) => {
  if (!state || !expectedState) {
    return { ok: false, reason: 'Missing OAuth state or expectedState' };
  }

  if (state !== expectedState) {
    return { ok: false, reason: 'State mismatch' };
  }

  if (stateCreatedAt) {
    const ts = Number(stateCreatedAt);
    if (!Number.isFinite(ts)) {
      return { ok: false, reason: 'Invalid stateCreatedAt' };
    }

    const ageSeconds = Math.floor((Date.now() - ts) / 1000);
    if (ageSeconds > DEFAULT_STATE_TTL_SECONDS) {
      return { ok: false, reason: 'State expired' };
    }
  }

  return { ok: true, reason: '' };
};

const parseJsonBody = (event) => {
  if (!event?.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
};

const exchangeCodeInternal = async (code, cfg, options = {}) => {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const simulateFailure = options.simulateFailure;
  const codeVerifier = options.codeVerifier;

  if (!code || String(code).trim().length === 0) {
    throw new Error('Invalid authorization code');
  }

  if (simulateFailure === 'token') {
    throw new Error('Simulated token failure');
  }

  if (isKycTestMode()) {
    if (String(code).toUpperCase() === 'INVALID_CODE') {
      throw new Error('Invalid authorization code');
    }

    return {
      access_token: 'mock_access_token_123',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: cfg.scopes,
      transaction_id: 'mock_txn_kyc_001'
    };
  }

  const bodyParams = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret
  };
  
  // Add PKCE code_verifier if provided (required by DigiLocker)
  if (codeVerifier) {
    bodyParams.code_verifier = codeVerifier;
    console.log('🔑 PKCE code_verifier included in token exchange');
  }
  
  const body = new URLSearchParams(bodyParams);

  console.log('🔵 Token exchange request to:', cfg.tokenEndpoint);
  console.log('🔵 Authorization code:', code.substring(0, 20) + '...');
  
  const tokenResponse = await withTimeout((signal) => fetch(cfg.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal
  }), timeoutMs, 'Token exchange timed out');

  console.log('📡 Token response status:', tokenResponse.status);
  
  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  
  if (!tokenResponse.ok) {
    console.error('❌ Token exchange failed:', tokenResponse.status);
    console.error('❌ Error payload:', JSON.stringify(tokenPayload, null, 2));
    throw new Error(`Token exchange failed: ${tokenResponse.status} ${JSON.stringify(tokenPayload)}`);
  }

  console.log('✅ Token exchange successful');
  console.log('📥 Token type:', tokenPayload.token_type);
  console.log('📥 Expires in:', tokenPayload.expires_in, 'seconds');
  console.log('📥 Scope:', tokenPayload.scope);
  console.log('📥 Access token (first 30 chars):', tokenPayload.access_token?.substring(0, 30) + '...');
  
  if (!tokenPayload.access_token) {
    console.error('❌ Token exchange succeeded but access_token missing in response');
    throw new Error('Token exchange succeeded but access_token missing');
  }

  return tokenPayload;
};

const fetchProfileInternal = async (accessToken, cfg, options = {}) => {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const simulateFailure = options.simulateFailure;
  const tenantId = options.tenantId || 'test-tenant';

  if (!accessToken) {
    throw new Error('Access token is required');
  }

  if (simulateFailure === 'profile') {
    throw new Error('Simulated profile failure');
  }

  if (isKycTestMode()) {
    return {
      profile: {
        fullName: 'Test Tenant',
        phone: '+919999999999',
        email: 'tenant@example.com',
        dob: '1998-01-10',
        address: 'Test Address Lane, India',
        documentType: 'aadhaar',
        documentNumberMasked: 'XXXX-XXXX-1234'
      },
      account: {
        issuer: 'digilocker',
        verifiedAt: new Date().toISOString(),
        tenantId
      }
    };
  }

  // Build list of endpoints to try with fallback
  const baseUrl = 'https://digilocker.meripehchaan.gov.in';
  const endpointsToTry = [];
  
  // Add configured endpoint first
  if (cfg.profileEndpoint) {
    endpointsToTry.push(cfg.profileEndpoint);
  }
  
  // Add common DigiLocker profile endpoints as fallbacks
  const fallbackPaths = [
    '/public/oauth2/3/user',      // API v3 - most recent
    '/public/oauth2/1/user',      // API v1
    '/public/oauth2/3/userinfo',  // OpenID Connect standard v3
    '/public/oauth2/1/userinfo',  // OpenID Connect standard v1
  ];
  
  // Only add fallbacks that aren't already in the list
  for (const path of fallbackPaths) {
    const fullUrl = baseUrl + path;
    if (!endpointsToTry.includes(fullUrl)) {
      endpointsToTry.push(fullUrl);
    }
  }

  console.log('🔵 Will try profile endpoints in order:', JSON.stringify(endpointsToTry, null, 2));
  console.log('🔵 Using access token:', accessToken.substring(0, 20) + '...');
  
  let lastError = null;
  
  // Try each endpoint until one succeeds
  for (let i = 0; i < endpointsToTry.length; i++) {
    const endpoint = endpointsToTry[i];
    console.log(`\n🔍 Trying endpoint ${i + 1}/${endpointsToTry.length}: ${endpoint}`);
    
    try {
      const profileResponse = await withTimeout((signal) => fetch(endpoint, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        },
        signal
      }), timeoutMs, 'Profile request timed out');

      console.log('📡 Profile response status:', profileResponse.status);
      console.log('📡 Profile response headers:', JSON.stringify(Object.fromEntries(profileResponse.headers.entries())));
      
      if (profileResponse.ok) {
        const profilePayload = await profileResponse.json().catch((err) => {
          console.error('❌ Failed to parse profile response as JSON:', err.message);
          throw new Error('Invalid JSON response from profile endpoint');
        });
        
        console.log('📥 Profile payload received:', JSON.stringify(profilePayload, null, 2));
        console.log(`✅ Successfully fetched profile from: ${endpoint}`);
        
        return profilePayload;
      } else {
        // Non-200 response
        const errorPayload = await profileResponse.text();
        const errorMsg = `${profileResponse.status} - ${errorPayload}`;
        console.warn(`⚠️ Endpoint failed: ${errorMsg}`);
        lastError = new Error(errorMsg);
        // Continue to next endpoint
      }
    } catch (err) {
      console.warn(`⚠️ Endpoint error: ${err.message}`);
      lastError = err;
      // Continue to next endpoint
    }
  }
  
  // All endpoints failed
  const errorMsg = `All profile endpoints failed. Last error: ${lastError?.message || 'Unknown'}`;
  console.error('❌ Profile fetch completely failed after trying all endpoints');
  console.error('❌ Endpoints tried:', JSON.stringify(endpointsToTry, null, 2));
  console.error('❌ Access token (first 30 chars):', accessToken.substring(0, 30) + '...');
  console.error('❌ Suggestion: Check if access token is valid and has correct scope');
  throw new Error(errorMsg);
};

const runKycPipeline = async ({ tenantId, code, state, expectedState, stateCreatedAt, simulateFailure, codeVerifier }) => {
  const stateCheck = validateStateWindow({ state, expectedState, stateCreatedAt });
  if (!stateCheck.ok) {
    return {
      httpStatus: 400,
      payload: standardizedResponse(false, 'token', stateCheck.reason, { tenantId })
    };
  }

  if (!code || String(code).trim().length === 0) {
    return {
      httpStatus: 400,
      payload: standardizedResponse(false, 'token', 'Invalid authorization code', { tenantId })
    };
  }

  const cfg = resolveConfig();
  const missingFields = getMissingOAuthFields(cfg, {
    clientId: true,
    clientSecret: true,
    redirectUri: true,
    tokenEndpoint: true,
    profileEndpoint: true
  });
  if (!isKycTestMode() && missingFields.length > 0) {
    return {
      httpStatus: 500,
      payload: standardizedResponse(false, 'token', 'OAuth config missing', { tenantId, missingFields })
    };
  }

  try {
    const tokenPayload = await exchangeCodeInternal(code, cfg, { simulateFailure, codeVerifier });
    const profile = await fetchProfileInternal(tokenPayload.access_token, cfg, { simulateFailure, tenantId });

    // Debug: Log configured scopes
    console.log('🔍 Configured scopes:', cfg.scopes);

    // Fetch Aadhaar document if scope includes issued_documents
    let documentData = null;
    if (cfg.scopes.includes('issued_documents') || cfg.scopes.includes('issued:aadhaar')) {
      try {
        console.log('📄 Attempting to fetch Aadhaar documents from DigiLocker...');
        
        const documents = await listIssuedDocuments(tokenPayload.access_token);
        console.log(`📥 Found ${documents?.length || 0} documents`);
        
        if (documents && documents.length > 0) {
          const aadhaarDoc = findAadhaarDocument(documents);
          
          if (aadhaarDoc) {
            console.log('✅ Aadhaar document found:', aadhaarDoc.name);
            
            const docContent = await fetchDocument(tokenPayload.access_token, aadhaarDoc.uri);
            
            if (docContent.type === 'xml') {
              const aadhaarDetails = parseAadhaarXML(docContent.content);
              
              // Store parsed data in Firestore (NO Firebase Storage needed! 🆓)
              documentData = {
                aadhaarNumber: aadhaarDetails.aadhaarNumber,
                name: aadhaarDetails.name,
                dob: aadhaarDetails.dob,
                gender: aadhaarDetails.gender,
                address: aadhaarDetails.address,
                pincode: aadhaarDetails.pincode,
                documentUri: aadhaarDoc.uri,
                documentName: aadhaarDoc.name,
                source: 'DigiLocker',
                fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
                verified: true
              };
              
              // Optionally store XML content as base64 (if small enough < 50KB)
              const xmlSize = Buffer.byteLength(docContent.content, 'utf8');
              if (xmlSize < 50000) {
                documentData.xmlContentBase64 = Buffer.from(docContent.content).toString('base64');
                documentData.xmlSizeBytes = xmlSize;
                console.log(`✅ XML content stored in Firestore (${xmlSize} bytes)`);
              } else {
                console.log(`⚠️ XML too large (${xmlSize} bytes), storing metadata only`);
              }
              
              console.log('✅ Aadhaar data prepared (Firestore only - FREE!)');
            } else {
              console.warn('⚠️ Aadhaar document is not XML format:', docContent.type);
            }
          } else {
            console.warn('⚠️ No Aadhaar document found in DigiLocker');
          }
        } else {
          console.warn('⚠️ No documents returned from DigiLocker');
        }
      } catch (docError) {
        console.error('❌ Error fetching documents:', docError.message);
        console.error('❌ Document error stack:', docError.stack);
        // Don't fail the entire KYC process, just log the error
      }
    } else {
      console.log('ℹ️ Document fetching skipped - scope does not include issued_documents');
    }

    if (simulateFailure === 'write') {
      return {
        httpStatus: 500,
        payload: standardizedResponse(false, 'write', 'Simulated write failure', { tenantId })
      };
    }

    let storedKyc = null;
    if (!isKycTestMode()) {
      // Validate that DigiLocker data matches tenant data before writing
      console.log('🔐 Validating KYC data matches tenant...');
      const validationResult = await validateKycMatch({ tenantId, profile, documentData });
      console.log('✅ Validation passed:', validationResult.validationDetails);
      
      storedKyc = await writeKycToFirestore({ 
        tenantId, 
        profile, 
        tokenPayload, 
        documentData,
        validationDetails: validationResult.validationDetails 
      });
    }

    return {
      httpStatus: 200,
      payload: standardizedResponse(true, 'write', isKycTestMode() ? 'KYC flow test completed' : 'KYC verification completed', {
        tenantId,
        testMode: isKycTestMode(),
        tokenMeta: {
          tokenType: tokenPayload.token_type || null,
          expiresIn: tokenPayload.expires_in || null,
          scope: tokenPayload.scope || null
        },
        profile,
        ...(storedKyc ? { kyc: storedKyc } : {})
      })
    };
  } catch (error) {
    const msg = safeErrorMessage(error);
    const stage = /token/i.test(msg) || /code/i.test(msg)
      ? 'token'
      : (/profile/i.test(msg) ? 'profile' : 'write');

    return {
      httpStatus: 500,
      payload: standardizedResponse(false, stage, msg, { tenantId })
    };
  }
};

const handlePreflight = (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {}, buildCorsHeaders(event));
  }
  return null;
};

const initiateKycHandler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'GET') {
    return json(405, standardizedResponse(false, 'token', 'Method not allowed', {}), buildCorsHeaders(event));
  }

  const cfg = resolveConfig();
  const state = randomState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  
  const missingFields = getMissingOAuthFields(cfg, {
    clientId: true,
    redirectUri: true,
    authorizationEndpoint: true
  });
  if (missingFields.length > 0 && !isKycTestMode()) {
    return json(500, standardizedResponse(false, 'token', 'OAuth config missing', { missingFields }), buildCorsHeaders(event));
  }

  if (missingFields.length > 0 && isKycTestMode()) {
    const redirectTarget = process.env.DIGILOCKER_TEST_REDIRECT_TARGET || 'https://tenants.callvia.in/kyc/callback';
    const authorizationUrl = `${redirectTarget}?code=MOCK_AUTH_CODE&state=${encodeURIComponent(state)}`;
    return json(200, standardizedResponse(true, 'token', 'KYC initiated (test mode)', {
      state,
      authorizationUrl,
      stateCreatedAt: Date.now(),
      codeVerifier
    }), buildCorsHeaders(event));
  }

  const authUrl = new URL(cfg.authorizationEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', cfg.clientId);
  authUrl.searchParams.set('redirect_uri', cfg.redirectUri);
  authUrl.searchParams.set('scope', cfg.scopes);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  return json(200, standardizedResponse(true, 'token', 'KYC initiated', {
    state,
    authorizationUrl: authUrl.toString(),
    stateCreatedAt: Date.now(),
    codeVerifier
  }), buildCorsHeaders(event));
};

const exchangeAuthorizationCodeHandler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'POST') {
    return json(405, standardizedResponse(false, 'token', 'Method not allowed', {}), buildCorsHeaders(event));
  }

  const body = parseJsonBody(event);
  const cfg = resolveConfig();
  const missingTokenFields = getMissingOAuthFields(cfg, {
    clientId: true,
    clientSecret: true,
    redirectUri: true,
    tokenEndpoint: true
  });
  if (!isKycTestMode() && missingTokenFields.length > 0) {
    return json(500, standardizedResponse(false, 'token', 'OAuth token config missing', { missingFields: missingTokenFields }), buildCorsHeaders(event));
  }

  const code = body?.code;
  if (!code) {
    return json(400, standardizedResponse(false, 'token', 'Authorization code is required', {}), buildCorsHeaders(event));
  }

  try {
    const tokenPayload = await exchangeCodeInternal(code, cfg, { simulateFailure: body?.simulateFailure });
    return json(200, standardizedResponse(true, 'token', 'Token exchange successful', {
      tokenType: tokenPayload.token_type || null,
      expiresIn: tokenPayload.expires_in || null,
      scope: tokenPayload.scope || null
    }), buildCorsHeaders(event));
  } catch (error) {
    return json(500, standardizedResponse(false, 'token', 'Token exchange failed', { reason: safeErrorMessage(error) }), buildCorsHeaders(event));
  }
};

const fetchUserProfileHandler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'POST') {
    return json(405, standardizedResponse(false, 'profile', 'Method not allowed', {}), buildCorsHeaders(event));
  }

  const body = parseJsonBody(event);
  const cfg = resolveConfig();
  const missingProfileFields = getMissingOAuthFields(cfg, {
    profileEndpoint: true
  });
  if (!isKycTestMode() && missingProfileFields.length > 0) {
    return json(500, standardizedResponse(false, 'profile', 'OAuth profile config missing', { missingFields: missingProfileFields }), buildCorsHeaders(event));
  }

  const accessToken = body?.accessToken;
  if (!accessToken) {
    return json(400, standardizedResponse(false, 'profile', 'accessToken is required', {}), buildCorsHeaders(event));
  }

  try {
    const profile = await fetchProfileInternal(accessToken, cfg, { simulateFailure: body?.simulateFailure, tenantId: body?.tenantId });
    return json(200, standardizedResponse(true, 'profile', 'Profile fetch successful', { profile }), buildCorsHeaders(event));
  } catch (error) {
    return json(500, standardizedResponse(false, 'profile', 'Profile fetch failed', { reason: safeErrorMessage(error) }), buildCorsHeaders(event));
  }
};

const handleKycCallbackHandler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'POST') {
    return json(405, standardizedResponse(false, 'token', 'Method not allowed', {}), buildCorsHeaders(event));
  }

  const body = parseJsonBody(event);
  const code = body?.code;
  const state = body?.state;
  const expectedState = body?.expectedState;
  const stateCreatedAt = body?.stateCreatedAt;
  const codeVerifier = body?.codeVerifier;
  const tenantId = String(body?.tenantId || '');

  if (!tenantId) {
    return json(400, standardizedResponse(false, 'write', 'tenantId is required', {}), buildCorsHeaders(event));
  }

  if (!code || !state || !expectedState) {
    return json(400, standardizedResponse(false, 'token', 'code, state and expectedState are required', { tenantId }), buildCorsHeaders(event));
  }

  const result = await runKycPipeline({
    tenantId,
    code,
    state,
    expectedState,
    stateCreatedAt,
    codeVerifier,
    simulateFailure: body?.simulateFailure
  });

  return json(result.httpStatus, result.payload, buildCorsHeaders(event));
};

const testKycFlowHandler = async (event) => {
  const preflight = handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== 'POST') {
    return json(405, standardizedResponse(false, 'token', 'Method not allowed', {}), buildCorsHeaders(event));
  }

  const body = parseJsonBody(event);
  const tenantId = String(body?.tenantId || '').trim();
  const state = body?.state || 'test_state';
  const expectedState = body?.expectedState || 'test_state';
  const stateCreatedAt = body?.stateCreatedAt || Date.now();
  const simulateFailure = body?.simulateFailure;
  const codeVerifier = body?.codeVerifier;
  const code = body?.code || (isKycTestMode() ? 'MOCK_AUTH_CODE' : 'INVALID_CODE');

  if (!tenantId) {
    return json(400, standardizedResponse(false, 'token', 'tenantId is required', {}), buildCorsHeaders(event));
  }

  const result = await runKycPipeline({
    tenantId,
    code,
    state,
    expectedState,
    stateCreatedAt,
    codeVerifier,
    simulateFailure
  });

  return json(result.httpStatus, result.payload, buildCorsHeaders(event));
};

export {
  initiateKycHandler,
  exchangeAuthorizationCodeHandler,
  fetchUserProfileHandler,
  handleKycCallbackHandler,
  testKycFlowHandler
};