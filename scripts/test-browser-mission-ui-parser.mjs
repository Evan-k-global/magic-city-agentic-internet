import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const localRunnerExecutor = fs.readFileSync(new URL('../public/native-runner/extension/executor.js', import.meta.url), 'utf8');
const localRunnerBackground = fs.readFileSync(new URL('../public/native-runner/extension/background.js', import.meta.url), 'utf8');
const localRunnerLegacyBackground = fs.readFileSync(new URL('../public/native-runner/extension/background-v0.2.js', import.meta.url), 'utf8');
const browserMissionPlan = fs.readFileSync(new URL('../src/browserMissionPlan.js', import.meta.url), 'utf8');
const serverSource = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

assert.doesNotMatch(
  html,
  /isHiddenAgentCompletionCandidate/,
  'the browser UI must not call the server-only agent completion filter'
);
assert.match(html, /function cancelExecutionSession\(/, 'execution UI must provide a real cancellation action');
assert.match(html, /data-execution-cancel-session/, 'execution UI must render a cancel-run control');
assert.match(html, /executionDismissedSessions/, 'dismissed executions must not be restored by polling');
assert.match(html, /\/connectors\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/cancel/, 'cancel-run control must call the session cancellation endpoint');
assert.match(html, /executionCancellingSessions\.has\(sessionId\) \|\| executionDismissedSessions\.has\(sessionId\)/, 'an execution sheet must not redraw while cancellation is pending');
assert.match(html, /SANTACLAWZ_PROTOCOL_URL[\s\S]*Add your agent/, 'SantaClawz match cards must provide an add-your-agent path');
assert.match(html, /agent-completion-primary-actions/, 'SantaClawz match cards must isolate the recommended hire controls');
assert.match(html, /agent-completion-inline-links/, 'SantaClawz match cards must keep browsing and publishing actions compact and inline');
assert.match(html, /agent-completion-status:empty/, 'SantaClawz match cards must not reserve space before a status exists');
assert.match(html, /View \$\{matchCount\} match/, 'SantaClawz alternate-agent control must state how many matches are available');

const localVaultStart = html.indexOf('<details id="settingsDataSection">');
const localVaultEnd = html.indexOf('</details>', localVaultStart);
assert.notEqual(localVaultStart, -1, 'local data vault settings must be present');
assert.notEqual(localVaultEnd, -1, 'local data vault settings must close');
const localVaultMarkup = html.slice(localVaultStart, localVaultEnd);
assert.match(localVaultMarkup, /vaultShippingCity|vaultShippingState/, 'local data vault must collect a complete shipping address');
assert.match(localVaultMarkup, /vaultBillingCity|vaultBillingState/, 'local data vault must support a complete billing address');
assert.match(localVaultMarkup, /City and state fill from your ZIP/, 'local data vault must derive locality from ZIP by default');
assert.match(localVaultMarkup, /vaultStreetAddress/, 'local data vault must keep street address');
assert.match(localVaultMarkup, /vaultZipCode/, 'local data vault must keep ZIP code');
assert.match(html, /async function populateVaultLocalityFromZip/, 'the browser must resolve ZIP locality without sending an address to Magic City');
assert.match(
  localRunnerExecutor,
  /function fullShippingAddressAvailable\(profile = \{\}\)[\s\S]*shippingCity[\s\S]*shippingState/,
  'runner must require city and state before it creates an address on a merchant site'
);
assert.match(
  html,
  /function localCheckoutProfileHasValues\(profile = \{\}\)[\s\S]*shippingCity[\s\S]*shippingState/,
  'browser checkout must require a complete saved shipping address'
);
assert.doesNotMatch(
  browserMissionPlan,
  /fill-checkout-profile[^\n]*optional:\s*true/,
  'checkout profile reconciliation must never be optional'
);
assert.match(html, /async function revealExecutionSheet\(sessionId(?:, \{ awaitRender = false \} = \{\})?\)/, 'new execution sessions must force their panel open');
assert.match(html, /await revealExecutionSheet\(data\.connectorSession\.id\)/, 'approved browser actions must reveal their execution sheet');
assert.match(html, /async function approveActionWithRecovery\(actionRunId\)/, 'ambiguous action approval failures must recover automatically');
assert.match(html, /if \(!isAmbiguousActionApprovalError\(error\)\) throw error;[\s\S]*return request\(\);/, 'action approval recovery must retry only ambiguous network failures');
assert.match(serverSource, /if \(actionRun\.status === 'completed'\)[\s\S]*replayed: true/, 'completed action approvals must replay their existing result');
assert.match(serverSource, /connectorSessionId: connectorSession\?\.id \|\| null/, 'completed actions must retain their connector session for idempotent replay');
assert.match(
  html,
  /async function requestNativeRunnerMissionWake\(sessionId = ''\)[\s\S]*setTimeout\(\(\) => resolve\(timeoutResult\), 2000\)/,
  'the page-to-extension wake must have a short, bounded acknowledgement window'
);
assert.match(
  html,
  /sendNativeRunnerExtensionMessage\(\{ type: 'RUN_PENDING_SESSIONS', sessionId \}\)/,
  'the browser UI must target the exact approved connector session when it wakes the runner'
);
const startExecutionSource = html.slice(
  html.indexOf('const startExecutionFromSheet = async () => {'),
  html.indexOf('const resumeCheckoutReconcileFromSheet = async () => {')
);
const startExecutionRequestIndex = startExecutionSource.indexOf('let data = await api(`/connectors/sessions/${session.id}/start-execution`');
const startExecutionWakeIndex = startExecutionSource.indexOf('void requestNativeRunnerMissionWake(data.session?.id || session.id);');
const startExecutionRenderIndex = startExecutionSource.indexOf('await renderExecutionSheet(session.id, { focus: false });', startExecutionRequestIndex);
assert.ok(startExecutionRequestIndex >= 0, 'browser runs must start an execution session');
assert.ok(startExecutionWakeIndex > startExecutionRequestIndex, 'browser runs must wake the runner after a session exists');
assert.ok(
  startExecutionWakeIndex < startExecutionRenderIndex,
  'browser runs must wake the runner before expensive execution-sheet rendering can consume its claim window'
);
assert.doesNotMatch(
  html,
  /requestNativeRunnerMissionWake\(sessionId = '', attempt = 0\)|wake\.pending && attempt < 2/,
  'one browser run must never create duplicate page-to-extension wake requests'
);
assert.match(html, /data-execution-continue-checkout/, 'checkout mismatches must offer an in-place saved-detail repair action');
assert.match(html, /resumeCheckoutReconcile:\s*true/, 'checkout repair must create a narrow reconciliation continuation');
assert.match(html, /function canPlaceReviewedOrderFromSession/, 'verified checkout reviews must expose a Magic City final-order approval path');
assert.match(html, /Approve and place order/, 'the execution UI must make Magic City approval the primary final-order action');
assert.match(html, /finalSubmitApproval/, 'final order approval must send a bounded approval payload to the server');
assert.match(serverSource, /magic-city-final-submit-approval-v1/, 'server must commit final-order approval receipts');
assert.match(serverSource, /finalSubmitApprovalHash/, 'mission contracts must bind the final-order approval hash');
assert.match(
  serverSource,
  /const canDispatchExtensionWake = Boolean\([\s\S]*declarativeExtensionRun[\s\S]*nativeRunnerReadiness\.device[\s\S]*!nativeRunnerReadiness\.extensionUpdateRequired/,
  'only a paired, current declarative extension may receive a direct exact-session wake'
);
assert.match(
  serverSource,
  /if \(!nativeRunnerReadiness\.ready && !canDispatchExtensionWake\) \{[\s\S]*error: 'native_runner_not_ready'/,
  'unpaired, expired, or outdated runners must still be rejected before Magic City reserves a browser mission'
);
assert.match(html, /Confirm delivery address/, 'address handoff must replace generic needs-attention copy');
assert.match(html, /Choose payment method/, 'payment handoff must replace generic needs-attention copy');
assert.match(html, /runState\.actionLabel[\s\S]*data-native-runner-focus-tab/, 'known browser handoffs must promote the prepared tab action to the run summary');
assert.match(
  html,
  /function buildLocalCheckoutProfile\(session\)[\s\S]*readVaultDraftFromInputs\(\)/,
  'checkout must use ZIP-derived locality values from the current unlocked vault draft'
);
assert.match(
  html,
  /checkoutProfileNeeded[\s\S]*unlockVaultWithDevice\('Authorize saved address and payment cue for this checkout'\)[\s\S]*populateVaultLocalitiesFromZip/,
  'purchase runs must request device authorization before sending exact vault checkout data'
);
assert.match(html, /Unlock and retry/, 'missing local checkout data must have a direct unlock-and-retry action');
assert.match(localRunnerExecutor, /productDeliveredPrice/, 'the runner must report visible delivered-price information');
assert.match(localRunnerExecutor, /merchandiseSubtotalEvidenceForSurface/, 'the item budget must use merchandise subtotal evidence');
assert.match(localRunnerExecutor, /visibleProductFulfillmentEvidence/, 'Amazon products must expose Prime\/free-delivery eligibility before cart admission');
assert.match(localRunnerExecutor, /canonicalAddToCartControl/, 'Amazon cart preparation must detect canonical and variant Add to Cart controls');
assert.match(localRunnerLegacyBackground, /waitForPurchasableProduct/, 'candidate selection must wait briefly for dynamically rendered purchase controls');
assert.match(localRunnerLegacyBackground, /Navigation is its own cheap, durable milestone/, 'navigation must checkpoint before expensive merchant DOM inspection');
assert.match(localRunnerLegacyBackground, /page state will be inspected in the next approved step/, 'navigation must hand page-state extraction to the following inspect action');
assert.match(localRunnerBackground, /resumeActiveRun/, 'the lean gateway must retain a bounded recovery path for an already-authorized run');
assert.match(localRunnerBackground, /A heartbeat may resume only a short-lived, user-authorized dispatch/, 'the lean heartbeat must not become an autonomous fresh-mission executor');
assert.match(localRunnerBackground, /Preserve recovery across a service-worker restart/, 'an authorized run must retain recovery across worker restarts');
assert.match(localRunnerBackground, /Keep the external message open through the exact-session claim/, 'an external runner wake must stay alive until it has begun the exact approved mission');
assert.match(localRunnerBackground, /return dispatch\(message, \{ origin \}\);/, 'an external runner wake must execute the requested session directly');
assert.doesNotMatch(localRunnerBackground, /queueExplicitMissionWake|dispatchExplicitMissionWake|EXPLICIT_WAKE_ALARM/, 'the runner must not detach startup into an MV3 one-shot alarm');
assert.match(localRunnerLegacyBackground, /async function pollAndExecute\(requestedSessionId = ''\)/, 'the runner must support an exact approved session target');
assert.match(localRunnerLegacyBackground, /String\(session\?\.id \|\| ''\) === normalizedSessionId/, 'a targeted runner wake must not execute a different queued session');
assert.match(localRunnerLegacyBackground, /async function pollOnly\(\)[\s\S]*extensionRunDispatch\?\.expiresAt[\s\S]*pollAndExecute\(dispatchedSession\.id\)/, 'the heartbeat may recover only an unexpired, user-dispatched extension mission');
assert.match(serverSource, /extensionRunDispatch: hasActiveExtensionRunDispatch\(session\)/, 'the extension poll payload must carry the short-lived user dispatch required for heartbeat recovery');
assert.match(localRunnerExecutor, /function amazonAccountState/, 'Amazon missions must distinguish signed-in, signed-out, and unknown account state');
assert.match(localRunnerExecutor, /function applyAmazonFulfillmentPreference/, 'Amazon search must apply a bounded delivery refinement');
assert.match(localRunnerExecutor, /const selected = primeRequired \? prime : \(prime \|\| freeShipping\)/, 'Prime-only missions must never fall back to a generic free-shipping refinement');
assert.match(browserMissionPlan, /intent: 'prefer_free_delivery'/, 'Amazon mission plans must include a reversible delivery-filter action');
assert.match(localRunnerLegacyBackground, /'add_to_cart', 'checkout', 'prefer_free_delivery'/, 'the signed mission validator must explicitly allow the bounded delivery-filter intent');
assert.match(localRunnerExecutor, /selectPreferredDeliveryOption\(\{ primeRequired = false \} = \{\}\)/, 'checkout must select fastest free delivery and reject paid fallback for Prime-only missions');
assert.match(localRunnerExecutor, /shippingTotalEvidenceForSurface/, 'checkout must verify the final shipping total separately');
assert.match(localRunnerExecutor, /\.a-button/, 'final order submission must inspect Amazon-style nested yellow buttons');
assert.match(localRunnerExecutor, /finalOrderControls\(\)[\s\S]*visibleControlLabel\(root, 220\)/, 'final order submission must use visible wrapper labels');
assert.match(browserMissionPlan, /budgetBasis = 'merchandise_subtotal'/, 'browser mission auth must state that the budget applies to merchandise');
assert.match(browserMissionPlan, /amazon_free_shipping_preferred/, 'Amazon plans must bind the free-delivery preference');
assert.match(browserMissionPlan, /deliveryStrategy: targetDomain === 'amazon\.com' \? 'prime_fastest_free_only'/, 'Amazon plans must bind Prime fastest-free delivery only');
assert.match(browserMissionPlan, /const primeRequired = session\.extensionPrimeRequired === true/, 'Amazon plans must explicitly require Prime evidence');
assert.match(html, /Applies to merchandise\. Tax and delivery are shown separately\./, 'the execution sheet must explain the item-budget basis');
assert.match(localRunnerLegacyBackground, /acquireMissionTab/, 'browser missions must reuse a runner-owned merchant tab');
assert.doesNotMatch(
  localRunnerLegacyBackground,
  /if \(!submitRequested && !preserveForFinalReview\) await clearMissionTab/,
  'terminal handoffs must keep tab ownership so the UI does not open a duplicate tab'
);

function extractFunctionSource(name) {
  const start = html.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing inline function ${name}`);
  const braceStart = html.indexOf('{', start);
  assert.notEqual(braceStart, -1, `missing function body for ${name}`);
  let depth = 0;
  for (let index = braceStart; index < html.length; index += 1) {
    const char = html[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`unterminated inline function ${name}`);
}

const revealExecutionSheetSource = extractFunctionSource('revealExecutionSheet');
assert.doesNotMatch(
  revealExecutionSheetSource,
  /renderExecutionDock\(\)/,
  'revealing an execution sheet must not redraw away the bound run controls'
);

const functionNames = [
  'inferBrowserTargetUrlFromText',
  'parseSmallBudgetWords',
  'inferBrowserBudgetFromText',
  'stripBrowserBudgetPhrases',
  'cleanBrowserTaskText',
  'extractBrowserShoppingItemsFromText',
  'buildBrowserBasketTaskLabel',
  'looksLikeTravelBrowserTask',
  'titleCaseTravelPhrase',
  'inferBrowserTravelTaskFromText',
  'inferBrowserProductFromText',
  'looksLikeCodeAuditExecutionRequest',
  'isCodeAuditAgentChatRequest',
  'isBrowserClarificationResponse',
  'hasRunnableBrowserExecutionContext',
  'buildBrowserMissingExecutionInfoMessage'
];

const context = {};
vm.createContext(context);
vm.runInContext(functionNames.map(extractFunctionSource).join('\n\n'), context);

const prompt = 'nature valley bar from amazon please buy for $4 max';

assert.equal(context.inferBrowserTargetUrlFromText(prompt), 'https://www.amazon.com');
assert.equal(context.inferBrowserBudgetFromText(prompt), '$4');
assert.equal(context.inferBrowserProductFromText(prompt), 'nature valley bar');
assert.equal(context.hasRunnableBrowserExecutionContext(prompt, ''), true);
assert.doesNotMatch(
  context.buildBrowserMissingExecutionInfoMessage(prompt, 'Magic Internet Agent'),
  /items\/task|Before I open/i
);

const buyFirstPrompt = 'buy nature valley granola bars from amazon, four bucks tops';
assert.equal(context.inferBrowserProductFromText(buyFirstPrompt), 'nature valley granola bars');
assert.equal(context.inferBrowserBudgetFromText(buyFirstPrompt), '$4');
assert.equal(context.hasRunnableBrowserExecutionContext(buyFirstPrompt, ''), true);

const householdListPrompt = [
  "here's a list of things to get on amazon, total budget is $100",
  '- lunch yogurt pack',
  '- potato chips',
  '- toilet paper',
  '- new dinner plates'
].join('\n');
assert.equal(JSON.stringify(context.extractBrowserShoppingItemsFromText(householdListPrompt)), JSON.stringify([
  'lunch yogurt pack',
  'potato chips',
  'toilet paper',
  'new dinner plates'
]));
assert.equal(
  context.inferBrowserProductFromText(householdListPrompt),
  '4-item basket: lunch yogurt pack; potato chips; toilet paper; new dinner plates'
);
assert.equal(context.inferBrowserBudgetFromText(householdListPrompt), '$100');

const flattenedCampingAddOnPrompt = 'can you also add this camping list to my cart on amazon, mas $10 extra spend? - bag of marshmallows - graham crackers';
assert.equal(JSON.stringify(context.extractBrowserShoppingItemsFromText(flattenedCampingAddOnPrompt)), JSON.stringify([
  'bag of marshmallows',
  'graham crackers'
]));
assert.equal(
  context.inferBrowserProductFromText(flattenedCampingAddOnPrompt),
  '2-item basket: bag of marshmallows; graham crackers'
);
assert.equal(context.inferBrowserBudgetFromText(flattenedCampingAddOnPrompt), '$10');
assert.equal(context.hasRunnableBrowserExecutionContext(flattenedCampingAddOnPrompt, ''), true);

const twoItemPurchasePrompt = [
  'i want to buy a few things from amazon for under $10 total',
  '- marshmallows',
  "- hershey's chocolate"
].join('\n');
assert.equal(context.hasRunnableBrowserExecutionContext(twoItemPurchasePrompt, ''), true);

const codeAuditRepoPrompt = [
  'i want a code audit',
  'this repo https://github.com/zeko-labs/santa_clawz-private_agents'
].join('\n');
assert.equal(context.looksLikeCodeAuditExecutionRequest(codeAuditRepoPrompt), true);
assert.equal(context.hasRunnableBrowserExecutionContext(codeAuditRepoPrompt, ''), false);
assert.equal(context.isCodeAuditAgentChatRequest('I want a code audit'), true);

console.log('browser mission UI parser ok');
