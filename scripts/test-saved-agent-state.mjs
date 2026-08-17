import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function extractFunctionSource(name) {
  const start = html.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing inline function ${name}`);
  const signatureEnd = html.indexOf(')', start);
  const braceStart = html.indexOf('{', signatureEnd);
  let depth = 0;
  for (let index = braceStart; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`unterminated inline function ${name}`);
}

const storage = new Map();
const localStorage = {
  get length() { return storage.size; },
  key(index) { return [...storage.keys()][index] ?? null; },
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};

const context = {
  SAVED_AGENTS_KEY: 'magic_city_saved_agents_v1',
  localStorage,
  getScopedStorageKey: (key, scope = 'current') => `${key}:${scope}`
};
vm.createContext(context);
vm.runInContext([
  'function getAgentCompletionId(agent = {}) { return String(agent.pluginId || agent.agentId || agent.publicAgentUrl || agent.publicHireUrl || agent.agentName || "").trim().toLowerCase(); }',
  extractFunctionSource('isRetiredAgentCompletionAgent'),
  extractFunctionSource('getSavedAgentStorageKeys'),
  extractFunctionSource('removeSavedAgentFromAllLocalScopes'),
  extractFunctionSource('purgeRetiredSavedAgents')
].join('\n\n'), context);

const retired = { pluginId: 'pitch-deck-review-agent--session_agent_old', agentName: 'Pitch Deck Review Agent' };
const active = { pluginId: 'santaclawz:hosted-code-audit-agent--session_agent_live', agentName: 'Code Audit Agent' };
storage.set('magic_city_saved_agents_v1:current', JSON.stringify([retired, active]));
storage.set('magic_city_saved_agents_v1:guest', JSON.stringify([retired]));

context.purgeRetiredSavedAgents();
assert.deepEqual(JSON.parse(storage.get('magic_city_saved_agents_v1:current')), [active]);
assert.deepEqual(JSON.parse(storage.get('magic_city_saved_agents_v1:guest')), []);

storage.set('magic_city_saved_agents_v1:current', JSON.stringify([active]));
storage.set('magic_city_saved_agents_v1:guest', JSON.stringify([active]));
context.removeSavedAgentFromAllLocalScopes(active.pluginId);
assert.deepEqual(JSON.parse(storage.get('magic_city_saved_agents_v1:current')), []);
assert.deepEqual(JSON.parse(storage.get('magic_city_saved_agents_v1:guest')), []);

console.log('saved agent state regression passed');
