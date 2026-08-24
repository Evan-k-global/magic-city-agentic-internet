import assert from 'node:assert/strict';
import {
  advanceBrowserExtensionPlanState,
  buildBrowserExtensionMissionPlan,
  evaluateBrowserExtensionFulfillment,
  initialBrowserExtensionPlanState
} from '../src/browserMissionPlan.js';

const rejectedSearchPage = evaluateBrowserExtensionFulfillment({
  status: 'fulfilled',
  result: {
    browserExecution: {
      finalUrl: 'https://www.amazon.com/s?k=nature+valley+granola+bars&rh=p_36%3A-400',
      stopState: 'step_needs_review',
      checkoutProgress: { productOpened: true, addToCartClicked: false, checkoutOpened: false },
      checkoutSummary: { stage: 'offer' }
    }
  }
});
assert.deepEqual(rejectedSearchPage, {
  status: 'failed',
  accepted: false,
  proofEligible: false,
  reason: 'unverified_browser_terminal_state:step_needs_review'
});

const failedTechnicalStep = evaluateBrowserExtensionFulfillment({
  status: 'failed',
  result: { browserExecution: { stopState: 'step_needs_review' } }
});
assert.equal(failedTechnicalStep.status, 'failed');
assert.equal(failedTechnicalStep.proofEligible, false);

const checkoutReview = evaluateBrowserExtensionFulfillment({
  status: 'fulfilled',
  result: {
    browserExecution: {
      finalUrl: 'https://www.amazon.com/gp/buy/spc/handlers/display.html',
      stopState: 'final_approval_required',
      checkoutProgress: { checkoutOpened: true },
      checkoutSummary: { stage: 'final_review' }
    }
  }
});
assert.equal(checkoutReview.status, 'fulfilled');
assert.equal(checkoutReview.accepted, true);
assert.equal(checkoutReview.proofEligible, true);

const prematurePaymentClaim = evaluateBrowserExtensionFulfillment({
  status: 'fulfilled',
  result: {
    browserExecution: {
      finalUrl: 'https://www.amazon.com/s?k=granola',
      stopState: 'payment_required',
      checkoutProgress: { checkoutOpened: false },
      checkoutSummary: { stage: 'search_results' }
    }
  }
});
assert.equal(prematurePaymentClaim.status, 'failed');
assert.equal(prematurePaymentClaim.proofEligible, false);

const plan = buildBrowserExtensionMissionPlan({
  id: 'cs-terminal-contract',
  handoffData: { kind: 'browser' },
  extensionCheckoutProfileEnabled: true,
  selections: {
    targetUrl: 'https://www.amazon.com/',
    goal: 'Buy Nature Valley granola bars for $4 max',
    budget: '$4'
  }
});
assert.deepEqual(
  plan.actions.slice(0, 5).map((action) => action.id),
  ['open-site', 'select-match', 'prepare-cart', 'open-cart', 'inspect-cart'],
  'Amazon should bind a candidate and add it once before any checkout work'
);
assert.equal(
  plan.actions.some((action) => action.id === 'prefer-delivery-filter'),
  false,
  'Amazon cart preparation must not wait on a search-filter detour'
);
const openCartAction = plan.actions.find((action) => action.id === 'open-cart');
assert.equal(openCartAction?.type, 'navigate');
assert.equal(openCartAction?.intent, 'open_cart');
assert.equal(openCartAction?.preferExistingCartControl, true);
for (const actionId of ['select-match', 'prepare-cart', 'inspect-cart']) {
  const action = plan.actions.find((entry) => entry.id === actionId);
  assert.ok(action, `missing ${actionId}`);
  assert.equal(action.requiredBasketItem, true, `${actionId} must be a required shopping milestone`);
}
assert.equal(plan.actions.find((entry) => entry.id === 'inspect-cart')?.expectedCartItemCount, 1);
assert.equal(plan.actions.find((entry) => entry.id === 'select-match')?.expectedMilestone, 'candidate_selected');
assert.equal(plan.actions.find((entry) => entry.id === 'inspect-cart')?.expectedMilestone, 'cart_confirmed');
assert.equal(plan.actions.find((entry) => entry.id === 'open-checkout')?.expectedMilestone, 'checkout_open');
const planContinueCheckoutIndex = plan.actions.findIndex((entry) => entry.id === 'continue-checkout');
const planPaymentReconcileIndex = plan.actions.findIndex((entry) => entry.id === 'reconcile-payment-profile');
const planInspectReviewIndex = plan.actions.findIndex((entry) => entry.id === 'inspect-review');
assert.ok(planPaymentReconcileIndex > planContinueCheckoutIndex, 'single-item Amazon missions must reconcile after payment-page navigation');
assert.ok(planInspectReviewIndex > planPaymentReconcileIndex, 'final review must follow payment reconciliation');
assert.equal(plan.actions.find((entry) => entry.id === 'inspect-review')?.expectedMilestone, 'final_review_ready');

let milestoneState = initialBrowserExtensionPlanState(plan);
for (const action of plan.actions) {
  const requiredMilestone = action.expectedMilestone || '';
  const missing = advanceBrowserExtensionPlanState(milestoneState, plan, {
    actionId: action.id,
    status: 'completed',
    milestoneProtocol: 'verified-v1',
    verifiedMilestones: []
  });
  if (requiredMilestone) {
    assert.equal(missing.valid, false, `${action.id} must reject an unverified milestone`);
    assert.equal(missing.reason, 'plan_milestone_not_verified');
  } else {
    assert.equal(missing.valid, true);
    milestoneState = missing.state;
    continue;
  }
  const verified = advanceBrowserExtensionPlanState(milestoneState, plan, {
    actionId: action.id,
    status: 'completed',
    milestoneProtocol: 'verified-v1',
    verifiedMilestones: [requiredMilestone]
  });
  assert.equal(verified.valid, true, `${action.id} must accept its verified milestone`);
  milestoneState = verified.state;
}
assert.ok(milestoneState.verifiedMilestones.includes('candidate_selected'));
assert.ok(milestoneState.verifiedMilestones.includes('cart_confirmed'));
assert.ok(milestoneState.verifiedMilestones.includes('checkout_open'));
assert.ok(milestoneState.verifiedMilestones.includes('final_review_ready'));

const unverifiedReview = evaluateBrowserExtensionFulfillment({
  status: 'fulfilled',
  result: {
    browserExecution: {
      milestoneProtocol: 'verified-v1',
      verifiedMilestones: ['checkout_open'],
      finalUrl: 'https://www.amazon.com/gp/buy/spc/handlers/display.html',
      stopState: 'final_approval_required',
      checkoutProgress: { checkoutOpened: true },
      checkoutSummary: { stage: 'final_review' }
    }
  }
});
assert.equal(unverifiedReview.status, 'failed');
assert.equal(unverifiedReview.proofEligible, false);

console.log(JSON.stringify({
  ok: true,
  rejectedSearchPage,
  checkoutReview,
  requiredMilestones: ['select-match', 'prepare-cart', 'inspect-cart']
}, null, 2));
