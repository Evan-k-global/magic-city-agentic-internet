import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForHealth(baseUrl, child) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`proof_worker_exited:${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return response.json();
    } catch {
      // The worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('proof_worker_health_timeout');
}

const port = await findOpenPort();
const token = 'proof-worker-regression-token';
const child = spawn(process.execPath, ['src/zekoProofWorker.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ZEKO_PROOF_WORKER_PORT: String(port),
    ZEKO_PROOF_WORKER_TOKEN: token,
    ZEKO_PROOF_WORKER_PRIORITY: '10'
  },
  stdio: 'ignore'
});

try {
  const baseUrl = `http://127.0.0.1:${port}`;
  const health = await waitForHealth(baseUrl, child);
  assert.equal(health.status, 'ok');
  assert.equal(health.tokenRequired, true);

  const denied = await fetch(`${baseUrl}/prepare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proofArtifact: {}, network: 'zeko:testnet' })
  });
  assert.equal(denied.status, 401);

  const invalid = await fetch(`${baseUrl}/prepare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({})
  });
  assert.equal(invalid.status, 400);

  console.log('zeko proof worker boundary regression passed');
} finally {
  child.kill('SIGTERM');
}
