import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
const runner = fs.readFileSync(new URL('../public/native-runner/extension/background-v0.2.js', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const marker = `function ${name}`;
  const functionStart = source.indexOf(marker);
  assert.notEqual(functionStart, -1, `missing ${name}`);
  const start = functionStart >= 6 && source.slice(functionStart - 6, functionStart) === 'async '
    ? functionStart - 6
    : functionStart;
  const parametersStart = source.indexOf('(', functionStart);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  assert.notEqual(parametersEnd, -1, `unterminated ${name} parameters`);
  const braceStart = source.indexOf('{', parametersEnd);
  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated ${name}`);
}

const runnerStatusStart = server.indexOf("if (req.method === 'POST' && /^\\/connectors\\/sessions\\/[^/]+\\/runner-status$/.test(urlPath))");
const runnerStatusEnd = server.indexOf("if (req.method === 'POST' && /^\\/connectors\\/sessions\\/[^/]+\\/rank-candidates$/.test(urlPath))");
assert.notEqual(runnerStatusStart, -1, 'missing runner-status route');
assert.ok(runnerStatusEnd > runnerStatusStart, 'missing route after runner-status');
const runnerStatusRoute = server.slice(runnerStatusStart, runnerStatusEnd);
assert.match(runnerStatusRoute, /advisory: true/);
assert.match(runnerStatusRoute, /return sendAdvisoryJson\(res, 200/);
assert.doesNotMatch(runnerStatusRoute, /recordNativeRunnerActivity|touchNativeRunnerDevice\(/);

const rankCandidatesEnd = server.indexOf("if (req.method === 'POST' && /^\\/connectors\\/sessions\\/[^/]+\\/claim$/.test(urlPath))", runnerStatusEnd);
assert.ok(rankCandidatesEnd > runnerStatusEnd, 'missing route after candidate ranking');
const rankCandidatesRoute = server.slice(runnerStatusEnd, rankCandidatesEnd);
const rankCapacityCheck = rankCandidatesRoute.indexOf('amazonSelectionIntelligenceActiveCalls >= AMAZON_SELECTION_INTELLIGENCE_MAX_CONCURRENCY');
const rankCapacityReserve = rankCandidatesRoute.indexOf('amazonSelectionIntelligenceActiveCalls += 1');
const rankPersistenceWait = rankCandidatesRoute.indexOf('await flushPersistence()');
const rankCapacityRelease = rankCandidatesRoute.indexOf('amazonSelectionIntelligenceActiveCalls = Math.max(0, amazonSelectionIntelligenceActiveCalls - 1)');
assert.ok(rankCapacityCheck >= 0, 'candidate ranking must check provider capacity');
assert.ok(rankCapacityReserve > rankCapacityCheck, 'candidate ranking must reserve capacity after checking it');
assert.ok(rankPersistenceWait > rankCapacityReserve, 'candidate ranking must reserve capacity before its first persistence wait');
assert.ok(rankCapacityRelease > rankPersistenceWait, 'candidate ranking must release capacity after the guarded work');
assert.match(rankCandidatesRoute.slice(rankCapacityReserve, rankCapacityRelease), /try \{/);
assert.match(rankCandidatesRoute.slice(rankPersistenceWait, rankCapacityRelease + 120), /finally \{/);

const registrationStart = server.indexOf("if (req.method === 'POST' && urlPath === '/plugins/register')");
const registrationEnd = server.indexOf("if ((req.method === 'GET' || req.method === 'HEAD')", registrationStart);
assert.notEqual(registrationStart, -1, 'missing plugin registration route');
assert.ok(registrationEnd > registrationStart, 'missing route after plugin registration');
const registrationRoute = server.slice(registrationStart, registrationEnd);
assert.match(registrationRoute, /nativeRunnerRegistrationMatches\(existingPlugin, requestedRegistration\)/);
assert.match(registrationRoute, /registrationReused: true/);
assert.match(registrationRoute, /return sendAdvisoryJson\(res, 200/);
assert.match(registrationRoute, /requirePluginApiKeyOrNativeRunner\(req, \{ body, pluginId: body\.pluginId, advisory: true \}\)/);

const nativePollStart = server.indexOf("const nativeRunnerDevice = assertActiveNativeRunnerBearer(req);");
const nativePollEnd = server.indexOf("const auth = getAuthenticatedContext(req);", nativePollStart);
assert.notEqual(nativePollStart, -1, 'missing native runner queue poll');
assert.ok(nativePollEnd > nativePollStart, 'missing route after native runner queue poll');
const nativePollRoute = server.slice(nativePollStart, nativePollEnd);
assert.match(nativePollRoute, /updateNativeRunnerDeviceEphemeral\(/);
assert.match(nativePollRoute, /const sendPollResponse = watchdogMutated \? sendJson : sendAdvisoryJson/);
assert.match(nativePollRoute, /return sendPollResponse\(res, 200/);
assert.doesNotMatch(nativePollRoute, /touchNativeRunnerDevice\(/);

const watchdogStart = server.indexOf('async function sweepConnectorSessionExecutionWatchdog(');
const watchdogEnd = server.indexOf('function scheduleExecutionWatchdogSweep(', watchdogStart);
assert.notEqual(watchdogStart, -1, 'missing execution watchdog sweep');
assert.ok(watchdogEnd > watchdogStart, 'missing function after execution watchdog sweep');
const watchdogSweep = server.slice(watchdogStart, watchdogEnd);
assert.match(watchdogSweep, /durableMutation = true/);
assert.match(watchdogSweep, /return durableMutation/);

assert.match(server, /native_runner_startup_request/);
assert.match(server, /responseWaitMs/);

const healthStart = server.indexOf("if (req.method === 'GET' && urlPath === '/health')");
const healthEnd = server.indexOf("if (req.method === 'GET' && urlPath === '/network/zeko/status')", healthStart);
assert.notEqual(healthStart, -1, 'missing health route');
assert.ok(healthEnd > healthStart, 'missing route after health');
const healthRoute = server.slice(healthStart, healthEnd);
assert.match(healthRoute, /return sendAdvisoryJson\(res, persistenceReady \? 200 : 503/);
assert.doesNotMatch(healthRoute, /sendJson\(/);

const ephemeralUpdate = extractFunction(store, 'updateNativeRunnerDeviceEphemeral');
assert.doesNotMatch(ephemeralUpdate, /persistState\(/);

const runSession = extractFunction(runner, 'runSession');
assert.match(runSession, /session = await claimSession\(rawSession\);[\s\S]{0,120}let authorityVerifiedAt = Date\.now\(\);/);
assert.match(runSession, /session = await checkpointRunnerStartup[\s\S]{0,160}authorityVerifiedAt = Date\.now\(\);/);
assert.match(runSession, /session = await missionCheckpoint\(session, \{[\s\S]*?\n\s*\}\);\s*authorityVerifiedAt = Date\.now\(\);/);

let advisoryEnded = false;
let durableEnded = false;
const response = (onEnd) => ({
  writeHead: () => {},
  end: () => onEnd()
});
const context = {
  MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE: true,
  flushPersistence: () => new Promise(() => {}),
  console
};
vm.createContext(context);
vm.runInContext([
  extractFunction(server, 'sendJson'),
  extractFunction(server, 'sendAdvisoryJson')
].join('\n'), context);

void context.sendJson(response(() => { durableEnded = true; }), 200, { ok: true });
context.sendAdvisoryJson(response(() => { advisoryEnded = true; }), 200, { ok: true });
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(advisoryEnded, true, 'advisory liveness must not wait for the durable persistence queue');
assert.equal(durableEnded, false, 'durable responses must retain their persistence barrier');

console.log('native runner liveness fast-path regression passed');
