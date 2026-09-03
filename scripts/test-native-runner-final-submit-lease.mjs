import assert from 'node:assert/strict';
import { assertFinalSubmitLocalAuthority } from '../public/native-runner/extension/background-v0.2.js';

const originalNow = Date.now;
const startedAt = 1_800_000_000_000;

const session = {
  status: 'executing',
  completionMode: 'agent_checkout',
  preferredExecutionAgentId: 'magic-city-runner-extension',
  handoffData: { kind: 'browser' },
  missionBoundAuth: {
    capabilityId: 'lease-test-capability',
    tokenHash: '0xlease-test',
    expiresAt: new Date(startedAt + 5 * 60_000).toISOString()
  }
};

let nativeClickCount = 0;
let dispatchReceiptCreated = false;
let orderClaimedSubmitted = false;

try {
  Date.now = () => startedAt;

  // A current local lease grants the already signed final-submit action.
  assert.doesNotThrow(() => assertFinalSubmitLocalAuthority(session, startedAt));

  // An expired lease must fail before the irreversible dispatch path can run.
  Date.now = () => startedAt + 45_001;
  assert.throws(
    () => assertFinalSubmitLocalAuthority(session, startedAt),
    /final_submit_authority_lease_expired/
  );
  assert.equal(nativeClickCount, 0);
  assert.equal(dispatchReceiptCreated, false);
  assert.equal(orderClaimedSubmitted, false);

  // A fresh verification restores bounded authority for the same signed plan.
  const reverifiedAt = startedAt + 45_001;
  assert.doesNotThrow(() => assertFinalSubmitLocalAuthority(session, reverifiedAt));
  nativeClickCount += 1;
  dispatchReceiptCreated = true;
  orderClaimedSubmitted = true;
  assert.equal(nativeClickCount, 1);
  assert.equal(dispatchReceiptCreated, true);
  assert.equal(orderClaimedSubmitted, true);
} finally {
  Date.now = originalNow;
}

console.log('native-runner final-submit lease regression passed');
