import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  validateSantaClawzCompletedReturn,
  verifySantaClawzCompletedReturn
} from '../src/santaclawzReturnPolicy.js';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const restrictStart = server.indexOf('function restrictSantaClawzDeliveryToVerifiedOutputs(');
const restrictEnd = server.indexOf('\nfunction santaClawzSourceDeliveryDigest', restrictStart);
assert.ok(restrictStart >= 0 && restrictEnd > restrictStart, 'delivery restriction function not found');
const restrictDelivery = new Function(
  `${server.slice(restrictStart, restrictEnd)}\nreturn restrictSantaClawzDeliveryToVerifiedOutputs;`
)();
const start = server.indexOf('function summarizeSantaClawzPaidExecution(');
const end = server.indexOf('\nfunction returnSantaClawzCreditsForTerminalFailure', start);
assert.ok(start >= 0 && end > start, 'summary function not found');

const summarize = new Function(
  'extractSantaClawzDelivery',
  'validateSantaClawzCompletedReturn',
  `${server.slice(start, end)}\nreturn summarizeSantaClawzPaidExecution;`
)(
  (payload) => ({ artifacts: payload?.protocolReturn ? [{ url: 'https://api.santaclawz.ai/output' }] : [], inlineOutputs: [] }),
  validateSantaClawzCompletedReturn
);

const rejected = summarize(true, {
  paymentStatus: 'return_rejected',
  settlementStatus: 'not_attempted',
  protocolLifecycle: {
    protocolState: 'SELLER_FAILED_NO_SETTLEMENT',
    terminal: true,
    paymentFinality: 'not_settled',
    sellerOutcome: 'failed',
    buyerAnswer: { canCreateFreshPayment: true }
  },
  agentStatus: {
    terminal: true,
    safeToCreateNewPayment: false,
    doNotCreateNewPayment: true
  },
  executionState: {
    status: 'failed',
    lifecycle: {
      returnRejection: {
        code: 'return_schema_rejected',
        message: 'Failed SantaClawz return package must include incident_id.'
      }
    },
    lifecycleChecks: { failed: true, terminal: true }
  },
  retryResume: { terminal: true, safeToCreateNewPayment: true }
});

assert.equal(rejected.completed, false);
assert.equal(rejected.paymentAccepted, false);
assert.equal(rejected.terminalFailure, true);
assert.equal(rejected.returnRejected, true);
assert.equal(rejected.paymentFinality, 'not_settled');
assert.equal(rejected.protocolAllowsFreshPayment, true);
assert.equal(rejected.agentFixRequired, true);
assert.equal(rejected.retryBlocked, false);
assert.equal(rejected.safeToCreateFreshPayment, true);
assert.match(rejected.failureReason, /incident_id/);
assert.equal(rejected.nextAction, 'retry_new_job_after_agent_fix');

const unknownFailure = summarize(true, {
  paymentStatus: 'return_rejected',
  settlementStatus: 'not_attempted',
  operationalStatus: {
    paymentStatus: 'return_rejected',
    settlementStatus: 'not_attempted',
    relayDeliveryStatus: 'forwarded',
    agentExecutionStatus: 'failed'
  },
  protocolLifecycle: {
    protocolState: 'SELLER_FAILED_NO_SETTLEMENT',
    terminal: true,
    sellerOutcome: 'failed',
    buyerAnswer: { canCreateFreshPayment: true }
  },
  returnRejection: {
    reason: 'unknown',
    sellerAction: 'fix_return_package_and_rerun'
  }
});
assert.equal(unknownFailure.safeToCreateFreshPayment, true);
assert.match(unknownFailure.failureReason, /acknowledged the job but failed before delivering/i);

const partial = summarize(true, {
  paymentStatus: 'seller_settled',
  settlementStatus: 'partially_settled',
  relayDeliveryStatus: 'forwarded',
  agentExecutionStatus: 'completed'
});
assert.equal(partial.completed, false);

const protocolOutput = '# Audit';
const protocolOutputHash = crypto.createHash('sha256').update(protocolOutput).digest('hex');
const protocolFileHashes = { 'audit.md': protocolOutputHash };
const protocolPackageHash = crypto.createHash('sha256').update(JSON.stringify(protocolFileHashes)).digest('hex');
const protocolReturn = {
  schema_version: 'santaclawz-return/1.0',
  request_id: 'hire_terminal_complete',
  status: 'completed',
  agent_private: true,
  verified_output: {
    package_hash: protocolPackageHash,
    hash_algorithm: 'sha256',
    verification_manifest: {
      input_digest_sha256: 'b'.repeat(64),
      checks_performed: ['audit'],
      request_id: 'hire_terminal_complete',
      package_hash: protocolPackageHash,
      files_produced: [{ name: 'audit.md', sha256: protocolOutputHash }],
      file_hashes: protocolFileHashes,
      blocked_suspicious_instructions: []
    },
    deliverables: [{ name: 'audit.md', sha256: protocolOutputHash }],
    buyer_visible_outputs: [{ name: 'audit.md', text: protocolOutput, sha256: protocolOutputHash }]
  }
};
const completed = summarize(true, {
  paymentStatus: 'seller_settled',
  settlementStatus: 'partially_settled',
  relayDeliveryStatus: 'forwarded',
  agentExecutionStatus: 'completed',
  protocolLifecycle: {
    protocolState: 'DELIVERED_SETTLED',
    paymentFinality: 'settled',
    terminal: true,
    sellerOutcome: 'completed'
  },
  protocolReturn
}, { expectedRequestId: 'hire_terminal_complete' });
assert.equal(completed.completed, true);
assert.equal(completed.returnValidation.ok, true);

const directMarkdown = '# Audit summary\n\nComplete.\n';
const directJson = `${JSON.stringify({ findings: Array.from({ length: 700 }, (_, index) => ({ id: index, detail: 'verified finding' })) })}\n`;
assert.ok(directJson.length > 8000);
const directOutputs = [
  { name: 'code-audit-summary.md', contentType: 'text/markdown', text: directMarkdown },
  { name: 'code-audit-result.json', contentType: 'application/json', text: directJson }
].map((entry) => ({
  ...entry,
  sha256: crypto.createHash('sha256').update(entry.text).digest('hex')
}));
const directOutputHashes = Object.fromEntries(
  directOutputs.map((entry) => [entry.name, entry.sha256]).sort(([left], [right]) => left.localeCompare(right))
);
const directOutputBundleDigestSha256 = crypto.createHash('sha256')
  .update(JSON.stringify(directOutputHashes))
  .digest('hex');
const directPayload = {
  executionState: {
    requestId: 'hire_direct_complete',
    stateAccess: { mode: 'payment_digest_recovery' },
    currentPhase: 'return_verified',
    protocolState: 'DELIVERED_SETTLED',
    lifecycle: { proofStatus: 'return_validated' },
    delivery: {
      protocolVerifiedOutput: {
        packageHash: 'c'.repeat(64),
        inputDigestSha256: 'd'.repeat(64),
        packageHashVerified: true,
        buyerOutputBundleDigestSha256: directOutputBundleDigestSha256,
        buyerVisibleOutputs: directOutputs
      }
    }
  }
};
const directVerified = await verifySantaClawzCompletedReturn(directPayload, {
  expectedRequestId: 'hire_direct_complete',
  expectedInputDigestSha256: 'd'.repeat(64)
});
assert.equal(directVerified.ok, true);
assert.equal(directVerified.mode, 'authenticated_direct_output');
assert.equal(directVerified.verifiedDeliverableCount, 2);
assert.equal(JSON.parse(directOutputs[1].text).findings.length, 700);
const directCompleted = summarize(true, {
  ...directPayload,
  paymentStatus: 'settled',
  settlementStatus: 'settled',
  relayDeliveryStatus: 'forwarded',
  agentExecutionStatus: 'completed',
  protocolLifecycle: {
    protocolState: 'DELIVERED_SETTLED',
    paymentFinality: 'settled',
    terminal: true,
    sellerOutcome: 'completed'
  }
}, {
  expectedRequestId: 'hire_direct_complete',
  verifiedReturn: directVerified
});
assert.equal(directCompleted.completed, true);
assert.equal(directCompleted.returnValidation.ok, true);

const truncatedDirectPayload = structuredClone(directPayload);
truncatedDirectPayload.executionState.delivery.protocolVerifiedOutput.buyerVisibleOutputs[1].text = directJson.slice(0, 8000);
const truncatedDirect = await verifySantaClawzCompletedReturn(truncatedDirectPayload, {
  expectedRequestId: 'hire_direct_complete',
  expectedInputDigestSha256: 'd'.repeat(64)
});
assert.equal(truncatedDirect.ok, false);
assert.equal(truncatedDirect.reason, 'santaclawz_inline_output_hash_mismatch');

const settledTruncatedPayload = structuredClone(truncatedDirectPayload);
settledTruncatedPayload.executionState.protocolLifecycle = {
  protocolState: 'DELIVERED_SETTLED',
  paymentFinality: 'settled',
  terminal: true,
  sellerOutcome: 'completed'
};
settledTruncatedPayload.executionState.lifecycleChecks = { terminal: true };
const settledTruncated = await verifySantaClawzCompletedReturn(settledTruncatedPayload, {
  expectedRequestId: 'hire_direct_complete',
  expectedInputDigestSha256: 'd'.repeat(64)
});
assert.equal(settledTruncated.ok, true);
assert.equal(settledTruncated.mode, 'authenticated_terminal_lifecycle');
assert.equal(settledTruncated.upstreamLifecycleVerified, true);
assert.equal(settledTruncated.partialDelivery, true);
assert.deepEqual(settledTruncated.verifiedBuyerOutputs.map((entry) => entry.name), ['code-audit-summary.md']);
assert.deepEqual(settledTruncated.suppressedBuyerOutputs, [{
  name: 'code-audit-result.json',
  reason: 'received_bytes_hash_mismatch'
}]);

const settledTruncatedSummary = summarize(true, {
  ...settledTruncatedPayload,
  paymentStatus: 'settled',
  settlementStatus: 'settled',
  relayDeliveryStatus: 'forwarded',
  agentExecutionStatus: 'completed',
  protocolLifecycle: settledTruncatedPayload.executionState.protocolLifecycle
}, {
  expectedRequestId: 'hire_direct_complete',
  verifiedReturn: settledTruncated
});
assert.equal(settledTruncatedSummary.completed, true);
assert.equal(settledTruncatedSummary.returnValidation.verificationSource, 'santaclawz_authenticated_lifecycle');

const awaitingSettlementPayload = structuredClone(truncatedDirectPayload);
awaitingSettlementPayload.executionState.protocolLifecycle = {
  protocolState: 'DELIVERED_AWAITING_SETTLEMENT',
  paymentFinality: 'pending',
  terminal: false,
  sellerOutcome: 'completed'
};
awaitingSettlementPayload.executionState.lifecycleChecks = { terminal: false };
const awaitingSettlement = await verifySantaClawzCompletedReturn(awaitingSettlementPayload, {
  expectedRequestId: 'hire_direct_complete',
  expectedInputDigestSha256: 'd'.repeat(64)
});
assert.equal(awaitingSettlement.ok, false);
assert.equal(awaitingSettlement.pending, true);
assert.equal(awaitingSettlement.retryable, true);
assert.equal(awaitingSettlement.reason, 'santaclawz_settlement_pending');
assert.equal(awaitingSettlement.mode, 'authenticated_pending_lifecycle');
assert.deepEqual(awaitingSettlement.verifiedBuyerOutputs.map((entry) => entry.name), ['code-audit-summary.md']);
assert.deepEqual(awaitingSettlement.suppressedBuyerOutputs, [{
  name: 'code-audit-result.json',
  reason: 'received_bytes_hash_mismatch'
}]);

const awaitingSettlementSummary = summarize(true, {
  ...awaitingSettlementPayload,
  paymentStatus: 'unknown',
  settlementStatus: 'pending',
  relayDeliveryStatus: 'forwarded',
  agentExecutionStatus: 'completed',
  protocolLifecycle: awaitingSettlementPayload.executionState.protocolLifecycle
}, {
  expectedRequestId: 'hire_direct_complete',
  verifiedReturn: awaitingSettlement
});
assert.equal(awaitingSettlementSummary.completed, false);
assert.equal(awaitingSettlementSummary.paymentAccepted, true);
assert.equal(awaitingSettlementSummary.terminalFailure, false);
assert.equal(awaitingSettlementSummary.returnRejected, false);
assert.equal(awaitingSettlementSummary.returnVerificationPending, true);
assert.equal(awaitingSettlementSummary.safeToCreateFreshPayment, false);
assert.equal(awaitingSettlementSummary.nextAction, 'retry_return_verification');
const awaitingSettlementDelivery = restrictDelivery({
  summary: null,
  inlineOutputs: directOutputs.flatMap((output) => [output.name, output.text]),
  artifacts: []
}, awaitingSettlement);
assert.equal(awaitingSettlementDelivery.summary, directMarkdown);
assert.deepEqual(awaitingSettlementDelivery.inlineOutputs, [
  'code-audit-summary.md',
  directMarkdown
]);
assert.equal(awaitingSettlementDelivery.verification.partialDelivery, true);
assert.deepEqual(awaitingSettlementDelivery.verification.suppressedOutputs, [{
  name: 'code-audit-result.json',
  reason: 'received_bytes_hash_mismatch'
}]);

const invalidAwaitingSettlementPayload = structuredClone(awaitingSettlementPayload);
invalidAwaitingSettlementPayload.executionState.protocolLifecycle.terminal = true;
const invalidAwaitingSettlement = await verifySantaClawzCompletedReturn(invalidAwaitingSettlementPayload, {
  expectedRequestId: 'hire_direct_complete',
  expectedInputDigestSha256: 'd'.repeat(64)
});
assert.equal(invalidAwaitingSettlement.ok, false);
assert.equal(invalidAwaitingSettlement.pending, undefined);

const wrongSettledRequest = await verifySantaClawzCompletedReturn(settledTruncatedPayload, {
  expectedRequestId: 'hire_different',
  expectedInputDigestSha256: 'd'.repeat(64)
});
assert.equal(wrongSettledRequest.ok, false);
assert.equal(wrongSettledRequest.reason, 'santaclawz_return_request_mismatch');

const wrongSettledInput = structuredClone(settledTruncatedPayload);
wrongSettledInput.executionState.delivery.protocolVerifiedOutput.inputDigestSha256 = 'e'.repeat(64);
const wrongSettledInputResult = await verifySantaClawzCompletedReturn(wrongSettledInput, {
  expectedRequestId: 'hire_direct_complete',
  expectedInputDigestSha256: 'd'.repeat(64)
});
assert.equal(wrongSettledInputResult.ok, false);
assert.equal(wrongSettledInputResult.reason, 'santaclawz_return_input_mismatch');

const missingJsonPayload = structuredClone(directPayload);
missingJsonPayload.executionState.delivery.protocolVerifiedOutput.buyerVisibleOutputs.pop();
const missingJsonDirect = await verifySantaClawzCompletedReturn(missingJsonPayload, {
  expectedRequestId: 'hire_direct_complete',
  expectedInputDigestSha256: 'd'.repeat(64)
});
assert.equal(missingJsonDirect.ok, false);
assert.equal(missingJsonDirect.reason, 'santaclawz_buyer_delivery_missing');

const wrongInputDirect = await verifySantaClawzCompletedReturn(directPayload, {
  expectedRequestId: 'hire_direct_complete',
  expectedInputDigestSha256: 'e'.repeat(64)
});
assert.equal(wrongInputDirect.ok, false);
assert.equal(wrongInputDirect.reason, 'santaclawz_return_input_mismatch');

const pendingReturnVerification = summarize(true, {
  paymentStatus: 'seller_settled',
  settlementStatus: 'partially_settled',
  relayDeliveryStatus: 'forwarded',
  agentExecutionStatus: 'completed',
  protocolLifecycle: {
    protocolState: 'DELIVERED_SETTLED',
    paymentFinality: 'settled',
    terminal: true,
    sellerOutcome: 'completed'
  },
  protocolReturn
}, {
  expectedRequestId: 'hire_terminal_complete',
  verifiedReturn: {
    ok: false,
    pending: true,
    retryable: true,
    reason: 'santaclawz_deliverable_temporarily_unavailable'
  }
});
assert.equal(pendingReturnVerification.completed, false);
assert.equal(pendingReturnVerification.paymentAccepted, true);
assert.equal(pendingReturnVerification.terminalFailure, false);
assert.equal(pendingReturnVerification.returnRejected, false);
assert.equal(pendingReturnVerification.returnVerificationPending, true);
assert.equal(pendingReturnVerification.safeToCreateFreshPayment, false);
assert.equal(pendingReturnVerification.nextAction, 'retry_return_verification');

console.log('santaclawz terminal-state regression passed');
