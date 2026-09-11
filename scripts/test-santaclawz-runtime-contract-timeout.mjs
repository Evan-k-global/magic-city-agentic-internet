import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

function extractFunctionSource(name) {
  const start = server.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const declarationStart = server.lastIndexOf('\n', start) + 1;
  const paramsStart = server.indexOf('(', start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < server.length; index += 1) {
    if (server[index] === '(') paramsDepth += 1;
    if (server[index] === ')') paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  const braceStart = server.indexOf('{', paramsEnd);
  let depth = 0;
  for (let index = braceStart; index < server.length; index += 1) {
    if (server[index] === '{') depth += 1;
    if (server[index] === '}') depth -= 1;
    if (depth === 0) return server.slice(declarationStart, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function abortError() {
  const error = new Error('This operation was aborted');
  error.name = 'AbortError';
  return error;
}

function createContext(requestSantaClawzJson) {
  const delays = [];
  const context = {
    encodeURIComponent,
    requestSantaClawzJson,
    setTimeout(callback, delay) {
      delays.push(delay);
      callback();
      return 1;
    },
    createHttpError(message, statusCode = 500, options = {}) {
      return Object.assign(new Error(message), { statusCode, ...options });
    },
    assertApprovedSantaClawzAgent(agentId) {
      return String(agentId).replace(/^santaclawz:/, '');
    },
    externalSantaClawzAgentId(agentId) {
      return String(agentId || '').replace(/^santaclawz:/, '');
    },
    validateSantaClawzRuntimeContract({ ready, x402Plan }) {
      return ready?.ready === true && x402Plan?.payment
        ? { ok: true, agentId: ready.agentId }
        : { ok: false, reason: 'invalid_runtime_contract' };
    },
    jsonDigestSha256(value) {
      return JSON.stringify(value);
    },
    delays
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunctionSource('isSantaClawzRequestTimeout'),
    extractFunctionSource('isSantaClawzRetryableRuntimeReadFailure'),
    extractFunctionSource('isSantaClawzRuntimeContractReadFailure'),
    extractFunctionSource('santaClawzRuntimeReadRetryDelayMs'),
    extractFunctionSource('retainedSantaClawzRuntimeContract'),
    extractFunctionSource('requestSantaClawzRuntimeContractPart'),
    extractFunctionSource('fetchSantaClawzRuntimeContract')
  ].join('\n\n'), context);
  return context;
}

{
  const context = createContext(async () => {
    throw new Error('unexpected network read');
  });
  const prepared = {
    agentId: 'santaclawz:code-audit',
    runtimeContract: {
      checkedAt: '2026-09-09T12:00:00.000Z',
      staleAt: '2026-09-09T12:02:00.000Z',
      readyDigestSha256: 'ready-digest',
      planDigestSha256: 'plan-digest',
      expected: { grossAtomic: '100000' }
    }
  };
  assert.equal(
    context.retainedSantaClawzRuntimeContract(prepared, 'code-audit', Date.parse('2026-09-09T12:01:00.000Z'))?.expected?.grossAtomic,
    '100000',
    'a fresh prepared contract should remain usable for the same agent'
  );
  assert.equal(
    context.retainedSantaClawzRuntimeContract(prepared, 'another-agent', Date.parse('2026-09-09T12:01:00.000Z')),
    null,
    'a prepared contract must not cross agent identities'
  );
  assert.equal(
    context.retainedSantaClawzRuntimeContract(prepared, 'code-audit', Date.parse('2026-09-09T12:02:00.000Z')),
    null,
    'an expired prepared contract must be re-fetched before payment'
  );
}

function coldPlanReadError() {
  return Object.assign(new Error('x402_plan_cold_read_timeout'), {
    statusCode: 503,
    payload: {
      schemaVersion: 'santaclawz-x402-plan/1.0',
      ok: false,
      code: 'x402_plan_temporarily_unavailable',
      retryable: true,
      recommendedPollAfterMs: 2000,
      error: 'x402_plan_cold_read_timeout'
    }
  });
}

{
  const context = createContext(async () => {
    throw new Error('unexpected request');
  });
  const exhaustedRead = Object.assign(new Error('santaclawz_runtime_x402_plan_timeout'), { statusCode: 503 });
  assert.equal(context.isSantaClawzRequestTimeout(exhaustedRead), false, 'the outer preflight must not stack another retry');
  assert.equal(context.isSantaClawzRuntimeContractReadFailure(exhaustedRead), true, 'the UI should still report a retry-safe read failure');
}

{
  const calls = { ready: 0, plan: 0 };
  const context = createContext(async (endpoint) => {
    if (endpoint.endsWith('/ready')) {
      calls.ready += 1;
      if (calls.ready === 1) throw abortError();
      return { payload: { ready: true, agentId: 'code-audit' } };
    }
    calls.plan += 1;
    return { payload: { payment: { amount: '0.10' } } };
  });
  const contract = await context.fetchSantaClawzRuntimeContract('santaclawz:code-audit');
  assert.equal(contract.ok, true);
  assert.deepEqual(calls, { ready: 2, plan: 1 }, 'only the timed-out read-only endpoint should retry');
}

{
  const calls = { ready: 0, plan: 0 };
  const context = createContext(async (endpoint) => {
    if (endpoint.endsWith('/ready')) {
      calls.ready += 1;
      return { payload: { ready: true, agentId: 'code-audit' } };
    }
    calls.plan += 1;
    if (calls.plan === 1) throw coldPlanReadError();
    return { payload: { payment: { amount: '0.10' } } };
  });
  const contract = await context.fetchSantaClawzRuntimeContract('santaclawz:code-audit');
  assert.equal(contract.ok, true);
  assert.deepEqual(calls, { ready: 1, plan: 2 }, 'only the temporarily unavailable plan endpoint should retry');
  assert.deepEqual(context.delays, [2000], 'the structured retry guidance should bound the retry delay');
}

{
  const calls = { ready: 0, plan: 0 };
  const context = createContext(async (endpoint) => {
    if (endpoint.endsWith('/ready')) {
      calls.ready += 1;
      return { payload: { ready: true, agentId: 'code-audit' } };
    }
    calls.plan += 1;
    throw Object.assign(new Error('santaclawz_payment_contract_mismatch'), {
      statusCode: 503,
      payload: { code: 'santaclawz_payment_contract_mismatch', retryable: false }
    });
  });
  await assert.rejects(
    context.fetchSantaClawzRuntimeContract('santaclawz:code-audit'),
    /santaclawz_payment_contract_mismatch/
  );
  assert.deepEqual(calls, { ready: 1, plan: 1 }, 'permanent contract failures must not be retried');
}

{
  const calls = { ready: 0, plan: 0, hire: 0 };
  const paymentRequirement = { requestId: 'hire-request-1', accepts: [{ amount: '100000' }] };
  const context = createContext(async (endpoint, options = {}) => {
    if (endpoint.endsWith('/ready')) {
      calls.ready += 1;
      return { payload: { ready: true, agentId: 'code-audit' } };
    }
    if (endpoint.endsWith('/x402-plan')) {
      calls.plan += 1;
      if (calls.plan === 1) throw coldPlanReadError();
      return { payload: { payment: { amount: '0.10' } } };
    }
    assert.equal(options.method, 'POST');
    calls.hire += 1;
    return { status: 402, source: { apiBase: 'https://santaclawz.example' }, payload: { paymentRequirement } };
  });
  Object.assign(context, {
    isSantaClawzConciergeConfigured: () => false,
    prepareSantaClawzConciergeX402ForSession: () => {
      throw new Error('unexpected concierge path');
    },
    buildSantaClawzTaskPromptForSession: () => 'Audit the repository.',
    buildSantaClawzRequesterContact: () => 'buyer@example.com',
    assertSantaClawzJobContextReadyForSession: async () => ({ githubUrls: ['https://github.com/example/repo'] }),
    buildSantaClawzJobPrivacyForSession: () => ({ visibility: 'public' }),
    buildSantaClawzHireBody: ({ taskPrompt, requesterContact, jobContext, jobPrivacy }) => ({
      taskPrompt,
      requesterContact,
      jobContext,
      jobPrivacy
    }),
    validateSantaClawzHireInputContract: () => ({ ok: true }),
    buildMissionCapability: () => ({ audience: 'magic_city_santaclawz_hire_orchestrator' }),
    findSantaClawzX402PaymentRequirement: (payload) => payload.paymentRequirement,
    validateSantaClawzPaymentRequirement: (requirement) => ({ ok: requirement === paymentRequirement }),
    sanitizeMetadata: (value) => value,
    buildExecutionTaskPackage: () => ({ title: 'Code audit' }),
    updateConnectorSession: (_id, patch) => ({ id: 'cs-test', ...patch }),
    describeSantaClawzPaymentRequirement: () => ({ grossAtomic: '100000' }),
    formatMissionCapabilityForApi: (value) => value,
    resolveZekoNetworkLabel: () => 'zeko:sepolia',
    resolveSantaClawzProofNetworkLabel: () => 'ethereum:sepolia'
  });
  vm.runInContext(extractFunctionSource('prepareSantaClawzDirectX402ForSessionOnce'), context);
  const prepared = await context.prepareSantaClawzDirectX402ForSessionOnce({
    req: {},
    authUser: {},
    session: { id: 'cs-test', preferredExecutionAgentId: 'santaclawz:code-audit' }
  });
  assert.equal(prepared.paymentRequirement, paymentRequirement);
  assert.equal(prepared.directPayment.status, 'payment_required');
  assert.deepEqual(calls, { ready: 1, plan: 2, hire: 1 });
}

{
  const calls = { ready: 0, plan: 0 };
  const context = createContext(async (endpoint) => {
    if (endpoint.endsWith('/ready')) {
      calls.ready += 1;
      throw abortError();
    }
    calls.plan += 1;
    return { payload: { payment: { amount: '0.10' } } };
  });
  await assert.rejects(
    context.fetchSantaClawzRuntimeContract('santaclawz:code-audit'),
    (error) => error?.message === 'santaclawz_runtime_ready_timeout' && error?.statusCode === 503
  );
  assert.deepEqual(calls, { ready: 2, plan: 1 });
}

const startRouteStart = server.indexOf("if (req.method === 'POST' && /^\\/connectors\\/sessions\\/[^/]+\\/start-execution$/.test(urlPath))");
assert.ok(startRouteStart >= 0, 'start-execution route must exist');
const startRouteEnd = server.indexOf("\n    if (req.method ===", startRouteStart + 20);
const startRoute = server.slice(startRouteStart, startRouteEnd > startRouteStart ? startRouteEnd : undefined);
const savedInputIndex = startRoute.indexOf('const sessionWithSavedPublicInputs = updateConnectorSession');
const preflightIndex = startRoute.indexOf('await fetchSantaClawzRuntimeContract');
assert.ok(savedInputIndex >= 0, 'start-execution must save public inputs');
assert.equal(preflightIndex, -1, 'start-execution must not duplicate the runtime contract preparation read');
assert.match(startRoute.slice(savedInputIndex), /finalSelections:\s*selections/);

console.log('santaclawz runtime contract timeout regression passed');
