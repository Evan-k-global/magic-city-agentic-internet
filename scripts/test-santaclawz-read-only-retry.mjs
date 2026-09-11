import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const start = server.indexOf('function scheduleSantaClawzCreditBackedSamePayloadRetry(');
const end = server.indexOf('\nfunction summarizeSantaClawzPaidExecution(', start);
assert.ok(start >= 0 && end > start, 'SantaClawz retry scheduler not found');

let live = false;
let queuedCallback = null;
let runtimeLookupCount = 0;
let signedPayloadCount = 0;
let hirePostCount = 0;

const dependencies = {
  isSantaClawzHireSubmissionEnabled: () => live,
  santaClawzSamePayloadRetriesInFlight: new Set(),
  getMagicCityCreditBackedX402Signer: () => ({ address: '0x0000000000000000000000000000000000000001' }),
  sanitizeMetadata: (value) => value,
  updateConnectorSession: (_id, value) => value,
  withTaskPackage: (_session, value) => value,
  setImmediate: (callback) => { queuedCallback = callback; },
  assertApprovedSantaClawzAgent: (value) => value,
  fetchSantaClawzRuntimeContract: async () => { runtimeLookupCount += 1; return { ok: true }; },
  validateSantaClawzPaymentRequirement: () => ({ ok: true }),
  createHttpError: (message) => new Error(message),
  buildServerSignedSantaClawzX402PaymentPayload: async () => { signedPayloadCount += 1; return {}; },
  santaClawzPaymentPayloadDigestSha256: () => 'd'.repeat(64),
  requestSantaClawzEndpointJson: async () => { hirePostCount += 1; return { ok: true, status: 202, payload: {} }; },
  getConnectorSession: () => null,
  resolveSantaClawzExecutionRequestId: () => null,
  getSantaClawzSourceStatus: () => ({ apiBase: 'https://api.santaclawz.ai' }),
  externalSantaClawzAgentId: (value) => value
};

const names = Object.keys(dependencies);
const scheduler = new Function(
  ...names,
  `${server.slice(start, end)}\nreturn scheduleSantaClawzCreditBackedSamePayloadRetry;`
)(...names.map((name) => dependencies[name]));

const session = {
  id: 'cs_read_only_retry',
  santaclawzDirectPayment: {
    agentId: 'code-audit-agent',
    rail: 'credit_backed_x402',
    paymentPayloadDigestSha256: 'd'.repeat(64),
    paymentRequirement: { requestId: 'hire_read_only_retry' },
    paymentPayloadIssuedAtIso: new Date().toISOString(),
    taskPrompt: 'Audit the repository.',
    hireBody: { taskPrompt: 'Audit the repository.' },
    hireBodyDigestSha256: 'e'.repeat(64),
    paymentState: {
      retryResume: {
        safeToRetrySamePayload: true,
        safeToCreateNewPayment: false
      }
    }
  }
};

assert.equal(scheduler(session), false, 'read_only must not schedule a retry');
assert.equal(queuedCallback, null);

live = true;
assert.equal(scheduler(session), true, 'live mode should schedule the eligible retry');
assert.equal(typeof queuedCallback, 'function');

live = false;
await queuedCallback();
assert.equal(runtimeLookupCount, 0, 'a queued callback must stop before runtime lookup after rollback');
assert.equal(signedPayloadCount, 0, 'a queued callback must not sign after rollback');
assert.equal(hirePostCount, 0, 'a queued callback must not submit a hire after rollback');

console.log('santaclawz read-only retry regression passed');
