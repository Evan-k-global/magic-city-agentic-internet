import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function extractFunctionSource(name) {
  const asyncStart = html.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing inline function ${name}`);
  const remainder = html.slice(start + 1);
  const nextFunction = remainder.search(/\n\s*function\s+[A-Za-z0-9_$]+\s*\(/);
  assert.notEqual(nextFunction, -1, `missing function boundary after ${name}`);
  return html.slice(start, start + 1 + nextFunction).trim();
}

const markdown = `# SantaClawz Agent Code Audit Report

## Additional Model Notes

- HIGH: Paid execution evidence needs settlement validation.
- MEDIUM: Filesystem paths need containment checks.

## Findings

This run returned 6 of 6 medium-or-higher findings.

## Next Action

Fix or triage the highest-severity findings first.`;
const payload = {
  audit_status: 'completed',
  findings: [
    { id: 'SC-1', severity: 'high' },
    { id: 'SC-2', severity: 'medium' },
    { id: 'SC-3', severity: 'medium' },
    { id: 'SC-4', severity: 'medium' },
    { id: 'SC-5', severity: 'medium' },
    { id: 'SC-6', severity: 'medium' }
  ],
  next_action: 'Fix or triage the highest-severity findings first.'
};
const session = {
  id: 'cs-completed-audit-stale-session',
  status: 'executing',
  handoffData: {
    kind: 'agent',
    title: 'Code Audit Agent execution',
    selectedAgent: { agentName: 'Code Audit Agent', metadata: { source: 'santaclawz' } }
  },
  externalExecutionHandoff: { source: 'santaclawz' },
  creditReservation: { status: 'locked', requiredCredits: 10 },
  santaclawzDirectPayment: {
    status: 'submitted',
    paymentPayloadDigestSha256: 'a'.repeat(64),
    summary: {
      completed: false,
      terminalFailure: false,
      returnRejected: false,
      returnValidation: {
        ok: false,
        reason: 'santaclawz_return_missing',
        pending: false,
        retryable: false
      }
    },
    delivery: {
      inlineOutputs: [
        { label: 'Inline Markdown', content: markdown },
        { label: 'Inline structured JSON', content: JSON.stringify(payload) }
      ],
      artifacts: []
    }
  }
};

const openedUrls = [];
const createdUrls = [];
const context = {
  Blob,
  URL: {
    createObjectURL(blob) {
      createdUrls.push(blob);
      return `blob:output-${createdUrls.length}`;
    },
    revokeObjectURL() {}
  },
  window: {
    open(url) {
      openedUrls.push(url);
      return {};
    },
    setTimeout() {}
  },
  document: { createElement: () => ({ click() {} }) },
  executionSessionCache: new Map([[session.id, session]]),
  executionPendingSessions: new Set([session.id]),
  executionProtocolPollingSessions: new Set([session.id]),
  executionPollingRequestsInFlight: new Set(),
  executionDismissedSessions: new Set(),
  executionCancellingSessions: new Set(),
  executionLocalErrors: new Map(),
  isTerminalExecutionStatus: (status) => ['fulfilled', 'failed'].includes(String(status || '').toLowerCase()),
  isAwaitingExecutionConfirmation: () => false,
  reconcileExecutionWakeError: () => {},
  executionLocalErrorApplies: () => false,
  sessionHasBrowserOrderSubmitted: () => false,
  santaClawzExecutionHasStarted: () => true,
  renderAssistantRichText: (value) => `<p>${String(value)}</p>`,
  escapeHtml: (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  renderExecutionVerification: () => '',
  renderSantaClawzDirectPaymentPanel: () => '',
  renderSantaClawzDeliveryPanel: () => '<div>compact audit panel</div>',
  getExecutionDraft: () => null,
  syncExecutionProtocolPollingSession: () => false,
  clearExecutionRunnerProgress: () => {},
  clearSelectedAgentExecution: () => {},
  refreshExecutionPanelInPlace: () => true,
  renderExecutionSheet: async () => {},
  ensureExecutionPolling: () => {}
};
vm.createContext(context);
vm.runInContext([
  extractFunctionSource('compactExecutionSentence'),
  extractFunctionSource('escapeExecutionValue'),
  extractFunctionSource('isSantaClawzExecutionSession'),
  extractFunctionSource('markExecutionStartButtonStarting'),
  extractFunctionSource('normalizeSantaClawzDeliveryItem'),
  extractFunctionSource('collectSantaClawzDeliveryItemsFromValue'),
  extractFunctionSource('collectSantaClawzDeliveryItems'),
  extractFunctionSource('parseSantaClawzInlineJson'),
  extractFunctionSource('isSantaClawzCodeAuditDelivery'),
  extractFunctionSource('getSantaClawzAuditPayload'),
  extractFunctionSource('getSantaClawzAuditMarkdown'),
  extractFunctionSource('getSantaClawzAuditValue'),
  extractFunctionSource('getSantaClawzAuditFindings'),
  extractFunctionSource('getSantaClawzAuditHighestSeverity'),
  extractFunctionSource('getSantaClawzAuditFindingCount'),
  extractFunctionSource('getSantaClawzAuditSummary'),
  extractFunctionSource('normalizeSantaClawzAuditStatus'),
  extractFunctionSource('isExecutionSessionDurablyCancelled'),
  extractFunctionSource('getSantaClawzDeliveryVerificationState'),
  extractFunctionSource('hasPendingSantaClawzDeliveryVerification'),
  extractFunctionSource('hasReadySantaClawzDelivery'),
  extractFunctionSource('getSantaClawzExecutionProgress'),
  extractFunctionSource('openSantaClawzAuditOutput'),
  extractFunctionSource('renderSantaClawzCodeAuditPanel'),
  extractFunctionSource('getExecutionStatusModel'),
  extractFunctionSource('shouldShowExecutionActivityBar'),
  extractFunctionSource('describeExecutionRunState'),
  extractFunctionSource('shouldPollExecutionSession'),
  extractFunctionSource('executionPollingRenderBucket'),
  extractFunctionSource('shouldApplyPolledExecutionSession'),
  extractFunctionSource('refreshExecutionSessionForPolling'),
  extractFunctionSource('renderExecutionResult')
].join('\n'), context);
const helpers = vm.runInContext(`({
  collectSantaClawzDeliveryItems,
  getSantaClawzDeliveryVerificationState,
  hasPendingSantaClawzDeliveryVerification,
  hasReadySantaClawzDelivery,
  getExecutionStatusModel,
  shouldShowExecutionActivityBar,
  describeExecutionRunState,
  shouldPollExecutionSession,
  shouldApplyPolledExecutionSession,
  refreshExecutionSessionForPolling,
  renderSantaClawzCodeAuditPanel,
  getSantaClawzExecutionProgress,
  markExecutionStartButtonStarting,
  openSantaClawzAuditOutput,
  renderExecutionResult
})`, context);

const items = helpers.collectSantaClawzDeliveryItems(session);
assert.equal(helpers.hasReadySantaClawzDelivery(session), false, 'unverified output must not claim accepted completion');
assert.equal(helpers.hasPendingSantaClawzDeliveryVerification(session), true);
const status = helpers.getExecutionStatusModel(session);
assert.equal(status.statusValue, 'verification_pending');
assert.equal(status.label, 'Report available');

const pendingAuditSession = {
  id: 'cs-audit-connecting',
  status: 'ready',
  handoffData: {
    kind: 'agent',
    selectedAgent: { pluginId: 'santaclawz:code-audit', metadata: { source: 'santaclawz' } }
  }
};
context.executionPendingSessions.add(pendingAuditSession.id);
const pendingStatus = helpers.getExecutionStatusModel(pendingAuditSession);
assert.equal(pendingStatus.statusValue, 'executing');
assert.equal(pendingStatus.label, 'Connecting');
const pendingRunState = helpers.describeExecutionRunState(pendingAuditSession, pendingStatus);
assert.equal(pendingRunState.title, 'Preparing audit');
assert.equal(pendingRunState.detail, 'Checking SantaClawz readiness and payment terms.');
assert.equal(pendingRunState.badgeLabel, 'Connecting');
assert.equal(helpers.shouldShowExecutionActivityBar(session, status), false);
assert.equal(helpers.describeExecutionRunState(session, status).title, 'Report available');

const watchdogFailedSession = structuredClone(session);
watchdogFailedSession.status = 'failed';
watchdogFailedSession.updatedAt = '2026-09-10T06:47:06.209Z';
assert.equal(helpers.hasPendingSantaClawzDeliveryVerification(watchdogFailedSession), true);
assert.equal(helpers.getExecutionStatusModel(watchdogFailedSession).label, 'Report available');

const acceptedSession = structuredClone(session);
acceptedSession.status = 'fulfilled';
acceptedSession.updatedAt = '2026-09-10T06:48:00.000Z';
acceptedSession.santaclawzDirectPayment.status = 'completed';
acceptedSession.santaclawzDirectPayment.summary = {
  completed: true,
  returnValidation: { ok: true }
};
assert.equal(helpers.hasReadySantaClawzDelivery(acceptedSession), true);
assert.equal(helpers.getExecutionStatusModel(acceptedSession).label, 'Done');

const partialAcceptedSession = structuredClone(acceptedSession);
partialAcceptedSession.santaclawzDirectPayment.summary.returnValidation.verificationSource = 'santaclawz_authenticated_lifecycle';
partialAcceptedSession.santaclawzDirectPayment.delivery = {
  inlineOutputs: ['code-audit-summary.md', markdown],
  artifacts: [],
  verification: {
    source: 'santaclawz_authenticated_lifecycle',
    partialDelivery: true,
    suppressedOutputs: [{ name: 'code-audit-result.json', reason: 'received_bytes_hash_mismatch' }]
  }
};
assert.equal(helpers.getSantaClawzExecutionProgress(partialAcceptedSession).title, 'Audit complete');
assert.match(helpers.getSantaClawzExecutionProgress(partialAcceptedSession).detail, /Markdown report is ready/);
assert.equal(helpers.shouldPollExecutionSession(partialAcceptedSession), false);
assert.doesNotMatch(
  helpers.renderSantaClawzCodeAuditPanel(
    partialAcceptedSession,
    helpers.collectSantaClawzDeliveryItems(partialAcceptedSession)
  ),
  /Open JSON/
);

const staleAcceptedSession = structuredClone(acceptedSession);
staleAcceptedSession.updatedAt = '2026-09-10T06:46:00.000Z';
assert.equal(helpers.shouldApplyPolledExecutionSession(acceptedSession, staleAcceptedSession), false);
assert.equal(helpers.shouldApplyPolledExecutionSession(watchdogFailedSession, acceptedSession), true);

const cancelledSession = structuredClone(watchdogFailedSession);
cancelledSession.executionCancellation = { cancelledAt: '2026-09-10T06:47:30.000Z' };
assert.equal(helpers.hasPendingSantaClawzDeliveryVerification(cancelledSession), false);
assert.equal(helpers.shouldPollExecutionSession(cancelledSession), false);
assert.equal(helpers.getExecutionStatusModel(cancelledSession).label, 'Cancelled');
assert.equal(helpers.describeExecutionRunState(cancelledSession, helpers.getExecutionStatusModel(cancelledSession)).title, 'Cancelled');
assert.match(helpers.renderSantaClawzCodeAuditPanel(cancelledSession, helpers.collectSantaClawzDeliveryItems(cancelledSession)), /Open Markdown report/);
const preCancellationResponse = structuredClone(watchdogFailedSession);
preCancellationResponse.updatedAt = cancelledSession.updatedAt;
assert.equal(helpers.shouldApplyPolledExecutionSession(cancelledSession, preCancellationResponse), false);

const rejectedSession = structuredClone(watchdogFailedSession);
rejectedSession.santaclawzDirectPayment.summary.returnValidation = {
  ok: false,
  reason: 'artifact_hash_mismatch',
  pending: false,
  retryable: false
};
assert.equal(helpers.getSantaClawzDeliveryVerificationState(rejectedSession).rejected, true);
assert.equal(helpers.hasPendingSantaClawzDeliveryVerification(rejectedSession), false);
assert.equal(helpers.shouldPollExecutionSession(rejectedSession), false);

let resolvePollingRequest;
context.api = () => new Promise((resolve) => { resolvePollingRequest = resolve; });
const pollingBase = structuredClone(session);
pollingBase.id = 'cs-poll-race';
pollingBase.status = 'executing';
pollingBase.updatedAt = '2026-09-10T06:47:00.000Z';
context.executionSessionCache.set(pollingBase.id, pollingBase);
const delayedRefresh = helpers.refreshExecutionSessionForPolling(pollingBase.id);
await new Promise((resolve) => setImmediate(resolve));
const newerFulfilled = structuredClone(acceptedSession);
newerFulfilled.id = pollingBase.id;
newerFulfilled.updatedAt = '2026-09-10T06:49:00.000Z';
context.executionSessionCache.set(pollingBase.id, newerFulfilled);
const staleResponse = structuredClone(pollingBase);
staleResponse.updatedAt = '2026-09-10T06:48:00.000Z';
resolvePollingRequest({ session: staleResponse });
assert.equal((await delayedRefresh).mode, 'stale-response');
assert.equal(context.executionSessionCache.get(pollingBase.id).status, 'fulfilled');

const panel = helpers.renderSantaClawzCodeAuditPanel(session, items);
assert.match(panel, /Highest severity[\s\S]*high/i);
assert.match(panel, /Findings[\s\S]*6/);
assert.match(panel, /Status[\s\S]*complete/i);
assert.doesNotMatch(panel, />completed</i);
assert.match(panel, /data-santaclawz-audit-output="markdown"/);
assert.match(panel, /data-santaclawz-audit-output="json"/);
assert.match(panel, /Open Markdown report/);
assert.match(panel, /Open JSON report/);
assert.doesNotMatch(panel, /Additional Model Notes/);
assert.doesNotMatch(panel, /Protocol Surfaces Detected/);
assert.doesNotMatch(panel, /<details|<pre/i);

assert.equal(helpers.openSantaClawzAuditOutput(session.id, 'markdown'), true);
assert.equal(helpers.openSantaClawzAuditOutput(session.id, 'json'), true);
assert.deepEqual(openedUrls, ['blob:output-1', 'blob:output-2']);
assert.equal(createdUrls.length, 2);

const structuredSession = structuredClone(session);
structuredSession.santaclawzDirectPayment.delivery.inlineOutputs = [
  { name: 'audit.md', text: markdown },
  { name: 'audit.json', content: payload }
];
const structuredPanel = helpers.renderSantaClawzCodeAuditPanel(
  structuredSession,
  helpers.collectSantaClawzDeliveryItems(structuredSession)
);
assert.match(structuredPanel, /Open JSON report/, 'object-valued structured output must remain available as JSON');

const activeSession = structuredClone(session);
activeSession.santaclawzDirectPayment.executionState = { status: 'running' };
activeSession.santaclawzDirectPayment.delivery = { inlineOutputs: [], artifacts: [] };
assert.equal(helpers.getSantaClawzExecutionProgress(activeSession).title, 'Auditing repository');
const finishedUpstreamSession = structuredClone(activeSession);
finishedUpstreamSession.santaclawzDirectPayment.executionState.status = 'completed';
assert.equal(helpers.getSantaClawzExecutionProgress(finishedUpstreamSession).title, 'Finalizing report');

const startButtonState = {
  disabled: false,
  textContent: 'Run agent',
  classes: new Set(),
  attributes: new Map(),
  classList: { add(value) { startButtonState.classes.add(value); } },
  setAttribute(name, value) { startButtonState.attributes.set(name, value); }
};
assert.equal(helpers.markExecutionStartButtonStarting(startButtonState), true);
assert.equal(startButtonState.disabled, true);
assert.equal(startButtonState.textContent, 'Starting');
assert.equal(startButtonState.classes.has('is-starting'), true);
assert.equal(startButtonState.attributes.get('aria-busy'), 'true');

const connectingButtonState = {
  disabled: false,
  textContent: 'Run agent',
  classList: { add() {} },
  setAttribute() {}
};
assert.equal(helpers.markExecutionStartButtonStarting(connectingButtonState, 'Connecting...'), true);
assert.equal(connectingButtonState.textContent, 'Connecting...');

const executionResult = helpers.renderExecutionResult(session, { includeProtocolPanel: false });
assert.match(executionResult, /compact audit panel/);
assert.doesNotMatch(executionResult, /Polling delivery|Running\./);
const activeExecutionResult = helpers.renderExecutionResult(activeSession, { includeProtocolPanel: false });
assert.match(activeExecutionResult, /compact audit panel/);
assert.doesNotMatch(activeExecutionResult, /Polling delivery|Preparing delivery links/);

assert.match(html, /const canCancelExecution = !isTerminalExecutionStatus\(session\.status\) && !santaClawzDeliveryReady/);
assert.match(html, /showSantaClawzCreditBackedRun = santaClawzCreditBackedActive && !santaClawzDeliveryReady/);
assert.match(html, /setExecutionHtml\('executionActions',[\s\S]{0,100}santaClawzDeliveryReady[\s\S]{0,40}\? ''/);

const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.setContent(`<style>${css}</style><main style="width:330px;margin:20px">${panel}</main>`);
const layout = await page.locator('.execution-audit-report').evaluate((element) => ({
  height: element.getBoundingClientRect().height,
  clientWidth: element.clientWidth,
  scrollWidth: element.scrollWidth
}));
assert.ok(layout.height < 260, `compact audit panel should remain short, got ${layout.height}px`);
assert.ok(layout.scrollWidth <= layout.clientWidth, 'compact audit panel must not overflow horizontally');
assert.equal(await page.locator('[data-santaclawz-audit-output]').count(), 2);
assert.equal((await page.locator('.execution-audit-fact strong').first().textContent()).trim(), 'complete');
if (process.env.MAGIC_CITY_UI_SCREENSHOT) {
  await page.screenshot({ path: process.env.MAGIC_CITY_UI_SCREENSHOT });
}
await browser.close();

assert.match(html, /execution-agent-start:active:not\(:disabled\)/);
assert.match(html, /markExecutionStartButtonStarting\(button, buttonLabel\)[\s\S]{0,240}startAgentExecutionFromFallback/);
assert.match(html, /buttonLabel = isSantaClawzExecutionSession\(pendingSession\) \? 'Connecting\.\.\.' : 'Starting'/);
assert.match(html, /Checking readiness and payment terms/);
assert.match(html, /Verified by SantaClawz/);

console.log('santaclawz compact output UI regression passed');
