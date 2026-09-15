import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionId = 'abcdefghijklmnopabcdefghijklmnop';

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/.well-known/magic-city-mission-auth`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server_start_timeout');
}

async function readAdvertisedVersion(baseUrl, expectedVersion) {
  const deadline = Date.now() + 5_000;
  let observedVersion = '';
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/`);
    const html = await response.text();
    observedVersion = String(
      html.match(/__MAGIC_CITY_NATIVE_RUNNER_MIN_EXTENSION_VERSION__=("[^"]*"|[^;]+)/)?.[1] || ''
    ).replace(/^"|"$/g, '');
    if (observedVersion === expectedVersion) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`advertised_version_not_observed:${expectedVersion}:saw:${observedVersion || 'none'}`);
}

async function runServerCase({ updateUrl, expectedVersion }) {
  const port = await getAvailablePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-runner-store-version-'));
  fs.symlinkSync(path.join(rootDir, 'public'), path.join(tmpDir, 'public'), 'dir');
  const baseUrl = `http://127.0.0.1:${port}`;
  let stderr = '';
  const child = spawn(process.execPath, [path.join(rootDir, 'src/server.js')], {
    cwd: tmpDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      PUBLIC_API_KEYS: 'runner-store-version-test-key',
      MAGIC_CITY_NATIVE_RUNNER_EXTENSION_INSTALL_URL: `https://chromewebstore.google.com/detail/magic-city-runner/${extensionId}`,
      MAGIC_CITY_NATIVE_RUNNER_MIN_EXTENSION_VERSION: '0.5.12',
      MAGIC_CITY_NATIVE_RUNNER_STORE_UPDATE_URL: updateUrl,
      MAGIC_CITY_NATIVE_RUNNER_STORE_VERSION_TIMEOUT_MS: '1000',
      MAGIC_CITY_SAFE_HTTP_STARTUP: 'true',
      AUTO_START_LOCAL_EXECUTION_AGENTS: 'false',
      AUTO_SEED_DEFAULT_AGENTS: 'false',
      ETHEREUM_CONFIRMATION_INDEXER_ENABLED: 'false',
      ETHEREUM_SHADOW_RELAYER_ENABLED: 'false',
      MISSION_BOUND_AUTH_SECRET: 'runner-store-version-test-secret'
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitForServer(baseUrl);
    await readAdvertisedVersion(baseUrl, expectedVersion);
  } catch (error) {
    throw new Error(`${error.message}:${stderr.slice(-2000)}`);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
}

const updatePort = await getAvailablePort();
let publishedVersion = '0.5.12';
let lastUpdateRequest = null;
const updateServer = http.createServer((req, res) => {
  lastUpdateRequest = new URL(req.url, `http://${req.headers.host}`);
  res.writeHead(200, { 'content-type': 'application/xml' });
  res.end(`<?xml version="1.0"?><gupdate><app appid="${extensionId}" status="ok"><updatecheck status="ok" version="${publishedVersion}"/></app></gupdate>`);
});
await new Promise((resolve) => updateServer.listen(updatePort, '127.0.0.1', resolve));

try {
  const updateUrl = `http://127.0.0.1:${updatePort}/service/update2/crx`;
  await runServerCase({ updateUrl, expectedVersion: '0.5.12' });
  if (lastUpdateRequest?.searchParams.get('x') !== `id=${extensionId}&uc`) {
    throw new Error(`store_update_extension_binding_missing:${lastUpdateRequest?.toString() || 'none'}`);
  }

  publishedVersion = '0.5.13';
  await runServerCase({ updateUrl, expectedVersion: '0.5.13' });

  await runServerCase({
    updateUrl: 'http://127.0.0.1:9/unavailable',
    expectedVersion: '0.5.12'
  });
} finally {
  await new Promise((resolve) => updateServer.close(resolve));
}

console.log('Native Runner Store version discovery test passed.');
