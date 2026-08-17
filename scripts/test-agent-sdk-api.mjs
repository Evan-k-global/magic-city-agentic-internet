import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MagicCityAgentSDK } from '../public/sdk/magic-city-agent-sdk.js';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const apiKey = 'agent-sdk-smoke-key';

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

async function request(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  return { response, data: await response.json().catch(() => ({})) };
}

async function waitForServer(baseUrl) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    try {
      const { response } = await request(baseUrl, '/agent-sdk/v1/manifest');
      if (response.ok) return;
    } catch {
      // Keep polling until the local server is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('agent_sdk_server_start_timeout');
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-agent-sdk-smoke-'));
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverEnv = {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    PUBLIC_API_KEYS: apiKey,
    MAGIC_CITY_SAFE_HTTP_STARTUP: 'true',
    SANTACLAWZ_SAFE_START_DELAY_MS: '600000',
    AUTO_START_LOCAL_EXECUTION_AGENTS: 'false',
    AUTO_SEED_DEFAULT_AGENTS: 'false',
    EXECUTION_WATCHDOG_ENABLED: 'false',
    ETHEREUM_CONFIRMATION_INDEXER_ENABLED: 'false',
    ETHEREUM_SHADOW_RELAYER_ENABLED: 'false',
    MISSION_BOUND_AUTH_SECRET: 'agent-sdk-smoke-secret'
  };
  let stderr = '';
  const child = spawn(process.execPath, [path.join(rootDir, 'src/server.js')], {
    cwd: tmpDir,
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  try {
    await waitForServer(baseUrl);
    const sdk = new MagicCityAgentSDK({
      baseUrl,
      apiKey,
      agentId: 'acme-demo-agent'
    });

    const manifest = await sdk.manifest();
    assert.equal(manifest.schemaVersion, 'magic-city-agent-sdk-v1');
    assert.equal(manifest.authorityModel?.rawVaultAccess, false);
    assert.equal(manifest.paymentAuthorityModel?.externalAgentCardAccess, false);

    await assert.rejects(
      new MagicCityAgentSDK({ baseUrl, agentId: 'unauthorized-agent' }).proposeMission({
        goal: 'This write should require API auth.'
      }),
      /invalid_api_key/
    );

    const proposed = await sdk.proposeMission({
      goal: 'Prepare an Amazon cart for a demo item under $25.',
      constraints: { merchants: ['amazon.com'], stopBefore: ['payment', 'final_submit'] },
      budget: '$25',
      publicContext: { demo: true }
    });
    assert.ok(proposed.mission?.id, 'mission id missing');
    assert.equal(proposed.mission.agentId, 'acme-demo-agent');
    assert.equal(proposed.mission.status, 'proposed');

    const listed = await sdk.listMissions({ limit: 5 });
    assert.ok(listed.missions.some((mission) => mission.id === proposed.mission.id), 'mission missing from list');

    const optioned = await sdk.submitOptions(proposed.mission.id, [
      { title: 'Demo option', price: '$12.99', url: 'https://www.amazon.com/s?k=demo+item' }
    ]);
    assert.equal(optioned.mission.status, 'options_submitted');
    assert.equal(optioned.mission.options.length, 1);

    const artifacted = await sdk.submitArtifact(proposed.mission.id, {
      label: 'demo-summary',
      content: '# Demo summary\n\nMission-ready.',
      extension: 'md'
    });
    assert.ok(artifacted.artifact?.sha256, 'artifact hash missing');
    assert.match(artifacted.artifact?.url || '', /^\/artifacts\//);

    const browser = await sdk.requestBrowserWorker(proposed.mission.id, {
      targetUrl: 'https://www.amazon.com',
      goal: 'Prepare the selected item checkout.',
      constraints: 'Amazon only. Stop before payment and final submit.',
      budget: '$25'
    });
    assert.equal(browser.approval?.required, true);
    assert.match(browser.approval?.executionUrl || '', /^\/connectors\/sessions\//);
    assert.equal(browser.mission.status, 'browser_execution_requested');
    assert.equal(browser.mission.connectorSession?.kind, 'browser');
    assert.equal(browser.mission.requestedExecutions?.[0]?.executesImmediately, false);
    assert.ok(!browser.mission.missionBoundAuth?.token, 'public mission view must not include raw mission token');
    assert.ok(!browser.connectorSession?.missionBoundAuth?.token, 'SDK response must not leak raw mission token');

    const receipts = await sdk.receipts(proposed.mission.id);
    assert.equal(receipts.missionId, proposed.mission.id);
    assert.ok(Array.isArray(receipts.receipts));

    console.log('agent SDK API smoke passed');
  } catch (error) {
    if (stderr) console.error(stderr.split('\n').slice(-80).join('\n'));
    throw error;
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
