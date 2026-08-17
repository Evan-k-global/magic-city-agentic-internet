import crypto from 'node:crypto';

export const AGENT_MISSION_BOUND_AUTH_SOURCE = Object.freeze({
  packageName: 'agent-mission-bound-auth',
  repository: 'https://github.com/zeko-labs/agent-mission-bound-auth',
  commit: 'a93b5c71e0c436cfb18bdf34290e1f0b615bd2a2',
  protocol: 'zk-mission-auth',
  protocolVersion: '0.1'
});

export const MBA_BOUNDARY_ACTIONS = Object.freeze([
  'browser.open',
  'page.read',
  'form.fill',
  'vault.read',
  'cart.prepare',
  'shipping.prepare',
  'delivery_option.select',
  'payment.prepare',
  'payment.authorize',
  'checkout.review',
  'private_compute.run',
  'email.draft',
  'email.send',
  'external_agent.hire',
  'external_app.side_effect',
  'final_submit',
  'x402.payment_offer',
  'x402.pay',
  'x402.settle',
  'zeko.receipt.anchor'
]);

export const MBA_PROOF_STATES = Object.freeze([
  'capability_issued',
  'holder_bound',
  'funds_reserved',
  'mission_started',
  'boundary_events_recorded',
  'receipt_created',
  'proof_prepared',
  'proof_verified',
  'anchor_prepared',
  'anchored',
  'settlement_release_allowed',
  'settled',
  'disputed',
  'expired',
  'failed'
]);

export const MBA_SETTLEMENT_DECISIONS = Object.freeze([
  'not_ready',
  'release_allowed',
  'release_denied',
  'manual_review',
  'duplicate_payment',
  'expired_authorization',
  'policy_violation'
]);

export const MBA_DIGEST_HOLDER_PROOF_SCHEME = 'digest-holder-proof-v1';
export const MBA_ED25519_HOLDER_PROOF_SCHEME = 'ed25519-holder-proof-v1';
export const MAGIC_CITY_ED25519_POP_PROOF_SCHEME = 'magic-city-ed25519-pop-v1';
export const MBA_BROWSER_HELPER_ED25519_COMPAT_HOLDER_PROOF_SCHEME = 'browser-helper-ed25519-pop-v1';

export const MBA_BROWSER_MISSION_PROFILE_VERSION = 'mba-browser-mission-profile-v1';
export const MBA_REDACTED_TRACE_EXPORT_VERSION = 'mba-redacted-trace-v1';
export const MBA_BROWSER_MISSION_ACTIONS = Object.freeze([
  'browser.open',
  'page.read',
  'form.fill',
  'cart.prepare',
  'shipping.prepare',
  'delivery_option.select',
  'payment.prepare',
  'payment.authorize',
  'checkout.review',
  'final_submit'
]);
export const MBA_BROWSER_PAGE_STATE_CLASSES = Object.freeze([
  'unknown',
  'public_content',
  'authenticated_content',
  'form_entry',
  'cart',
  'shipping',
  'payment_selection',
  'final_review',
  'confirmation',
  'blocked'
]);
export const MBA_BROWSER_STOP_REASONS = Object.freeze([
  'none',
  'login_required',
  'payment_required',
  'final_approval_required',
  'policy_conflict',
  'budget_exceeded',
  'uncertain',
  'holder_key_missing',
  'capability_expired',
  'mission_capability_expired',
  'domain_not_allowed',
  'action_not_allowed'
]);
export const MBA_CHECKOUT_CHECKPOINTS = Object.freeze([
  'cart',
  'shipping',
  'delivery_option',
  'payment_selection',
  'final_review',
  'final_submit'
]);
export const MBA_RETAIL_CHECKOUT_RECEIPT_PROFILE_VERSION = 'mba-retail-checkout-receipt-profile-v1';
export const MBA_RETAIL_CHECKOUT_STEP_RECEIPT_VERSION = 'mba-retail-checkout-step-receipt-v1';
export const MBA_RETAIL_CHECKOUT_MILESTONES = Object.freeze([
  'candidate_selected',
  'cart_confirmed',
  'checkout_open',
  'address_confirmed',
  'card_confirmed',
  'delivery_confirmed',
  'checkout_profile_verified',
  'final_review_ready',
  'final_submit_requested',
  'order_submitted'
]);
export const MBA_RETAIL_CHECKOUT_REQUIRED_MILESTONES = Object.freeze([
  'candidate_selected',
  'cart_confirmed',
  'checkout_open',
  'address_confirmed',
  'card_confirmed',
  'delivery_confirmed',
  'final_review_ready'
]);

const MBA_RETAIL_CHECKOUT_STEP_STATUSES = new Set(['waiting', 'completed', 'skipped']);
const MBA_RETAIL_CHECKOUT_PROFILE_STATUSES = new Set([
  'in_progress',
  'final_review_ready',
  'final_submit_authorized',
  'final_submit_requested',
  'order_submitted'
]);

const MAGIC_CITY_TO_MBA_ACTION = Object.freeze({
  inspect: 'page.read',
  crawl: 'page.read',
  compare: 'page.read',
  read_public_page: 'page.read',
  fill_safe_fields: 'form.fill',
  prepare_cart: 'cart.prepare',
  prepare_shipping: 'shipping.prepare',
  select_delivery_option: 'delivery_option.select',
  prepare_form: 'form.fill',
  request_quote: 'external_app.side_effect',
  route_order: 'external_app.side_effect',
  submit_to_santaclawz: 'external_agent.hire',
  prepare_x402_payment: 'payment.prepare',
  reserve_credits: 'x402.payment_offer',
  browser_open: 'browser.open',
  browser_click: 'external_app.side_effect',
  browser_type: 'form.fill',
  browser_upload: 'form.fill',
  access_vault: 'vault.read',
  send_email: 'email.send',
  final_submit: 'final_submit',
  review_checkout: 'checkout.review',
  handoff: 'external_app.side_effect'
});

const MBA_TO_MAGIC_CITY_ACTION = Object.freeze({
  'browser.open': 'browser_open',
  'page.read': 'read_public_page',
  'form.fill': 'fill_safe_fields',
  'vault.read': 'access_vault',
  'cart.prepare': 'prepare_cart',
  'payment.prepare': 'prepare_x402_payment',
  'payment.authorize': 'prepare_x402_payment',
  'private_compute.run': 'inspect',
  'email.draft': 'send_email',
  'email.send': 'send_email',
  'external_agent.hire': 'submit_to_santaclawz',
  'external_app.side_effect': 'handoff',
  final_submit: 'final_submit',
  'x402.payment_offer': 'reserve_credits',
  'x402.pay': 'prepare_x402_payment',
  'x402.settle': 'prepare_x402_payment',
  'zeko.receipt.anchor': 'handoff'
});

export function mbaCanonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => mbaCanonicalize(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${mbaCanonicalize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function mbaSha256Hex(value) {
  const input = typeof value === 'string' ? value : mbaCanonicalize(value);
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function mbaId(prefix, value) {
  return `${prefix}_${mbaSha256Hex(value).slice(0, 24)}`;
}

export function strip0x(value = '') {
  return String(value || '').trim().replace(/^0x/i, '');
}

export function prefixed0x(value = '') {
  const hex = strip0x(value);
  return hex ? `0x${hex}` : '';
}

export function mapMagicCityActionToMbaAction(action = '') {
  const normalized = String(action || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (MBA_BOUNDARY_ACTIONS.includes(String(action || '').trim())) return String(action || '').trim();
  return MAGIC_CITY_TO_MBA_ACTION[normalized] || 'external_app.side_effect';
}

export function mapMbaActionToMagicCityAction(action = '') {
  const normalized = String(action || '').trim();
  return MBA_TO_MAGIC_CITY_ACTION[normalized] || normalized.replace(/[.]/g, '_');
}

export function normalizeMbaActions(actions = []) {
  const source = Array.isArray(actions) ? actions : String(actions || '').split(',');
  return Array.from(new Set(
    source
      .map((action) => mapMagicCityActionToMbaAction(action))
      .filter((action) => MBA_BOUNDARY_ACTIONS.includes(action))
  )).slice(0, 25);
}

export function estimateUsdFromCredits(credits = 0) {
  const numericCredits = Number(credits || 0);
  if (!Number.isFinite(numericCredits) || numericCredits <= 0) return '0.00';
  return (numericCredits / 100).toFixed(2);
}

export function parseUsdAmount(value = '') {
  const text = String(value || '');
  const match = text.match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(amount) && amount >= 0 ? amount.toFixed(2) : null;
}

function mbaBrowserHashInput(raw, existingHash, fallback) {
  if (existingHash) return existingHash;
  if (raw === undefined || raw === null) return mbaSha256Hex(fallback);
  return mbaSha256Hex(raw);
}

function mbaBrowserValidCanonicalValue(value, allowed, label) {
  if (value === undefined || value === null) return { valid: true };
  if (!allowed.includes(value)) return { valid: false, reason: `Unsupported ${label}: ${value}.` };
  return { valid: true };
}

function canonicalRetailCheckoutMilestones(values = []) {
  const seen = new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || '').trim())
      .filter((value) => MBA_RETAIL_CHECKOUT_MILESTONES.includes(value))
  );
  return MBA_RETAIL_CHECKOUT_MILESTONES.filter((value) => seen.has(value));
}

function canonicalRetailCheckoutRequirements(values = []) {
  const requested = Array.isArray(values) && values.length
    ? values
    : MBA_RETAIL_CHECKOUT_REQUIRED_MILESTONES;
  const seen = new Set(
    requested
      .map((value) => String(value || '').trim())
      .filter((value) => MBA_RETAIL_CHECKOUT_MILESTONES.includes(value))
  );
  return MBA_RETAIL_CHECKOUT_MILESTONES.filter((value) => seen.has(value));
}

function hasRetailCheckoutMilestones(milestones = [], required = []) {
  const observed = new Set(milestones);
  return required.every((milestone) => observed.has(milestone));
}

function inferRetailCheckoutProfileStatus({ milestones = [], requiredMilestones = [], finalApprovalCommitment = null } = {}) {
  const observed = new Set(milestones);
  const checkoutReady = hasRetailCheckoutMilestones(milestones, requiredMilestones);
  if (observed.has('order_submitted')) return 'order_submitted';
  if (observed.has('final_submit_requested')) return 'final_submit_requested';
  if (checkoutReady && finalApprovalCommitment) return 'final_submit_authorized';
  if (checkoutReady) return 'final_review_ready';
  return 'in_progress';
}

export function buildMbaRetailCheckoutStepReceipt(input = {}) {
  const verifiedMilestones = canonicalRetailCheckoutMilestones(input.verifiedMilestones);
  const body = {
    version: MBA_RETAIL_CHECKOUT_STEP_RECEIPT_VERSION,
    profileVersion: MBA_RETAIL_CHECKOUT_RECEIPT_PROFILE_VERSION,
    missionIdHash: input.missionIdHash,
    capabilityHash: input.capabilityHash,
    policyHash: input.policyHash,
    holderKeyCommitment: input.holderKeyCommitment ?? null,
    sessionCommitment: mbaBrowserHashInput(input.sessionId, input.sessionCommitment, 'unknown-session'),
    planHash: input.planHash ?? null,
    actionIdHash: input.actionIdHash ?? (input.actionId ? mbaSha256Hex(input.actionId) : null),
    actionType: input.actionType ?? null,
    actionStatus: input.actionStatus ?? 'completed',
    milestoneProtocol: input.milestoneProtocol ?? null,
    verifiedMilestones,
    verifiedMilestonesHash: mbaSha256Hex(verifiedMilestones),
    previousStepHash: input.previousStepHash ?? 'GENESIS',
    previousBoundaryHash: input.previousBoundaryHash ?? 'GENESIS',
    finalApprovalCommitment: input.finalApprovalCommitment ?? null,
    userApproved: input.userApproved === true,
    privacyProfile: input.privacyProfile ?? 'public-hashes-only',
    observedAt: input.observedAt ?? new Date().toISOString()
  };
  return {
    ...body,
    stepReceiptId: input.stepReceiptId ?? mbaId('retail_step', body),
    stepReceiptHash: mbaSha256Hex(body)
  };
}

export function verifyMbaRetailCheckoutStepReceipt(receipt, options = {}) {
  if (!receipt || typeof receipt !== 'object') return { valid: false, reason: 'Missing retail checkout step receipt.' };
  if (receipt.version !== MBA_RETAIL_CHECKOUT_STEP_RECEIPT_VERSION) return { valid: false, reason: 'Unsupported retail checkout step receipt version.' };
  const { stepReceiptId, stepReceiptHash, ...body } = receipt;
  if (stepReceiptId !== mbaId('retail_step', body)) return { valid: false, reason: 'Retail checkout step receipt id mismatch.' };
  if (stepReceiptHash !== mbaSha256Hex(body)) return { valid: false, reason: 'Retail checkout step receipt hash mismatch.' };
  if (!MBA_RETAIL_CHECKOUT_STEP_STATUSES.has(receipt.actionStatus)) return { valid: false, reason: 'Unsupported retail checkout step status.' };
  if (receipt.milestoneProtocol && receipt.milestoneProtocol !== 'verified-v1') return { valid: false, reason: 'Unsupported retail checkout milestone protocol.' };
  const canonicalMilestones = canonicalRetailCheckoutMilestones(receipt.verifiedMilestones);
  if (canonicalMilestones.length !== (Array.isArray(receipt.verifiedMilestones) ? receipt.verifiedMilestones.length : 0)) {
    return { valid: false, reason: 'Retail checkout step receipt contains unsupported or duplicate milestones.' };
  }
  if (receipt.verifiedMilestonesHash !== mbaSha256Hex(canonicalMilestones)) return { valid: false, reason: 'Retail checkout step receipt milestone hash mismatch.' };
  for (const [key, expected] of [
    ['missionIdHash', options.missionIdHash],
    ['capabilityHash', options.capabilityHash],
    ['policyHash', options.policyHash],
    ['holderKeyCommitment', options.holderKeyCommitment]
  ]) {
    if (expected && receipt[key] !== expected) return { valid: false, reason: `Retail checkout step receipt ${key} mismatch.` };
  }
  return { valid: true, stepReceiptId, stepReceiptHash };
}

export function buildMbaRetailCheckoutReceiptProfile(input = {}) {
  const verifiedMilestones = canonicalRetailCheckoutMilestones(input.verifiedMilestones);
  const requiredMilestones = canonicalRetailCheckoutRequirements(input.requiredMilestones);
  const finalApprovalCommitment = input.finalApprovalCommitment ?? null;
  const body = {
    version: MBA_RETAIL_CHECKOUT_RECEIPT_PROFILE_VERSION,
    missionIdHash: input.missionIdHash,
    capabilityHash: input.capabilityHash,
    policyHash: input.policyHash,
    holderKeyCommitment: input.holderKeyCommitment ?? null,
    sessionCommitment: mbaBrowserHashInput(input.sessionId, input.sessionCommitment, 'unknown-session'),
    planHash: input.planHash ?? null,
    milestoneProtocol: input.milestoneProtocol ?? 'verified-v1',
    requiredMilestones,
    verifiedMilestones,
    verifiedMilestonesHash: mbaSha256Hex(verifiedMilestones),
    latestStepReceiptHash: input.latestStepReceiptHash ?? null,
    finalApprovalCommitment,
    approvalTraceHash: input.approvalTraceHash ?? null,
    approvalExpiresAt: input.approvalExpiresAt ?? null,
    status: input.status ?? inferRetailCheckoutProfileStatus({
      milestones: verifiedMilestones,
      requiredMilestones,
      finalApprovalCommitment
    }),
    privacyProfile: input.privacyProfile ?? 'public-hashes-only',
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  const checkoutReady = hasRetailCheckoutMilestones(verifiedMilestones, requiredMilestones);
  return {
    ...body,
    checkoutReady,
    finalSubmitAllowed: checkoutReady
      && Boolean(finalApprovalCommitment)
      && ['final_submit_authorized', 'final_submit_requested'].includes(body.status),
    profileId: input.profileId ?? mbaId('retail_profile', { ...body, checkoutReady }),
    profileHash: mbaSha256Hex({ ...body, checkoutReady })
  };
}

export function verifyMbaRetailCheckoutReceiptProfile(profile, options = {}) {
  if (!profile || typeof profile !== 'object') return { valid: false, reason: 'Missing retail checkout receipt profile.' };
  if (profile.version !== MBA_RETAIL_CHECKOUT_RECEIPT_PROFILE_VERSION) return { valid: false, reason: 'Unsupported retail checkout receipt profile version.' };
  const { profileId, profileHash, finalSubmitAllowed, ...body } = profile;
  const checkoutReady = hasRetailCheckoutMilestones(body.verifiedMilestones || [], body.requiredMilestones || []);
  if (profileId !== mbaId('retail_profile', { ...body, checkoutReady })) return { valid: false, reason: 'Retail checkout receipt profile id mismatch.' };
  if (profileHash !== mbaSha256Hex({ ...body, checkoutReady })) return { valid: false, reason: 'Retail checkout receipt profile hash mismatch.' };
  if (finalSubmitAllowed !== (checkoutReady && Boolean(profile.finalApprovalCommitment) && ['final_submit_authorized', 'final_submit_requested'].includes(profile.status))) {
    return { valid: false, reason: 'Retail checkout receipt profile final-submit flag mismatch.' };
  }
  if (profile.milestoneProtocol !== 'verified-v1') return { valid: false, reason: 'Unsupported retail checkout milestone protocol.' };
  if (!MBA_RETAIL_CHECKOUT_PROFILE_STATUSES.has(profile.status)) return { valid: false, reason: 'Unsupported retail checkout receipt profile status.' };
  const canonicalMilestones = canonicalRetailCheckoutMilestones(profile.verifiedMilestones);
  const canonicalRequirements = canonicalRetailCheckoutRequirements(profile.requiredMilestones);
  if (canonicalMilestones.length !== (Array.isArray(profile.verifiedMilestones) ? profile.verifiedMilestones.length : 0)
    || canonicalRequirements.length !== (Array.isArray(profile.requiredMilestones) ? profile.requiredMilestones.length : 0)) {
    return { valid: false, reason: 'Retail checkout receipt profile contains unsupported or duplicate milestones.' };
  }
  if (profile.verifiedMilestonesHash !== mbaSha256Hex(canonicalMilestones)) return { valid: false, reason: 'Retail checkout receipt profile milestone hash mismatch.' };
  if (['final_review_ready', 'final_submit_authorized', 'final_submit_requested', 'order_submitted'].includes(profile.status) && !checkoutReady) {
    return { valid: false, reason: 'Retail checkout receipt profile reached a terminal checkout state without required milestones.' };
  }
  if (['final_submit_authorized', 'final_submit_requested', 'order_submitted'].includes(profile.status) && !profile.finalApprovalCommitment) {
    return { valid: false, reason: 'Retail checkout receipt profile final submit state is missing approval commitment.' };
  }
  for (const [key, expected] of [
    ['missionIdHash', options.missionIdHash],
    ['capabilityHash', options.capabilityHash],
    ['policyHash', options.policyHash],
    ['holderKeyCommitment', options.holderKeyCommitment]
  ]) {
    if (expected && profile[key] !== expected) return { valid: false, reason: `Retail checkout receipt profile ${key} mismatch.` };
  }
  if (options.requireActiveApproval && profile.finalSubmitAllowed) {
    const expiresAt = Date.parse(profile.approvalExpiresAt || '');
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { valid: false, reason: 'Retail checkout final approval has expired.' };
  }
  return { valid: true, profileId, profileHash, checkoutReady, finalSubmitAllowed };
}

export function buildMbaBrowserMissionProfile(input = {}) {
  const body = {
    version: MBA_BROWSER_MISSION_PROFILE_VERSION,
    missionIdHash: input.missionIdHash,
    capabilityHash: input.capabilityHash,
    policyHash: input.policyHash,
    runnerType: input.runnerType ?? 'chrome-extension',
    runtimeId: input.runtimeId ?? null,
    extensionIdHash: mbaBrowserHashInput(input.extensionId, input.extensionIdHash, 'no-extension-id'),
    holderKeyCommitment: input.holderKeyCommitment ?? null,
    sessionCommitment: mbaBrowserHashInput(input.sessionId, input.sessionCommitment, 'unknown-session'),
    tabCommitment: mbaBrowserHashInput(input.tabId, input.tabCommitment, 'unknown-tab'),
    currentUrlHash: mbaBrowserHashInput(input.currentUrl, input.currentUrlHash, 'unknown-url'),
    currentDomainHash: mbaBrowserHashInput(input.currentDomain, input.currentDomainHash, 'unknown-domain'),
    pageStateClass: input.pageStateClass ?? 'unknown',
    safeNextActionScore: input.safeNextActionScore ?? 0,
    recommendedAction: input.recommendedAction ?? null,
    stopReason: input.stopReason ?? 'none',
    checkoutCheckpoint: input.checkoutCheckpoint ?? null,
    allowedActionHashes: input.allowedActionHashes ?? (input.allowedActions ?? []).map((action) => mbaSha256Hex(action)),
    allowedDomainHashes: input.allowedDomainHashes ?? (input.allowedDomains ?? []).map((domain) => mbaSha256Hex(domain)),
    requiredCheckpoints: input.requiredCheckpoints ?? [],
    privacyProfile: input.privacyProfile ?? 'public-hashes-only',
    createdAt: input.createdAt ?? new Date().toISOString()
  };
  return {
    ...body,
    profileId: input.profileId ?? mbaId('browser_profile', body),
    profileHash: mbaSha256Hex(body)
  };
}

export function verifyMbaBrowserMissionProfile(profile, options = {}) {
  if (!profile || typeof profile !== 'object') return { valid: false, reason: 'Missing browser mission profile.' };
  if (profile.version !== MBA_BROWSER_MISSION_PROFILE_VERSION) return { valid: false, reason: 'Unsupported browser mission profile version.' };
  const { profileId, profileHash, ...body } = profile;
  if (profileId !== mbaId('browser_profile', body)) return { valid: false, reason: 'Browser mission profile id mismatch.' };
  if (profileHash !== mbaSha256Hex(body)) return { valid: false, reason: 'Browser mission profile hash mismatch.' };
  for (const [key, expected] of [
    ['missionIdHash', options.missionIdHash],
    ['capabilityHash', options.capabilityHash],
    ['policyHash', options.policyHash],
    ['holderKeyCommitment', options.holderKeyCommitment]
  ]) {
    if (expected && profile[key] !== expected) return { valid: false, reason: `Browser mission profile ${key} mismatch.` };
  }
  for (const [value, allowed, label] of [
    [profile.pageStateClass, MBA_BROWSER_PAGE_STATE_CLASSES, 'browser page state'],
    [profile.stopReason, MBA_BROWSER_STOP_REASONS, 'browser stop reason'],
    [profile.checkoutCheckpoint, MBA_CHECKOUT_CHECKPOINTS, 'checkout checkpoint']
  ]) {
    const result = mbaBrowserValidCanonicalValue(value, allowed, label);
    if (!result.valid) return result;
  }
  if (profile.recommendedAction) {
    const result = mbaBrowserValidCanonicalValue(profile.recommendedAction, MBA_BROWSER_MISSION_ACTIONS, 'browser recommended action');
    if (!result.valid) return result;
  }
  if (typeof profile.safeNextActionScore !== 'number' || !Number.isFinite(profile.safeNextActionScore) || profile.safeNextActionScore < 0 || profile.safeNextActionScore > 1) {
    return { valid: false, reason: 'Browser safeNextActionScore must be between 0 and 1.' };
  }
  if (options.requireDomainHash && !profile.currentDomainHash) return { valid: false, reason: 'Browser mission profile requires currentDomainHash.' };
  if (options.requireTabCommitment && !profile.tabCommitment) return { valid: false, reason: 'Browser mission profile requires tabCommitment.' };
  return { valid: true, profileId, profileHash };
}

export function buildMbaRedactedTraceExport(input = {}) {
  const events = input.events ?? input.traceEvents ?? [];
  const trace = input.trace ?? verifyMbaTraceChain(events, { allowExpired: true });
  if (!trace?.valid) throw new Error(trace?.reason || 'invalid_mba_trace');
  const publicEvents = events.map((event) => ({
    eventId: event.eventId,
    eventHash: event.eventHash,
    eventType: event.eventType,
    action: event.action,
    actionHash: event.actionHash,
    targetDomainHash: event.targetDomainHash,
    resourceHash: event.resourceHash,
    paymentContextDigest: event.paymentContextDigest,
    previousEventHash: event.previousEventHash,
    observedAt: event.observedAt,
    holderKeyThumbprint: event.holderProof?.keyThumbprint ?? event.holderKeyCommitment
  }));
  const body = {
    version: MBA_REDACTED_TRACE_EXPORT_VERSION,
    missionIdHash: input.missionIdHash,
    capabilityHash: input.capabilityHash,
    policyHash: input.policyHash,
    eventCount: trace.eventCount,
    traceHash: trace.traceHash,
    latestEventHash: trace.latestEventHash,
    publicEvents,
    ownerTraceCommitment: input.ownerTraceCommitment ?? (input.ownerTrace ? mbaSha256Hex(input.ownerTrace) : null),
    privacyProfile: input.privacyProfile ?? 'public-hashes-only',
    exportedAt: input.exportedAt ?? new Date().toISOString()
  };
  return {
    ...body,
    redactedTraceId: input.redactedTraceId ?? mbaId('redacted_trace', body),
    redactedTraceHash: mbaSha256Hex(body)
  };
}

export function buildMbaDiscoveryDocument({
  baseUrl,
  legacyDiscovery = null,
  zekoNetwork = 'zeko:testnet'
} = {}) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  return {
    protocol: 'zk-mission-auth',
    version: AGENT_MISSION_BOUND_AUTH_SOURCE.protocolVersion,
    name: 'Agent Mission-Bound Auth',
    description: 'Task-bound authorization, holder-signed browser checkpoints, x402/credit settlement, and Zeko receipt anchoring for Magic City agents.',
    issuer: `${normalizedBase}/`,
    source: AGENT_MISSION_BOUND_AUTH_SOURCE,
    endpoints: {
      agentPassport: `${normalizedBase}/agent-sdk/v1/manifest`,
      issueCapability: `${normalizedBase}/mission-auth/capabilities`,
      verifyCapability: `${normalizedBase}/mission-auth/verify`,
      verifyCheckpoint: `${normalizedBase}/api/mission/verify-checkpoint`,
      enforceCheckpoint: `${normalizedBase}/api/mission/enforce-checkpoint`,
      createReceipt: `${normalizedBase}/mission-auth/sessions/{sessionId}/receipts`,
      exportTrace: `${normalizedBase}/mission-auth/sessions/{sessionId}/trace`,
      exportBundle: `${normalizedBase}/api/mission/export-bundle`,
      missionAuthorityJwks: `${normalizedBase}/.well-known/mission-authority-jwks.json`,
      legacyMagicCityDiscovery: `${normalizedBase}/.well-known/magic-city-mission-auth`,
      x402Catalog: `${normalizedBase}/.well-known/x402.json`,
      zekoSettlementRegistry: `${normalizedBase}/zeko/settlement-registry`
    },
    schemas: {
      capability: 'mission-bound-capability-v1',
      policy: 'mission-bound-policy-v1',
      boundaryEvent: 'mission-bound-boundary-event-v1',
      portableReceipt: 'mission-bound-auth-receipt-v1',
      retailCheckoutStepReceipt: MBA_RETAIL_CHECKOUT_STEP_RECEIPT_VERSION,
      retailCheckoutReceiptProfile: MBA_RETAIL_CHECKOUT_RECEIPT_PROFILE_VERSION,
      registryAnchor: 'mba-registry-v1',
      legacyCapability: legacyDiscovery?.capabilitySchema || 'magic-city-mission-capability-v2',
      legacyReceipt: legacyDiscovery?.receiptSchema || 'magic-city-mission-bound-execution-attestation-v2'
    },
    capabilities: {
      taskScope: ['mission-bound-capability-v1', 'magic-city-mission-capability-v2'],
      retailCheckoutMilestones: MBA_RETAIL_CHECKOUT_REQUIRED_MILESTONES,
      holderProofs: [
        MBA_ED25519_HOLDER_PROOF_SCHEME,
        MBA_BROWSER_HELPER_ED25519_COMPAT_HOLDER_PROOF_SCHEME,
        MAGIC_CITY_ED25519_POP_PROOF_SCHEME
      ],
      enforcement: [
        'before_payment_offer',
        'before_private_compute',
        'before_external_side_effect',
        'after_receipt'
      ],
      actions: MBA_BOUNDARY_ACTIONS,
      proofStates: MBA_PROOF_STATES,
      settlementDecisions: MBA_SETTLEMENT_DECISIONS,
      payments: ['magic_city_credits', 'base_usdc_x402', 'direct_base_usdc_x402', 'crawl_credit_reservation'],
      anchoring: [zekoNetwork, 'mission-auth-registry-zkapp', 'receipt-root-anchor'],
      privacy: ['redacted-trace-export', 'local-vault-private-inputs', 'public-hash-commitments']
    }
  };
}

export function buildMbaJwks({ ed25519KeyPair = null } = {}) {
  const keys = [];
  if (ed25519KeyPair?.publicJwk) {
    keys.push({
      kty: ed25519KeyPair.publicJwk.kty,
      crv: ed25519KeyPair.publicJwk.crv,
      x: ed25519KeyPair.publicJwk.x,
      kid: ed25519KeyPair.kid,
      alg: 'EdDSA',
      use: 'sig'
    });
  }
  return {
    keys,
    source: AGENT_MISSION_BOUND_AUTH_SOURCE
  };
}

export function buildMbaMissionPolicy(input = {}) {
  const policy = {
    version: 'mission-bound-policy-v1',
    missionId: input.missionId,
    task: input.task,
    allowedDomains: input.allowedDomains ?? [],
    allowedActions: normalizeMbaActions(input.allowedActions ?? input.allowedTools ?? []),
    dataScopes: input.dataScopes ?? input.datasetScopes ?? [],
    paymentRails: input.paymentRails ?? input.allowedRails ?? [],
    maxSpendUsd: input.maxSpendUsd ?? '0.00',
    expiresAt: input.expiresAt,
    checkpoints: input.checkpoints ?? [],
    constraints: input.constraints ?? {},
    receiptRequirements: input.receiptRequirements ?? [
      'capabilityHash',
      'policyHash',
      'traceHash',
      'paymentContextDigest',
      'nullifier',
      'anchorReference'
    ]
  };
  return {
    ...policy,
    policyHash: mbaSha256Hex(policy)
  };
}

export function buildMbaMissionCapability(input = {}) {
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 20 * 60 * 1000).toISOString();
  const nullifierSeed = input.nullifierSeed ?? mbaSha256Hex({
    seed: input.capabilityId ?? input.jti ?? input.missionId ?? crypto.randomBytes(16).toString('hex')
  }).slice(0, 48);
  const body = {
    version: 'mission-bound-capability-v1',
    issuer: input.issuer ?? 'magic-city',
    audience: input.audience ?? 'mission-verifier',
    principalHash: input.principalHash ?? mbaSha256Hex(input.principal ?? 'unknown-principal'),
    agentId: input.agentId,
    runtimeId: input.runtimeId ?? input.agentId,
    holderKeyCommitment: input.holderKeyCommitment ?? mbaSha256Hex(input.holderPublicKey ?? input.agentId ?? 'unknown-holder'),
    missionId: input.missionId,
    missionIdHash: input.missionIdHash ?? mbaSha256Hex(input.missionId ?? 'unknown-mission'),
    allowedDomains: input.allowedDomains ?? [],
    allowedActions: normalizeMbaActions(input.allowedActions ?? input.allowedTools ?? []),
    dataScopes: input.dataScopes ?? input.datasetScopes ?? [],
    paymentRails: input.paymentRails ?? input.allowedRails ?? [],
    maxSpendUsd: input.maxSpendUsd ?? '0.00',
    expiresAt,
    jti: input.jti ?? mbaId('jti', { missionId: input.missionId, agentId: input.agentId, nullifierSeed }),
    nullifierSeed,
    settlementReleaseCondition: input.settlementReleaseCondition ?? 'valid_receipt_root_and_payment_context'
  };
  const capabilityId = input.capabilityId ?? mbaId('capability', body);
  const capabilityHash = mbaSha256Hex(body);
  return {
    ...body,
    capabilityId,
    capabilityHash,
    nullifier: mbaSha256Hex({
      capabilityId,
      capabilityHash,
      missionIdHash: body.missionIdHash,
      nullifierSeed,
      settlementReleaseCondition: body.settlementReleaseCondition
    })
  };
}

export function verifyMbaCapability(capability, { allowExpired = false } = {}) {
  if (!capability || typeof capability !== 'object') return { valid: false, reason: 'Missing capability.' };
  if (capability.version !== 'mission-bound-capability-v1') return { valid: false, reason: 'Unsupported capability version.' };
  const { capabilityId, capabilityHash, nullifier, ...body } = capability;
  if (capabilityId !== mbaId('capability', body)) return { valid: false, reason: 'Capability id mismatch.' };
  if (capabilityHash !== mbaSha256Hex(body)) return { valid: false, reason: 'Capability hash mismatch.' };
  const expectedNullifier = mbaSha256Hex({
    capabilityId,
    capabilityHash,
    missionIdHash: body.missionIdHash,
    nullifierSeed: body.nullifierSeed,
    settlementReleaseCondition: body.settlementReleaseCondition
  });
  if (nullifier !== expectedNullifier) return { valid: false, reason: 'Capability nullifier mismatch.' };
  if (!allowExpired) {
    const expiry = Date.parse(capability.expiresAt || '');
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return { valid: false, reason: 'Capability expired or has invalid expiry.' };
  }
  return { valid: true, capabilityHash, capabilityId, nullifier };
}

export function holderChallengeHash(eventBody = {}) {
  return mbaSha256Hex({
    missionIdHash: eventBody.missionIdHash,
    capabilityHash: eventBody.capabilityHash,
    policyHash: eventBody.policyHash,
    eventType: eventBody.eventType,
    action: eventBody.action,
    actionHash: eventBody.actionHash,
    targetDomainHash: eventBody.targetDomainHash,
    resourceHash: eventBody.resourceHash,
    paymentContextDigest: eventBody.paymentContextDigest,
    sideEffectId: eventBody.sideEffectId,
    idempotencyKey: eventBody.idempotencyKey,
    previousEventHash: eventBody.previousEventHash
  });
}

function isEd25519Jwk(publicJwk) {
  return publicJwk?.kty === 'OKP' && publicJwk?.crv === 'Ed25519' && typeof publicJwk?.x === 'string';
}

export function buildMbaBoundaryEvent(input = {}) {
  const action = mapMagicCityActionToMbaAction(input.action ?? input.eventType);
  const body = {
    version: 'mission-bound-boundary-event-v1',
    missionIdHash: input.missionIdHash,
    capabilityHash: input.capabilityHash,
    policyHash: input.policyHash,
    eventType: input.eventType ?? action,
    action,
    actionHash: input.actionHash ?? mbaSha256Hex(action),
    targetDomainHash: input.targetDomainHash ?? mbaSha256Hex(input.targetDomain ?? 'unknown-domain'),
    resourceHash: input.resourceHash ?? mbaSha256Hex(input.resource ?? input.datasetId ?? 'unknown-resource'),
    paymentContextDigest: input.paymentContextDigest ?? mbaSha256Hex(input.paymentContext ?? 'no-payment-context'),
    sideEffectId: input.sideEffectId ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    previousEventHash: input.previousEventHash ?? 'GENESIS',
    observedAt: input.observedAt ?? new Date().toISOString(),
    expiresAt: input.expiresAt,
    holderKeyCommitment: input.holderKeyCommitment
  };
  const challengeHash = holderChallengeHash(body);
  const holderProof = input.holderProof
    ? {
        ...input.holderProof,
        messageHash: input.holderProof.messageHash ?? challengeHash
      }
    : {
        scheme: input.proofScheme ?? MBA_DIGEST_HOLDER_PROOF_SCHEME,
        keyThumbprint: input.holderKeyThumbprint ?? input.holderKeyCommitment ?? null,
        messageHash: challengeHash,
        signature: input.signature ?? mbaSha256Hex({
          holderSecret: input.holderSecret ?? 'local-holder-proof',
          messageHash: challengeHash
        })
      };
  const eventBody = { ...body, holderProof };
  return {
    ...eventBody,
    eventId: input.eventId ?? mbaId('event', eventBody),
    eventHash: mbaSha256Hex(eventBody)
  };
}

export function verifyMbaBoundaryEvent(event, options = {}) {
  if (!event || typeof event !== 'object') return { valid: false, reason: 'Missing boundary event.' };
  if (event.version !== 'mission-bound-boundary-event-v1') return { valid: false, reason: 'Unsupported boundary event version.' };
  const { eventId, eventHash, ...body } = event;
  if (eventId !== mbaId('event', body)) return { valid: false, reason: 'Boundary event id mismatch.' };
  if (eventHash !== mbaSha256Hex(body)) return { valid: false, reason: 'Boundary event hash mismatch.' };
  if (options.previousEventHash && event.previousEventHash !== options.previousEventHash) return { valid: false, reason: 'Boundary event previousHash mismatch.' };
  if (options.missionIdHash && event.missionIdHash !== options.missionIdHash) return { valid: false, reason: 'Boundary event missionIdHash mismatch.' };
  if (options.capabilityHash && event.capabilityHash !== options.capabilityHash) return { valid: false, reason: 'Boundary event capabilityHash mismatch.' };
  if (options.policyHash && event.policyHash !== options.policyHash) return { valid: false, reason: 'Boundary event policyHash mismatch.' };
  if (options.allowedActions && !options.allowedActions.includes(event.action)) return { valid: false, reason: `Boundary event action not allowed: ${event.action}.` };
  if (options.allowedDomainHashes && !options.allowedDomainHashes.includes(event.targetDomainHash)) return { valid: false, reason: 'Boundary event target domain not allowed.' };
  if (!options.allowExpired && event.expiresAt) {
    const expiry = Date.parse(event.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return { valid: false, reason: 'Boundary event expired or has invalid expiry.' };
  }
  const holderProof = event.holderProof || {};
  const expectedMessageHash = holderChallengeHash(body);
  if (holderProof.messageHash !== expectedMessageHash) return { valid: false, reason: 'Boundary event holder proof is not bound to this action context.' };
  if (holderProof.scheme === MBA_ED25519_HOLDER_PROOF_SCHEME) {
    if (!isEd25519Jwk(holderProof.publicJwk)) return { valid: false, reason: 'Ed25519 holder proof requires an Ed25519 public JWK.' };
    const keyThumbprint = mbaSha256Hex(holderProof.publicJwk);
    if (holderProof.keyThumbprint !== keyThumbprint) return { valid: false, reason: 'Ed25519 holder proof key thumbprint mismatch.' };
    if (event.holderKeyCommitment !== keyThumbprint) return { valid: false, reason: 'Ed25519 holder proof is not bound to the event holder key commitment.' };
    try {
      const publicKey = crypto.createPublicKey({ key: holderProof.publicJwk, format: 'jwk' });
      const ok = crypto.verify(null, Buffer.from(holderProof.messageHash, 'utf8'), publicKey, Buffer.from(String(holderProof.signature || ''), 'base64url'));
      if (!ok) return { valid: false, reason: 'Ed25519 holder proof signature is invalid.' };
    } catch (error) {
      return { valid: false, reason: error instanceof Error ? error.message : 'Ed25519 holder proof verification failed.' };
    }
  } else if (!holderProof.scheme || holderProof.scheme === MBA_DIGEST_HOLDER_PROOF_SCHEME) {
    if (options.requireStrongHolderProof) return { valid: false, reason: 'Digest holder proof is not accepted for production holder proofs.' };
    const expected = mbaSha256Hex({
      holderSecret: options.holderSecret ?? 'local-holder-proof',
      messageHash: holderProof.messageHash
    });
    if (holderProof.signature !== expected) return { valid: false, reason: 'Digest holder proof signature is invalid.' };
  } else if (
    holderProof.scheme === MAGIC_CITY_ED25519_POP_PROOF_SCHEME ||
    holderProof.scheme === MBA_BROWSER_HELPER_ED25519_COMPAT_HOLDER_PROOF_SCHEME
  ) {
    if (options.requireStrongHolderProof) {
      return { valid: false, reason: 'Compatibility holder proof is not accepted when strong protocol proof is required.' };
    }
  } else {
    return { valid: false, reason: `Unsupported holder proof scheme:${holderProof.scheme}.` };
  }
  return { valid: true, eventHash, eventId };
}

export function verifyMbaTraceChain(events = [], options = {}) {
  if (!Array.isArray(events) || !events.length) return { valid: false, reason: 'Trace must contain at least one boundary event.' };
  let previousEventHash = options.initialPreviousEventHash ?? 'GENESIS';
  for (const event of events) {
    const verified = verifyMbaBoundaryEvent(event, { ...options, previousEventHash });
    if (!verified.valid) return { ...verified, eventHash: event?.eventHash };
    previousEventHash = event.eventHash;
  }
  const latestEventHash = events.at(-1).eventHash;
  return {
    valid: true,
    eventCount: events.length,
    traceHash: mbaSha256Hex({ events: events.map((event) => event.eventHash) }),
    latestEventHash
  };
}

export function buildMbaTraceSummary(events = []) {
  const eventHashes = (Array.isArray(events) ? events : [])
    .map((event) => strip0x(event?.eventHash || event))
    .filter(Boolean);
  return {
    valid: eventHashes.length > 0,
    eventCount: eventHashes.length,
    traceHash: mbaSha256Hex({ events: eventHashes }),
    latestEventHash: eventHashes.at(-1) ?? null
  };
}

export function buildMbaReceiptExport(input = {}) {
  const trace = input.traceEvents
    ? verifyMbaTraceChain(input.traceEvents, { allowExpired: true })
    : input.trace;
  if (input.traceEvents && !trace?.valid) throw new Error(trace?.reason || 'invalid_mba_trace');
  const body = {
    schema: 'mission-bound-auth-receipt-v1',
    mission: {
      missionIdHash: input.missionIdHash,
      capabilityHash: input.capabilityHash,
      issuer: input.issuer,
      audience: input.audience
    },
    policy: {
      policyHash: input.policyHash,
      allowedDomainsHash: input.allowedDomainsHash,
      allowedActionsHash: input.allowedActionsHash,
      maxSpendCommitment: input.maxSpendCommitment,
      paymentRailsHash: input.paymentRailsHash
    },
    holder: {
      keyThumbprint: input.holderKeyThumbprint,
      proofScheme: input.proofScheme ?? MBA_ED25519_HOLDER_PROOF_SCHEME
    },
    trace: {
      eventCount: trace?.eventCount ?? 0,
      traceHash: trace?.traceHash ?? null,
      latestEventHash: trace?.latestEventHash ?? null
    },
    payment: {
      paymentCommitment: input.paymentCommitment,
      rail: input.rail,
      amountCommitment: input.amountCommitment,
      paymentContextDigest: input.paymentContextDigest
    },
    proof: {
      statementKind: input.statementKind ?? 'mission-bound-trace-compliance-v1',
      statementHash: input.statementHash,
      proofSystem: input.proofSystem ?? 'signed-commitment-transition',
      verificationKeyHash: input.verificationKeyHash ?? null
    },
    browserProfile: input.browserProfile ?? null,
    retailCheckoutProfile: input.retailCheckoutProfile ?? null,
    nullifier: input.nullifier,
    registryRoot: input.registryRoot ?? null,
    settlementState: input.settlementState ?? 'receipt_created',
    anchor: input.anchor ?? null,
    exportedAt: input.exportedAt ?? new Date().toISOString()
  };
  const receiptId = input.receiptId ?? mbaId('receipt', receiptIdentityBody(body));
  return {
    ...body,
    receiptId,
    receiptHash: mbaSha256Hex(body)
  };
}

function receiptIdentityBody(body) {
  const {
    anchor: _anchor,
    exportedAt: _exportedAt,
    registryRoot: _registryRoot,
    settlementState: _settlementState,
    ...identityBody
  } = body || {};
  return identityBody;
}

export function verifyMbaReceipt(receipt, { allowAnchorPrepared = false } = {}) {
  if (!receipt || typeof receipt !== 'object') return { valid: false, reason: 'Missing receipt.' };
  if (receipt.schema !== 'mission-bound-auth-receipt-v1') return { valid: false, reason: 'Unsupported receipt schema.' };
  const { receiptId, receiptHash, ...body } = receipt;
  if (receiptId !== mbaId('receipt', receiptIdentityBody(body))) return { valid: false, reason: 'Receipt id mismatch.' };
  if (receiptHash !== mbaSha256Hex(body)) return { valid: false, reason: 'Receipt hash mismatch.' };
  if (!receipt.mission?.capabilityHash) return { valid: false, reason: 'Receipt missing capabilityHash.' };
  if (!receipt.policy?.policyHash) return { valid: false, reason: 'Receipt missing policyHash.' };
  if (!receipt.trace?.traceHash || !receipt.trace?.latestEventHash) return { valid: false, reason: 'Receipt missing trace commitment.' };
  if (!receipt.payment?.paymentContextDigest) return { valid: false, reason: 'Receipt missing paymentContextDigest.' };
  if (!receipt.nullifier) return { valid: false, reason: 'Receipt missing nullifier.' };
  if (receipt.retailCheckoutProfile) {
    const retailProfileCheck = verifyMbaRetailCheckoutReceiptProfile(receipt.retailCheckoutProfile, {
      missionIdHash: receipt.mission?.missionIdHash,
      capabilityHash: receipt.mission?.capabilityHash,
      policyHash: receipt.policy?.policyHash,
      holderKeyCommitment: receipt.holder?.keyThumbprint || undefined
    });
    if (!retailProfileCheck.valid) return { valid: false, reason: retailProfileCheck.reason };
  }
  if (!allowAnchorPrepared && ['settlement_release_allowed', 'settled'].includes(receipt.settlementState) && !receipt.anchor) {
    return { valid: false, reason: 'Production-final receipts require anchor evidence.' };
  }
  return {
    valid: true,
    receiptId,
    receiptHash,
    nullifier: receipt.nullifier,
    settlementState: receipt.settlementState
  };
}

export function buildMbaRegistryAnchor(input = {}) {
  const payload = {
    registryVersion: 'mba-registry-v1',
    sequence: input.sequence ?? 0,
    missionIdHash: input.missionIdHash,
    capabilityHash: input.capabilityHash,
    statementHash: input.statementHash,
    payloadDigest: input.payloadDigest,
    receiptIdHash: input.receiptIdHash,
    nullifier: input.nullifier,
    previousRoot: input.previousRoot ?? '0',
    networkId: input.networkId ?? 'zeko:testnet',
    registryAddress: input.registryAddress ?? null,
    txHash: input.txHash ?? null
  };
  const payloadDigest = input.payloadDigest ?? mbaSha256Hex({
    missionIdHash: payload.missionIdHash,
    capabilityHash: payload.capabilityHash,
    statementHash: payload.statementHash,
    receiptIdHash: payload.receiptIdHash,
    nullifier: payload.nullifier
  });
  const body = {
    ...payload,
    payloadDigest,
    newRoot: input.newRoot ?? mbaSha256Hex({
      previousRoot: payload.previousRoot,
      sequence: payload.sequence,
      payloadDigest,
      nullifier: payload.nullifier
    }),
    proofHash: input.proofHash ?? mbaSha256Hex({
      networkId: payload.networkId,
      registryAddress: payload.registryAddress,
      txHash: payload.txHash,
      payloadDigest
    }),
    anchoredAt: input.anchoredAt ?? new Date().toISOString()
  };
  return {
    ...body,
    anchorId: input.anchorId ?? mbaId('anchor', body)
  };
}

export function verifyMbaSettlementState(receipt, settlement = {}) {
  const receiptCheck = verifyMbaReceipt(receipt, { allowAnchorPrepared: true });
  if (!receiptCheck.valid) return { valid: false, decision: 'release_denied', reason: receiptCheck.reason };
  const spentNullifiers = new Set(settlement.spentNullifiers ?? settlement.nullifiers ?? []);
  if (spentNullifiers.has(receipt.nullifier)) return { valid: false, decision: 'duplicate_payment', reason: 'Receipt nullifier already settled.' };
  if (settlement.requiredAnchor !== false && !receipt.anchor) return { valid: false, decision: 'not_ready', reason: 'Receipt anchor evidence is required before settlement.' };
  if (settlement.allowedRails && !settlement.allowedRails.includes(receipt.payment.rail)) return { valid: false, decision: 'policy_violation', reason: 'Receipt payment rail is not allowed.' };
  if (settlement.expiresAt) {
    const expiry = Date.parse(settlement.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return { valid: false, decision: 'expired_authorization', reason: 'Settlement authorization expired or has invalid expiry.' };
  }
  return {
    valid: true,
    decision: 'release_allowed',
    nullifier: receipt.nullifier,
    receiptId: receipt.receiptId
  };
}
