import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { chromium } from 'playwright';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function extractFunctionSource(name) {
  const start = html.indexOf(`function ${name}(`);
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
  renderSantaClawzDeliveryPanel: () => '<div>compact audit panel</div>'
};
vm.createContext(context);
vm.runInContext([
  extractFunctionSource('compactExecutionSentence'),
  extractFunctionSource('escapeExecutionValue'),
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
  extractFunctionSource('hasReadySantaClawzDelivery'),
  extractFunctionSource('openSantaClawzAuditOutput'),
  extractFunctionSource('renderSantaClawzCodeAuditPanel'),
  extractFunctionSource('getExecutionStatusModel'),
  extractFunctionSource('shouldShowExecutionActivityBar'),
  extractFunctionSource('describeExecutionRunState'),
  extractFunctionSource('renderExecutionResult')
].join('\n'), context);
const helpers = vm.runInContext(`({
  collectSantaClawzDeliveryItems,
  hasReadySantaClawzDelivery,
  getExecutionStatusModel,
  shouldShowExecutionActivityBar,
  describeExecutionRunState,
  renderSantaClawzCodeAuditPanel,
  openSantaClawzAuditOutput,
  renderExecutionResult
})`, context);

const items = helpers.collectSantaClawzDeliveryItems(session);
assert.equal(helpers.hasReadySantaClawzDelivery(session), true, 'completed audit output must override a stale executing presentation');
const status = helpers.getExecutionStatusModel(session);
assert.equal(status.statusValue, 'fulfilled');
assert.equal(status.label, 'Done');
assert.equal(helpers.shouldShowExecutionActivityBar(session, status), false);
assert.equal(helpers.describeExecutionRunState(session, status).title, 'Audit complete');

const panel = helpers.renderSantaClawzCodeAuditPanel(session, items);
assert.match(panel, /Highest severity[\s\S]*high/i);
assert.match(panel, /Findings[\s\S]*6/);
assert.match(panel, /data-santaclawz-audit-output="markdown"/);
assert.match(panel, /data-santaclawz-audit-output="json"/);
assert.doesNotMatch(panel, /Additional Model Notes/);
assert.doesNotMatch(panel, /Protocol Surfaces Detected/);
assert.doesNotMatch(panel, /<details|<pre/i);

assert.equal(helpers.openSantaClawzAuditOutput(session.id, 'markdown'), true);
assert.equal(helpers.openSantaClawzAuditOutput(session.id, 'json'), true);
assert.deepEqual(openedUrls, ['blob:output-1', 'blob:output-2']);
assert.equal(createdUrls.length, 2);

const executionResult = helpers.renderExecutionResult(session, { includeProtocolPanel: false });
assert.match(executionResult, /compact audit panel/);
assert.doesNotMatch(executionResult, /Polling delivery|Running\./);

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
if (process.env.MAGIC_CITY_UI_SCREENSHOT) {
  await page.screenshot({ path: process.env.MAGIC_CITY_UI_SCREENSHOT });
}
await browser.close();

console.log('santaclawz compact output UI regression passed');
