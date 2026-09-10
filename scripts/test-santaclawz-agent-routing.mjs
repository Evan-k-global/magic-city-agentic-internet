import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isSantaClawzAuditOfferMessage } from '../src/santaclawzIntegrationPolicy.js';

const serverSource = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const htmlSource = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const policySource = fs.readFileSync(new URL('../src/santaclawzIntegrationPolicy.js', import.meta.url), 'utf8');

for (const prompt of ['code audit', 'audit', 'AUDIT this repo', 'what is a code audit?']) {
  assert.equal(isSantaClawzAuditOfferMessage(prompt), true, prompt);
}
for (const prompt of ['What is a giraffe?', 'review this repository', 'security review', 'audition', 'auditor', 'auditing']) {
  assert.equal(isSantaClawzAuditOfferMessage(prompt), false, prompt);
}

const followUpStart = serverSource.indexOf('async function buildSantaClawzAgentFollowUp');
const followUpEnd = serverSource.indexOf('\nfunction normalizeAgentHubSupportedLanes', followUpStart);
const followUp = serverSource.slice(followUpStart, followUpEnd);
assert.match(followUp, /intentInput\.metadata\?\.prompt \|\| intentInput\.prompt/);
assert.match(followUp, /isSantaClawzAuditOfferMessage\(currentUserMessage\)/);
assert.match(followUp, /SANTACLAWZ_CODE_AUDIT_EXTERNAL_AGENT_ID/);
assert.doesNotMatch(followUp, /collectAgentMatchText|recentCodeAuditConversationText|rankSantaClawzFollowUpEntries/);
assert.doesNotMatch(followUp, /query_matched_santaclawz_directory/);

assert.match(policySource, /MAGIC_CITY_SANTACLAWZ_AGENT_ALLOWLIST/);
assert.match(
  fs.readFileSync(new URL('../src/santaclawzAgentProvider.js', import.meta.url), 'utf8'),
  /externalAgentId === SANTACLAWZ_CODE_AUDIT_EXTERNAL_AGENT_ID\s*\? \['developer-tools-agent'\]/
);
assert.match(
  fs.readFileSync(new URL('../src/santaclawzAgentProvider.js', import.meta.url), 'utf8'),
  /privacyModes\)\.filter\(\(mode\) => \['public', 'private'\]\.includes\(mode\)\)/
);
assert.match(serverSource, /isApprovedSantaClawzAgentId/);
assert.match(serverSource, /santaclawz_enrollment_not_available/);
assert.match(serverSource, /req\.method === 'POST' && agentId\.toLowerCase\(\)\.startsWith\('santaclawz:'\) && !isApprovedSantaClawzAgentId\(agentId\)/);
assert.match(htmlSource, /__MAGIC_CITY_SANTACLAWZ_APPROVED_AGENT_IDS__/);
assert.match(htmlSource, /isApprovedSantaClawzClientAgent/);
const chatSubmitStart = htmlSource.indexOf('async function submitIntentFromChat');
const chatSubmitEnd = htmlSource.indexOf("$('sendBtn').addEventListener", chatSubmitStart);
const chatSubmit = htmlSource.slice(chatSubmitStart, chatSubmitEnd);
assert.match(chatSubmit, /const addAgentIntent = isAddAgentIntent\(prompt\)/);
assert.match(chatSubmit, /if \(addAgentIntent\) attachAddAgentCallToAction/);
const helperHeading = htmlSource.slice(
  htmlSource.indexOf('id="helperPlatformAgentsSection"'),
  htmlSource.indexOf('id="helperPlatformAgentsList"')
);
assert.doesNotMatch(helperHeading, /Add agent/);

console.log('santaclawz agent routing regression passed');
