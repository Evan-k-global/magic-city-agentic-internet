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

const autoSubmitPlan = buildBrowserExtensionMissionPlan({
  id: 'cs-terminal-auto-submit',
  handoffData: { kind: 'browser' },
  extensionCheckoutProfileEnabled: true,
  extensionFinalSubmitEnabled: true,
  selections: {
    targetUrl: 'https://www.amazon.com/',
    goal: 'Buy Nature Valley granola bars for $4 max',
    budget: '$4',
    finalApprovalPolicy: 'auto_submit_after_verified_checkout'
  }
});
assert.equal(autoSubmitPlan.limits.stopBeforeFinalSubmit, false, 'unchecked final review must authorize one verified final submit');
assert.equal(
  autoSubmitPlan.actions.some((action) => action.type === 'final_submit' && action.autoSubmitAfterVerifiedCheckout === true),
  true,
  'unchecked final review must include a signed auto-submit action'
);

const reviewPlan = buildBrowserExtensionMissionPlan({
  id: 'cs-terminal-manual-review',
  handoffData: { kind: 'browser' },
  extensionCheckoutProfileEnabled: true,
  extensionFinalSubmitEnabled: true,
  selections: {
    targetUrl: 'https://www.amazon.com/',
    goal: 'Buy Nature Valley granola bars for $4 max',
    budget: '$4',
    finalApprovalPolicy: 'pause_before_final_approval'
  }
});
assert.equal(reviewPlan.limits.stopBeforeFinalSubmit, true, 'explicit final review must retain the boundary');
assert.equal(
  reviewPlan.actions.some((action) => action.type === 'final_submit'),
  false,
  'manual-review plans must not carry a final-submit action'
);

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

const failedFinalDispatch = evaluateBrowserExtensionFulfillment({
  status: 'failed',
  result: {
    browserExecution: {
      finalUrl: 'https://www.amazon.com/gp/buy/spc/handlers/display.html',
      stopState: 'final_submit_dispatch_failed',
      checkoutProgress: { checkoutOpened: true },
      checkoutSummary: { stage: 'final_review' }
    }
  }
});
assert.equal(failedFinalDispatch.accepted, false, 'a final click that did not dispatch must never be accepted as an order');
assert.equal(failedFinalDispatch.proofEligible, false);

const confirmedOrderWithStaleCheckoutSummary = evaluateBrowserExtensionFulfillment({
  status: 'fulfilled',
  result: {
    browserExecution: {
      milestoneProtocol: 'verified-v1',
      verifiedMilestones: ['checkout_open', 'final_review_ready', 'final_submit_requested', 'order_submitted'],
      finalUrl: 'https://www.amazon.com/gp/buy/thankyou/handlers/display.html',
      stopState: 'order_submitted',
      orderSubmitted: true,
      checkoutProgress: { checkoutOpened: true },
      // A navigation can leave the last checkout observation stale. The
      // confirmation milestone is terminal and must win over these fields.
      checkoutSummary: {
        stage: 'final_review',
        addressVerification: 'unverified',
        cardMatches: false
      }
    }
  }
});
assert.equal(confirmedOrderWithStaleCheckoutSummary.status, 'fulfilled');
assert.equal(confirmedOrderWithStaleCheckoutSummary.accepted, true);
assert.equal(confirmedOrderWithStaleCheckoutSummary.reason, 'order_submitted');

console.log(JSON.stringify({
  ok: true,
  rejectedSearchPage,
  checkoutReview,
  autoSubmitAuthorized: autoSubmitPlan.limits.stopBeforeFinalSubmit === false,
  requiredMilestones: ['select-match', 'prepare-cart', 'inspect-cart']
}, null, 2));
