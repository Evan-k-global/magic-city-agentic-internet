import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function extractFunctionSource(name) {
  const functionStart = html.indexOf(`function ${name}`);
  assert.notEqual(functionStart, -1, `missing inline function ${name}`);
  const asyncStart = functionStart >= 6 && html.slice(functionStart - 6, functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  const start = asyncStart;
  const signatureEnd = html.indexOf(') {', start);
  assert.notEqual(signatureEnd, -1, `missing function body for ${name}`);
  const braceStart = html.indexOf('{', signatureEnd);
  let depth = 0;
  for (let index = braceStart; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`unterminated inline function ${name}`);
}

const selectedAgent = {
  pluginId: 'santaclawz:hosted-code-audit-agent',
  metadata: { source: 'santaclawz' }
};
const preparedSession = {
  id: 'cs-santaclawz-start-recovery',
  status: 'confirmed',
  handoffData: { kind: 'agent', selectedAgent },
  preferredExecutionAgentId: selectedAgent.pluginId
};

const createContext = (apiSession) => {
  const rememberedErrors = [];
  const clearedErrors = [];
  const polledSessions = [];
  const context = {
    executionSessionCache: new Map([[preparedSession.id, preparedSession]]),
    executionPendingSessions: new Set([preparedSession.id]),
    api: async () => ({ session: apiSession }),
    clearExecutionStatusError: (sessionId) => clearedErrors.push(sessionId),
    syncExecutionProtocolPollingSession: (session) => polledSessions.push(session),
    rememberExecutionStatusError: (session, error) => rememberedErrors.push({ session, error }),
    ensureExecutionPolling: () => {},
    renderExecutionSheet: async () => {},
    refreshExecutionPanelInPlace: () => true
  };
  vm.createContext(context);
  vm.runInContext([
    extractFunctionSource('santaClawzExecutionHasStarted'),
    extractFunctionSource('reconcileAgentExecutionStartFailure')
  ].join('\n'), context);
  return { context, rememberedErrors, clearedErrors, polledSessions };
};

{
  const { context, rememberedErrors, clearedErrors } = createContext(preparedSession);
  const error = Object.assign(new Error('network_request_failed'), {
    path: `/connectors/sessions/${preparedSession.id}/start-execution`,
    status: 0,
    requestId: 'req-unstarted'
  });
  await context.reconcileAgentExecutionStartFailure(preparedSession, error);
  assert.equal(context.executionPendingSessions.has(preparedSession.id), false);
  assert.equal(rememberedErrors.length, 1, 'a confirmed unstarted request must retain its diagnostic');
  assert.equal(rememberedErrors[0].error.requestId, 'req-unstarted');
  assert.equal(clearedErrors.length, 0);
}

{
  const acceptedSession = {
    ...preparedSession,
    status: 'executing',
    completionRequestedAt: '2026-09-09T23:49:12.000Z',
    creditReservation: { status: 'locked' },
    santaclawzDirectPayment: {
      status: 'submission_unknown',
      paymentPayloadDigestSha256: 'a'.repeat(64)
    }
  };
  const { context, rememberedErrors, clearedErrors, polledSessions } = createContext(acceptedSession);
  await context.reconcileAgentExecutionStartFailure(preparedSession, new Error('network_request_failed'));
  assert.equal(rememberedErrors.length, 0, 'an accepted run must not be relabeled as an unstarted failure');
  assert.deepEqual(clearedErrors, [preparedSession.id]);
  assert.equal(polledSessions.length, 1, 'an accepted response-loss recovery must resume status polling');
  assert.equal(context.executionSessionCache.get(preparedSession.id).status, 'executing');
}

const fallbackStart = html.slice(
  html.indexOf('async function startAgentExecutionFromFallback'),
  html.indexOf('\n    function buildLocalCheckoutProfile', html.indexOf('async function startAgentExecutionFromFallback'))
);
const startRequestIndex = fallbackStart.indexOf('/start-execution');
assert.ok(startRequestIndex > 0, 'fallback start request must exist');
assert.doesNotMatch(
  fallbackStart.slice(0, startRequestIndex),
  /await renderExecutionSheet/,
  'SantaClawz submission must not wait for a widget render'
);
assert.match(fallbackStart, /reconcileAgentExecutionStartFailure\(session, error\)/);
const fallbackDraftIndex = fallbackStart.indexOf('executionDraftCache.set(session.id, { selections, localPrivateInputs })');
assert.ok(fallbackDraftIndex >= 0 && fallbackDraftIndex < startRequestIndex, 'fallback start must retain its draft before preflight');
const fallbackClearIndex = fallbackStart.indexOf('clearExecutionDraft(session.id)');
assert.ok(fallbackClearIndex > startRequestIndex, 'fallback start must clear its draft only after success');

const sheetStart = html.slice(
  html.indexOf('const startExecutionFromSheet = async () =>'),
  html.indexOf('const resumeCheckoutReconcileFromSheet = async () =>', html.indexOf('const startExecutionFromSheet = async () =>'))
);
const sheetStartRequestIndex = sheetStart.indexOf('/start-execution');
const sheetDraftIndex = sheetStart.indexOf('executionDraftCache.set(session.id, { selections, localPrivateInputs })');
const sheetClearIndex = sheetStart.indexOf('clearExecutionDraft(session.id)');
assert.ok(sheetDraftIndex >= 0 && sheetDraftIndex < sheetStartRequestIndex, 'sheet start must retain its draft before preflight');
assert.ok(sheetClearIndex > sheetStartRequestIndex, 'sheet start must clear its draft only after success');

{
  const errorContext = {
    normalizeApiErrorCode(value) {
      return String(value || '');
    }
  };
  vm.createContext(errorContext);
  vm.runInContext(extractFunctionSource('normalizeExecutionErrorMessage'), errorContext);
  assert.match(
    errorContext.normalizeExecutionErrorMessage({
      message: 'santaclawz_runtime_ready_timeout',
      data: { error: 'santaclawz_runtime_ready_timeout' }
    }),
    /readiness check in time.*No payment was submitted/i
  );
  assert.match(
    errorContext.normalizeExecutionErrorMessage({
      message: 'santaclawz_runtime_x402_plan_timeout',
      data: { error: 'santaclawz_runtime_x402_plan_timeout' }
    }),
    /payment contract in time.*No payment was submitted/i
  );
}

console.log('santaclawz start recovery UI regression passed');
