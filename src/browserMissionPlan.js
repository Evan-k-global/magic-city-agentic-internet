import crypto from 'node:crypto';

export const BROWSER_EXTENSION_PLAN_SCHEMA = 'magic-city-browser-plan-v1';
export const BROWSER_EXTENSION_PLAN_PROTOCOL = 'declarative-v1';

const MAX_PLAN_ACTIONS = 64;
const MERCHANT_ORDER_CONFIRMATION_TIMEOUT_MS = 90_000;
const MIN_MERCHANT_ORDER_CONFIRMATION_TIMEOUT_MS = 30_000;
const MAX_MERCHANT_ORDER_CONFIRMATION_TIMEOUT_MS = 120_000;
// Each basket item needs a complete, observable loop. Eight keeps even the
// generic-site variant below the signed plan's 64-action ceiling.
const MAX_PLANNED_BASKET_ITEMS = 8;
const AMAZON_NON_MISSION_PARAMETERS = new Set([
  'tag',
  'ascsubtag',
  'affid',
  'aff_id',
  'affiliate',
  'affiliate_id',
  'linkcode',
  'camp',
  'creative',
  'creativeasin',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term'
]);
const SAFE_ACTION_TYPES = new Set(['navigate', 'inspect', 'search', 'select_candidate', 'click_intent', 'fill_checkout_profile', 'final_submit', 'pause']);
const SAFE_STEP_STATUSES = new Set(['waiting', 'completed', 'skipped']);
const SAFE_VERIFIED_MILESTONES = new Set([
  'candidate_selected',
  'cart_confirmed',
  'checkout_open',
  'address_confirmed',
  'card_confirmed',
  'delivery_confirmed',
  'checkout_profile_verified',
  'final_review_ready',
  'final_submit_requested',
  'order_submitted'
]);
const VERIFIED_CHECKOUT_STAGES = new Set(['checkout', 'payment', 'final_review']);
const VERIFIED_HUMAN_BOUNDARIES = new Set([
  'captcha_or_challenge_required',
  'login_required',
  'payment_required',
  'final_approval_required'
]);
const UNVERIFIED_TECHNICAL_STOPS = new Set([
  'basket_item_not_added',
  'local_checkout_profile_missing',
  'product_selection_needs_review',
  'milestone_not_verified',
  'runner_startup_failed',
  'runner_tab_unavailable',
  'step_needs_review'
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function hashPlan(value) {
  return `0x${crypto.createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

function domainForUrl(value = '') {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function safeHttpsUrl(value = '') {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function sanitizeAmazonMissionUrl(value = '') {
  const url = new URL(value);
  if (domainForUrl(url.href) !== 'amazon.com') return url.toString();
  for (const name of Array.from(url.searchParams.keys())) {
    if (AMAZON_NON_MISSION_PARAMETERS.has(name.toLowerCase())) {
      url.searchParams.delete(name);
    }
  }
  return url.toString();
}

function isCheckoutUrl(value = '') {
  try {
    const url = new URL(String(value || '').trim());
    return /\/checkout|\/buy|\/gp\/buy/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function evaluateBrowserExtensionFulfillment({ status = '', result = null } = {}) {
  const requestedStatus = String(status || '').trim().toLowerCase();
  const browser = result?.browserExecution && typeof result.browserExecution === 'object'
    ? result.browserExecution
    : {};
  const stopState = String(browser.stopState || '').trim().toLowerCase();
  const stage = String(browser.checkoutSummary?.stage || '').trim().toLowerCase();
  const milestoneContractActive = browser.milestoneProtocol === 'verified-v1';
  const verifiedMilestones = new Set(Array.isArray(browser.verifiedMilestones) ? browser.verifiedMilestones : []);
  const checkoutReached = Boolean(
    verifiedMilestones.has('checkout_open')
    || !milestoneContractActive && (
      browser.checkoutProgress?.checkoutOpened
      || VERIFIED_CHECKOUT_STAGES.has(stage)
      || isCheckoutUrl(browser.finalUrl)
    )
  );

  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      accepted: true,
      proofEligible: !UNVERIFIED_TECHNICAL_STOPS.has(stopState),
      reason: stopState || 'runner_reported_failure'
    };
  }
  if (requestedStatus !== 'fulfilled') {
    return { status: 'failed', accepted: false, proofEligible: false, reason: 'browser_terminal_status_invalid' };
  }
  if (browser.orderSubmitted === true) {
    if (milestoneContractActive && !verifiedMilestones.has('order_submitted')) {
      return { status: 'failed', accepted: false, proofEligible: false, reason: 'order_submission_not_verified' };
    }
    return { status: 'fulfilled', accepted: true, proofEligible: true, reason: 'order_submitted' };
  }
  if (browser.finalSubmitRequested === true && checkoutReached) {
    return {
      status: 'failed',
      accepted: false,
      proofEligible: false,
      reason: milestoneContractActive && !verifiedMilestones.has('final_submit_requested')
        ? 'final_submit_not_verified'
        : 'merchant_order_confirmation_missing'
    };
  }
  if (VERIFIED_HUMAN_BOUNDARIES.has(stopState)) {
    const earlyBoundary = stopState === 'login_required' || stopState === 'captcha_or_challenge_required';
    const finalReviewVerified = stopState !== 'final_approval_required'
      || !milestoneContractActive
      || verifiedMilestones.has('final_review_ready');
    if ((earlyBoundary || checkoutReached) && finalReviewVerified) {
      return { status: 'fulfilled', accepted: true, proofEligible: true, reason: stopState };
    }
  }
  if (['review_ready', 'handoff_ready'].includes(stopState) && checkoutReached
    && (!milestoneContractActive || verifiedMilestones.has('final_review_ready'))) {
    return { status: 'fulfilled', accepted: true, proofEligible: true, reason: stopState };
  }
  return {
    status: 'failed',
    accepted: false,
    proofEligible: false,
    reason: `unverified_browser_terminal_state:${stopState || stage || 'unknown'}`
  };
}

function inferHttpsUrlFromText(value = '') {
  const text = String(value || '');
  const explicit = text.match(/\bhttps:\/\/[^\s<>"')]+/i);
  if (explicit) return safeHttpsUrl(explicit[0].replace(/[.,;:!?]+$/, ''));
  const domain = text.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"')]+)?/i);
  return domain ? safeHttpsUrl(`https://${domain[0].replace(/[.,;:!?]+$/, '')}`) : '';
}

function compactText(value = '', limit = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizeRetailQuery(value = '') {
  return String(value || '')
    // Repair the common mobile/typing split without introducing a broad,
    // unpredictable spell-correction layer into signed mission plans.
    .replace(/\bgranol\s+a?bars?\b/gi, 'granola bars')
    .replace(/\bgranola\s+bars?\b/gi, 'granola bars')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMissionStopInstructions(value = '') {
  return String(value || '')
    .replace(/\bpause\s+before\b[\s\S]{0,120}?(?:\.|$)/gi, ' ')
    .replace(/\bstop\s+before\b[\s\S]{0,120}?(?:\.|$)/gi, ' ')
    .replace(/\bhand\s*off\s+before\b[\s\S]{0,120}?(?:\.|$)/gi, ' ')
    .replace(/\b(?:login|mfa|captcha|payment|card|final approval|final purchase|final submit)\s+(?:stays?|remain)\b[\s\S]{0,120}?(?:\.|$)/gi, ' ');
}

function queryForSession(session = {}) {
  const selections = session.finalSelections || session.selections || {};
  const source = compactText(stripMissionStopInstructions(
    selections.product ||
    selections.item ||
    selections.goal ||
    selections.taskBrief ||
    session.localContext?.goal ||
    session.localContext?.request || ''
  ));
  const targetDomain = domainForUrl(selections.targetUrl || selections.inputUrl || session.localContext?.targetUrl || '');
  return normalizeRetailQuery(source
    .replace(/\$\s*\d+(?:\.\d{1,2})?\s*(?:max(?:imum)?\s*(?:spend|budget)?|budget|spend)?/gi, ' ')
    .replace(/\b(?:i\s+really\s+want\s+to|i\s+want\s+to|please|can\s+you|could\s+you|help\s+me|buy|purchase|order|get|some|from|on|at|via|with|under|max(?:imum)?|spend|budget)\b/gi, ' ')
    .replace(targetDomain ? new RegExp(`\\b${targetDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi') : /$^/g, ' ')
    .replace(/[^a-z0-9\s'-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim())
    .slice(0, 120);
}

function shoppingItemsForSession(session = {}) {
  const selections = session.finalSelections || session.selections || {};
  const candidates = [
    selections.shoppingItems,
    selections.items,
    selections.itemList,
    session.localContext?.shoppingItems
  ];
  const items = candidates.find((candidate) => Array.isArray(candidate) && candidate.length) || [];
  return items
    .map((item) => compactText(normalizeRetailQuery(item), 90))
    .filter(Boolean)
    .filter((item) => !/\b(?:beer|wine|spirits?|alcohol|liquor|vape|tobacco|cannabis|weed|marijuana)\b/i.test(item))
    .slice(0, 20);
}

function maxPriceForSession(session = {}) {
  const selections = session.finalSelections || session.selections || {};
  const candidates = [selections.budget, selections.maxSpend, selections.magicCityPerTaskCap];
  for (const candidate of candidates) {
    const match = String(candidate || '').match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
    if (match) return Number(match[1]);
  }
  return null;
}

function selectionBriefForSession(session = {}, query = '') {
  const selections = session.finalSelections || session.selections || {};
  const explicitPreferences = [
    selections.constraints,
    selections.preferences,
    selections.taste,
    selections.reviewPreferences,
    selections.mustHaves,
    selections.exclusions
  ].filter(Boolean).join(' | ');
  return compactText([query, explicitPreferences].filter(Boolean).join(' | '), 420);
}

function budgetScopeForSession(session = {}) {
  const selections = session.finalSelections || session.selections || {};
  const explicit = String(selections.budgetScope || session.localContext?.budgetScope || '').trim();
  if (explicit) return explicit;
  const text = [
    selections.goal,
    selections.taskBrief,
    session.localContext?.goal,
    session.localContext?.request,
    session.localContext?.prompt
  ].filter(Boolean).join('\n');
  return /\b(?:also\s+add|add(?:ing)?\s+(?:this|these|the)?[\s\S]{0,80}?\bto\s+(?:my\s+)?cart|append(?:ing)?\s+to\s+(?:my\s+)?cart|extra\s+spend|additional\s+spend|existing\s+cart|current\s+cart|already\s+in\s+(?:my\s+)?cart)\b/i.test(text)
    ? 'incremental_cart_addition'
    : 'total_checkout';
}

function targetUrlForSession(session = {}) {
  const selections = session.finalSelections || session.selections || {};
  const structured = safeHttpsUrl(selections.targetUrl || selections.inputUrl || session.resolvedOrderUrl || session.localContext?.targetUrl || '');
  if (structured) return sanitizeAmazonMissionUrl(structured);
  const inferred = inferHttpsUrlFromText([
    selections.goal,
    selections.taskBrief,
    session.localContext?.goal,
    session.localContext?.request,
    session.localContext?.prompt
  ].filter(Boolean).join('\n'));
  return inferred ? sanitizeAmazonMissionUrl(inferred) : '';
}

function directSearchUrl({ targetUrl = '', query = '', maxPrice = null } = {}) {
  const targetDomain = domainForUrl(targetUrl);
  if (targetDomain !== 'amazon.com' || !query) return '';
  const url = new URL(targetUrl);
  url.pathname = '/s';
  url.search = '';
  url.searchParams.set('k', query);
  url.searchParams.set('language', 'en_US');
  if (Number.isFinite(maxPrice) && maxPrice > 0) {
    const priceCents = Math.max(1, Math.round(maxPrice * 100));
    url.searchParams.set('rh', `p_36:-${priceCents}`);
    url.searchParams.set('high-price', String(maxPrice));
  }
  return url.toString();
}

function searchUrlForQuery({ targetUrl = '', query = '', maxPrice = null } = {}) {
  return directSearchUrl({ targetUrl, query, maxPrice }) || targetUrl;
}

function cartUrlForTarget(targetUrl = '') {
  const targetDomain = domainForUrl(targetUrl);
  if (!['amazon.com', '127.0.0.1', 'localhost'].includes(targetDomain)) return '';
  const url = new URL(targetUrl);
  url.pathname = '/gp/cart/view.html';
  url.search = '';
  if (targetDomain === 'amazon.com') url.searchParams.set('language', 'en_US');
  return url.toString();
}

function resumeCheckoutUrlForSession(session = {}, targetUrl = '') {
  const candidate = safeHttpsUrl(
    session.extensionCheckoutReconcileUrl ||
    session.fulfillment?.result?.browserExecution?.finalUrl ||
    session.fulfillment?.browserExecution?.finalUrl ||
    ''
  );
  if (!candidate) return '';
  const targetDomain = domainForUrl(targetUrl);
  return targetDomain && domainForUrl(candidate) === targetDomain
    ? sanitizeAmazonMissionUrl(candidate)
    : '';
}

function buildAction(id, type, missionAction, extra = {}) {
  return { id, type, missionAction, ...extra };
}

function basketItemBudgets(totalBudget = null, itemCount = 0) {
  const count = Math.max(0, Math.floor(Number(itemCount) || 0));
  const totalCents = Math.round(Number(totalBudget) * 100);
  if (!count) return [];
  if (!Number.isFinite(totalCents) || totalCents <= 0) return Array(count).fill(null);
  const baseCents = Math.floor(totalCents / count);
  const remainingCents = totalCents % count;
  return Array.from({ length: count }, (_, index) => Number(((baseCents + (index < remainingCents ? 1 : 0)) / 100).toFixed(2)));
}

function buildShoppingItemSearches({ targetUrl = '', items = [], itemBudgets = [] } = {}) {
  return items.map((item, index) => ({
    item,
    query: item,
    maxItemPrice: Number.isFinite(Number(itemBudgets[index])) ? Number(itemBudgets[index]) : null,
    searchUrl: searchUrlForQuery({ targetUrl, query: item, maxPrice: itemBudgets[index] }),
    ordinal: index + 1,
    totalItems: items.length
  }));
}

export function buildBrowserExtensionMissionPlan(session = {}) {
  const selections = session.finalSelections || session.selections || {};
  const targetUrl = targetUrlForSession(session);
  const shoppingItems = shoppingItemsForSession(session);
  const query = shoppingItems[0] || queryForSession(session);
  const maxPrice = maxPriceForSession(session);
  const budgetScope = budgetScopeForSession(session);
  const budgetBasis = 'merchandise_subtotal';
  // Amazon's catalog search URL is stable and avoids a brittle homepage search
  // step. Other sites retain the generic in-page search flow.
  const requestedCheckoutReconcile = Boolean(session.extensionCheckoutReconcileResume);
  const checkoutResumeUrl = requestedCheckoutReconcile
    ? resumeCheckoutUrlForSession(session, targetUrl)
    : '';
  const startUrl = checkoutResumeUrl || searchUrlForQuery({ targetUrl, query, maxPrice });
  const startsAtSearchResults = startUrl !== targetUrl;
  const targetDomain = domainForUrl(startUrl);
  const fastAmazonCatalogPlan = targetDomain === 'amazon.com';
  const fulfillmentPolicy = String(session.extensionFulfillmentPolicy || (
    fastAmazonCatalogPlan ? 'amazon_free_shipping_preferred' : 'merchant_default'
  ));
  // Home delivery is the retail default. Pickup needs explicit, separately
  // signed consent and is never inferred from a merchant promotion.
  const fulfillmentMode = String(session.extensionFulfillmentMode || '').trim() === 'pickup_allowed'
    ? 'pickup_allowed'
    : 'home_delivery';
  // Keep the existing policy name for older published runners, while adding an
  // explicit capability flag that newer runners enforce as Prime-only.
  const primeRequired = session.extensionPrimeRequired === true
    || (fastAmazonCatalogPlan && session.extensionPrimeRequired !== false);
  const cartUrl = cartUrlForTarget(targetUrl);
  const fillLocalCheckoutProfile = Boolean(session.extensionCheckoutProfileEnabled);
  // Older published runners can safely reconcile a local address and card cue,
  // but do not recognize the explicit final_submit action. Keep plans compatible
  // with that installed surface rather than failing the entire browser mission.
  const extensionFinalSubmitEnabled = session.extensionFinalSubmitEnabled !== false;
  const finalApprovalPolicy = String(selections.finalApprovalPolicy || '').trim().toLowerCase();
  // One Amazon Run authorizes one checkout submit only when the local runner
  // can still verify the merchant, cap, saved address, and selected card cue.
  // A recovery may keep that authority only when the session itself was
  // already configured to auto-submit; a review-only session must still pause.
  const autoSubmitAfterVerifiedCheckout = (finalApprovalPolicy === 'auto_submit_after_verified_checkout'
    || (!finalApprovalPolicy && fastAmazonCatalogPlan && !requestedCheckoutReconcile))
    && extensionFinalSubmitEnabled;
  // Amazon's "make this my default" checkbox is a merchant-side convenience
  // preference. It is signed into the same one-order final-submit action and
  // only runs after the vault address/card and final review are verified.
  const saveMerchantCheckoutDefault = autoSubmitAfterVerifiedCheckout && fastAmazonCatalogPlan;
  // A user can opt into reviewing checkout in Magic City. Their explicit
  // Place order command then issues this short, verification-only continuation
  // instead of replaying catalog search and cart work.
  const resumeFinalSubmit = Boolean(session.extensionFinalSubmitResume && autoSubmitAfterVerifiedCheckout);
  const resumeCheckoutReconcile = Boolean(requestedCheckoutReconcile && fillLocalCheckoutProfile && checkoutResumeUrl);
  const resumeCheckoutAutoSubmit = Boolean(resumeCheckoutReconcile && autoSubmitAfterVerifiedCheckout);
  const itemizedBasket = shoppingItems.length > 1;
  const plannedItems = itemizedBasket
    ? shoppingItems.slice(0, MAX_PLANNED_BASKET_ITEMS)
    : [];
  // Reserve a fair share for every requested item before the first search. This
  // prevents a single early result from consuming the whole approved basket cap.
  // The combined merchandise subtotal remains the hard guard. Tax and delivery
  // are reported separately and do not consume the item budget.
  const allBasketItemBudgets = itemizedBasket
    ? basketItemBudgets(maxPrice, shoppingItems.length)
    : [];
  const plannedItemBudgets = allBasketItemBudgets.slice(0, plannedItems.length);
  const finitePlannedItemBudgets = plannedItemBudgets.filter((value) => Number.isFinite(value));
  const maxItemPrice = finitePlannedItemBudgets.length
    ? Math.max(...finitePlannedItemBudgets)
    : maxPrice;
  const selectionBrief = selectionBriefForSession(session, query);
  const itemSearches = itemizedBasket
    ? buildShoppingItemSearches({ targetUrl, items: plannedItems, itemBudgets: plannedItemBudgets })
    : [];
  const itemActions = [];
  itemSearches.forEach(({ item, query: itemQuery, searchUrl: itemStartUrl, maxItemPrice: itemMaxPrice }, index) => {
    const itemStartsAtSearchResults = itemStartUrl !== targetUrl;
    const itemSelectionBrief = selectionBriefForSession(session, itemQuery);
    itemActions.push(buildAction(`search-item-${index + 1}`, 'navigate', 'browser_open', { url: itemStartUrl, query: itemQuery, item }));
    if (!itemStartsAtSearchResults) {
      itemActions.push(buildAction(`type-item-${index + 1}`, 'search', 'browser_type', { query: itemQuery, item, optional: true }));
    }
    // Candidate selection reads only the selected result card. Avoid a full
    // document inspection and a separate Prime-filter click for the Amazon
    // happy path: both add latency, while the candidate policy below already
    // requires visible Prime evidence before the cart action is allowed.
    if (!fastAmazonCatalogPlan) {
      itemActions.push(buildAction(`inspect-results-${index + 1}`, 'inspect', 'read_public_page', { item }));
    }
    if (primeRequired && !fastAmazonCatalogPlan) {
      itemActions.push(buildAction(`prefer-delivery-filter-${index + 1}`, 'click_intent', 'browser_click', {
        intent: 'prefer_free_delivery',
        item,
        optional: true
      }));
    }
    itemActions.push(buildAction(`select-match-${index + 1}`, 'select_candidate', 'browser_click', {
      query: itemQuery,
      item,
      requiredBasketItem: true,
      expectedMilestone: 'candidate_selected',
      maxPrice: itemMaxPrice,
      selectionBrief: itemSelectionBrief,
      candidatePolicy: 'price_quality_delivery_preference',
      budgetReservation: {
        itemOrdinal: index + 1,
        itemCount: shoppingItems.length,
        reservedMaxPrice: itemMaxPrice
      }
    }));
    if (!fastAmazonCatalogPlan) {
      itemActions.push(buildAction(`inspect-product-${index + 1}`, 'inspect', 'read_public_page', { item }));
    }
    itemActions.push(buildAction(`prepare-cart-${index + 1}`, 'click_intent', 'prepare_cart', {
      intent: 'add_to_cart',
      query: itemQuery,
      item,
      requiredBasketItem: true
    }));
    itemActions.push(buildAction(`verify-cart-${index + 1}`, 'inspect', 'read_public_page', {
      item,
      requiredBasketItem: true,
      expectedMilestone: 'cart_confirmed',
      expectedCartItemCount: index + 1
    }));
  });
  const finalSubmitAction = () => buildAction('submit-final-order', 'final_submit', 'final_submit', {
    autoSubmitAfterVerifiedCheckout: true,
    saveMerchantCheckoutDefault,
    maxPrice,
    expectedMilestone: 'final_submit_requested'
  });
  const confirmMerchantOrderAction = () => buildAction('confirm-merchant-order', 'inspect', 'read_public_page', {
    awaitMerchantOrderConfirmation: true,
    merchantConfirmationTimeoutMs: MERCHANT_ORDER_CONFIRMATION_TIMEOUT_MS,
    expectedMilestone: 'order_submitted'
  });
  const reviewSubmitActions = [
    buildAction('inspect-reviewed-checkout', 'inspect', 'read_public_page', { resumeFinalSubmit: true }),
    ...(fillLocalCheckoutProfile ? [buildAction('reconcile-reviewed-checkout', 'fill_checkout_profile', 'fill_safe_fields', { resumeFinalSubmit: true })] : []),
    buildAction('verify-reviewed-checkout', 'inspect', 'read_public_page', { resumeFinalSubmit: true, expectedMilestone: 'final_review_ready' }),
    finalSubmitAction(),
    confirmMerchantOrderAction(),
    buildAction('pause-for-user', 'pause', 'handoff', { reason: 'order_submission_requested' })
  ];
  // A checkout can expose its delivery selector first and its card selector only
  // after delivery is confirmed. This continuation reuses the existing merchant
  // tab, never replays catalog/cart work, and reaches final review again. It can
  // submit only when the original mission policy already authorized auto-submit.
  const reviewReconcileActions = [
    buildAction('open-reviewed-checkout', 'navigate', 'browser_open', {
      url: startUrl,
      resumeCheckoutReconcile: true,
      preserveExistingCheckout: true
    }),
    buildAction('reconcile-reviewed-delivery', 'fill_checkout_profile', 'fill_safe_fields', { resumeCheckoutReconcile: true }),
    buildAction('continue-reviewed-checkout', 'click_intent', 'browser_click', { intent: 'checkout', optional: true, resumeCheckoutReconcile: true }),
    buildAction('reconcile-reviewed-payment', 'fill_checkout_profile', 'fill_safe_fields', { resumeCheckoutReconcile: true }),
    buildAction('verify-reviewed-checkout', 'inspect', 'read_public_page', { resumeCheckoutReconcile: true, expectedMilestone: 'final_review_ready' }),
    ...(resumeCheckoutAutoSubmit ? [finalSubmitAction(), confirmMerchantOrderAction()] : []),
    buildAction('pause-for-user', 'pause', 'handoff', {
      reason: resumeCheckoutAutoSubmit ? 'order_submission_requested' : 'checkout_profile_reconciled'
    })
  ];
  const actions = startUrl
    ? (resumeFinalSubmit
      ? reviewSubmitActions
      : resumeCheckoutReconcile
      ? reviewReconcileActions
      : itemizedBasket
      ? [
          ...itemActions,
          ...(cartUrl ? [buildAction('open-cart', 'navigate', 'browser_open', {
            url: cartUrl,
            intent: 'open_cart',
            // New runners use Amazon's live side-cart/header control first.
            // The signed cart URL remains a compatible, same-domain fallback.
            preferExistingCartControl: true
          })] : []),
          buildAction('inspect-cart', 'inspect', 'read_public_page', {
            requiredBasketItem: true,
            expectedMilestone: 'cart_confirmed',
            expectedCartItemCount: plannedItems.length
          }),
          buildAction('open-checkout', 'click_intent', 'browser_click', { intent: 'checkout', expectedMilestone: 'checkout_open' }),
          ...(fillLocalCheckoutProfile ? [buildAction('fill-checkout-profile', 'fill_checkout_profile', 'fill_safe_fields')] : []),
          buildAction('continue-checkout', 'click_intent', 'browser_click', { intent: 'checkout', optional: true }),
          ...(fillLocalCheckoutProfile ? [buildAction('reconcile-payment-profile', 'fill_checkout_profile', 'fill_safe_fields')] : []),
          buildAction('inspect-review', 'inspect', 'read_public_page', { expectedMilestone: 'final_review_ready' }),
          ...(autoSubmitAfterVerifiedCheckout ? [finalSubmitAction(), confirmMerchantOrderAction()] : []),
          buildAction('pause-for-user', 'pause', 'handoff', { reason: 'basket_review_ready' })
        ]
      : [
          buildAction('open-site', 'navigate', 'browser_open', { url: startUrl }),
          ...(startsAtSearchResults
            ? []
            : [
                buildAction('search-catalog', 'search', 'browser_type', { query, optional: true })
              ]),
          ...(primeRequired && !fastAmazonCatalogPlan
            ? [buildAction('prefer-delivery-filter', 'click_intent', 'browser_click', { intent: 'prefer_free_delivery', optional: true })]
            : []),
          buildAction('select-match', 'select_candidate', 'browser_click', { query, maxPrice, selectionBrief, requiredBasketItem: true, expectedMilestone: 'candidate_selected' }),
          buildAction('prepare-cart', 'click_intent', 'prepare_cart', { intent: 'add_to_cart', requiredBasketItem: true }),
          ...(cartUrl ? [buildAction('open-cart', 'navigate', 'browser_open', {
            url: cartUrl,
            intent: 'open_cart',
            // New runners use Amazon's live side-cart/header control first.
            // The signed cart URL remains a compatible, same-domain fallback.
            preferExistingCartControl: true
          })] : []),
          buildAction('inspect-cart', 'inspect', 'read_public_page', { requiredBasketItem: true, expectedMilestone: 'cart_confirmed', expectedCartItemCount: 1 }),
          buildAction('open-checkout', 'click_intent', 'browser_click', { intent: 'checkout', expectedMilestone: 'checkout_open' }),
          ...(fillLocalCheckoutProfile ? [buildAction('fill-checkout-profile', 'fill_checkout_profile', 'fill_safe_fields')] : []),
          buildAction('continue-checkout', 'click_intent', 'browser_click', { intent: 'checkout', optional: true }),
          // Amazon can reveal the saved-card selector only after it advances from
          // delivery to its dedicated payment page. Re-observe that transition
          // before asking for final-review evidence.
          ...(fillLocalCheckoutProfile ? [buildAction('reconcile-payment-profile', 'fill_checkout_profile', 'fill_safe_fields')] : []),
          buildAction('inspect-review', 'inspect', 'read_public_page', { expectedMilestone: 'final_review_ready' }),
          ...(autoSubmitAfterVerifiedCheckout ? [finalSubmitAction(), confirmMerchantOrderAction()] : []),
          buildAction('pause-for-user', 'pause', 'handoff', { reason: 'checkout_or_review_ready' })
        ])
    : [];
  const policyBoundActions = actions.map((action) => ({
    ...action,
    fulfillmentPolicy,
    fulfillmentMode,
    primeRequired
  }));
  const unsigned = {
    schema: BROWSER_EXTENSION_PLAN_SCHEMA,
    protocol: BROWSER_EXTENSION_PLAN_PROTOCOL,
    planId: `mplan_${String(session.id || 'pending').replace(/[^a-z0-9_-]/gi, '')}`,
    revision: (itemizedBasket ? 3 : startsAtSearchResults ? 1 : 0) + (autoSubmitAfterVerifiedCheckout ? 1 : 0) + (resumeFinalSubmit ? 10 : 0) + (resumeCheckoutReconcile ? 20 : 0) + (resumeCheckoutAutoSubmit ? 40 : 0),
    targetDomain,
    startUrl,
    query,
    shoppingItems: itemizedBasket ? shoppingItems : undefined,
    plannedItems: itemizedBasket ? plannedItems : undefined,
    remainingItems: itemizedBasket ? shoppingItems.slice(plannedItems.length) : undefined,
    itemSearches: itemizedBasket ? itemSearches : undefined,
    shoppingSearchMode: itemizedBasket ? 'best_match_per_item' : undefined,
    sharedConstraints: itemizedBasket ? {
      targetUrl,
      targetDomain,
      maxPrice,
      maxItemPrice,
      basketItemBudgets: allBasketItemBudgets,
      budgetScope,
      budgetStrategy: 'reserved_per_item_then_merchandise_subtotal_guard',
      budgetBasis,
      executionStrategy: 'sequential_item_additions',
      selectionStrategy: targetDomain === 'amazon.com'
        ? 'prime_only_then_price_then_quality'
        : 'price_then_quality',
      deliveryStrategy: targetDomain === 'amazon.com' ? 'prime_fastest_free_only' : 'merchant_default',
      allowPromotionalMembershipSignup: false,
      fulfillmentScope: targetDomain === 'amazon.com' ? 'amazon_catalog_prime_only' : 'merchant_default',
      primeRequired,
      allowAmazonLocalMarket: false,
      allowThirdPartyFulfillment: false
    } : undefined,
    maxPrice,
    maxItemPrice: itemizedBasket ? maxItemPrice : undefined,
    selectionBrief,
    budgetScope,
    budgetBasis,
    fulfillmentPolicy,
    fulfillmentMode,
    fulfillmentScope: fastAmazonCatalogPlan ? 'amazon_catalog_prime_only' : 'merchant_default',
    primeRequired,
    allowAmazonLocalMarket: false,
    allowThirdPartyFulfillment: false,
    resumeFinalSubmit,
    resumeCheckoutReconcile,
    resumeCheckoutAutoSubmit,
    finalApprovalPolicy: autoSubmitAfterVerifiedCheckout ? 'auto_submit_after_verified_checkout' : 'pause_before_final_approval',
    saveMerchantCheckoutDefault,
    requireMerchantOrderConfirmation: autoSubmitAfterVerifiedCheckout,
    merchantConfirmationTimeoutMs: autoSubmitAfterVerifiedCheckout ? MERCHANT_ORDER_CONFIRMATION_TIMEOUT_MS : null,
    limits: {
      maxActions: Math.min(MAX_PLAN_ACTIONS, policyBoundActions.length),
      maxRevisions: 2,
      stopBeforeFinalSubmit: !autoSubmitAfterVerifiedCheckout,
      stopOnSensitiveBoundary: true
    },
    actions: policyBoundActions
  };
  return { ...unsigned, planHash: hashPlan(unsigned) };
}

export function initialBrowserExtensionPlanState(plan = null) {
  return {
    planHash: plan?.planHash || null,
    nextActionIndex: 0,
    completedActionIds: [],
    verifiedMilestones: [],
    updatedAt: null
  };
}

export function getBrowserExtensionPlanAction(plan = null, index = 0) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  return actions[Number(index) || 0] || null;
}

export function validateBrowserExtensionPlan(plan = null) {
  if (!plan || typeof plan !== 'object') return { valid: false, reason: 'plan_missing' };
  if (plan.schema !== BROWSER_EXTENSION_PLAN_SCHEMA || plan.protocol !== BROWSER_EXTENSION_PLAN_PROTOCOL) {
    return { valid: false, reason: 'plan_schema_invalid' };
  }
  if (!plan.planId || !plan.planHash || !safeHttpsUrl(plan.startUrl)) return { valid: false, reason: 'plan_identity_invalid' };
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  if (!actions.length || actions.length > MAX_PLAN_ACTIONS) return { valid: false, reason: 'plan_action_count_invalid' };
  if (new Set(actions.map((action) => action?.id)).size !== actions.length) return { valid: false, reason: 'plan_action_ids_invalid' };
  if (actions.some((action) => !action?.id || !SAFE_ACTION_TYPES.has(action.type) || !action.missionAction)) {
    return { valid: false, reason: 'plan_action_invalid' };
  }
  if (actions.some((action) => action.expectedMilestone && !SAFE_VERIFIED_MILESTONES.has(action.expectedMilestone))) {
    return { valid: false, reason: 'plan_milestone_invalid' };
  }
  if (actions.some((action) => action.type === 'final_submit' && (
    action.autoSubmitAfterVerifiedCheckout !== true
    || !Number.isFinite(Number(action.maxPrice))
    || Number(action.maxPrice) <= 0
    || action.missionAction !== 'final_submit'
  ))) {
    return { valid: false, reason: 'plan_final_submit_invalid' };
  }
  const finalSubmitIndex = actions.findIndex((action) => action.type === 'final_submit');
  if (finalSubmitIndex >= 0 && !actions.slice(finalSubmitIndex + 1).some((action) => (
    action.type === 'inspect'
    && action.awaitMerchantOrderConfirmation === true
    && action.expectedMilestone === 'order_submitted'
  ))) {
    return { valid: false, reason: 'plan_merchant_confirmation_missing' };
  }
  if (actions.some((action) => action.awaitMerchantOrderConfirmation === true && (
    action.type !== 'inspect'
    || action.expectedMilestone !== 'order_submitted'
    || !Number.isFinite(Number(action.merchantConfirmationTimeoutMs))
    || Number(action.merchantConfirmationTimeoutMs) < MIN_MERCHANT_ORDER_CONFIRMATION_TIMEOUT_MS
    || Number(action.merchantConfirmationTimeoutMs) > MAX_MERCHANT_ORDER_CONFIRMATION_TIMEOUT_MS
  ))) {
    return { valid: false, reason: 'plan_merchant_confirmation_invalid' };
  }
  const { planHash, ...unsigned } = plan;
  if (hashPlan(unsigned) !== planHash) return { valid: false, reason: 'plan_hash_invalid' };
  return { valid: true, plan };
}

export function advanceBrowserExtensionPlanState(state = null, plan = null, {
  actionId = '',
  status = 'completed',
  milestoneProtocol = '',
  verifiedMilestones = []
} = {}) {
  const validation = validateBrowserExtensionPlan(plan);
  if (!validation.valid) return { valid: false, reason: validation.reason };
  if (!SAFE_STEP_STATUSES.has(status)) return { valid: false, reason: 'plan_step_status_invalid' };
  const current = state?.planHash === plan.planHash ? state : initialBrowserExtensionPlanState(plan);
  const nextAction = getBrowserExtensionPlanAction(plan, current.nextActionIndex);
  if (!nextAction || nextAction.id !== actionId) return { valid: false, reason: 'plan_step_out_of_order', expectedActionId: nextAction?.id || null };
  if (status === 'waiting') return { valid: true, state: current, action: nextAction, advanced: false };
  const reportedMilestones = [...new Set((Array.isArray(verifiedMilestones) ? verifiedMilestones : [])
    .map((value) => String(value || '').trim())
    .filter((value) => SAFE_VERIFIED_MILESTONES.has(value)))];
  const milestoneContractActive = milestoneProtocol === 'verified-v1';
  if (milestoneContractActive && nextAction.expectedMilestone && !reportedMilestones.includes(nextAction.expectedMilestone)) {
    return {
      valid: false,
      reason: 'plan_milestone_not_verified',
      expectedMilestone: nextAction.expectedMilestone
    };
  }
  return {
    valid: true,
    action: nextAction,
    advanced: true,
    state: {
      planHash: plan.planHash,
      nextActionIndex: current.nextActionIndex + 1,
      completedActionIds: [...(Array.isArray(current.completedActionIds) ? current.completedActionIds : []), actionId].slice(-MAX_PLAN_ACTIONS),
      verifiedMilestones: [...new Set([
        ...(Array.isArray(current.verifiedMilestones) ? current.verifiedMilestones : []),
        ...reportedMilestones
      ])].filter((value) => SAFE_VERIFIED_MILESTONES.has(value)),
      updatedAt: new Date().toISOString()
    }
  };
}
