import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function extractFunctionSource(name) {
  const start = html.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing inline function ${name}`);
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  for (let index = braceStart; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`unterminated inline function ${name}`);
}

const context = {};
vm.createContext(context);
vm.runInContext(extractFunctionSource('isAddAgentIntent'), context);

assert.equal(context.isAddAgentIntent('can i add an agent that can help with that?'), true);
assert.equal(context.isAddAgentIntent('register my agent'), true);
assert.equal(context.isAddAgentIntent('tell me about agent payments'), false);
assert.match(html, /href="\$\{escapeHtml\(SANTACLAWZ_AGENT_ACTIVATE_URL\)\}"/, 'add-agent CTA must use the SantaClawz activation URL');

const pollSource = extractFunctionSource('refreshExecutionSessionForPolling');
assert.match(pollSource, /refreshExecutionPanelInPlace\(session\)/, 'steady-state polling must patch the open panel in place');
assert.match(pollSource, /previousBucket !== nextBucket/, 'full rendering must be limited to real lifecycle transitions');
assert.match(pollSource, /const terminalBrowserOrder = sessionHasBrowserOrderSubmitted\(session\)/, 'merchant confirmation must be evaluated before a lifecycle render');
assert.match(pollSource, /isTerminalExecutionStatus\(session\.status\) \|\| terminalBrowserOrder/, 'merchant-confirmed browser orders must stop local polling immediately');
assert.doesNotMatch(
  pollSource,
  /await renderExecutionSheet\(sessionId, \{ focus: false \}\)/,
  'polling must not unconditionally replace the execution dock'
);

const inPlaceSource = extractFunctionSource('refreshExecutionPanelInPlace');
assert.match(inPlaceSource, /activityBar\?\.remove\(\)/, 'in-place updates must remove an active bar after a run completes');
assert.match(inPlaceSource, /shouldShowExecutionActivityBar\(session, statusBadge\)/, 'activity treatment must derive from the latest confirmed session state');
assert.match(html, /Order placed and confirmed by Amazon\./, 'merchant-confirmed orders must use explicit terminal copy');
assert.match(html, /function shouldShowExecutionActivityBar\(session, statusModel\)/, 'activity-bar rendering must have a dedicated terminal-state guard');

const submitSource = extractFunctionSource('submitIntentFromChat');
assert.doesNotMatch(
  submitSource,
  /agentFollowUp\?\.chatIntake[\s\S]{0,900}openContextualExecutionSession/,
  'Code Audit intake must not auto-open an execution session before the user hires it'
);
assert.match(submitSource, /if \(addAgentIntent\) attachAddAgentCallToAction\(pending\)/, 'successful add-agent prompts must show the deterministic CTA');
assert.match(submitSource, /if \(addAgentIntent\) attachAddAgentCallToAction\(errorTarget\)/, 'failed add-agent prompts must still show the deterministic CTA');

const handoffSource = extractFunctionSource('maybeRoutePromptToSelectedAgentExecution');
assert.ok(
  handoffSource.indexOf('cacheSelectedAgentExecutionDetail(session, nextSelections, nextLocalPrivateInputs)') <
    handoffSource.indexOf("api(`/connectors/sessions/${session.id}/update`"),
  'chat clarification must be cached into the exact widget before the network update'
);
assert.match(handoffSource, /renderExecutionSheet\(session\.id, \{ focus: false \}\)/, 'chat clarification must preserve execution widget position');

const removeMagicInternetActionCardSource = extractFunctionSource('removeMagicInternetActionCard');
assert.match(removeMagicInternetActionCardSource, /card\?\.remove\(\)/, 'Magic Internet Agent must retire the recommendation card once its execution session exists');
assert.doesNotMatch(removeMagicInternetActionCardSource, /messageEl/, 'Magic Internet Agent must keep a concise chat handoff after the recommendation card is removed');
const magicInternetHandoffSource = extractFunctionSource('showMagicInternetExecutionHandoff');
assert.match(magicInternetHandoffSource, /classList\.add\('magic-internet-execution-handoff'\)/, 'Magic Internet Agent must mark its compact chat handoff');
assert.match(magicInternetHandoffSource, /running in the execution window/, 'Magic Internet Agent must explain where work is running');
assert.match(magicInternetHandoffSource, /check back only if it needs/, 'Magic Internet Agent must clearly explain that it continues work independently');
assert.match(magicInternetHandoffSource, /sign in, complete payment, or authorize a step/, 'Magic Internet Agent must explain when it needs a person');
assert.doesNotMatch(magicInternetHandoffSource, /make a decision/, 'Magic Internet Agent must describe explicit authorization rather than generic decision-making');
assert.match(magicInternetHandoffSource, /\.msg-details'\)\?\.remove\(\)/, 'Magic Internet Agent handoff must not leave a redundant details control');
assert.match(html, /\.msg\.assistant\.magic-internet-execution-handoff\s*\{\s*max-width: min\(calc\(32vw - 18px\), 572px\)/, 'Magic Internet Agent handoff must stay in the left half of the page on desktop');
assert.match(html, /actionMagicInternet/, 'action cards must retain their execution-lane identity');
assert.match(html, /showMagicInternetExecutionHandoff\(messageEl, autoRunStarted\)/, 'Magic Internet Agent approval must leave a clear chat handoff to the execution surface');
assert.match(html, /removeMagicInternetActionCard\(card\)/, 'Magic Internet Agent approval must retire only the recommendation controls');
assert.doesNotMatch(html, /Starting the execution sheet/, 'Magic Internet Agent must not render a separate startup screen in chat');

console.log('agent handoff UI contract ok');
