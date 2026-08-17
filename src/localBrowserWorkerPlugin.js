import { runAssistedBrowserWorkerExecution } from './browserExecution.js';
import { writeExecutionArtifact } from './executionArtifacts.js';
import { shouldProcessExecutionSession, buildExecutionResult, describeCompletionState } from './executionRuntime.js';
import crypto from 'node:crypto';

const BASE_URL = process.env.MAGIC_CITY_BASE_URL || 'http://127.0.0.1:4411';
const NATIVE_RUNNER_TOKEN =
  process.env.MAGIC_CITY_NATIVE_RUNNER_TOKEN ||
  process.env.MAGIC_CITY_RUNNER_DEVICE_TOKEN ||
  '';
const API_KEY =
  NATIVE_RUNNER_TOKEN
    ? ''
    : (
        process.env.MAGIC_CITY_PLUGIN_API_KEY ||
        String(process.env.PUBLIC_API_KEYS || '')
          .split(',')
          .map((value) => value.trim())
          .find(Boolean) ||
        ''
      );
const PLUGIN_ID = process.env.MAGIC_CITY_BROWSER_WORKER_PLUGIN_ID || 'local-browser-worker-plugin';
const OWNER_AGENT_ID = process.env.MAGIC_CITY_BROWSER_WORKER_OWNER || 'browser-worker-agent';
const POLL_MS = Math.max(1500, Number(process.env.MAGIC_CITY_PLUGIN_POLL_MS ?? 4000));
const BROWSER_WORKER_TIMEOUT_MS = Math.max(15000, Number(process.env.MAGIC_CITY_BROWSER_WORKER_TIMEOUT_MS ?? 90000));
const RUN_ONCE = process.argv.includes('--once');
const LOCAL_AUTHENTICATED_RUNNER = PLUGIN_ID === 'local-authenticated-browser-plugin'
  || Boolean(process.env.MAGIC_CITY_BROWSER_CDP_URL || process.env.MAGIC_CITY_CHROME_CDP_URL || process.env.MAGIC_CITY_BROWSER_USER_DATA_DIR);
const RUNTIME_HOLDER_KEYPAIR = crypto.generateKeyPairSync('ed25519');
const RUNTIME_HOLDER_PUBLIC_JWK = RUNTIME_HOLDER_KEYPAIR.publicKey.export({ format: 'jwk' });

function headers() {
  return {
    'content-type': 'application/json',
    ...(NATIVE_RUNNER_TOKEN ? { authorization: `Bearer ${NATIVE_RUNNER_TOKEN}` } : {}),
    ...(API_KEY ? { 'x-api-key': API_KEY } : {})
  };
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {})
    }
  });
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const text = await response.text();
  if (!contentType.includes('application/json')) {
    const snippet = text.slice(0, 120).replace(/\s+/g, ' ').trim();
    throw new Error(`non_json_response:${path}:${response.status}:${contentType || 'unknown'}:${snippet}`);
  }
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`invalid_json:${path}:${response.status}:${String(error.message)}`);
  }
  if (!response.ok) {
    throw new Error(data.error || `http_${response.status}`);
  }
  return data;
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableJsonValue(nested)])
    );
  }
  return value;
}

function stableJsonStringify(value) {
  return JSON.stringify(stableJsonValue(value));
}

function normalizeMissionDomain(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  }
}

function normalizeMissionAction(action = '') {
  const raw = String(action || '').trim().toLowerCase().replace(/[\s.-]+/g, '_');
  const aliases = {
    open: 'browser_open',
    navigate: 'browser_open',
    goto: 'browser_open',
    read: 'read_public_page',
    inspect_page: 'read_public_page',
    click: 'browser_click',
    type: 'browser_type',
    fill: 'browser_type',
    upload: 'browser_upload',
    vault: 'access_vault',
    email: 'send_email',
    send_gmail: 'send_email',
    submit: 'final_submit',
    final_approval: 'final_submit'
  };
  return aliases[raw] || raw || 'inspect';
}

function inferMissionActionFromProgress(progress = {}) {
  const state = String(progress.state || '').trim().toLowerCase();
  const label = String(progress.label || '').trim().toLowerCase();
  if (/open/.test(`${state} ${label}`)) return 'browser_open';
  if (/click|cart|checkout/.test(`${state} ${label}`)) return 'browser_click';
  if (/fill|field|address|query|search|prepared|preparing/.test(`${state} ${label}`)) return 'browser_type';
  if (/payment/.test(`${state} ${label}`)) return 'prepare_x402_payment';
  if (/final|submit|purchase|order/.test(`${state} ${label}`)) return 'final_submit';
  if (progress.browser?.url || progress.browser?.currentUrl || progress.targetUrl) return 'read_public_page';
  return 'inspect';
}

function buildMissionPopProof(session, { action = 'inspect', targetUrl = '', nonce = '' } = {}) {
  const capability = session?.missionBoundAuth || null;
  if (!capability?.capabilityId || !capability?.tokenHash) return null;
  const safeNonce = nonce || crypto.randomBytes(24).toString('base64url');
  const signingInput = stableJsonStringify({
    schema: 'magic-city-mission-pop-v1',
    capabilityId: capability.capabilityId,
    capabilityHash: capability.tokenHash,
    action: normalizeMissionAction(action),
    targetDomain: normalizeMissionDomain(targetUrl),
    nonce: safeNonce,
    previousHash: session.missionBoundaryLatestHash || null,
    audience: capability.audience || null,
    sessionId: capability.subject?.sessionId || session.id || null
  });
  return {
    nonce: safeNonce,
    previousHash: session.missionBoundaryLatestHash || null,
    publicKeyJwk: RUNTIME_HOLDER_PUBLIC_JWK,
    signature: crypto.sign(null, Buffer.from(signingInput, 'utf8'), RUNTIME_HOLDER_KEYPAIR.privateKey).toString('base64url')
  };
}

function targetUrlForProgress(session, progress = {}) {
  return String(
    progress.browser?.url ||
    progress.browser?.currentUrl ||
    progress.targetUrl ||
    session.finalSelections?.targetUrl ||
    session.selections?.targetUrl ||
    session.resolvedOrderUrl ||
    ''
  ).trim();
}

async function sendSignedCheckpoint(session, progress = {}) {
  const missionAction = normalizeMissionAction(progress.missionAction || progress.action || inferMissionActionFromProgress(progress));
  const targetUrl = targetUrlForProgress(session, progress);
  const response = await api(`/connectors/sessions/${session.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      ...progress,
      missionAction,
      targetUrl,
      proofOfPossession: buildMissionPopProof(session, { action: missionAction, targetUrl })
    })
  });
  return response.session || session;
}

function buildBrowserWorkerArtifact(session, browserExecution) {
  const selections = session.finalSelections || session.selections || {};
  const paymentProfile = browserExecution?.paymentProfile || {};
  const paymentPolicy = browserExecution?.paymentPolicy || {};
  const localCheckoutRunner = browserExecution?.localCheckoutRunner || {};
  const artifact = writeExecutionArtifact({
    sessionId: session.id,
    lane: 'browser',
    label: 'browser-worker-handoff',
    extension: 'md',
    content: [
      '# Assisted browser worker handoff',
      '',
      `- Session: ${session.id}`,
      `- Target URL: ${browserExecution?.targetUrl || selections.targetUrl || 'n/a'}`,
      `- Final URL: ${browserExecution?.finalUrl || 'n/a'}`,
      `- Page title: ${browserExecution?.pageTitle || 'n/a'}`,
      `- Goal: ${browserExecution?.goal || selections.goal || 'n/a'}`,
      `- Constraints: ${browserExecution?.constraints || selections.constraints || 'n/a'}`,
      `- Budget: ${browserExecution?.budget || selections.budget || 'n/a'}`,
      `- Confirmation email ready: ${browserExecution?.confirmationEmail ? 'yes' : 'no'}`,
      `- Confirmation email: ${browserExecution?.confirmationEmail || 'n/a'}`,
      `- Stop condition: ${browserExecution?.stopCondition || selections.stopCondition || 'n/a'}`,
      `- Stop state: ${browserExecution?.stopState || 'n/a'}`,
      `- Stop evidence: ${browserExecution?.stopEvidence || 'n/a'}`,
      `- Browser mode: ${browserExecution?.mode || 'n/a'}`,
      `- Browser runtime: ${browserExecution?.browserRuntimeMode || 'n/a'}`,
      `- Browser available: ${browserExecution?.browserAvailable ? 'yes' : 'no'}`,
      `- Agent card profile: ${paymentProfile.cardName || selections.cardName || 'n/a'}`,
      `- Funding source: ${paymentProfile.fundingSource || selections.fundingSource || 'n/a'}`,
      `- Card authority: ${paymentPolicy.cardAuthority || paymentProfile.cardAuthority || selections.cardAuthority || 'issuer_or_card_wallet'}`,
      `- Payment entry authority: ${paymentPolicy.paymentEntryAuthority || paymentProfile.paymentEntryAuthority || selections.paymentEntryAuthority || 'apple_google_browser_autofill_or_payment_sheet'}`,
      `- Mission authority: ${paymentPolicy.missionAuthority || paymentProfile.missionAuthority || selections.missionAuthority || 'magic_city'}`,
      `- Proof authority: ${paymentPolicy.proofAuthority || paymentProfile.proofAuthority || selections.proofAuthority || 'zeko_mission_bound_auth'}`,
      `- Local payment credential ready: ${paymentPolicy.localPaymentCredentialReady || paymentProfile.localPaymentCredentialReady || selections.localPaymentCredentialReady ? 'yes' : 'no'}`,
      `- Local payment credential: ${paymentPolicy.paymentCardLabel || paymentProfile.paymentCardLabel || selections.paymentCardLabel || (paymentPolicy.paymentCardLast4 || paymentProfile.paymentCardLast4 || selections.paymentCardLast4 ? 'saved card' : 'n/a')}${paymentPolicy.paymentCardLast4 || paymentProfile.paymentCardLast4 || selections.paymentCardLast4 ? ` ending ${paymentPolicy.paymentCardLast4 || paymentProfile.paymentCardLast4 || selections.paymentCardLast4}` : ''}`,
      `- Local checkout runner mode: ${localCheckoutRunner.mode || paymentProfile.checkoutRunnerMode || selections.checkoutRunnerMode || 'local_runner_or_browser_autofill'}`,
      `- Local checkout runner available: ${localCheckoutRunner.available === false ? 'no' : 'yes'}`,
      `- Local checkout runner required for payment: ${localCheckoutRunner.requiredForPayment ? 'yes' : 'no'}`,
      `- Local checkout runner stop before final submit: ${localCheckoutRunner.stopBeforeFinalSubmit === false ? 'no' : 'yes'}`,
      `- Login touchpoint policy: ${localCheckoutRunner.loginTouchpointPolicy || paymentPolicy.loginTouchpointPolicy || paymentProfile.loginTouchpointPolicy || selections.loginTouchpointPolicy || 'ask_once_per_site_then_reuse_local_session'}`,
      `- Payment touchpoint policy: ${localCheckoutRunner.paymentTouchpointPolicy || paymentPolicy.paymentTouchpointPolicy || paymentProfile.paymentTouchpointPolicy || selections.paymentTouchpointPolicy || 'use_local_wallet_or_autofill_under_cap'}`,
      `- Final approval policy: ${localCheckoutRunner.finalApprovalPolicy || paymentPolicy.finalApprovalPolicy || paymentProfile.finalApprovalPolicy || selections.finalApprovalPolicy || 'auto_when_bounded_under_cap_else_pause'}`,
      `- Receipt proof: ${localCheckoutRunner.receiptProof || paymentProfile.checkoutRunnerReceiptProof || selections.checkoutRunnerReceiptProof || 'receipt_hashes_and_screenshots'}`,
      `- Limit source: ${paymentProfile.limitSource || selections.limitSource || 'n/a'}`,
      `- Trust tier: ${paymentPolicy.trustTier || paymentProfile.trustTier || selections.trustTier || 'n/a'}`,
      `- Contextual authority: ${paymentPolicy.contextualAuthorityMode || paymentProfile.contextualAuthorityMode || selections.contextualAuthorityMode || 'n/a'}`,
      `- Inferred merchants: ${Array.isArray(paymentPolicy.inferredMerchants) && paymentPolicy.inferredMerchants.length ? paymentPolicy.inferredMerchants.join(', ') : 'none'}`,
      `- Payment policy decision: ${paymentPolicy.decision || 'n/a'}`,
      `- Policy reasons: ${Array.isArray(paymentPolicy.reasons) && paymentPolicy.reasons.length ? paymentPolicy.reasons.join(', ') : 'none'}`,
      `- Merchant host: ${paymentPolicy.merchantHost || 'n/a'}`,
      `- Magic City cap: ${paymentPolicy.magicCityPerTaskCap == null ? 'n/a' : `$${Number(paymentPolicy.magicCityPerTaskCap).toFixed(2)}`}`,
      `- Raw card data handled by Magic City: no`,
      `- Server receives raw card: ${localCheckoutRunner.serverReceivesRawCard ? 'yes' : 'no'}`,
      `- User-facing revocation: ${localCheckoutRunner.userFacingRevocation || paymentPolicy.killSwitch || paymentProfile.killSwitch || selections.killSwitch || 'remove_payment_profile'}`,
      `- Query filled: ${browserExecution?.queryFilled ? 'yes' : 'no'}`,
      `- Search method: ${browserExecution?.searchMethod || 'n/a'}`,
      `- Product opened: ${browserExecution?.checkoutProgress?.productOpened ? 'yes' : 'no'}`,
      `- Add to cart clicked: ${browserExecution?.checkoutProgress?.addToCartClicked ? 'yes' : 'no'}`,
      `- Checkout opened: ${browserExecution?.checkoutProgress?.checkoutOpened ? 'yes' : 'no'}`,
      `- Safe fields filled: ${Array.isArray(browserExecution?.safeFieldsFilled) && browserExecution.safeFieldsFilled.length ? browserExecution.safeFieldsFilled.join(', ') : 'none'}`,
      `- Screenshot hash: ${browserExecution?.screenshotHash || browserExecution?.previewArtifact?.sha256 || 'n/a'}`,
      '',
      '## Next action',
      '',
      browserExecution?.notes || 'Review the prepared site state and continue manually if needed.',
      '',
      '## Boundary',
      '',
      'Issuer/card wallet is the card authority for limits, freeze, disputes, replacement, and card lifecycle.',
      'Apple Pay, Google Pay, browser autofill, or an approved payment sheet is the secure payment-entry authority on the user device.',
      'Magic City is mission authority: it stores policy, merchant/budget approval, screenshots, URL state, artifacts, and receipts.',
      'Zeko/Mission-bound auth is the proof/audit layer for approval and receipt commitments.',
      'Full card number, CVV, passwords, MFA, and biometric unlock stay in the user browser, bank wallet, password manager, or payment sheet.',
      'The Local Checkout Runner is the only checkout component allowed to unlock local payment data or invoke browser autofill/payment sheets.',
      'Login friction is minimized by reusing a locally authenticated browser profile after biometric unlock; Magic City does not store or export passwords.',
      'Payment friction is minimized by using local wallet/autofill under the mission cap; new payment challenges, 3DS, CVV prompts, captcha, and policy conflicts still pause.',
      'Booking/order confirmation email comes from the signed-in Magic City account or the local data vault; the worker does not invent contact details.',
      'Magic City stores the agent payment profile policy, screenshots, URL state, and receipts. It does not store the raw payment credential.',
      'Payment and final submit only proceed inside the selected trust tier and stop condition; otherwise the worker pauses for user approval.',
      'The user-facing revocation action is Remove payment profile.'
    ].join('\n')
  });
  return {
    label: 'Browser worker handoff',
    url: artifact.url,
    sha256: artifact.sha256
  };
}

function completionStateForBrowserExecution(browserExecution) {
  const stopState = String(browserExecution?.stopState || '').toLowerCase();
  if (browserExecution?.mode === 'missing_target') return 'ready_for_review';
  if (browserExecution?.mode === 'blocked_by_site' || stopState === 'needs_captcha') return 'failed';
  if (browserExecution?.browserRuntimeMode === 'server_fast_handoff') return 'needs_local_runner';
  if (stopState === 'needs_local_browser_runtime') return 'needs_local_runner';
  if (stopState === 'needs_payment') return 'needs_user_payment';
  if (stopState === 'needs_final_approval' || stopState === 'needs_login') return 'needs_user_confirmation';
  return 'ready_for_review';
}

function nextHumanActionForBrowserExecution(browserExecution) {
  const stopState = String(browserExecution?.stopState || '').toLowerCase();
  if (browserExecution?.mode === 'missing_target') return 'Add a target URL, then run the worker again.';
  if (browserExecution?.mode === 'blocked_by_site' || stopState === 'needs_captcha') return 'Open the target yourself, clear the challenge, then rerun or continue manually from the saved URL.';
  if (browserExecution?.browserRuntimeMode === 'server_fast_handoff') return 'Server fallback prepared a price-filtered site handoff only. Use the local authenticated runner to reuse your signed-in browser, add to cart, open checkout, invoke autofill/payment sheet, and stop before final approval.';
  if (stopState === 'needs_local_browser_runtime') return 'Pair the local authenticated browser runner, then rerun so Magic City can use your signed-in browser profile instead of a server handoff.';
  if (stopState === 'needs_login') return 'Sign in or create the account yourself, then resume from the current URL if needed.';
  if (stopState === 'needs_payment') return 'Review the prepared page, then use the Local Checkout Runner, browser autofill, or payment sheet locally if everything looks right.';
  if (stopState === 'needs_final_approval') return 'Review the prepared page and make the final submit or purchase decision yourself.';
  return 'Review the saved screenshot, URL, and handoff notes. Continue manually or rerun with tighter instructions.';
}

function withTimeout(promise, timeoutMs, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout_after_${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function buildFailureFulfillment(session, error) {
  const message = error instanceof Error ? error.message : String(error || 'browser_worker_failed');
  const nextHumanAction = /timeout/i.test(message)
    ? 'The browser worker stalled before producing a handoff. Retry, or use a local browser runner so the task can reuse your signed-in browser profile.'
    : 'Retry the browser worker or continue manually from the target site.';
  const result = buildExecutionResult({
    session,
    completionState: 'failed',
    nextHumanAction,
    artifacts: [],
    extraResult: {
      error: message,
      browserExecutionMode: 'failed',
      needsLocalRunner: true,
      rawCardDataHandledByMagicCity: false
    }
  });
  return {
    status: 'failed',
    result,
    handoff: {
      label: 'Open target site',
      url: session.finalSelections?.targetUrl || session.selections?.targetUrl || session.handoffData?.defaults?.targetUrl || '/'
    },
    notes: `Browser worker failed before completing the handoff. ${nextHumanAction}`,
    fundingDisposition: 'release',
    proofRef: `${PLUGIN_ID}:${session.id}:failed`
  };
}

function buildFulfillment(session, browserExecution = null) {
  const artifact = buildBrowserWorkerArtifact(session, browserExecution);
  const completionState = completionStateForBrowserExecution(browserExecution);
  const nextHumanAction = nextHumanActionForBrowserExecution(browserExecution);
  const result = buildExecutionResult({
    session,
    completionState,
    nextHumanAction,
    artifacts: [
      artifact,
      browserExecution?.previewArtifact
        ? {
            label: 'Browser screenshot',
            url: browserExecution.previewArtifact.url,
            sha256: browserExecution.previewArtifact.sha256
          }
        : null
    ].filter(Boolean),
    extraResult: {
      browserExecution: browserExecution
        ? {
            mode: browserExecution.mode || null,
            browserRuntimeMode: browserExecution.browserRuntimeMode || null,
            targetUrl: browserExecution.targetUrl || null,
            finalUrl: browserExecution.finalUrl || null,
            pageTitle: browserExecution.pageTitle || null,
            goal: browserExecution.goal || null,
            budget: browserExecution.budget || null,
            confirmationEmail: browserExecution.confirmationEmail || null,
            previewArtifact: browserExecution.previewArtifact || null,
            stopState: browserExecution.stopState || null,
            stopEvidence: browserExecution.stopEvidence || null,
            stopSignals: browserExecution.stopSignals || null,
            paymentProfile: browserExecution.paymentProfile || null,
            paymentPolicy: browserExecution.paymentPolicy || null,
            localCheckoutRunner: browserExecution.localCheckoutRunner || null,
            authProfileMode: browserExecution.localCheckoutRunner?.authProfileMode || browserExecution.paymentPolicy?.authProfileMode || null,
            loginTouchpointPolicy: browserExecution.localCheckoutRunner?.loginTouchpointPolicy || browserExecution.paymentPolicy?.loginTouchpointPolicy || null,
            paymentTouchpointPolicy: browserExecution.localCheckoutRunner?.paymentTouchpointPolicy || browserExecution.paymentPolicy?.paymentTouchpointPolicy || null,
            finalApprovalPolicy: browserExecution.localCheckoutRunner?.finalApprovalPolicy || browserExecution.paymentPolicy?.finalApprovalPolicy || null,
            queryFilled: browserExecution.queryFilled ?? null,
            searchMethod: browserExecution.searchMethod || null,
            safeFieldsFilled: Array.isArray(browserExecution.safeFieldsFilled) ? browserExecution.safeFieldsFilled : [],
            checkoutProgress: browserExecution.checkoutProgress || null,
            providerChallenge: browserExecution.providerChallenge ?? false,
            providerChallengeReason: browserExecution.providerChallengeReason || null
          }
        : null,
      targetUrl: browserExecution?.targetUrl || session.finalSelections?.targetUrl || null,
      finalUrl: browserExecution?.finalUrl || null,
      stopState: browserExecution?.stopState || null,
      browserRuntimeMode: browserExecution?.browserRuntimeMode || null,
      paymentProfile: browserExecution?.paymentProfile || null,
      paymentPolicy: browserExecution?.paymentPolicy || null,
      browserExecutionMode: browserExecution?.mode || 'none',
      browserArtifactHash: browserExecution?.screenshotHash || browserExecution?.previewArtifact?.sha256 || null,
      checkoutProgress: browserExecution?.checkoutProgress || null,
      needsUserHandoff: completionState !== 'completed'
    }
  });
  return {
    status: completionState === 'failed' ? 'failed' : 'fulfilled',
    result,
    handoff: {
      label: browserExecution?.finalUrl ? 'Open prepared page' : 'Open target site',
      url: browserExecution?.finalUrl || browserExecution?.targetUrl || session.finalSelections?.targetUrl || '/'
    },
    notes: `${describeCompletionState(session.handoffData?.kind, completionState, nextHumanAction)} Prepared by ${PLUGIN_ID}.`,
    fundingDisposition: completionState === 'failed' ? 'release' : 'capture',
    proofRef: `${PLUGIN_ID}:${session.id}:${browserExecution?.mode || 'local'}`
  };
}

async function ensurePluginRegistration() {
  try {
    await api('/plugins/register', {
      method: 'POST',
      body: JSON.stringify({
	        pluginId: PLUGIN_ID,
	        ownerAgentId: OWNER_AGENT_ID,
	        kind: 'browser',
	        endpoint: `${BASE_URL}/plugins/${PLUGIN_ID}`,
	        localOnly: true,
	        capabilities: LOCAL_AUTHENTICATED_RUNNER
	          ? ['browser-worker-agent', 'browser.local_authenticated_profile', 'browser.prepare_handoff']
	          : ['browser-worker-agent', 'browser.prepare_handoff'],
	        tools: LOCAL_AUTHENTICATED_RUNNER
	          ? ['browser.open_local_profile', 'browser.inspect', 'browser.prepare_handoff']
	          : ['browser.open', 'browser.inspect', 'browser.prepare_handoff'],
	        privacyModes: LOCAL_AUTHENTICATED_RUNNER ? ['local-private', 'private'] : ['private'],
	        helperAgents: LOCAL_AUTHENTICATED_RUNNER
	          ? ['site-navigator', 'form-prepper', 'local-checkout-runner', 'handoff-recorder']
	          : ['site-navigator', 'form-prepper', 'handoff-recorder'],
	        metadata: {
	          runtime: 'local_worker',
	          mode: RUN_ONCE ? 'once' : 'watch',
	          executionAgent: true,
	          executionBackend: LOCAL_AUTHENTICATED_RUNNER ? 'local_authenticated_browser_worker' : 'assisted_browser_worker'
	        }
	      })
    });
  } catch (error) {
    if (!String(error.message).includes('plugin')) throw error;
  }
}

async function processSession(session) {
  if (!shouldProcessExecutionSession(session, {
    kind: 'browser',
    pluginId: PLUGIN_ID,
    pluginAliases: PLUGIN_ID === 'local-browser-worker-plugin'
      ? ['browser-worker-agent']
      : []
  })) return false;
  let currentSession = session;

  const needsRuntimeHolderBinding =
    !currentSession.claimedByPluginId ||
    (
      currentSession.claimedByPluginId === PLUGIN_ID &&
      currentSession.missionBoundAuth?.confirmation?.method !== 'proof-of-possession'
    );
  if (needsRuntimeHolderBinding) {
    const claim = await api(`/connectors/sessions/${currentSession.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        holderPublicKeyJwk: RUNTIME_HOLDER_PUBLIC_JWK
      })
    });
    currentSession = claim.session || currentSession;
  }

  currentSession = await sendSignedCheckpoint(currentSession, {
    label: 'Opening target browser',
    detail: 'Launching the assisted browser worker with the URL, goal, constraints, budget, and stop rule from the execution sheet.',
    state: 'browser_opening',
    missionAction: 'browser_open'
  });

  try {
    const browserExecution = await withTimeout(runAssistedBrowserWorkerExecution(currentSession, {
      onProgress: async (progress) => {
        currentSession = await sendSignedCheckpoint(currentSession, progress);
      }
    }), BROWSER_WORKER_TIMEOUT_MS, 'browser_worker_execution');

    const fulfillment = buildFulfillment(currentSession, browserExecution);
    const fulfillTargetUrl = fulfillment.handoff?.url || browserExecution?.finalUrl || browserExecution?.targetUrl || '';
    await api(`/connectors/sessions/${currentSession.id}/fulfill`, {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        missionAction: 'handoff',
        proofOfPossession: buildMissionPopProof(currentSession, { action: 'handoff', targetUrl: fulfillTargetUrl }),
        ...fulfillment
      })
    });
    console.log(`[local-browser-worker-plugin] fulfilled ${currentSession.id}`);
  } catch (error) {
    currentSession = await sendSignedCheckpoint(currentSession, {
      label: 'Browser worker stopped',
      detail: error instanceof Error ? error.message : String(error || 'browser_worker_failed'),
      state: 'failed',
      missionAction: 'inspect'
    }).catch(() => currentSession);
    const failure = buildFailureFulfillment(currentSession, error);
    await api(`/connectors/sessions/${currentSession.id}/fulfill`, {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        missionAction: 'handoff',
        proofOfPossession: buildMissionPopProof(currentSession, { action: 'handoff', targetUrl: failure.handoff?.url || '' }),
        ...failure
      })
    });
    console.error(`[local-browser-worker-plugin] failed ${currentSession.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return true;
}

async function tick() {
  const { sessions } = await api(`/connectors/sessions?pluginId=${encodeURIComponent(PLUGIN_ID)}`);
  let processed = 0;
  for (const session of sessions) {
    try {
      const changed = await processSession(session);
      if (changed) processed += 1;
    } catch (error) {
      if (String(error.message).includes('session_claimed_by_other_plugin')) continue;
      console.error(`[local-browser-worker-plugin] session ${session.id} failed: ${error.message}`);
    }
  }
  return processed;
}

async function main() {
  if (!API_KEY && !NATIVE_RUNNER_TOKEN) {
    throw new Error('missing_plugin_api_key_or_native_runner_token');
  }
  await ensurePluginRegistration();
  if (RUN_ONCE) {
    await tick();
    return;
  }
  console.log(`[local-browser-worker-plugin] watching ${BASE_URL} every ${POLL_MS}ms`);
  while (true) {
    try {
      await tick();
    } catch (error) {
      console.error(`[local-browser-worker-plugin] ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error(`[local-browser-worker-plugin] fatal: ${error.message}`);
  process.exitCode = 1;
});
