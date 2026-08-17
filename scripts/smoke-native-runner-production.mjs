import crypto from 'node:crypto';

const baseUrl = (process.env.MAGIC_CITY_BASE_URL || process.argv[2] || 'http://127.0.0.1:4411').replace(/\/$/, '');
const email = process.env.MAGIC_CITY_SMOKE_EMAIL || `native-runner-smoke-${Date.now()}@example.com`;
const passphrase = process.env.MAGIC_CITY_SMOKE_PASSPHRASE || `native-runner-${crypto.randomBytes(8).toString('hex')}`;
const submitAnchor = process.env.MAGIC_CITY_SMOKE_SUBMIT_ANCHOR === 'true';
const inlineProof = process.env.MAGIC_CITY_SMOKE_INLINE_PROOF === 'true';
const network = process.env.MAGIC_CITY_SMOKE_ZEKO_NETWORK || 'zeko:testnet';
const anchorTimeoutMs = Math.max(10_000, Number(process.env.MAGIC_CITY_SMOKE_ANCHOR_TIMEOUT_MS || 20 * 60 * 1000) || 20 * 60 * 1000);

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

async function request(pathName, { method = 'GET', body = null, cookie = '', bearer = '' } = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${pathName}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (error) {
    const cause = error?.cause;
    throw new Error(`request_fetch_failed:${JSON.stringify({
      baseUrl,
      pathName,
      method,
      message: error?.message || String(error),
      causeMessage: cause?.message || null,
      causeCode: cause?.code || null,
      causeName: cause?.name || null
    })}`);
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  const setCookie = response.headers.get('set-cookie') || '';
  return { response, data, cookie: setCookie.split(';')[0] || '' };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWithRetry(pathName, options, { attempts = 5, delayMs = 1_000 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await request(pathName, options);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

function buildPopProof({ keyPair, session, action, targetUrl, nonce = crypto.randomBytes(16).toString('base64url') }) {
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
  const health = await request('/health');
  if (!health.response.ok) throw new Error(`health_failed:${health.response.status}:${JSON.stringify(health.data)}`);
  const persistence = health.data.persistence || {};
  if ((process.env.NODE_ENV === 'production' || process.env.FLY_APP_NAME)
    && (persistence.driver !== 'postgres'
      || !persistence.ready
      || !persistence.healthy
      || !persistence.atRestEncryption?.enabled
      || (persistence.singleWriterRequired && !persistence.writerLockAcquired))) {
    throw new Error(`production_persistence_not_postgres:${JSON.stringify(persistence)}`);
  }

  let auth = await request('/auth/register', {
    method: 'POST',
    body: { email, passphrase, displayName: 'Native Runner Smoke' }
  });
  if (auth.response.status === 409 || (auth.response.status === 429 && process.env.MAGIC_CITY_SMOKE_EMAIL)) {
    auth = await request('/auth/login', {
      method: 'POST',
      body: { email, passphrase }
    });
  }
  if (!auth.response.ok || !auth.cookie) throw new Error(`auth_failed:${auth.response.status}:${JSON.stringify(auth.data)}`);
  const cookie = auth.cookie;

  const setup = await request('/native-runner/setup', {
    method: 'POST',
    cookie,
    body: { trustMode: 'trusted_under_cap', setupMode: 'production_smoke' }
  });
  if (!setup.response.ok) throw new Error(`native_setup_failed:${setup.response.status}:${JSON.stringify(setup.data)}`);
  const token = setup.data.setup.deviceToken;

  const register = await request('/plugins/register', {
    method: 'POST',
    bearer: token,
    body: {
      pluginId: 'local-authenticated-browser-plugin',
      ownerAgentId: 'local-authenticated-browser-agent',
      kind: 'browser',
      endpoint: `${baseUrl}/plugins/local-authenticated-browser-plugin`,
      capabilities: ['browser-worker-agent', 'browser.local_authenticated_profile', 'browser.prepare_handoff'],
      tools: ['browser.open_local_profile', 'browser.inspect', 'browser.prepare_handoff']
    }
  });
  if (!register.response.ok) throw new Error(`plugin_register_failed:${register.response.status}:${JSON.stringify(register.data)}`);

  const started = await request('/connectors/sessions/start', {
    method: 'POST',
    cookie,
    body: {
      connectorId: 'browser-worker-demo-v1',
      preferredExecutionAgentId: 'local-authenticated-browser-plugin',
      prompt: 'Open https://example.com and stop after reading the page for a production smoke.'
    }
  });
  if (!started.response.ok) throw new Error(`session_start_failed:${started.response.status}:${JSON.stringify(started.data)}`);
  const sessionId = started.data.session.id;

  const mode = await request(`/connectors/sessions/${encodeURIComponent(sessionId)}/completion-mode`, {
    method: 'POST',
    cookie,
    body: { mode: 'agent_checkout' }
  });
  if (!mode.response.ok) throw new Error(`completion_mode_failed:${mode.response.status}:${JSON.stringify(mode.data)}`);

  const sessions = await request('/connectors/sessions', { bearer: token });
  if (!sessions.response.ok) throw new Error(`native_list_failed:${sessions.response.status}:${JSON.stringify(sessions.data)}`);
  if (!sessions.data.sessions?.some((session) => session.id === sessionId)) throw new Error('native_list_missing_smoke_session');

  const keyPair = crypto.generateKeyPairSync('ed25519');
  const claim = await request(`/connectors/sessions/${encodeURIComponent(sessionId)}/claim`, {
    method: 'POST',
    bearer: token,
    body: {
      pluginId: 'local-authenticated-browser-plugin',
      holderPublicKeyJwk: keyPair.publicKey.export({ format: 'jwk' })
    }
  });
  if (!claim.response.ok) throw new Error(`claim_failed:${claim.response.status}:${JSON.stringify(claim.data)}`);

  const checkpointProof = buildPopProof({
    keyPair,
    session: claim.data.session,
    action: 'read_public_page',
    targetUrl: 'https://example.com'
  });
  const checkpoint = await request(`/connectors/sessions/${encodeURIComponent(sessionId)}/checkpoint`, {
    method: 'POST',
    bearer: token,
    body: {
      pluginId: 'local-authenticated-browser-plugin',
      label: 'Production smoke checkpoint',
      missionAction: 'read_public_page',
      targetUrl: 'https://example.com',
      browser: { url: 'https://example.com' },
      proofOfPossession: checkpointProof
    }
  });
  if (!checkpoint.response.ok) throw new Error(`checkpoint_failed:${checkpoint.response.status}:${JSON.stringify(checkpoint.data)}`);

  const fulfillProof = buildPopProof({
    keyPair,
    session: checkpoint.data.session,
    action: 'handoff',
    targetUrl: 'https://example.com'
  });
  const fulfill = await request(`/connectors/sessions/${encodeURIComponent(sessionId)}/fulfill`, {
    method: 'POST',
    bearer: token,
    body: {
      pluginId: 'local-authenticated-browser-plugin',
      status: 'fulfilled',
      missionAction: 'handoff',
      proofOfPossession: fulfillProof,
      result: {
        browserExecution: {
          mode: 'production_smoke',
          targetUrl: 'https://example.com',
          finalUrl: 'https://example.com',
          stopState: 'handoff_ready'
        }
      },
      handoff: { label: 'Open prepared page', url: 'https://example.com' },
      notes: 'Production native runner smoke fulfilled a bounded handoff.',
      fundingDisposition: 'release',
      proofRef: `native-runner-smoke:${sessionId}`
    }
  });
  if (!fulfill.response.ok) throw new Error(`fulfill_failed:${fulfill.response.status}:${JSON.stringify(fulfill.data)}`);

  const receiptProof = buildPopProof({
    keyPair,
    session: checkpoint.data.session,
    action: 'read_public_page',
    targetUrl: 'https://example.com'
  });
  const receipt = await request(`/mission-auth/sessions/${encodeURIComponent(sessionId)}/receipts`, {
    method: 'POST',
    cookie,
    body: {
      action: 'read_public_page',
      targetUrl: 'https://example.com',
      proofOfPossession: receiptProof,
      generateProof: inlineProof,
      prepareAnchor: inlineProof,
      network
    }
  });
  if (!receipt.response.ok) throw new Error(`receipt_failed:${receipt.response.status}:${JSON.stringify(receipt.data)}`);
  if (!receipt.data.zkProof && !receipt.data.executionVerification) {
    throw new Error('receipt_missing_execution_verification_queue');
  }

  let anchorSubmission = null;
  if (submitAnchor) {
    const anchorId = receipt.data.executionVerification?.anchorSubmissionId;
    if (!anchorId) throw new Error('receipt_missing_queued_anchor_submission');
    const deadline = Date.now() + anchorTimeoutMs;
    while (Date.now() < deadline) {
      const status = await requestWithRetry(`/anchors/status/${encodeURIComponent(anchorId)}`, { cookie });
      if (!status.response.ok) throw new Error(`anchor_status_failed:${status.response.status}:${JSON.stringify(status.data)}`);
      anchorSubmission = status.data.submission || null;
      if (anchorSubmission?.status === 'submitted' && anchorSubmission.txHash) break;
      if (anchorSubmission?.status === 'failed') {
        throw new Error('anchor_failed_before_submission');
      }
      await sleep(1_000);
    }
    if (anchorSubmission?.status !== 'submitted' || !anchorSubmission?.txHash) {
      throw new Error('anchor_submission_timeout');
    }
  }

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    email,
    sessionId,
    receiptId: receipt.data.receipt.id,
    statementHash: anchorSubmission?.anchorPayload?.statementHash || anchorSubmission?.zkProofSummary?.statementHash || null,
    proofMode: receipt.data.proofMode || (inlineProof ? 'inline' : 'queued'),
    proofGenerated: Boolean(anchorSubmission?.zkProofSummary?.proofVerified),
    anchorPrepared: Boolean(anchorSubmission?.anchorPayload),
    executionVerification: receipt.data.executionVerification || null,
    anchorSubmitted: Boolean(anchorSubmission),
    anchorSubmission
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
