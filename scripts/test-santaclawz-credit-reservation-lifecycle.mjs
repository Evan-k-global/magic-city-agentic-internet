import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assessStaleSantaClawzCreditRestore,
  hasSantaClawzSubmissionEvidence,
  isActiveCreditReservationSessionStatus
} from '../src/creditReservationLifecycle.js';

assert.equal(isActiveCreditReservationSessionStatus('confirmed'), true);
assert.equal(isActiveCreditReservationSessionStatus('executing'), true);
assert.equal(isActiveCreditReservationSessionStatus('fulfilled'), false);

const serverSource = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const listLocksStart = serverSource.indexOf('function listActiveAccountLocks(');
const listLocksEnd = serverSource.indexOf('\nfunction releaseSessionFundingLock', listLocksStart);
assert.ok(listLocksStart >= 0 && listLocksEnd > listLocksStart);
const confirmedSession = {
  id: 'cs-confirmed-preparation',
  status: 'confirmed',
  updatedAt: new Date().toISOString(),
  handoffData: { kind: 'agent', title: 'Code Audit Agent' },
  creditReservation: { requesterHash: 'credit-test-user', status: 'locked', requiredCredits: 10 }
};
const listActiveAccountLocks = new Function(
  'listConnectorSessions',
  'getEscrowLock',
  'isActiveCreditReservationSessionStatus',
  'STALE_LOCK_WINDOW_MS',
  `${serverSource.slice(listLocksStart, listLocksEnd)}\nreturn listActiveAccountLocks;`
)(
  () => [confirmedSession],
  () => ({ status: 'locked', createdAt: confirmedSession.updatedAt }),
  isActiveCreditReservationSessionStatus,
  30 * 60 * 1000
);
assert.equal(
  listActiveAccountLocks('credit-test-user')[0]?.stale,
  false,
  'a balance refresh must not release a confirmed SantaClawz preparation hold'
);

const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-santaclawz-credit-lifecycle-'));
try {
  process.chdir(tempDir);
  const store = await import(`${new URL('../src/store.js', import.meta.url).href}?santaclawz-credit-lifecycle=${Date.now()}`);
  const userHash = 'credit-test-user';
  const sessionId = 'cs-stale-preparation';
  const amountUnits = 100;
  store.creditUserAccount(userHash, 1000, 'santaclawz_credit_lifecycle_test');
  assert.equal(store.lockUserCreditsForIntent(userHash, amountUnits, sessionId).ok, true);
  assert.equal(store.releaseLockedCredits(sessionId, 'stale_session_lock_released').ok, true);

  const session = {
    id: sessionId,
    status: 'confirmed',
    santaclawzDirectPayment: { status: 'payment_required' }
  };
  const assessment = assessStaleSantaClawzCreditRestore({
    session,
    lock: store.getEscrowLock(sessionId),
    requesterHash: userHash,
    amountUnits,
    creditBacked: true
  });
  assert.equal(assessment.ok, true);
  const restored = store.restoreReleasedCreditsForIntent(userHash, amountUnits, sessionId);
  assert.equal(restored.ok, true);
  assert.equal(restored.restored, true);
  assert.equal(store.getUserAccount(userHash).available, 900);
  assert.equal(store.getUserAccount(userHash).locked, 100);

  const replay = store.restoreReleasedCreditsForIntent(userHash, amountUnits, sessionId);
  assert.equal(replay.ok, true);
  assert.equal(replay.deduped, true);
  assert.equal(store.getUserAccount(userHash).available, 900);
  assert.equal(store.getUserAccount(userHash).locked, 100);

  const submittedSession = {
    ...session,
    santaclawzDirectPayment: {
      status: 'submission_unknown',
      paymentPayloadDigestSha256: 'a'.repeat(64),
      submittedAt: new Date().toISOString()
    }
  };
  assert.equal(hasSantaClawzSubmissionEvidence(submittedSession), true);
  assert.equal(assessStaleSantaClawzCreditRestore({
    session: submittedSession,
    lock: { ...store.getEscrowLock(sessionId), status: 'released', reason: 'stale_session_lock_released' },
    requesterHash: userHash,
    amountUnits,
    creditBacked: true
  }).reason, 'santaclawz_submission_reconciliation_required');

  assert.equal(store.releaseLockedCredits(sessionId, 'user_cancelled').ok, true);
  const wrongRelease = store.restoreReleasedCreditsForIntent(userHash, amountUnits, sessionId);
  assert.equal(wrongRelease.ok, false);
  assert.equal(wrongRelease.reason, 'release_reason_not_restorable');

  const settledSessionId = 'cs-restored-and-settled';
  assert.equal(store.lockUserCreditsForIntent(userHash, amountUnits, settledSessionId).ok, true);
  assert.equal(store.releaseLockedCredits(settledSessionId, 'stale_session_lock_released').ok, true);
  assert.equal(store.restoreReleasedCreditsForIntent(userHash, amountUnits, settledSessionId).ok, true);
  assert.equal(store.settleLockedCredits(settledSessionId, 'santaclawz:agent_job_pack').ok, true);
  assert.equal(store.refundSettledCredits(settledSessionId, 'test_reversal').ok, true);
  assert.equal(store.auditCreditLedger().ok, true);
} finally {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

assert.match(serverSource, /hasSantaClawzSubmissionEvidence\(session\)[\s\S]{0,900}refreshSantaClawzPaidSessionStatus\(session, \{ force: true \}\)/);
assert.match(serverSource, /assessStaleSantaClawzCreditRestore\([\s\S]{0,700}restoreReleasedCreditsForIntent/);

console.log('SantaClawz credit reservation lifecycle regression passed');
