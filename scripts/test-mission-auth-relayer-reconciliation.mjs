import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrivateKey } from 'o1js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mission-auth-reconcile-')), 'state.json');
const registryKey = PrivateKey.random();
const registryAddress = registryKey.toPublicKey().toBase58();
const relayerKey = PrivateKey.random();
const token = 'mission-auth-reconcile-token';
const txHash = '5JmissionAuthReconciledTransaction1111111111111111111111111';
const statementHash = '123456789012345678901234567890';
const payloadDigest = '987654321098765432109876543210';
const anchorPayload = {
  schema: 'magic-city-final-submit-chain-anchor-v1',
  network: 'zeko:sepolia',
  statementHash,
  statementKind: 'final_submit_authorization',
  sourceKind: 'mission_auto_submit',
  sourceId: 'reconciliation-test-session',
  missionBoundary: { schema: 'magic-city-mba-final-submit-chain-authorization-v1' },
  publicInputs: { schema: 'magic-city-mba-final-submit-chain-authorization-v1' }
};
const payloadHash = `0x${crypto.createHash('sha256').update(JSON.stringify(anchorPayload)).digest('hex')}`;
const anchorKey = `0x${crypto.createHash('sha256').update(JSON.stringify({
  schema: 'magic-city-anchor-idempotency-v1',
  networkId: 'zeko:sepolia',
  sourceKind: anchorPayload.sourceKind,
  sourceId: anchorPayload.sourceId,
  receiptId: null,
  intentId: null,
  statementHash: anchorPayload.statementHash,
  requestCommitment: null,
  batchRoot: null
})).digest('hex')}`;

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('relayer_start_timeout');
}

const seed = spawnSync(process.execPath, ['--input-type=module', '--eval', `
  import { createOrGetSubmission, updateSubmission } from './src/zekoSubmitterStore.js';
  const reservation = await createOrGetSubmission(${JSON.stringify({
    status: 'received',
    mode: 'mba_mission_registry',
    payloadHash,
    anchorKey,
    networkId: 'zeko:sepolia',
    anchorPayload,
    txPlan: { strategy: 'anchor-commitment' }
  })});
  await updateSubmission(reservation.submission.id, ${JSON.stringify({
    status: 'submission_unknown',
    txHash,
    result: {
      accepted: false,
      mode: 'mission_auth_registry',
      stage: 'registry_confirmation',
      txHash,
      statementHash,
      payloadDigest,
      safeToRetrySamePayload: false
    }
  })});
`], {
  cwd: rootDir,
  env: {
    ...process.env,
    DATABASE_URL: '',
    MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE: 'false',
    MAGIC_CITY_ZEKO_SUBMITTER_STATE_PATH: statePath
  },
  encoding: 'utf8'
});
assert.equal(seed.status, 0, `${seed.stdout}${seed.stderr}`);

const graphqlPort = await availablePort();
const graphql = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  res.writeHead(200, { 'content-type': 'application/json' });
  if (String(request.query || '').includes('events(input:')) {
    return res.end(JSON.stringify({
      data: {
        events: [{
          eventData: [{
            transactionInfo: { hash: txHash, status: '["Applied"]' },
            data: ['0', statementHash]
          }]
        }]
      }
    }));
  }
  res.end(JSON.stringify({
    data: {
      account: {
        publicKey: request?.variables?.pk || registryAddress,
        nonce: '1',
        inferredNonce: '1',
        balance: { total: '1000000000' },
        zkappState: [statementHash, payloadDigest, '7', '0', '0', '0', '0', '0'],
        verificationKey: { hash: 'mission-auth-vk-hash' }
      }
    }
  }));
});
await new Promise((resolve) => graphql.listen(graphqlPort, '127.0.0.1', resolve));

const relayerPort = await availablePort();
const relayer = spawn(process.execPath, [path.join(rootDir, 'src/zekoRelayerServer.js')], {
  cwd: rootDir,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(relayerPort),
    ZEKO_RELAYER_HOST: '127.0.0.1',
    ZEKO_RELAYER_PORT: String(relayerPort),
    ZEKO_RELAYER_TOKEN: token,
    ZEKO_RELAYER_MODE: 'mba_mission_registry',
    ZEKO_NETWORK_ID: 'zeko:sepolia',
    ZEKO_O1JS_NETWORK_ID: 'testnet',
    ZEKO_GRAPHQL: `http://127.0.0.1:${graphqlPort}/graphql`,
    ZEKO_ARCHIVE: `http://127.0.0.1:${graphqlPort}/graphql`,
    ZEKO_MISSION_AUTH_REGISTRY_PUBLIC_KEY: registryAddress,
    ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_KEY: registryKey.toBase58(),
    ZEKO_RELAYER_PRIVATE_KEY: relayerKey.toBase58(),
    DATABASE_URL: '',
    MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE: 'false',
    MAGIC_CITY_ZEKO_SUBMITTER_STATE_PATH: statePath
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let stderr = '';
relayer.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

try {
  await waitFor(`http://127.0.0.1:${relayerPort}/health`);
  const response = await fetch(`http://127.0.0.1:${relayerPort}/submit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ networkId: 'zeko:sepolia', anchorPayload })
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.status, 'submitted');
  assert.equal(body.txHash, txHash);
  assert.equal(body.reconciled, true);
  assert.equal(body.deduplicated, true);
  assert.equal(body.result.accepted, true);
  assert.equal(body.result.reconciliation, 'zeko_applied_event');
  assert.equal(body.result.statementHash, statementHash);
  assert.equal(body.result.payloadDigest, payloadDigest);
  assert.equal(body.result.anchoredCount, '7');
  console.log('mission auth relayer reconciliation regression passed');
} finally {
  if (relayer.exitCode === null) {
    relayer.kill('SIGTERM');
    await new Promise((resolve) => relayer.once('exit', resolve));
  }
  await new Promise((resolve) => graphql.close(resolve));
}

assert.equal(stderr, '', stderr);
