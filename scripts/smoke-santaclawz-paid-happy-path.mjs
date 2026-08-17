const baseUrl = process.env.MAGIC_CITY_BASE_URL || 'https://magic-city-staging.fly.dev';
const agentId = 'santaclawz:hosted-code-audit-agent--session_agent_0e86fd7829bd';
const now = Date.now();
const email = `santaclawz-paid-smoke-${now}@example.test`;
const passphrase = `santaclawz-paid-smoke-${now}`;
let cookie = '';

async function request(path, { method = 'GET', body, expectOk = true } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const setCookieValues = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const liveSessionCookie = setCookieValues
    .flatMap((value) => Array.from(String(value || '').matchAll(/magic_city_session=([^;,\s]+)/g)))
    .map((match) => match[1])
    .filter(Boolean)
    .at(-1);
  if (liveSessionCookie) cookie = `magic_city_session=${liveSessionCookie}`;
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (expectOk && !response.ok) {
    throw new Error(`${path}:${response.status}:${data.error || data.message || text.slice(0, 240)}`);
  }
  return { response, data };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const auth = await request('/auth/register', {
  method: 'POST',
  body: { email, passphrase, displayName: 'SantaClawz paid smoke' }
});
const requesterId = auth.data.user?.requesterId || email;
const claim = await request('/billing/credits/bootstrap', {
  method: 'POST',
  body: { requesterId }
});
if (Number(claim.data.grantedCredits || 0) < 10) throw new Error('daily_credit_claim_too_small');

const selectedAgent = {
  pluginId: agentId,
  agentId,
  agentName: 'Code Audit Agent',
  price: 0.1,
  creditPrice: 10,
  paymentRequired: true,
  paymentRail: 'base_usdc_x402',
  publicHireUrl: 'https://www.santaclawz.ai/api/agents/hosted-code-audit-agent--session_agent_0e86fd7829bd/hire',
  metadata: {
    source: 'santaclawz',
    label: 'Code Audit Agent',
    description: 'LLM-backed code audit agent that reviews submitted code and returns buyer-visible findings.',
    hireable: true,
    price: 0.1,
    paymentRequired: true,
    paymentRail: 'base_usdc_x402'
  }
};
const repoUrl = process.env.CODE_AUDIT_REPO_URL || 'https://github.com/zeko-labs/santa_clawz-private_agents';
const started = await request('/connectors/sessions/start', {
  method: 'POST',
  body: {
    capability: 'agent-execution',
    prompt: `Audit ${repoUrl} for security and correctness. Return concise prioritized findings.`,
    preferredExecutionAgentId: agentId,
    selectedAgent
  }
});
const sessionId = started.data.session?.id;
if (!sessionId) throw new Error('missing_session_id');
const selections = {
  preferredExecutionAgentId: agentId,
  santaclawzPaymentPreference: 'credits',
  maxCreditApproval: 10,
  agentInputs: {
    githubUrl: repoUrl,
    auditFocus: 'Security, correctness, replay safety, and concrete prioritized fixes.'
  }
};
const run = await request(`/connectors/sessions/${encodeURIComponent(sessionId)}/start-execution`, {
  method: 'POST',
  body: { mode: 'agent_checkout', requesterId, selections, localPrivateInputs: {} }
});
if (run.data.session?.creditReservation?.status !== 'locked') {
  throw new Error(`credits_not_locked:${run.data.session?.creditReservation?.status || 'missing'}`);
}

const submitted = await request(`/connectors/sessions/${encodeURIComponent(sessionId)}/santaclawz-credit-backed/submit`, {
  method: 'POST',
  body: { selections, localPrivateInputs: {}, agentId }
});
const firstDigest = submitted.data.directPayment?.paymentPayloadDigestSha256;
if (!firstDigest) throw new Error('missing_payment_digest');

const replay = await request(`/connectors/sessions/${encodeURIComponent(sessionId)}/santaclawz-credit-backed/submit`, {
  method: 'POST',
  body: { selections, localPrivateInputs: {}, agentId }
});
if (!replay.data.alreadySubmitted) throw new Error('duplicate_submit_was_not_deduplicated');
const replayDigest = replay.data.directPayment?.paymentPayloadDigestSha256;
if (replayDigest !== firstDigest) throw new Error('duplicate_submit_changed_payment_digest');

let terminal = replay.data.session || submitted.data.session;
for (let attempt = 0; attempt < 90 && !['fulfilled', 'failed'].includes(String(terminal?.status || '')); attempt += 1) {
  await sleep(Math.min(10_000, 2000 + attempt * 250));
  const current = await request(`/connectors/sessions/${encodeURIComponent(sessionId)}`);
  terminal = current.data.session;
}
if (terminal?.status !== 'fulfilled') {
  const directPayment = terminal?.santaclawzDirectPayment || {};
  console.error(JSON.stringify({
    ok: false,
    sessionId,
    status: terminal?.status || null,
    requestId: directPayment.submittedRequestId || null,
    paymentPayloadDigestSha256: directPayment.paymentPayloadDigestSha256 || firstDigest || null,
    creditReservationStatus: terminal?.creditReservation?.status || null,
    failureReason: directPayment.summary?.failureReason || directPayment.lastStatusError || null,
    protocolState: directPayment.summary?.protocolState || null,
    paymentStatus: directPayment.summary?.paymentStatus || null,
    settlementStatus: directPayment.summary?.settlementStatus || null,
    agentExecutionStatus: directPayment.summary?.agentExecutionStatus || null,
    safeToCreateFreshPayment: directPayment.summary?.safeToCreateFreshPayment ?? null
  }, null, 2));
  throw new Error(`paid_execution_not_fulfilled:${terminal?.status}:${terminal?.santaclawzDirectPayment?.lastStatusError || ''}`);
}
const delivery = terminal.santaclawzDirectPayment?.delivery || terminal.fulfillment?.result?.santaclawzDelivery || {};
const outputCount = Number(delivery.inlineOutputs?.length || 0) + Number(delivery.artifacts?.length || 0);
if (!outputCount) throw new Error('buyer_visible_output_missing');
if (terminal.creditReservation?.status !== 'settled') {
  throw new Error(`credit_reservation_not_settled:${terminal.creditReservation?.status || 'missing'}`);
}

console.log(JSON.stringify({
  ok: true,
  sessionId,
  requestId: terminal.santaclawzDirectPayment?.submittedRequestId || null,
  paymentPayloadDigestSha256: firstDigest,
  paymentStatus: terminal.santaclawzDirectPayment?.summary?.paymentStatus || null,
  settlementStatus: terminal.santaclawzDirectPayment?.summary?.settlementStatus || null,
  agentExecutionStatus: terminal.santaclawzDirectPayment?.summary?.agentExecutionStatus || null,
  inlineOutputCount: delivery.inlineOutputs?.length || 0,
  artifactCount: delivery.artifacts?.length || 0,
  duplicateSubmitDeduped: true,
  credits: terminal.creditReservation?.requiredCredits || 10
}, null, 2));
