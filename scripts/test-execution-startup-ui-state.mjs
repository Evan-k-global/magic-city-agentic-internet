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

let executionRenderCount = 0;
const context = {
  RUNNER_EXTENSION_PLUGIN_ID: 'magic-city-runner-extension',
  executionLocalErrors: new Map(),
  executionLocalRunnerProgress: new Map(),
  executionSessionCache: new Map(),
  executionPendingSessions: new Set(),
  executionUiStartSessions: new Set(),
  executionRunHandlers: new Map(),
  executionCollapsedSessions: new Set(),
  executionMissionTabFocusIntents: new Map(),
  activeExecutionSessionId: null,
  renderExecutionDock: () => {
    executionRenderCount += 1;
  },
  requestAnimationFrame: (callback) => callback(),
  refreshExecutionPanelInPlace: () => true,
  isTerminalExecutionStatus: (status) => ['fulfilled', 'failed'].includes(String(status || '').toLowerCase()),
  isExecutionSessionDurablyCancelled: () => false,
  isAwaitingExecutionConfirmation: () => false,
  sessionHasBrowserOrderSubmitted: () => false,
  hasReadySantaClawzDelivery: () => false,
  hasPendingSantaClawzDeliveryVerification: () => false,
  getSantaClawzExecutionProgress: () => null,
  compactExecutionSentence: (value) => String(value || '').trim()
};
vm.createContext(context);
vm.runInContext([
  extractFunctionSource('executionLocalErrorApplies'),
  extractFunctionSource('clearExecutionStatusError'),
  extractFunctionSource('markExecutionStartButtonStarting'),
  extractFunctionSource('getExecutionRunButtonSessionId'),
  extractFunctionSource('setExecutionRunControlsStarting'),
  extractFunctionSource('resetExecutionRunControls'),
  `async ${extractFunctionSource('startExecutionSessionFromControl')}`,
  extractFunctionSource('reconcileExecutionWakeError'),
  extractFunctionSource('runnerProgressLabel'),
  extractFunctionSource('rememberExecutionRunnerProgress'),
  extractFunctionSource('requestNativeRunnerMissionTabFocus'),
  extractFunctionSource('getExecutionStatusModel'),
  extractFunctionSource('describeExecutionRunState'),
  extractFunctionSource('openExecutionPanel')
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
const connectingStatus = context.getExecutionStatusModel(queuedSession);
assert.equal(connectingStatus.statusValue, 'executing');
assert.equal(connectingStatus.label, 'Connecting Runner');
const connectingRunState = context.describeExecutionRunState(queuedSession, connectingStatus);
assert.equal(connectingRunState.title, 'Connecting Runner');
assert.equal(connectingRunState.detail, 'Claiming this mission, then opening Amazon.');
assert.equal(connectingRunState.badgeLabel, 'Claiming');
context.executionPendingSessions.delete(sessionId);

context.executionCollapsedSessions.add(sessionId);
context.openExecutionPanel(sessionId);
assert.equal(context.activeExecutionSessionId, sessionId);
assert.equal(context.executionCollapsedSessions.has(sessionId), false);
assert.equal(executionRenderCount, 1);

const makeRunButton = () => {
  const classes = new Set();
  const attributes = new Map();
  return {
    disabled: false,
    textContent: 'Run agent',
    dataset: { executionRunSession: sessionId },
    classList: {
      add(value) { classes.add(value); },
      remove(value) { classes.delete(value); }
    },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    classes,
    attributes
  };
};
const topRunButton = makeRunButton();
const lowerRunButton = makeRunButton();
let activeRunButtons = [topRunButton, lowerRunButton];
context.getExecutionSheetScrollElement = () => ({
  querySelectorAll: () => activeRunButtons
});
context.renderExecutionSheet = async () => {};
context.executionSessionCache.set(sessionId, queuedSession);
let manualStartCount = 0;
context.executionRunHandlers.set(sessionId, async () => {
  manualStartCount += 1;
});
assert.equal(context.getExecutionRunButtonSessionId(topRunButton), sessionId);
assert.equal(await context.startExecutionSessionFromControl(sessionId, topRunButton), true);
assert.equal(manualStartCount, 1, 'one manual click must invoke exactly one session-bound start');
assert.equal(topRunButton.disabled, true);
assert.equal(lowerRunButton.disabled, true, 'both visible Run controls must enter the same busy state');
assert.equal(topRunButton.textContent, 'Connecting...');
assert.equal(lowerRunButton.textContent, 'Connecting...');

const retryTopRunButton = makeRunButton();
const retryLowerRunButton = makeRunButton();
activeRunButtons = [retryTopRunButton, retryLowerRunButton];
context.executionRunHandlers.delete(sessionId);
let handlerLoadCount = 0;
let retryStartCount = 0;
let loadingFailureMessage = '';
context.setExecutionStatusError = (_session, error) => {
  loadingFailureMessage = error.message;
};
context.renderExecutionSheet = async () => {
  handlerLoadCount += 1;
  if (handlerLoadCount === 1) throw new Error('simulated widget load failure');
  context.executionRunHandlers.set(sessionId, async () => {
    retryStartCount += 1;
  });
};
assert.equal(await context.startExecutionSessionFromControl(sessionId, retryTopRunButton), false);
assert.equal(retryStartCount, 0, 'a failed handler load must never replay execution automatically');
assert.equal(retryTopRunButton.disabled, false);
assert.equal(retryLowerRunButton.disabled, false);
assert.equal(retryTopRunButton.textContent, 'Run agent');
assert.equal(retryLowerRunButton.textContent, 'Run agent');
assert.match(loadingFailureMessage, /inputs are still saved.*Run agent to retry/i);
assert.equal(await context.startExecutionSessionFromControl(sessionId, retryLowerRunButton), true);
assert.equal(retryStartCount, 1, 'one explicit retry must start exactly once');

const dockListeners = [];
let delegatedSessionId = '';
const delegatedButton = { disabled: false };
const dock = {
  dataset: {},
  innerHTML: '',
  addEventListener(type, handler) {
    if (type === 'click') dockListeners.push(handler);
  },
  contains(candidate) { return candidate === delegatedButton; }
};
const dockContext = {
  executionSessionOrder: [],
  $: (id) => id === 'executionDock'
    ? dock
    : id === 'executionSheet'
      ? { classList: { remove() {} } }
      : null,
  getExecutionRunButtonSessionId: () => sessionId,
  startExecutionSessionFromControl: (nextSessionId) => {
    delegatedSessionId = nextSessionId;
  }
};
vm.createContext(dockContext);
vm.runInContext(extractFunctionSource('renderExecutionDock'), dockContext);
dockContext.renderExecutionDock();
dockContext.renderExecutionDock();
assert.equal(dockListeners.length, 1, 'dock redraws must retain one persistent Run listener');
let defaultPrevented = false;
dockListeners[0]({
  target: { closest: () => delegatedButton },
  preventDefault() { defaultPrevented = true; }
});
assert.equal(delegatedSessionId, sessionId, 'the persistent listener must start the button\'s exact session');
assert.equal(defaultPrevented, true);

let focusMessages = [];
let focusAttempts = 0;
context.setTimeout = (callback) => {
  void callback();
  return 1;
};
context.sendNativeRunnerExtensionMessage = async (message) => {
  focusMessages.push(message);
  focusAttempts += 1;
  return focusAttempts === 1
    ? { ok: false, reason: 'mission_tab_not_found' }
    : { ok: true, result: { focused: true } };
};
assert.equal(context.requestNativeRunnerMissionTabFocus(sessionId), true);
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(focusMessages.length, 2, 'website focus retries until the mission tab exists');
assert.deepEqual(
  JSON.parse(JSON.stringify(focusMessages[1])),
  { type: 'FOCUS_MISSION_TAB', sessionId },
  'website focus remains bound to the exact mission'
);
assert.equal(context.executionMissionTabFocusIntents.has(sessionId), false, 'successful focus stops retries');

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
  /dock\.dataset\.executionRunBound[\s\S]*closest\?\.\('\[data-execution-run-agent="true"\]'\)[\s\S]*startExecutionSessionFromControl\(sessionId, button\)/,
  'redrawn Run controls must invoke the persistent session-bound start handler'
);
assert.match(
  html,
  /executionRunHandlers\.set\(session\.id, startExecutionFromSheet\)/,
  'the persistent Run handler must resolve to the existing execution start path'
);
assert.match(
  html,
  /data-execution-run-agent="true" data-execution-run-session="\$\{escapeExecutionValue\(session\.id\)\}"/,
  'manual and automatic Run controls must carry their exact session ID'
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
assert.match(
  html,
  /requestNativeRunnerMissionTabFocus\(sessionId\);[\s\S]{0,180}extension_wake_pending/,
  'tab focus must start alongside the Runner wake without gating it'
);
assert.match(
  html,
  /function renderExecutionLiveView\(session\)[\s\S]*const browserOrderSubmitted = sessionHasBrowserOrderSubmitted\(session\);[\s\S]*renderCheckoutSummary/,
  'completed browser details must render when the collapsed widget is reopened'
);
assert.match(
  html,
  /setExecutionRunControlsBusy\(true, isBrowserRun \? 'Connecting\.\.\.' : 'Starting'\)/,
  'Magic Internet must enter connecting state immediately'
);
assert.match(
  html,
  /kind \|\| ''\) === 'browser'\) \{[\s\S]{0,120}button\.hidden = true/,
  'Magic Internet must replace the large startup control with its compact claiming badge'
);
assert.match(
  html,
  /panelMeta\.textContent = 'Claiming mission · Opening Amazon next'/,
  'Magic Internet must present the next startup stage instead of duplicate generic labels'
);
assert.match(
  html,
  /\$\{expanded \? `data-execution-toggle="\$\{session\.id\}"` : `data-execution-open="\$\{session\.id\}"`\}/,
  'the collapsed execution header must use the explicit reopen action'
);
assert.match(
  html,
  /\$\{expanded \? '&raquo;' : '&laquo;'\}/,
  'the execution header must use opposite chevrons for collapse and reopen'
);

console.log('execution startup UI state ok');
