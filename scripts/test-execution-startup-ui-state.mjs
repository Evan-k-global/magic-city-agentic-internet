import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function extractFunctionSource(name) {
  const start = html.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing inline function ${name}`);
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

const context = {
  RUNNER_EXTENSION_PLUGIN_ID: 'magic-city-runner-extension',
  executionLocalErrors: new Map(),
  executionLocalRunnerProgress: new Map(),
  executionSessionCache: new Map(),
  executionPendingSessions: new Set(),
  requestAnimationFrame: (callback) => callback(),
  refreshExecutionPanelInPlace: () => true,
  isTerminalExecutionStatus: (status) => ['fulfilled', 'failed'].includes(String(status || '').toLowerCase()),
  isAwaitingExecutionConfirmation: () => false,
  sessionHasBrowserOrderSubmitted: () => false,
  compactExecutionSentence: (value) => String(value || '').trim()
};
vm.createContext(context);
vm.runInContext([
  extractFunctionSource('executionLocalErrorApplies'),
  extractFunctionSource('clearExecutionStatusError'),
  extractFunctionSource('reconcileExecutionWakeError'),
  extractFunctionSource('runnerProgressLabel'),
  extractFunctionSource('rememberExecutionRunnerProgress'),
  extractFunctionSource('getExecutionStatusModel'),
  extractFunctionSource('describeExecutionRunState')
].join('\n'), context);

const sessionId = 'cs-ui-startup-rejection';
const rejectedAt = '2026-09-08T20:00:30.000Z';
const queuedSession = {
  id: sessionId,
  status: 'queued',
  handoffData: { kind: 'browser' },
  extensionRunDispatch: { expiresAt: '2099-01-01T00:00:00.000Z' }
};
context.executionPendingSessions.add(sessionId);
context.executionLocalErrors.set(sessionId, {
  code: 'extension_wake_rejected:claim_failed',
  message: 'Magic City Runner did not start this mission: claim_failed.',
  createdAt: rejectedAt
});

const rejectedStatus = context.getExecutionStatusModel(queuedSession);
assert.equal(rejectedStatus.statusValue, 'failed', 'a confirmed wake rejection must override queued and locally pending state');
assert.equal(rejectedStatus.label, 'Runner needed');
const rejectedRunState = context.describeExecutionRunState(
  queuedSession,
  rejectedStatus,
  '',
  context.executionLocalErrors.get(sessionId)
);
assert.equal(rejectedRunState.title, 'Runner did not start');
assert.equal(rejectedRunState.actionLabel, 'Retry runner start');
assert.equal(
  !['queued', 'claimed', 'executing', 'fulfilled'].includes(rejectedStatus.statusValue),
  true,
  'the failed presentation must enable the existing browser retry control'
);

const staleClaim = {
  ...queuedSession,
  status: 'claimed',
  claimedAt: '2026-09-08T20:00:20.000Z'
};
assert.equal(context.getExecutionStatusModel(staleClaim).statusValue, 'failed', 'an older claim must not erase a newer rejection');
assert.equal(context.executionLocalErrors.has(sessionId), true);

const recoveredSession = {
  ...queuedSession,
  status: 'claimed',
  claimedAt: '2026-09-08T20:00:31.000Z'
};
const recoveredStatus = context.getExecutionStatusModel(recoveredSession);
assert.equal(recoveredStatus.statusValue, 'claimed');
assert.equal(recoveredStatus.label, 'Running');
assert.equal(context.executionLocalErrors.has(sessionId), false, 'a newer successful claim must clear the obsolete wake rejection');

context.executionLocalErrors.set(sessionId, {
  code: 'extension_wake_rejected:claim_failed',
  message: 'Magic City Runner did not start this mission: claim_failed.',
  createdAt: rejectedAt
});
const checkpointRecoveredSession = {
  ...queuedSession,
  status: 'executing',
  executionTrace: [{
    pluginId: 'magic-city-runner-extension',
    label: 'Opening browser',
    createdAt: '2026-09-08T20:00:32.000Z'
  }]
};
assert.equal(context.getExecutionStatusModel(checkpointRecoveredSession).statusValue, 'executing');
assert.equal(context.executionLocalErrors.has(sessionId), false, 'a newer Runner checkpoint must also clear the obsolete rejection');

assert.equal(context.rememberExecutionRunnerProgress(sessionId, {
  streamId: 'worker-a',
  sequence: 2,
  at: '2026-09-08T20:00:33.000Z',
  activeRun: { sessionId, progressLabel: 'Opening Amazon', progressState: 'opening_browser' }
}), true);
assert.equal(context.executionLocalRunnerProgress.get(sessionId).label, 'Opening Amazon');
assert.equal(context.rememberExecutionRunnerProgress(sessionId, {
  streamId: 'worker-a',
  sequence: 1,
  at: '2026-09-08T20:00:34.000Z',
  activeRun: { sessionId, progressLabel: 'Claiming mission', progressState: 'claiming' }
}), false, 'an older sequence from the same worker must not move progress backward');
assert.equal(context.executionLocalRunnerProgress.get(sessionId).label, 'Opening Amazon');
assert.equal(context.rememberExecutionRunnerProgress(sessionId, {
  streamId: 'worker-b',
  sequence: 1,
  at: '2026-09-08T20:00:32.000Z',
  activeRun: { sessionId, progressLabel: 'Starting Runner', progressState: 'wake_received' }
}), false, 'an older replacement worker message must not overwrite newer progress');

assert.match(
  html,
  /runState\.title === 'Runner did not start'[\s\S]*'Retry runner start'/,
  'the recovered failure state must label the retry control'
);
assert.match(
  html,
  /closest\?\.\('\[data-execution-run-agent="true"\]'\)[\s\S]*startExecutionFromSheet\(\)/,
  'the Runner startup retry must invoke the execution start handler'
);
assert.match(
  html,
  /runtime\.connect\(extensionId, \{ name: 'magic-city-active-run-v1' \}\)[\s\S]*RUNNER_PROGRESS[\s\S]*RUNNER_RESULT/,
  'a website-started mission must keep a live progress channel through the extension result'
);
assert.match(
  html,
  /type: 'RUN_PENDING_SESSIONS',[\s\S]*extensionDispatchNonce/,
  'the website wake must pass the exact signed dispatch nonce for direct claim'
);

console.log('execution startup UI state ok');
