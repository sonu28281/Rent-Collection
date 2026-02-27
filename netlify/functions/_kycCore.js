import admin from 'firebase-admin';

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

const normalizeScopes = (value) => {
  return 'openid';
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

const writeKycToFirestore = async ({ tenantId, profile, tokenPayload }) => {
  const app = getAdminApp();
  const db = admin.firestore(app);

  const normalizedProfile = profile?.profile || profile || {};
  const name = extractProfileValue(normalizedProfile, ['fullName', 'name']);
  const dob = extractProfileValue(normalizedProfile, ['dob', 'dateOfBirth']);
  const address = extractProfileValue(normalizedProfile, ['address', 'permanentAddress']);
  const digilockerTxnId = tokenPayload?.transaction_id || tokenPayload?.txn_id || '';

  await db.collection('tenants').doc(tenantId).set({
    kyc: {
      verified: true,
      verifiedBy: 'DigiLocker',
      verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      name,
      dob,
      address,
      digilockerTxnId
    }
  }, { merge: true });

  return {
    verified: true,
    verifiedBy: 'DigiLocker',
    verifiedAt: new Date().toISOString(),
    name,
    dob,
    address,
    digilockerTxnId
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

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret
  });

  const tokenResponse = await withTimeout((signal) => fetch(cfg.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal
  }), timeoutMs, 'Token exchange timed out');

  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) {
    throw new Error(`Token exchange failed: ${tokenResponse.status} ${JSON.stringify(tokenPayload)}`);
  }

  if (!tokenPayload.access_token) {
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

  const profileResponse = await withTimeout((signal) => fetch(cfg.profileEndpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal
  }), timeoutMs, 'Profile request timed out');

  const profilePayload = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok) {
    throw new Error(`Profile fetch failed: ${profileResponse.status} ${JSON.stringify(profilePayload)}`);
  }

  return profilePayload;
};

const runKycPipeline = async ({ tenantId, code, state, expectedState, stateCreatedAt, simulateFailure }) => {
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
  const missingConfig = !cfg.clientId || !cfg.clientSecret || !isUsableUrl(cfg.redirectUri) || !isUsableUrl(cfg.tokenEndpoint) || !isUsableUrl(cfg.profileEndpoint);
  if (!isKycTestMode() && missingConfig) {
    return {
      httpStatus: 500,
      payload: standardizedResponse(false, 'token', 'OAuth config missing', { tenantId })
    };
  }

  try {
    const tokenPayload = await exchangeCodeInternal(code, cfg, { simulateFailure });
    const profile = await fetchProfileInternal(tokenPayload.access_token, cfg, { simulateFailure, tenantId });

    if (simulateFailure === 'write') {
      return {
        httpStatus: 500,
        payload: standardizedResponse(false, 'write', 'Simulated write failure', { tenantId })
      };
    }

    let storedKyc = null;
    if (!isKycTestMode()) {
      storedKyc = await writeKycToFirestore({ tenantId, profile, tokenPayload });
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
  const missingConfig = !cfg.clientId || !isUsableUrl(cfg.redirectUri) || !isUsableUrl(cfg.authorizationEndpoint);
  if (missingConfig && !isKycTestMode()) {
    return json(500, standardizedResponse(false, 'token', 'OAuth config missing', {}), buildCorsHeaders(event));
  }

  if (missingConfig && isKycTestMode()) {
    const redirectTarget = process.env.DIGILOCKER_TEST_REDIRECT_TARGET || 'https://tenants.callvia.in/kyc/callback';
    const authorizationUrl = `${redirectTarget}?code=MOCK_AUTH_CODE&state=${encodeURIComponent(state)}`;
    return json(200, standardizedResponse(true, 'token', 'KYC initiated (test mode)', {
      state,
      authorizationUrl,
      stateCreatedAt: Date.now()
    }), buildCorsHeaders(event));
  }

  const authUrl = new URL(cfg.authorizationEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', cfg.clientId);
  authUrl.searchParams.set('redirect_uri', cfg.redirectUri);
  authUrl.searchParams.set('scope', cfg.scopes);
  authUrl.searchParams.set('state', state);

  return json(200, standardizedResponse(true, 'token', 'KYC initiated', {
    state,
    authorizationUrl: authUrl.toString(),
    stateCreatedAt: Date.now()
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
  if (!isKycTestMode() && (!cfg.clientId || !cfg.clientSecret || !isUsableUrl(cfg.redirectUri) || !isUsableUrl(cfg.tokenEndpoint))) {
    return json(500, standardizedResponse(false, 'token', 'OAuth token config missing', {}), buildCorsHeaders(event));
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
  if (!isKycTestMode() && !isUsableUrl(cfg.profileEndpoint)) {
    return json(500, standardizedResponse(false, 'profile', 'OAuth profile config missing', {}), buildCorsHeaders(event));
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