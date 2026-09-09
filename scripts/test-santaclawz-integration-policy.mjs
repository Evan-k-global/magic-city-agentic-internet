import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  SANTACLAWZ_CODE_AUDIT_EXTERNAL_AGENT_ID,
  isApprovedSantaClawzAgentId,
  isSantaClawzAuditOfferMessage,
  validateSantaClawzHireInputContract,
  validateSantaClawzPaymentRequirement,
  validateSantaClawzRuntimeContract
} from '../src/santaclawzIntegrationPolicy.js';
import {
  validateSantaClawzCompletedReturn,
  verifySantaClawzCompletedReturn
} from '../src/santaclawzReturnPolicy.js';

const nowMs = Date.parse('2026-09-09T17:11:12.000Z');
const ready = {
  schemaVersion: 'santaclawz-agent-readiness/1.0',
  ok: true,
  agentId: SANTACLAWZ_CODE_AUDIT_EXTERNAL_AGENT_ID,
  online: true,
  paymentsReady: true,
  paidExecutionReady: true,
  limits: {
    taskPromptMaxChars: 2000,
    requesterContactMaxChars: 240,
    bodyMaxBytes: 32768
  },
  privacyModes: [{ mode: 'public' }, { mode: 'private' }, { mode: 'buyer_encrypted' }],
  readiness: {
    relayConnected: true,
    heartbeatLive: true,
    runtimeReachable: true,
    workerReachable: true,
    published: true,
    hireable: true
  },
  availability: { heartbeat: { staleAtIso: '2026-09-09T17:11:41.000Z' } }
};
const x402Plan = {
  agentId: SANTACLAWZ_CODE_AUDIT_EXTERNAL_AGENT_ID,
  published: true,
  paymentsEnabled: true,
  paymentProfileReady: true,
  payoutAddressConfigured: true,
  pricingMode: 'fixed-exact',
  settlementTrigger: 'upfront',
  defaultRail: 'base-usdc',
  stateFreshness: 'fresh',
  planProjectionPending: false,
  heartbeatSafety: { paidPreflightSafe: true, staleAtIso: '2026-09-09T17:11:41.000Z' },
  protocolOwnerFeePolicy: {
    recipientByRail: { 'base-usdc': '0xF787fF44c5e80c8165e1B4FB156411e2d42c91B2' }
  },
  feePreviewByRail: [{
    rail: 'base-usdc',
    grossAmountUsd: '0.10',
    sellerNetAmountUsd: '0.098',
    protocolFeeAmountUsd: '0.002',
    sellerPayTo: '0x1FC80745F8c0acfeEb8C4128bC20A622d1D6ef22',
    protocolFeeRecipient: '0xF787fF44c5e80c8165e1B4FB156411e2d42c91B2'
  }],
  rails: [{
    rail: 'base-usdc',
    networkId: 'eip155:8453',
    assetSymbol: 'USDC',
    assetDecimals: 6,
    assetStandard: 'erc20',
    assetAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    builderHint: 'buildBaseMainnetUsdcRail',
    facilitatorMode: 'x402-http',
    settlementModel: 'x402-exact-evm-fee-split-v1',
    executionMode: 'settle-first',
    payTo: '0x1FC80745F8c0acfeEb8C4128bC20A622d1D6ef22',
    amountUsd: '0.10',
    ready: true
  }]
};

for (const text of ['code audit', 'AUDIT this repo', 'audit?', 'what is a code audit?']) {
  assert.equal(isSantaClawzAuditOfferMessage(text), true, text);
}
for (const text of ['auditor', 'auditing', 'audition', 'security review', 'https://github.com/example/repo']) {
  assert.equal(isSantaClawzAuditOfferMessage(text), false, text);
}
assert.equal(isApprovedSantaClawzAgentId(SANTACLAWZ_CODE_AUDIT_EXTERNAL_AGENT_ID), true);
assert.equal(isApprovedSantaClawzAgentId('hosted-code-auditor--session_agent_wrong'), false);

const runtime = validateSantaClawzRuntimeContract({
  agentId: SANTACLAWZ_CODE_AUDIT_EXTERNAL_AGENT_ID,
  ready,
  x402Plan,
  nowMs
});
assert.equal(runtime.ok, true);
assert.equal(validateSantaClawzHireInputContract({
  taskPrompt: 'Audit https://github.com/example/repo',
  requesterContact: 'magic-city:test',
  jobContext: { urls: ['https://github.com/example/repo'] },
  jobPrivacy: { visibility: 'private' }
}, runtime).ok, true);
assert.equal(validateSantaClawzHireInputContract({
  taskPrompt: 'Audit https://github.com/example/repo',
  requesterContact: 'magic-city:test',
  jobContext: { urls: ['https://github.com/example/repo'] },
  jobPrivacy: { visibility: 'buyer_encrypted' }
}, runtime).reason, 'santaclawz_privacy_mode_unsupported');
assert.equal(validateSantaClawzHireInputContract({
  taskPrompt: 'x'.repeat(2001),
  requesterContact: 'magic-city:test',
  jobPrivacy: { visibility: 'private' }
}, runtime).reason, 'santaclawz_task_prompt_limit_exceeded');

for (const mutation of [
  (plan) => { plan.rails[0].networkId = 'eip155:1'; },
  (plan) => { plan.rails[0].assetAddress = '0x0000000000000000000000000000000000000001'; },
  (plan) => { plan.rails[0].builderHint = 'unknown-builder'; },
  (plan) => {
    plan.rails[0].payTo = '0x0000000000000000000000000000000000000001';
    plan.feePreviewByRail[0].sellerPayTo = '0x0000000000000000000000000000000000000001';
  },
  (plan) => { plan.feePreviewByRail[0].protocolFeeRecipient = '0x0000000000000000000000000000000000000001'; },
  (plan) => { plan.feePreviewByRail[0].grossAmountUsd = '0.11'; },
  (plan) => { plan.rails[0].amountUsd = '0.11'; },
  (plan) => { plan.rails.push({ rail: 'zeko-native', ready: true }); }
]) {
  const changed = structuredClone(x402Plan);
  mutation(changed);
  assert.equal(validateSantaClawzRuntimeContract({ agentId: SANTACLAWZ_CODE_AUDIT_EXTERNAL_AGENT_ID, ready, x402Plan: changed, nowMs }).ok, false);
}
assert.equal(validateSantaClawzRuntimeContract({
  agentId: SANTACLAWZ_CODE_AUDIT_EXTERNAL_AGENT_ID,
  ready: { ...ready, availability: { heartbeat: { staleAtIso: '2026-09-09T17:11:11.000Z' } } },
  x402Plan,
  nowMs
}).reason, 'santaclawz_readiness_stale');

const requirement = {
  protocol: 'x402',
  requestId: 'hire_current_contract',
  accepts: [{
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    amount: '100000',
    settlementModel: 'x402-exact-evm-fee-split-v1',
    extensions: { evm: {
      chainId: 8453,
      amountUnit: 'atomic',
      feeSplit: {
        sellerPayTo: '0x1FC80745F8c0acfeEb8C4128bC20A622d1D6ef22',
        protocolFeePayTo: '0xF787fF44c5e80c8165e1B4FB156411e2d42c91B2',
        sellerAmount: '98000',
        protocolFeeAmount: '2000'
      }
    } }
  }]
};
assert.equal(validateSantaClawzPaymentRequirement(requirement, runtime).ok, true);
const changedRequirement = structuredClone(requirement);
changedRequirement.accepts[0].extensions.evm.feeSplit.sellerAmount = '97000';
assert.equal(validateSantaClawzPaymentRequirement(changedRequirement, runtime).reason, 'santaclawz_payment_requirement_changed');
for (const mutate of [
  (value) => { value.accepts[0].scheme = 'upto'; },
  (value) => { value.accepts[0].network = 'eip155:1'; },
  (value) => { value.accepts[0].asset = '0x0000000000000000000000000000000000000001'; },
  (value) => { value.accepts[0].amount = '110000'; },
  (value) => { value.accepts[0].extensions.evm.feeSplit.sellerPayTo = '0x0000000000000000000000000000000000000001'; },
  (value) => { value.accepts[0].extensions.evm.feeSplit.protocolFeePayTo = '0x0000000000000000000000000000000000000001'; }
]) {
  const changed = structuredClone(requirement);
  mutate(changed);
  assert.equal(validateSantaClawzPaymentRequirement(changed, runtime).ok, false);
}

const completedOutput = '# Audit';
const completedOutputHash = crypto.createHash('sha256').update(completedOutput).digest('hex');
const completedFileHashes = { 'audit.md': completedOutputHash };
const completedPackageHash = crypto.createHash('sha256').update(JSON.stringify(completedFileHashes)).digest('hex');
const completedReturn = {
  schema_version: 'santaclawz-return/1.0',
  request_id: 'hire_current_contract',
  status: 'completed',
  agent_private: true,
  verified_output: {
    package_hash: completedPackageHash,
    hash_algorithm: 'sha256',
    verification_manifest: {
      input_digest_sha256: 'b'.repeat(64),
      checks_performed: ['dependency review'],
      request_id: 'hire_current_contract',
      package_hash: completedPackageHash,
      files_produced: [{ name: 'audit.md', sha256: completedOutputHash }],
      file_hashes: completedFileHashes,
      blocked_suspicious_instructions: []
    },
    deliverables: [{ name: 'audit.md', sha256: completedOutputHash, content_type: 'text/markdown' }],
    buyer_visible_outputs: [{ name: 'audit.md', text: completedOutput, sha256: completedOutputHash }]
  }
};
assert.equal(validateSantaClawzCompletedReturn(completedReturn, { expectedRequestId: 'hire_current_contract' }).ok, true);
assert.equal(validateSantaClawzCompletedReturn({ ...completedReturn, request_id: 'wrong' }, { expectedRequestId: 'hire_current_contract' }).reason, 'santaclawz_return_request_mismatch');
assert.equal(validateSantaClawzCompletedReturn({ ...completedReturn, verified_output: { ...completedReturn.verified_output, deliverables: [] } }).reason, 'santaclawz_deliverables_invalid');
assert.equal(validateSantaClawzCompletedReturn({
  ...completedReturn,
  verified_output: { ...completedReturn.verified_output, buyer_visible_outputs: [] }
}).reason, 'santaclawz_buyer_delivery_missing');
assert.equal(validateSantaClawzCompletedReturn({
  ...completedReturn,
  verified_output: {
    ...completedReturn.verified_output,
    buyer_visible_outputs: [{ name: 'audit.md', sha256: completedOutputHash }]
  }
}).reason, 'santaclawz_buyer_delivery_missing');
assert.equal(validateSantaClawzCompletedReturn({
  ...completedReturn,
  verified_output: {
    ...completedReturn.verified_output,
    buyer_visible_outputs: [{ name: 'audit.md', text: '# Contradictory audit', sha256: completedOutputHash }]
  }
}).reason, 'santaclawz_inline_output_hash_mismatch');
assert.equal((await verifySantaClawzCompletedReturn(completedReturn, {
  expectedRequestId: 'hire_current_contract',
  expectedInputDigestSha256: 'b'.repeat(64)
})).ok, true);
assert.equal((await verifySantaClawzCompletedReturn(completedReturn, {
  expectedRequestId: 'hire_current_contract',
  expectedInputDigestSha256: 'f'.repeat(64)
})).reason, 'santaclawz_return_input_mismatch');

const referencedReturn = structuredClone(completedReturn);
referencedReturn.verified_output.deliverables[0].uri = 'https://api.santaclawz.ai/artifacts/audit.md';
referencedReturn.verified_output.buyer_visible_outputs = [];
assert.equal((await verifySantaClawzCompletedReturn(referencedReturn, {
  expectedRequestId: 'hire_current_contract',
  resolveArtifactBytes: async () => ({ bytes: Buffer.from(completedOutput, 'utf8') })
})).ok, true);
assert.equal((await verifySantaClawzCompletedReturn(referencedReturn, {
  expectedRequestId: 'hire_current_contract',
  resolveArtifactBytes: async () => ({ bytes: Buffer.from('wrong bytes', 'utf8') })
})).reason, 'santaclawz_deliverable_hash_mismatch');

console.log('santaclawz integration policy regression passed');
