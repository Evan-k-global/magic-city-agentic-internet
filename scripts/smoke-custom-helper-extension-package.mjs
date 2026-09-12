import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HELPER_PLUGIN_ID = 'acme-reading-helper';
const HELPER_OWNER_AGENT_ID = 'acme-reading-agent';
const apiKey = 'custom-helper-extension-smoke-key';

function fail(message) {
  throw new Error(message);
}

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

async function request(baseUrl, pathName, { method = 'GET', body = null, cookie = '', bearer = '', runnerSurface = '', runnerProtocol = '' } = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(runnerSurface ? { 'x-magic-city-runner-surface': runnerSurface } : {}),
      ...(runnerProtocol ? { 'x-magic-city-runner-protocol': runnerProtocol } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  const setCookie = response.headers.get('set-cookie') || '';
  return { response, data, cookie: setCookie.split(';')[0] || '' };
}

async function waitForServer(baseUrl) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    try {
      const { response } = await request(baseUrl, '/.well-known/magic-city-mission-auth');
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('server_start_timeout');
}

function packageStarter(tmpDir, baseUrl, fixtureOrigin) {
  const configPath = path.join(tmpDir, 'partner.config.json');
  const outDir = path.join(tmpDir, 'partner-build');
  fs.writeFileSync(configPath, JSON.stringify({
    controlPlaneOrigin: baseUrl,
    launchOrigins: [fixtureOrigin],
    helperPluginId: HELPER_PLUGIN_ID,
    helperOwnerAgentId: HELPER_OWNER_AGENT_ID,
    extensionName: 'Acme Read-Only Helper',
    extensionDescription: 'Read-only helper package smoke fixture.',
    optionalMerchantOrigins: [`${fixtureOrigin}/*`]
  }));
  const packageResult = spawnSync(process.execPath, [
    'scripts/package-custom-helper-extension.mjs',
    '--config', configPath,
    '--profile', 'development',
    '--out-dir', outDir
  ], {
    cwd: rootDir,
    stdio: 'inherit'
  });
  if (packageResult.error) fail(packageResult.error.message);
  if (packageResult.status !== 0) fail(`package script exited with ${packageResult.status}`);
  const version = JSON.parse(fs.readFileSync(path.join(outDir, 'package/manifest.json'), 'utf8')).version;
  const zipPath = path.join(outDir, `${HELPER_PLUGIN_ID}-${version}-development.zip`);
  if (!fs.existsSync(zipPath)) fail(`missing release zip ${zipPath}`);
  return zipPath;
}

async function startHttpsFixture(tmpDir) {
  const keyPath = path.join(tmpDir, 'fixture-key.pem');
  const certPath = path.join(tmpDir, 'fixture-cert.pem');
  const generated = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost'
  ], { encoding: 'utf8' });
  if (generated.error || generated.status !== 0) fail(`fixture_certificate_failed:${generated.stderr || generated.error?.message}`);
  const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Partner Fixture</title><meta name="description" content="Harmless partner helper fixture"></head><body><h1>Authorized partner page</h1></body></html>');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, origin: `https://localhost:${server.address().port}` };
}

function unpackForLocalSmoke(tmpDir, zipPath) {
  const unpackedDir = path.join(tmpDir, 'unpacked-extension');
  fs.mkdirSync(unpackedDir, { recursive: true });
  const unzip = spawnSync('unzip', ['-q', zipPath, '-d', unpackedDir], {
    cwd: rootDir,
    stdio: 'inherit'
  });
  if (unzip.error) fail(unzip.error.message);
  if (unzip.status !== 0) fail(`unzip exited with ${unzip.status}`);
  return unpackedDir;
}

async function registerSmokeUser(baseUrl) {
  const email = `custom-helper-${Date.now()}@example.com`;
  const auth = await request(baseUrl, '/auth/register', {
    method: 'POST',
    body: {
      email,
      passphrase: 'custom-helper-smoke-passphrase',
      displayName: 'Custom Helper Smoke'
    }
  });
  if (!auth.response.ok || !auth.cookie) {
    fail(`auth_failed:${auth.response.status}:${JSON.stringify(auth.data)}`);
  }
  const bootstrap = await request(baseUrl, '/billing/credits/bootstrap', {
    method: 'POST',
    cookie: auth.cookie,
    body: { requesterId: email }
  });
  if (!bootstrap.response.ok && bootstrap.data?.error !== 'daily_credits_already_claimed') {
    fail(`credit_bootstrap_failed:${bootstrap.response.status}:${JSON.stringify(bootstrap.data)}`);
  }
  return { cookie: auth.cookie, email };
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-custom-helper-smoke-'));
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const fixture = await startHttpsFixture(tmpDir);
  const zipPath = packageStarter(tmpDir, baseUrl, fixture.origin);
  const serverEnv = {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    PUBLIC_API_KEYS: apiKey,
    MAGIC_CITY_NATIVE_RUNNER_TOKEN_TTL_MS: '600000',
    MAGIC_CITY_NATIVE_RUNNER_PAIRING_TTL_MS: '600000',
    MAGIC_CITY_SAFE_HTTP_STARTUP: 'true',
    SANTACLAWZ_SAFE_START_DELAY_MS: '600000',
    AUTO_START_LOCAL_EXECUTION_AGENTS: 'false',
    AUTO_SEED_DEFAULT_AGENTS: 'false',
    EXECUTION_WATCHDOG_ENABLED: 'false',
    ETHEREUM_CONFIRMATION_INDEXER_ENABLED: 'false',
    ETHEREUM_SHADOW_RELAYER_ENABLED: 'false',
    MISSION_BOUND_AUTH_SECRET: 'custom-helper-extension-smoke-secret'
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
  let context = null;
  try {
    await waitForServer(baseUrl);
    const extensionDir = unpackForLocalSmoke(tmpDir, zipPath);
    const { cookie } = await registerSmokeUser(baseUrl);
    const pairingStart = await request(baseUrl, '/native-runner/helper/pairing/start', {
      method: 'POST',
      cookie,
      body: {
        pluginId: HELPER_PLUGIN_ID,
        ownerAgentId: HELPER_OWNER_AGENT_ID,
        label: 'Acme Shopping Helper',
        trustMode: 'trusted_under_cap',
        useExistingBrowser: true
      }
    });
    if (pairingStart.response.status !== 201) {
      fail(`helper_pairing_start_failed:${pairingStart.response.status}:${JSON.stringify(pairingStart.data)}`);
    }
    const pairingCode = pairingStart.data.pairing?.code || '';
    if (!pairingCode) fail(`helper_pairing_missing_code:${JSON.stringify(pairingStart.data)}`);

    context = await chromium.launchPersistentContext(path.join(tmpDir, 'profile'), {
      headless: false,
      args: [
        '--ignore-certificate-errors',
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`
      ]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('#pairingCode').fill(pairingCode);
    await popup.locator('#pairBtn').click();
    await popup.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Paired.'), null, { timeout: 10_000 });
    await popup.locator('#registerBtn').click();
    await popup.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Registered.'), null, { timeout: 10_000 });
    await popup.locator('#pollBtn').click();
    await popup.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Poll complete.'), null, { timeout: 10_000 });

    const started = await request(baseUrl, '/connectors/sessions/start', {
      method: 'POST',
      cookie,
      body: {
        connectorId: 'browser-worker-demo-v1',
        preferredExecutionAgentId: HELPER_PLUGIN_ID,
        prompt: `Open ${fixture.origin}/demo and prepare a checkout handoff for one starter item under $4.`
      }
    });
    if (started.response.status !== 201) {
      fail(`session_start_failed:${started.response.status}:${JSON.stringify(started.data)}`);
    }
    const sessionId = started.data.session?.id;
    if (!sessionId) fail(`session_start_missing_id:${JSON.stringify(started.data)}`);
    if (started.data.session?.preferredExecutionAgentId !== HELPER_PLUGIN_ID) {
      fail(`session_start_lost_custom_helper:${started.data.session?.preferredExecutionAgentId}`);
    }
    const mode = await request(baseUrl, `/connectors/sessions/${encodeURIComponent(sessionId)}/completion-mode`, {
      method: 'POST',
      cookie,
      body: { mode: 'agent_checkout' }
    });
    if (!mode.response.ok) fail(`completion_mode_failed:${mode.response.status}:${JSON.stringify(mode.data)}`);

    const executionStart = await request(baseUrl, `/connectors/sessions/${encodeURIComponent(sessionId)}/start-execution`, {
      method: 'POST',
      cookie,
      body: {
        mode: 'agent_checkout',
        preferredExecutionAgentId: HELPER_PLUGIN_ID
      }
    });
    if (!executionStart.response.ok || !executionStart.data.session?.extensionRunDispatch?.expiresAt) {
      fail(`custom_helper_dispatch_failed:${executionStart.response.status}:${JSON.stringify(executionStart.data)}`);
    }
    if (executionStart.data.session?.preferredExecutionAgentId !== HELPER_PLUGIN_ID) {
      fail(`dispatch_lost_custom_helper:${executionStart.data.session?.preferredExecutionAgentId}`);
    }

    await popup.locator('#pollBtn').click();
    try {
      await popup.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('read_only_demo_complete'), null, { timeout: 20_000 });
    } catch {
      fail(`read_only_demo_did_not_complete:${await popup.locator('#status').textContent()}`);
    }

    const ownerView = await request(baseUrl, `/connectors/sessions/${encodeURIComponent(sessionId)}`, { cookie });
    if (!ownerView.response.ok) fail(`owner_session_fetch_failed:${ownerView.response.status}:${JSON.stringify(ownerView.data)}`);
    const finalSession = ownerView.data.session || {};
    if (finalSession.status !== 'failed') fail(`expected_starter_failure_status:${finalSession.status}`);
    if (finalSession.claimedByPluginId !== HELPER_PLUGIN_ID) fail(`session_not_claimed_by_helper:${finalSession.claimedByPluginId}`);
    if (finalSession.fulfilledByPluginId !== HELPER_PLUGIN_ID) fail(`session_not_fulfilled_by_helper:${finalSession.fulfilledByPluginId}`);
    const boundaryEventCount = Number(finalSession.missionBoundaryEventCount || (
      Array.isArray(finalSession.missionBoundaryTrace) ? finalSession.missionBoundaryTrace.length : 0
    ));
    if (boundaryEventCount < 2) {
      fail(`missing_holder_signed_boundary_events:${finalSession.missionBoundaryEventCount}`);
    }
    const payload = JSON.stringify(finalSession);
    if (payload.includes('mcnr_') || payload.includes(pairingCode)) {
      fail('session_response_leaked_runner_secret');
    }
    if (!payload.includes('Authorized partner page') || !payload.includes('read-only-page-summary.json')) {
      fail('starter_read_only_result_missing');
    }

    const pageCountBeforeRejectedOrigin = context.pages().length;
    const rejectedOriginStart = await request(baseUrl, '/connectors/sessions/start', {
      method: 'POST',
      cookie,
      body: {
        connectorId: 'browser-worker-demo-v1',
        preferredExecutionAgentId: HELPER_PLUGIN_ID,
        prompt: 'Open https://unapproved.partner.test/demo and prepare a checkout handoff for one starter item under $4.'
      }
    });
    const rejectedOriginSessionId = rejectedOriginStart.data.session?.id;
    if (rejectedOriginStart.response.status !== 201 || !rejectedOriginSessionId) {
      fail(`rejected_origin_session_start_failed:${rejectedOriginStart.response.status}:${JSON.stringify(rejectedOriginStart.data)}`);
    }
    const rejectedOriginMode = await request(baseUrl, `/connectors/sessions/${encodeURIComponent(rejectedOriginSessionId)}/completion-mode`, {
      method: 'POST',
      cookie,
      body: { mode: 'agent_checkout' }
    });
    if (!rejectedOriginMode.response.ok) fail(`rejected_origin_mode_failed:${rejectedOriginMode.response.status}`);
    const rejectedOriginDispatch = await request(baseUrl, `/connectors/sessions/${encodeURIComponent(rejectedOriginSessionId)}/start-execution`, {
      method: 'POST',
      cookie,
      body: { mode: 'agent_checkout', preferredExecutionAgentId: HELPER_PLUGIN_ID }
    });
    if (!rejectedOriginDispatch.response.ok) fail(`rejected_origin_dispatch_failed:${rejectedOriginDispatch.response.status}`);
    await popup.locator('#pollBtn').click();
    await popup.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('mission_origin_not_allowed'), null, { timeout: 10_000 });
    if (context.pages().length !== pageCountBeforeRejectedOrigin) {
      fail('rejected_origin_created_browser_tab');
    }

    console.log(`custom helper extension release package smoke passed: ${zipPath}`);
    console.log(`session ${sessionId} produced ${boundaryEventCount} mission-bound events`);
  } catch (error) {
    if (stderr) console.error(stderr.split('\n').slice(-80).join('\n'));
    throw error;
  } finally {
    if (context) await context.close();
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await new Promise((resolve) => fixture.server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
