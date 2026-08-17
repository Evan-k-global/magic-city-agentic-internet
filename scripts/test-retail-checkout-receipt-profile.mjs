import assert from 'node:assert/strict';
import {
  MBA_RETAIL_CHECKOUT_REQUIRED_MILESTONES,
  buildMbaRetailCheckoutReceiptProfile,
  buildMbaRetailCheckoutStepReceipt,
  verifyMbaRetailCheckoutReceiptProfile,
  verifyMbaRetailCheckoutStepReceipt
} from '../src/agentMissionBoundAuth.js';

const base = {
  missionIdHash: 'mission_hash',
  capabilityHash: 'capability_hash',
  policyHash: 'policy_hash',
  holderKeyCommitment: 'holder_thumbprint',
  sessionId: 'cs-retail-receipt-test',
  planHash: 'plan_hash',
  milestoneProtocol: 'verified-v1'
};

const milestoneSets = [
  ['candidate_selected'],
  ['candidate_selected', 'cart_confirmed'],
  ['candidate_selected', 'cart_confirmed', 'checkout_open'],
  ['candidate_selected', 'cart_confirmed', 'checkout_open', 'address_confirmed'],
  ['candidate_selected', 'cart_confirmed', 'checkout_open', 'address_confirmed', 'card_confirmed'],
  ['candidate_selected', 'cart_confirmed', 'checkout_open', 'address_confirmed', 'card_confirmed', 'delivery_confirmed'],
  [...MBA_RETAIL_CHECKOUT_REQUIRED_MILESTONES]
];

let previousStepHash = 'GENESIS';
let previousBoundaryHash = 'GENESIS';
let latestStep = null;
for (const [index, verifiedMilestones] of milestoneSets.entries()) {
  latestStep = buildMbaRetailCheckoutStepReceipt({
    ...base,
    actionId: `action-${index + 1}`,
    actionType: index === milestoneSets.length - 1 ? 'inspect-review' : 'browser_step',
    actionStatus: 'completed',
    verifiedMilestones,
    previousStepHash,
    previousBoundaryHash,
    observedAt: `2026-08-13T00:00:0${index}Z`
  });
  const verified = verifyMbaRetailCheckoutStepReceipt(latestStep, base);
  assert.equal(verified.valid, true, verified.reason);
  previousStepHash = latestStep.stepReceiptHash;
  previousBoundaryHash = `boundary_${index + 1}`;
}

const reviewProfile = buildMbaRetailCheckoutReceiptProfile({
  ...base,
  verifiedMilestones: milestoneSets.at(-1),
  latestStepReceiptHash: latestStep.stepReceiptHash,
  createdAt: '2026-08-13T00:01:00Z'
});
const reviewCheck = verifyMbaRetailCheckoutReceiptProfile(reviewProfile, base);
assert.equal(reviewCheck.valid, true, reviewCheck.reason);
assert.equal(reviewProfile.checkoutReady, true);
assert.equal(reviewProfile.finalSubmitAllowed, false);

const approvalCommitment = 'approval_commitment';
const approvedProfile = buildMbaRetailCheckoutReceiptProfile({
  ...base,
  verifiedMilestones: milestoneSets.at(-1),
  latestStepReceiptHash: latestStep.stepReceiptHash,
  finalApprovalCommitment: approvalCommitment,
  approvalTraceHash: 'trace_hash',
  approvalExpiresAt: '2099-08-13T00:03:00Z',
  createdAt: '2026-08-13T00:01:01Z'
});
const approvedCheck = verifyMbaRetailCheckoutReceiptProfile(approvedProfile, {
  ...base,
  requireActiveApproval: true
});
assert.equal(approvedCheck.valid, true, approvedCheck.reason);
assert.equal(approvedProfile.finalSubmitAllowed, true);

const tampered = { ...approvedProfile, verifiedMilestones: ['candidate_selected'] };
assert.equal(verifyMbaRetailCheckoutReceiptProfile(tampered, base).valid, false);

const expired = { ...approvedProfile, approvalExpiresAt: '2000-01-01T00:00:00Z' };
assert.equal(verifyMbaRetailCheckoutReceiptProfile(expired, {
  ...base,
  requireActiveApproval: true
}).valid, false);

const forgedFinalSubmitStep = buildMbaRetailCheckoutStepReceipt({
  ...base,
  actionId: 'submit-final-order',
  actionType: 'final_submit',
  actionStatus: 'completed',
  verifiedMilestones: ['final_review_ready'],
  previousStepHash: latestStep.stepReceiptHash,
  previousBoundaryHash: 'boundary_approved_review',
  finalApprovalCommitment: approvalCommitment,
  userApproved: true,
  observedAt: '2026-08-13T00:01:02Z'
});
assert.equal(verifyMbaRetailCheckoutStepReceipt(forgedFinalSubmitStep, {
  ...base,
  holderKeyCommitment: 'different_holder_thumbprint'
}).valid, false, 'a final submit receipt cannot be reassigned to another runtime holder');

console.log(JSON.stringify({
  ok: true,
  requiredMilestones: MBA_RETAIL_CHECKOUT_REQUIRED_MILESTONES,
  latestStepHash: latestStep.stepReceiptHash,
  checkoutProfileHash: reviewProfile.profileHash,
  approvedProfileHash: approvedProfile.profileHash
}, null, 2));
