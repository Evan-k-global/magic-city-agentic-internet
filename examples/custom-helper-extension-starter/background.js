const DEFAULT_BASE_URL = 'https://magic-city.ai';
const HELPER_PLUGIN_ID = 'acme-shopping-helper';
const HELPER_OWNER_AGENT_ID = 'acme-shopping-agent';
const RUNNER_PROTOCOL = 'declarative-v1';

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function base64Url(bytes) {
  const values = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomNonce() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function domainForUrl(value = '') {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeMissionAction(value = '') {
  const raw = String(value || '').trim().toLowerCase().replace(/[\s.-]+/g, '_');
  const aliases = {
    navigate: 'browser_open',
    open: 'browser_open',
    read: 'read_public_page',
    inspect: 'read_public_page',
    click: 'browser_click',
    type: 'browser_type',
    fill: 'browser_type',
    cart: 'prepare_cart',
    checkout: 'browser_click'
  };
  return aliases[raw] || raw || 'inspect';
}

async function getConfig() {
  return chrome.storage.local.get([
    'baseUrl',
    'deviceToken',
    'holderPublicJwk',
    'holderPrivateJwk',
    'registered',
    'last'
  ]);
}

async function saveConfig(patch) {
  await chrome.storage.local.set(patch);
  return getConfig();
}

async function api(path, { method = 'GET', body = null, bearer = '' } = {}) {
  const config = await getConfig();
  const response = await fetch(`${String(config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      'x-magic-city-runner-surface': 'chrome-extension',
      'x-magic-city-runner-protocol': RUNNER_PROTOCOL,
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `magic_city_${response.status}`);
  return data;
}

async function ensureHolderKey() {
  const config = await getConfig();
  if (config.holderPublicJwk && config.holderPrivateJwk) return config;
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const holderPublicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const holderPrivateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return saveConfig({ holderPublicJwk, holderPrivateJwk });
}

async function proofOfPossession(session, { action, targetUrl }) {
  const config = await ensureHolderKey();
  const capability = session.missionBoundAuth || {};
  const nonce = randomNonce();
  const signingInput = stableJson({
    schema: 'magic-city-mission-pop-v1',
    capabilityId: capability.capabilityId,
    capabilityHash: capability.tokenHash,
    action: normalizeMissionAction(action),
    targetDomain: domainForUrl(targetUrl),
    nonce,
    previousHash: session.missionBoundaryLatestHash || null,
    audience: capability.audience || null,
    sessionId: capability.subject?.sessionId || session.id || null
  });
  const privateKey = await crypto.subtle.importKey('jwk', config.holderPrivateJwk, { name: 'Ed25519' }, false, ['sign']);
  const signature = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(signingInput));
  return {
    nonce,
    previousHash: session.missionBoundaryLatestHash || null,
    publicKeyJwk: config.holderPublicJwk,
    signature: base64Url(signature)
  };
}

async function pair({ baseUrl, code }) {
  await saveConfig({ baseUrl: String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '') });
  const data = await api('/native-runner/extension/pairing/claim', {
    method: 'POST',
    body: {
      code,
      extensionVersion: chrome.runtime.getManifest().version,
      extensionId: chrome.runtime.id
    }
  });
  await saveConfig({ deviceToken: data.setup?.deviceToken || '', registered: false, last: 'paired' });
  await ensureHolderKey();
  return data;
}

async function register() {
  const config = await getConfig();
  if (!config.deviceToken) throw new Error('not_paired');
  const permissions = await chrome.permissions.getAll();
  const origins = (permissions.origins || []).filter((origin) => origin.startsWith('https://'));
  const data = await api('/plugins/register', {
    method: 'POST',
    bearer: config.deviceToken,
    body: {
      pluginId: HELPER_PLUGIN_ID,
      ownerAgentId: HELPER_OWNER_AGENT_ID,
      kind: 'browser',
      endpoint: `chrome-extension://${chrome.runtime.id}`,
      executionAgent: true,
      capabilities: [
        'browser-worker-agent',
        'browser.extension_dom_executor',
        'browser.prepare_cart',
        'browser.open_checkout',
        'browser.pause_before_sensitive_action'
      ],
      tools: ['browser.inspect', 'browser.prepare_cart', 'browser.open_checkout'],
      privacyModes: ['local-private', 'private'],
      metadata: {
        customHelperAgent: true,
        executionBackend: 'extension_dom_executor',
        runnerProtocol: RUNNER_PROTOCOL,
        proofMode: 'mission-bound-auth-holder-signatures',
        browserPermissionOrigins: origins,
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version
      }
    }
  });
  await saveConfig({ registered: true, last: 'registered' });
  return data;
}

async function claim(session) {
  const config = await ensureHolderKey();
  const data = await api(`/connectors/sessions/${encodeURIComponent(session.id)}/claim`, {
    method: 'POST',
    bearer: config.deviceToken,
    body: {
      pluginId: HELPER_PLUGIN_ID,
      holderPublicKeyJwk: config.holderPublicJwk
    }
  });
  return data.session || session;
}

async function checkpoint(session, { label, state, missionAction, targetUrl, browser, planAction }) {
  const config = await getConfig();
  const proof = await proofOfPossession(session, { action: missionAction, targetUrl });
  const data = await api(`/connectors/sessions/${encodeURIComponent(session.id)}/checkpoint`, {
    method: 'POST',
    bearer: config.deviceToken,
    body: {
      pluginId: HELPER_PLUGIN_ID,
      label,
      state,
      missionAction,
      targetUrl,
      browser,
      proofOfPossession: proof,
      planHash: session.extensionMissionPlan?.planHash,
      planActionId: planAction?.id,
      planActionStatus: 'completed'
    }
  });
  return data.session || session;
}

async function fulfill(session, report) {
  const config = await getConfig();
  const proof = await proofOfPossession(session, { action: 'handoff', targetUrl: report.finalUrl || report.url || '' });
  return api(`/connectors/sessions/${encodeURIComponent(session.id)}/fulfill`, {
    method: 'POST',
    bearer: config.deviceToken,
    body: {
      pluginId: HELPER_PLUGIN_ID,
      missionAction: 'handoff',
      proofOfPossession: proof,
      status: report.status || 'failed',
      result: {
        browserExecution: {
          mode: 'custom_extension_dom_executor',
          browserRuntimeMode: 'user_chrome_extension',
          finalUrl: report.finalUrl || '',
          stopState: report.stopState || 'starter_not_implemented',
          stopEvidence: report.stopEvidence || 'Starter helper registered and proved the mission boundary. Add local browser execution logic here.',
          rawCredentialsAccess: false,
          rawPaymentAccess: false,
          finalApprovalRequired: true
        },
        needsUserHandoff: true,
        finalUrl: report.finalUrl || ''
      },
      handoff: { label: 'Review in browser', url: report.finalUrl || '' },
      notes: report.stopEvidence || 'Custom helper starter stopped before browser execution.',
      fundingDisposition: report.status === 'fulfilled' ? 'hold' : 'release',
      proofRef: `${HELPER_PLUGIN_ID}:${session.id}:local-browser`,
      planHash: session.extensionMissionPlan?.planHash
    }
  });
}

async function executeSession(rawSession) {
  const session = await claim(rawSession);
  const plan = session.extensionMissionPlan || {};
  const firstAction = Array.isArray(plan.actions) ? plan.actions[0] : null;
  const targetUrl = firstAction?.url || plan.startUrl || rawSession.selections?.targetUrl || '';
  const browser = {
    url: targetUrl,
    title: 'Custom helper starter',
    browserState: 'inspect',
    checkoutSummary: {
      stage: 'starter',
      nextAction: 'Add local browser execution logic'
    }
  };
  const afterCheckpoint = await checkpoint(session, {
    label: 'Custom helper starter checkpoint',
    state: 'needs_implementation',
    missionAction: firstAction?.missionAction || 'read_public_page',
    targetUrl,
    browser,
    planAction: firstAction
  });
  await fulfill(afterCheckpoint, {
    status: 'failed',
    finalUrl: targetUrl,
    stopState: 'starter_not_implemented'
  });
  return { sessionId: session.id, status: 'starter_not_implemented' };
}

async function pollOnce() {
  const config = await getConfig();
  if (!config.deviceToken) throw new Error('not_paired');
  if (!config.registered) await register();
  const data = await api('/connectors/sessions', { bearer: config.deviceToken });
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  const executed = [];
  for (const session of sessions.slice(0, 1)) executed.push(await executeSession(session));
  await saveConfig({ last: `polled ${sessions.length}; executed ${executed.length}` });
  return { sessions: sessions.length, executed };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'HELPER_PAIR') return { ok: true, data: await pair(message) };
    if (message?.type === 'HELPER_REGISTER') return { ok: true, data: await register() };
    if (message?.type === 'HELPER_POLL_ONCE') return { ok: true, result: await pollOnce() };
    if (message?.type === 'HELPER_STATUS') {
      const config = await getConfig();
      return { ok: true, paired: Boolean(config.deviceToken), registered: Boolean(config.registered), last: config.last || '' };
    }
    return { ok: false, error: 'unknown_message' };
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
