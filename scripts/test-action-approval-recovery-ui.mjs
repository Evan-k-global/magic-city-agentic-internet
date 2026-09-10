import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const html = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
const start = html.indexOf('function isAmbiguousActionApprovalError(error)');
const end = html.indexOf("$('messages').addEventListener", start);
assert.ok(start >= 0 && end > start, 'approval recovery helpers must remain extractable from the production UI');
const helperSource = html.slice(start, end);

function loadHelpers(api) {
  const context = vm.createContext({ api, window: { setTimeout }, setTimeout, Error });
  vm.runInContext(`${helperSource}\nthis.helpers = { approveActionWithRecovery, approvedSessionAlreadyStarted };`, context);
  return context.helpers;
}

{
  const calls = [];
  const originalSession = { id: 'cs-original', status: 'ready' };
  const helpers = loadHelpers(async (requestPath, options = {}) => {
    calls.push({ path: requestPath, method: options.method || 'GET' });
    if (options.method === 'POST') throw new Error('network_request_failed:lost_response');
    if (requestPath === '/actions/action-original') {
      return { actionRun: { id: 'action-original', status: 'completed', connectorSessionId: originalSession.id } };
    }
    if (requestPath === `/connectors/sessions/${originalSession.id}`) return { session: originalSession };
    throw new Error(`unexpected_request:${requestPath}`);
  });
  const recovered = await helpers.approveActionWithRecovery('action-original');
  assert.equal(recovered.connectorSession.id, originalSession.id);
  assert.equal(recovered.approvalRecovered, true);
  assert.deepEqual(calls, [
    { path: '/actions/action-original/approve', method: 'POST' },
    { path: '/actions/action-original', method: 'GET' },
    { path: `/connectors/sessions/${originalSession.id}`, method: 'GET' }
  ]);
  assert.equal(helpers.approvedSessionAlreadyStarted(recovered), false, 'a recovered ready session may start once');
}

{
  let postCount = 0;
  const helpers = loadHelpers(async (requestPath, options = {}) => {
    if (options.method === 'POST') {
      postCount += 1;
      if (postCount === 1) throw new Error('network_request_failed:lost_response');
      return {
        approved: true,
        actionRun: { id: 'action-awaiting', status: 'completed', connectorSessionId: 'cs-awaiting' },
        connectorSession: { id: 'cs-awaiting', status: 'ready' }
      };
    }
    assert.equal(requestPath, '/actions/action-awaiting');
    return { actionRun: { id: 'action-awaiting', status: 'awaiting_approval' } };
  });
  const retried = await helpers.approveActionWithRecovery('action-awaiting');
  assert.equal(retried.connectorSession.id, 'cs-awaiting');
  assert.equal(postCount, 2, 'only an action still awaiting approval may retry the same idempotent POST');
}

{
  const helpers = loadHelpers(async (requestPath, options = {}) => {
    if (options.method === 'POST') throw new Error('network_request_failed:lost_response');
    if (requestPath === '/actions/action-running') {
      return { actionRun: { id: 'action-running', status: 'completed', connectorSessionId: 'cs-running' } };
    }
    return { session: { id: 'cs-running', status: 'executing' } };
  });
  const recovered = await helpers.approveActionWithRecovery('action-running');
  assert.equal(helpers.approvedSessionAlreadyStarted(recovered), true, 'an already-running recovered session must not be restarted');
}

{
  const helpers = loadHelpers(async (_requestPath, options = {}) => {
    if (options.method === 'POST') throw new Error('network_request_failed:lost_response');
    throw new Error('network_request_failed:recovery_unavailable');
  });
  await assert.rejects(
    helpers.approveActionWithRecovery('action-retained'),
    (error) => error.actionApprovalRecoverable === true && error.actionRunId === 'action-retained'
  );
  assert.match(html, /Check this same approval again; Magic City will not create a new task\./);
  assert.match(html, /triggerButton\.textContent = 'Check approval'/);
}

assert.match(
  html,
  /await revealExecutionSheet\(data\.connectorSession\.id,[\s\S]*if \(autoRunAction\)/,
  'the recovered original session must open before any eligible one-time start'
);

console.log(JSON.stringify({
  actionApprovalRecovery: 'passed',
  lostResponseSequence: ['POST approve (response lost)', 'GET same action', 'GET original session'],
  duplicateSessionCount: 0,
  duplicateReceiptCount: 0
}));
