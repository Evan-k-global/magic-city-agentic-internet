import { CONNECTOR_SPECS, getConnector, executeConnectorAction } from './connectors.js';
import { inferWorkflowCapability, listActionCapabilities } from './workflowRegistry.js';
import { extractBrowserShoppingItems, inferBrowserBudgetScope, inferUsdBudgetLabel, stripUsdBudgetPhrases } from './browserMissionExtraction.js';
import { extractBrowserMissionSchemaWithProvider } from './providers.js';

function isInformationalFoodQuery(prompt) {
  const lower = String(prompt || '').toLowerCase();
  return /\b(history|origin|origins|what is|what's|explain|tell me about|why is|when did)\b/.test(lower) &&
    /\b(sushi|pizza|thai|burger|taco|mexican|ramen|food)\b/.test(lower) &&
    !/\b(order|delivery|deliver|takeout|pickup|get me|i need|for dinner|for lunch|for breakfast)\b/.test(lower);
}

function isInformationalSpreadsheetQuery(prompt) {
  const lower = String(prompt || '').toLowerCase();
  return /\b(what is|what's|explain|tell me about|history of)\b/.test(lower) &&
    /\b(csv|excel|spreadsheet|tsv|data cleanup|dedupe)\b/.test(lower) &&
    !/\b(clean|cleanup|normalize|dedupe|fix|format|convert|transform|prepare)\b/.test(lower);
}

function isInformationalMeetingQuery(prompt) {
  const lower = String(prompt || '').toLowerCase();
  return /\b(what is|what's|explain|tell me about|history of)\b/.test(lower) &&
    /\b(meeting notes|meeting summary|action items|follow-up email|transcript)\b/.test(lower) &&
    !/\b(summarize|package|extract|turn this into|generate|prepare)\b/.test(lower);
}

function isInformationalJobQuery(prompt) {
  const lower = String(prompt || '').toLowerCase();
  return /\b(what is|what's|explain|tell me about|history of)\b/.test(lower) &&
    /\b(job application|resume|cover letter|linkedin jobs|greenhouse|lever|interview prep)\b/.test(lower) &&
    !/\b(apply|application run|job search|submit applications|find jobs|ship applications|upload resume|prepare)\b/.test(lower);
}

function isDeprecatedTravelTopic(prompt) {
  return /\b(travel|trip|vacation|itinerary|flight|flights|hotel|hotels|airport|airfare|fare|booking|road trip|roadtrip|guidebook|travel checkout|travel concierge|world cup|paris|france|germany|mexico|california|new england)\b/i.test(String(prompt || ''));
}

export function looksLikeCodeAuditRequest(prompt = '') {
  const text = String(prompt || '');
  const lower = text.toLowerCase();
  const githubRepoUrl = /https?:\/\/(?:www\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[/?#][^\s)]*)?/i.test(text);
  const repoSignal = githubRepoUrl || /\b(github|repo|repository|pull request|pr|branch|source code|codebase)\b/.test(lower);
  const auditIntent = /\b(code audit|code review|security audit|audit(?:ing)? (?:this )?(?:repo|repository|code|codebase)|review(?:ing)? (?:this )?(?:repo|repository|code|codebase)|bug hunt|security review|smart contract audit|scan (?:this )?(?:repo|repository|code|codebase))\b/.test(lower);
  const codeDomain = /\b(code|codebase|security|bug|bugs|vulnerability|vulnerabilities|typescript|javascript|python|rust|solidity|smart contract|implementation|architecture)\b/.test(lower);
  return Boolean((repoSignal && auditIntent) || (githubRepoUrl && codeDomain && /\b(audit|review|scan|bugs?|security|vulnerabilit(?:y|ies))\b/.test(lower)));
}

function hasExplicitBrowserPurchaseIntent(prompt = '') {
  return /\b(buy|purchase|order|checkout|get me|add to cart|add\s+(?:this|these|the)\b[\s\S]{0,80}?\bto\s+(?:my\s+)?cart)\b/i.test(String(prompt || ''));
}

// Magic Internet is a bounded execution path, not a replacement for ordinary
// web-aware LLM conversation. It only activates for a complete purchase task.
export function isMagicInternetPurchaseRequest(prompt = '') {
  if (looksLikeCodeAuditRequest(prompt) || isDeprecatedTravelTopic(prompt)) return false;
  const mission = inferBrowserMissionDraft(prompt);
  const explicitBasketIntent = mission.shoppingItems.length > 1 && /\bget\b/i.test(String(prompt || ''));
  if (!hasExplicitBrowserPurchaseIntent(prompt) && !explicitBasketIntent) return false;
  return Boolean(
    mission.targetUrl &&
    mission.budget &&
    (mission.product || mission.shoppingItems.length > 1)
  );
}

export function inferCapabilityFromPrompt(prompt, fallback = 'general-chat') {
  const lower = String(prompt || '').toLowerCase();
  if (isInformationalFoodQuery(lower) || isInformationalSpreadsheetQuery(lower) || isInformationalMeetingQuery(lower) || isInformationalJobQuery(lower)) return fallback;
  if (isMagicInternetPurchaseRequest(prompt)) return 'browser-worker-agent';
  return fallback;
}

export function isActionCapability(capability) {
  return listActionCapabilities().includes(String(capability || ''));
}

function countFoodSignals(prompt, profileSummary = {}) {
  const lower = String(prompt || '').toLowerCase();
  let score = 0;
  if (/\b(sushi|pizza|thai|burger|burgers|taco|tacos|mexican|ramen|salad|indian|mediterranean|chinese|korean|viet|vegan)\b/.test(lower)) score += 1;
  if (/\b(delivery|deliver|pickup|takeout|order)\b/.test(lower)) score += 1;
  if (/\b(lunch|dinner|breakfast|tonight|now|asap|party|for two|for 2|for three|for 3|family)\b/.test(lower)) score += 1;
  if (/\b(cheap|budget|under \$?\d+|\$\d+|fast|healthy|spicy|vegetarian|vegan|gluten)\b/.test(lower)) score += 1;
  if (profileSummary.zipCode) score += 1;
  return score;
}

function countSpreadsheetSignals(prompt) {
  const lower = String(prompt || '').toLowerCase();
  let score = 0;
  if (/\b(csv|excel|xlsx|spreadsheet|sheet|table)\b/.test(lower)) score += 1;
  if (/\b(clean|cleanup|normalize|format|dedupe|deduplicate|trim|fix)\b/.test(lower)) score += 1;
  if (/\b(json|tsv|export|columns|headers|rows)\b/.test(lower)) score += 1;
  if (/\b(\d+\s*(row|rows|column|columns)|5k|500)\b/.test(lower)) score += 1;
  return score;
}

function countJobSignals(prompt) {
  const lower = String(prompt || '').toLowerCase();
  let score = 0;
  if (/\b(job|jobs|career|application|apply|resume|cv|cover letter)\b/.test(lower)) score += 1;
  if (/\b(linkedin|greenhouse|lever|workable|indeed|ashby)\b/.test(lower)) score += 1;
  if (/\b(remote|hybrid|onsite|san francisco|\bsf\b|bay area|new york|london|berlin)\b/.test(lower)) score += 1;
  if (/\b(ceo|cto|cfo|coo|chief|founder|executive|engineer|developer|designer|product|marketing|sales|operations|analyst)\b/.test(lower)) score += 1;
  if (/\b(auto[- ]?submit|submit|application run|apply automatically|ship applications)\b/.test(lower)) score += 1;
  if (/\b(ai|tech|startup|company|companies|co)\b/.test(lower)) score += 1;
  return score;
}

function countBrowserWorkerSignals(prompt) {
  const lower = String(prompt || '').toLowerCase();
  let score = 0;
  if (/https?:\/\/[^\s)]+/i.test(String(prompt || ''))) score += 2;
  if (/\b[a-z0-9-]+\.(?:com|net|org|io|ai)\b/.test(lower)) score += 1;
  if (/\b(browser|browse|website|site|url|web page|open this|go to|amazon|walmart|target|best buy|bestbuy|etsy|ebay|instacart|doordash|uber eats|ubereats|grubhub|kayak|expedia|booking\.com|hotels\.com|google flights|google travel)\b/.test(lower)) score += 1;
  if (/\b(add to cart|add\s+(?:this|these|the)\b[\s\S]{0,80}?\bto\s+(?:my\s+)?cart|checkout|buy|purchase|order|shop|book|reserve|fill out|fill in|sign up|signup|search|compare|prepare)\b/.test(lower)) score += 1;
  if (/\b(hairbrush|toothbrush|charger|cable|book|laptop|phone|case|shoes|shirt|gift|coffee|tea|supplement|keyboard|mouse|monitor|bag|wallet|headphones|granola|bars?|cereal|snacks?|groceries|food|soap|detergent|batteries|trip|travel|flight|flights|hotel|hotels|resort|lodging|airfare|rental car)\b/.test(lower)) score += 1;
  if (/\$[0-9]/.test(lower)) score += 1;
  if (/\b(job|jobs|application|apply|resume|cv|cover letter|linkedin|greenhouse|lever|workable|ashby|indeed|ats)\b/.test(lower)) score += 1;
  if (/\b(stop before|pause before|payment|login|captcha|final submit|final purchase)\b/.test(lower)) score += 1;
  return score;
}

function inferBrowserMerchantLabel(prompt = '') {
  const text = String(prompt || '');
  const lower = text.toLowerCase();
  const urlMatch = text.match(/https?:\/\/(?:www\.)?([^/\s)]+)/i);
  if (urlMatch) return urlMatch[1].replace(/^www\./i, '');
  const domainMatch = lower.match(/\b([a-z0-9-]+\.(?:com|net|org|io|ai))\b/);
  if (domainMatch) return domainMatch[1];
  if (/\b(amazon|bezos|everything store)\b/.test(lower)) return 'amazon.com';
  if (/\b(target|tarjay|bullseye)\b/.test(lower)) return 'target.com';
  if (/\b(walmart|wally world)\b/.test(lower)) return 'walmart.com';
  if (/\bbest buy\b|\bbestbuy\b/.test(lower)) return 'bestbuy.com';
  if (/\binstacart\b/.test(lower)) return 'instacart.com';
  if (/\bkayak\b/.test(lower)) return 'kayak.com';
  if (/\bexpedia\b/.test(lower)) return 'expedia.com';
  if (/\bbooking\.com\b|\bbooking\b/.test(lower)) return 'booking.com';
  if (/\bhotels\.com\b|\bhotels\b/.test(lower)) return 'hotels.com';
  return '';
}

function inferBrowserBudgetLabel(prompt = '') {
  return inferUsdBudgetLabel(prompt);
}

function normalizeBrowserBudgetCandidate(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  const explicit = inferUsdBudgetLabel(text) || inferUsdBudgetLabel(`max spend ${text}`);
  if (explicit) return explicit;
  const direct = text.match(/^\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:usd|dollars?|bucks?)?$/i);
  return direct ? `$${direct[1].replace(/,/g, '')}` : '';
}

function browserMerchantToTargetUrl(value = '') {
  const host = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/[),.;:]+$/, '');
  if (!host) return '';
  if (host === 'amazon' || host === 'bezos' || host === 'everything store') return 'https://www.amazon.com';
  if (host === 'target' || host === 'tarjay' || host === 'bullseye') return 'https://www.target.com';
  if (host === 'walmart' || host === 'wally world') return 'https://www.walmart.com';
  if (host === 'best buy' || host === 'bestbuy') return 'https://www.bestbuy.com';
  if (host === 'instacart') return 'https://www.instacart.com';
  if (host === 'kayak') return 'https://www.kayak.com';
  if (host === 'expedia') return 'https://www.expedia.com';
  if (host === 'booking') return 'https://www.booking.com';
  if (host === 'hotels') return 'https://www.hotels.com';
  if (!/\.[a-z]{2,}$/i.test(host)) return '';
  if (['amazon.com', 'target.com', 'walmart.com', 'bestbuy.com', 'instacart.com', 'kayak.com', 'expedia.com', 'booking.com', 'hotels.com'].includes(host)) {
    return `https://www.${host}`;
  }
  return `https://${host}`;
}

function normalizeBrowserTargetUrlCandidate(value = '', merchant = '') {
  const direct = String(value || '').match(/https?:\/\/[^\s)]+/i)?.[0]?.replace(/[.,;:]+$/, '') || '';
  if (direct) return direct;
  return browserMerchantToTargetUrl(value) || browserMerchantToTargetUrl(merchant);
}

function cleanBrowserProductCandidate(value = '') {
  const withoutPolitePhrases = String(value || '')
    .replace(/^\s*(?:yes|yeah|yep|correct|right|confirmed|confirming|ok|okay)[,.\s-]+/i, ' ')
    .replace(/\b(?:please|for me|online|from amazon|on amazon|at amazon|from target|from walmart|on target|on walmart|from kayak|on kayak|at kayak|from expedia|on expedia|at expedia|from booking|on booking|at booking)\b/gi, ' ')
    .replace(/\b(?:i\s+want\s+to|i\s+would\s+like\s+to|i'?d\s+like\s+to|can\s+you|could\s+you|help\s+me)\b/gi, ' ')
    .replace(/^\s*(?:buy|purchase|order|get me|shop for|add to cart|find)\s+/i, ' ');
  return stripUsdBudgetPhrases(withoutPolitePhrases)
    .replace(/\b(?:from|on|at|via|use)\s+(?:amazon|amazon\.com|target|target\.com|walmart|walmart\.com|best buy|bestbuy|bestbuy\.com|instacart|instacart\.com|kayak|kayak\.com|expedia|expedia\.com|booking|booking\.com|hotels|hotels\.com)\b/gi, ' ')
    .replace(/\b(?:buy|purchase|order|get me|shop for|add to cart|find|max|maximum|budget|spend|cap|limit)\b\s*$/gi, ' ')
    .replace(/[?.!,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableBrowserProductCandidate(value = '') {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.length < 2) return false;
  if (/^(?:yes|no|something|stuff|anything|whatever|a thing|some things|all these things|these things|the list|my list|it|that|book|reserve|checkout|for|from|on|at|via|use|buy|purchase|order|get me|shop|find|max|budget|spend|limit|cap)$/i.test(candidate)) return false;
  return /[a-z0-9]/i.test(candidate);
}

function looksLikeTravelBrowserMission(prompt = '') {
  const text = String(prompt || '');
  const lower = text.toLowerCase();
  const travelProvider = /\b(kayak|expedia|booking\.com|hotels\.com|google flights|google travel|airbnb|delta|united|southwest)\b/.test(lower);
  const travelTopic = /\b(trip|travel|vacation|flight|flights|hotel|hotels|resort|stay|lodging|airfare|rental car|booking|itinerary|beach|pool)\b/.test(lower);
  const tripShape = /\b(?:depart(?:ing)?\s+from|from)\s+[a-z]{3}\b/i.test(text) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i.test(text) ||
    /\b(?:spring|summer|fall|winter)\s+20\d{2}\b/i.test(text);
  const travelAction = /\b(book|reserve|prepare|checkout|price|compare|find)\b/.test(lower);
  return Boolean((travelProvider && travelTopic) || (travelTopic && tripShape && travelAction));
}

function titleCaseTravelPhrase(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .replace(/\bSfo\b/g, 'SFO')
    .replace(/\bLax\b/g, 'LAX')
    .replace(/\bJfk\b/g, 'JFK')
    .replace(/\bEwr\b/g, 'EWR')
    .replace(/\bLga\b/g, 'LGA');
}

function inferBrowserTravelTaskLabel(prompt = '') {
  const text = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!looksLikeTravelBrowserMission(text)) return '';
  const lower = text.toLowerCase();
  const destinationMatch = text.match(/\b(?:trip|travel|vacation|stay|fly|flight|flights|hotel|hotels|resort|booking)\s+(?:to|in|near)\s+([a-z][a-z' .-]{1,40}?)(?:\s+(?:from|for|with|on|between|during|in|under|budget|checkout|using|use|via)\b|[,.]|$)/i) ||
    text.match(/\bto\s+([a-z][a-z' .-]{1,32}?)(?:\s+(?:from|for|with|on|between|during|in|under|budget|checkout)\b|[,.]|$)/i);
  const destination = titleCaseTravelPhrase(destinationMatch?.[1] || '');
  const origin = text.match(/\b(?:depart(?:ing)?\s+from|from)\s+([a-z]{3})\b/i)?.[1]?.toUpperCase() || '';
  const dates = text.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\s*(?:-|–|—|to|through)\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?\d{1,2},?\s*20\d{2}\b/i)?.[0] ||
    text.match(/\b(?:spring|summer|fall|winter)\s+20\d{2}\b/i)?.[0] || '';
  const scope = /\bflight|flights\b/.test(lower) && /\bhotel|hotels|resort|stay|lodging\b/.test(lower)
    ? 'flight and hotel checkout'
    : /\bflight|flights|airfare\b/.test(lower)
      ? 'flight checkout'
      : /\bhotel|hotels|resort|stay|lodging\b/.test(lower)
        ? 'hotel checkout'
        : 'travel checkout';
  const tripType = /\bfamily\b/.test(lower) ? 'family trip' : '';
  const preferences = ['pool', 'beach', 'name-brand', 'good ratings', 'cheap prices']
    .filter((word) => lower.includes(word))
    .map((word) => word.replace('-', ' '))
    .join(', ');
  return [
    scope,
    destination ? `for ${destination}` : '',
    origin ? `from ${origin}` : '',
    dates ? `for ${dates}` : '',
    tripType,
    preferences ? `with ${preferences}` : ''
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function ageRestrictedBasketItem(item = '') {
  return /\b(?:beer|wine|spirits?|alcohol|liquor|vape|tobacco|cannabis|weed|marijuana)\b/i.test(String(item || ''));
}

function safeBrowserShoppingItems(prompt = '') {
  return extractBrowserShoppingItems(prompt).filter((item) => !ageRestrictedBasketItem(item));
}

function buildBrowserBasketLabel(items = []) {
  const safeItems = items.map((item) => cleanBrowserProductCandidate(item)).filter(Boolean);
  if (safeItems.length < 2) return safeItems[0] || '';
  const visibleItems = safeItems.slice(0, 8);
  const suffix = safeItems.length > visibleItems.length ? `; +${safeItems.length - visibleItems.length} more` : '';
  return `${safeItems.length}-item basket: ${visibleItems.join('; ')}${suffix}`;
}

function inferBrowserProductLabel(prompt = '') {
  const shoppingItems = safeBrowserShoppingItems(prompt);
  if (shoppingItems.length > 1) return buildBrowserBasketLabel(shoppingItems);
  const text = String(prompt || '').replace(/\s+/g, ' ').trim();
  const travelTask = inferBrowserTravelTaskLabel(text);
  if (travelTask) return travelTask;
  const direct = text.match(/\b(?:buy|purchase|order|get me|shop for|add to cart|find)\s+(.+?)(?:\s+(?:from|on|at|via|under|budget|max|maximum|up to|less than|spend(?:ing)?|for)\b|$)/i);
  const candidate = cleanBrowserProductCandidate(direct?.[1] || '');
  if (isUsableBrowserProductCandidate(candidate)) return candidate;
  const merchantPhrase = text.match(/\b(?:from|on|at|via)\s+(?:amazon|amazon\.com|target|target\.com|walmart|walmart\.com|best buy|bestbuy|bestbuy\.com|instacart|instacart\.com|kayak|kayak\.com|expedia|expedia\.com|booking|booking\.com|hotels|hotels\.com)\b/i);
  if (merchantPhrase && merchantPhrase.index > 0) {
    const beforeMerchant = cleanBrowserProductCandidate(text.slice(0, merchantPhrase.index));
    if (isUsableBrowserProductCandidate(beforeMerchant)) return beforeMerchant;
  }
  const productWordMatch = text.match(/\b([a-z0-9][a-z0-9' -]{0,50}\b(?:granola bars?|protein bars?|snack bars?|cereal|snacks?|groceries|hairbrush|toothbrush|charger|cable|laptop|phone case|shoes|shirt|gift|coffee|tea|supplement|keyboard|mouse|monitor|bag|wallet|headphones|soap|detergent|batteries))\b/i);
  const productWordCandidate = cleanBrowserProductCandidate(productWordMatch?.[1] || '');
  return isUsableBrowserProductCandidate(productWordCandidate) ? productWordCandidate : '';
}

function inferBrowserMissionDraft(prompt = '') {
  const shoppingItems = safeBrowserShoppingItems(prompt);
  const merchant = inferBrowserMerchantLabel(prompt);
  const product = inferBrowserProductLabel(prompt);
  const budget = inferBrowserBudgetLabel(prompt);
  // Magic City currently has one deeply integrated retail lane. A concrete
  // purchase with no named merchant should enter that Amazon lane directly,
  // rather than falling through to generic chat or a SantaClawz recommendation.
  const defaultToAmazon = !merchant
    && !looksLikeCodeAuditRequest(prompt)
    && !looksLikeTravelBrowserMission(prompt)
    && hasExplicitBrowserPurchaseIntent(prompt)
    && Boolean(budget)
    && Boolean(product || shoppingItems.length > 1);
  const resolvedMerchant = merchant || (defaultToAmazon ? 'amazon.com' : '');
  const targetUrl = normalizeBrowserTargetUrlCandidate(prompt, resolvedMerchant);
  return {
    merchant: resolvedMerchant,
    targetUrl,
    product,
    budget,
    budgetScope: inferBrowserBudgetScope(prompt),
    shoppingItems,
    excludedShoppingItems: extractBrowserShoppingItems(prompt).filter(ageRestrictedBasketItem)
  };
}

function missionIdentityTokens(value = '') {
  const aliases = {
    abars: 'bar',
    abar: 'bar',
    granol: 'granola',
    granolas: 'granola',
    bars: 'bar'
  };
  return [...new Set(cleanBrowserProductCandidate(value)
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, ' ')
    .split(/\s+/)
    .map((token) => aliases[token] || token)
    .filter((token) => token.length > 1 && !/^(?:the|a|an|from|on|at|amazon|please|buy|purchase|order)$/.test(token)))];
}

function providerPreservesProductIdentity(requested = '', candidate = '') {
  const requestedTokens = missionIdentityTokens(requested);
  const candidateTokens = new Set(missionIdentityTokens(candidate));
  return requestedTokens.length > 0 && requestedTokens.every((token) => candidateTokens.has(token));
}

function providerPreservesShoppingList(requestedItems = [], candidateItems = []) {
  if (!Array.isArray(requestedItems) || requestedItems.length < 2 || !Array.isArray(candidateItems) || candidateItems.length !== requestedItems.length) return false;
  const unmatched = [...candidateItems];
  return requestedItems.every((requested) => {
    const index = unmatched.findIndex((candidate) => providerPreservesProductIdentity(requested, candidate));
    if (index < 0) return false;
    unmatched.splice(index, 1);
    return true;
  });
}

function normalizeMissionPreferences(preferences = {}) {
  if (!preferences || typeof preferences !== 'object') return null;
  const normalized = {
    brand: String(preferences.brand || '').trim().slice(0, 120),
    quality: String(preferences.quality || '').trim().slice(0, 160),
    delivery: String(preferences.delivery || '').trim().slice(0, 160),
    reviews: String(preferences.reviews || '').trim().slice(0, 160),
    mustHaves: Array.isArray(preferences.mustHaves) ? preferences.mustHaves.slice(0, 12).map((item) => String(item || '').trim().slice(0, 120)).filter(Boolean) : [],
    exclusions: Array.isArray(preferences.exclusions) ? preferences.exclusions.slice(0, 12).map((item) => String(item || '').trim().slice(0, 120)).filter(Boolean) : []
  };
  return Object.values(normalized).some((value) => Array.isArray(value) ? value.length : value) ? normalized : null;
}

function mergeProviderBrowserMission(prompt = '', providerMission = null) {
  const deterministic = inferBrowserMissionDraft(prompt);
  const providerConfidence = Number(providerMission?.confidence ?? 0);
  if (!providerMission || providerConfidence < 0.55) {
    return { ...deterministic, extraction: null };
  }
  const providerTargetUrl = normalizeBrowserTargetUrlCandidate(providerMission.targetUrl, providerMission.merchant);
  const providerMerchant = providerMission.merchant ? inferBrowserMerchantLabel(providerMission.merchant) || String(providerMission.merchant).trim() : '';
  const providerProduct = cleanBrowserProductCandidate(providerMission.item || providerMission.product || '');
  const providerShoppingItems = Array.isArray(providerMission.shoppingItems)
    ? providerMission.shoppingItems.map((item) => cleanBrowserProductCandidate(item)).filter(Boolean)
    : [];
  const correctedShoppingItems = providerPreservesShoppingList(deterministic.shoppingItems, providerShoppingItems)
    ? providerShoppingItems
    : deterministic.shoppingItems;
  const correctedProduct = deterministic.shoppingItems.length > 1
    ? buildBrowserBasketLabel(correctedShoppingItems)
    : providerProduct && providerPreservesProductIdentity(deterministic.product, providerProduct)
      ? providerProduct
      : deterministic.product;
  const providerBudget = normalizeBrowserBudgetCandidate(providerMission.budget || providerMission.maxSpend || '');
  return {
    merchant: deterministic.merchant || providerMerchant,
    targetUrl: deterministic.targetUrl || providerTargetUrl,
    product: correctedProduct || providerProduct,
    budget: deterministic.budget || providerBudget,
    budgetScope: deterministic.budgetScope || providerMission.budgetScope || inferBrowserBudgetScope(prompt),
    shoppingItems: correctedShoppingItems,
    preferences: normalizeMissionPreferences(providerMission.preferences),
    extraction: {
      source: 'openrouter_schema',
      providerId: providerMission.providerId || null,
      model: providerMission.model || null,
      confidence: providerConfidence,
      latencyMs: providerMission.latencyMs ?? null
    }
  };
}

function buildBrowserMissionGoal(prompt = '', mission = {}) {
  const shoppingItems = Array.isArray(mission.shoppingItems) ? mission.shoppingItems.map((item) => cleanBrowserProductCandidate(item)).filter(Boolean) : [];
  const product = cleanBrowserProductCandidate(mission.product || mission.item || '');
  const merchant = mission.merchant || inferBrowserMerchantLabel(mission.targetUrl || '');
  const budget = mission.budget || '';
  const preferences = normalizeMissionPreferences(mission.preferences);
  const preferenceText = preferences
    ? [
        preferences.brand ? `brand: ${preferences.brand}` : '',
        preferences.quality ? `quality: ${preferences.quality}` : '',
        preferences.reviews ? `reviews: ${preferences.reviews}` : '',
        preferences.delivery ? `delivery: ${preferences.delivery}` : '',
        preferences.mustHaves.length ? `must-haves: ${preferences.mustHaves.join(', ')}` : '',
        preferences.exclusions.length ? `exclude: ${preferences.exclusions.join(', ')}` : ''
      ].filter(Boolean).join('; ')
    : '';
  if (shoppingItems.length > 1) {
    const visibleItems = shoppingItems.slice(0, 12);
    const suffix = shoppingItems.length > visibleItems.length ? `; +${shoppingItems.length - visibleItems.length} more` : '';
    return [
      `Prepare ${shoppingItems.length}-item basket by finding the best matching option for each item`,
      merchant ? `from ${merchant}` : '',
      budget ? `within the shared ${budget} budget` : '',
      `items: ${visibleItems.join('; ')}${suffix}`,
      preferenceText ? `preferences: ${preferenceText}` : ''
    ].filter(Boolean).join(' ');
  }
  if (!product) return inferBrowserGoal(prompt);
  if (looksLikeTravelBrowserMission([prompt, product, mission.targetUrl || ''].filter(Boolean).join(' '))) {
    return [
      `Prepare ${product}`,
      merchant ? `on ${merchant}` : '',
      budget ? `within ${budget}` : ''
    ].filter(Boolean).join(' ');
  }
  return [
    `Buy ${product}`,
    merchant ? `from ${merchant}` : '',
    budget ? `with max spend ${budget}` : '',
    preferenceText ? `preferences: ${preferenceText}` : ''
  ].filter(Boolean).join(' ');
}

function hasRunnableBrowserMission(mission = {}) {
  return Boolean(mission.targetUrl && mission.product && mission.budget);
}

function shouldAttemptBrowserSchemaExtraction({ agentId = '', prompt = '', privacyMode = 'private' } = {}) {
  if (process.env.MAGIC_CITY_BROWSER_SCHEMA_EXTRACTOR_ENABLED === 'false') return false;
  if (agentId !== 'browser-worker-agent') return false;
  if (privacyMode === 'confidential' || privacyMode === 'agent-private') return false;
  const lower = String(prompt || '').toLowerCase();
  const purchaseIntent = /\b(buy|purchase|order|checkout|get me|add to cart|add\s+(?:this|these|the)\b[\s\S]{0,80}?\bto\s+(?:my\s+)?cart|shop for|find)\b/.test(lower);
  if (!purchaseIntent) return false;
  if (!hasConcreteBrowserPurchaseDetails(prompt)) return true;
  const shoppingItems = safeBrowserShoppingItems(prompt);
  const malformedInput = /\b(?:amazom|amzon|amazn|granol\s+abars|granola\s+abar|choclate|marshmellow)\b/i.test(lower);
  const explicitAmbiguity = /\b(?:a few|some things|best one|good ratings|highly rated|cheap(?:est)?|name brand|free shipping|prime|review(?:s)?|quality|preferences?)\b/i.test(lower);
  // Clear single-item purchases are deterministic and should not wait on a
  // provider. Keep the bounded schema pass for lists, malformed input, and
  // explicit preference/selection ambiguity where it adds real value.
  return shoppingItems.length > 1 || malformedInput || explicitAmbiguity;
}

function hasConcreteBrowserPurchaseDetails(prompt = '') {
  const lower = String(prompt || '').toLowerCase();
  const hasPurchaseIntent = /\b(buy|purchase|order|checkout|get me|add to cart|add\s+(?:this|these|the)\b[\s\S]{0,80}?\bto\s+(?:my\s+)?cart|book|reserve|prepare)\b/.test(lower);
  if (!hasPurchaseIntent) return true;
  const hasMerchant = Boolean(inferBrowserMerchantLabel(prompt));
  const hasBudget = Boolean(inferBrowserBudgetLabel(prompt));
  const shoppingItems = safeBrowserShoppingItems(prompt);
  if (shoppingItems.length > 1) return hasMerchant && hasBudget;
  const vagueSomething = /\b(something|stuff|anything|whatever|a thing|some things)\b/.test(lower);
  const hasProductHint = Boolean(inferBrowserProductLabel(prompt));
  return hasMerchant && hasBudget && hasProductHint && !vagueSomething;
}

function buildBrowserWorkerClarification(prompt = '') {
  const shoppingItems = extractBrowserShoppingItems(prompt);
  if (shoppingItems.length > 1) {
    const merchant = inferBrowserMerchantLabel(prompt);
    const budget = inferBrowserBudgetLabel(prompt);
    const missing = [];
    if (!merchant) missing.push('website');
    if (!budget) missing.push('budget');
    return {
      mode: 'clarify',
      content: [
        `I captured a ${shoppingItems.length}-item basket${budget ? ` with a ${budget} total cap` : ''}. I will not turn it into a search for “all these things.”`,
        '',
        `Items: ${shoppingItems.join(' · ')}`,
        '',
        missing.length
          ? `To run it, I need ${missing.join(missing.length === 2 ? ' and ' : ', ')}. The Magic Internet Agent contract is: item or task + website + budget.`
          : `I have the three-part contract. I will search the best match for each item under the shared site and budget constraints, then ${inferBrowserMerchantLabel(prompt) === 'amazon.com' ? 'pause only for login, payment, captcha, or a checkout mismatch.' : 'pause before payment or final purchase.'}`
      ].join('\n')
    };
  }
  const merchant = inferBrowserMerchantLabel(prompt);
  const product = inferBrowserProductLabel(prompt);
  const budget = inferBrowserBudgetLabel(prompt);
  const missing = [];
  if (!product) missing.push('item or task');
  if (!merchant) missing.push('website');
  if (!budget) missing.push('budget');
  return {
    mode: 'clarify',
    content: [
      product || merchant
        ? `Yes — I can help with ${[product, merchant ? `from ${merchant}` : ''].filter(Boolean).join(' ')}.`
        : 'Yes — I can help with that.',
      '',
      missing.length
        ? `Before I open Magic Internet Agent, I need ${missing.join(missing.length === 2 ? ' and ' : ', ')}.`
        : 'I have enough to open Magic Internet Agent.',
      '',
      missing.map((entry) => `- ${entry}`).join('\n') || (inferBrowserMerchantLabel(prompt) === 'amazon.com'
        ? 'I’ll prefill the execution sheet and pause only for login, payment, captcha, or a checkout mismatch.'
        : 'I’ll prefill the execution sheet and pause before payment or final purchase.'),
      missing.length ? 'Reliable execution path: item or task + website + budget.' : '',
      missing.length ? 'Once you answer, I’ll prefill one helper session for your review.' : ''
    ].join('\n')
  };
}

function buildBrowserWorkerPlanFromMission({ prompt, profileSummary = {}, agent, mission }) {
  const connector = getConnector('browser-worker-demo-v1');
  if (!connector) return null;
  const merchant = mission.merchant || inferBrowserMerchantLabel(mission.targetUrl || '');
  const preferences = normalizeMissionPreferences(mission.preferences);
  const browserMission = {
    targetUrl: mission.targetUrl,
    budget: mission.budget,
    budgetScope: mission.budgetScope || inferBrowserBudgetScope(prompt),
    goal: buildBrowserMissionGoal(prompt, { ...mission, merchant }),
    extraction: mission.extraction || null,
    shoppingItems: Array.isArray(mission.shoppingItems) ? mission.shoppingItems : [],
    excludedShoppingItems: Array.isArray(mission.excludedShoppingItems) ? mission.excludedShoppingItems : [],
    preferences,
    shoppingSearchMode: Array.isArray(mission.shoppingItems) && mission.shoppingItems.length > 1 ? 'best_match_per_item' : 'single_item_best_match',
    sharedConstraints: Array.isArray(mission.shoppingItems) && mission.shoppingItems.length > 1
      ? {
          targetUrl: mission.targetUrl,
          budget: mission.budget,
          budgetScope: mission.budgetScope || inferBrowserBudgetScope(prompt),
          preferences
        }
      : null
  };
  return connector.plan({
    prompt,
    profileSummary,
    agent,
    browserMission
  });
}

function buildFoodClarification(prompt, profileSummary = {}) {
  const lower = String(prompt || '').toLowerCase();
  const orderMode = /pickup/.test(lower) ? 'pickup' : 'delivery';
  return {
    mode: 'clarify',
    content: [
      'Yes — I can help with that.',
      '',
      `Before I prepare a ${orderMode} order, tell me these 4 things:`,
      '- cuisine or dish',
      '- budget range',
      '- timing (now, tonight, later)',
      '- any constraints (fast, healthy, spicy, vegetarian, etc.)',
      '',
      profileSummary.zipCode
        ? `I already have your local delivery zone (${profileSummary.zipCode}) available.`
        : 'If you unlock your local profile, I can use your ZIP code without exposing your full address.',
      'Once you answer, I can turn it into a food order with restaurant options and checkout handoff.'
    ].join('\n')
  };
}

function buildSpreadsheetClarification() {
  return {
    mode: 'clarify',
    content: [
      'Yes — I can help with that.',
      '',
      'Before I prepare a spreadsheet cleanup package, tell me these 4 things:',
      '- paste the raw sheet or CSV/TSV text',
      '- what cleanup you want most (dedupe, normalize, trim, standardize, convert)',
      '- preferred output format (CSV, TSV, JSON)',
      '- anything sensitive that should stay local-only',
      '',
      'Once you answer, I can turn it into a priced cleanup package with a cleaned export and report.'
    ].join('\n')
  };
}

function buildJobClarification() {
  return {
    mode: 'clarify',
    content: [
      'Yes — I can help with that.',
      '',
      'Before I prepare the jobs lane, tell me these 5 things:',
      '- target role or title',
      '- location preference (remote, hybrid, city)',
      '- the job sites you want to prioritize (LinkedIn, Greenhouse, Lever, etc.)',
      '- whether you want an application plan first or a full application run',
      '- whether you want final review or auto-submit on simple forms',
      '',
      'You can upload your resume locally before execution so raw personal details stay private until you explicitly hand them to the agent.',
      'Once you answer, I can turn it into a research-first job plan or a browser-backed application run.'
    ].join('\n')
  };
}

export function buildActionPlan({ agent, prompt, profileSummary = {}, context = [] }) {
  const agentId = agent?.agentId || '';
  if (agentId === 'browser-worker-agent') {
    if (looksLikeCodeAuditRequest(prompt)) return null;
    if (!isMagicInternetPurchaseRequest(prompt)) return buildBrowserWorkerClarification(prompt);
    const mission = inferBrowserMissionDraft(prompt);
    if (hasRunnableBrowserMission(mission)) {
      return buildBrowserWorkerPlanFromMission({ prompt, profileSummary, agent, mission });
    }
    return getConnector('browser-worker-demo-v1')?.plan({ prompt, profileSummary, agent }) ?? null;
  }
  return null;
}

export async function buildActionPlanAsync({ agent, prompt, profileSummary = {}, context = [], privacyMode = 'private', schemaExtractor = extractBrowserMissionSchemaWithProvider }) {
  const syncPlan = buildActionPlan({ agent, prompt, profileSummary, context });
  const agentId = agent?.agentId || '';
  if (agentId === 'browser-worker-agent' && !isMagicInternetPurchaseRequest(prompt)) return syncPlan;
  if (!shouldAttemptBrowserSchemaExtraction({ agentId, prompt, privacyMode })) return syncPlan;

  const extracted = await schemaExtractor({
    prompt,
    context,
    timeoutMs: Number(process.env.MAGIC_CITY_BROWSER_SCHEMA_EXTRACTOR_TIMEOUT_MS || 1800)
  }).catch(() => null);
  const mission = mergeProviderBrowserMission(prompt, extracted);
  if (!hasRunnableBrowserMission(mission)) return syncPlan;
  return buildBrowserWorkerPlanFromMission({
    prompt,
    profileSummary,
    agent,
    mission
  }) ?? syncPlan;
}

export function finalizeActionRun(actionRun, options = {}) {
  return executeConnectorAction(actionRun, options);
}
