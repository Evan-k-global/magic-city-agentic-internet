import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createSantaClawzStatusRefreshCoordinator,
  hasSemanticSantaClawzStatusChanged,
  semanticSantaClawzStatusDigest
} from '../src/santaclawzStatusRefresh.js';

const productionShapedState = {
  status: 'executing',
  santaclawzDirectPayment: {
    status: 'submitted',
    paymentPayloadDigestSha256: 'a'.repeat(64),
    lastStatusAt: '2026-09-10T06:40:00.000Z',
    summary: {
      paymentStatus: 'settled',
      settlementStatus: 'settled',
      relayDeliveryStatus: 'forwarded',
      agentExecutionStatus: 'completed',
      returnValidation: { ok: false, reason: 'santaclawz_return_missing' }
    },
    paymentState: {
      protocolLifecycle: {
        protocolState: 'DELIVERED_SETTLED',
        generatedAtIso: '2026-09-10T06:40:00.000Z'
      },
      ledger: Array.from({ length: 250 }, (_, index) => ({
        id: `entry-${index}`,
        status: index === 249 ? 'settled' : 'recorded',
        updatedAt: '2026-09-10T06:40:00.000Z'
      }))
    },
    executionState: {
      status: 'completed',
      stateProjectionUpdatedAtIso: '2026-09-10T06:40:00.000Z',
      delivery: {
        protocolVerifiedOutput: {
          buyerVisibleOutputs: [
            { name: 'audit.md', text: '# Audit\n\nResult.' },
            { name: 'audit.json', text: '{"audit_status":"completed"}' }
          ]
        }
      }
    },
    delivery: {
      inlineOutputs: ['# Audit\n\nResult.', '{"audit_status":"completed"}'],
      artifacts: [{ label: 'audit.md', url: '/artifacts/session/audit.md' }]
    }
  },
  creditReservation: { status: 'locked', requiredCredits: 10 }
};

const timestampOnlyUpdate = structuredClone(productionShapedState);
timestampOnlyUpdate.santaclawzDirectPayment.lastStatusAt = '2026-09-10T06:41:00.000Z';
timestampOnlyUpdate.santaclawzDirectPayment.paymentState.protocolLifecycle.generatedAtIso = '2026-09-10T06:41:00.000Z';
timestampOnlyUpdate.santaclawzDirectPayment.paymentState.ledger.forEach((entry) => {
  entry.updatedAt = '2026-09-10T06:41:00.000Z';
});
timestampOnlyUpdate.santaclawzDirectPayment.executionState.stateProjectionUpdatedAtIso = '2026-09-10T06:41:00.000Z';
assert.equal(hasSemanticSantaClawzStatusChanged(productionShapedState, timestampOnlyUpdate), false);

const heartbeatOnlyUpdate = structuredClone(timestampOnlyUpdate);
heartbeatOnlyUpdate.santaclawzDirectPayment.heartbeatAt = '2026-09-10T06:42:00.000Z';
assert.equal(hasSemanticSantaClawzStatusChanged(timestampOnlyUpdate, heartbeatOnlyUpdate), false);

const artifactFormatChange = structuredClone(timestampOnlyUpdate);
artifactFormatChange.santaclawzDirectPayment.delivery.artifacts[0].format = 'json';
assert.equal(hasSemanticSantaClawzStatusChanged(timestampOnlyUpdate, artifactFormatChange), true);

const artifactContentChange = structuredClone(timestampOnlyUpdate);
artifactContentChange.santaclawzDirectPayment.delivery.inlineOutputs[0] = '# Audit\n\nChanged result.';
assert.equal(hasSemanticSantaClawzStatusChanged(timestampOnlyUpdate, artifactContentChange), true);

const proofChange = structuredClone(timestampOnlyUpdate);
proofChange.santaclawzDirectPayment.summary.returnValidation.proofHash = 'b'.repeat(64);
assert.equal(hasSemanticSantaClawzStatusChanged(timestampOnlyUpdate, proofChange), true);

const expiryChange = structuredClone(timestampOnlyUpdate);
expiryChange.santaclawzDirectPayment.expiresAt = '2026-09-10T07:40:00.000Z';
assert.equal(hasSemanticSantaClawzStatusChanged(timestampOnlyUpdate, expiryChange), true);

const settlementTransition = structuredClone(timestampOnlyUpdate);
settlementTransition.creditReservation.status = 'settled';
assert.equal(hasSemanticSantaClawzStatusChanged(productionShapedState, settlementTransition), true);

let nowMs = 1000;
let upstreamCalls = 0;
let releaseFirst;
const coordinator = createSantaClawzStatusRefreshCoordinator({
  freshnessMs: 4000,
  now: () => nowMs
});
const first = coordinator.run('cs-259:digest', async () => {
  upstreamCalls += 1;
  await new Promise((resolve) => { releaseFirst = resolve; });
  return { persisted: false, session: productionShapedState };
});
const overlapping = coordinator.run('cs-259:digest', async () => {
  upstreamCalls += 1;
  return { persisted: true };
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(upstreamCalls, 1, 'overlapping status reads must share one upstream request');
releaseFirst();
assert.equal(await overlapping, await first);

const cached = await coordinator.run('cs-259:digest', async () => {
  upstreamCalls += 1;
  return { persisted: true };
});
assert.equal(cached.reason, 'fresh_status_cache');
assert.equal(upstreamCalls, 1);

nowMs += 4001;
await coordinator.run('cs-259:digest', async () => {
  upstreamCalls += 1;
  return { persisted: false };
});
assert.equal(upstreamCalls, 2);

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const refreshDecisionStart = server.indexOf('function shouldRefreshSantaClawzFulfilledDelivery(');
const refreshDecisionEnd = server.indexOf('\nfunction buildSantaClawzFulfillmentDeliveryPatch', refreshDecisionStart);
assert.ok(refreshDecisionStart >= 0 && refreshDecisionEnd > refreshDecisionStart, 'fulfilled delivery refresh decision not found');
const shouldRefreshFulfilledDelivery = new Function(
  `${server.slice(refreshDecisionStart, refreshDecisionEnd)}\nreturn shouldRefreshSantaClawzFulfilledDelivery;`
)();
const partialFulfilled = structuredClone(productionShapedState);
partialFulfilled.status = 'fulfilled';
partialFulfilled.santaclawzDirectPayment.delivery.verification = { partialDelivery: true };
assert.equal(shouldRefreshFulfilledDelivery(partialFulfilled, partialFulfilled.santaclawzDirectPayment.delivery), true);
const completeFulfilled = structuredClone(partialFulfilled);
completeFulfilled.santaclawzDirectPayment.delivery.verification.partialDelivery = false;
assert.equal(shouldRefreshFulfilledDelivery(completeFulfilled, completeFulfilled.santaclawzDirectPayment.delivery), false);

const fulfillmentPatchStart = server.indexOf('function buildSantaClawzFulfillmentDeliveryPatch(');
const fulfillmentPatchEnd = server.indexOf('\nfunction materializeChangedSantaClawzDelivery', fulfillmentPatchStart);
assert.ok(fulfillmentPatchStart >= 0 && fulfillmentPatchEnd > fulfillmentPatchStart, 'fulfilled delivery patch function not found');
const buildFulfillmentDeliveryPatch = new Function(
  'santaClawzSourceDeliveryDigest',
  'sanitizeMetadata',
  `${server.slice(fulfillmentPatchStart, fulfillmentPatchEnd)}\nreturn buildSantaClawzFulfillmentDeliveryPatch;`
)(
  semanticSantaClawzStatusDigest,
  (value) => value
);
const upgradedFulfilled = structuredClone(completeFulfilled);
upgradedFulfilled.fulfillment = {
  status: 'fulfilled',
  result: {
    completionState: 'completed',
    artifacts: [{ label: 'audit.md', url: '/artifacts/session/audit.md' }],
    santaclawzDelivery: structuredClone(partialFulfilled.santaclawzDirectPayment.delivery)
  }
};
const upgradedDelivery = structuredClone(upgradedFulfilled.santaclawzDirectPayment.delivery);
const expandedJson = JSON.stringify({
  findings: Array.from({ length: 700 }, (_, index) => ({ id: index, detail: 'verified structured finding' }))
});
assert.ok(expandedJson.length > 8000, 'upgrade regression must exceed the former inline limit');
upgradedDelivery.inlineOutputs.push('code-audit-result.json', expandedJson);
upgradedDelivery.artifacts.push({ label: 'code-audit-result.json', url: '/artifacts/session/code-audit-result.json' });
upgradedDelivery.verification = { partialDelivery: false, suppressedOutputs: [] };
const fulfillmentPatch = buildFulfillmentDeliveryPatch(upgradedFulfilled, upgradedDelivery, {
  paymentState: { paymentStatus: 'settled' },
  executionState: { status: 'completed' }
});
assert.ok(fulfillmentPatch, 'new verified JSON must update the existing fulfillment');
assert.equal(fulfillmentPatch.result.artifacts.length, 2);
assert.equal(fulfillmentPatch.result.artifacts[1].label, 'code-audit-result.json');
assert.equal(fulfillmentPatch.result.santaclawzDelivery.verification.partialDelivery, false);
assert.equal(buildFulfillmentDeliveryPatch({ ...upgradedFulfilled, fulfillment: fulfillmentPatch }, upgradedDelivery), null);

assert.match(server, /const changed = hasSemanticSantaClawzStatusChanged\(currentSemanticState, nextSemanticState\)/);
assert.match(server, /const updated = changed\s*\? updateConnectorSession/);
assert.match(server, /const sendStatusResponse = refreshed\.persisted \? sendJson : sendAdvisoryJson/);
assert.match(server, /materializeChangedSantaClawzDelivery/);
assert.match(server, /resolveSantaClawzAuthenticatedStateUrl/);
assert.match(server, /if \(summary\.completed && sessionForStatus\.status === 'fulfilled'\)/);
assert.match(server, /completed_after_refund_no_recharge/);
assert.doesNotMatch(
  server,
  /creditReservation\?\.status === 'released'[\s\S]{0,1200}lockUserCreditsForIntent/,
  'a completed SantaClawz run must not re-charge a released reservation'
);

console.log('santaclawz status refresh coalescing and no-op persistence regression passed');
