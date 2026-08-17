import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const apiKey = 'mission-boundary-test-key';

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableJsonValue(nested)])
    );
  }
  return value;
}

function stableJsonStringify(value) {
  return JSON.stringify(stableJsonValue(value));
}

function normalizeMissionDomain(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  }
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

async function request(baseUrl, pathName, { method = 'GET', body = null, key = '', cookie = '' } = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(key ? { 'x-api-key': key } : {}),
      ...(cookie ? { cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  const setCookie = response.headers.get('set-cookie') || '';
  return { response, data, cookie: setCookie.split(';')[0] || '' };
}

async function waitForServer(baseUrl) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    try {
      const { response } = await request(baseUrl, '/.well-known/agent-authorization.json');
      if (response.ok) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('server_start_timeout');
}

function buildPopProof({ keyPair, session, action, targetUrl, nonce = 'mission-boundary-test-nonce' }) {
  const capability = session.missionBoundAuth;
  const signingInput = stableJsonStringify({
    schema: 'magic-city-mission-pop-v1',
    capabilityId: capability.capabilityId,
    capabilityHash: capability.tokenHash,
    action,
    targetDomain: normalizeMissionDomain(targetUrl),
    nonce,
    previousHash: session.missionBoundaryLatestHash || null,
    audience: capability.audience || null,
    sessionId: capability.subject?.sessionId || session.id
  });
  return {
    nonce,
    previousHash: session.missionBoundaryLatestHash || null,
    publicKeyJwk: keyPair.publicKey.export({ format: 'jwk' }),
    signature: crypto.sign(null, Buffer.from(signingInput, 'utf8'), keyPair.privateKey).toString('base64url')
  };
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-mission-boundary-'));
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(rootDir, 'src/server.js')], {
    cwd: tmpDir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      PUBLIC_API_KEYS: apiKey,
      MAGIC_CITY_SAFE_HTTP_STARTUP: 'true',
      SANTACLAWZ_SAFE_START_DELAY_MS: '600000',
      AUTO_START_LOCAL_EXECUTION_AGENTS: 'false',
      AUTO_SEED_DEFAULT_AGENTS: 'false',
      AUTO_PREPARE_EXECUTION_PROOFS: 'true',
      SPONSORED_PROOF_QUEUE_WINDOW_MS: '600000',
      EXECUTION_WATCHDOG_ENABLED: 'false',
      ETHEREUM_CONFIRMATION_INDEXER_ENABLED: 'false',
      ETHEREUM_SHADOW_RELAYER_ENABLED: 'false',
      MISSION_BOUND_AUTH_SECRET: 'mission-boundary-test-secret'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer(baseUrl);
    const discovery = await request(baseUrl, '/.well-known/agent-authorization.json');
    if (!discovery.response.ok || discovery.data.protocol !== 'zk-mission-auth') {
      throw new Error(`standard_discovery_failed:${discovery.response.status}:${JSON.stringify(discovery.data)}`);
    }
    if (!discovery.data.endpoints?.verifyCheckpoint || !discovery.data.endpoints?.missionAuthorityJwks) {
      throw new Error('standard_discovery_missing_protocol_endpoints');
    }
    const jwks = await request(baseUrl, '/.well-known/mission-authority-jwks.json');
    if (!jwks.response.ok || !Array.isArray(jwks.data.keys)) {
      throw new Error(`standard_jwks_failed:${jwks.response.status}:${JSON.stringify(jwks.data)}`);
    }

    const auth = await request(baseUrl, '/auth/register', {
      method: 'POST',
      body: {
        email: `mission-boundary-${crypto.randomBytes(4).toString('hex')}@example.com`,
        passphrase: 'mission-boundary-test-passphrase',
        displayName: 'Mission Boundary Test'
      }
    });
    if (!auth.response.ok || !auth.cookie) throw new Error(`auth_failed:${auth.response.status}:${JSON.stringify(auth.data)}`);
    const cookie = auth.cookie;
    await request(baseUrl, '/plugins/register', {
      method: 'POST',
      key: apiKey,
      body: {
        pluginId: 'local-authenticated-browser-plugin',
        ownerAgentId: 'local-authenticated-browser-agent',
        kind: 'browser',
        endpoint: `${baseUrl}/plugins/local-authenticated-browser-plugin`,
        capabilities: ['browser-worker-agent', 'browser.local_authenticated_profile', 'browser.prepare_handoff'],
        tools: ['browser.open_local_profile', 'browser.inspect', 'browser.prepare_handoff']
      }
    });

    const started = await request(baseUrl, '/connectors/sessions/start', {
      method: 'POST',
      cookie,
      body: {
        connectorId: 'browser-worker-demo-v1',
        preferredExecutionAgentId: 'local-authenticated-browser-plugin',
        prompt: 'Open https://example.com and stop after reading the page.'
      }
    });
    if (!started.response.ok) throw new Error(`session_start_failed:${started.response.status}:${JSON.stringify(started.data)}`);
    const mode = await request(baseUrl, `/connectors/sessions/${encodeURIComponent(started.data.session.id)}/completion-mode`, {
      method: 'POST',
      cookie,
      body: { mode: 'agent_checkout' }
    });
    if (!mode.response.ok) throw new Error(`completion_mode_failed:${mode.response.status}:${JSON.stringify(mode.data)}`);

    const keyPair = crypto.generateKeyPairSync('ed25519');
    const claimed = await request(baseUrl, `/connectors/sessions/${encodeURIComponent(started.data.session.id)}/claim`, {
      method: 'POST',
      key: apiKey,
      body: {
        pluginId: 'local-authenticated-browser-plugin',
        holderPublicKeyJwk: keyPair.publicKey.export({ format: 'jwk' })
      }
    });
    if (!claimed.response.ok) throw new Error(`claim_failed:${claimed.response.status}:${JSON.stringify(claimed.data)}`);
    const session = claimed.data.session;
    if (session.missionBoundAuth?.confirmation?.method !== 'proof-of-possession') {
      throw new Error('holder_key_not_bound');
    }
    if (session.missionBoundAuth?.protocol?.capability?.version !== 'mission-bound-capability-v1') {
      throw new Error('protocol_capability_not_bound');
    }
    if (session.missionBoundAuth?.protocol?.policy?.version !== 'mission-bound-policy-v1') {
      throw new Error('protocol_policy_not_bound');
    }

    const unsigned = await request(baseUrl, `/connectors/sessions/${encodeURIComponent(session.id)}/checkpoint`, {
      method: 'POST',
      key: apiKey,
      body: {
        pluginId: 'local-authenticated-browser-plugin',
        label: 'Unsigned read',
        missionAction: 'read_public_page',
        targetUrl: 'https://example.com',
        browser: { url: 'https://example.com' }
      }
    });
    if (unsigned.response.status !== 401) {
      throw new Error(`unsigned_checkpoint_should_fail:${unsigned.response.status}:${JSON.stringify(unsigned.data)}`);
    }

    const proofOfPossession = buildPopProof({
      keyPair,
      session,
      action: 'read_public_page',
      targetUrl: 'https://example.com'
    });
    const signed = await request(baseUrl, `/connectors/sessions/${encodeURIComponent(session.id)}/checkpoint`, {
      method: 'POST',
      key: apiKey,
      body: {
        pluginId: 'local-authenticated-browser-plugin',
        label: 'Signed read',
        missionAction: 'read_public_page',
        targetUrl: 'https://example.com',
        browser: { url: 'https://example.com' },
        proofOfPossession
      }
    });
    if (!signed.response.ok) throw new Error(`signed_checkpoint_failed:${signed.response.status}:${JSON.stringify(signed.data)}`);
    const last = signed.data.session?.missionBoundaryTrace?.at?.(-1);
    if (!last?.proofOfPossession?.verified) throw new Error('signed_checkpoint_not_marked_verified');
    if (last?.protocolBoundaryEvent?.version !== 'mission-bound-boundary-event-v1') {
      throw new Error('checkpoint_missing_protocol_boundary_event');
    }
    if (!last.protocolBoundaryEvent.eventHash || !last.protocolBoundaryEvent.holderProof?.messageHash) {
      throw new Error('protocol_boundary_event_missing_commitments');
    }
    const strongProtocolEventCheck = await request(baseUrl, '/api/mission/verify-checkpoint', {
      method: 'POST',
      body: {
        boundaryEvent: last.protocolBoundaryEvent,
        requireStrongHolderProof: true
      }
    });
    if (strongProtocolEventCheck.response.status !== 401) {
      throw new Error(`compatibility_holder_proof_should_not_pass_strong_protocol:${strongProtocolEventCheck.response.status}`);
    }

    const receiptProofOfPossession = buildPopProof({
      keyPair,
      session: signed.data.session,
      action: 'read_public_page',
      targetUrl: 'https://example.com',
      nonce: 'mission-boundary-receipt-nonce'
    });
    const receipt = await request(baseUrl, `/mission-auth/sessions/${encodeURIComponent(session.id)}/receipts`, {
      method: 'POST',
      cookie,
      body: {
        action: 'read_public_page',
        targetUrl: 'https://example.com',
        proofOfPossession: receiptProofOfPossession,
        generateProof: false
      }
    });
    if (!receipt.response.ok) throw new Error(`receipt_create_failed:${receipt.response.status}:${JSON.stringify(receipt.data)}`);
    const publicInputs = receipt.data.proofArtifact?.publicInputs || {};
    if (publicInputs.schema !== 'magic-city-mba-proof-public-inputs-v1') {
      throw new Error('missing_mba_public_inputs_schema');
    }
    if (!publicInputs.missionBoundaryTraceHash || !publicInputs.missionBoundaryPublicInputsCommitment) {
      throw new Error('missing_mba_trace_commitments');
    }
    if (publicInputs.portableReceiptSchema !== 'mission-bound-auth-receipt-v1' || !publicInputs.portableReceiptHash) {
      throw new Error('missing_portable_mba_receipt');
    }
    if (!publicInputs.protocolCapabilityHash || !publicInputs.protocolPolicyHash || !publicInputs.paymentContextDigest) {
      throw new Error('missing_protocol_public_inputs');
    }
    if (!publicInputs.missionContractHash || !publicInputs.checkpointTranscriptHash || !publicInputs.resultHash) {
      throw new Error('missing_mba_contract_checkpoint_result_commitments');
    }
    if (!publicInputs.browserMissionProfileHash) {
      throw new Error('missing_lightweight_browser_profile_commitment');
    }
    if (!publicInputs.requestCommitment || !publicInputs.batchRoot || !publicInputs.batchWindowId) {
      throw new Error('missing_anchor_commitments');
    }
    if (publicInputs.runtimeHolderKeyThumbprint !== session.missionBoundAuth?.confirmation?.holderKeyThumbprint) {
      throw new Error('holder_thumbprint_not_bound_to_proof_artifact');
    }
    if (!receipt.data.executionVerification || receipt.data.executionVerification.statementKind !== 'mission_bound_auth:read_public_page') {
      throw new Error('missing_mba_execution_verification');
    }
    if (receipt.data.receipt?.metadata?.agentMissionBoundAuth?.portableReceipt?.schema !== 'mission-bound-auth-receipt-v1') {
      throw new Error('receipt_metadata_missing_portable_mba_receipt');
    }
    const browserProfile = receipt.data.receipt?.metadata?.agentMissionBoundAuth?.portableReceipt?.browserProfile;
    if (browserProfile?.version !== 'mba-browser-mission-profile-v1' || !browserProfile?.profileHash) {
      throw new Error('receipt_metadata_missing_lightweight_browser_profile');
    }

    const trace = await request(baseUrl, `/mission-auth/sessions/${encodeURIComponent(session.id)}/trace`, { cookie });
    if (!trace.response.ok) throw new Error(`trace_export_failed:${trace.response.status}:${JSON.stringify(trace.data)}`);
    if (!trace.data.trace?.events?.some((event) => event.signed)) throw new Error('trace_export_missing_signed_event');
    if (trace.data.protocol?.portableSchema !== 'mission-bound-auth-trace-export-v1' || !trace.data.protocol?.traceHash) {
      throw new Error('trace_export_missing_protocol_view');
    }
    if (trace.data.browserMissionProfile?.version !== 'mba-browser-mission-profile-v1' || !trace.data.redactedTrace?.redactedTraceHash) {
      throw new Error('trace_export_missing_latest_mba_browser_views');
    }
    if (!trace.data.missionContract?.missionContractHash || !trace.data.checkpointTranscript?.checkpointTranscriptHash) {
      throw new Error('trace_export_missing_contract_or_checkpoint_commitments');
    }

    const checkpointVerify = await request(baseUrl, '/api/mission/verify-checkpoint', {
      method: 'POST',
      body: {
        token: session.missionBoundAuth.token,
        capabilityId: session.missionBoundAuth.capabilityId,
        action: 'page.read',
        targetUrl: 'https://example.com',
        proofOfPossession: buildPopProof({
          keyPair,
          session: signed.data.session,
          action: 'read_public_page',
          targetUrl: 'https://example.com',
          nonce: 'mission-boundary-standard-checkpoint-nonce'
        })
      }
    });
    if (!checkpointVerify.response.ok || checkpointVerify.data.protocol !== 'zk-mission-auth') {
      throw new Error(`standard_checkpoint_verify_failed:${checkpointVerify.response.status}:${JSON.stringify(checkpointVerify.data)}`);
    }

    const bundle = await request(baseUrl, '/api/mission/export-bundle', {
      method: 'POST',
      cookie,
      body: {
        sessionId: session.id,
        receiptId: receipt.data.receipt.id
      }
    });
    if (!bundle.response.ok || bundle.data.bundle?.version !== 'zk-mission-bundle-v1' || !bundle.data.bundleHash) {
      throw new Error(`standard_bundle_export_failed:${bundle.response.status}:${JSON.stringify(bundle.data)}`);
    }
    if (bundle.data.bundle?.receipt?.schema !== 'mission-bound-auth-receipt-v1') {
      throw new Error('standard_bundle_missing_portable_receipt');
    }

    console.log('mission-boundary regression passed');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  if (stderr && /fatal|syntaxerror|unhandled/i.test(stderr)) {
    throw new Error(stderr);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
