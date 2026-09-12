import { PARTNER_CONFIG } from './partner-config.js';

const CONTROL_PLANE_ORIGIN = String(PARTNER_CONFIG.controlPlaneOrigin || '').replace(/\/+$/, '');
const HELPER_PLUGIN_ID = PARTNER_CONFIG.helperPluginId;
const HELPER_OWNER_AGENT_ID = PARTNER_CONFIG.helperOwnerAgentId;
const LAUNCH_ORIGINS = new Set(PARTNER_CONFIG.launchOrigins || []);
const OPTIONAL_MERCHANT_ORIGINS = PARTNER_CONFIG.optionalMerchantOrigins || [];
const RUNNER_PROTOCOL = 'declarative-v1';
const PLAN_SCHEMA = 'magic-city-browser-plan-v1';

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
  const config = await chrome.storage.local.get([
    'deviceToken',
    'pairedControlPlaneOrigin',
    'holderPublicJwk',
    'holderPrivateJwk',
    'registered',
    'last'
  ]);
  if (config.deviceToken && config.pairedControlPlaneOrigin !== CONTROL_PLANE_ORIGIN) {
    await chrome.storage.local.remove([
      'deviceToken',
      'pairedControlPlaneOrigin',
      'holderPublicJwk',
      'holderPrivateJwk',
      'registered'
    ]);
    return { last: 'Control-plane origin changed. Pair this build again.' };
  }
  return config;
}

async function saveConfig(patch) {
  await chrome.storage.local.set(patch);
  return getConfig();
}

async function api(path, { method = 'GET', body = null, bearer = '' } = {}) {
  const response = await fetch(`${CONTROL_PLANE_ORIGIN}${path}`, {
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

async function pair({ code }) {
  const data = await api('/native-runner/extension/pairing/claim', {
    method: 'POST',
    body: {
      code,
      extensionVersion: chrome.runtime.getManifest().version,
      extensionId: chrome.runtime.id
    }
  });
  await chrome.storage.local.remove(['deviceToken', 'holderPublicJwk', 'holderPrivateJwk', 'registered']);
  await saveConfig({
    deviceToken: data.setup?.deviceToken || '',
    pairedControlPlaneOrigin: CONTROL_PLANE_ORIGIN,
    registered: false,
    last: 'paired'
  });
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
        'browser.open',
        'browser.read_public_page',
        'browser.pause_before_sensitive_action'
      ],
      tools: ['browser.open', 'browser.inspect'],
      privacyModes: ['local-private', 'private'],
      metadata: {
        customHelperAgent: true,
        executionBackend: 'extension_dom_executor',
        runnerProtocol: RUNNER_PROTOCOL,
        proofMode: 'mission-bound-auth-holder-signatures',
        starterCapability: 'read_only_page_summary',
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
  const extensionDispatchNonce = String(session.extensionRunDispatch?.nonce || '').trim();
  if (!extensionDispatchNonce) throw new Error('extension_run_dispatch_required');
  const data = await api(`/connectors/sessions/${encodeURIComponent(session.id)}/claim`, {
    method: 'POST',
    bearer: config.deviceToken,
    body: {
      pluginId: HELPER_PLUGIN_ID,
      extensionDispatchNonce,
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
          stopState: report.stopState || 'unsupported_plan_action',
          stopEvidence: report.stopEvidence || 'The read-only example completed its supported action and stopped before unsupported browser work.',
          pageSummary: report.pageSummary || null,
          rawCredentialsAccess: false,
          rawPaymentAccess: false,
          finalApprovalRequired: true
        },
        needsUserHandoff: true,
        finalUrl: report.finalUrl || '',
        artifacts: report.pageSummary
          ? [{
              name: 'read-only-page-summary.json',
              mimeType: 'application/json',
              content: JSON.stringify(report.pageSummary, null, 2)
            }]
          : []
      },
      handoff: { label: 'Review in browser', url: report.finalUrl || '' },
      notes: report.stopEvidence || 'Read-only custom helper example completed and stopped before unsupported actions.',
      fundingDisposition: report.status === 'fulfilled' ? 'hold' : 'release',
      proofRef: `${HELPER_PLUGIN_ID}:${session.id}:local-browser`,
      planHash: session.extensionMissionPlan?.planHash
    }
  });
}

function originForUrl(value = '') {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function permissionPatternForOrigin(origin = '') {
  return `${String(origin).replace(/\/+$/, '')}/*`;
}

function validateReadOnlyAction(session, action) {
  const plan = session.extensionMissionPlan || {};
  if (plan.schema !== PLAN_SCHEMA || plan.protocol !== RUNNER_PROTOCOL) throw new Error('unsupported_mission_plan');
  if (!plan.planHash || !action?.id) throw new Error('mission_plan_binding_missing');
  const missionAction = normalizeMissionAction(action.missionAction || action.action || action.type);
  if (missionAction !== 'browser_open') throw new Error(`unsupported_plan_action:${missionAction}`);
  const targetUrl = String(action.url || plan.startUrl || '').trim();
  const origin = originForUrl(targetUrl);
  if (!origin || !LAUNCH_ORIGINS.has(origin)) throw new Error('mission_origin_not_allowed');
  if (domainForUrl(targetUrl) !== String(plan.targetDomain || '').replace(/^www\./, '')) {
    throw new Error('mission_plan_domain_mismatch');
  }
  return { targetUrl, origin, missionAction };
}

async function readPublicPage(targetUrl, origin) {
  const permission = permissionPatternForOrigin(origin);
  const granted = await chrome.permissions.contains({ origins: [permission] });
  if (!granted) throw new Error(`site_permission_required:${origin}`);
  const tab = await chrome.tabs.create({ url: targetUrl, active: true });
  const tabId = tab.id;
  if (!Number.isInteger(tabId)) throw new Error('browser_tab_not_created');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (!current) throw new Error('browser_tab_closed');
    if (current.status === 'complete') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const compact = (value, limit) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
      return {
        url: location.href,
        title: compact(document.title, 160),
        heading: compact(document.querySelector('h1')?.textContent, 240),
        description: compact(document.querySelector('meta[name="description"]')?.content, 320)
      };
    }
  });
  const summary = result?.result || {};
  if (originForUrl(summary.url) !== origin) throw new Error('browser_redirect_origin_not_allowed');
  return { tabId, summary };
}

async function executeSession(rawSession) {
  const session = await claim(rawSession);
  const plan = session.extensionMissionPlan || {};
  const actionIndex = Number(session.extensionMissionPlanState?.nextActionIndex || 0);
  const firstAction = Array.isArray(plan.actions) ? plan.actions[actionIndex] : null;
  const { targetUrl, origin, missionAction } = validateReadOnlyAction(session, firstAction);
  const { tabId, summary } = await readPublicPage(targetUrl, origin);
  const browser = {
    url: summary.url,
    title: summary.title,
    tabId,
    browserState: 'read_only_page_summarized',
    pageSummary: summary,
    checkoutSummary: {
      stage: 'read_only_demo',
      nextAction: 'Implement the next signed action in partner code'
    }
  };
  const afterCheckpoint = await checkpoint(session, {
    label: 'Read approved page',
    state: 'read_only_page_summarized',
    missionAction,
    targetUrl: summary.url,
    browser,
    planAction: firstAction
  });
  await fulfill(afterCheckpoint, {
    status: 'failed',
    finalUrl: summary.url,
    stopState: 'unsupported_plan_action',
    stopEvidence: 'The starter opened and summarized the approved page, then stopped before the next unsupported plan action.',
    pageSummary: summary
  });
  return { sessionId: session.id, status: 'read_only_demo_complete', pageSummary: summary };
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
    if (message?.type === 'HELPER_GRANT_SITE_ACCESS') {
      if (!OPTIONAL_MERCHANT_ORIGINS.length) return { ok: true, granted: true, origins: [] };
      const granted = await chrome.permissions.request({ origins: OPTIONAL_MERCHANT_ORIGINS });
      return { ok: granted, granted, origins: OPTIONAL_MERCHANT_ORIGINS };
    }
    if (message?.type === 'HELPER_POLL_ONCE') return { ok: true, result: await pollOnce() };
    if (message?.type === 'HELPER_STATUS') {
      const config = await getConfig();
      return {
        ok: true,
        paired: Boolean(config.deviceToken),
        registered: Boolean(config.registered),
        last: config.last || '',
        controlPlaneOrigin: CONTROL_PLANE_ORIGIN,
        launchOrigins: Array.from(LAUNCH_ORIGINS),
        extensionName: PARTNER_CONFIG.extensionName,
        profile: PARTNER_CONFIG.profile
      };
    }
    return { ok: false, error: 'unknown_message' };
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
