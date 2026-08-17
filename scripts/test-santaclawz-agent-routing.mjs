import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const serverSource = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

function extractConstBlock(name, terminator = '];') {
  const start = serverSource.indexOf(`const ${name} =`);
  assert.notEqual(start, -1, `missing const ${name}`);
  const end = serverSource.indexOf(terminator, start);
  assert.notEqual(end, -1, `missing end for ${name}`);
  return `${serverSource.slice(start, end + terminator.length)};`;
}

function extractFunctionSource(name) {
  const start = serverSource.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  let parenDepth = 0;
  let braceStart = -1;
  for (let index = start; index < serverSource.length; index += 1) {
    const char = serverSource[index];
    if (char === '(') parenDepth += 1;
    if (char === ')') parenDepth -= 1;
    if (char === '{' && parenDepth === 0) {
      braceStart = index;
      break;
    }
  }
  assert.notEqual(braceStart, -1, `missing body for ${name}`);
  let depth = 0;
  for (let index = braceStart; index < serverSource.length; index += 1) {
    const char = serverSource[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return serverSource.slice(start, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

const context = {};
vm.createContext(context);
context.isSantaClawzExecutionAgent = (agent) => agent?.metadata?.source === 'santaclawz';
context.isHiddenAgentCompletionCandidate = () => false;
vm.runInContext([
  extractConstBlock('AGENT_MATCH_STOPWORDS', ']);'),
  extractFunctionSource('tokenizeAgentMatchText'),
  extractFunctionSource('normalizeAgentMatchText'),
  extractFunctionSource('compactAgentMatchText'),
  extractFunctionSource('agentAliasTokens'),
  extractConstBlock('AGENT_CAPABILITY_PHRASES'),
  extractFunctionSource('scoreSantaClawzAgentForQuery'),
  extractFunctionSource('sortSantaClawzAgentMatchEntries'),
  extractFunctionSource('rankSantaClawzFollowUpEntries')
].join('\n\n'), context);

const prompt = 'can i do some devops, smartcontract and image generation from zaitek agent?';
const tokens = context.tokenizeAgentMatchText(prompt);

const zaitek = {
  pluginId: 'santaclawz:zaitek-technologies--session_agent_b4a646d96b37',
  ownerAgentId: 'zaitek-technologies--session_agent_b4a646d96b37',
  metadata: {
    label: 'Zaitek Technologies',
    description: 'DevOps, smart contracts, Image, and video generation specialist. Write code, deploy infrastructure, audit Solidity, generate logos, graphics, and AI videos.',
    source: 'santaclawz',
    hireable: true,
    externalAgentId: 'zaitek-technologies--session_agent_b4a646d96b37',
    supportedLanes: ['developer-tools-agent'],
    tags: ['devops', 'smart contracts', 'image generation'],
    marketplaceTags: {
      inputTypes: ['code', 'prompt'],
      outputTypes: ['images', 'videos', 'deployment plan']
    }
  },
  capabilities: ['developer-tools-agent']
};

const codeAudit = {
  pluginId: 'santaclawz:hosted-code-audit-agent--session_agent_0e86fd7829bd',
  ownerAgentId: 'hosted-code-audit-agent--session_agent_0e86fd7829bd',
  metadata: {
    label: 'Code Audit Agent',
    description: 'LLM-backed code audit agent that reviews submitted code, returns bounded prioritized findings, and provides proof-backed deliverables.',
    source: 'santaclawz',
    hireable: true,
    supportedLanes: ['developer-tools-agent'],
    agentInputRequirements: {
      fields: [
        { id: 'githuburl', label: 'GitHub repository or code link' },
        { id: 'auditfocus', label: 'Audit focus' }
      ]
    }
  },
  capabilities: ['developer-tools-agent']
};

const zaitekScore = context.scoreSantaClawzAgentForQuery(zaitek, tokens, prompt);
const codeAuditScore = context.scoreSantaClawzAgentForQuery(codeAudit, tokens, prompt);

assert.ok(zaitekScore > codeAuditScore, `Zaitek should outrank Code Audit (${zaitekScore} <= ${codeAuditScore})`);
assert.ok(zaitekScore - codeAuditScore >= 100, `explicit Zaitek + capability match should be decisive (${zaitekScore} vs ${codeAuditScore})`);
assert.equal(tokens.includes('smart'), true, 'smartcontract should normalize into smart contract tokens');
assert.equal(tokens.includes('contract'), true, 'smartcontract should normalize into smart contract tokens');

const directPrompt = 'i want to hire the zaitek agent';
const directRanked = context.rankSantaClawzFollowUpEntries([codeAudit, zaitek], {
  queryTokens: context.tokenizeAgentMatchText(directPrompt),
  matchText: directPrompt
});
assert.equal(directRanked[0]?.agent?.metadata?.label, 'Zaitek Technologies', 'direct agent-name requests should route through the SantaClawz directory before lane fallback');
assert.equal(
  serverSource.includes("reason: 'query_matched_santaclawz_directory'"),
  true,
  'chat follow-up should expose the global SantaClawz directory match reason'
);

console.log('santaclawz agent routing regression passed');
