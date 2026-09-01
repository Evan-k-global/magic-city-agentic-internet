import assert from 'node:assert/strict';
import {
  buildBrowserExtensionMissionPlan,
  evaluateBrowserExtensionFulfillment,
  validateBrowserExtensionPlan
} from '../src/browserMissionPlan.js';
import { runAssistedBrowserWorkerExecution } from '../src/browserExecution.js';

const baseSession = {
  id: 'final-review-policy-smoke',
  handoffData: { kind: 'browser' },
  selections: {
    targetUrl: 'https://www.amazon.com',
    goal: 'Buy nature valley granola bars from amazon.com with max spend $4',
    budget: '$4'
  },
  extensionCheckoutProfileEnabled: true
};

const automaticPlan = buildBrowserExtensionMissionPlan({
  ...baseSession,
  selections: {
    ...baseSession.selections,
    finalApprovalPolicy: 'auto_submit_after_verified_checkout'
  }
});

assert.equal(validateBrowserExtensionPlan(automaticPlan).valid, true);
assert.equal(automaticPlan.limits.stopBeforeFinalSubmit, false);
assert.equal(automaticPlan.fulfillmentPolicy, 'amazon_free_shipping_preferred');
assert.equal(automaticPlan.primeRequired, true);
assert.ok(automaticPlan.actions.every((action) => action.fulfillmentPolicy === 'amazon_free_shipping_preferred'));
assert.ok(automaticPlan.actions.every((action) => action.primeRequired === true));
assert.equal(automaticPlan.requireMerchantOrderConfirmation, true);
assert.equal(automaticPlan.actions.at(-3)?.type, 'final_submit');
assert.equal(automaticPlan.actions.at(-3)?.autoSubmitAfterVerifiedCheckout, true);
assert.equal(automaticPlan.actions.at(-3)?.saveMerchantCheckoutDefault, true);
assert.equal(automaticPlan.actions.at(-2)?.awaitMerchantOrderConfirmation, true);
assert.equal(automaticPlan.actions.at(-2)?.expectedMilestone, 'order_submitted');
assert.equal(automaticPlan.actions.at(-2)?.merchantConfirmationTimeoutMs, 90_000);
assert.equal(automaticPlan.merchantConfirmationTimeoutMs, 90_000);

const defaultAmazonPlan = buildBrowserExtensionMissionPlan(baseSession);
assert.equal(validateBrowserExtensionPlan(defaultAmazonPlan).valid, true);
assert.equal(defaultAmazonPlan.limits.stopBeforeFinalSubmit, false);
assert.equal(defaultAmazonPlan.saveMerchantCheckoutDefault, true);
assert.equal(defaultAmazonPlan.requireMerchantOrderConfirmation, true);
assert.equal(defaultAmazonPlan.actions.at(-3)?.type, 'final_submit');
assert.equal(defaultAmazonPlan.actions.at(-3)?.saveMerchantCheckoutDefault, true);
assert.equal(defaultAmazonPlan.actions.at(-2)?.awaitMerchantOrderConfirmation, true);
assert.equal(defaultAmazonPlan.actions.at(-2)?.merchantConfirmationTimeoutMs, 90_000);

const staleLegacyStopPolicy = await runAssistedBrowserWorkerExecution({
  ...baseSession,
  selections: {
    ...baseSession.selections,
    finalApprovalPolicy: 'auto_submit_after_verified_checkout',
    // Older connector payloads included this generic default. The signed
    // Amazon policy must win, otherwise a fresh mission pauses at Place order.
    checkoutRunnerStopBeforeFinalSubmit: true
  }
});
assert.equal(staleLegacyStopPolicy.localCheckoutRunner.finalApprovalPolicy, 'auto_submit_after_verified_checkout');
assert.equal(staleLegacyStopPolicy.localCheckoutRunner.stopBeforeFinalSubmit, false);
assert.equal(staleLegacyStopPolicy.paymentPolicy.finalApprovalPolicy, 'auto_submit_after_verified_checkout');

const reviewPlan = buildBrowserExtensionMissionPlan({
  ...baseSession,
  selections: {
    ...baseSession.selections,
    finalApprovalPolicy: 'pause_before_final_approval'
  }
});

assert.equal(validateBrowserExtensionPlan(reviewPlan).valid, true);
assert.equal(reviewPlan.limits.stopBeforeFinalSubmit, true);
assert.equal(reviewPlan.actions.some((action) => action.type === 'final_submit'), false);
const continueCheckoutIndex = reviewPlan.actions.findIndex((action) => action.id === 'continue-checkout');
const paymentReconcileIndex = reviewPlan.actions.findIndex((action) => action.id === 'reconcile-payment-profile');
const inspectReviewIndex = reviewPlan.actions.findIndex((action) => action.id === 'inspect-review');
assert.ok(
  inspectReviewIndex > continueCheckoutIndex,
  'the lean checkout plan must still verify final review after the checkout transition'
);
assert.ok(
  paymentReconcileIndex > continueCheckoutIndex,
  'single-item checkout must reconcile address/card cues after Amazon enters its payment page'
);
assert.ok(
  inspectReviewIndex > paymentReconcileIndex,
  'final review may be inspected only after the post-navigation payment reconciliation'
);

const approvedResumePlan = buildBrowserExtensionMissionPlan({
  ...baseSession,
  extensionFinalSubmitResume: true,
  selections: {
    ...baseSession.selections,
    finalApprovalPolicy: 'auto_submit_after_verified_checkout'
  }
});

assert.equal(validateBrowserExtensionPlan(approvedResumePlan).valid, true);
assert.equal(approvedResumePlan.resumeFinalSubmit, true);
assert.equal(approvedResumePlan.limits.stopBeforeFinalSubmit, false);
assert.deepEqual(
  approvedResumePlan.actions.map((action) => action.type),
  ['inspect', 'fill_checkout_profile', 'inspect', 'final_submit', 'inspect', 'pause']
);
assert.equal(approvedResumePlan.actions.some((action) => action.type === 'navigate'), false);
assert.equal(approvedResumePlan.actions.find((action) => action.type === 'final_submit')?.maxPrice, 4);

const checkoutReconcilePlan = buildBrowserExtensionMissionPlan({
  ...baseSession,
  extensionCheckoutReconcileResume: true,
  extensionCheckoutReconcileUrl: 'https://www.amazon.com/checkout/p/example?pipelineType=Chewbacca',
  fulfillment: {
    result: {
      browserExecution: {
        finalUrl: 'https://www.amazon.com/checkout/p/example?pipelineType=Chewbacca'
      }
    }
  }
});

assert.equal(validateBrowserExtensionPlan(checkoutReconcilePlan).valid, true);
assert.equal(checkoutReconcilePlan.resumeCheckoutReconcile, true);
assert.equal(checkoutReconcilePlan.resumeCheckoutAutoSubmit, false);
assert.equal(checkoutReconcilePlan.startUrl, 'https://www.amazon.com/checkout/p/example?pipelineType=Chewbacca');
assert.equal(checkoutReconcilePlan.limits.stopBeforeFinalSubmit, true);
assert.deepEqual(
  checkoutReconcilePlan.actions.map((action) => action.type),
  ['navigate', 'fill_checkout_profile', 'click_intent', 'fill_checkout_profile', 'inspect', 'pause']
);
assert.equal(checkoutReconcilePlan.actions[0].preserveExistingCheckout, true);
assert.equal(checkoutReconcilePlan.actions[0].resumeCheckoutReconcile, true);
assert.equal(checkoutReconcilePlan.actions.some((action) => action.type === 'final_submit'), false);

const automaticCheckoutReconcilePlan = buildBrowserExtensionMissionPlan({
  ...baseSession,
  extensionCheckoutReconcileResume: true,
  extensionCheckoutReconcileUrl: 'https://www.amazon.com/checkout/p/example?pipelineType=Chewbacca',
  fulfillment: {
    result: {
      browserExecution: {
        finalUrl: 'https://www.amazon.com/checkout/p/example?pipelineType=Chewbacca'
      }
    }
  },
  selections: {
    ...baseSession.selections,
    finalApprovalPolicy: 'auto_submit_after_verified_checkout'
  }
});

assert.equal(validateBrowserExtensionPlan(automaticCheckoutReconcilePlan).valid, true);
assert.equal(automaticCheckoutReconcilePlan.resumeCheckoutReconcile, true);
assert.equal(automaticCheckoutReconcilePlan.resumeCheckoutAutoSubmit, true);
assert.equal(automaticCheckoutReconcilePlan.limits.stopBeforeFinalSubmit, false);
assert.deepEqual(
  automaticCheckoutReconcilePlan.actions.map((action) => action.type),
  ['navigate', 'fill_checkout_profile', 'click_intent', 'fill_checkout_profile', 'inspect', 'final_submit', 'inspect', 'pause']
);
assert.equal(automaticCheckoutReconcilePlan.actions[0].preserveExistingCheckout, true);
assert.equal(automaticCheckoutReconcilePlan.actions.find((action) => action.type === 'final_submit')?.maxPrice, 4);

const clickedButUnconfirmed = evaluateBrowserExtensionFulfillment({
  status: 'fulfilled',
  result: {
    browserExecution: {
      finalSubmitRequested: true,
      milestoneProtocol: 'verified-v1',
      verifiedMilestones: ['checkout_open', 'final_submit_requested'],
      checkoutSummary: { stage: 'final_review' }
    }
  }
});
assert.equal(clickedButUnconfirmed.accepted, false);
assert.equal(clickedButUnconfirmed.proofEligible, false);
assert.equal(clickedButUnconfirmed.reason, 'merchant_order_confirmation_missing');

const merchantConfirmed = evaluateBrowserExtensionFulfillment({
  status: 'fulfilled',
  result: {
    browserExecution: {
      orderSubmitted: true,
      milestoneProtocol: 'verified-v1',
      verifiedMilestones: ['checkout_open', 'final_submit_requested', 'order_submitted'],
      checkoutSummary: { stage: 'final_review' }
    }
  }
});
assert.equal(merchantConfirmed.accepted, true);
assert.equal(merchantConfirmed.proofEligible, true);

console.log('browser final review policy and merchant confirmation contract ok');
