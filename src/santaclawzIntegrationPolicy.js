const DEFAULT_APPROVED_EXTERNAL_AGENT_ID = 'hosted-code-audit-agent--session_agent_0e86fd7829bd';

export const SANTACLAWZ_CODE_AUDIT_EXTERNAL_AGENT_ID = DEFAULT_APPROVED_EXTERNAL_AGENT_ID;
export const SANTACLAWZ_CODE_AUDIT_MAGIC_AGENT_ID = `santaclawz:${DEFAULT_APPROVED_EXTERNAL_AGENT_ID}`;
export const SANTACLAWZ_BASE_USDC_RAIL = Object.freeze({
  rail: 'base-usdc',
  networkId: 'eip155:8453',
  chainId: 8453,
  assetSymbol: 'USDC',
  assetDecimals: 6,
  assetStandard: 'erc20',
  assetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  builderHint: 'buildBaseMainnetUsdcRail',
  facilitatorMode: 'x402-http',
  settlementModel: 'x402-exact-evm-fee-split-v1',
  executionMode: 'settle-first'
});
export const SANTACLAWZ_CODE_AUDIT_PRICE = Object.freeze({
  grossAtomic: '100000',
  sellerAtomic: '98000',
  protocolFeeAtomic: '2000',
  sellerPayTo: '0x1FC80745F8c0acfeEb8C4128bC20A622d1D6ef22',
  protocolFeePayTo: '0xF787fF44c5e80c8165e1B4FB156411e2d42c91B2'
});

export function externalSantaClawzAgentId(value = '') {
  const normalized = String(value || '').trim();
  return normalized.startsWith('santaclawz:') ? normalized.slice('santaclawz:'.length) : normalized;
}

export function getSantaClawzApprovedExternalAgentIds(env = process.env) {
  const configured = String(env.MAGIC_CITY_SANTACLAWZ_AGENT_ALLOWLIST || DEFAULT_APPROVED_EXTERNAL_AGENT_ID)
    .split(',')
    .map((entry) => externalSantaClawzAgentId(entry))
    .filter(Boolean);
  return [...new Set(configured)];
}

export function isApprovedSantaClawzAgentId(value = '', env = process.env) {
  const externalId = externalSantaClawzAgentId(value);
  return Boolean(externalId) && getSantaClawzApprovedExternalAgentIds(env).includes(externalId);
}

export function isSantaClawzAuditOfferMessage(value = '') {
  return /\b(?:code\s+audit|audit)\b/i.test(String(value || ''));
}

function sameAddress(left = '', right = '') {
  return String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
}

function decimalToAtomic(value, decimals = 6) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) return null;
  return `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
}

function paymentPlanError(reason, detail = '') {
  return { ok: false, reason, detail: detail || reason };
}

export function validateSantaClawzRuntimeContract({
  agentId,
  ready,
  x402Plan,
  nowMs = Date.now()
} = {}) {
  const externalId = externalSantaClawzAgentId(agentId);
  if (!isApprovedSantaClawzAgentId(externalId)) return paymentPlanError('santaclawz_agent_not_approved');
  if (ready?.schemaVersion !== 'santaclawz-agent-readiness/1.0') return paymentPlanError('santaclawz_readiness_schema_unsupported');
  if (ready?.ok !== true || ready?.online !== true || ready?.paymentsReady !== true || ready?.paidExecutionReady !== true) {
    return paymentPlanError('santaclawz_agent_not_ready');
  }
  if (externalSantaClawzAgentId(ready?.agentId) !== externalId || externalSantaClawzAgentId(x402Plan?.agentId) !== externalId) {
    return paymentPlanError('santaclawz_agent_contract_mismatch');
  }
  const readiness = ready?.readiness || {};
  if (readiness.relayConnected !== true || readiness.heartbeatLive !== true || readiness.runtimeReachable !== true || readiness.workerReachable !== true || readiness.published !== true || readiness.hireable !== true) {
    return paymentPlanError('santaclawz_runtime_not_hireable');
  }
  const staleAtMs = Date.parse(ready?.availability?.heartbeat?.staleAtIso || x402Plan?.heartbeatSafety?.staleAtIso || '');
  if (!Number.isFinite(staleAtMs) || staleAtMs <= nowMs) return paymentPlanError('santaclawz_readiness_stale');
  if (x402Plan?.stateFreshness !== 'fresh' || x402Plan?.planProjectionPending === true || x402Plan?.heartbeatSafety?.paidPreflightSafe !== true) {
    return paymentPlanError('santaclawz_payment_plan_stale');
  }
  if (x402Plan?.published !== true || x402Plan?.paymentsEnabled !== true || x402Plan?.paymentProfileReady !== true || x402Plan?.payoutAddressConfigured !== true) {
    return paymentPlanError('santaclawz_payment_plan_not_ready');
  }
  const limits = ready?.limits || {};
  const inputLimits = {
    taskPromptMaxChars: Number(limits.taskPromptMaxChars),
    requesterContactMaxChars: Number(limits.requesterContactMaxChars),
    bodyMaxBytes: Number(limits.bodyMaxBytes)
  };
  if (Object.values(inputLimits).some((value) => !Number.isInteger(value) || value <= 0)) {
    return paymentPlanError('santaclawz_input_limits_invalid');
  }
  const privacyModes = (Array.isArray(ready?.privacyModes) ? ready.privacyModes : [])
    .map((entry) => String(entry?.mode || entry || '').trim().toLowerCase())
    .filter(Boolean);
  if (!privacyModes.includes('public') || !privacyModes.includes('private')) {
    return paymentPlanError('santaclawz_privacy_contract_unsupported');
  }
  if (x402Plan?.pricingMode !== 'fixed-exact' || x402Plan?.settlementTrigger !== 'upfront' || x402Plan?.defaultRail !== SANTACLAWZ_BASE_USDC_RAIL.rail) {
    return paymentPlanError('santaclawz_pricing_model_unsupported');
  }
  const readyRails = (Array.isArray(x402Plan?.rails) ? x402Plan.rails : []).filter((rail) => rail?.ready === true);
  if (readyRails.length !== 1) return paymentPlanError('santaclawz_ready_rail_set_unsupported');
  const rail = readyRails[0];
  const feePreview = (Array.isArray(x402Plan?.feePreviewByRail) ? x402Plan.feePreviewByRail : [])
    .find((entry) => entry?.rail === SANTACLAWZ_BASE_USDC_RAIL.rail);
  if (
    rail.rail !== SANTACLAWZ_BASE_USDC_RAIL.rail
    || rail.networkId !== SANTACLAWZ_BASE_USDC_RAIL.networkId
    || rail.assetSymbol !== SANTACLAWZ_BASE_USDC_RAIL.assetSymbol
    || Number(rail.assetDecimals) !== SANTACLAWZ_BASE_USDC_RAIL.assetDecimals
    || rail.assetStandard !== SANTACLAWZ_BASE_USDC_RAIL.assetStandard
    || !sameAddress(rail.assetAddress, SANTACLAWZ_BASE_USDC_RAIL.assetAddress)
    || rail.builderHint !== SANTACLAWZ_BASE_USDC_RAIL.builderHint
    || rail.facilitatorMode !== SANTACLAWZ_BASE_USDC_RAIL.facilitatorMode
    || rail.settlementModel !== SANTACLAWZ_BASE_USDC_RAIL.settlementModel
    || rail.executionMode !== SANTACLAWZ_BASE_USDC_RAIL.executionMode
    || !sameAddress(rail.payTo, feePreview?.sellerPayTo)
    || !sameAddress(rail.payTo, SANTACLAWZ_CODE_AUDIT_PRICE.sellerPayTo)
  ) {
    return paymentPlanError('payment_rail_unsupported');
  }
  if (
    !feePreview
    || !sameAddress(feePreview.protocolFeeRecipient, x402Plan?.protocolOwnerFeePolicy?.recipientByRail?.['base-usdc'])
    || !sameAddress(feePreview.protocolFeeRecipient, SANTACLAWZ_CODE_AUDIT_PRICE.protocolFeePayTo)
  ) {
    return paymentPlanError('santaclawz_fee_split_plan_invalid');
  }
  const grossAtomic = decimalToAtomic(rail.amountUsd, SANTACLAWZ_BASE_USDC_RAIL.assetDecimals);
  const previewGrossAtomic = decimalToAtomic(feePreview.grossAmountUsd, SANTACLAWZ_BASE_USDC_RAIL.assetDecimals);
  const sellerAtomic = decimalToAtomic(feePreview.sellerNetAmountUsd, SANTACLAWZ_BASE_USDC_RAIL.assetDecimals);
  const feeAtomic = decimalToAtomic(feePreview.protocolFeeAmountUsd, SANTACLAWZ_BASE_USDC_RAIL.assetDecimals);
  if (
    !grossAtomic
    || previewGrossAtomic !== grossAtomic
    || !sellerAtomic
    || !feeAtomic
    || !/^\d+$/.test(grossAtomic)
    || !/^\d+$/.test(sellerAtomic)
    || !/^\d+$/.test(feeAtomic)
    || BigInt(sellerAtomic) + BigInt(feeAtomic) !== BigInt(grossAtomic)
    || grossAtomic !== SANTACLAWZ_CODE_AUDIT_PRICE.grossAtomic
    || sellerAtomic !== SANTACLAWZ_CODE_AUDIT_PRICE.sellerAtomic
    || feeAtomic !== SANTACLAWZ_CODE_AUDIT_PRICE.protocolFeeAtomic
  ) {
    return paymentPlanError('santaclawz_fee_split_amount_invalid');
  }
  return {
    ok: true,
    agentId: externalId,
    rail,
    feePreview,
    expected: {
      grossAtomic,
      sellerAtomic,
      protocolFeeAtomic: feeAtomic,
      sellerPayTo: rail.payTo,
      protocolFeePayTo: feePreview.protocolFeeRecipient
    },
    inputLimits,
    privacyModes,
    checkedAt: new Date(nowMs).toISOString(),
    staleAt: new Date(staleAtMs).toISOString()
  };
}

export function validateSantaClawzHireInputContract(hireBody, runtimeContract) {
  if (!runtimeContract?.ok) return paymentPlanError(runtimeContract?.reason || 'santaclawz_runtime_contract_required');
  const taskPrompt = String(hireBody?.taskPrompt || '');
  const requesterContact = String(hireBody?.requesterContact || '');
  const visibility = String(hireBody?.jobPrivacy?.visibility || '').trim().toLowerCase();
  const limits = runtimeContract.inputLimits || {};
  if (!taskPrompt || taskPrompt.length > Number(limits.taskPromptMaxChars || 0)) {
    return paymentPlanError('santaclawz_task_prompt_limit_exceeded');
  }
  if (!requesterContact || requesterContact.length > Number(limits.requesterContactMaxChars || 0)) {
    return paymentPlanError('santaclawz_requester_contact_limit_exceeded');
  }
  if (!['public', 'private'].includes(visibility) || !runtimeContract.privacyModes?.includes(visibility)) {
    return paymentPlanError('santaclawz_privacy_mode_unsupported');
  }
  if (Buffer.byteLength(JSON.stringify(hireBody), 'utf8') > Number(limits.bodyMaxBytes || 0)) {
    return paymentPlanError('santaclawz_hire_body_limit_exceeded');
  }
  return { ok: true, visibility };
}

export function validateSantaClawzPaymentRequirement(paymentRequirement, runtimeContract) {
  if (!runtimeContract?.ok) return paymentPlanError(runtimeContract?.reason || 'santaclawz_runtime_contract_required');
  const accepts = Array.isArray(paymentRequirement?.accepts) ? paymentRequirement.accepts : [];
  const accept = accepts.find((candidate) => candidate?.settlementModel === SANTACLAWZ_BASE_USDC_RAIL.settlementModel);
  const evm = accept?.extensions?.evm || {};
  const feeSplit = evm.feeSplit || {};
  const assetAddress = typeof accept?.asset === 'object' ? accept.asset.address : evm.assetAddress || accept?.asset;
  const amount = String(accept?.amount || accept?.price || '').trim();
  const sellerAmount = String(feeSplit.sellerAmount || '');
  const protocolFeeAmount = String(feeSplit.protocolFeeAmount || '');
  if (!paymentRequirement?.requestId || !accept) return paymentPlanError('santaclawz_payment_requirement_missing');
  if (
    accept.scheme !== 'exact'
    || accept.network !== SANTACLAWZ_BASE_USDC_RAIL.networkId
    || Number(evm.chainId) !== SANTACLAWZ_BASE_USDC_RAIL.chainId
    || !sameAddress(assetAddress, SANTACLAWZ_BASE_USDC_RAIL.assetAddress)
    || evm.amountUnit !== 'atomic'
    || amount !== runtimeContract.expected.grossAtomic
    || !sameAddress(feeSplit.sellerPayTo, runtimeContract.expected.sellerPayTo)
    || !sameAddress(feeSplit.protocolFeePayTo, runtimeContract.expected.protocolFeePayTo)
    || sellerAmount !== runtimeContract.expected.sellerAtomic
    || protocolFeeAmount !== runtimeContract.expected.protocolFeeAtomic
    || !/^\d+$/.test(amount)
    || !/^\d+$/.test(sellerAmount)
    || !/^\d+$/.test(protocolFeeAmount)
    || BigInt(sellerAmount || '0') + BigInt(protocolFeeAmount || '0') !== BigInt(amount || '0')
  ) {
    return paymentPlanError('santaclawz_payment_requirement_changed');
  }
  return { ok: true, accept, summary: runtimeContract.expected };
}
