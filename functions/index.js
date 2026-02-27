const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');

const DEFAULT_TIMEOUT_MS = Number(process.env.KYC_API_TIMEOUT_MS || 12000);
const DEFAULT_STATE_TTL_SECONDS = Number(process.env.KYC_STATE_TTL_SECONDS || 600);

const resolveConfig = () => {
  const clientId = process.env.DIGILOCKER_CLIENT_ID || process.env.CLIENT_ID || '';
  const clientSecret = process.env.DIGILOCKER_CLIENT_SECRET || process.env.CLIENT_SECRET || '';
  const redirectUri = process.env.DIGILOCKER_REDIRECT_URI || process.env.REDIRECT_URI || '';
  const authorizationEndpoint = process.env.DIGILOCKER_AUTHORIZATION_ENDPOINT || process.env.AUTHORIZATION_ENDPOINT || '';
  const tokenEndpoint = process.env.DIGILOCKER_TOKEN_ENDPOINT || process.env.TOKEN_ENDPOINT || '';
  const profileEndpoint = process.env.DIGILOCKER_PROFILE_ENDPOINT || process.env.PROFILE_ENDPOINT || '';
  const scopes = process.env.DIGILOCKER_SCOPES || process.env.SCOPES || 'openid profile issued_documents';

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

const isKycTestMode = () => String(process.env.KYC_TEST_MODE || '').toLowerCase() === 'true';

const randomState = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
const sendJson = (res, status, payload) => res.status(status).json(payload);

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

const logKycEvent = (event, details = {}, severity = 'info') => {
  const payload = {
    component: 'digilocker-kyc',
    event,
    timestamp: new Date().toISOString(),
    ...details
  };

  if (severity === 'error') {
    logger.error(payload);
    return;
  }

  if (severity === 'warn') {
    logger.warn(payload);
    return;
  }

  logger.info(payload);
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
    body: body.toString(),
    signal
  }), timeoutMs, 'Token request timed out');

  const tokenPayload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok) {
    throw new Error(`Token exchange failed: ${tokenResponse.status} ${JSON.stringify(tokenPayload)}`);
  }
  if (!tokenPayload.access_token) {
    throw new Error('Token exchange failed: access_token missing');
  }
  return tokenPayload;
};

const fetchProfileInternal = async (accessToken, cfg, options = {}) => {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const simulateFailure = options.simulateFailure;
  const tenantId = options.tenantId || 'test-tenant';

  if (!accessToken) {
    throw new Error('Missing access token');
  }

  if (simulateFailure === 'profile') {
    throw new Error('Simulated profile failure');
  }

  if (isKycTestMode()) {
    return {
      full_name: 'Test Tenant',
      dob: '1994-01-15',
      address: 'Mock Address, Test City, India',
      txn_id: 'mock_txn_kyc_001',
      tenant_id: tenantId
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
  logKycEvent('INITIATED', {
    tenantId,
    testMode: isKycTestMode(),
    simulateFailure: simulateFailure || null
  });

  const stateCheck = validateStateWindow({ state, expectedState, stateCreatedAt });
  if (!stateCheck.ok) {
    logKycEvent('FAILURE_REASON', { tenantId, stage: 'token', reason: stateCheck.reason }, 'warn');
    return {
      httpStatus: 400,
      payload: standardizedResponse(false, 'token', stateCheck.reason, { tenantId })
    };
  }

  if (!code || String(code).trim().length === 0) {
    logKycEvent('FAILURE_REASON', { tenantId, stage: 'token', reason: 'Invalid code' }, 'warn');
    return {
      httpStatus: 400,
      payload: standardizedResponse(false, 'token', 'Invalid authorization code', { tenantId })
    };
  }

  const cfg = resolveConfig();
  if (!isKycTestMode() && (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri || !cfg.tokenEndpoint || !cfg.profileEndpoint)) {
    logKycEvent('FAILURE_REASON', { tenantId, stage: 'token', reason: 'OAuth config missing' }, 'error');
    return {
      httpStatus: 500,
      payload: standardizedResponse(false, 'token', 'OAuth config missing', { tenantId })
    };
  }

  try {
    const tokenPayload = await exchangeCodeInternal(code, cfg, { simulateFailure });
    logKycEvent('TOKEN_EXCHANGE_SUCCESS', {
      tenantId,
      hasAccessToken: Boolean(tokenPayload.access_token),
      tokenType: tokenPayload.token_type || null,
      expiresIn: tokenPayload.expires_in || null
    });

    const profile = await fetchProfileInternal(tokenPayload.access_token, cfg, { simulateFailure, tenantId });
    logKycEvent('PROFILE_FETCH_SUCCESS', {
      tenantId,
      profileKeys: Object.keys(profile || {})
    });

    if (simulateFailure === 'write') {
      logKycEvent('FAILURE_REASON', {
        tenantId,
        stage: 'write',
        reason: 'Simulated write failure'
      }, 'warn');
      return {
        httpStatus: 500,
        payload: standardizedResponse(false, 'write', 'Simulated write failure', { tenantId })
      };
    }

    logKycEvent('FIRESTORE_WRITE_SUCCESS', {
      tenantId,
      skipped: true,
      reason: 'Test flow does not write to Firestore'
    });

    return {
      httpStatus: 200,
      payload: standardizedResponse(true, 'write', 'KYC flow test completed', {
        tenantId,
        testMode: isKycTestMode(),
        tokenMeta: {
          tokenType: tokenPayload.token_type || null,
          expiresIn: tokenPayload.expires_in || null,
          scope: tokenPayload.scope || null
        },
        profile
      })
    };
  } catch (error) {
    const msg = safeErrorMessage(error);
    const stage = /token/i.test(msg) || /code/i.test(msg)
      ? 'token'
      : (/profile/i.test(msg) ? 'profile' : 'write');

    logKycEvent('FAILURE_REASON', { tenantId, stage, reason: msg }, 'error');
    return {
      httpStatus: 500,
      payload: standardizedResponse(false, stage, msg, { tenantId })
    };
  }
};

exports.initiateKyc = onRequest(async (req, res) => {
  try {
    if (req.method !== 'GET') {
      return sendJson(res, 405, standardizedResponse(false, 'token', 'Method not allowed', {}));
    }

    const cfg = resolveConfig();
    if (!cfg.clientId || !cfg.redirectUri || !cfg.authorizationEndpoint) {
      return sendJson(res, 500, standardizedResponse(false, 'token', 'OAuth config missing', {}));
    }

    const state = randomState();
    const authUrl = new URL(cfg.authorizationEndpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', cfg.clientId);
    authUrl.searchParams.set('redirect_uri', cfg.redirectUri);
    authUrl.searchParams.set('scope', cfg.scopes);
    authUrl.searchParams.set('state', state);

    logKycEvent('INITIATED', { statePreview: state.slice(0, 8), flow: 'initiate' });
    return sendJson(res, 200, standardizedResponse(true, 'token', 'KYC initiated', {
      state,
      authorizationUrl: authUrl.toString(),
      stateCreatedAt: Date.now()
    }));
  } catch (error) {
    const msg = safeErrorMessage(error);
    logKycEvent('FAILURE_REASON', { stage: 'token', reason: msg }, 'error');
    return sendJson(res, 500, standardizedResponse(false, 'token', 'Failed to initiate KYC', { reason: msg }));
  }
});

exports.exchangeAuthorizationCode = onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, standardizedResponse(false, 'token', 'Method not allowed', {}));
    }

    const cfg = resolveConfig();
    if (!isKycTestMode() && (!cfg.clientId || !cfg.clientSecret || !cfg.redirectUri || !cfg.tokenEndpoint)) {
      return sendJson(res, 500, standardizedResponse(false, 'token', 'OAuth token config missing', {}));
    }

    const code = req.body?.code;
    if (!code) {
      return sendJson(res, 400, standardizedResponse(false, 'token', 'Authorization code is required', {}));
    }

    const tokenPayload = await exchangeCodeInternal(code, cfg, { simulateFailure: req.body?.simulateFailure });
    logKycEvent('TOKEN_EXCHANGE_SUCCESS', {
      hasAccessToken: Boolean(tokenPayload.access_token),
      tokenType: tokenPayload.token_type || null,
      expiresIn: tokenPayload.expires_in || null
    });

    return sendJson(res, 200, standardizedResponse(true, 'token', 'Token exchange successful', {
      tokenType: tokenPayload.token_type || null,
      expiresIn: tokenPayload.expires_in || null,
      scope: tokenPayload.scope || null
    }));
  } catch (error) {
    const msg = safeErrorMessage(error);
    logKycEvent('FAILURE_REASON', { stage: 'token', reason: msg }, 'error');
    return sendJson(res, 500, standardizedResponse(false, 'token', 'Token exchange failed', { reason: msg }));
  }
});

exports.fetchUserProfile = onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, standardizedResponse(false, 'profile', 'Method not allowed', {}));
    }

    const cfg = resolveConfig();
    if (!isKycTestMode() && !cfg.profileEndpoint) {
      return sendJson(res, 500, standardizedResponse(false, 'profile', 'OAuth profile config missing', {}));
    }

    const accessToken = req.body?.accessToken;
    if (!accessToken) {
      return sendJson(res, 400, standardizedResponse(false, 'profile', 'accessToken is required', {}));
    }

    const profile = await fetchProfileInternal(accessToken, cfg, { simulateFailure: req.body?.simulateFailure, tenantId: req.body?.tenantId });
    logKycEvent('PROFILE_FETCH_SUCCESS', { keys: Object.keys(profile || {}) });

    return sendJson(res, 200, standardizedResponse(true, 'profile', 'Profile fetch successful', { profile }));
  } catch (error) {
    const msg = safeErrorMessage(error);
    logKycEvent('FAILURE_REASON', { stage: 'profile', reason: msg }, 'error');
    return sendJson(res, 500, standardizedResponse(false, 'profile', 'Profile fetch failed', { reason: msg }));
  }
});

exports.handleKycCallback = onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, standardizedResponse(false, 'token', 'Method not allowed', {}));
    }

    const code = req.body?.code;
    const state = req.body?.state;
    const expectedState = req.body?.expectedState;
    const stateCreatedAt = req.body?.stateCreatedAt;
    const tenantId = String(req.body?.tenantId || '');

    if (!tenantId) {
      return sendJson(res, 400, standardizedResponse(false, 'write', 'tenantId is required', {}));
    }

    if (!code || !state || !expectedState) {
      return sendJson(res, 400, standardizedResponse(false, 'token', 'code, state and expectedState are required', { tenantId }));
    }

    const result = await runKycPipeline({
      tenantId,
      code,
      state,
      expectedState,
      stateCreatedAt,
      simulateFailure: req.body?.simulateFailure
    });

    return sendJson(res, result.httpStatus, result.payload);
  } catch (error) {
    const msg = safeErrorMessage(error);
    logKycEvent('FAILURE_REASON', { stage: 'write', reason: msg }, 'error');
    return sendJson(res, 500, standardizedResponse(false, 'write', 'KYC callback failed', { reason: msg }));
  }
});

exports.testKycFlow = onRequest(async (req, res) => {
  try {
    if (req.method !== 'POST') {
      return sendJson(res, 405, standardizedResponse(false, 'token', 'Method not allowed', {}));
    }

    const tenantId = String(req.body?.tenantId || '').trim();
    const state = req.body?.state || 'test_state';
    const expectedState = req.body?.expectedState || 'test_state';
    const stateCreatedAt = req.body?.stateCreatedAt || Date.now();
    const simulateFailure = req.body?.simulateFailure;
    const code = req.body?.code || (isKycTestMode() ? 'MOCK_AUTH_CODE' : 'INVALID_CODE');

    if (!tenantId) {
      logKycEvent('FAILURE_REASON', { stage: 'token', reason: 'Missing tenantId in test flow' }, 'warn');
      return sendJson(res, 400, standardizedResponse(false, 'token', 'tenantId is required', {}));
    }

    const result = await runKycPipeline({
      tenantId,
      code,
      state,
      expectedState,
      stateCreatedAt,
      simulateFailure
    });

    return sendJson(res, result.httpStatus, result.payload);
  } catch (error) {
    const msg = safeErrorMessage(error);
    logKycEvent('FAILURE_REASON', { stage: 'write', reason: msg, flow: 'testKycFlow' }, 'error');
    return sendJson(res, 500, standardizedResponse(false, 'write', 'testKycFlow failed', { reason: msg }));
  }
});
