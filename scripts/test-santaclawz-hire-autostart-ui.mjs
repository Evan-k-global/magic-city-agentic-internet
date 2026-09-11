import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function extractFunctionSource(name) {
  const asyncStart = html.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing inline function ${name}`);
  const remainder = html.slice(start + 1);
  const nextFunction = remainder.search(/\n\s*(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/);
  assert.notEqual(nextFunction, -1, `missing function boundary after ${name}`);
  return html.slice(start, start + 1 + nextFunction).trim();
}

const codeAuditAgent = {
  pluginId: 'santaclawz:hosted-code-audit-agent--session_agent_test',
  agentName: 'Code Audit Agent',
  creditPrice: 10,
  metadata: {
    source: 'santaclawz',
    label: 'Code Audit Agent',
    description: 'Reviews a public GitHub repository.',
    agentInputRequirements: {
      fields: [
        { id: 'githubUrl', label: 'GitHub repository or code link', type: 'url', required: true },
        { id: 'auditFocus', label: 'Audit focus', type: 'textarea', required: false }
      ]
    }
  }
};

function buildSession(overrides = {}) {
  return {
    id: 'cs-auto-start-audit',
    status: 'ready',
    handoffData: {
      kind: 'agent',
      selectedAgent: codeAuditAgent
    },
    preferredExecutionAgentId: codeAuditAgent.pluginId,
    selections: {
      agentInputs: {
        githubUrl: 'https://github.com/zeko-labs/example'
      }
    },
    paymentOrchestration: { requiredCredits: 10 },
    ...overrides
  };
}

let availableCredits = 20;
let renderCount = 0;
let refreshCount = 0;
let clickCount = 0;
let runButtonDisabled = false;
const executionSessionCache = new Map();
const context = {
  executionCancellingSessions: new Set(),
  executionDismissedSessions: new Set(),
  executionSessionCache,
  executionKnownAvailableCredits: () => availableCredits,
  refreshCreditsBalance: async () => {
    refreshCount += 1;
    availableCredits = 20;
  },
  renderExecutionSheet: async () => { renderCount += 1; },
  getExecutionSheetScrollElement: () => ({
    querySelector: () => ({
      get disabled() { return runButtonDisabled; },
      click() { clickCount += 1; }
    })
  })
};
vm.createContext(context);
vm.runInContext([
  extractFunctionSource('isCodeAuditCompletionAgent'),
  extractFunctionSource('isSantaClawzExecutionSession'),
  extractFunctionSource('santaClawzExecutionHasStarted'),
  extractFunctionSource('executionRequiredCredits'),
  extractFunctionSource('normalizeAgentRequirementMaxLength'),
  extractFunctionSource('normalizeAgentInputRequirements'),
  extractFunctionSource('getMissingAgentInputLabels'),
  extractFunctionSource('canAutoStartReadyCodeAuditHire'),
  extractFunctionSource('autoStartReadyCodeAuditHire')
].join('\n'), context);

const helpers = vm.runInContext('({ canAutoStartReadyCodeAuditHire, autoStartReadyCodeAuditHire })', context);
const readySession = buildSession();

assert.equal(helpers.canAutoStartReadyCodeAuditHire(readySession, 20), true);
assert.equal(helpers.canAutoStartReadyCodeAuditHire(readySession, 9), false, 'insufficient credits must keep the manual screen');
assert.equal(helpers.canAutoStartReadyCodeAuditHire(buildSession({
  selections: { agentInputs: { githubUrl: '' } }
}), 20), false, 'missing repository must keep the manual screen');
assert.equal(helpers.canAutoStartReadyCodeAuditHire(buildSession({ status: 'executing' }), 20), false, 'started sessions must never restart');
assert.equal(helpers.canAutoStartReadyCodeAuditHire(buildSession({
  handoffData: {
    kind: 'agent',
    selectedAgent: {
      pluginId: 'santaclawz:research-agent',
      agentName: 'Research Agent',
      metadata: { source: 'santaclawz', label: 'Research Agent' }
    }
  }
}), 20), false, 'other SantaClawz hires retain their current flow');

executionSessionCache.set(readySession.id, readySession);
assert.equal(await helpers.autoStartReadyCodeAuditHire(readySession.id), true);
assert.equal(renderCount, 1);
assert.equal(clickCount, 1, 'a complete Hire click must invoke Run exactly once');

availableCredits = null;
renderCount = 0;
refreshCount = 0;
clickCount = 0;
assert.equal(await helpers.autoStartReadyCodeAuditHire(readySession.id), true);
assert.equal(refreshCount, 1, 'an unknown balance must be refreshed before auto-start');
assert.equal(clickCount, 1);

availableCredits = 20;
clickCount = 0;
runButtonDisabled = true;
assert.equal(await helpers.autoStartReadyCodeAuditHire(readySession.id), false);
assert.equal(clickCount, 0, 'a disabled Run control must not be bypassed');

assert.match(html, /const autoStarted = await autoStartReadyCodeAuditHire\(openedSessionId\)/);
console.log('santaclawz Hire auto-start UI regression passed');
