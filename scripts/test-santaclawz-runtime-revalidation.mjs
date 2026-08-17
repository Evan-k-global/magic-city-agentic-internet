import assert from 'node:assert/strict';

const {
  evaluateSantaClawzRuntimeRevalidation,
  isSantaClawzProtocolHireReadyForMagicCity
} = await import('../src/santaclawzAgentProvider.js');

const now = Date.parse('2026-08-07T16:45:00.000Z');
const healthyRuntime = {
  online: true,
  hireable: true,
  paidExecutionReady: true,
  needsUpgrade: false,
  readiness: {
    relayConnected: true,
    heartbeatLive: true,
    runtimeReachable: true,
    workerReachable: true,
    paidExecutionReady: true,
    lastHeartbeatAtIso: '2026-08-07T16:44:30.000Z',
    knownBlockers: []
  }
};

const staleGate = {
  status: 'quarantined',
  lastRejectedAt: '2026-08-07T16:40:00.000Z',
  incidentObservedAt: '2026-08-06T20:35:16.650Z'
};
assert.equal(
  isSantaClawzProtocolHireReadyForMagicCity(healthyRuntime),
  true,
  'an exact selected agent may rely on authoritative protocol readiness instead of broad-search cache state'
);
assert.equal(
  evaluateSantaClawzRuntimeRevalidation(healthyRuntime, staleGate, { now }).revalidated,
  true,
  'a fresh authoritative heartbeat must clear an older Magic City quarantine'
);

const newerRejection = {
  ...staleGate,
  incidentObservedAt: '2026-08-07T16:44:45.000Z'
};
assert.equal(
  evaluateSantaClawzRuntimeRevalidation(healthyRuntime, newerRejection, { now }).revalidated,
  false,
  'a heartbeat older than the actual rejection must not clear containment'
);

assert.equal(
  evaluateSantaClawzRuntimeRevalidation({
    ...healthyRuntime,
    readiness: { ...healthyRuntime.readiness, knownBlockers: ['return_schema_invalid'] }
  }, staleGate, { now }).revalidated,
  false,
  'an authoritative blocker must keep the runtime quarantined'
);

console.log('santaclawz runtime revalidation regression passed');
