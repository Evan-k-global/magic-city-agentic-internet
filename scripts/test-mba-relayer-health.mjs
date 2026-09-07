import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryAddress = 'B62qikuceF52NVPb8VAVSaRoCRMusFz38pLLENjvLaUuLiDnULAVohe';
const bootstrapRoot = '28831116683740239225579803815979923155620183932789174387615564682385525427460';

const localLock = spawnSync(process.execPath, ['--input-type=module', '--eval', [
  "import { withMbaMissionRegistryMutationLock } from './src/mbaRegistryStore.js';",
  "import { createOrGetSubmission } from './src/zekoSubmitterStore.js';",
  'let active = 0; let maximum = 0;',
  "await Promise.all([1, 2, 3].map(() => withMbaMissionRegistryMutationLock('test-registry', async () => {",
  '  active += 1; maximum = Math.max(maximum, active);',
  '  await new Promise((resolve) => setTimeout(resolve, 15));',
  '  active -= 1;',
  '})));',
  'if (maximum !== 1) throw new Error(`local_lock_not_serialized:${maximum}`);',
  "const reservations = await Promise.all(Array.from({ length: 8 }, () => createOrGetSubmission({ anchorKey: 'test-anchor', payloadHash: '0xtest' })));",
  'if (reservations.filter((entry) => entry.created).length !== 1) throw new Error(`idempotency_not_atomic:${JSON.stringify(reservations)}`);',
  'if (new Set(reservations.map((entry) => entry.submission.id)).size !== 1) throw new Error(`idempotency_duplicate_rows:${JSON.stringify(reservations)}`);'
].join('\n')], {
  cwd: rootDir,
  env: {
    ...process.env,
    DATABASE_URL: '',
    MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE: 'false'
  },
  encoding: 'utf8'
});
assert.equal(localLock.status, 0, `${localLock.stdout}${localLock.stderr}`);

const missingDatabase = spawnSync(process.execPath, ['--input-type=module', '--eval', "await import('./src/mbaRegistryStore.js')"], {
  cwd: rootDir,
  env: {
    ...process.env,
    DATABASE_URL: '',
    MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE: 'true'
  },
  encoding: 'utf8'
});
assert.notEqual(missingDatabase.status, 0);
assert.match(`${missingDatabase.stdout}${missingDatabase.stderr}`, /mba_mission_registry_database_required/);

const missingSubmissionDatabase = spawnSync(process.execPath, ['--input-type=module', '--eval', "await import('./src/zekoSubmitterStore.js')"], {
  cwd: rootDir,
  env: {
    ...process.env,
    DATABASE_URL: '',
    MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE: 'true'
  },
  encoding: 'utf8'
});
assert.notEqual(missingSubmissionDatabase.status, 0);
assert.match(`${missingSubmissionDatabase.stdout}${missingSubmissionDatabase.stderr}`, /zeko_relayer_database_required/);

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The child is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('mba_relayer_health_start_timeout');
}

let chainAvailable = true;
let chainRegistryRoot = bootstrapRoot;
let chainRegistrySequence = '1';
const graphqlPort = await getAvailablePort();
const graphql = http.createServer(async (req, res) => {
  for await (const _chunk of req) {
    // Consume the request body before replying.
  }
  if (!chainAvailable) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'zeko_unavailable' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    data: {
      account: {
        publicKey: registryAddress,
        nonce: '2',
        zkappState: ['0', '0', '0', '0', chainRegistryRoot, chainRegistrySequence, '0', '0'],
        verificationKey: { hash: 'test-verification-key' }
      }
    }
  }));
});
await new Promise((resolve) => graphql.listen(graphqlPort, '127.0.0.1', resolve));

const relayerPort = await getAvailablePort();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-mba-relayer-health-'));
const env = {
  ...process.env,
  HOST: '127.0.0.1',
  PORT: String(relayerPort),
  ZEKO_RELAYER_HOST: '127.0.0.1',
  ZEKO_RELAYER_PORT: String(relayerPort),
  ZEKO_RELAYER_MODE: 'mba_mission_registry',
  ZEKO_NETWORK_ID: 'zeko:sepolia',
  ZEKO_O1JS_NETWORK_ID: 'testnet',
  ZEKO_GRAPHQL: `http://127.0.0.1:${graphqlPort}/graphql`,
  ZEKO_ARCHIVE: `http://127.0.0.1:${graphqlPort}/graphql`,
  ZEKO_MBA_MISSION_REGISTRY_PUBLIC_KEY: registryAddress,
  DATABASE_URL: '',
  MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE: 'false',
  ZEKO_MBA_MISSION_AUTHORITY_PRIVATE_KEY: '',
  MISSION_AUTHORITY_ZEKO_PRIVATE_KEY: '',
  ZEKO_RELAYER_PRIVATE_KEY: '',
  ZEKO_MISSION_AUTH_RELAYER_PRIVATE_KEY: '',
  SUBMITTER_PRIVATE_KEY: ''
};
const relayer = spawn(process.execPath, [path.join(rootDir, 'src/zekoRelayerServer.js')], {
  cwd: tempDir,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
});
let stderr = '';
relayer.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

try {
  await waitFor(`http://127.0.0.1:${relayerPort}/health`);
  const healthy = await (await fetch(`http://127.0.0.1:${relayerPort}/health`)).json();
  assert.equal(healthy.status, 'ok');
  assert.equal(healthy.service, 'magic-city-mba-relayer');
  assert.deepEqual(healthy.mba.capabilities, ['mba_mission_registry', 'registry_state_sync']);
  assert.equal(healthy.mba.chain.reachable, true);
  assert.equal(healthy.mba.chain.registryRoot, bootstrapRoot);
  assert.equal(healthy.mba.chain.sequence, '1');
  assert.equal(healthy.mba.mirror.matchesOnchain, true);
  assert.equal(healthy.mba.ready, false, 'private keys are absent in this health-only fixture');

  const unauthenticatedSubmit = await fetch(`http://127.0.0.1:${relayerPort}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ anchorPayload: { schema: 'magic-city-final-submit-chain-anchor-v1' } })
  });
  assert.equal(unauthenticatedSubmit.status, 503);
  assert.equal((await unauthenticatedSubmit.json()).error, 'relayer_auth_not_configured');

  chainRegistryRoot = '999';
  const rootMismatch = await (await fetch(`http://127.0.0.1:${relayerPort}/health`)).json();
  assert.equal(rootMismatch.status, 'ok');
  assert.equal(rootMismatch.mba.mirror.matchesOnchain, false);
  assert.equal(rootMismatch.mba.ready, false);

  chainRegistryRoot = bootstrapRoot;
  chainRegistrySequence = '2';
  const sequenceMismatch = await (await fetch(`http://127.0.0.1:${relayerPort}/health`)).json();
  assert.equal(sequenceMismatch.status, 'ok');
  assert.equal(sequenceMismatch.mba.mirror.matchesOnchain, false);
  assert.equal(sequenceMismatch.mba.ready, false);

  chainRegistrySequence = '1';

  chainAvailable = false;
  const outageResponse = await fetch(`http://127.0.0.1:${relayerPort}/health`);
  const outage = await outageResponse.json();
  assert.equal(outageResponse.status, 200);
  assert.equal(outage.status, 'ok');
  assert.equal(outage.mba.chain.reachable, false);
  assert.equal(outage.mba.ready, false);
  assert.equal(relayer.exitCode, null, `relayer stopped during Zeko outage: ${stderr}`);
} finally {
  if (relayer.exitCode === null) {
    await new Promise((resolve) => {
      relayer.once('exit', resolve);
      relayer.kill('SIGTERM');
    });
  }
  await new Promise((resolve) => graphql.close(resolve));
}

console.log('mba relayer health regression passed');
