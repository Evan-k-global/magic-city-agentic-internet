import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { validateSantaClawzCompletedReturn } from '../src/santaclawzReturnPolicy.js';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
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

console.log('santaclawz terminal-state regression passed');
