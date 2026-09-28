import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { readMissionKeyTransition, verifyMissionTokenSignature, buildMissionTransitionManifest } from '../src/missionKeyTransition.js';
import { runLimiterQuery } from '../src/requestRateLimits.js';
import { validateDeployment } from '../src/deploymentSecurity.js';

const oldKey = 'old-fixture-key-'.repeat(4), newKey = 'new-fixture-key-'.repeat(4);
const now = Date.now();
const sign = (payload, key = oldKey) => {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `mcap.${data}.${crypto.createHmac('sha256', key).update(data).digest('base64url')}`;
};
const payload = { issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString(), policy: { maxSpendCredits: 4 }, capabilityId: 'fixture' };
const token = sign(payload);
const manifest = buildMissionTransitionManifest([token, token], oldKey, now);
assert.equal(manifest.tokenSha256.length, 1);
const env = { MISSION_BOUND_AUTH_SECRET: newKey, MISSION_BOUND_AUTH_LEGACY_SECRET: oldKey,
  MISSION_BOUND_AUTH_LEGACY_TOKEN_SHA256: manifest.tokenSha256.join(','),
  MISSION_BOUND_AUTH_LEGACY_CUTOVER_AT: manifest.cutoverAt, MISSION_BOUND_AUTH_LEGACY_ACCEPT_UNTIL: manifest.acceptUntil };
const transition = readMissionKeyTransition(env);
assert.equal(verifyMissionTokenSignature(token, newKey, transition, now), true);
assert.equal(verifyMissionTokenSignature(token, newKey, readMissionKeyTransition(env), now + 1000), true, 'restart preserves exact old token');
assert.equal(verifyMissionTokenSignature(token, newKey, null, now), false);
assert.equal(verifyMissionTokenSignature(token, newKey, transition, now - 1), false);
assert.equal(verifyMissionTokenSignature(token, newKey, transition, now + 60000), false);
assert.equal(verifyMissionTokenSignature(sign(payload, newKey), newKey, transition, now), true);
assert.equal(verifyMissionTokenSignature(sign(payload, newKey), oldKey, null, now), false);
for (const changed of [{ ...payload, policy: { maxSpendCredits: 4000 } }, { ...payload, capabilityId: 'other' }, { ...payload, expiresAt: new Date(now + 120000).toISOString() }]) {
  assert.equal(verifyMissionTokenSignature(sign(changed), newKey, transition, now), false, 'old-key forgery cannot enter exact-token allowlist');
}
assert.equal(verifyMissionTokenSignature(token + '.extra', newKey, transition, now), false);
assert.equal(readMissionKeyTransition({}), null);
for (const key of Object.keys(env).filter(k => k.includes('LEGACY'))) assert.throws(() => validateDeployment({ ...env, [key]: '' }), /transition/);
assert.throws(() => readMissionKeyTransition({ ...env, MISSION_BOUND_AUTH_SECRET: oldKey }), /invalid_secret/);
assert.throws(() => readMissionKeyTransition({ ...env, MISSION_BOUND_AUTH_LEGACY_TOKEN_SHA256: 'not-a-hash' }), /allowlist/);
assert.throws(() => readMissionKeyTransition({ ...env, MISSION_BOUND_AUTH_LEGACY_TOKEN_SHA256: `${manifest.tokenSha256[0]},${manifest.tokenSha256[0]}` }), /allowlist/);
assert.throws(() => buildMissionTransitionManifest([sign(payload, newKey)], oldKey, now), /invalid_source_token/);
assert.throws(() => buildMissionTransitionManifest(Array.from({ length: 257 }, (_, i) => sign({ ...payload, capabilityId: String(i) })), oldKey, now), /drain_excess/);
assert.throws(() => readMissionKeyTransition({ ...env, MISSION_BOUND_AUTH_LEGACY_ACCEPT_UNTIL: new Date(now + 86400001).toISOString() }), /window/);
assert.throws(() => buildMissionTransitionManifest([sign({ ...payload, expiresAt: new Date(now + 86400001).toISOString() })], oldKey, now), /drain_long_lived/);
assert.equal(buildMissionTransitionManifest([sign({ ...payload, expiresAt: new Date(now - 1).toISOString() })], oldKey, now).tokenSha256.length, 0);
// Even a configured allowlist cannot revive an expired/future-issued token.
for (const changed of [{ ...payload, expiresAt: new Date(now).toISOString() }, { ...payload, issuedAt: new Date(now + 1).toISOString() }]) {
  const bad = sign(changed);
  assert.equal(verifyMissionTokenSignature(bad, newKey, { ...transition, hashes: new Set([crypto.createHash('sha256').update(bad).digest('hex')]) }, now), false);
}

for (const failedStep of [null, 'BEGIN', "SET LOCAL statement_timeout = '2000ms'", 'WORK', 'COMMIT']) {
  const queries = []; let released = false, releaseError;
  const error = new Error('simulated timeout');
  const pool = { connect: async () => ({ query: async (sql) => { queries.push(sql); if (sql === failedStep) throw error; return { rows: [] }; }, release: (reason) => { released = true; releaseError = reason; } }) };
  if (failedStep) await assert.rejects(runLimiterQuery(pool, 'WORK'), /simulated timeout/);
  else await runLimiterQuery(pool, 'WORK');
  assert.equal(released, true);
  assert.equal(releaseError, failedStep ? error : undefined);
  assert.deepEqual(queries, ['BEGIN', "SET LOCAL statement_timeout = '2000ms'", 'WORK', 'COMMIT'].slice(0, failedStep ? ['BEGIN', "SET LOCAL statement_timeout = '2000ms'", 'WORK', 'COMMIT'].indexOf(failedStep) + 1 : 4));
}
assert.doesNotMatch(fs.readFileSync(new URL('../src/requestRateLimits.js', import.meta.url), 'utf8'), /statement_timeout\s*:/, 'no unsupported startup timeout parameter');
console.log('Exact-token key transition, bounded legacy expiry, forged-old-token rejection and limiter transaction cleanup passed');
