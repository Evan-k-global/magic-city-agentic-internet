import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import pg from 'pg';
import { createRequestLimiter } from '../src/requestRateLimits.js';

// Uses only a new temporary database. No DATABASE_URL from the caller is used.
const bin = process.env.TEST_POSTGRES_BIN;
if (!bin || !fs.existsSync(path.join(bin, 'initdb'))) throw new Error('Set TEST_POSTGRES_BIN to a local PostgreSQL bin directory');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mia-production-security-'));
fs.symlinkSync(path.join(root, 'public'), path.join(dir, 'public'), 'dir');
const dataDir = path.join(dir, 'pg');
const log = path.join(dir, 'postgres.log');
const port = async () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const dbPort = await port();
const httpPort = await port();
const password = crypto.randomBytes(24).toString('hex');
const pwFile = path.join(dir, 'password');
fs.writeFileSync(pwFile, password, { mode: 0o600 });
const connectionString = `postgres://test:${password}@127.0.0.1:${dbPort}/postgres`;
function pgCommand(command, args) {
  const result = spawnSync(path.join(bin, command), args, { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
}
let child;
let dbStarted = false;
let pool;
const limiters = [];
try {
  pgCommand('initdb', ['-D', dataDir, '-U', 'test', '--pwfile', pwFile, '--auth=scram-sha-256', '--no-locale', '--encoding=UTF8']);
  pgCommand('pg_ctl', ['-D', dataDir, '-l', log, '-o', `-h 127.0.0.1 -p ${dbPort} -k ${dir}`, '-w', 'start']);
  dbStarted = true;
  pool = new pg.Pool({ connectionString });
  const limiterEnv = { DATABASE_URL: connectionString, MAGIC_CITY_RATE_LIMIT_STORE: 'postgres' };
  for (let i = 0; i < 2; i++) {
    const limiter = createRequestLimiter({ env: limiterEnv });
    await limiter.initialize();
    limiters.push(limiter);
  }
  const decisions = await Promise.all(Array.from({ length: 60 }, (_, i) => limiters[i % 2].consume('shared-subject', { windowMs: 60000, max: 10 })));
  assert.equal(decisions.filter((d) => d.allowed).length, 10, 'two independent pools must admit exactly ten total');
  await limiters[0].close();
  const restarted = createRequestLimiter({ env: limiterEnv });
  limiters[0] = restarted;
  await restarted.initialize();
  assert.equal((await restarted.consume('shared-subject', { windowMs: 60000, max: 10 })).allowed, false, 'restart must retain limits');
  const row = (await pool.query('SELECT key_hash, cardinality(timestamps) AS n FROM magic_city_rate_limits')).rows[0];
  assert.match(row.key_hash, /^[a-f0-9]{64}$/);
  assert.equal(row.n, 10);
  await pool.query("UPDATE magic_city_rate_limits SET timestamps = ARRAY[0::double precision], expires_at = now() - interval '1 day'");
  assert.equal((await restarted.consume('shared-subject', { windowMs: 60000, max: 10 })).allowed, true);

  const env = {
    PATH: process.env.PATH, NODE_ENV: 'production', DEPLOYMENT_PROFILE: 'production', HOST: '127.0.0.1', PORT: String(httpPort),
    DATABASE_URL: connectionString, DATABASE_SSL: 'disable', MAGIC_CITY_CANONICAL_ORIGIN: 'https://app.test',
    LOCAL_ADMIN_EMAILS: 'fixture@example.test', LOCAL_ADMIN_REQUESTER_IDS: 'fixture@example.test',
    MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE: 'true', MAGIC_CITY_REQUIRE_STATE_ENCRYPTION: 'true',
    MAGIC_CITY_REQUIRE_ARTIFACT_ENCRYPTION: 'true', MAGIC_CITY_POSTGRES_SINGLE_WRITER: 'true', MAGIC_CITY_RATE_LIMIT_STORE: 'postgres',
    MAGIC_CITY_SAFE_HTTP_STARTUP: 'true', AUTO_START_LOCAL_EXECUTION_AGENTS: 'false', AUTO_SEED_DEFAULT_AGENTS: 'false',
    AUTO_PREPARE_EXECUTION_PROOFS: 'false', AUTO_DRAIN_SPONSORED_PROOF_QUEUE: 'false', AUTO_RECOVER_SPONSORED_PROOF_QUEUE: 'false',
    ETHEREUM_CONFIRMATION_INDEXER_ENABLED: 'false', ETHEREUM_SHADOW_RELAYER_ENABLED: 'false',
    MAGIC_CITY_NATIVE_RUNNER_STORE_VERSION_REFRESH_MS: '86400000',
    MISSION_BOUND_AUTH_ED25519_PRIVATE_KEY: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
  for (const name of ['ADMIN_TOKEN', 'PRIVACY_SALT', 'MISSION_BOUND_AUTH_SECRET', 'MCP_OAUTH_SECRET', 'MAGIC_CITY_STATE_ENCRYPTION_KEY', 'PUBLIC_API_KEYS']) env[name] = crypto.randomBytes(32).toString('hex');
  const serverFile = path.join(root, 'src/server.js');
  // Demonstrate startup fails before opening storage/listening with placeholders.
  const invalid = spawnSync(process.execPath, [serverFile], { cwd: dir, env: { ...env, ADMIN_TOKEN: 'change-me' }, encoding: 'utf8', timeout: 10000 });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /production_requires_strong_ADMIN_TOKEN/);

  let output = '';
  child = spawn(process.execPath, [serverFile], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (b) => { output += b; });
  child.stderr.on('data', (b) => { output += b; });
  // Node fetch may rewrite Host; use raw HTTP to test proxy-facing Host policy.
  const request = (route, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: httpPort, path: route, method: options.method || 'GET', headers: { host: 'app.test', ...options.headers } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('test_http_timeout')));
    req.end(options.body);
  });
  let ready = false;
  let lastHealth = '';
  for (let i = 0; i < 80; i++) {
    try { const response = await request('/health'); lastHealth = `${response.status} ${await response.text()}`; if (response.ok) { ready = true; break; } } catch (error) { lastHealth = error.message; }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, `${output}\n${lastHealth}`);
  const hostile = await request('/health', { headers: { host: 'evil.test' } });
  assert.equal(hostile.status, 421);
  const discovery = await request('/.well-known/magic-city-mission-auth', { headers: { 'x-forwarded-host': 'evil.test', 'x-forwarded-proto': 'http' } });
  const metadata = await discovery.text();
  assert.equal(metadata.includes('evil.test'), false);
  assert.ok(metadata.includes('https://app.test'));
  const html = await request('/');
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.match(html.headers.get('content-security-policy-report-only'), /script-src 'self'/);
  assert.equal(html.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(html.headers.get('x-content-type-options'), 'nosniff');
  assert.ok((await html.text()).includes('Magic City'));
  const register = await request('/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'fixture@example.test', passphrase: 'test-only-passphrase' }) });
  assert.equal(register.status, 201, await register.clone().text());
  assert.equal((await register.clone().json()).user.adminAccount, false, 'publicly asserted email must not grant production admin');
  assert.match(register.headers.get('set-cookie'), /Secure/);
  const cookie = register.headers.get('set-cookie').split(';')[0];
  const crossOrigin = await request('/auth/logout', { method: 'POST', headers: { cookie, origin: 'https://evil.test' } });
  assert.equal(crossOrigin.status, 403);
  const sameOrigin = await request('/auth/logout', { method: 'POST', headers: { cookie, origin: 'https://app.test' } });
  assert.equal(sameOrigin.status, 200);
  const statuses = [];
  for (let i = 0; i < 32; i++) {
    const login = await request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${i + 1}` }, body: JSON.stringify({ email: `absent-${i}@example.test`, passphrase: 'test-only-passphrase' }) });
    statuses.push(login.status);
  }
  assert.equal(statuses.filter((s) => s === 429).length, 2, 'spoofed forwarding headers must not reset login limit');
  // Dropping only the isolated limit table simulates its failure while the
  // encrypted state database stays healthy. Authentication must fail closed.
  await pool.query('DROP TABLE magic_city_rate_limits');
  const outage = await request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'fixture@example.test', passphrase: 'test-only-passphrase' }) });
  assert.equal(outage.status, 503);
  assert.equal((await outage.json()).error, 'rate_limit_service_unavailable');
  console.log('real PostgreSQL concurrency/restart/outage and production HTTP security tests passed');
} finally {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise((resolve) => child.once('exit', resolve)); }
  for (const limiter of limiters) await limiter.close();
  if (pool) await pool.end();
  if (dbStarted) pgCommand('pg_ctl', ['-D', dataDir, '-m', 'fast', '-w', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
}
