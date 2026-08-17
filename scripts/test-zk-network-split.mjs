import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.env.ZEKO_NETWORK_ID = 'zeko:testnet';
delete process.env.MAGIC_CITY_MISSION_PROOF_NETWORK_ID;
delete process.env.ZEKO_GRAPHQL;
delete process.env.ZEKO_ARCHIVE;
delete process.env.ZEKO_EXPLORER_TX_BASE;

const { getAnchorConfig } = await import('../src/zekoAnchor.js');
const { buildMbaDiscoveryDocument, buildMbaRegistryAnchor } = await import('../src/agentMissionBoundAuth.js');

const anchorConfig = getAnchorConfig();
assert.equal(anchorConfig.networkId, 'zeko:testnet');
assert.equal(anchorConfig.o1jsNetworkId, 'testnet');
assert.match(anchorConfig.explorerTxBase, /zekoscan\.io\/testnet/);

const discovery = buildMbaDiscoveryDocument({ baseUrl: 'https://magic-city-staging.fly.dev' });
assert.deepEqual(discovery.capabilities.anchoring, [
  'zeko:testnet',
  'mission-auth-registry-zkapp',
  'receipt-root-anchor'
]);

const registryAnchor = buildMbaRegistryAnchor({
  missionIdHash: '0x01',
  capabilityHash: '0x02',
  statementHash: '0x03',
  receiptIdHash: '0x04',
  nullifier: '0x05'
});
assert.equal(registryAnchor.networkId, 'zeko:testnet');

const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');
assert.match(envExample, /^MAGIC_CITY_MISSION_PROOF_NETWORK_ID=zeko:testnet$/m);
assert.match(envExample, /^SANTACLAWZ_PROOF_NETWORK=zeko:testnet$/m);

const flyToml = fs.readFileSync(path.join(rootDir, 'fly.toml'), 'utf8');
assert.match(flyToml, /MAGIC_CITY_MISSION_PROOF_NETWORK_ID = "zeko:testnet"/);
assert.match(flyToml, /SANTACLAWZ_PROOF_NETWORK = "zeko:testnet"/);

const serverSource = fs.readFileSync(path.join(rootDir, 'src', 'server.js'), 'utf8');
assert.match(serverSource, /Boolean\(String\(process\.env\.ZEKO_PROOF_WORKER_URL/);
assert.match(serverSource, /recoverSponsoredProofQueue\(\)/);

const relayerSource = fs.readFileSync(path.join(rootDir, 'src', 'zekoRelayerServer.js'), 'utf8');
assert.match(relayerSource, /magic-city-anchor-idempotency-v1/);
assert.match(relayerSource, /mission_auth_submission_unknown/);
assert.match(relayerSource, /mission_auth_submission_in_progress/);
assert.match(relayerSource, /transaction_build_retry/);
assert.match(relayerSource, /submissionUncertain = true/);

console.log('zk-network-split regression passed');
