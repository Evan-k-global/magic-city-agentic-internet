import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.MAGIC_CITY_SMOKE_BASE_URL || 'http://127.0.0.1:3210';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const runtimeErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => runtimeErrors.push(`page: ${error.message}`));
page.on('response', (response) => {
  if (response.status() >= 400) runtimeErrors.push(`http ${response.status()}: ${response.url()}`);
});

function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

let responseMode = 'add-agent-error';
let loseNextSessionStartResponse = false;
let lostSessionId = '';
const sessionStartRequestIds = [];
let executionStartCount = 0;
page.on('request', (request) => {
  if (/\/connectors\/sessions\/[^/]+\/start-execution$/.test(new URL(request.url()).pathname)) {
    executionStartCount += 1;
  }
});
await page.route('**/intent/stream', async (route) => {
  if (responseMode === 'add-agent-error') {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseEvent('error', { error: 'simulated_connection_drop' })
    });
    return;
  }
  const codeAuditAgent = {
    pluginId: 'santaclawz:hosted-code-audit-agent--session_agent_0e86fd7829bd',
    agentName: 'Code Audit Agent',
    description: 'Reviews a public GitHub repository and returns prioritized findings.',
    sourceLabel: 'SantaClawz marketplace',
    price: 0.1,
    creditPrice: 10,
    metadata: {
      source: 'santaclawz',
      agentInputRequirements: {
        source: 'santaclawz_preflight',
        fields: [
          { id: 'githubUrl', label: 'GitHub repository or code link', type: 'url', required: true },
          { id: 'auditFocus', label: 'Audit focus', type: 'textarea', required: false }
        ]
      }
    },
    inputRequirements: {
      source: 'santaclawz_preflight',
      fields: [
        { id: 'githubUrl', label: 'GitHub repository or code link', type: 'url', required: true },
        { id: 'auditFocus', label: 'Audit focus', type: 'textarea', required: false }
      ]
    }
  };
  const request = route.request().postDataJSON();
  const prompt = String(request?.prompt || request?.metadata?.prompt || '');
  const repoUrl = prompt.match(/https:\/\/github\.com\/[^\s]+/i)?.[0] || '';
  const continuingAudit = Boolean(repoUrl);
  await route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: [
      sseEvent('start', {}),
      sseEvent('final', {
        assistant: {
          content: continuingAudit
            ? `Verified public GitHub repository for Code Audit Agent: ${repoUrl}`
            : 'I can prepare a Code Audit Agent handoff after you choose to hire it.',
          providerId: 'smoke'
        },
        agentFollowUp: {
          kind: 'developer',
          reason: continuingAudit ? 'pending_code_audit_continuation' : 'literal_audit_keyword',
          autoOpenExecutionSheet: continuingAudit,
          chatIntake: { required: !continuingAudit, githubUrl: repoUrl },
          agent: codeAuditAgent,
          agents: [codeAuditAgent]
        },
        intent: { capability: 'general-chat' }
      })
    ].join('')
  });
});
await page.route('**/connectors/sessions/start', async (route) => {
  const body = route.request().postDataJSON();
  sessionStartRequestIds.push(String(body?.clientRequestId || ''));
  const response = await route.fetch();
  const payload = await response.json();
  if (loseNextSessionStartResponse) {
    loseNextSessionStartResponse = false;
    lostSessionId = String(payload?.session?.id || '');
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'x-request-id': 'req-simulated-session-response-loss' },
      body: JSON.stringify({ error: 'simulated_session_response_lost' })
    });
    return;
  }
  await route.fulfill({ response });
});

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.locator('#chatPrompt').fill('can i add an agent that can help with that?');
await page.locator('#sendBtn').click();
const activateLink = page.locator(`a[href="https://www.santaclawz.ai/activate"]`);
try {
  await activateLink.waitFor({ state: 'visible' });
} catch (error) {
  const pageText = await page.locator('body').innerText().catch(() => '');
  throw new Error(`SantaClawz activation fallback did not render. Runtime: ${runtimeErrors.join(' | ')}. Page: ${pageText.slice(0, 1200)}`, { cause: error });
}
assert.equal(await activateLink.textContent(), 'Add your agent');

if (process.env.MAGIC_CITY_SMOKE_PUBLIC_ONLY === '1') {
  await browser.close();
  console.log('agent handoff public browser smoke ok');
  process.exit(0);
}

const smokeAccount = `agent-handoff-${Date.now()}@example.test`;
await page.evaluate(({ email, passphrase }) => {
  document.querySelector('#authEmail').value = email;
  document.querySelector('#authPassphrase').value = passphrase;
}, { email: smokeAccount, passphrase: `agent-handoff-${Date.now()}` });
await page.evaluate(() => window.registerAccount());

responseMode = 'code-audit';
await page.locator('#chatPrompt').fill('i want a code audit please');
await page.locator('#sendBtn').click();
const codeAuditMessage = page.locator('.msg.assistant').filter({ hasText: 'Code Audit Agent handoff' }).last();
await codeAuditMessage.waitFor({ state: 'visible' });
assert.equal(await page.locator('[data-session-panel]').count(), 0, 'Code Audit must not auto-open before Hire');
const completionCard = codeAuditMessage.locator('.agent-completion-card');
await completionCard.waitFor({ state: 'visible' });
assert.equal(await completionCard.locator('.agent-completion-utilities').count(), 0, 'match alternatives must not consume a separate utility row');
assert.equal(await completionCard.locator('.agent-completion-inline-links').count(), 1, 'match alternatives must stay inline with the recommendation');
const completionCardBox = await completionCard.boundingBox();
assert.ok(completionCardBox && completionCardBox.height < 104, `default match card should stay compact, got ${completionCardBox?.height}px`);

const repoUrl = 'https://github.com/zeko-labs/santa_clawz-private_agents';
loseNextSessionStartResponse = true;
await page.locator('#chatPrompt').fill(repoUrl);
await page.locator('#sendBtn').click();
const firstContinuation = page.locator('.msg.assistant').filter({ hasText: 'Verified public GitHub repository' }).last();
await firstContinuation.locator('[data-agent-completion-status]').filter({ hasText: 'Your selection is saved' }).waitFor({ state: 'visible' });
assert.ok(lostSessionId, 'the interrupted opening must have created one recoverable server session');
assert.equal(await page.locator('[data-session-panel]').count(), 0, 'a lost create response must not invent a client-side session');
await page.locator('#chatPrompt').fill(repoUrl);
await page.locator('#sendBtn').click();
const recoveredContinuation = page.locator('.msg.assistant').filter({ hasText: 'Verified public GitHub repository' }).last();
const executionPanel = page.locator('[data-session-panel]').last();
try {
  await executionPanel.waitFor({ state: 'visible', timeout: 10000 });
} catch (error) {
  const cardText = await recoveredContinuation.textContent().catch(() => '');
  throw new Error(`Code Audit continuation did not open a session. Card: ${cardText}. Runtime: ${runtimeErrors.join(' | ')}`, { cause: error });
}
assert.equal(await executionPanel.getAttribute('data-session-panel'), lostSessionId, 'retry must reopen the original draft session');
assert.equal(sessionStartRequestIds.length, 2, 'opening recovery must make one idempotent retry');
assert.ok(sessionStartRequestIds[0], 'opening requests must carry an idempotency key');
assert.equal(sessionStartRequestIds[1], sessionStartRequestIds[0], 'opening recovery must reuse the same idempotency key');
const githubField = executionPanel.locator('[data-agent-field="githubUrl"]');
await githubField.waitFor({ state: 'visible' });
assert.equal(await githubField.inputValue(), repoUrl, 'repository-only continuation must prefill the execution sheet');
assert.equal(executionStartCount, 0, 'opening the prefilled sheet must not start a hire or payment');

const auditFocusField = executionPanel.locator('[data-agent-field="auditFocus"]');
await auditFocusField.fill('performance and reliability');
await page.route('**/connectors/sessions/*/start-execution', async (route) => {
  await route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      error: 'santaclawz_runtime_ready_timeout',
      unstartedSantaClawz: true
    })
  });
});
await executionPanel.locator('[data-execution-run-agent="true"]').first().click();
await executionPanel.getByText(/SantaClawz did not answer its readiness check in time/i).waitFor({ state: 'visible' });
assert.equal(await githubField.inputValue(), repoUrl, 'repository must survive a readiness timeout');
assert.equal(await auditFocusField.inputValue(), 'performance and reliability', 'local draft must survive a readiness timeout');
await page.waitForTimeout(250);
assert.equal(executionStartCount, 1, 'a readiness timeout must not duplicate the hire request');

const scrollResult = await page.evaluate(async () => {
  let panel = document.querySelector('[data-session-panel]');
  let scroller = panel?.querySelector('.execution-panel-body');
  if (!scroller) return { skipped: true };
  const sessionId = panel.getAttribute('data-session-panel');
  const firstMode = await window.refreshExecutionSessionForPolling(sessionId);
  await new Promise((resolve) => setTimeout(resolve, 120));
  panel = document.querySelector(`[data-session-panel="${sessionId}"]`);
  scroller = panel?.querySelector('.execution-panel-body');
  scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const before = scroller.scrollTop;
  const secondMode = await window.refreshExecutionSessionForPolling(sessionId);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const currentScroller = document.querySelector(`[data-session-panel="${sessionId}"] .execution-panel-body`);
  return { before, after: currentScroller?.scrollTop || 0, firstMode, secondMode };
});
if (!scrollResult.skipped && scrollResult.before > 0) {
  assert.equal(scrollResult.secondMode?.mode, 'in-place', JSON.stringify(scrollResult));
  assert.equal(scrollResult.after, scrollResult.before, 'steady polling must preserve execution-panel scroll position');
}

await browser.close();
console.log('agent handoff browser smoke ok');
