import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { buildMissionTransitionManifest, verifyMissionTokenSignature } from '../src/missionKeyTransition.js';

if (process.env.DATABASE_URL) throw new Error('Refuses inherited production database');
const root = path.resolve(new URL('..', import.meta.url).pathname);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mia-key-transition-'));
const originalCwd = process.cwd();
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const oldKey = 'synthetic-shared-key-'.repeat(3);
let child, output = '';
const stop = async () => { if (child && child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await done; } };
try {
  process.chdir(dir);
  const store = await import('../src/store.js');
  const user = store.createAuthUser({ email: 'migration@example.test', passwordLoginEnabled: false });
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  store.createAuthSession({ tokenHash: sha('existing-cookie'), userId: user.id, requesterId: user.requesterId, expiresAt });
  store.createOAuthClient({ clientId: 'existing-client', tokenEndpointAuthMethod: 'none', redirectUris: ['http://127.0.0.1/callback'] });
  store.createOAuthRefreshToken({ tokenHash: sha('existing-refresh'), userId: user.id, clientId: 'existing-client', expiresAt });
  store.createOAuthAccessToken({ tokenHash: sha('existing-access'), refreshTokenHash: sha('existing-refresh'), userId: user.id, clientId: 'existing-client', expiresAt });
  await store.flushPersistence();
  process.chdir(originalCwd);
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const base = `http://127.0.0.1:${port}`;
  const mock = path.join(dir, 'provider-mock.mjs');
  fs.writeFileSync(mock, `globalThis.fetch = async (url) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') throw new Error('synthetic_provider_reached_after_valid_state');
    throw new Error('Fixture forbids external HTTP');
  };`);
  const env = { PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
    MAGIC_CITY_CANONICAL_ORIGIN: base, ADMIN_TOKEN: 'synthetic-admin-only', PRIVACY_SALT: 'synthetic-unchanged-salt', PUBLIC_API_KEYS: 'synthetic-api-only',
    GOOGLE_CONNECTOR_SECRET: oldKey, MCP_OAUTH_SECRET: oldKey, MISSION_BOUND_AUTH_SECRET: oldKey,
    GOOGLE_CLIENT_ID: 'synthetic-google-id', GOOGLE_CLIENT_SECRET: 'synthetic-google-client-secret', GOOGLE_REDIRECT_URI: base + '/auth/google/callback',
    MAGIC_CITY_GOOGLE_PRODUCTION_ONLY: 'false',
    MISSION_BOUND_AUTH_ED25519_PRIVATE_KEY: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
    MAGIC_CITY_SAFE_HTTP_STARTUP: 'true', AUTO_START_LOCAL_EXECUTION_AGENTS: 'false', AUTO_SEED_DEFAULT_AGENTS: 'false',
    AUTO_PREPARE_EXECUTION_PROOFS: 'false', AUTO_DRAIN_SPONSORED_PROOF_QUEUE: 'false', AUTO_RECOVER_SPONSORED_PROOF_QUEUE: 'false',
    ETHEREUM_CONFIRMATION_INDEXER_ENABLED: 'false', ETHEREUM_SHADOW_RELAYER_ENABLED: 'false', MAGIC_CITY_NATIVE_RUNNER_STORE_VERSION_REFRESH_MS: '86400000' };
  const request = (route, { body, headers = {}, form = false } = {}) => fetch(base + route, { method: body ? 'POST' : 'GET', headers: { cookie: 'magic_city_session=existing-cookie', ...(body ? { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...headers }, body: body ? form ? new URLSearchParams(body) : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  async function start(config) {
    output = '';
    child = spawn(process.execPath, ['--import', mock, path.join(root, 'src/server.js')], { cwd: dir, env: config, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try { if ((await request('/health')).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail(output);
  }
  const issue = async () => { const r = await request('/mission-auth/capabilities', { body: { targetUrl: 'https://www.amazon.com/', allowedActions: ['inspect'], ttlSec: 120 } }); assert.equal(r.status, 201, await r.clone().text()); return (await r.json()).capability.token; };
  const verify = (token, extra = {}) => request('/mission-auth/verify', { body: { token, requiredAction: 'inspect', targetUrl: 'https://www.amazon.com/', ...extra } });
  await start(env);
  const oldToken = await issue();
  assert.equal((await verify(oldToken)).status, 200);
  const googleStart = await request('/auth/google/start');
  assert.equal(googleStart.status, 200);
  const googleState = new URL((await googleStart.json()).authorizationUrl).searchParams.get('state');
  const googleBinding = googleStart.headers.get('set-cookie').split(';')[0];
  await stop();
  const manifest = buildMissionTransitionManifest([oldToken], oldKey);
  const newKey = crypto.randomBytes(32).toString('hex');
  const migrated = { ...env, MISSION_BOUND_AUTH_SECRET: newKey, MCP_OAUTH_SECRET: crypto.randomBytes(32).toString('hex'),
    MISSION_BOUND_AUTH_LEGACY_SECRET: oldKey, MISSION_BOUND_AUTH_LEGACY_TOKEN_SHA256: manifest.tokenSha256.join(','),
    MISSION_BOUND_AUTH_LEGACY_CUTOVER_AT: manifest.cutoverAt, MISSION_BOUND_AUTH_LEGACY_ACCEPT_UNTIL: manifest.acceptUntil };
  await start(migrated);
  const callback = await request(`/auth/google/callback?state=${encodeURIComponent(googleState)}&code=synthetic`, { headers: { cookie: googleBinding } });
  assert.match(await callback.text(), /synthetic_provider_reached_after_valid_state/, 'pre-cutover Google callback state remains valid');
  assert.equal((await (await request('/auth/session')).json()).authenticated, true, 'existing browser session survives');
  assert.equal((await (await request('/auth/session', { headers: { cookie: '', authorization: 'Bearer existing-access' } })).json()).authenticated, true, 'existing MCP access survives');
  const refresh = await request('/oauth/mcp/token', { form: true, body: { client_id: 'existing-client', grant_type: 'refresh_token', refresh_token: 'existing-refresh' } });
  assert.equal(refresh.status, 200, await refresh.clone().text());
  const refreshed = await refresh.json();
  assert.ok(refreshed.refresh_token);
  assert.equal((await verify(oldToken)).status, 200);
  assert.equal((await verify(oldToken, { requiredAction: 'final_submit' })).status, 403);
  assert.equal((await verify(oldToken, { targetUrl: 'https://evil.test/' })).status, 403);
  const forgedPayload = JSON.parse(Buffer.from(oldToken.split('.')[1], 'base64url'));
  forgedPayload.policy.allowedActions.push('final_submit');
  const data = Buffer.from(JSON.stringify(forgedPayload)).toString('base64url');
  const forged = `mcap.${data}.${crypto.createHmac('sha256', oldKey).update(data).digest('base64url')}`;
  assert.equal((await verify(forged)).status, 401, 'knowing old shared key cannot mint accepted authority');
  const newToken = await issue();
  assert.equal(verifyMissionTokenSignature(newToken, newKey), true);
  assert.equal(verifyMissionTokenSignature(newToken, oldKey), false);
  await stop(); await start(migrated);
  assert.equal((await verify(oldToken)).status, 200, 'second restart retains old token');
  assert.equal((await verify(newToken)).status, 200);
  await stop();
  const retired = { ...migrated };
  for (const key of Object.keys(retired)) if (key.startsWith('MISSION_BOUND_AUTH_LEGACY_')) delete retired[key];
  await start(retired);
  assert.equal((await verify(oldToken)).status, 401);
  assert.equal((await verify(newToken)).status, 200);
  assert.equal((await (await request('/auth/session')).json()).authenticated, true);
  assert.equal((await request('/oauth/mcp/token', { form: true, body: { client_id: 'existing-client', grant_type: 'refresh_token', refresh_token: refreshed.refresh_token } })).status, 200);
  console.log('HTTP key cutover/restart/retirement preserves browser and MCP sessions; old mission scope and exact-token constraints remain enforced');
} finally {
  process.chdir(originalCwd);
  await stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
