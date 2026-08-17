import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function request(baseUrl, pathName, { method = 'GET', body = null, cookie = '' } = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  return {
    response,
    data,
    cookie: String(response.headers.get('set-cookie') || '').split(';')[0]
  };
}

async function waitForServer(baseUrl) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    try {
      const result = await request(baseUrl, '/health');
      if (result.response.ok) return;
    } catch {
      // Keep polling until the isolated server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('action_approval_test_server_timeout');
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-action-approval-'));
const port = await getAvailablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [path.join(rootDir, 'src/server.js')], {
  cwd: tempDir,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    MAGIC_CITY_SAFE_HTTP_STARTUP: 'true',
    SANTACLAWZ_SAFE_START_DELAY_MS: '600000',
    AUTO_START_LOCAL_EXECUTION_AGENTS: 'false',
    AUTO_SEED_DEFAULT_AGENTS: 'true',
    EXECUTION_WATCHDOG_ENABLED: 'false',
    ETHEREUM_CONFIRMATION_INDEXER_ENABLED: 'false',
    ETHEREUM_SHADOW_RELAYER_ENABLED: 'false',
    MISSION_BOUND_AUTH_SECRET: 'action-approval-idempotency-test-secret'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

try {
  await waitForServer(baseUrl);
  const email = `approval-${crypto.randomBytes(5).toString('hex')}@example.com`;
  const registered = await request(baseUrl, '/auth/register', {
    method: 'POST',
    body: { email, passphrase: 'approval-test-password', displayName: 'Approval Test' }
  });
  assert.equal(registered.response.status, 201, JSON.stringify(registered.data));
  assert.ok(registered.cookie, 'registration must establish an authenticated session');

  const planned = await request(baseUrl, '/intent', {
    method: 'POST',
    cookie: registered.cookie,
    body: {
      capability: 'browser-worker-agent',
      budget: 10,
      privacyMode: 'private',
      prompt: 'Buy nature valley granola bars from amazon.com with max spend $4'
    }
  });
  assert.equal(planned.response.status, 202, JSON.stringify(planned.data));
  assert.equal(planned.data.approvalRequired, true);
  const actionRunId = planned.data.actionRun?.id;
  assert.ok(actionRunId, 'browser action must include an approval id');

  const first = await request(baseUrl, `/actions/${encodeURIComponent(actionRunId)}/approve`, {
    method: 'POST',
    cookie: registered.cookie,
    body: {}
  });
  assert.equal(first.response.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.replayed, false);
  assert.ok(first.data.connectorSession?.id, 'first approval must create a connector session');
  assert.ok(first.data.receipt?.id, 'first approval must create a receipt');

  const replay = await request(baseUrl, `/actions/${encodeURIComponent(actionRunId)}/approve`, {
    method: 'POST',
    cookie: registered.cookie,
    body: {}
  });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.data));
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.connectorSession?.id, first.data.connectorSession.id);
  assert.equal(replay.data.receipt?.id, first.data.receipt.id);
  assert.equal(replay.data.actionRun?.status, 'completed');

  console.log('action approval idempotency regression passed');
} catch (error) {
  if (stderr) console.error(stderr.split('\n').slice(-80).join('\n'));
  throw error;
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}
