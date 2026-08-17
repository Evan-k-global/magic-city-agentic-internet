import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');

function extractFunctionSource(name) {
  const start = server.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const declarationStart = server.lastIndexOf('\n', start) + 1;
  const paramsStart = server.indexOf('(', start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < server.length; index += 1) {
    if (server[index] === '(') paramsDepth += 1;
    if (server[index] === ')') paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  const braceStart = server.indexOf('{', paramsEnd);
  let depth = 0;
  for (let index = braceStart; index < server.length; index += 1) {
    if (server[index] === '{') depth += 1;
    if (server[index] === '}') depth -= 1;
    if (depth === 0) return server.slice(declarationStart, index + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

const githubUrl = 'https://github.com/zeko-labs/santa_clawz-private_agents';
let repositoryStatus = 'public';
const context = {
  URL,
  isCodeAuditAgentChatRequest(value = '') {
    return /code audit/i.test(String(value || ''));
  },
  extractPublicJobUrlsFromText(value = '') {
    return String(value || '').match(/https?:\/\/[^\s<>"']+/gi) || [];
  },
  isGithubJobUrl(value = '') {
    return /^https?:\/\/(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+/i.test(String(value || ''));
  },
  uniqueStrings(values = []) {
    return [...new Set(values)];
  },
  async verifyGithubJobUrlPublicAccess(value = '') {
    return {
      status: repositoryStatus,
      httpStatus: repositoryStatus === 'not_publicly_reachable' ? 404 : 200,
      repositoryUrl: value
    };
  }
};
vm.createContext(context);
vm.runInContext([
  'recentCodeAuditConversationText',
  'isCodeAuditConversationContinuation',
  'buildCodeAuditChatIntake'
].map(extractFunctionSource).join('\n\n'), context);

const priorContext = [
  { role: 'user', content: 'i want a code audit please' },
  { role: 'assistant', content: 'Send the public GitHub repository for Code Audit Agent.' }
];

const accepted = await context.buildCodeAuditChatIntake({
  prompt: githubUrl,
  context: priorContext
});
assert.equal(accepted.required, false);
assert.equal(accepted.githubUrl, githubUrl);
assert.equal(accepted.repositoryAccess.status, 'public');
assert.match(accepted.message, /Verified public GitHub repository/);
assert.match(accepted.message, /prefill this repository in the dedicated execution sheet/);

const recovered = await context.buildCodeAuditChatIntake({
  prompt: "it's not private",
  context: [
    ...priorContext,
    { role: 'user', content: githubUrl },
    { role: 'assistant', content: 'The repository appears private.' }
  ]
});
assert.equal(recovered.required, false);
assert.equal(recovered.githubUrl, githubUrl);
assert.doesNotMatch(recovered.message, /appears private|repository is private/i);

const unrelated = await context.buildCodeAuditChatIntake({
  prompt: 'what is the weather today?',
  context: priorContext
});
assert.equal(unrelated, null);

repositoryStatus = 'not_publicly_reachable';
const inaccessible = await context.buildCodeAuditChatIntake({
  prompt: githubUrl,
  context: priorContext
});
assert.equal(inaccessible.required, true);
assert.match(inaccessible.message, /could not reach this GitHub repository publicly/);
assert.doesNotMatch(inaccessible.message, /is private/i);

repositoryStatus = 'unavailable';
const unavailable = await context.buildCodeAuditChatIntake({
  prompt: githubUrl,
  context: priorContext
});
assert.equal(unavailable.required, true);
assert.match(unavailable.message, /verification is temporarily unavailable/);
assert.doesNotMatch(unavailable.message, /is private/i);

console.log('code audit chat intake regression passed');
