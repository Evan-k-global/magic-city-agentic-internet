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
  const context = {
    encodeURIComponent,
    requestSantaClawzJson,
    setTimeout(callback) {
      callback();
      return 1;
    },
    createHttpError(message, statusCode = 500, options = {}) {
      return Object.assign(new Error(message), { statusCode, ...options });
    },
    assertApprovedSantaClawzAgent(agentId) {
      return String(agentId).replace(/^santaclawz:/, '');
    },
    validateSantaClawzRuntimeContract({ ready, x402Plan }) {
      return ready?.ready === true && x402Plan?.payment
        ? { ok: true, agentId: ready.agentId }
        : { ok: false, reason: 'invalid_runtime_contract' };
    },
    jsonDigestSha256(value) {
      return JSON.stringify(value);
    }
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunctionSource('isSantaClawzRequestTimeout'),
    extractFunctionSource('requestSantaClawzRuntimeContractPart'),
    extractFunctionSource('fetchSantaClawzRuntimeContract')
  ].join('\n\n'), context);
  return context;
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
assert.ok(preflightIndex > savedInputIndex, 'public inputs must be durable before SantaClawz preflight');
assert.match(startRoute.slice(savedInputIndex, preflightIndex), /finalSelections:\s*selections/);

console.log('santaclawz runtime contract timeout regression passed');
