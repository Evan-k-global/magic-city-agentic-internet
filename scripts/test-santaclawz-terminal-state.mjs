import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const start = server.indexOf('function summarizeSantaClawzPaidExecution(');
const end = server.indexOf('\nfunction returnSantaClawzCreditsForTerminalFailure', start);
assert.ok(start >= 0 && end > start, 'summary function not found');

const summarize = new Function(
  'extractSantaClawzDelivery',
  `${server.slice(start, end)}\nreturn summarizeSantaClawzPaidExecution;`
)(() => ({ artifacts: [], inlineOutputs: [] }));

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

console.log('santaclawz terminal-state regression passed');
