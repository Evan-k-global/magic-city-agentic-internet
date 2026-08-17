import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalCwd = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-credit-refund-'));

try {
  process.chdir(tempDir);
  const store = await import(`${new URL('../src/store.js', import.meta.url).href}?refund-test=${Date.now()}`);
  const userHash = 'refund-test-user';
  const intentId = 'refund-test-intent';

  store.creditUserAccount(userHash, 1000, 'refund_test');
  assert.equal(store.lockUserCreditsForIntent(userHash, 100, intentId).ok, true);
  assert.equal(store.settleLockedCredits(intentId, 'santaclawz:test-agent').ok, true);
  assert.equal(store.getUserAccount(userHash).available, 900);
  assert.equal(store.getUserAccount(userHash).totalSpent, 100);

  const refunded = store.refundSettledCredits(intentId, 'santaclawz_return_rejected');
  assert.equal(refunded.ok, true);
  assert.equal(refunded.lock.status, 'refunded');
  assert.equal(store.getUserAccount(userHash).available, 1000);
  assert.equal(store.getUserAccount(userHash).totalSpent, 0);

  const duplicate = store.refundSettledCredits(intentId, 'santaclawz_return_rejected');
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.deduped, true);
  assert.equal(store.getUserAccount(userHash).available, 1000);
  assert.equal(store.auditCreditLedger().ok, true);

  console.log('credit settlement refund regression passed');
} finally {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
}
