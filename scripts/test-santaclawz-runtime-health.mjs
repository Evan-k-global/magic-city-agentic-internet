import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-santaclawz-runtime-'));

try {
  process.chdir(tempDir);
  const store = await import(`${new URL('../src/store.js', import.meta.url).href}?runtime-health-test=${Date.now()}`);
  const agentId = 'hosted-code-audit-agent--session_agent_test';
  const first = store.recordSantaClawzRuntimeRejection({
    agentId: `santaclawz:${agentId}`,
    reasonCode: 'return_schema_rejected',
    message: 'Failed return package must include incident_id.',
    sourceSessionId: 'cs-test',
    blockedForMs: 30 * 60 * 1000
  });
  assert.equal(first.status, 'quarantined');
  assert.equal(first.failureCount, 1);
  assert.equal(store.getSantaClawzRuntimeHealth(agentId)?.agentId, agentId);

  const duplicate = store.recordSantaClawzRuntimeRejection({
    agentId,
    reasonCode: 'return_schema_rejected',
    message: 'Failed return package must include incident_id.',
    sourceSessionId: 'cs-test',
    blockedForMs: 30 * 60 * 1000
  });
  assert.equal(duplicate.failureCount, 1, 'polling the same failed session must not extend the incident count');
  assert.equal(duplicate.blockedUntil, first.blockedUntil, 'polling the same failed session must not extend quarantine');

  const cleared = store.clearSantaClawzRuntimeRejection(agentId);
  assert.equal(cleared.status, 'healthy');
  assert.equal(cleared.blockedUntil, null);
  assert.equal(store.listSantaClawzRuntimeHealth().length, 1);

  console.log('santaclawz runtime-health regression passed');
} finally {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
}
