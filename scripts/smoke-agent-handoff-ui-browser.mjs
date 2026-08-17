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
    pluginId: 'santaclawz:code-audit-smoke',
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
  await route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: [
      sseEvent('start', {}),
      sseEvent('final', {
        assistant: { content: 'I can prepare a Code Audit Agent handoff after you choose to hire it.', providerId: 'smoke' },
        agentFollowUp: {
          kind: 'developer',
          chatIntake: { required: true, githubUrl: '' },
          agent: codeAuditAgent,
          agents: [codeAuditAgent]
        },
        intent: { capability: 'general-chat' }
      })
    ].join('')
  });
});

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.locator('#chatPrompt').fill('can i add an agent that can help with that?');
await page.locator('#sendBtn').click();
const activateLink = page.locator(`a[href="https://www.santaclawz.ai/activate"]`);
await activateLink.waitFor({ state: 'visible' });
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
assert.equal(await completionCard.getByRole('link', { name: 'Add your agent', exact: true }).count(), 1, 'the agent-publishing path must remain available');
const completionCardBox = await completionCard.boundingBox();
assert.ok(completionCardBox && completionCardBox.height < 104, `default match card should stay compact, got ${completionCardBox?.height}px`);

await codeAuditMessage.getByRole('button', { name: 'Hire', exact: true }).first().click();
const executionPanel = page.locator('[data-session-panel]').last();
try {
  await executionPanel.waitFor({ state: 'visible', timeout: 10000 });
} catch (error) {
  const cardText = await codeAuditMessage.textContent().catch(() => '');
  throw new Error(`Code Audit Hire did not open a session. Card: ${cardText}. Runtime: ${runtimeErrors.join(' | ')}`, { cause: error });
}
const githubField = executionPanel.locator('[data-agent-field="githubUrl"]');
await githubField.waitFor({ state: 'visible' });
assert.equal(await githubField.inputValue(), '');

const repoUrl = 'https://github.com/zeko-labs/santa_clawz-private_agents';
await page.locator('#chatPrompt').fill(repoUrl);
await page.locator('#sendBtn').click();
await page.waitForFunction(
  ({ selector, expected }) => document.querySelector(selector)?.value === expected,
  { selector: '[data-agent-field="githubUrl"]', expected: repoUrl }
);

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
