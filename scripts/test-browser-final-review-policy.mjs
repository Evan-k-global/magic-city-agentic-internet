import assert from 'node:assert/strict';
import {
  buildBrowserExtensionMissionPlan,
  validateBrowserExtensionPlan
} from '../src/browserMissionPlan.js';

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
assert.equal(automaticPlan.actions.at(-2)?.type, 'final_submit');
assert.equal(automaticPlan.actions.at(-2)?.autoSubmitAfterVerifiedCheckout, true);
assert.equal(automaticPlan.actions.at(-2)?.saveMerchantCheckoutDefault, true);

const defaultAmazonPlan = buildBrowserExtensionMissionPlan(baseSession);
assert.equal(validateBrowserExtensionPlan(defaultAmazonPlan).valid, true);
assert.equal(defaultAmazonPlan.limits.stopBeforeFinalSubmit, false);
assert.equal(defaultAmazonPlan.saveMerchantCheckoutDefault, true);
assert.equal(defaultAmazonPlan.actions.at(-2)?.type, 'final_submit');
assert.equal(defaultAmazonPlan.actions.at(-2)?.saveMerchantCheckoutDefault, true);

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
assert.ok(
  reviewPlan.actions.findIndex((action) => action.id === 'inspect-review')
    > reviewPlan.actions.findIndex((action) => action.id === 'continue-checkout'),
  'the lean checkout plan must still verify final review after the checkout transition'
);
assert.equal(
  reviewPlan.actions.some((action) => action.id === 'reconcile-payment-profile'),
  false,
  'single-item Amazon happy path uses the checkout transition reconcile instead of a duplicate visible step'
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
  ['inspect', 'fill_checkout_profile', 'inspect', 'final_submit', 'pause']
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
assert.equal(checkoutReconcilePlan.startUrl, 'https://www.amazon.com/checkout/p/example?pipelineType=Chewbacca');
assert.equal(checkoutReconcilePlan.limits.stopBeforeFinalSubmit, true);
assert.deepEqual(
  checkoutReconcilePlan.actions.map((action) => action.type),
  ['navigate', 'fill_checkout_profile', 'inspect', 'pause']
);
assert.equal(checkoutReconcilePlan.actions.some((action) => action.type === 'final_submit'), false);

console.log('browser final review policy ok');
