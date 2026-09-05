import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.env.ZEKO_NETWORK_ID = 'zeko:sepolia';
process.env.ZEKO_SUBMIT_MODE = 'record';
delete process.env.ZEKO_OFFCHAIN_PROOF_TARGET_NETWORK;
delete process.env.MAGIC_CITY_MISSION_PROOF_NETWORK_ID;
delete process.env.ZEKO_GRAPHQL;
delete process.env.ZEKO_ARCHIVE;
delete process.env.ZEKO_EXPLORER_TX_BASE;

const { getAnchorConfig, submitAnchorPayload } = await import('../src/zekoAnchor.js');
const { buildMbaDiscoveryDocument, buildMbaRegistryAnchor } = await import('../src/agentMissionBoundAuth.js');

const anchorConfig = getAnchorConfig();
assert.equal(anchorConfig.networkId, 'zeko:sepolia');
assert.equal(anchorConfig.o1jsNetworkId, 'testnet');
assert.match(anchorConfig.explorerTxBase, /sepolia\.zeko\.io\/v1\/explorer\/transactions/);
assert.equal(anchorConfig.offchain, true);
assert.equal(anchorConfig.offchainTargetNetwork, null);

const offchainSubmission = await submitAnchorPayload({ statementHash: '0x01', network: 'offchain' });
assert.equal(offchainSubmission.mode, 'record');
assert.equal(offchainSubmission.status, 'prepared');
assert.equal(offchainSubmission.txHash, null);

// MBA registry writes must never fall back to an o1js path in the web process.
// A separately deployed relayer is required before relay mode can be enabled.
process.env.ZEKO_SUBMIT_MODE = 'relay';
process.env.ZEKO_RELAYER_MODE = 'mba_mission_registry';
delete process.env.ZEKO_MBA_RELAYER_URL;
const { getAnchorConfig: getMbaAnchorConfig, submitAnchorPayload: submitMbaAnchor } = await import(`${new URL('../src/zekoAnchor.js', import.meta.url).href}?mba-relayer-boundary=${Date.now()}`);
const mbaAnchorConfig = getMbaAnchorConfig();
assert.equal(mbaAnchorConfig.relayerConfigured, false);
assert.equal(mbaAnchorConfig.externalRelayerConfigured, false);
assert.equal(mbaAnchorConfig.submitterConfigured, false);
assert.equal(mbaAnchorConfig.mbaMissionRegistry.externalRelayerConfigured, false);
assert.equal(mbaAnchorConfig.mbaMissionRegistry.configured, false);
await assert.rejects(
  () => submitMbaAnchor({ statementHash: '0x01', network: 'zeko:sepolia' }),
  /mba_external_relayer_not_configured/
);

const discovery = buildMbaDiscoveryDocument({ baseUrl: 'https://magic-city-staging.fly.dev' });
assert.deepEqual(discovery.capabilities.anchoring, [
  'zeko:sepolia',
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
assert.equal(registryAnchor.networkId, 'zeko:sepolia');

const envExample = fs.readFileSync(path.join(rootDir, '.env.example'), 'utf8');
assert.match(envExample, /^MAGIC_CITY_MISSION_PROOF_NETWORK_ID=zeko:sepolia$/m);
assert.match(envExample, /^SANTACLAWZ_PROOF_NETWORK=zeko:testnet$/m);

const flyToml = fs.readFileSync(path.join(rootDir, 'fly.toml'), 'utf8');
assert.match(flyToml, /MAGIC_CITY_MISSION_PROOF_NETWORK_ID = "zeko:sepolia"/);
assert.match(flyToml, /SANTACLAWZ_PROOF_NETWORK = "zeko:testnet"/);
assert.match(flyToml, /ZEKO_SUBMIT_MODE = "relay"/);
assert.doesNotMatch(flyToml, /ZEKO_OFFCHAIN_PROOF_TARGET_NETWORK = "zeko:sepolia"/);

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
