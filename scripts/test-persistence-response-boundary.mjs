import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import pg from 'pg';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('persistence_test_wait_timeout');
}

process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:5432/test';
process.env.MAGIC_CITY_POSTGRES_SINGLE_WRITER = 'false';
process.env.MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE = 'false';
process.env.MAGIC_CITY_REQUIRE_STATE_ENCRYPTION = 'false';
process.env.MAGIC_CITY_STATE_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

function legacyEncryptedState(value) {
  const key = Buffer.alloc(32, 7);
  const iv = Buffer.alloc(12, 9);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    schema: 'magic-city-encrypted-state-v1',
    alg: 'aes-256-gcm',
    keyId: crypto.createHash('sha256').update(key).digest('hex').slice(0, 16),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

const originalQuery = pg.Pool.prototype.query;
let snapshotWriter = async () => ({ rows: [] });
let snapshotWriteCount = 0;
let encryptedSnapshotCount = 0;
let latestStoredSnapshot = null;

pg.Pool.prototype.query = async function query(text, values) {
  const sql = String(text || '');
  if (/select state_json from app_state/i.test(sql)) {
    return { rows: [{ state_json: legacyEncryptedState({
      unitScale: 1000,
      agents: { legacy: { agentId: 'legacy', status: 'active' } }
    }) }] };
  }
  if (/insert into app_state\s*\(/i.test(sql)) {
    snapshotWriteCount += 1;
    const stored = JSON.parse(values[1]);
    assert.equal(stored.schema, 'magic-city-encrypted-state-v2');
    assert.equal(stored.compression, 'gzip');
    latestStoredSnapshot = values[1];
    encryptedSnapshotCount += 1;
    return snapshotWriter({ sql, values, snapshotWriteCount });
  }
  return { rows: [] };
};

let server;
try {
  const store = await import(`../src/store.js?persistence-boundary=${Date.now()}`);
  assert.equal(store.getAgent('legacy')?.agentId, 'legacy', 'legacy encrypted snapshots must remain readable');
  const controlledWrites = [];
  snapshotWriter = async () => {
    const write = deferred();
    controlledWrites.push(write);
    return write.promise;
  };

  server = http.createServer(async (_req, res) => {
    store.registerAgent({ agentId: 'response-owner', status: 'active' });
    try {
      await store.flushPersistence();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    } catch {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end('{"ok":false}');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const responsePromise = fetch(`http://127.0.0.1:${address.port}/register`);
  await waitFor(() => controlledWrites.length === 1);

  let laterAcknowledged = false;
  store.registerAgent({ agentId: 'later-mutation', status: 'active' });
  const laterFlush = store.flushPersistence().then(() => { laterAcknowledged = true; });
  const unrelatedWriter = setInterval(() => {
    store.registerAgent({ agentId: `unrelated-${Date.now()}`, status: 'active' });
  }, 2);

  const committedAt = Date.now();
  controlledWrites[0].resolve({ rows: [] });
  const response = await Promise.race([
    responsePromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('original_response_blocked_by_later_writes')), 250))
  ]);
  const responseAfterCommitMs = Date.now() - committedAt;
  assert.equal(response.status, 200);
  assert.equal(laterAcknowledged, false, 'a later mutation must not be acknowledged by the earlier snapshot');
  assert.ok(responseAfterCommitMs < 250, `original response took ${responseAfterCommitMs}ms after its snapshot committed`);

  await waitFor(() => controlledWrites.length >= 2);
  clearInterval(unrelatedWriter);
  snapshotWriter = async () => ({ rows: [] });
  for (const write of controlledWrites.slice(1)) write.resolve({ rows: [] });
  await laterFlush;
  await store.flushPersistence();

  const representativePayloadBytes = 38 * 1024 * 1024;
  store.registerAgent({
    agentId: 'representative-production-state',
    status: 'active',
    representativePayload: 'x'.repeat(representativePayloadBytes)
  });
  await store.flushPersistence();
  const compressionMetrics = store.getPersistenceStatus().lastWriteMetrics;
  assert.ok(compressionMetrics.plaintextBytes >= representativePayloadBytes);
  assert.ok(compressionMetrics.storedBytes < 1024 * 1024,
    `representative encrypted snapshot remained too large:${compressionMetrics.storedBytes}`);
  assert.equal(JSON.parse(latestStoredSnapshot).schema, 'magic-city-encrypted-state-v2');

  snapshotWriter = async () => { throw new Error('controlled_database_failure'); };
  store.registerAgent({ agentId: 'failed-write', status: 'active' });
  await assert.rejects(store.flushPersistence(), /controlled_database_failure/);
  assert.equal(store.getPersistenceStatus().healthy, false, 'a failed database write must not produce a durable acknowledgement');

  console.log(JSON.stringify({
    persistenceResponseBoundary: 'passed',
    responseAfterRequiredCommitMs: responseAfterCommitMs,
    representativePlaintextBytes: compressionMetrics.plaintextBytes,
    representativeStoredBytes: compressionMetrics.storedBytes,
    representativePersistMs: compressionMetrics.totalMs,
    snapshotWritesObserved: snapshotWriteCount,
    encryptedSnapshotsObserved: encryptedSnapshotCount
  }));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  pg.Pool.prototype.query = originalQuery;
}
