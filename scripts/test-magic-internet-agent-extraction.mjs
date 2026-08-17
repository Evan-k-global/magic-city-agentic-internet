import assert from 'node:assert/strict';
import { buildActionPlan, buildActionPlanAsync, inferCapabilityFromPrompt, isMagicInternetPurchaseRequest, looksLikeCodeAuditRequest } from '../src/actionRuntime.js';
import { extractBrowserShoppingItems, inferUsdBudgetLabel, stripUsdBudgetPhrases } from '../src/browserMissionExtraction.js';
import { buildBrowserRetailSearchQuery } from '../src/browserExecution.js';
import { buildBrowserExtensionMissionPlan, validateBrowserExtensionPlan } from '../src/browserMissionPlan.js';

const agent = { agentId: 'browser-worker-agent' };

const codeAuditRepoPrompt = [
  'i want a code audit',
  'this repo https://github.com/zeko-labs/santa_clawz-private_agents'
].join('\n');
assert.equal(looksLikeCodeAuditRequest(codeAuditRepoPrompt), true);
assert.equal(inferCapabilityFromPrompt(codeAuditRepoPrompt), 'general-chat');
assert.equal(isMagicInternetPurchaseRequest(codeAuditRepoPrompt), false);
assert.equal(buildActionPlan({ agent, prompt: codeAuditRepoPrompt }), null, 'repo code-audit prompts must not create a Magic Internet Agent plan');
assert.equal(
  await buildActionPlanAsync({
    agent,
    prompt: codeAuditRepoPrompt,
    schemaExtractor: async () => {
      throw new Error('code audit prompts should not call the browser schema extractor');
    }
  }),
  null
);

const budgetCases = [
  ['i want to buy nature valley granola bars from amazon, $4 max spend', '$4'],
  ['buy granola bars from amazon under $4', '$4'],
  ['buy granola bars from amazon max spend of $4', '$4'],
  ['can you add graham crackers to my cart on amazon, mas $10 extra spend?', '$10'],
  ['add graham crackers to my cart on amazon, $10 extra spend', '$10'],
  ['buy granola bars from amazon for 4 dollars max', '$4'],
  ['buy granola bars from amazon no more than 4 dollars', '$4'],
  ['buy granola bars from amazon, four bucks tops', '$4'],
  ['buy granola bars from amazon under twenty five dollars', '$25'],
  ['$4000', '$4000'],
  ['total budget including flights is $4000', '$4000']
];

for (const [prompt, expected] of budgetCases) {
  assert.equal(inferUsdBudgetLabel(prompt), expected, `budget extraction failed for: ${prompt}`);
}

assert.equal(
  stripUsdBudgetPhrases('nature valley granola bars $4 max spend from amazon').replace(/\s+/g, ' ').trim(),
  'nature valley granola bars from amazon'
);

const defaultAmazonPrompt = 'i want to buy nature valley granola bars for $4 max spend';
const defaultAmazonPlan = buildActionPlan({ agent, prompt: defaultAmazonPrompt });
assert.notEqual(defaultAmazonPlan?.mode, 'clarify', 'retail purchase prompts with an item and budget should default to Amazon');
assert.equal(defaultAmazonPlan?.localContext?.targetUrl, 'https://www.amazon.com');
assert.equal(defaultAmazonPlan?.localContext?.budget, '$4');
assert.equal(isMagicInternetPurchaseRequest(defaultAmazonPrompt), true);
assert.equal(inferCapabilityFromPrompt(defaultAmazonPrompt), 'browser-worker-agent');
const defaultAmazonProviderFailurePlan = await buildActionPlanAsync({
  agent,
  prompt: defaultAmazonPrompt,
  schemaExtractor: async () => {
    throw new Error('provider_empty_content:openrouter');
  }
});
assert.equal(defaultAmazonProviderFailurePlan?.localContext?.targetUrl, 'https://www.amazon.com');
assert.equal(defaultAmazonProviderFailurePlan?.localContext?.budget, '$4');

const flattenedCampingAddOnPrompt = 'can you also add this camping list to my cart on amazon, mas $10 extra spend? - bag of marshmallows - graham crackers';
assert.deepEqual(extractBrowserShoppingItems(flattenedCampingAddOnPrompt), [
  'bag of marshmallows',
  'graham crackers'
]);
const campingAddOnPlan = buildActionPlan({ agent, prompt: flattenedCampingAddOnPrompt });
assert.notEqual(campingAddOnPlan.mode, 'clarify', 'inline add-on list should create a runnable basket mission');
assert.equal(campingAddOnPlan.localContext?.targetUrl, 'https://www.amazon.com');
assert.equal(campingAddOnPlan.localContext?.budget, '$10');
assert.equal(campingAddOnPlan.localContext?.budgetScope, 'incremental_cart_addition');
assert.deepEqual(campingAddOnPlan.localContext?.shoppingItems, [
  'bag of marshmallows',
  'graham crackers'
]);
assert.match(campingAddOnPlan.localContext?.goal || '', /2-item basket/i);
const campingAddOnExtensionPlan = buildBrowserExtensionMissionPlan({
  id: 'test-camping-add-on',
  selections: {
    targetUrl: campingAddOnPlan.localContext.targetUrl,
    budget: campingAddOnPlan.localContext.budget,
    budgetScope: campingAddOnPlan.localContext.budgetScope,
    goal: flattenedCampingAddOnPrompt,
    shoppingItems: campingAddOnPlan.localContext.shoppingItems
  },
  localContext: campingAddOnPlan.localContext
});
assert.equal(validateBrowserExtensionPlan(campingAddOnExtensionPlan).valid, true);
assert.equal(campingAddOnExtensionPlan.query, 'bag of marshmallows');
assert.equal(campingAddOnExtensionPlan.budgetScope, 'incremental_cart_addition');
assert.equal(campingAddOnExtensionPlan.shoppingSearchMode, 'best_match_per_item');
assert.equal(campingAddOnExtensionPlan.maxPrice, 10);
assert.equal(campingAddOnExtensionPlan.maxItemPrice, 5);
assert.deepEqual(campingAddOnExtensionPlan.sharedConstraints?.basketItemBudgets, [5, 5]);
assert.equal(campingAddOnExtensionPlan.sharedConstraints?.budgetStrategy, 'reserved_per_item_then_merchandise_subtotal_guard');
assert.equal(campingAddOnExtensionPlan.sharedConstraints?.selectionStrategy, 'prime_only_then_price_then_quality');
assert.equal(campingAddOnExtensionPlan.primeRequired, true);
assert.ok(campingAddOnExtensionPlan.actions.every((action) => action.primeRequired === true));
assert.deepEqual(campingAddOnExtensionPlan.plannedItems, [
  'bag of marshmallows',
  'graham crackers'
]);
assert.deepEqual(campingAddOnExtensionPlan.remainingItems, []);
assert.deepEqual(campingAddOnExtensionPlan.itemSearches.map((item) => item.query), [
  'bag of marshmallows',
  'graham crackers'
]);
assert.deepEqual(campingAddOnExtensionPlan.itemSearches.map((item) => item.maxItemPrice), [5, 5]);
assert.equal(campingAddOnExtensionPlan.sharedConstraints?.budgetScope, 'incremental_cart_addition');
assert.equal(campingAddOnExtensionPlan.sharedConstraints?.executionStrategy, 'sequential_item_additions');
assert.match(campingAddOnExtensionPlan.startUrl, /k=bag\+of\+marshmallows/);
assert.ok(campingAddOnExtensionPlan.actions.some((action) => action.query === 'graham crackers'));
assert.deepEqual(campingAddOnExtensionPlan.actions
  .filter((action) => /-(?:1|2)$/.test(action.id))
  .map((action) => action.id), [
    'search-item-1', 'inspect-results-1', 'prefer-delivery-filter-1', 'select-match-1', 'prepare-cart-1', 'verify-cart-1',
    'search-item-2', 'inspect-results-2', 'prefer-delivery-filter-2', 'select-match-2', 'prepare-cart-2', 'verify-cart-2'
  ]);
assert.ok(campingAddOnExtensionPlan.actions
  .filter((action) => /^(?:select-match|prepare-cart)-\d+$/.test(action.id))
  .every((action) => action.requiredBasketItem === true && action.optional !== true));
assert.deepEqual(campingAddOnExtensionPlan.actions
  .filter((action) => /^verify-cart-\d+$/.test(action.id))
  .map((action) => action.expectedCartItemCount), [1, 2]);

const campingListPrompt = [
  "here's my camping list, can you please find all these things on amazon and checkout. please less than $400 total spend",
  'Camera',
  'Notebook',
  'Art supplies',
  'Cards or other games',
  'Book',
  'Portable speakers for hanging out in camp',
  'Beer, wine, spirits, or beverage of choice',
  'Hammock',
  'Folding chairs',
  'Sun canopy',
  'Lanterns',
  'String lights'
].join('\n');
assert.deepEqual(extractBrowserShoppingItems(campingListPrompt), [
  'Camera', 'Notebook', 'Art supplies', 'Cards or other games', 'Book',
  'Portable speakers for hanging out in camp', 'Beer, wine, spirits, or beverage of choice',
  'Hammock', 'Folding chairs', 'Sun canopy', 'Lanterns', 'String lights'
]);
const campingListPlan = buildActionPlan({ agent, prompt: campingListPrompt });
assert.notEqual(campingListPlan.mode, 'clarify', 'items + website + budget should create a runnable basket mission');
assert.equal(campingListPlan.connector, 'browser-worker-demo-v1');
assert.equal(campingListPlan.localContext?.targetUrl, 'https://www.amazon.com');
assert.equal(campingListPlan.localContext?.budget, '$400');
assert.equal(campingListPlan.localContext?.shoppingItems?.length, 11, 'age-restricted beverage line should stay out of autonomous basket execution');
assert.match(campingListPlan.localContext?.goal || '', /11-item basket/i);
assert.match(campingListPlan.localContext?.goal || '', /best matching option for each item/i);
assert.doesNotMatch(campingListPlan.localContext?.goal || '', /all these things/i);
const campingExtensionPlan = buildBrowserExtensionMissionPlan({
  id: 'test-camping',
  selections: {
    targetUrl: campingListPlan.localContext.targetUrl,
    budget: campingListPlan.localContext.budget,
    goal: campingListPlan.localContext.goal,
    shoppingItems: campingListPlan.localContext.shoppingItems
  },
  localContext: campingListPlan.localContext
});
assert.equal(validateBrowserExtensionPlan(campingExtensionPlan).valid, true);
assert.equal(campingExtensionPlan.shoppingSearchMode, 'best_match_per_item');
assert.deepEqual(campingExtensionPlan.plannedItems, [
  'Camera',
  'Notebook',
  'Art supplies',
  'Cards or other games',
  'Book',
  'Portable speakers for hanging out in camp',
  'Hammock',
  'Folding chairs'
]);
assert.deepEqual(campingExtensionPlan.remainingItems, ['Sun canopy', 'Lanterns', 'String lights']);
assert.ok(campingExtensionPlan.actions.length <= 64, 'extension safety cap should preserve bounded basket missions');
assert.ok(campingExtensionPlan.actions.some((action) => action.query === 'Camera'));
assert.ok(campingExtensionPlan.actions.some((action) => action.query === 'Notebook'));
assert.ok(campingExtensionPlan.actions.some((action) => action.query === 'Folding chairs'));
assert.equal(campingExtensionPlan.itemSearches.length, 8);

const amazonHouseholdListPrompt = [
  "here's a list of things to get on amazon, total budget is $100",
  '- lunch yogurt pack',
  '- potato chips',
  '- toilet paper',
  '- new dinner plates'
].join('\n');
assert.deepEqual(extractBrowserShoppingItems(amazonHouseholdListPrompt), [
  'lunch yogurt pack',
  'potato chips',
  'toilet paper',
  'new dinner plates'
]);
const amazonHouseholdListPlan = buildActionPlan({ agent, prompt: amazonHouseholdListPrompt });
assert.notEqual(amazonHouseholdListPlan.mode, 'clarify', 'generic list-of-things prompt with site + budget should create a basket mission');
assert.equal(amazonHouseholdListPlan.connector, 'browser-worker-demo-v1');
assert.equal(amazonHouseholdListPlan.localContext?.targetUrl, 'https://www.amazon.com');
assert.equal(amazonHouseholdListPlan.localContext?.budget, '$100');
assert.equal(amazonHouseholdListPlan.localContext?.shoppingItems?.length, 4);
assert.match(amazonHouseholdListPlan.localContext?.goal || '', /4-item basket/i);
assert.match(amazonHouseholdListPlan.localContext?.goal || '', /best matching option for each item/i);
assert.match(amazonHouseholdListPlan.localContext?.goal || '', /lunch yogurt pack/i);
assert.doesNotMatch(amazonHouseholdListPlan.localContext?.goal || '', /here's a list/i);
const amazonHouseholdExtensionPlan = buildBrowserExtensionMissionPlan({
  id: 'test-household-list',
  selections: {
    targetUrl: amazonHouseholdListPlan.localContext.targetUrl,
    budget: amazonHouseholdListPlan.localContext.budget,
    goal: amazonHouseholdListPlan.localContext.goal,
    shoppingItems: amazonHouseholdListPlan.localContext.shoppingItems
  },
  localContext: amazonHouseholdListPlan.localContext
});
assert.equal(validateBrowserExtensionPlan(amazonHouseholdExtensionPlan).valid, true);
assert.equal(amazonHouseholdExtensionPlan.shoppingSearchMode, 'best_match_per_item');
assert.deepEqual(amazonHouseholdExtensionPlan.plannedItems, ['lunch yogurt pack', 'potato chips', 'toilet paper', 'new dinner plates']);
assert.deepEqual(amazonHouseholdExtensionPlan.remainingItems, []);
assert.deepEqual(amazonHouseholdExtensionPlan.itemSearches.map((item) => item.query), [
  'lunch yogurt pack',
  'potato chips',
  'toilet paper',
  'new dinner plates'
]);
assert.equal(amazonHouseholdExtensionPlan.sharedConstraints?.targetDomain, 'amazon.com');
assert.ok(amazonHouseholdExtensionPlan.actions.some((action) => action.query === 'new dinner plates'));
const amazonElectronicsListPrompt = [
  'amazon please find the best options under $75 total:',
  '- wireless mouse',
  '- usb c cable',
  '- laptop stand'
].join('\n');
const amazonElectronicsPlan = buildActionPlan({ agent, prompt: amazonElectronicsListPrompt });
assert.equal(amazonElectronicsPlan.mode, 'clarify', 'comparison/research stays in standard LLM chat until the user asks to buy');
assert.equal(isMagicInternetPurchaseRequest(amazonElectronicsListPrompt), false);
assert.equal(inferCapabilityFromPrompt(amazonElectronicsListPrompt), 'general-chat');
assert.equal(
  buildBrowserRetailSearchQuery({
    goal: 'Buy i really want to get some nature valley granola bars from amazon.com with max spend $4',
    constraints: ''
  }),
  'nature valley granola bars'
);

const prompt = 'i want to buy nature valley granola bars from amazon, $4 max spend';
assert.equal(isMagicInternetPurchaseRequest(prompt), true);
assert.equal(inferCapabilityFromPrompt(prompt), 'browser-worker-agent');
const plan = buildActionPlan({ agent, prompt });

assert.ok(plan, 'expected an action plan');
assert.notEqual(plan.mode, 'clarify', 'prompt already includes site, item, and max spend');
assert.equal(plan.connector, 'browser-worker-demo-v1');
assert.equal(plan.localContext?.targetUrl, 'https://www.amazon.com');
assert.equal(plan.localContext?.budget, '$4');
assert.match(plan.localContext?.goal || '', /nature valley granola bars/i);
assert.match(plan.preview || '', /Budget: \$4/);

assert.equal(isMagicInternetPurchaseRequest('can you compare granola bars on amazon?'), false);
assert.equal(inferCapabilityFromPrompt('can you compare granola bars on amazon?'), 'general-chat');
assert.equal(isMagicInternetPurchaseRequest('i want to buy something from amazon'), false);
assert.equal(inferCapabilityFromPrompt('i want to buy something from amazon'), 'general-chat');
assert.equal(inferCapabilityFromPrompt('help me apply to jobs on LinkedIn'), 'general-chat');

let extractorCalls = 0;
const fastPlan = await buildActionPlanAsync({
  agent,
  prompt,
  schemaExtractor: async () => {
    extractorCalls += 1;
    return null;
  }
});
assert.equal(extractorCalls, 0, 'clear single-item browser missions should skip the schema pass');
assert.match(fastPlan.preview || '', /Budget: \$4/);

const llmCorrectedPlan = await buildActionPlanAsync({
  agent,
  prompt: 'i want to buy nature valley granol abars from amazon, $4 max spend',
  schemaExtractor: async () => ({
    targetUrl: 'https://www.amazon.com',
    merchant: 'amazon.com',
    item: 'Nature Valley granola bars',
    budget: '$4',
    currency: 'USD',
    confidence: 0.94,
    providerId: 'openrouter-free',
    model: 'test-model',
    latencyMs: 31
  })
});
assert.notEqual(llmCorrectedPlan.mode, 'clarify');
assert.match(llmCorrectedPlan.localContext?.goal || '', /nature valley granola bars/i);
assert.equal(llmCorrectedPlan.localContext?.browserMissionExtraction?.source, 'openrouter_schema');

const llmBasketPlan = await buildActionPlanAsync({
  agent,
  prompt: [
    'i want to buy a few things from amazon for under $10 total',
    '- marshmallows',
    "- hershey's chocolate"
  ].join('\n'),
  schemaExtractor: async () => ({
    targetUrl: 'https://www.amazon.com',
    merchant: 'amazon.com',
    items: ['marshmallows', "Hershey's chocolate"],
    budget: '$10',
    budgetScope: 'total_checkout',
    preferences: {
      quality: 'prefer well-rated options',
      delivery: 'free delivery preferred',
      reviews: 'good ratings'
    },
    confidence: 0.91,
    providerId: 'openrouter-free',
    model: 'test-model',
    latencyMs: 28
  })
});
assert.deepEqual(llmBasketPlan.localContext?.shoppingItems, ['marshmallows', "hershey's chocolate"]);
assert.match(llmBasketPlan.localContext?.goal || '', /good ratings/i);
assert.equal(llmBasketPlan.localContext?.sharedConstraints?.budget, '$10');

const spokenBudgetPlan = await buildActionPlanAsync({
  agent,
  prompt: 'buy nature valley granola bars from amazon, four bucks tops',
  schemaExtractor: async () => {
    throw new Error('spoken budget should be deterministic');
  }
});
assert.notEqual(spokenBudgetPlan.mode, 'clarify');
assert.match(spokenBudgetPlan.preview || '', /Budget: \$4/);

const reversedBuyPlan = await buildActionPlanAsync({
  agent,
  prompt: 'nature valley bar from amazon please buy for $4 max',
  schemaExtractor: async () => {
    throw new Error('reversed buy phrasing should be deterministic');
  }
});
assert.notEqual(reversedBuyPlan.mode, 'clarify', 'item before merchant plus later buy verb should still be runnable');
assert.equal(reversedBuyPlan.localContext?.targetUrl, 'https://www.amazon.com');
assert.equal(reversedBuyPlan.localContext?.budget, '$4');
assert.match(reversedBuyPlan.localContext?.goal || '', /nature valley bar/i);
assert.doesNotMatch(reversedBuyPlan.localContext?.goal || '', /\bfor\b/i);

const merchantAliasPlan = await buildActionPlanAsync({
  agent,
  prompt: 'buy the usual granola bars from Bezos, four bucks tops',
  schemaExtractor: async () => {
    throw new Error('common merchant aliases should be deterministic');
  }
});
assert.notEqual(merchantAliasPlan.mode, 'clarify');
assert.match(merchantAliasPlan.preview || '', /Target: https:\/\/www\.amazon\.com/);
assert.match(merchantAliasPlan.preview || '', /Budget: \$4/);

const ambiguousPlan = await buildActionPlanAsync({
  agent,
  prompt: 'buy the usual granola bars from the smiley storefront, four bucks tops',
  schemaExtractor: async () => ({
    targetUrl: 'https://www.walmart.com',
    merchant: 'walmart.com',
    item: 'Nature Valley granola bars',
    budget: '$4',
    currency: 'USD',
    confidence: 0.86,
    providerId: 'openrouter-free',
    model: 'test-model',
    latencyMs: 23
  })
});

assert.notEqual(ambiguousPlan?.mode, 'clarify', 'a concrete retail purchase without a site defaults to the Amazon happy path');
assert.equal(ambiguousPlan.localContext?.targetUrl, 'https://www.amazon.com');
assert.equal(isMagicInternetPurchaseRequest('buy the usual granola bars from the smiley storefront, four bucks tops'), true);

const caboTravelPrompt = [
  'i want to book a trip to cabo in spring 2027 can you help me?',
  'depart from SFO',
  'travel from Feb 12 - Feb 17 2027',
  'family trip so pool and beach',
  'total budget including flights is $4000',
  'yeah use kayak.com and prepare all the flight and hotel checkout'
].join('\n');
const caboPlan = buildActionPlan({ agent, prompt: caboTravelPrompt });
assert.equal(caboPlan.mode, 'clarify', 'travel remains standard LLM chat while Amazon is the Magic Internet demo');
assert.equal(isMagicInternetPurchaseRequest(caboTravelPrompt), false);

const policyPollutedPlan = buildBrowserExtensionMissionPlan({
  id: 'test-policy-polluted-product-query',
  selections: {
    targetUrl: 'https://www.amazon.com',
    budget: '$4',
    goal: 'nature valley granola bars Pause before payment or final purchase.'
  }
});
assert.equal(validateBrowserExtensionPlan(policyPollutedPlan).valid, true);
assert.equal(policyPollutedPlan.query, 'nature valley granola bars');
assert.match(policyPollutedPlan.startUrl, /k=nature\+valley\+granola\+bars/);
assert.match(policyPollutedPlan.startUrl, /language=en_US/);

const typoNormalizedPlan = buildBrowserExtensionMissionPlan({
  id: 'test-typo-normalized-product-query',
  selections: {
    targetUrl: 'https://www.amazon.com',
    budget: '$4',
    goal: 'Buy nature valley granol abars from amazon.com with max spend $4'
  }
});
assert.equal(validateBrowserExtensionPlan(typoNormalizedPlan).valid, true);
assert.equal(typoNormalizedPlan.query, 'nature valley granola bars');
assert.match(typoNormalizedPlan.startUrl, /language=en_US/);
assert.match(typoNormalizedPlan.actions.find((action) => action.id === 'open-cart')?.url || '', /language=en_US/);

console.log('magic internet agent extraction ok');
