import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { testSecurityBoundaries } from './security-boundary-cases.mjs';
if (process.env.DATABASE_URL) throw new Error('Refusing inherited database');
const root = path.resolve(new URL('..', import.meta.url).pathname);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-boundary-'));
const previousCwd = process.cwd();
process.chdir(dir);
const store = await import('../src/store.js');
store.registerAgent({ agentId: 'seed-provider', owner: 'operator', publicKey: 'synthetic' });
const fundedIntent = store.addIntent({ providerAgentId: 'seed-provider', requesterHash: 'seed-user', externalRequestId: 'seed-external' });
store.creditUserAccount('seed-user', 1000, 'synthetic-funding');
store.lockUserCreditsForIntent('seed-user', 200, fundedIntent.id);
const foreignSession = store.createConnectorSession({ preferredExecutionAgentId: 'other-plugin', status: 'confirmed', handoffData: { kind: 'test' } });
const unassignedSession = store.createConnectorSession({ status: 'confirmed', handoffData: { kind: 'test' } });
store.createPersonalAgentRuntime({ agentId: 'runtime-agent', secretToken: 'runtime-valid', status: 'active' });
store.createPersonalAgentRuntime({ agentId: 'runtime-agent', secretToken: 'runtime-revoked', status: 'revoked', revokedAt: new Date().toISOString() });
store.createPersonalAgentRuntime({ agentId: 'runtime-agent', secretToken: 'runtime-expired', expiresAt: '2000-01-01' });
await store.flushPersistence();
process.chdir(previousCwd);
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const env = {
  PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
  ADMIN_TOKEN: 'boundary-admin-token', RELAYER_TOKEN: 'boundary-relay-token', PUBLIC_API_KEYS: 'boundary-general-one,boundary-general-two',
  MAGIC_CITY_PLUGIN_API_KEY: 'boundary-plugin-key', MAGIC_CITY_PLUGIN_ALLOWED_IDS: 'boundary-plugin',
  LOCAL_ADMIN_EMAILS: 'boundary-admin@example.test', LOCAL_ADMIN_REQUESTER_IDS: 'boundary-admin@example.test',
  MAGIC_CITY_SAFE_HTTP_STARTUP: 'true', AUTO_START_LOCAL_EXECUTION_AGENTS: 'false', AUTO_SEED_DEFAULT_AGENTS: 'false',
  AUTO_PREPARE_EXECUTION_PROOFS: 'false', AUTO_DRAIN_SPONSORED_PROOF_QUEUE: 'false', AUTO_RECOVER_SPONSORED_PROOF_QUEUE: 'false',
  ETHEREUM_CONFIRMATION_INDEXER_ENABLED: 'false', ETHEREUM_SHADOW_RELAYER_ENABLED: 'false'
};
const mock = path.join(dir, 'offline.mjs');
fs.writeFileSync(mock, 'globalThis.fetch = async () => { throw new Error("external_network_forbidden"); };');
let output = '';
const child = spawn(process.execPath, ['--import', mock, path.join(root, 'src/server.js')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (b) => output += b); child.stderr.on('data', (b) => output += b);
const request = (route, options = {}) => fetch(`http://127.0.0.1:${port}${route}`, { ...options, redirect: 'manual', signal: AbortSignal.timeout(10000) });
try {
  for (let i = 0; i < 100; i++) { try { if ((await request('/health')).ok) break; } catch {} if (child.exitCode !== null) throw new Error(output); await new Promise((r) => setTimeout(r, 100)); }
  const reg = await request('/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'boundary-owner@example.test', passphrase: 'synthetic-only-password' }) });
  assert.equal(reg.status, 201, await reg.clone().text());
  await testSecurityBoundaries({ request, env, ownerCookie: reg.headers.get('set-cookie').split(';')[0] });
  const post = (route, body, headers) => request(route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const runtimeMissionResponse = await post('/agent-sdk/v1/missions', { goal: 'Runtime mission', agentId: 'spoofed', requesterId: 'spoofed-user' }, { 'x-agent-runtime-token': 'runtime-valid' });
  assert.equal(runtimeMissionResponse.status, 201);
  const runtimeMission = (await runtimeMissionResponse.json()).mission;
  assert.equal(runtimeMission.agentId, 'runtime-agent');
  assert.equal(runtimeMission.requesterHash, null);
  assert.equal((await request(`/agent-sdk/v1/missions/${runtimeMission.id}`, { headers: { 'x-agent-runtime-token': 'runtime-valid' } })).status, 200);
  for (const token of ['runtime-revoked', 'runtime-expired']) {
    assert.equal((await post('/agent-sdk/v1/missions', { goal: 'Forbidden' }, { 'x-agent-runtime-token': token })).status, 401);
    assert.equal((await request(`/agent-sdk/v1/missions/${runtimeMission.id}?agentId=runtime-agent`, { headers: { 'x-agent-runtime-token': token } })).status, 404);
  }
  for (const session of [foreignSession, unassignedSession]) {
    for (const route of ['claim', 'checkpoint', 'fulfill']) {
      const r = await post(`/connectors/sessions/${session.id}/${route}`, { pluginId: 'boundary-plugin', label: 'scope test', status: 'completed', result: {} }, { 'x-api-key': env.MAGIC_CITY_PLUGIN_API_KEY });
      assert.equal(r.status, 403, `${route}: ${await r.text()}`);
    }
  }
  const receipt = { agentId: 'seed-provider', intentId: fundedIntent.id, taskId: 'seed-task', outcome: 'success', payment: { amount: 9999 } };
  for (const outcome of ['success', 'failed', 'success']) {
    assert.equal((await post('/receipts', { ...receipt, outcome }, { 'x-admin-token': env.ADMIN_TOKEN })).status, 201);
    assert.equal((await post('/relayer/receipts/submit', { ...receipt, outcome }, { 'x-relayer-token': env.RELAYER_TOKEN })).status, 201);
  }
  const acp = await post('/integrations/acp/fulfill-sync', { externalRequestId: 'seed-external', serviceId: 'seed-provider', status: 'completed', amount: 9999 }, { 'x-admin-token': env.ADMIN_TOKEN });
  assert.equal(acp.status, 201, await acp.clone().text());
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'data/state.json'), 'utf8'));
  assert.equal(persisted.escrowLocks[fundedIntent.id].status, 'locked');
  assert.equal(persisted.userAccounts['seed-user'].locked, 200);
  assert.equal(persisted.userAccounts['seed-user'].totalSpent, 0);
  assert.equal(persisted.balances['seed-provider'], 0);
  console.log('Plugin foreign/unassigned session denial and all receipt import routes preserve funded lock and zero earnings');
} catch (err) { console.error(output.slice(-3000)); throw err; }
finally { if (child.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill(); await done; } fs.rmSync(dir, { recursive: true, force: true }); }
