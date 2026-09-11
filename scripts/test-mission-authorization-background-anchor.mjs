import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registryAddress = 'B62qikuceF52NVPb8VAVSaRoCRMusFz38pLLENjvLaUuLiDnULAVohe';
const registryRoot = '18790655599203154925344999435228465575432997450239479138054579590491229310665';
const nextRegistryRoot = '1234567890123456789012345678901234567890';
const relayerToken = 'background-anchor-test-token';

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function request(baseUrl, pathname, {
  method = 'GET',
  body = null,
  cookie = '',
  bearer = '',
  runnerSurface = '',
  runnerProtocol = '',
  runnerExtensionVersion = '',
  runnerExtensionId = ''
} = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(runnerSurface ? { 'x-magic-city-runner-surface': runnerSurface } : {}),
      ...(runnerProtocol ? { 'x-magic-city-runner-protocol': runnerProtocol } : {}),
      ...(runnerExtensionVersion ? { 'x-magic-city-runner-extension-version': runnerExtensionVersion } : {}),
      ...(runnerExtensionId ? { 'x-magic-city-runner-extension-id': runnerExtensionId } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  return {
    response,
    data: text ? JSON.parse(text) : {},
    cookie: (response.headers.get('set-cookie') || '').split(';')[0]
  };
}

async function waitForServer(baseUrl) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server_start_timeout');
}

async function waitForSession(baseUrl, cookie, sessionId, predicate) {
  const deadline = Date.now() + 8_000;
  let latest = null;
  while (Date.now() < deadline) {
    const result = await request(baseUrl, `/connectors/sessions/${encodeURIComponent(sessionId)}`, { cookie });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    latest = result.data.session;
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`session_state_timeout:${JSON.stringify(latest?.finalSubmitChainAuthorization || null)}`);
}

const graphqlPort = await availablePort();
const graphqlServer = http.createServer(async (req, res) => {
  await readJsonBody(req);
  sendJson(res, 200, {
    data: {
      account: {
        publicKey: registryAddress,
        nonce: '2',
        zkappState: ['0', '0', '0', '0', registryRoot, '2', '0', '0'],
        verificationKey: { hash: 'test-verification-key' }
      }
    }
  });
});
await new Promise((resolve) => graphqlServer.listen(graphqlPort, '127.0.0.1', resolve));

let submitMode = 'success';
let submitResponseSent = false;
let submitCount = 0;
const relayerPort = await availablePort();
const relayerServer = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'magic-city-mba-relayer',
      mode: 'mba_mission_registry',
      mba: {
        ready: true,
        registryAddress,
        capabilities: ['mba_mission_registry', 'registry_state_sync'],
        chain: { reachable: true, registryRoot, sequence: '2' },
        mirror: { registryRoot, sequence: '2', pending: false, matchesOnchain: true }
      },
      missionAuth: {
        ready: true,
        registryAddress,
        capabilities: ['mission_auth_registry', 'authorization_commitment', 'signed_state_update'],
        credentialsConfigured: true,
        chain: { reachable: true, latestStatementHash: '0', latestPayloadDigest: '0', anchoredCount: '2' }
      }
    });
  }
  if (req.url !== '/submit' || req.method !== 'POST') return sendJson(res, 404, { error: 'not_found' });
  assert.equal(req.headers.authorization, `Bearer ${relayerToken}`);
  const body = await readJsonBody(req);
  submitCount += 1;
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (submitMode === 'outage') {
    submitResponseSent = true;
    return sendJson(res, 502, { error: 'zeko_temporarily_unavailable' });
  }
  const statementHash = body.anchorPayload?.statementHash;
  submitResponseSent = true;
  if (submitMode === 'unknown') {
    return sendJson(res, 202, {
      id: `zsub-${submitCount}`,
      status: 'submission_unknown',
      txHash: '5JunknownAnchorTransactionHash111111111111111111111111',
      result: { accepted: false, errorCode: 'submission_unknown' }
    });
  }
  return sendJson(res, 201, {
    id: `zsub-${submitCount}`,
    status: 'submitted',
    txHash: '5JbackgroundAnchorTestTransactionHash111111111111111111111',
    result: {
      accepted: true,
      mode: 'mission_auth_registry',
      txHash: '5JbackgroundAnchorTestTransactionHash111111111111111111111',
      registryPublicKey: registryAddress,
      statementHash,
      payloadDigest: nextRegistryRoot,
      anchoredCount: String(2 + submitCount),
      verificationKeyHash: 'test-verification-key',
      confirmedAt: new Date().toISOString()
    }
  });
});
await new Promise((resolve) => relayerServer.listen(relayerPort, '127.0.0.1', resolve));

const appPort = await availablePort();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-background-anchor-'));
const baseUrl = `http://127.0.0.1:${appPort}`;
const child = spawn(process.execPath, [path.join(rootDir, 'src/server.js')], {
  cwd: tempDir,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(appPort),
    MAGIC_CITY_DATA_PATH: path.join(tempDir, 'state.json'),
    MAGIC_CITY_SAFE_HTTP_STARTUP: 'true',
    MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE: 'false',
    AUTO_START_LOCAL_EXECUTION_AGENTS: 'false',
    AUTO_SEED_DEFAULT_AGENTS: 'false',
    AUTO_PREPARE_EXECUTION_PROOFS: 'false',
    ETHEREUM_CONFIRMATION_INDEXER_ENABLED: 'false',
    ETHEREUM_SHADOW_RELAYER_ENABLED: 'false',
    SANTACLAWZ_SAFE_START_DELAY_MS: '600000',
    MISSION_BOUND_AUTH_SECRET: crypto.randomBytes(32).toString('hex'),
    ZEKO_SUBMIT_MODE: 'relay',
    ZEKO_RELAYER_MODE: 'mba_mission_registry',
    ZEKO_NETWORK_ID: 'zeko:sepolia',
    MAGIC_CITY_MISSION_PROOF_NETWORK_ID: 'zeko:sepolia',
    ZEKO_GRAPHQL: `http://127.0.0.1:${graphqlPort}/graphql`,
    ZEKO_MBA_RELAYER_URL: `http://127.0.0.1:${relayerPort}/submit`,
    ZEKO_MBA_RELAYER_TOKEN: relayerToken,
    ZEKO_MISSION_AUTH_REGISTRY_PUBLIC_KEY: registryAddress,
    ZEKO_MBA_MISSION_REGISTRY_PUBLIC_KEY: registryAddress,
    MAGIC_CITY_MISSION_AUTH_ANCHOR_ENABLED: 'true',
    MAGIC_CITY_FINAL_SUBMIT_CHAIN_GATE_ENABLED: 'false',
    MAGIC_CITY_MISSION_AUTH_ANCHOR_RETRY_MS: '5000'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

async function createAuthorizedMission(cookie, email) {
  const started = await request(baseUrl, '/connectors/sessions/start', {
    method: 'POST',
    cookie,
    body: {
      connectorId: 'browser-worker-demo-v1',
      preferredExecutionAgentId: 'magic-city-runner-extension',
      prompt: 'buy nature valley granola bars from amazon under $4',
      profileSummary: {}
    }
  });
  assert.equal(started.response.status, 201, JSON.stringify(started.data));
  const sessionId = started.data.session.id;
  const mode = await request(baseUrl, `/connectors/sessions/${sessionId}/completion-mode`, {
    method: 'POST',
    cookie,
    body: { mode: 'agent_checkout' }
  });
  assert.equal(mode.response.status, 200, JSON.stringify(mode.data));
  submitResponseSent = false;
  const executionStartedAt = Date.now();
  const execution = await request(baseUrl, `/connectors/sessions/${sessionId}/start-execution`, {
    method: 'POST',
    cookie,
    body: {
      mode: 'agent_checkout',
      requesterId: email,
      preferredExecutionAgentId: 'magic-city-runner-extension',
      extensionCheckoutProfileEnabled: true,
      extensionFinalSubmitEnabled: true
    }
  });
  const executionElapsedMs = Date.now() - executionStartedAt;
  assert.equal(execution.response.status, 200, JSON.stringify(execution.data));
  assert.equal(submitResponseSent, false, 'Run response waited for the relayer');
  assert.ok(executionElapsedMs < 750, `Run response took ${executionElapsedMs}ms`);
  return { sessionId, executionElapsedMs };
}

try {
  await waitForServer(baseUrl);
  const email = `background-anchor-${crypto.randomBytes(4).toString('hex')}@example.com`;
  const auth = await request(baseUrl, '/auth/register', {
    method: 'POST',
    body: { email, passphrase: 'background-anchor-test-passphrase', displayName: 'Anchor Test' }
  });
  assert.equal(auth.response.status, 201, JSON.stringify(auth.data));
  const cookie = auth.cookie;
  const credits = await request(baseUrl, '/billing/credits/bootstrap', {
    method: 'POST',
    cookie,
    body: { requesterId: email }
  });
  assert.ok([200, 201].includes(credits.response.status), JSON.stringify(credits.data));

  const pairingStart = await request(baseUrl, '/native-runner/extension/pairing/start', {
    method: 'POST',
    cookie,
    body: { trustMode: 'trusted_under_cap', useExistingBrowser: true }
  });
  assert.equal(pairingStart.response.status, 201, JSON.stringify(pairingStart.data));
  const pairingClaim = await request(baseUrl, '/native-runner/extension/pairing/claim', {
    method: 'POST',
    body: {
      code: pairingStart.data.pairing.code,
      extensionVersion: '0.5.6',
      extensionId: 'background-anchor-test-extension'
    }
  });
  assert.equal(pairingClaim.response.status, 201, JSON.stringify(pairingClaim.data));
  const deviceToken = pairingClaim.data.setup.deviceToken;
  const registration = await request(baseUrl, '/plugins/register', {
    method: 'POST',
    bearer: deviceToken,
    runnerSurface: 'chrome-extension',
    runnerProtocol: 'declarative-v1',
    runnerExtensionVersion: '0.5.6',
    runnerExtensionId: 'background-anchor-test-extension',
    body: {
      pluginId: 'magic-city-runner-extension',
      ownerAgentId: 'magic-city-runner-extension',
      kind: 'browser',
      endpoint: 'chrome-extension://background-anchor-test-extension',
      executionAgent: true,
      capabilities: ['browser-worker-agent', 'browser.extension_dom_executor', 'browser.prepare_cart'],
      tools: ['browser.open_local_profile', 'browser.inspect', 'browser.prepare_cart'],
      metadata: {
        extensionOnly: true,
        extensionExecutor: true,
        executionBackend: 'extension_dom_executor',
        browserPermissionReady: true
      }
    }
  });
  assert.equal(registration.response.status, 201, JSON.stringify(registration.data));

  const healthyMission = await createAuthorizedMission(cookie, email);
  const anchored = await waitForSession(baseUrl, cookie, healthyMission.sessionId, (session) => (
    session?.finalSubmitChainAuthorization?.status === 'anchored'
  ));
  const authorization = anchored.finalSubmitChainAuthorization;
  assert.equal(authorization.gateEnabled, false);
  assert.equal(authorization.anchorEnabled, true);
  assert.equal(authorization.policy, 'asynchronous_fail_open');
  assert.equal(authorization.verification.commitmentMatches, true);
  assert.equal(authorization.verification.confirmedEvidenceComplete, true);
  assert.equal(authorization.approvalCommitment, authorization.statementHash);
  assert.equal(authorization.registryAddress, registryAddress);
  assert.ok(authorization.txHash);

  const trace = await request(baseUrl, `/mission-auth/sessions/${healthyMission.sessionId}/trace`, { cookie });
  assert.equal(trace.response.status, 200, JSON.stringify(trace.data));
  assert.equal(trace.data.authorizationAnchor.txHash, authorization.txHash);
  assert.equal(trace.data.authorizationAnchor.verification.confirmedEvidenceComplete, true);

  submitMode = 'unknown';
  const unknownMission = await createAuthorizedMission(cookie, email);
  const unknown = await waitForSession(baseUrl, cookie, unknownMission.sessionId, (session) => (
    session?.finalSubmitChainAuthorization?.status === 'preparing'
      && Boolean(session?.finalSubmitChainAuthorization?.submissionId)
  ));
  assert.equal(unknown.finalSubmitChainAuthorization.verification.confirmedEvidenceComplete, null);
  assert.equal(unknown.finalSubmitChainAuthorization.settledAt, null);

  submitMode = 'outage';
  const outageMission = await createAuthorizedMission(cookie, email);
  const unavailable = await waitForSession(baseUrl, cookie, outageMission.sessionId, (session) => (
    session?.finalSubmitChainAuthorization?.status === 'unavailable'
  ));
  assert.equal(unavailable.finalSubmitChainAuthorization.gateEnabled, false);
  assert.equal(unavailable.finalSubmitChainAuthorization.bypassAllowed, true);
  assert.equal(unavailable.finalSubmitChainAuthorization.bypassReason, 'zeko_sepolia_unavailable');
  assert.ok(Date.parse(unavailable.finalSubmitChainAuthorization.nextRetryAt) > Date.now());

  const source = fs.readFileSync(path.join(rootDir, 'src/server.js'), 'utf8');
  assert.match(source, /finalSubmitChainAuthorization: FINAL_SUBMIT_CHAIN_GATE_ENABLED\s*\? finalSubmitChainAuthorizationForRunner/);
  const retryFunctionSource = source.match(/function finalSubmitChainAuthorizationCanRetry\(session = null\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(retryFunctionSource, 'missing mission authorization retry predicate');
  const canRetry = new Function(
    'MISSION_AUTH_ANCHOR_ENABLED',
    `${retryFunctionSource}; return finalSubmitChainAuthorizationCanRetry;`
  )(true);
  assert.equal(canRetry({
    finalSubmitChainAuthorization: {
      status: 'unavailable',
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    }
  }), true, 'historical authorization stopped retrying after checkout approval expiry');
  assert.equal(canRetry({ finalSubmitChainAuthorization: { status: 'anchored' } }), false);

  console.log(JSON.stringify({
    backgroundMissionAnchor: 'passed',
    runResponseMs: healthyMission.executionElapsedMs,
    txHash: authorization.txHash,
    outageCheckoutPolicy: unavailable.finalSubmitChainAuthorization.policy,
    retryScheduled: true
  }));
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  await new Promise((resolve) => relayerServer.close(resolve));
  await new Promise((resolve) => graphqlServer.close(resolve));
}

if (stderr) process.stderr.write(stderr);
