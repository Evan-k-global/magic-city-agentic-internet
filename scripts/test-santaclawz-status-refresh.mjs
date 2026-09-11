import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createSantaClawzStatusRefreshCoordinator,
  hasSemanticSantaClawzStatusChanged
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
assert.match(server, /const changed = hasSemanticSantaClawzStatusChanged\(currentSemanticState, nextSemanticState\)/);
assert.match(server, /const updated = changed\s*\? updateConnectorSession/);
assert.match(server, /const sendStatusResponse = refreshed\.persisted \? sendJson : sendAdvisoryJson/);
assert.match(server, /materializeChangedSantaClawzDelivery/);

console.log('santaclawz status refresh coalescing and no-op persistence regression passed');
