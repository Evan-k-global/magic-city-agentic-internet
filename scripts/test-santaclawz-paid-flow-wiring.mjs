import assert from 'node:assert/strict';
import fs from 'node:fs';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const santaclawzProvider = fs.readFileSync(new URL('../src/santaclawzAgentProvider.js', import.meta.url), 'utf8');
const providers = fs.readFileSync(new URL('../src/providers.js', import.meta.url), 'utf8');

const conciergeKeyBody = server.match(/function getSantaClawzConciergeApiKey\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
assert.match(conciergeKeyBody, /SANTACLAWZ_CONCIERGE_API_KEY/);
assert.doesNotMatch(conciergeKeyBody, /SANTACLAWZ_API_KEY/);

assert.match(server, /refreshSantaClawzPaidSessionStatus\(latestSession\)/);
assert.match(server, /alreadySubmitted: true/);
assert.match(server, /paymentPayloadIssuedAtIso/);
assert.match(server, /buyerVisibleOutputs/);
assert.match(server, /inlineOutputs/);
assert.match(server, /function buildSantaClawzJobContextForSession/);
assert.match(server, /const matchText = collectAgentMatchText\(intentInput\)/);
assert.match(server, /const codeAuditIntake = await buildCodeAuditChatIntake\(intentInput\)/);
assert.match(server, /const codeAuditRequest = Boolean\(codeAuditIntake\) \|\| isCodeAuditAgentChatRequest\(directMatchText\)/);
assert.match(server, /function isDedicatedCodeAuditAgentCandidate\(agent = \{\}\)/);
assert.match(server, /\.filter\(\(agent\) => !codeAuditOnly \|\| isDedicatedCodeAuditAgentCandidate\(agent\)\)/);
assert.match(server, /Magic City will not substitute another paid agent or reserve credits/);
assert.match(server, /dedicated_code_audit_agent_unavailable/);
assert.match(server, /function isCodeAuditAgentChatRequest\(value = ''\)/);
assert.match(server, /async function buildCodeAuditChatIntake\(intentInput = \{\}\)/);
assert.match(server, /const recentText = recentCodeAuditConversationText\(intentInput\)/);
assert.match(server, /await verifyGithubJobUrlPublicAccess\(githubUrl\)/);
assert.match(server, /await verifyGithubJobUrlPublicAccess\(jobContext\.githubUrls\[0\], \{ force: true \}\)/);
assert.match(server, /info\/refs\?service=git-upload-pack/);
assert.match(server, /anonymous_git_upload_pack/);
assert.match(server, /github_repository_not_publicly_reachable/);
assert.match(server, /github_public_access_verification_unavailable/);
assert.doesNotMatch(server, /repository is private/);
assert.match(server, /Before I hand this to Code Audit Agent, send the public GitHub repository, pull request, or code link/);
assert.match(server, /const creditPrice = demoOnline \? 0 : creditsForSantaClawzAgent\(\{ \.\.\.agent, price \}\)/);
assert.match(server, /\$\{formatUsd\(price\)\} Base USDC · \$\{creditPrice\} credits/);
assert.match(server, /if \(seededInputUrl && isUrlRequirement\(field\)\)/);
assert.match(server, /!isUrlRequirement\(field\)/);
assert.match(server, /function inferExecutionGitHubUrlFromPrompt\(prompt = ''\)/);
assert.match(server, /const kind = codeAuditRequest \? 'developer' : executionKindForCapability\(intentInput\.capability\)/);
assert.match(server, /const magicInternetRequest = isMagicInternetPurchaseRequest\(matchText\)/);
assert.match(server, /reason: 'handled_by_magic_internet_agent'/);
assert.match(server, /isSantaClawzExecutionAgent\(agent\) && !isHiddenAgentCompletionCandidate\(agent\)/);
assert.match(server, /jobContext: directPayment\.jobContext \|\| buildSantaClawzJobContextForSession\(sessionForSubmit\)/);
assert.match(server, /jobContext: directPayment\.jobContext \|\| buildSantaClawzJobContextForSession\(sessionForDirectSubmit\)/);
assert.match(server, /public_github_url_required_for_santaclawz_code_audit/);
assert.match(server, /inputRequirements: agent\?\.metadata\?\.agentInputRequirements/);
assert.match(server, /santaclawz_submit_rejected_http_/);
assert.match(server, /function returnSantaClawzCreditsForTerminalFailure/);
assert.match(server, /summary\.terminalFailure/);
assert.match(server, /summary\.completed && sessionForStatus\.creditReservation\?\.status === 'locked'/);
assert.match(server, /refundSettledCredits\(session\.id, reason\)/);
assert.match(server, /Failed SantaClawz return package must include incident_id|returnRejection\?\.message/);
assert.match(server, /const liveSnapshotAgent = executionAgents\.find/);
assert.match(server, /Never replace it silently when the live directory no longer exposes it/);
assert.doesNotMatch(server, /santaclawz_agent_runtime_quarantined/);
assert.doesNotMatch(server, /summary\.retryBlocked = true/);
assert.doesNotMatch(server, /summary\.safeToCreateFreshPayment = false/);
assert.match(santaclawzProvider, /SantaClawz is authoritative for marketplace\/runtime readiness/);
assert.match(server, /selected_santaclawz_agent_unavailable/);
assert.match(server, /recordSantaClawzRuntimeOutcome/);
assert.match(server, /materializeSantaClawzInlineArtifacts\(\s*sessionForSubmit\.id,/);
assert.match(server, /materializeSantaClawzInlineArtifacts\(\s*sessionForDirectSubmit\.id,/);

assert.match(ui, /start-execution[\s\S]{0,2200}santaclawz-credit-backed\/submit/);
assert.match(ui, /syncSantaClawzActionResultForPolling\(session\.id, data\)/);
assert.match(ui, /softRecommendedAgentExecution/);
assert.match(ui, /promoteSoftRecommendedAgentExecution\(detail\)/);
assert.match(ui, /buildSelectedAgentSelectionsFromExecutionDetail\(created, combinedPrompt, pending\)/);
assert.match(ui, /function hasCodeAuditUrlRequirement\(session = \{\}\)/);
assert.match(ui, /function inferExecutionGitHubUrlFromText\(text = ''\)/);
assert.match(ui, /Got it\. I added that GitHub link to \$\{agentName\}/);
assert.match(ui, /isCodeAuditCompletionAgent\(agent\)/);
assert.match(ui, /looksLikeCodeAuditExecutionRequest\(combined\)/);
assert.match(ui, /looksLikeCodeAuditExecutionRequest\(text\)/);
assert.match(ui, /SantaClawz agent match/);
assert.match(ui, /isSantaClawzRecommendationAgent\(agent\)/);
assert.match(ui, /function formatAgentCompletionIntake\(agent = \{\}\)/);
assert.match(ui, /function formatAgentCompletionCompactMeta\(agent = \{\}\)/);
assert.match(ui, /agent-completion-inline-links/);
assert.match(ui, /agent-completion-status:empty/);
assert.match(ui, /const publishedCreditPrice = Number\(row\.creditPrice \?\? row\.metadata\?\.creditPrice \?\? 0\)/);
assert.match(ui, /Magic City locks this exact amount when you run\. It is spent only after SantaClawz delivers an accepted result/);
assert.match(ui, /credits locked on run/);
assert.match(ui, /if \(reservation\.status === 'settled'\) return ` · \$\{price\} spent`/);
assert.match(ui, /if \(reservation\.status === 'released'\) return ` · \$\{price\} returned`/);
assert.match(ui, /No valid output was delivered\. Credits returned\./);
assert.match(ui, /Agent update required/);
assert.match(ui, /No Base USDC settled; credits returned/);
assert.match(ui, /directPayment\?\.delivery\?\.inlineOutputs/);
assert.doesNotMatch(
  ui.match(/function collectSantaClawzDeliveryItems\(session\)[\s\S]*?return items\.slice\(0, 10\);/)?.[0] || '',
  /directPayment\?\.(?:paymentState|executionState|response)/
);
assert.match(ui, /santaclawz-credit-backed\/submit[\s\S]{0,1200}await refreshCreditsBalance\(\)\.catch\(\(\) => null\)/);
assert.match(ui, /function getMissingAgentInputLabels\(session, selections = null, localPrivateInputs = null\)/);
assert.match(ui, /function startAgentExecutionFromFallback\(sessionId = ''\)/);
assert.match(ui, /data-execution-fallback-run-session/);
assert.match(ui, /const sameAgent = existing\?\.session\?\.handoffData\?\.kind === 'agent'/);
assert.match(ui, /agentInputs\[id\] = detail;/);
assert.match(ui, /return hasRunnableBrowserExecutionContext\(context\.prompt \|\| '', context\.responseText \|\| ''\) \? 'browser' : '';/);
assert.match(
  ui,
  /function looksLikeExecutionInputForSelectedAgent\(text = ''\) \{[\s\S]*?if \(looksLikeCodeAuditExecutionRequest\(value\)\) return false;/
);
assert.match(
  ui,
  /async function maybeRoutePromptToSelectedAgentExecution\(prompt = ''\) \{[\s\S]*?if \(looksLikeCodeAuditExecutionRequest\(detail\)\) \{[\s\S]*?clearSelectedAgentExecution\(\);[\s\S]*?return false;/
);
assert.doesNotMatch(
  ui.match(/async function refreshExecutionSessionForPolling[\s\S]*?\n\s*\}/)?.[0] || '',
  /santaclawz-x402\/status/
);

assert.match(providers, /a public GitHub repository, pull request, or code URL is required; audit focus is optional/);
assert.match(providers, /Do not say you pulled the repository, started, or ran an audit/);

assert.match(santaclawzProvider, /isSantaClawzLocalDevelopmentAgent\(agent\)/);
assert.match(santaclawzProvider, /isLocalDevelopmentUrl/);

console.log('santaclawz paid-flow wiring regression passed');
