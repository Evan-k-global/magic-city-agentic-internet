import crypto from 'node:crypto';
import { get94107Catalog, LOCALIZED_FOOD_ZIP } from './foodCatalog94107.js';
import { findIndexedTravelDestination } from './travelDestinationIndex.js';
import {
  JOB_APPLICATION_MODE_PLAN,
  JOB_APPLICATION_MODE_RUN,
  describeJobApplicationMode,
  describeJobApplicationModeLower,
  normalizeJobApplicationMode
} from './jobApplicationModels.js';
import {
  buildRoadTripDayStopPreview,
  buildRoadTripProviderLinks,
  getRoadTripGuide,
  inferRoadTripGuide,
  listRoadTripGuides
} from './roadTripGuides.js';
import { inferBrowserBudgetScope, inferUsdBudgetLabel } from './browserMissionExtraction.js';

function hash(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 32);
}

function titleize(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function inferFoodCuisine(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/sushi/.test(lower)) return 'sushi';
  if (/pizza/.test(lower)) return 'pizza';
  if (/thai/.test(lower)) return 'thai';
  if (/burger/.test(lower)) return 'burgers';
  if (/taco|mexican/.test(lower)) return 'tacos';
  if (/ramen/.test(lower)) return 'ramen';
  return 'dinner';
}

function inferBudgetHint(prompt) {
  const match = String(prompt || '').match(/\$\s?(\d{1,4})|under\s+\$?(\d{1,4})|below\s+\$?(\d{1,4})/i);
  const value = match ? Number(match[1] || match[2] || match[3]) : null;
  return Number.isFinite(value) ? `Under $${value}` : 'Around $25-$35';
}

function inferTimingHint(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/now|asap/.test(lower)) return 'ASAP';
  if (/tonight|dinner/.test(lower)) return 'Tonight';
  if (/lunch/.test(lower)) return 'Lunch';
  if (/tomorrow/.test(lower)) return 'Tomorrow';
  return 'Tonight';
}

function inferPartySize(prompt) {
  const lower = String(prompt || '').toLowerCase();
  const numMatch = lower.match(/for\s+(\d{1,2})/);
  if (numMatch) return `${numMatch[1]} people`;
  if (/family/.test(lower)) return '4 people';
  if (/date/.test(lower)) return '2 people';
  return '1 person';
}

function buildFoodOrderText(prompt, cuisine) {
  const text = String(prompt || '').trim();
  if (!text) return `${titleize(cuisine)} plus a drink`;
  return titleize(text.replace(/[?.!]+$/g, ''));
}

function buildDeliveryProviderLinks({ cuisine, zipCode, queryText }) {
  const searchTerms = [queryText || cuisine, zipCode].filter(Boolean).join(' ');
  return [
    {
      label: 'Open Uber Eats',
      url: `https://www.ubereats.com/search?q=${encodeURIComponent(searchTerms)}`,
      note: 'Open a live delivery surface with the prepared cuisine and area.',
      preferredForExecution: true,
      provider: 'uber_eats'
    },
    {
      label: 'Open DoorDash Search',
      url: `https://www.google.com/search?q=${encodeURIComponent(`site:doordash.com ${searchTerms}`)}`,
      note: 'Fallback search into DoorDash listings for this order context.',
      preferredForExecution: false,
      provider: 'doordash_search'
    },
    {
      label: 'Open Google Maps',
      url: `https://www.google.com/maps/search/${encodeURIComponent(searchTerms)}`,
      note: 'Compare nearby restaurants and travel times.',
      preferredForExecution: false,
      provider: 'google_maps'
    }
  ];
}

function buildTravelProviderLinks({ destination, homeAirport, tripGoal, travelWindow }) {
  const flightQuery = [homeAirport ? `${homeAirport} to` : 'Flights to', destination, travelWindow || 'flexible dates'].filter(Boolean).join(' ');
  const stayQuery = `${destination} hotels ${travelWindow || ''}`.trim();
  const foodQuery = tripGoal ? `${destination} ${tripGoal}` : `${destination} authentic food`;
  return [
    {
      label: 'Open Google Flights',
      url: `https://www.google.com/travel/flights?q=${encodeURIComponent(flightQuery)}`,
      note: 'Open live flight results with the route already prepared.',
      preferredForExecution: true,
      provider: 'google_flights'
    },
    {
      label: 'Search stays',
      url: `https://www.google.com/search?q=${encodeURIComponent(stayQuery)}`,
      note: 'Compare lodging options near your destination.',
      provider: 'hotels_search'
    },
    {
      label: 'Search local highlights',
      url: `https://www.google.com/search?q=${encodeURIComponent(foodQuery)}`,
      note: 'Look up destination-specific restaurants and experiences.',
      provider: 'highlights_search'
    }
  ];
}

function inferTravelJourneyMode(prompt = '', context = []) {
  const directPrompt = String(prompt || '').toLowerCase();
  if (/\b(guidebook|package|artifact|pdf|export|download|save|generate|draft|create|make|build|turn (this|that|it) into|put together)\b/.test(directPrompt) &&
    /\b(road trip|roadtrip|car trip|driving trip|guidebook|scenic drive|highway 1|pacific coast highway|pch|coastal drive|big sur|yosemite|napa|sonoma|redwoods|lake tahoe|sierra|new england|maine|vermont|new hampshire|acadia|white mountains|fall foliage)\b/.test(directPrompt)) {
    return 'road_trip_guidebook';
  }
  return 'itinerary_build';
}

const TRAVEL_DESTINATION_GUIDES = [
  {
    patterns: [/\bmexico city\b/, /\bcdmx\b/],
    destination: 'Mexico City, Mexico',
    rationale: 'strong city-food-culture fit with easy nonstop access, deep neighborhoods, and an excellent first-pass itinerary.',
    activities: ['Roma and Condesa walk', 'Historic center and museums', 'Taco and market crawl']
  },
  {
    patterns: [/\bcancun\b/, /\bcancún\b/],
    destination: 'Cancun, Mexico',
    rationale: 'strong nonstop leisure access with beach resorts and easy all-inclusive planning.',
    activities: ['Beachfront stay', 'Resort dinner reservation', 'Isla Mujeres or cenote day trip']
  },
  {
    patterns: [/\bberlin\b/, /\bmunich\b/, /\bbavaria\b/, /\bromantic road\b/],
    destination: 'Munich, Germany',
    rationale: 'best fit for a Germany-first trip with strong driving routes, food culture, and easy Bavaria day trips',
    activities: ['Munich beer halls and old town', 'Romantic Road drive segments', 'Bavarian lake or castle day trip']
  },
  {
    patterns: [/\belephant\b/],
    destination: 'Nairobi, Kenya',
    rationale: 'strong wildlife access, elephant sanctuaries, and culture',
    activities: ['David Sheldrick elephant sanctuary', 'Nairobi National Park', 'Karen Blixen Museum']
  },
  {
    patterns: [/\bpanda\b/],
    destination: 'Chengdu, China',
    rationale: 'best-known global base for panda conservation and research',
    activities: ['Chengdu Research Base of Giant Panda Breeding', 'Leshan day trip', 'Sichuan food crawl']
  },
  {
    patterns: [/\bnaples\b/],
    destination: 'Naples, Italy',
    rationale: 'the strongest first-stop for authentic pizza, dense street life, and easy access to southern Italy',
    activities: ['Historic center pizza crawl', 'Via Toledo and Quartieri Spagnoli', 'Pompeii or Amalfi day trip']
  },
  {
    patterns: [/\blisbon\b/, /\blisboa\b/],
    destination: 'Lisbon, Portugal',
    rationale: 'easy flight access, strong culture, and great first-pass travel logistics',
    activities: ['Alfama walk', 'Belém', 'Sintra day trip']
  }
];

const BROAD_TRAVEL_DESTINATION_ALIASES = new Set([
  'africa',
  'asia',
  'australia',
  'brazil',
  'canada',
  'china',
  'europe',
  'france',
  'germany',
  'greece',
  'india',
  'indonesia',
  'italy',
  'japan',
  'kenya',
  'mexico',
  'portugal',
  'south america',
  'spain',
  'thailand',
  'united kingdom',
  'uk',
  'usa',
  'united states'
]);

function titleizeWords(value = '') {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function cleanTravelDestinationCandidate(candidate = '') {
  return String(candidate || '')
    .replace(/\b(for|with|from|on|in|this|next|tomorrow|tonight|today|under|around|budget|for\s+\d+\s*(?:days?|nights?|weeks?))\b.*$/i, '')
    .replace(/[^a-zA-ZÀ-ÿ'’.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveTravelDestinationCandidate(candidate = '') {
  const cleaned = cleanTravelDestinationCandidate(candidate);
  if (!cleaned) return '';
  const indexedCandidate = findIndexedTravelDestination(cleaned);
  if (indexedCandidate) return indexedCandidate;
  const guided = findTravelDestinationGuide(cleaned);
  if (guided) return guided.destination;
  if (cleaned.split(/\s+/).length <= 4) return titleizeWords(cleaned);
  return '';
}

function findTravelDestinationGuide(input = '') {
  const lower = String(input || '').toLowerCase();
  return TRAVEL_DESTINATION_GUIDES.find((guide) => guide.patterns.some((pattern) => pattern.test(lower))) || null;
}

export function isBroadTravelDestination(value = '') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return BROAD_TRAVEL_DESTINATION_ALIASES.has(normalized);
}

export function extractExplicitTravelDestination(prompt = '') {
  const text = String(prompt || '').trim();
  if (!text) return '';
  const lower = text.toLowerCase();
  const routePatterns = [
    /\b(?:trip|flight|flights|hotel|hotels|weekend|itinerary|booking|stay)\s+to\s+([a-zà-ÿ][a-zà-ÿ'’.\-]*(?:\s+[a-zà-ÿ][a-zà-ÿ'’.\-]*){0,3})\s+from\s+[a-zà-ÿ]/i,
    /\b(?:from|leaving)\s+[a-zà-ÿ][a-zà-ÿ'’.\-]*(?:\s+[a-zà-ÿ][a-zà-ÿ'’.\-]*){0,3}\s+to\s+([a-zà-ÿ][a-zà-ÿ'’.\-]*(?:\s+[a-zà-ÿ][a-zà-ÿ'’.\-]*){0,3})/i
  ];

  for (const pattern of routePatterns) {
    const candidate = resolveTravelDestinationCandidate(text.match(pattern)?.[1] || '');
    if (candidate) return candidate;
  }

  const indexedDestination = findIndexedTravelDestination(text);
  if (indexedDestination) return indexedDestination;

  const directGuide = findTravelDestinationGuide(lower);
  if (directGuide) return directGuide.destination;

  const patterns = [
    /\b(?:go to|going to|travel to|trip to|visit|visiting|vacation in|stay in|fly to|head to)\s+([a-zà-ÿ][a-zà-ÿ'’.\-]*(?:\s+[a-zà-ÿ][a-zà-ÿ'’.\-]*){0,3})/i,
    /\b(?:destination|city|going)\s*[:\-]?\s*([a-zà-ÿ][a-zà-ÿ'’.\-]*(?:\s+[a-zà-ÿ][a-zà-ÿ'’.\-]*){0,3})/i
  ];

  for (const pattern of patterns) {
    const candidate = resolveTravelDestinationCandidate(text.match(pattern)?.[1] || '');
    if (!candidate) continue;
    return candidate;
  }

  return '';
}

export function extractTravelDestinationFromConversation(prompt = '', context = []) {
  const direct = extractExplicitTravelDestination(prompt);
  if (direct) return direct;
  if (!Array.isArray(context)) return '';
  for (let index = context.length - 1; index >= 0; index -= 1) {
    const entry = context[index];
    if (String(entry?.role || 'user') === 'assistant') continue;
    const found = extractExplicitTravelDestination(String(entry?.content || ''));
    if (found) return found;
  }
  return '';
}

function buildGenericTravelSuggestion(destination) {
  const city = String(destination || '').split(',')[0] || 'your destination';
  return {
    destination,
    rationale: `explicit destination requested by the user, so Magic City should plan around ${city} instead of guessing a different city.`,
    activities: [`Arrival and neighborhood walk in ${city}`, `${city} food and culture shortlist`, `Central stay options in ${city}`]
  };
}

function pickTravelDestination(prompt, context = []) {
  const lower = String(prompt || '').toLowerCase();
  const explicitDestination = extractTravelDestinationFromConversation(prompt, context);
  if (explicitDestination) {
    if (isBroadTravelDestination(explicitDestination)) return null;
    return findTravelDestinationGuide(explicitDestination) || buildGenericTravelSuggestion(explicitDestination);
  }
  const guided = /\b(elephant|panda)\b/.test(lower) ? findTravelDestinationGuide(lower) : null;
  if (guided) return guided;
  return null;
}

function buildFoodHandoffUrl(cuisine, profileSummary = {}, context = {}) {
  const params = new URLSearchParams();
  params.set('cuisine', cuisine);
  params.set('zip', profileSummary.zipCode || LOCALIZED_FOOD_ZIP);
  if (profileSummary.addressReady) params.set('address_ready', '1');
  if (context.budgetHint) params.set('budget', context.budgetHint);
  if (context.timingHint) params.set('timing', context.timingHint);
  if (context.partySize) params.set('party_size', context.partySize);
  if (context.orderText) params.set('order_text', context.orderText);
  return `/connectors/food/checkout?${params.toString()}`;
}

function buildTravelHandoffUrl(destination, profileSummary = {}, context = {}) {
  const params = new URLSearchParams();
  params.set('destination', destination);
  if (profileSummary.homeAirport) params.set('home_airport', profileSummary.homeAirport);
  if (profileSummary.travelWindow) params.set('travel_window', profileSummary.travelWindow);
  if (context.tripGoal) params.set('goal', context.tripGoal);
  if (context.travelMode) params.set('travel_mode', context.travelMode);
  if (context.roadTripRoute) params.set('road_trip_route', context.roadTripRoute);
  if (context.roadTripPace) params.set('road_trip_pace', context.roadTripPace);
  if (context.roadTripLength) params.set('road_trip_length', context.roadTripLength);
  if (context.roadTripInterests) params.set('road_trip_interests', context.roadTripInterests);
  if (context.startCity) params.set('start_city', context.startCity);
  if (context.endCity) params.set('end_city', context.endCity);
  return `/connectors/travel/checkout?${params.toString()}`;
}

function cleanBrowserWorkerValue(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function inferBrowserTargetUrl(prompt = '') {
  const match = String(prompt || '').match(/https?:\/\/[^\s)]+/i);
  if (match) return match[0].replace(/[.,;:]+$/, '');
  const lower = String(prompt || '').toLowerCase();
  if (/\b(amazon|bezos|everything store)\b/.test(lower)) return 'https://www.amazon.com';
  if (/\b(target|tarjay|bullseye)\b/.test(lower)) return 'https://www.target.com';
  if (/\b(walmart|wally world)\b/.test(lower)) return 'https://www.walmart.com';
  if (/\bbest buy\b|\bbestbuy\b/.test(lower)) return 'https://www.bestbuy.com';
  return '';
}

function inferBrowserGoal(prompt = '') {
  const text = cleanBrowserWorkerValue(prompt);
  if (!text) return 'Move the site task forward until a safe handoff point.';
  return text.replace(/^please\s+/i, '').slice(0, 300);
}

function inferBrowserBudget(prompt = '') {
  return inferUsdBudgetLabel(prompt);
}

function inferBrowserStopCondition(prompt = '') {
  const lower = String(prompt || '').toLowerCase();
  if (/\b(final submit|submit|application)\b/.test(lower)) return 'Pause before final submit';
  if (/\b(payment|pay|checkout|purchase|buy|order)\b/.test(lower)) return 'Pause before payment or final purchase';
  if (/\blogin|sign in|account\b/.test(lower)) return 'Pause at login or account creation';
  return 'Pause at login, captcha, payment, final submit, or uncertainty';
}

const BROWSER_MERCHANT_NAME_TO_DOMAIN = {
  amazon: 'amazon.com',
  target: 'target.com',
  walmart: 'walmart.com',
  bestbuy: 'bestbuy.com',
  'best buy': 'bestbuy.com',
  macys: 'macys.com',
  "macy's": 'macys.com',
  nordstrom: 'nordstrom.com',
  costco: 'costco.com',
  homedepot: 'homedepot.com',
  'home depot': 'homedepot.com',
  lowes: 'lowes.com',
  "lowe's": 'lowes.com',
  expedia: 'expedia.com',
  booking: 'booking.com',
  hotels: 'hotels.com',
  airbnb: 'airbnb.com',
  delta: 'delta.com',
  united: 'united.com',
  southwest: 'southwest.com',
  doordash: 'doordash.com',
  ubereats: 'ubereats.com',
  instacart: 'instacart.com'
};

function normalizeBrowserMerchantHost(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/[),.;:]+$/, '');
}

function inferBrowserMerchantsFromText(text = '', targetUrl = '') {
  const haystack = String(text || '');
  const merchants = new Set();
  for (const match of haystack.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/[^\s),;]*)?/gi)) {
    const host = normalizeBrowserMerchantHost(match[1]);
    if (host && !['com', 'www'].includes(host)) merchants.add(host);
  }
  const lower = haystack.toLowerCase();
  for (const [name, domain] of Object.entries(BROWSER_MERCHANT_NAME_TO_DOMAIN)) {
    const pattern = new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
    if (pattern.test(lower)) merchants.add(domain);
  }
  const targetHost = normalizeBrowserMerchantHost(targetUrl || inferBrowserTargetUrl(text));
  if (targetHost) merchants.add(targetHost);
  return Array.from(merchants);
}

function inferBrowserContextualAuthority(prompt = '', targetUrl = '') {
  const text = cleanBrowserWorkerValue(prompt);
  const lower = text.toLowerCase();
  const merchants = inferBrowserMerchantsFromText(text, targetUrl);
  const hasPurchaseIntent = /\b(buy|book|order|purchase|reserve|checkout|pay|get me|pick and buy|choose and buy|best one|best option)\b/.test(lower);
  const hasDiscoveryIntent = /\b(search|compare|find|show|research|options|recommend|shortlist|look for|which|what are)\b/.test(lower);
  const hasBoundedMerchantPhrase = /\b(these|from these|among these|one of these|from the following|allowlist|allowed merchants|stores|sites|merchants|vendors)\b/.test(lower);
  const delegatesChoice = /\b(best one|best option|choose|pick|select|book the best|buy the best|order the best)\b/.test(lower);
  const mode = hasPurchaseIntent
    ? (merchants.length && (hasBoundedMerchantPhrase || delegatesChoice) ? 'bounded_purchase' : 'purchase_requires_review')
    : hasDiscoveryIntent
      ? 'discovery_only'
      : 'scoped_browser_prep';
  return {
    schemaVersion: 'magic-city-browser-contextual-authority-v1',
    mode,
    inferredMerchants: merchants,
    discoveryOnly: mode === 'discovery_only',
    delegatedChoice: delegatesChoice,
    checkoutAuthority: mode === 'bounded_purchase',
    trustTier: mode === 'bounded_purchase' ? 'allowlisted_merchants_only' : 'ask_every_time',
    allowedMerchants: mode === 'bounded_purchase' ? merchants.join(',') : '',
    actionDepth: mode === 'discovery_only' ? 'Search and compare' : 'Prepare cart or form',
    reason: mode === 'bounded_purchase'
      ? 'User phrasing delegates selection/purchase within an inferred merchant set.'
      : mode === 'discovery_only'
        ? 'User phrasing asks for search/compare/options without checkout authority.'
        : 'No bounded merchant checkout authority inferred.'
  };
}

const DEFAULT_AGENT_PAYMENT_PROFILE = {
  cardName: 'Evan Business Agent Card',
  fundingSource: 'bank_virtual_debit',
  localPaymentCredentialReady: false,
  paymentCardLabel: '',
  paymentCardLast4: '',
  paymentBillingZip: '',
  cardAuthority: 'issuer_or_card_wallet',
  paymentEntryAuthority: 'user_handoff',
  missionAuthority: 'magic_city',
  proofAuthority: 'zeko_mission_bound_auth',
  paymentProfileDisplay: 'agent_card_label_and_last4',
  checkoutRunnerMode: 'server_prep_only',
  checkoutRunnerReceiptProof: 'receipt_hashes_and_screenshots',
  checkoutRunnerStopBeforeFinalSubmit: true,
  limitSource: 'bank_controls_and_magic_city_policy',
  allowedUse: 'internet_agent,procurement,bookings,applications',
  trustTier: 'ask_every_time',
  magicCityPerTaskCap: '',
  allowedMerchants: '',
  blockedUses: 'subscriptions,cash_equivalents,gift_cards,financial_services',
  killSwitch: 'remove_payment_profile'
};

function buildBrowserWorkerHandoffUrl(context = {}) {
  const params = new URLSearchParams();
  if (context.targetUrl) params.set('target_url', context.targetUrl);
  if (context.goal) params.set('goal', context.goal);
  if (context.constraints) params.set('constraints', context.constraints);
  if (context.budget) params.set('budget', context.budget);
  if (context.stopCondition) params.set('stop_condition', context.stopCondition);
  if (context.actionDepth) params.set('action_depth', context.actionDepth);
  if (context.trustTier) params.set('trust_tier', context.trustTier);
  if (context.allowedMerchants) params.set('allowed_merchants', context.allowedMerchants);
  if (context.contextualAuthorityMode) params.set('contextual_authority_mode', context.contextualAuthorityMode);
  return `/connectors/browser/worker?${params.toString()}`;
}

function buildDeveloperToolsHandoffUrl(query) {
  const params = new URLSearchParams();
  params.set('query', query);
  return `/connectors/developer/workbench?${params.toString()}`;
}

function inferGitHubRepoFromPrompt(prompt) {
  const urlMatch = String(prompt || '').match(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i);
  if (urlMatch) return String(urlMatch[1]).toLowerCase();
  const match = String(prompt || '').match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/);
  return match ? String(match[1]).toLowerCase() : '';
}

function inferGitHubIssueUrlFromPrompt(prompt) {
  const match = String(prompt || '').match(/https?:\/\/github\.com\/[^\s)]+\/(?:issues|pull)\/\d+/i);
  return match ? match[0] : '';
}

function inferSpreadsheetGoal(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/dedup|duplicate/.test(lower)) return 'Deduplicate rows and normalize headers';
  if (/normalize|standardize/.test(lower)) return 'Normalize headers, trim values, and standardize rows';
  if (/merge|combine/.test(lower)) return 'Combine, normalize, and clean the sheet';
  return 'Clean, normalize, and deduplicate the sheet';
}

function inferSpreadsheetOutputFormat(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/\bxlsx\b|\bexcel\b|\bworkbook\b/.test(lower)) return 'xlsx';
  if (/\bjson\b/.test(lower)) return 'json';
  if (/\btsv\b|\btab[- ]separated\b/.test(lower)) return 'tsv';
  return 'csv';
}

function inferSpreadsheetServiceTier(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/audit|normalize|schema|column map/.test(lower)) return 'Audit and normalize';
  if (/quick|fast|simple/.test(lower)) return 'Quick cleanup';
  return 'Standard cleanup';
}

function inferMeetingType(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/sales|client/.test(lower)) return 'client meeting';
  if (/standup/.test(lower)) return 'standup';
  if (/interview/.test(lower)) return 'interview';
  if (/board/.test(lower)) return 'board meeting';
  return 'team meeting';
}

function inferMeetingOutputPackage(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/full package|follow-?up email|decisions/.test(lower)) return 'Full package';
  if (/action items|actions/.test(lower)) return 'Summary + actions';
  return 'Summary only';
}

function inferMeetingAudience(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/client|customer|prospect/.test(lower)) return 'client';
  if (/exec|board|leadership/.test(lower)) return 'leadership';
  return 'team';
}

function inferMeetingUrgency(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/urgent|rush|asap/.test(lower)) return 'rush';
  if (/today|tonight/.test(lower)) return 'same day';
  return 'standard';
}

function inferMeetingWorkflowTarget(prompt) {
  const lower = String(prompt || '').toLowerCase();
  const wantsGoogle = /google|calendar|gmail|email|follow-?up|workspace/.test(lower);
  const wantsGitHub = /github|repo|repository|issue|ticket|engineering|bug|pr|pull request/.test(lower);
  if (wantsGoogle && wantsGitHub) return 'Google + GitHub follow-through';
  if (wantsGitHub) return 'GitHub handoff brief';
  if (wantsGoogle) return 'Google workspace follow-through';
  return 'Artifacts only';
}

function buildSpreadsheetHandoffUrl(context = {}) {
  const params = new URLSearchParams();
  if (context.cleanupGoals) params.set('cleanup_goals', context.cleanupGoals);
  if (context.outputFormat) params.set('output_format', context.outputFormat);
  if (context.serviceTier) params.set('service_tier', context.serviceTier);
  if (context.rowCountBand) params.set('row_count_band', context.rowCountBand);
  return `/connectors/spreadsheet/workbench?${params.toString()}`;
}

function buildMeetingHandoffUrl(context = {}) {
  const params = new URLSearchParams();
  if (context.transcript) params.set('transcript', context.transcript);
  if (context.meetingType) params.set('meeting_type', context.meetingType);
  if (context.outputPackage) params.set('output_package', context.outputPackage);
  if (context.audience) params.set('audience', context.audience);
  if (context.urgency) params.set('urgency', context.urgency);
  if (context.workflowTarget) params.set('workflow_target', context.workflowTarget);
  return `/connectors/meeting/package?${params.toString()}`;
}

function inferMeetingTranscriptFromPrompt(prompt = '') {
  const text = cleanBrowserWorkerValue(prompt);
  if (!text) return '';
  if (text.length < 24 && !/\n/.test(String(prompt || ''))) return '';
  return String(prompt || '').trim().slice(0, 6000);
}

function buildJobProviderLinks({ targetRole, locationPreference, jobBoards }) {
  const boards = Array.isArray(jobBoards) && jobBoards.length ? jobBoards : ['linkedin', 'greenhouse', 'lever', 'ashby'];
  return boards.map((board) => {
    if (board === 'linkedin') {
      return {
        label: 'Open LinkedIn Jobs',
        url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(targetRole)}&location=${encodeURIComponent(locationPreference)}`,
        note: 'Open a live LinkedIn Jobs search with the prepared role and location.',
        preferredForExecution: true,
        provider: 'linkedin_jobs'
      };
    }
    const domain = board === 'greenhouse'
      ? 'greenhouse.io'
      : board === 'lever'
        ? 'jobs.lever.co'
        : board === 'ashby'
          ? 'ashbyhq.com'
        : board === 'workable'
          ? 'apply.workable.com'
          : 'indeed.com';
    const query = [`site:${domain}`, targetRole, locationPreference].filter(Boolean).join(' ');
    return {
      label: `Search ${titleize(board)}`,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      note: `Search ${titleize(board)} roles for the prepared job workflow.`,
      preferredForExecution: false,
      provider: board
    };
  });
}

function inferJobTargetRole(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/\bceo\b|chief executive|founder/.test(lower)) return 'CEO';
  if (/\bcto\b|chief technology/.test(lower)) return 'CTO';
  if (/\bcfo\b|chief financial/.test(lower)) return 'CFO';
  if (/\bcoo\b|chief operating/.test(lower)) return 'COO';
  if (/product manager|pm\b|product roles?|ai product/.test(lower)) return 'Product Manager';
  if (/designer|ux|ui/.test(lower)) return 'Product Designer';
  if (/software|engineer|developer/.test(lower)) return 'Software Engineer';
  if (/data analyst|analytics/.test(lower)) return 'Data Analyst';
  if (/sales/.test(lower)) return 'Sales';
  if (/marketing/.test(lower)) return 'Marketing';
  if (/operations|ops/.test(lower)) return 'Operations';
  return 'Software Engineer';
}

function inferJobLocationPreference(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/remote/.test(lower)) return 'Remote';
  if (/hybrid/.test(lower)) return 'Hybrid';
  if (/\bsf\b|san francisco/i.test(prompt)) return 'San Francisco';
  if (/bay area/.test(lower)) return 'Bay Area';
  const locationMatch = String(prompt || '').match(/\b(in|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/);
  return locationMatch ? locationMatch[2] : 'Remote';
}

function inferJobBoards(prompt) {
  const lower = String(prompt || '').toLowerCase();
  const boards = [];
  if (/linkedin/.test(lower)) boards.push('linkedin');
  if (/greenhouse/.test(lower)) boards.push('greenhouse');
  if (/lever/.test(lower)) boards.push('lever');
  if (/ashby/.test(lower)) boards.push('ashby');
  if (/workable/.test(lower)) boards.push('workable');
  if (!boards.length && /\b(no login|without login|do not.*login|don't.*login|no account|no sign[- ]?in|without sign[- ]?in)\b/.test(lower)) {
    boards.push('greenhouse', 'lever', 'ashby', 'workable');
  }
  if (!boards.length) boards.push('linkedin', 'greenhouse', 'lever', 'ashby');
  return boards;
}

function inferJobSubmissionMode(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/auto[- ]?submit|apply automatically|ship applications|submit for me/.test(lower)) return 'auto_submit_simple_forms';
  return 'review_before_submit';
}

function inferJobApplicationMode(prompt) {
  const lower = String(prompt || '').toLowerCase();
  if (/\b(apply|applications?|submit|auto[- ]?submit|ship applications|run the applications?|for me)\b/.test(lower)) {
    return JOB_APPLICATION_MODE_RUN;
  }
  return JOB_APPLICATION_MODE_PLAN;
}

function inferRequestedJobApplicationLimit(prompt) {
  const match =
    String(prompt || '').match(/\b(\d{1,2})\s+(applications|jobs)\b/i) ||
    String(prompt || '').match(/\b(\d{1,2})\s+(?:remote|hybrid|onsite|ai|product|software|engineering|design|sales|marketing|\w+\s+){0,5}(?:roles|openings|positions)\b/i);
  return match ? Number(match[1]) : null;
}

function inferJobApplicationLimit(prompt) {
  const count = inferRequestedJobApplicationLimit(prompt) ?? 3;
  return String(Math.max(1, Math.min(count, 10)));
}

function inferRequestedTripLength(prompt) {
  const match = String(prompt || '').match(/\b(\d{1,2})\s*(day|days|night|nights)\b/i);
  if (!match) return '';
  const count = Math.max(1, Math.min(Number(match[1]), 21));
  const unit = String(match[2] || 'days').toLowerCase().startsWith('night') ? 'night' : 'day';
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

function buildJobHandoffUrl(context = {}) {
  const params = new URLSearchParams();
  if (context.targetRole) params.set('target_role', context.targetRole);
  if (context.locationPreference) params.set('location', context.locationPreference);
  if (context.jobBoards?.length) params.set('boards', context.jobBoards.join(','));
  if (context.jobMode) params.set('job_mode', normalizeJobApplicationMode(context.jobMode));
  if (context.submissionMode) params.set('submission_mode', context.submissionMode);
  if (context.applicationLimit) params.set('application_limit', context.applicationLimit);
  return `/connectors/jobs/apply?${params.toString()}`;
}

function buildContent(lines) {
  return lines.filter(Boolean).join('\n');
}

function buildFoodRestaurants(cuisine, zipCode = '') {
  const resolvedZip = String(zipCode || '').trim() || LOCALIZED_FOOD_ZIP;
  if (resolvedZip === LOCALIZED_FOOD_ZIP) {
    return get94107Catalog(cuisine).slice(0, 6).map((entry, index) => ({
      name: entry.name,
      eta: index % 2 === 0 ? '24-36 min' : '28-40 min',
      total: entry.menuItems.find((item) => {
        const price = Number(String(item.price || '').match(/(\d+(?:\.\d{1,2})?)/)?.[1] || 0);
        return price >= 10;
      })?.price || entry.menuItems[0]?.price || null,
      highlight: `${entry.cuisines[0]} · ${entry.policies.join(' / ')}`
    }));
  }
  const title = titleize(cuisine);
  const zip = resolvedZip;
  const coastal = zip === '19958';
  if (coastal && cuisine === 'sushi') {
    return [
      { name: 'Stingray Sushi', eta: '24-32 min', total: '$29', highlight: `near ${zip}` },
      { name: 'Atlantic Omakase Bar', eta: '31-39 min', total: '$36', highlight: 'premium local pick' },
      { name: 'Boardwalk Sushi Co.', eta: '26-34 min', total: '$32', highlight: 'fastest near you' }
    ];
  }
  if (coastal && cuisine === 'tacos') {
    return [
      { name: 'Reef Taco Kitchen', eta: '18-26 min', total: '$24', highlight: `near ${zip}` },
      { name: 'Surfside Taqueria', eta: '22-30 min', total: '$27', highlight: 'best value' },
      { name: 'Salt Air Tacos', eta: '26-34 min', total: '$29', highlight: 'highest rated' }
    ];
  }
  return [
    { name: `${title} House${zip ? ` ${zip}` : ''}`, eta: '28-36 min', total: '$26', highlight: zip ? `near ${zip}` : 'best value' },
    { name: `Neon ${title}`, eta: '22-30 min', total: '$34', highlight: 'fastest' },
    { name: `${title} Garden`, eta: '35-45 min', total: '$31', highlight: 'highest rated' }
  ];
}

function buildFoodMenuItems(cuisine, zipCode = '') {
  const resolvedZip = String(zipCode || '').trim() || LOCALIZED_FOOD_ZIP;
  if (resolvedZip === LOCALIZED_FOOD_ZIP) {
    const catalogEntries = get94107Catalog(cuisine);
    const catalogItems = catalogEntries[0]?.menuItems?.slice(0, 6) || [];
    if (catalogItems.length) return catalogItems;
  }
  if (cuisine === 'sushi') {
    return [
      { name: 'Spicy tuna roll', price: '$11' },
      { name: 'Salmon avocado roll', price: '$10' },
      { name: 'Shrimp tempura roll', price: '$13' },
      { name: 'Miso soup', price: '$4' },
      { name: 'Edamame', price: '$6' },
      { name: 'Seaweed salad', price: '$7' }
    ];
  }
  if (cuisine === 'tacos') {
    return [
      { name: 'Carne asada tacos', price: '$12' },
      { name: 'Chicken tinga tacos', price: '$11' },
      { name: 'Guacamole', price: '$7' },
      { name: 'Chips and salsa', price: '$5' },
      { name: 'Street corn', price: '$6' }
    ];
  }
  if (cuisine === 'pizza') {
    return [
      { name: 'Margherita pizza', price: '$15' },
      { name: 'Pepperoni pizza', price: '$17' },
      { name: 'Garlic knots', price: '$6' },
      { name: 'Caesar salad', price: '$8' }
    ];
  }
  return [
    { name: `${titleize(cuisine)} main`, price: '$14' },
    { name: `${titleize(cuisine)} side`, price: '$7' },
    { name: 'Drink', price: '$3' }
  ];
}

function buildTravelOptions(destination) {
  return {
    flights: [
      { label: `Morning route to ${destination}`, price: '$620', carrier: 'Air Atlantic' },
      { label: `Evening route to ${destination}`, price: '$710', carrier: 'SkyBridge' }
    ],
    stays: [
      { label: `Central stay in ${destination}`, price: '$180/night', style: 'boutique' },
      { label: `${destination} wildlife lodge`, price: '$240/night', style: 'experience' }
    ]
  };
}

function buildDeveloperToolOptions(query) {
  const normalized = String(query || '').toLowerCase();
  const openclaw = /openclaw/.test(normalized);
  return [
    {
      name: openclaw ? 'OpenClaw' : 'Agent Workflow Kit',
      type: 'agent framework',
      source: 'GitHub',
      fit: 'best for autonomous multi-agent workflows'
    },
    {
      name: 'OpenRouter',
      type: 'hosted model router',
      source: 'API provider',
      fit: 'best for rapid model access and fallback routing'
    },
    {
      name: 'LangGraph',
      type: 'orchestration library',
      source: 'GitHub',
      fit: 'best for explicit stateful agent graphs'
    },
    {
      name: 'DSPy',
      type: 'programming framework',
      source: 'GitHub',
      fit: 'best for optimizing prompts and model pipelines'
    }
  ];
}

const CONNECTOR_REGISTRY = {
  'food-demo-v1': {
    id: 'food-demo-v1',
    kind: 'food',
    label: 'Local Food Connector',
    execution: 'local_handoff',
    helperAgents: ['restaurant-scout', 'cart-builder', 'checkout-runner'],
    modes: ['search', 'cart', 'checkout_link'],
    privacyModel: 'zip and cuisine to model, exact street/payment kept local',
    fields: ['zip_code', 'street_address', 'delivery_notes', 'payment_method'],
    plan({ prompt, profileSummary = {} }) {
      const cuisine = inferFoodCuisine(prompt);
      return {
        requiresApproval: true,
        connector: this.id,
        title: `Order ${cuisine}`,
        summary: `I can put together ${cuisine} options for you.`,
        preview: [
          'Delivery window: 35-50 minutes',
          'Estimated total: $24-$38'
        ].join('\n'),
        toolCalls: [
          { tool: 'food.search_restaurants', args: { cuisine } },
          { tool: 'food.build_cart', args: { cuisine, partySize: 1 } },
          { tool: 'food.checkout_link', args: { cuisine } }
        ],
        privacyNotes: [
          profileSummary.zipCode ? `Delivery zone available locally: ${profileSummary.zipCode}` : 'Exact address remains local-only.',
          profileSummary.addressReady ? 'Street address is available in the local vault and withheld from the model.' : 'Street address can be added only at approval time.'
        ],
        handoff: {
          label: 'Checkout options',
          url: buildFoodHandoffUrl(cuisine, profileSummary, {
            budgetHint: inferBudgetHint(prompt),
            timingHint: inferTimingHint(prompt),
            partySize: inferPartySize(prompt),
            orderText: buildFoodOrderText(prompt, cuisine)
          })
        },
        connectorSpec: {
          id: this.id,
          kind: this.kind,
          label: this.label,
          execution: this.execution,
          helperAgents: this.helperAgents,
          modes: this.modes,
          privacyModel: this.privacyModel,
          fields: this.fields
        },
        actionLabel: 'Ready to prepare checkout options?',
        approveLabel: 'Checkout options',
        rejectLabel: 'Not yet',
        autoOpenHandoff: true,
        localContext: {
          cuisine,
          orderText: buildFoodOrderText(prompt, cuisine),
          budgetHint: inferBudgetHint(prompt),
          timingHint: inferTimingHint(prompt),
          partySize: inferPartySize(prompt)
        }
      };
    },
    execute(actionRun, { profileSummary = {} } = {}) {
      const cuisine = actionRun.localContext?.cuisine || 'dinner';
      const orderText = actionRun.localContext?.orderText || `${titleize(cuisine)} plus a drink`;
      const budgetHint = actionRun.localContext?.budgetHint || 'Around $25-$35';
      const timingHint = actionRun.localContext?.timingHint || 'Tonight';
      const partySize = actionRun.localContext?.partySize || '1 person';
      const addressState = profileSummary.addressReady
        ? 'Exact delivery address stayed local and is ready for checkout.'
        : 'Add your exact delivery address locally before final checkout.';
      const orderLabel = titleize(cuisine);
      const handoffUrl = buildFoodHandoffUrl(cuisine, profileSummary, { orderText, budgetHint, timingHint, partySize });
      const restaurants = buildFoodRestaurants(cuisine, profileSummary.zipCode);
      const summary = {
        connectorId: this.id,
        handoffUrl,
        checkoutState: 'ready_for_handoff',
        orderSummary: orderText,
        eta: '42 minutes',
        budgetHint,
        timingHint,
        partySize,
        addressState,
        restaurants
      };
      return {
        mode: 'local-connector-runtime',
        content: buildContent([
          `${orderLabel} order prepared.`,
          'A checkout handoff is ready.',
          `ETA: ${summary.eta}`,
          `Order: ${summary.orderSummary}`,
          `Budget: ${budgetHint} · Timing: ${timingHint} · Party size: ${partySize}`,
          addressState,
          'Next step: open the checkout handoff and confirm the order with your local delivery details.'
        ]),
        actionSummary: summary,
        handoff: {
          label: 'Checkout options',
          url: handoffUrl
        },
        outputHash: `0x${hash(`${actionRun.id}:${JSON.stringify(summary)}`)}`,
        proofType: 'connector-handoff',
        proofHash: `0x${hash(`connector:${this.id}:${actionRun.id}:${JSON.stringify(summary)}`)}`,
        verifier: this.id,
        settlementRef: `magic-city:connector:${this.id}:${actionRun.id}`,
        latencyMs: 180
      };
    },
    handoffData(searchParams) {
      const cuisine = searchParams.get('cuisine') || 'dinner';
      const zip = searchParams.get('zip') || LOCALIZED_FOOD_ZIP;
      const addressReady = searchParams.get('address_ready') === '1';
      const budgetHint = searchParams.get('budget') || 'Around $25-$35';
      const timingHint = searchParams.get('timing') || 'Tonight';
      const partySize = searchParams.get('party_size') || '1 person';
      const orderText = searchParams.get('order_text') || `${titleize(cuisine)} plus a drink`;
      const restaurants = buildFoodRestaurants(cuisine, zip);
      const menuItems = buildFoodMenuItems(cuisine, zip);
      return {
        title: `Food Checkout: ${titleize(cuisine)}`,
        subtitle: 'Prepared by helper agents for a local-first checkout flow. Exact address and payment should remain in your local vault until confirmation.',
        helperAgents: this.helperAgents,
        kind: 'food',
        choices: {
          restaurants,
          menuItems,
          deliveryModes: ['Delivery', 'Pickup', 'Reservation'],
          budgetHints: [budgetHint, 'Under $25', 'Around $35-$45'],
          timingHints: [timingHint, 'ASAP', 'Later tonight', 'Friday 7:30 PM', 'Saturday 8:00 PM']
        },
        defaults: {
          restaurant: restaurants[0]?.name || '',
          cartNote: orderText,
          deliveryMode: 'Delivery',
          budgetHint,
          timingHint,
          partySize,
          reservationWindow: '',
          item1: menuItems[0]?.name || '',
          item1Qty: '1',
          item2: menuItems[1]?.name || '',
          item2Qty: '1'
        },
        sections: [
          {
            title: 'Prepared Cart',
            items: [
              `Cuisine: ${cuisine}`,
              `Delivery zone: ${zip}`,
              `Order request: ${orderText}`,
              `Budget: ${budgetHint}`,
              `Timing: ${timingHint}`,
              `Party size: ${partySize}`
            ]
          },
          {
            title: 'Restaurant Options',
            items: restaurants.map((option) => `${option.name} · ${option.eta} · ${option.total} · ${option.highlight}`)
          },
          {
            title: 'Suggested Menu',
            items: menuItems.map((item) => `${item.name} · ${item.price}`)
          },
          {
            title: 'Privacy Boundary',
            items: [
              'The model only used cuisine and coarse location.',
              addressReady ? 'Exact delivery address is available locally and withheld from the model.' : 'Exact delivery address is not yet loaded into the local checkout surface.'
            ]
          }
        ],
        providerLinks: buildDeliveryProviderLinks({ cuisine, zipCode: zip, queryText: orderText }),
        nextStep: 'Choose whether you want to finish this in a live delivery UI yourself or hand the confirmed session to an agent.',
        primaryActionLabel: 'Confirm local food handoff',
        humanActionLabel: 'Finish checkout myself',
        agentActionLabel: 'Let an agent complete this'
      };
    }
  },
  'browser-worker-demo-v1': {
    id: 'browser-worker-demo-v1',
    kind: 'browser',
    label: 'Magic Internet Agent',
    execution: 'browser_handoff',
    helperAgents: ['site-navigator', 'form-prepper', 'handoff-recorder'],
    modes: ['inspect', 'prepare_cart_or_form', 'policy_gated_checkout', 'pause_for_handoff'],
    privacyModel: 'issuer/card wallet is card authority; Apple/Google/browser autofill is secure payment entry; Magic City is mission authority and checkout orchestration; Zeko/mission-bound auth is proof/audit; raw card details stay out of Magic City',
    fields: ['target_url', 'goal', 'budget', 'preferences', 'confirmation_email', 'allowed_merchants'],
    plan({ prompt, browserMission = null }) {
      const mission = browserMission && typeof browserMission === 'object' ? browserMission : {};
      const targetUrl = mission.targetUrl || inferBrowserTargetUrl(prompt);
      const goal = mission.goal || inferBrowserGoal(prompt);
      const budget = mission.budget || inferBrowserBudget(prompt);
      const stopCondition = inferBrowserStopCondition(prompt);
      const contextualAuthority = inferBrowserContextualAuthority(prompt, targetUrl);
      return {
        requiresApproval: true,
        connector: this.id,
        title: 'Prepare Magic Internet Agent',
        summary: 'I can open public pages, use LLM guidance to narrow choices, prepare the safest handoff, then stop before login, payment, or final approval.',
        preview: [
          `Target: ${targetUrl || 'add URL in the execution sheet'}`,
          `Goal: ${goal}`,
          `Budget: ${budget || 'add max spend in the execution sheet'}`,
          'Default: hosted public prep; hand off before login, card/payment, or final approval'
        ].join('\n'),
        toolCalls: [
          { tool: 'browser.open', args: { targetUrl } },
          { tool: 'browser.inspect', args: { goal } },
          { tool: 'browser.prepare_handoff', args: { stopCondition } }
        ],
        privacyNotes: [],
        handoff: {
          label: 'Open browser worker',
          url: buildBrowserWorkerHandoffUrl({
            targetUrl,
            goal,
            budget,
            stopCondition,
            actionDepth: contextualAuthority.actionDepth,
            trustTier: contextualAuthority.trustTier,
            allowedMerchants: contextualAuthority.allowedMerchants,
            contextualAuthorityMode: contextualAuthority.mode
          })
        },
        connectorSpec: {
          id: this.id,
          kind: this.kind,
          label: this.label,
          execution: this.execution,
          helperAgents: this.helperAgents,
          modes: this.modes,
          privacyModel: this.privacyModel,
          fields: this.fields
        },
        actionLabel: 'Ready to run the Magic Internet Agent?',
        approveLabel: 'Run agent',
        rejectLabel: 'Not yet',
        localContext: {
          targetUrl,
          goal,
          budget,
          budgetScope: mission.budgetScope || inferBrowserBudgetScope(prompt),
          stopCondition,
          ...DEFAULT_AGENT_PAYMENT_PROFILE,
          actionDepth: contextualAuthority.actionDepth,
          trustTier: contextualAuthority.trustTier,
          allowedMerchants: contextualAuthority.allowedMerchants,
          contextualAuthority,
          browserMissionExtraction: mission.extraction || null,
          shoppingItems: Array.isArray(mission.shoppingItems) ? mission.shoppingItems : [],
          excludedShoppingItems: Array.isArray(mission.excludedShoppingItems) ? mission.excludedShoppingItems : [],
          preferences: mission.preferences || null,
          shoppingSearchMode: mission.shoppingSearchMode || (Array.isArray(mission.shoppingItems) && mission.shoppingItems.length > 1 ? 'best_match_per_item' : 'single_item_best_match'),
          sharedConstraints: mission.sharedConstraints || (Array.isArray(mission.shoppingItems) && mission.shoppingItems.length > 1
            ? {
                targetUrl,
                budget,
                budgetScope: mission.budgetScope || inferBrowserBudgetScope(prompt)
              }
            : null)
        }
      };
    },
    execute(actionRun) {
      const targetUrl = actionRun.localContext?.targetUrl || '';
      const goal = actionRun.localContext?.goal || 'Move the site task forward until a safe handoff point.';
      const budget = actionRun.localContext?.budget || '';
      const stopCondition = actionRun.localContext?.stopCondition || 'Pause at login, captcha, payment, final submit, or uncertainty';
      const contextualAuthority = actionRun.localContext?.contextualAuthority || inferBrowserContextualAuthority(goal, targetUrl);
      const paymentProfile = { ...DEFAULT_AGENT_PAYMENT_PROFILE, ...(actionRun.localContext?.paymentProfile || {}) };
      const handoffUrl = buildBrowserWorkerHandoffUrl({
        targetUrl,
        goal,
        budget,
        stopCondition,
        actionDepth: contextualAuthority.actionDepth,
        trustTier: contextualAuthority.trustTier,
        allowedMerchants: contextualAuthority.allowedMerchants,
        contextualAuthorityMode: contextualAuthority.mode
      });
      const summary = {
        connectorId: this.id,
        handoffUrl,
        targetUrl,
        goal,
        budget,
        stopCondition,
        paymentProfile
      };
      return {
        mode: 'local-connector-runtime',
        content: buildContent([
	          'Magic Internet Agent is working.',
          targetUrl ? `Target: ${targetUrl}` : 'Target: add the URL in the execution sheet.',
          `Goal: ${goal}`,
          budget ? `Budget: ${budget}` : '',
          'I will pause only for missing input, login/MFA, payment/card entry, or final approval.'
        ]),
        actionSummary: summary,
        handoff: {
          label: 'Open browser worker',
          url: handoffUrl
        },
        outputHash: `0x${hash(`${actionRun.id}:${JSON.stringify(summary)}`)}`,
        proofType: 'connector-handoff',
        proofHash: `0x${hash(`connector:${this.id}:${actionRun.id}:${JSON.stringify(summary)}`)}`,
        verifier: this.id,
        settlementRef: `magic-city:connector:${this.id}:${actionRun.id}`,
        latencyMs: 110
      };
    },
    handoffData(searchParams) {
      const targetUrl = searchParams.get('target_url') || '';
      const goal = searchParams.get('goal') || 'Move the site task forward until a safe handoff point.';
      const constraints = searchParams.get('constraints') || '';
      const budget = searchParams.get('budget') || '';
      const stopCondition = searchParams.get('stop_condition') || 'Pause at login, captcha, payment, final submit, or uncertainty';
      const contextualAuthority = inferBrowserContextualAuthority([goal, constraints, budget].filter(Boolean).join(' '), targetUrl);
      const paymentProfile = { ...DEFAULT_AGENT_PAYMENT_PROFILE };
      const actionDepth = searchParams.get('action_depth') || contextualAuthority.actionDepth;
      const trustTier = searchParams.get('trust_tier') || contextualAuthority.trustTier;
      const allowedMerchants = searchParams.get('allowed_merchants') || contextualAuthority.allowedMerchants;
      const contextualAuthorityMode = searchParams.get('contextual_authority_mode') || contextualAuthority.mode;
      return {
        title: 'Magic Internet Agent',
        subtitle: 'Review the task, then run. The agent will work until it needs your input, login, card/payment, or final approval.',
        helperAgents: this.helperAgents,
        kind: 'browser',
        fields: this.fields,
        providerLinks: targetUrl ? [{ label: 'Target site', url: targetUrl, note: 'The browser worker opens this first.', preferredForExecution: true, provider: 'target_site' }] : [],
        choices: {
          actionDepths: ['Inspect and summarize only', 'Search and compare', 'Fill safe fields', 'Prepare cart or form'],
          trustTiers: ['ask_every_time', 'auto_under_cap', 'allowlisted_merchants_only'],
          stopConditions: [
            'Pause at login, captcha, payment, final submit, or uncertainty',
            'Pause before payment or final purchase',
            'Pause before final submit',
            'Pause at login or account creation'
          ],
          checkoutRunnerModes: [
            'server_prep_only',
            'manual_takeover_only'
          ],
          paymentModes: ['free_preview', 'magic_city_credits']
        },
        defaults: {
          targetUrl,
          goal,
          constraints,
          budget,
          actionDepth,
          stopCondition,
          paymentFundingMode: 'magic_city_credits',
          cardName: paymentProfile.cardName,
          fundingSource: paymentProfile.fundingSource,
          checkoutRunnerMode: paymentProfile.checkoutRunnerMode,
          checkoutRunnerReceiptProof: paymentProfile.checkoutRunnerReceiptProof,
          checkoutRunnerStopBeforeFinalSubmit: paymentProfile.checkoutRunnerStopBeforeFinalSubmit,
          cardAuthority: paymentProfile.cardAuthority,
          paymentEntryAuthority: paymentProfile.paymentEntryAuthority,
          missionAuthority: paymentProfile.missionAuthority,
          proofAuthority: paymentProfile.proofAuthority,
          paymentProfileDisplay: paymentProfile.paymentProfileDisplay,
          limitSource: paymentProfile.limitSource,
          allowedUse: paymentProfile.allowedUse,
          trustTier,
          magicCityPerTaskCap: paymentProfile.magicCityPerTaskCap,
          allowedMerchants,
          blockedUses: paymentProfile.blockedUses,
          killSwitch: paymentProfile.killSwitch,
          contextualAuthorityMode,
          privateNotes: ''
        },
        sections: [
          {
            title: 'Task',
            items: [
              targetUrl ? `Target: ${targetUrl}` : 'Target: add a URL before running',
              `Goal: ${goal}`,
              budget ? `Budget: ${budget}` : 'Budget: add max spend before running',
              allowedMerchants ? `Merchant allowlist: ${allowedMerchants}` : 'Merchant allowlist: inferred from task or settings'
            ]
          },
          {
            title: 'Confirmation delivery',
            items: [
              'Use the local data vault confirmation email when available.',
              'If the vault has no confirmation email, suggest the signed-in Magic City account email.',
              'Do not invent confirmation contacts.'
            ]
          }
        ],
        nextStep: 'Run the agent. It will ask in chat or hand off locally only when it needs you.',
        primaryActionLabel: 'Open agent',
        humanActionLabel: 'Open site myself',
        agentActionLabel: 'Run browser worker'
      };
    }
  },
  'travel-demo-v1': {
    id: 'travel-demo-v1',
    kind: 'travel',
    label: 'Local Travel Connector',
    execution: 'local_handoff',
    helperAgents: ['flight-scout', 'stay-scout', 'itinerary-builder'],
    modes: ['search', 'itinerary', 'live_search', 'road_trip_guidebook'],
    privacyModel: 'coarse location to model, exact booking details kept local',
    fields: ['home_airport', 'budget_range', 'travel_dates', 'passport_name', 'road_trip_route', 'road_trip_pace', 'road_trip_length'],
    plan({ prompt, profileSummary = {}, context = [] }) {
      const journeyMode = inferTravelJourneyMode(prompt, context);
      if (journeyMode === 'road_trip_guidebook') {
        const guide = inferRoadTripGuide(prompt, extractTravelDestinationFromConversation(prompt, context));
        const requestedTripLength = inferRequestedTripLength(prompt);
        const roadTripLength = requestedTripLength || guide.defaultLength;
        const tripGoal = titleize(String(prompt || '').replace(/[?.!]+$/g, '')) || `${guide.region} road trip guidebook for ${guide.label}`;
        return {
          requiresApproval: true,
          connector: this.id,
          title: `Export ${guide.region} road trip guidebook`,
          summary: `I can package the selected road-trip plan into a reusable guidebook artifact around the ${guide.label} route.`,
          preview: [
            `Route: ${guide.label}`,
            `Why: ${guide.summary}`,
            `Theme: ${guide.theme}`,
            `Requested length: ${roadTripLength}`,
            `Day structure: ${guide.dayStops.map((stop) => `${stop.day}:${stop.overnight}`).join(' · ')}`,
            'Magic City packages the guidebook after the chat plan. Maps, stays, and park bookings stay separate unless you explicitly push into a later checkout flow.'
          ].join('\n'),
          toolCalls: [
            { tool: 'travel.build_itinerary', args: { mode: 'road_trip_guidebook', route: guide.label } },
            { tool: 'travel.search_hotels', args: { destination: guide.label, nights: guide.dayStops.length - 1 } }
          ],
          privacyNotes: [
            'Exact driver identity and vehicle details can stay local.',
            'This road trip guidebook starts as a local-first planning artifact, not a fake booking checkout.'
          ],
          handoff: {
            label: 'Road trip guidebook',
            url: buildTravelHandoffUrl(guide.region, profileSummary, {
              tripGoal,
              travelMode: 'road_trip_guidebook',
              roadTripRoute: guide.key,
              roadTripPace: guide.defaultPace,
              roadTripLength,
              roadTripInterests: guide.theme,
              startCity: guide.startCity,
              endCity: guide.endCity
            })
          },
          connectorSpec: {
            id: this.id,
            kind: this.kind,
            label: this.label,
            execution: this.execution,
            helperAgents: this.helperAgents,
            modes: this.modes,
            privacyModel: this.privacyModel,
            fields: this.fields
          },
          actionLabel: `Ready to export a ${guide.region} road trip guidebook artifact?`,
          approveLabel: 'Export guidebook',
          rejectLabel: 'Not yet',
          localContext: {
            destination: guide.region,
            travelMode: 'road_trip_guidebook',
            tripGoal,
            roadTripRoute: guide.key,
            roadTripLabel: guide.label,
            roadTripPace: guide.defaultPace,
            roadTripLength,
            roadTripInterests: guide.theme,
            startCity: guide.startCity,
            endCity: guide.endCity,
            roadTripDayStopsPreview: buildRoadTripDayStopPreview(guide)
          }
        };
      }
      const suggestion = pickTravelDestination(prompt, context);
      if (!suggestion) return null;
      return {
        requiresApproval: true,
        connector: this.id,
        title: `Draft itinerary for ${suggestion.destination}`,
        summary: `I can put together live travel options for ${suggestion.destination}.`,
        preview: [
          `I have enough to prepare options for ${suggestion.destination}.`,
          `Why: ${suggestion.rationale}`,
          `Planned stops: ${suggestion.activities.join(', ')}`,
          'Magic City will prepare live booking searches and an itinerary package. It will not invent a payment link or claim your trip is already booked.'
        ].join('\n'),
        toolCalls: [
          { tool: 'travel.search_flights', args: { destination: suggestion.destination, cabin: 'economy' } },
          { tool: 'travel.search_hotels', args: { destination: suggestion.destination, nights: 4 } },
          { tool: 'travel.build_itinerary', args: { destination: suggestion.destination } }
        ],
        privacyNotes: [
          profileSummary.homeAirport ? `Home airport available locally: ${profileSummary.homeAirport}` : 'Exact traveler identity stays local.',
          profileSummary.travelWindow ? `Travel window: ${profileSummary.travelWindow}` : 'Travel dates can be added at approval time.'
        ],
        handoff: {
          label: 'Travel concierge',
          url: buildTravelHandoffUrl(suggestion.destination, profileSummary, {
            tripGoal: titleize(String(prompt || '').replace(/[?.!]+$/g, '')),
            travelMode: 'itinerary_build'
          })
        },
        connectorSpec: {
          id: this.id,
          kind: this.kind,
          label: this.label,
          execution: this.execution,
          helperAgents: this.helperAgents,
          modes: this.modes,
          privacyModel: this.privacyModel,
          fields: this.fields
        },
        actionLabel: 'Ready to prepare a travel concierge package?',
        approveLabel: 'Prepare itinerary',
        rejectLabel: 'Not yet',
        localContext: {
          destination: suggestion.destination,
          activities: suggestion.activities,
          rationale: suggestion.rationale,
          tripGoal: titleize(String(prompt || '').replace(/[?.!]+$/g, '')),
          travelMode: 'itinerary_build',
          travelWindow: profileSummary.travelWindow || 'Flexible',
          homeAirport: profileSummary.homeAirport || 'Local airport'
        }
      };
    },
    execute(actionRun, { profileSummary = {} } = {}) {
      if (actionRun.localContext?.travelMode === 'road_trip_guidebook') {
        const guide = getRoadTripGuide(actionRun.localContext?.roadTripRoute || '');
        const tripGoal = actionRun.localContext?.tripGoal || `${guide.region} road trip guidebook for ${guide.label}`;
        const handoffUrl = buildTravelHandoffUrl(guide.region, profileSummary, {
          tripGoal,
          travelMode: 'road_trip_guidebook',
          roadTripRoute: guide.key,
          roadTripPace: actionRun.localContext?.roadTripPace || guide.defaultPace,
          roadTripLength: actionRun.localContext?.roadTripLength || guide.defaultLength,
          roadTripInterests: actionRun.localContext?.roadTripInterests || guide.theme,
          startCity: actionRun.localContext?.startCity || guide.startCity,
          endCity: actionRun.localContext?.endCity || guide.endCity
        });
        const summary = {
          connectorId: this.id,
          handoffUrl,
          checkoutState: 'guidebook_ready',
          travelMode: 'road_trip_guidebook',
          routeLabel: guide.label,
          itinerary: guide.dayStops.map((stop) => `${stop.route} -> ${stop.overnight}`),
          tripGoal
        };
        return {
          mode: 'local-connector-runtime',
          content: buildContent([
            `${guide.region} road trip guidebook prepared for ${guide.label}.`,
            `Route: ${guide.startCity} to ${guide.endCity}`,
            `Theme: ${guide.theme}`,
            `Plan: ${guide.dayStops.map((stop) => `Day ${stop.day} ${stop.overnight}`).join(', ')}`,
            'Next step: open the guidebook handoff and review the day-by-day route, map links, overnight areas, and stop suggestions locally.'
          ]),
          actionSummary: summary,
          handoff: {
            label: 'Road trip guidebook',
            url: handoffUrl
          },
          outputHash: `0x${hash(`${actionRun.id}:${JSON.stringify(summary)}`)}`,
          proofType: 'connector-handoff',
          proofHash: `0x${hash(`connector:${this.id}:${actionRun.id}:${JSON.stringify(summary)}`)}`,
          verifier: this.id,
          settlementRef: `magic-city:connector:${this.id}:${actionRun.id}`,
          latencyMs: 180
        };
      }
      const destination = actionRun.localContext?.destination || 'Selected destination';
      const activities = actionRun.localContext?.activities || ['Arrival', 'City walk', 'Dining'];
      const tripGoal = actionRun.localContext?.tripGoal || `Travel to ${destination}`;
      const handoffUrl = buildTravelHandoffUrl(destination, profileSummary, { tripGoal });
      const summary = {
        connectorId: this.id,
        handoffUrl,
        checkoutState: 'ready_for_handoff',
        estimatedBudget: '$1,450 - $2,100',
        itinerary: activities,
        tripGoal
      };
      return {
        mode: 'local-connector-runtime',
        content: buildContent([
          `Trip package prepared for ${destination}.`,
          `Budget: ${summary.estimatedBudget}`,
          `Plan: ${activities.join(', ')}`,
          `Goal: ${tripGoal}`,
          'Next step: open the travel concierge handoff and review the live booking searches locally.'
        ]),
        actionSummary: summary,
        handoff: {
          label: 'Travel concierge',
          url: handoffUrl
        },
        outputHash: `0x${hash(`${actionRun.id}:${JSON.stringify(summary)}`)}`,
        proofType: 'connector-handoff',
        proofHash: `0x${hash(`connector:${this.id}:${actionRun.id}:${JSON.stringify(summary)}`)}`,
        verifier: this.id,
        settlementRef: `magic-city:connector:${this.id}:${actionRun.id}`,
        latencyMs: 240
      };
    },
    handoffData(searchParams) {
      const travelModeParam = String(searchParams.get('travel_mode') || '').trim().toLowerCase();
      const requestedTravelMode = travelModeParam === 'checkout_handoff'
        ? 'checkout_handoff'
        : travelModeParam === 'road_trip_guidebook'
          ? 'road_trip_guidebook'
          : 'itinerary_build';
      const roadTripRouteKey = searchParams.get('road_trip_route') || '';
      const roadTripGuide = getRoadTripGuide(roadTripRouteKey);
      const destination = searchParams.get('destination') || 'your selected destination';
      const homeAirport = searchParams.get('home_airport') || 'local airport';
      const travelWindow = searchParams.get('travel_window') || 'your preferred dates';
      const tripGoal = searchParams.get('goal') || `Travel to ${destination}`;
      const options = buildTravelOptions(destination);
      const roadTripRoutes = listRoadTripGuides().map((guide) => ({
        key: guide.key,
        label: `${guide.region}: ${guide.label}`,
        theme: guide.theme,
        startCity: guide.startCity,
        endCity: guide.endCity,
        interestPreset: guide.key === 'yosemite-and-sierra'
          ? 'National parks'
          : guide.key === 'wine-country-and-redwoods'
            ? 'Wine country and design towns'
            : 'Coast and food',
        preview: buildRoadTripDayStopPreview(guide)
      }));
      const travelMode = requestedTravelMode;
      const providerLinks = travelMode === 'road_trip_guidebook'
        ? buildRoadTripProviderLinks(roadTripGuide)
        : buildTravelProviderLinks({ destination, homeAirport, tripGoal, travelWindow });
      return {
        title: travelMode === 'road_trip_guidebook' ? `${roadTripGuide.region} Road Trip Guidebook` : `Travel Concierge: ${destination}`,
        subtitle: travelMode === 'road_trip_guidebook'
          ? 'Prepared as a road trip guidebook. Start with a planning artifact that gives you a route, stop list, overnight structure, and live map/search links before any booking step.'
          : 'Prepared by helper agents for a local-first itinerary flow. Start with a 1-credit itinerary build, then switch into a funded checkout lane only if you want Magic City to continue the booking handoff.',
        helperAgents: this.helperAgents,
        kind: 'travel',
        choices: {
          ...options,
          nights: ['4 nights', '5 nights', '6 nights'],
          travelModes: travelMode === 'road_trip_guidebook'
            ? ['itinerary_build', 'road_trip_guidebook', 'checkout_handoff']
            : ['itinerary_build', 'checkout_handoff'],
          checkoutFundingRails: ['stripe_balance', 'onchain_usdc']
          ,
          roadTripRoutes,
          roadTripPaces: ['Relaxed scenic days', 'Balanced scenic days', 'Long driving days'],
          roadTripLengths: ['3 days', '5 days', '7 days'],
          roadTripInterests: ['Coast and food', 'National parks', 'Wine country and design towns', 'Family-friendly stops', 'EV-friendly routing']
        },
        defaults: {
          destination,
          tripGoal,
          flight: options.flights[0]?.label || '',
          stay: options.stays[0]?.label || '',
          nights: '5 nights',
          travelMode,
          checkoutFundingRail: 'stripe_balance',
          checkoutFundingNetworkKey: 'ethereum',
          roadTripRoute: roadTripGuide.key,
          roadTripPace: searchParams.get('road_trip_pace') || roadTripGuide.defaultPace,
          roadTripLength: searchParams.get('road_trip_length') || roadTripGuide.defaultLength,
          roadTripInterests: searchParams.get('road_trip_interests')
            || (roadTripGuide.key === 'yosemite-and-sierra'
              ? 'National parks'
              : roadTripGuide.key === 'wine-country-and-redwoods'
                ? 'Wine country and design towns'
                : 'Coast and food'),
          startCity: searchParams.get('start_city') || roadTripGuide.startCity,
          endCity: searchParams.get('end_city') || roadTripGuide.endCity,
          roadTripDayStopsPreview: buildRoadTripDayStopPreview(roadTripGuide)
        },
        sections: [
          {
            title: travelMode === 'road_trip_guidebook' ? 'Guidebook Summary' : 'Trip Summary',
            items: [
              ...(travelMode === 'road_trip_guidebook'
                ? [
                    `Region: ${roadTripGuide.region}`,
                    `Route: ${roadTripGuide.label}`,
                    `Start / end: ${roadTripGuide.startCity} -> ${roadTripGuide.endCity}`,
                    `Theme: ${roadTripGuide.theme}`,
                    'Flow: build the guidebook first, then book stays or park entries separately if you want'
                  ]
                : [
                    `Destination: ${destination}`,
                    `Home airport: ${homeAirport}`,
                    `Travel window: ${travelWindow}`,
                    `Goal: ${tripGoal}`,
                    'Budget range: $1,450-$2,100',
                    'Flow: build itinerary first, then fund checkout only if you want Magic City to continue'
                  ])
            ]
          },
          ...(travelMode === 'road_trip_guidebook'
            ? [
                {
                  title: 'Day-by-day route',
                  items: roadTripGuide.dayStops.map((stop) => `Day ${stop.day}: ${stop.route} · ${stop.driveTime} · overnight ${stop.overnight}`)
                },
                {
                  title: 'Stop shape',
                  items: roadTripGuide.dayStops.map((stop) => `Day ${stop.day}: highlights ${stop.highlights.join(', ')} · meal stop ${stop.mealStop}`)
                }
              ]
            : [
                {
                  title: 'Flight Options',
                  items: options.flights.map((option) => `${option.label} · ${option.carrier} · ${option.price}`)
                },
                {
                  title: 'Stay Options',
                  items: options.stays.map((option) => `${option.label} · ${option.style} · ${option.price}`)
                }
              ])
        ],
        providerLinks,
        nextStep: travelMode === 'road_trip_guidebook'
          ? 'Use this as an export step after the chat plan. Magic City packages map and stay links locally without pretending the trip is already booked.'
          : 'Choose whether you want a 1-credit itinerary build first or a funded checkout handoff. Magic City only shows a real payment or supplier checkout when one actually exists.',
        primaryActionLabel: travelMode === 'road_trip_guidebook' ? 'Confirm guidebook export' : 'Confirm travel concierge handoff',
        humanActionLabel: travelMode === 'road_trip_guidebook' ? 'Open route maps myself' : 'Open live searches myself',
        agentActionLabel: travelMode === 'road_trip_guidebook' ? 'Export guidebook artifact' : 'Let an agent continue the travel flow'
      };
    }
  },
  'job-application-demo-v1': {
    id: 'job-application-demo-v1',
    kind: 'job',
    label: 'Job Application Connector',
    execution: 'browser_application',
    helperAgents: ['resume-parser', 'job-searcher', 'application-runner'],
    modes: ['review_only', 'assisted_apply', 'auto_submit_simple_forms'],
    privacyModel: 'job intent to model, resume and applicant details remain local until execution',
    fields: ['resume', 'target_role', 'location', 'job_boards', 'submission_mode', 'applicant_contact'],
    plan({ prompt }) {
      const targetRole = inferJobTargetRole(prompt);
      const locationPreference = inferJobLocationPreference(prompt);
      const jobBoards = inferJobBoards(prompt);
      const jobMode = inferJobApplicationMode(prompt);
      const submissionMode = inferJobSubmissionMode(prompt);
      const applicationLimit = inferJobApplicationLimit(prompt);
      const requestedApplicationLimit = inferRequestedJobApplicationLimit(prompt);
      const capNote = requestedApplicationLimit && requestedApplicationLimit > Number(applicationLimit)
        ? `Requested ${requestedApplicationLimit}; starting with ${applicationLimit} because the alpha run cap is ${applicationLimit}.`
        : '';
      const modeLabel = describeJobApplicationMode(jobMode);
      const isRun = jobMode === JOB_APPLICATION_MODE_RUN;
      return {
        requiresApproval: true,
        connector: this.id,
        title: `Prepare ${modeLabel.toLowerCase()}`,
        summary: isRun
          ? 'I can use your local resume and applicant details to auto-apply simple forms where the site allows it, then prep handoff links for the harder ATS flows.'
          : 'I can research matching jobs first, build a ranked application plan, and keep raw resume and applicant details behind the local-private boundary until you switch into execution.',
        preview: [
          `Role: ${targetRole}`,
          `Location: ${locationPreference}`,
          `Workflow: ${describeJobApplicationModeLower(jobMode)}`,
          `Boards: ${jobBoards.join(', ')} · ${submissionMode === 'auto_submit_simple_forms' ? 'auto submit simple forms' : 'final review'}`,
          capNote
        ].join('\n'),
        toolCalls: [
          { tool: 'jobs.parse_resume', args: { targetRole } },
          { tool: 'jobs.search_roles', args: { location: locationPreference, boards: jobBoards } },
          { tool: 'jobs.prepare_applications', args: { jobMode, submissionMode, applicationLimit } }
        ],
        privacyNotes: [
          'Resume text and applicant identifiers can stay local until execution begins.',
          'Sponsored zk verification should run in the background and expose only hashes, counts, and execution outcomes rather than raw personal details.'
        ],
        handoff: {
          label: `Open ${describeJobApplicationModeLower(jobMode)}`,
          url: buildJobHandoffUrl({ targetRole, locationPreference, jobBoards, jobMode, submissionMode, applicationLimit })
        },
        connectorSpec: {
          id: this.id,
          kind: this.kind,
          label: this.label,
          execution: this.execution,
          helperAgents: this.helperAgents,
          modes: this.modes,
          privacyModel: this.privacyModel,
          fields: this.fields
        },
        actionLabel: `Ready to prepare the ${describeJobApplicationModeLower(jobMode)}?`,
        approveLabel: isRun ? 'Prepare application run' : 'Build application plan',
        rejectLabel: 'Not yet',
        localContext: {
          targetRole,
          locationPreference,
          jobBoards,
          jobMode,
          submissionMode,
          applicationLimit
        }
      };
    },
    execute(actionRun) {
      const targetRole = actionRun.localContext?.targetRole || 'Software Engineer';
      const locationPreference = actionRun.localContext?.locationPreference || 'Remote';
      const jobBoards = Array.isArray(actionRun.localContext?.jobBoards) ? actionRun.localContext.jobBoards : ['linkedin', 'greenhouse', 'lever'];
      const jobMode = normalizeJobApplicationMode(actionRun.localContext?.jobMode || JOB_APPLICATION_MODE_PLAN);
      const submissionMode = actionRun.localContext?.submissionMode || 'review_before_submit';
      const applicationLimit = actionRun.localContext?.applicationLimit || '3';
      const handoffUrl = buildJobHandoffUrl({ targetRole, locationPreference, jobBoards, jobMode, submissionMode, applicationLimit });
      const summary = {
        connectorId: this.id,
        handoffUrl,
        targetRole,
        locationPreference,
        jobBoards,
        jobMode,
        submissionMode,
        applicationLimit
      };
      return {
        mode: 'local-connector-runtime',
        content: buildContent([
          `${describeJobApplicationMode(jobMode)} prepared.`,
          `Role: ${targetRole}`,
          `Location: ${locationPreference}`,
          `Boards: ${jobBoards.join(', ')}`,
          jobMode === JOB_APPLICATION_MODE_RUN
            ? (submissionMode === 'auto_submit_simple_forms'
              ? 'Next step: upload your resume, verify contact details, and let the agent ship simple applications automatically where the site permits it.'
              : 'Next step: upload your resume, confirm the search settings, and let the agent prepare reviewed applications.')
            : 'Next step: upload your resume only if you want sharper fit analysis, confirm the search settings, and let the agent build the application plan ledger first.'
        ]),
        actionSummary: summary,
        handoff: {
          label: `Open ${describeJobApplicationModeLower(jobMode)}`,
          url: handoffUrl
        },
        outputHash: `0x${hash(`${actionRun.id}:${JSON.stringify(summary)}`)}`,
        proofType: 'connector-handoff',
        proofHash: `0x${hash(`connector:${this.id}:${actionRun.id}:${JSON.stringify(summary)}`)}`,
        verifier: this.id,
        settlementRef: `magic-city:connector:${this.id}:${actionRun.id}`,
        latencyMs: 170
      };
    },
    handoffData(searchParams) {
      const targetRole = searchParams.get('target_role') || 'Software Engineer';
      const locationPreference = searchParams.get('location') || 'Remote';
      const jobBoards = inferJobBoards(searchParams.get('boards') || '');
      const jobMode = normalizeJobApplicationMode(searchParams.get('job_mode') || JOB_APPLICATION_MODE_PLAN);
      const submissionMode = searchParams.get('submission_mode') || 'review_before_submit';
      const applicationLimit = searchParams.get('application_limit') || '3';
      const isRun = jobMode === JOB_APPLICATION_MODE_RUN;
      return {
        title: describeJobApplicationMode(jobMode),
        subtitle: isRun
          ? 'Prepared for a private application run. Resume parsing and applicant details stay local until you explicitly let the execution agent act.'
          : 'Prepared for a private application plan. Research and ranking come first; applicant details can stay local until you intentionally switch into execution.',
        helperAgents: this.helperAgents,
        kind: 'job',
        providerLinks: buildJobProviderLinks({ targetRole, locationPreference, jobBoards }),
        choices: {
          jobModes: [JOB_APPLICATION_MODE_PLAN, JOB_APPLICATION_MODE_RUN],
          jobBoards: ['linkedin', 'greenhouse', 'lever', 'ashby', 'workable'],
          submissionModes: ['review_before_submit', 'auto_submit_simple_forms'],
          applicationLimits: ['1', '3', '5', '10'],
          paymentModes: ['free_preview', 'magic_city_credits']
        },
        defaults: {
          jobMode,
          targetRole,
          locationPreference,
          companyTargets: '',
          jobBoards: jobBoards.join(', '),
          submissionMode,
          applicationLimit,
          paymentFundingMode: 'free_preview',
          resumeText: '',
          coverLetterNotes: '',
          applicantName: '',
          applicantEmail: '',
          applicantPhone: '',
          linkedinUrl: '',
          portfolioUrl: ''
        },
        sections: [
          {
            title: isRun ? 'Prepared application run' : 'Prepared application plan',
            items: [
              `Target role: ${targetRole}`,
              `Location: ${locationPreference}`,
              `Boards: ${jobBoards.join(', ')}`,
              `Workflow: ${describeJobApplicationModeLower(jobMode)}`,
              `Mode: ${submissionMode === 'auto_submit_simple_forms' ? 'auto submit simple forms' : 'final review'}`
            ]
          },
          {
            title: isRun ? 'Execution boundary' : 'Research boundary',
            items: [
              isRun
                ? 'Resume text, applicant contact data, and profile URLs can remain local until execution starts.'
                : 'Resume text can stay local while Magic City researches likely openings and prepares a ranked plan first.',
              'Sponsored zk verification runs in the background and exposes counts, hashes, and status rather than the underlying resume or personal details.'
            ]
          }
        ],
        nextStep: isRun
          ? 'Upload your resume, confirm search and submission mode, and let the agent search, prefill, and ship applications where the target site allows it.'
          : 'Confirm the search, ranking, and board mix first. Then let Magic City build a per-job plan ledger before you switch into execution.',
        primaryActionLabel: isRun ? 'Confirm application run' : 'Confirm application plan',
        humanActionLabel: 'Review setup myself',
        agentActionLabel: isRun ? 'Let an agent apply' : 'Let an agent research'
      };
    }
  }
};

export const CONNECTOR_SPECS = Object.fromEntries(
  Object.entries(CONNECTOR_REGISTRY)
    .filter(([id]) => !['food-demo-v1', 'job-application-demo-v1', 'travel-demo-v1'].includes(id))
    .map(([id, connector]) => [
      id,
      {
        id,
        kind: connector.kind,
        label: connector.label,
        execution: connector.execution,
        helperAgents: connector.helperAgents ?? [],
        modes: connector.modes,
        privacyModel: connector.privacyModel,
        fields: connector.fields
      }
    ])
);

export function getConnector(connectorId) {
  const normalized = String(connectorId || '').trim();
  if (normalized === 'food-demo-v1' || normalized === 'job-application-demo-v1') {
    return CONNECTOR_REGISTRY['browser-worker-demo-v1'] ?? null;
  }
  if (normalized === 'travel-demo-v1') return null;
  return CONNECTOR_REGISTRY[normalized] ?? null;
}

export function executeConnectorAction(actionRun, options = {}) {
  const connector = getConnector(actionRun?.connector);
  if (!connector) {
    throw new Error(`unknown_connector:${actionRun?.connector ?? 'none'}`);
  }
  return connector.execute(actionRun, options);
}

export function getConnectorHandoffData(pathname, searchParams) {
  if (pathname === '/connectors/food/checkout') {
    return CONNECTOR_REGISTRY['browser-worker-demo-v1'].handoffData(searchParams);
  }
  if (pathname === '/connectors/browser/worker') {
    return CONNECTOR_REGISTRY['browser-worker-demo-v1'].handoffData(searchParams);
  }
  if (pathname === '/connectors/travel/checkout') {
    return null;
  }
  if (pathname === '/connectors/jobs/apply') {
    return CONNECTOR_REGISTRY['browser-worker-demo-v1'].handoffData(searchParams);
  }
  return null;
}
