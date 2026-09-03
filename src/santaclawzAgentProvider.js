import {
  getSantaClawzPreflightSnapshot,
  listSantaClawzPreflightSnapshots,
  upsertSantaClawzPreflightSnapshot
} from './store.js';

const DEFAULT_SANTACLAWZ_API_BASE = 'https://api.santaclawz.ai';
const DEFAULT_SANTACLAWZ_SITE_BASE = 'https://santaclawz.ai';
const SANTACLAWZ_UTILITY_AGENT_IDENTIFIERS = [
  'agent_job_pack',
  'hosted_agent_job_pack'
];

const RETIRED_SANTACLAWZ_AGENT_PREFIXES = [
  'pitch-deck-review-agent'
];

const MAGIC_CITY_LANE_DEFINITIONS = [
  {
    capability: 'browser-worker-agent',
    kind: 'browser',
    keywords: ['browser', 'internet', 'website', 'site', 'url', 'checkout', 'cart', 'form', 'purchase', 'buy', 'order', 'shopping', 'booking', 'automation', 'amazon', 'walmart', 'target', 'restaurant', 'takeout', 'delivery', 'reservation', 'dining', 'job', 'jobs', 'resume', 'ats', 'application', 'apply', 'greenhouse', 'lever', 'ashby', 'workable', 'indeed', 'linkedin', 'career', 'cover letter']
  },
  {
    capability: 'travel-agent',
    kind: 'travel',
    keywords: ['travel', 'trip', 'flight', 'hotel', 'itinerary', 'booking', 'vacation', 'road trip', 'guidebook', 'concierge']
  },
  {
    capability: 'developer-tools-agent',
    kind: 'developer',
    keywords: ['github', 'repo', 'developer', 'code', 'pull request', 'pr', 'openclaw', 'mcp', 'tools', 'devops', 'dev ops', 'ci/cd', 'cicd', 'smart contract', 'smartcontract', 'solidity', 'infrastructure', 'deploy']
  }
];

function envBoolean(name, defaultValue = false) {
  const value = process.env[name];
  if (value == null || value === '') return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function envNumber(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : defaultValue;
}

function cleanBaseUrl(value, fallback) {
  const raw = String(value || fallback || '').trim();
  return raw.replace(/\/+$/, '');
}

function sourceConfig() {
  return {
    // SantaClawz is an optional marketplace integration. Keep it opt-in so a
    // missing production variable cannot silently re-enable remote discovery.
    enabled: envBoolean('SANTACLAWZ_AGENT_SOURCE_ENABLED', false),
    apiBase: cleanBaseUrl(
      process.env.SANTACLAWZ_API_BASE
        || process.env.CLAWZ_API_BASE
        || process.env.PUBLIC_SANTACLAWZ_API_BASE,
      DEFAULT_SANTACLAWZ_API_BASE
    ),
    siteBase: cleanBaseUrl(
      process.env.SANTACLAWZ_SITE_BASE
        || process.env.PUBLIC_SANTACLAWZ_SITE_BASE,
      DEFAULT_SANTACLAWZ_SITE_BASE
    ),
    timeoutMs: Math.max(250, Math.min(envNumber('SANTACLAWZ_AGENT_FETCH_TIMEOUT_MS', 8000), 10000)),
    refreshMs: Math.max(5000, Math.min(envNumber('SANTACLAWZ_AGENT_REFRESH_MS', 60000), 10 * 60 * 1000)),
    preflightSnapshotMs: Math.max(60 * 60 * 1000, Math.min(envNumber('SANTACLAWZ_PREFLIGHT_SNAPSHOT_MS', 24 * 60 * 60 * 1000), 7 * 24 * 60 * 60 * 1000)),
    cacheLimit: Math.max(20, Math.min(envNumber('SANTACLAWZ_AGENT_CACHE_LIMIT', 200), 500))
  };
}

const directoryCache = {
  configKey: '',
  agents: [],
  updatedAt: 0,
  source: null,
  refreshPromise: null,
  refresher: null,
  preflightRefresher: null,
  preflightRefreshPromise: null,
  lastPreflightRefreshAt: 0
};

function configKey(config) {
  return [
    config.enabled ? '1' : '0',
    config.apiBase,
    config.siteBase,
    config.cacheLimit
  ].join('|');
}

function cacheSource(config, extra = {}) {
  const ageMs = directoryCache.updatedAt ? Date.now() - directoryCache.updatedAt : null;
  return getSantaClawzSourceStatus({
    cache: {
      ready: directoryCache.updatedAt > 0,
      hit: directoryCache.updatedAt > 0,
      updatedAt: directoryCache.updatedAt ? new Date(directoryCache.updatedAt).toISOString() : null,
      ageMs,
      refreshMs: config.refreshMs,
      refreshing: Boolean(directoryCache.refreshPromise)
    },
    ...extra
  });
}

function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry) => {
      if (typeof entry === 'string') return [entry];
      if (!entry || typeof entry !== 'object') return [];
      return [
        entry.mode,
        entry.tag,
        entry.label,
        entry.name,
        entry.id,
        entry.description,
        entry.scanPolicy,
        entry.lifecycleVisibility,
        entry.platformContentVisibility
      ];
    })
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function tagStrings(value) {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.values(value).flatMap((entry) => Array.isArray(entry) ? entry : [entry])
      : [];
  return entries
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!entry || typeof entry !== 'object') return '';
      return [
        entry.tag,
        entry.label,
        entry.name,
        entry.description
      ].filter(Boolean).join(' ');
    })
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function modeStrings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!entry || typeof entry !== 'object') return '';
      return entry.mode || entry.id || entry.name || entry.label || '';
    })
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);
}

function utilityComparable(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function isRetiredSantaClawzAgent(agent = {}) {
  const rawId = String(agent?.agentId || agent?.sessionId || agent?.slug || agent?.handle || '').trim().toLowerCase();
  const id = rawId.replace(/^santaclawz:/, '');
  const label = String(agent?.agentName || agent?.representedPrincipal || '').trim().toLowerCase();
  return RETIRED_SANTACLAWZ_AGENT_PREFIXES.some((prefix) => id === prefix || id.startsWith(`${prefix}--`))
    || /^(?:pitch deck review)(?: agent)?$/.test(label);
}

function isKnownSantaClawzUtilityIdentifier(value = '') {
  const comparable = utilityComparable(value);
  if (!comparable) return false;
  return SANTACLAWZ_UTILITY_AGENT_IDENTIFIERS.some((identifier) => (
    comparable === identifier ||
    comparable.startsWith(`${identifier}_`) ||
    comparable.endsWith(`_${identifier}`) ||
    comparable.includes(`_${identifier}_`)
  ));
}

function isSantaClawzUtilityAgent(agent = {}) {
  return [
    agent?.agentId,
    agent?.sessionId,
    agent?.agentName,
    agent?.representedPrincipal,
    agent?.publicAgentUrl,
    agent?.publicHireUrl,
    agent?.urlReservationSalt,
    agent?.slug,
    agent?.handle
  ].some(isKnownSantaClawzUtilityIdentifier);
}

function isLocalDevelopmentUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local');
  } catch {
    return /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i.test(raw);
  }
}

function isSantaClawzLocalDevelopmentAgent(agent = {}) {
  const urlCandidates = [
    agent?.publicAgentUrl,
    agent?.publicHireUrl,
    agent?.openClawUrl,
    agent?.runtimeIngressUrl,
    agent?.runtimeDelivery?.runtimeIngressUrl,
    agent?.runtimeDelivery?.openClawUrl,
    agent?.runtimeDelivery?.endpoint
  ];
  if (urlCandidates.some(isLocalDevelopmentUrl)) return true;
  const labelText = [
    agent?.agentName,
    agent?.representedPrincipal,
    agent?.headline,
    agent?.slug,
    agent?.handle
  ].filter(Boolean).join(' ');
  return /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i.test(labelText);
}

function normalizedListingText(agent = {}) {
  return [
    agent?.agentName,
    agent?.representedPrincipal,
    agent?.headline,
    agent?.description,
    agent?.slug,
    agent?.handle
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isSantaClawzPlaceholderListing(agent = {}) {
  const name = String(agent?.agentName || agent?.representedPrincipal || agent?.slug || agent?.handle || '').trim().toLowerCase();
  const text = normalizedListingText(agent);
  if (!text) return false;
  if (/\bis onboarding on santaclawz\b/.test(text)) return true;
  if (/\bother agents can ping it for current scope, pricing, and availability updates\b/.test(text)) return true;
  if (/\b1\.\s*perceive\s*\/\s*take input\b/.test(text) && /\bthe agent gathers info from its environment\b/.test(text)) return true;
  if (/^activate(?:\s*activate)+$/.test(text)) return true;
  if (['agent', 'agenc', 'activate'].includes(name) && text.length <= Math.max(name.length + 24, 36)) return true;
  return false;
}

function hasSantaClawzPaymentReadiness(agent = {}) {
  const pricing = agent?.pricing && typeof agent.pricing === 'object' ? agent.pricing : {};
  return Boolean(
    agent?.paymentsReady ||
    agent?.paymentProfileReady ||
    agent?.payoutAddressConfigured ||
    pricing.paymentsEnabled ||
    pricing.paidJobsEnabled ||
    pricing.paymentProfileReady ||
    pricing.payoutAddressConfigured
  );
}

function hasLocalhostMarker(agent = {}) {
  const readiness = agent?.readiness && typeof agent.readiness === 'object' ? agent.readiness : {};
  const haystack = [
    agent?.agentId,
    agent?.sessionId,
    agent?.agentName,
    agent?.representedPrincipal,
    agent?.headline,
    agent?.publicAgentUrl,
    agent?.publicHireUrl,
    agent?.runtimeDeliveryMode,
    agent?.availability,
    ...(Array.isArray(readiness.knownBlockers) ? readiness.knownBlockers : [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return /\b(localhost|127\.0\.0\.1|0\.0\.0\.0)\b/.test(haystack)
    || /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/.test(haystack);
}

export function isSantaClawzAvailableForMagicCity(agent = {}) {
  if (hasLocalhostMarker(agent)) return false;
  const readiness = agent?.readiness && typeof agent.readiness === 'object' ? agent.readiness : {};
  const availability = String(agent?.availability || readiness.availability || '').trim().toLowerCase();
  const relayReachable = Boolean(
    readiness.relayConnected &&
    readiness.heartbeatLive &&
    (readiness.runtimeReachable || readiness.workerReachable)
  );
  return Boolean(
    agent?.online ||
    readiness.online ||
    relayReachable ||
    (agent?.hireable && ['active', 'available', 'ready'].includes(availability))
  );
}

export function isSantaClawzProtocolHireReadyForMagicCity(agent = {}) {
  if (hasLocalhostMarker(agent)) return false;
  if (isSantaClawzUtilityAgent(agent)) return false;
  if (isSantaClawzLocalDevelopmentAgent(agent)) return false;
  if (isSantaClawzPlaceholderListing(agent)) return false;
  const readiness = agent?.readiness && typeof agent.readiness === 'object' ? agent.readiness : {};
  const online = isSantaClawzAvailableForMagicCity(agent);
  const fixedPaidReady = Boolean(
    agent?.paidExecutionReady ||
    readiness.paidExecutionReady ||
    agent?.paidExecutionProven ||
    readiness.paidExecutionProven ||
    agent?.pricing?.paidJobsEnabled
  );
  const quoteReady = Boolean(agent?.quoteReady || readiness.quoteReady);
  return Boolean(
    online &&
    agent?.hireable &&
    (fixedPaidReady || quoteReady || hasSantaClawzPaymentReadiness(agent))
  );
}

export function isSantaClawzHireReadyForMagicCity(agent = {}) {
  // SantaClawz is authoritative for marketplace/runtime readiness. A failed
  // buyer job is scoped to that execution and must not become a second,
  // Magic City-owned marketplace quarantine.
  return isSantaClawzProtocolHireReadyForMagicCity(agent);
}

function latestIsoTimestamp(values = []) {
  let latestMs = NaN;
  let latestIso = null;
  for (const value of values) {
    const parsed = Date.parse(String(value || ''));
    if (!Number.isFinite(parsed) || (Number.isFinite(latestMs) && parsed <= latestMs)) continue;
    latestMs = parsed;
    latestIso = new Date(parsed).toISOString();
  }
  return { ms: latestMs, iso: latestIso };
}

export function evaluateSantaClawzRuntimeRevalidation(agent = {}, runtimeHealth = {}, {
  now = Date.now(),
  heartbeatMaxAgeMs = 5 * 60 * 1000
} = {}) {
  const readiness = agent?.readiness && typeof agent.readiness === 'object' ? agent.readiness : {};
  const blockers = arrayOfStrings(readiness.knownBlockers || readiness.blockers);
  const heartbeat = latestIsoTimestamp([
    readiness.lastHeartbeatAtIso,
    readiness.runtimeStatusUpdatedAtIso,
    agent?.lastHeartbeatAtIso,
    agent?.runtimeStatusUpdatedAtIso
  ]);
  const rejection = latestIsoTimestamp(runtimeHealth?.incidentObservedAt
    ? [runtimeHealth.incidentObservedAt]
    : [runtimeHealth?.lastRejectedAt, runtimeHealth?.updatedAt]);
  const heartbeatFresh = Number.isFinite(heartbeat.ms)
    && heartbeat.ms <= now + 30 * 1000
    && now - heartbeat.ms <= heartbeatMaxAgeMs;
  const evidenceIsNewer = Number.isFinite(heartbeat.ms)
    && Number.isFinite(rejection.ms)
    && heartbeat.ms > rejection.ms;
  const relayReady = Boolean(
    readiness.relayConnected
    && readiness.heartbeatLive
    && (readiness.runtimeReachable || readiness.workerReachable)
  );
  const paidExecutionReady = Boolean(
    agent?.paidExecutionReady
    || readiness.paidExecutionReady
    || agent?.paidExecutionProven
    || readiness.paidExecutionProven
  );
  const protocolReady = Boolean(
    agent?.online
    && agent?.hireable
    && relayReady
    && paidExecutionReady
    && !agent?.needsUpgrade
    && !readiness.needsUpgrade
    && blockers.length === 0
  );
  return {
    revalidated: Boolean(protocolReady && heartbeatFresh && evidenceIsNewer),
    protocolReady,
    heartbeatFresh,
    evidenceIsNewer,
    heartbeatAt: heartbeat.iso,
    rejectionAt: rejection.iso,
    blockers
  };
}

export function isSantaClawzVisibleForMagicCityMarketplace(agent = {}) {
  return isSantaClawzHireReadyForMagicCity(agent);
}

function searchableAgentText(agent) {
  return [
    agent?.agentId,
    agent?.sessionId,
    agent?.agentName,
    agent?.representedPrincipal,
    agent?.headline,
    agent?.publicAgentUrl,
    agent?.publicHireUrl,
    ...arrayOfStrings(agent?.capabilityTags),
    ...tagStrings(agent?.marketplaceTags),
    ...arrayOfStrings(agent?.deliveryLanes),
    ...arrayOfStrings(agent?.privacyModes)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function inferSupportedLanes(agent) {
  const haystack = searchableAgentText(agent);
  return MAGIC_CITY_LANE_DEFINITIONS
    .filter((definition) => definition.keywords.some((keyword) => haystack.includes(keyword)))
    .map((definition) => definition.capability);
}

function kindForCapability(capability) {
  return MAGIC_CITY_LANE_DEFINITIONS.find((definition) => definition.capability === capability)?.kind || null;
}

function capabilityForKind(kind) {
  return MAGIC_CITY_LANE_DEFINITIONS.find((definition) => definition.kind === kind)?.capability || null;
}

function normalizePriceNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildPricingModel(agent) {
  const pricing = agent?.pricing && typeof agent.pricing === 'object' ? agent.pricing : {};
  const fixedAmountUsd = normalizePriceNumber(pricing.fixedAmountUsd);
  const referencePriceUsd = normalizePriceNumber(pricing.referencePriceUsd);
  if (fixedAmountUsd != null) {
    return {
      basePrice: fixedAmountUsd,
      unit: 'USD',
      mode: pricing.pricingMode || 'fixed'
    };
  }
  if (referencePriceUsd != null) {
    return {
      basePrice: referencePriceUsd,
      unit: 'USD estimate',
      mode: pricing.pricingMode || 'quote'
    };
  }
  return {
    basePrice: 1,
    unit: 'credit',
    mode: pricing.pricingMode || 'quote'
  };
}

export function getSantaClawzApiKey() {
  return String(
    process.env.SANTACLAWZ_API_KEY ||
    process.env.CLAWZ_API_KEY ||
    process.env.SANTACLAWZ_CONCIERGE_API_KEY ||
    process.env.CLAWZ_CONCIERGE_API_KEY ||
    ''
  ).trim();
}

function compactLabel(value = '') {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function normalizeRequirementMaxLength(source = {}, { id = '', type = '', label = '' } = {}) {
  const rawLimit = Number(source.maxLength ?? source.maxChars);
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) return null;
  const rounded = Math.round(rawLimit);
  const haystack = `${id} ${type} ${label} ${source.placeholder || ''}`.toLowerCase();
  const isUrlLike = type === 'url' || /\b(url|uri|link|repo|repository|github|website)\b/.test(haystack);
  const isLongText = type === 'textarea' || /\b(focus|brief|prompt|description|notes?|code|text|content|source|instructions?|concerns?)\b/.test(haystack);
  if (isUrlLike) return Math.max(rounded, 2048);
  if (isLongText) return Math.max(rounded, 4000);
  return rounded < 8 ? null : Math.max(rounded, 64);
}

function normalizeInputRequirementEntry(entry, index = 0) {
  if (!entry) return null;
  const source = typeof entry === 'string' ? { label: entry } : entry;
  if (!source || typeof source !== 'object') return null;
  const rawId = String(source.id || source.key || source.name || source.field || source.label || `field_${index + 1}`).trim();
  const id = rawId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || `field_${index + 1}`;
  const type = String(source.type || source.inputType || source.kind || '').toLowerCase();
  const normalizedType = ['url', 'select', 'number', 'email', 'file'].includes(type)
    ? type
    : /note|brief|prompt|description|code|text|content|source/.test(`${id} ${type}`)
      ? 'textarea'
      : 'text';
  const label = String(source.label || source.title || compactLabel(id)).trim();
  return {
    id,
    label,
    type: normalizedType,
    required: source.required !== false,
    placeholder: String(source.placeholder || source.description || '').trim(),
    maxLength: normalizeRequirementMaxLength(source, { id, type: normalizedType, label }),
    options: Array.isArray(source.options) ? source.options.map((option) => String(option || '').trim()).filter(Boolean).slice(0, 20) : [],
    privacy: String(source.privacy || source.visibility || '').toLowerCase() === 'private' ? 'private' : 'task'
  };
}

function uniqueRequirements(requirements = []) {
  const seen = new Set();
  return requirements
    .map(normalizeInputRequirementEntry)
    .filter(Boolean)
    .filter((field) => {
      if (seen.has(field.id)) return false;
      seen.add(field.id);
      return true;
    })
    .slice(0, 8);
}

function firstArrayProperty(source = {}, names = []) {
  for (const name of names) {
    const value = source?.[name];
    if (Array.isArray(value) && value.length) return value;
    if (value && typeof value === 'object') {
      const nested = firstArrayProperty(value, ['fields', 'inputs', 'parameters', 'requiredInputs']);
      if (nested.length) return nested;
    }
  }
  return [];
}

function extractInputRequirementsFromPayload(payload = {}) {
  const candidates = [
    ...firstArrayProperty(payload, ['inputRequirements', 'requiredInputs', 'fields', 'parameters']),
    ...firstArrayProperty(payload?.agent, ['inputRequirements', 'requiredInputs', 'fields', 'parameters']),
    ...firstArrayProperty(payload?.preflight, ['inputRequirements', 'requiredInputs', 'fields', 'parameters']),
    ...firstArrayProperty(payload?.requirements, ['inputs', 'fields', 'parameters'])
  ];
  return uniqueRequirements(candidates);
}

function extractExplicitInputRequirementsFromAgent(agent = {}) {
  const candidates = [
    ...firstArrayProperty(agent, ['inputRequirements', 'requiredInputs', 'fields', 'parameters']),
    ...firstArrayProperty(agent?.requirements, ['inputs', 'fields', 'parameters']),
    ...firstArrayProperty(agent?.metadata, ['inputRequirements', 'requiredInputs', 'fields', 'parameters'])
  ];
  return uniqueRequirements(candidates);
}

function inferInputRequirementsFromMetadata(agent = {}) {
  const limits = agent?.limits && typeof agent.limits === 'object' ? agent.limits : {};
  const marketplaceTags = agent?.marketplaceTags && typeof agent.marketplaceTags === 'object' ? agent.marketplaceTags : {};
  const inputTypes = arrayOfStrings(marketplaceTags.inputTypes).map((entry) => entry.toLowerCase());
  const outputTypes = arrayOfStrings(marketplaceTags.outputTypes).map((entry) => entry.toLowerCase());
  const haystack = searchableAgentText(agent);
  const taskPromptMaxChars = Number(limits.taskPromptMaxChars);
  const requirements = [];

  const wantsUrl = inputTypes.includes('url') || /\b(url|website|web research|docsend|repo|repository|github|link)\b/.test(haystack);
  const wantsCode = /\b(code audit|audit agent|security audit|submitted code|code review|github|repo|repository|smart contract audit)\b/.test(haystack);
  const wantsFile = inputTypes.includes('file') || /\b(file|pdf|docx|document|zip|ocr|conversion)\b/.test(haystack);
  if (wantsCode) {
    requirements.push({
      id: 'githubUrl',
      label: 'GitHub repository or code link',
      type: 'url',
      required: true,
      placeholder: 'https://github.com/org/repo or a PR/file URL'
    });
    requirements.push({
      id: 'auditFocus',
      label: 'Audit focus',
      type: 'textarea',
      required: false,
      placeholder: 'Security, bugs, architecture, implementation review, specific files, or concerns.'
    });
  } else if (wantsUrl) {
    requirements.push({
      id: 'sourceUrl',
      label: 'Source URL',
      type: 'url',
      required: false,
      placeholder: 'https://...'
    });
  } else if (wantsFile) {
    requirements.push({
      id: 'sourceFileNote',
      label: 'File note',
      type: 'textarea',
      required: false,
      placeholder: 'Name the file or describe what you will attach.'
    });
  }

  if (outputTypes.length > 1) {
    requirements.push({
      id: 'outputPreference',
      label: 'Output preference',
      type: 'select',
      required: false,
      options: outputTypes.slice(0, 12),
      placeholder: 'Choose an output format if it matters.'
    });
  }

  return uniqueRequirements(requirements);
}

function isCodeAuditSantaClawzAgent(agent = {}) {
  return /\b(code audit|audit agent|security audit|submitted code|code review|github|repo|repository|smart contract audit)\b/.test(searchableAgentText(agent));
}

function codeAuditInputRequirements() {
  return uniqueRequirements([
    {
      id: 'githubUrl',
      label: 'GitHub repository or code link',
      type: 'url',
      required: true,
      placeholder: 'https://github.com/org/repo or a PR/file URL',
      maxLength: 2048
    },
    {
      id: 'auditFocus',
      label: 'Audit focus',
      type: 'textarea',
      required: false,
      placeholder: 'Security, bugs, architecture, implementation review, specific files, or concerns.',
      maxLength: 4000
    }
  ]);
}

function refineInputRequirementsForKnownAgent(agent = {}, inputRequirements = {}) {
  if (!isCodeAuditSantaClawzAgent(agent)) return inputRequirements;
  const fields = Array.isArray(inputRequirements.fields) ? inputRequirements.fields : [];
  const preserved = fields.filter((field) => {
    const id = String(field?.id || '').toLowerCase();
    const label = String(field?.label || '').toLowerCase();
    return ![
      'taskprompt',
      'task_prompt',
      'codeorrepo',
      'code_or_repo',
      'sourceurl',
      'source_url',
      'repositoryurl',
      'repository_url'
    ].includes(id) && !/\b(task prompt|code or repo|source url|repository url)\b/.test(label);
  });
  const refined = uniqueRequirements([...codeAuditInputRequirements(), ...preserved]);
  return {
    ...inputRequirements,
    source: inputRequirements.source === 'santaclawz_no_published_requirements'
      ? 'magic_city_agent_description_inference'
      : inputRequirements.source,
    fields: refined
  };
}

export function buildSantaClawzAgentInputRequirements(agent = {}, preflightPayload = null) {
  const preflightRequirements = extractInputRequirementsFromPayload(preflightPayload || {});
  if (preflightRequirements.length) {
    return refineInputRequirementsForKnownAgent(agent, {
      schemaVersion: 'magic-city-santaclawz-input-requirements-v1',
      source: 'santaclawz_preflight',
      fields: preflightRequirements
    });
  }
  const explicitAgentRequirements = extractExplicitInputRequirementsFromAgent(agent);
  if (explicitAgentRequirements.length) {
    return refineInputRequirementsForKnownAgent(agent, {
      schemaVersion: 'magic-city-santaclawz-input-requirements-v1',
      source: 'santaclawz_directory_contract',
      fields: explicitAgentRequirements
    });
  }
  const inferredRequirements = inferInputRequirementsFromMetadata(agent);
  if (inferredRequirements.length) {
    return refineInputRequirementsForKnownAgent(agent, {
      schemaVersion: 'magic-city-santaclawz-input-requirements-v1',
      source: 'magic_city_agent_description_inference',
      fields: inferredRequirements
    });
  }
  return refineInputRequirementsForKnownAgent(agent, {
    schemaVersion: 'magic-city-santaclawz-input-requirements-v1',
    source: preflightPayload?.error ? 'santaclawz_preflight_unavailable' : 'santaclawz_no_published_requirements',
    fields: []
  });
}

async function fetchSantaClawzAgentPreflight(agentId, { timeoutMs = 2500 } = {}) {
  const apiKey = getSantaClawzApiKey();
  if (!apiKey || !agentId) return null;
  const config = sourceConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.apiBase}/api/agents/${encodeURIComponent(agentId)}/preflight`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'user-agent': 'magic-city-santaclawz-preflight/1.0'
      },
      body: JSON.stringify({
        agentId,
        dryRun: true,
        preflight: true,
        taskPrompt: 'Preflight only: return required input fields. Do not create a paid job.'
      })
    });
    if (!response.ok) return { error: `http_${response.status}` };
    return await response.json();
  } catch (error) {
    return { error: error?.name === 'AbortError' ? 'timeout' : (error?.message || 'preflight_failed') };
  } finally {
    clearTimeout(timer);
  }
}

function isFreshSantaClawzPreflightSnapshot(snapshot, now = Date.now()) {
  if (!snapshot?.inputRequirements) return false;
  const fields = Array.isArray(snapshot.inputRequirements.fields) ? snapshot.inputRequirements.fields : [];
  if (!fields.length && !snapshot.ok) return false;
  const expiresAt = new Date(snapshot.expiresAt || 0).getTime();
  if (Number.isFinite(expiresAt) && expiresAt > now) return true;
  const checkedAt = new Date(snapshot.lastCheckedAt || snapshot.updatedAt || 0).getTime();
  const ttlMs = sourceConfig().preflightSnapshotMs;
  return Number.isFinite(checkedAt) && checkedAt > 0 && now - checkedAt < ttlMs;
}

function buildSnapshotFromAgentPreflight(rawAgent, preflightPayload, { checkedAt = new Date(), source = '' } = {}) {
  const checkedAtDate = checkedAt instanceof Date ? checkedAt : new Date(checkedAt);
  const checkedAtIso = checkedAtDate.toISOString();
  const expiresAtIso = new Date(checkedAtDate.getTime() + sourceConfig().preflightSnapshotMs).toISOString();
  const inputRequirements = buildSantaClawzAgentInputRequirements(rawAgent, preflightPayload);
  const ok = Boolean(preflightPayload && !preflightPayload.error);
  return {
    agentId: rawAgent?.agentId,
    ok,
    source: source || inputRequirements.source,
    error: preflightPayload?.error || null,
    inputRequirements,
    lastCheckedAt: checkedAtIso,
    expiresAt: expiresAtIso,
    metadata: {
      label: rawAgent?.agentName || rawAgent?.representedPrincipal || rawAgent?.agentId || '',
      publicAgentUrl: rawAgent?.publicAgentUrl || null,
      publicHireUrl: rawAgent?.publicHireUrl || null,
      online: isSantaClawzAvailableForMagicCity(rawAgent),
      hireable: isSantaClawzHireReadyForMagicCity(rawAgent),
      paidExecutionReady: Boolean(rawAgent?.paidExecutionReady || rawAgent?.readiness?.paidExecutionReady || rawAgent?.pricing?.paidJobsEnabled),
      quoteReady: Boolean(rawAgent?.quoteReady),
      preflightAttempted: Boolean(preflightPayload),
      requirementFieldCount: inputRequirements.fields?.length || 0
    }
  };
}

function getFreshSantaClawzPreflightSnapshot(agentId) {
  const snapshot = getSantaClawzPreflightSnapshot(agentId);
  return isFreshSantaClawzPreflightSnapshot(snapshot) ? snapshot : null;
}

async function resolveSantaClawzInputRequirements(rawAgent, { allowLivePreflight = true } = {}) {
  const freshSnapshot = getFreshSantaClawzPreflightSnapshot(rawAgent?.agentId);
  if (freshSnapshot) {
    const snapshotRequirementSource = freshSnapshot.ok
      ? 'santaclawz_preflight_snapshot'
      : 'santaclawz_directory_snapshot';
    return {
      inputRequirements: refineInputRequirementsForKnownAgent(rawAgent, {
        ...(freshSnapshot.inputRequirements || {}),
        source: snapshotRequirementSource
      }),
      preflight: {
        attempted: Boolean(freshSnapshot.metadata?.preflightAttempted),
        ok: Boolean(freshSnapshot.ok),
        error: freshSnapshot.error || null,
        source: 'daily_snapshot',
        lastCheckedAt: freshSnapshot.lastCheckedAt,
        expiresAt: freshSnapshot.expiresAt
      }
    };
  }

  if (allowLivePreflight) {
    const livePayload = await fetchSantaClawzAgentPreflight(rawAgent.agentId, {
      timeoutMs: Math.min(sourceConfig().timeoutMs, 2500)
    });
    const snapshot = upsertSantaClawzPreflightSnapshot(buildSnapshotFromAgentPreflight(rawAgent, livePayload, {
      source: livePayload ? 'live_preflight_fallback' : 'directory_metadata_fallback'
    }));
    return {
      inputRequirements: snapshot?.inputRequirements || buildSantaClawzAgentInputRequirements(rawAgent, livePayload),
      preflight: {
        attempted: Boolean(livePayload),
        ok: Boolean(livePayload && !livePayload.error),
        error: livePayload?.error || (livePayload ? null : 'api_key_not_configured'),
        source: snapshot?.source || 'live_preflight_fallback',
        lastCheckedAt: snapshot?.lastCheckedAt || null,
        expiresAt: snapshot?.expiresAt || null
      }
    };
  }

  return {
    inputRequirements: buildSantaClawzAgentInputRequirements(rawAgent),
    preflight: {
      attempted: false,
      ok: false,
      error: 'snapshot_missing',
      source: 'directory_metadata_fallback'
    }
  };
}

function getCompletionScore(agent) {
  const completionScore = agent?.reputation?.completionScore && typeof agent.reputation.completionScore === 'object'
    ? agent.reputation.completionScore
    : {};
  const pct = Number(completionScore.successRatePct);
  if (Number.isFinite(pct) && pct >= 0) return Math.min(pct / 100, 1);
  const legacy = Number(agent?.reputation?.successRate);
  if (Number.isFinite(legacy) && legacy >= 0) return legacy > 1 ? Math.min(legacy / 100, 1) : legacy;
  const completed = Number(completionScore.completedJobCount);
  const evaluated = Number(completionScore.evaluatedJobCount);
  if (Number.isFinite(completed) && Number.isFinite(evaluated) && evaluated > 0) {
    return Math.max(0, Math.min(completed / evaluated, 1));
  }
  return 0;
}

function getSantaClawzReputationStats(agent) {
  const reputation = agent?.reputation && typeof agent.reputation === 'object' ? agent.reputation : {};
  const completionScore = reputation.completionScore && typeof reputation.completionScore === 'object'
    ? reputation.completionScore
    : {};
  const activity = reputation.jobActivityStats && typeof reputation.jobActivityStats === 'object'
    ? reputation.jobActivityStats
    : {};
  const successRate = getCompletionScore(agent);
  const completed = Number(completionScore.completedJobCount ?? activity.completedJobCount ?? reputation.fulfilledCount ?? 0) || 0;
  const evaluated = Number(completionScore.evaluatedJobCount ?? activity.totalJobCount ?? reputation.claimedCount ?? 0) || 0;
  const failed = Number(completionScore.failedJobCount ?? activity.failedJobCount ?? 0) || 0;
  return {
    completed,
    evaluated,
    failed,
    successRate,
    proofRate: Number.isFinite(Number(reputation.proofScorePct)) ? Math.max(0, Math.min(Number(reputation.proofScorePct) / 100, 1)) : (agent?.paidExecutionProven ? 1 : 0),
    anchoredSocialFactCount: Number(reputation.anchoredSocialFactCount || 0),
    pendingSocialAnchorCount: Number(reputation.pendingSocialAnchorCount || 0),
    label: completionScore.label || activity.label || null
  };
}

function scoreSantaClawzAgent(agent, supportedLanes, wantedKind = '') {
  const readiness = agent?.readiness && typeof agent.readiness === 'object' ? agent.readiness : {};
  let score = 53;
  if (isSantaClawzAvailableForMagicCity(agent)) score += 10;
  if (isSantaClawzHireReadyForMagicCity(agent)) score += 10;
  if (agent?.paidExecutionReady || readiness.paidExecutionReady || agent?.pricing?.paidJobsEnabled) score += 8;
  if (agent?.paymentsReady || agent?.quoteReady) score += 4;
  if (agent?.paidExecutionProven) score += 4;
  if (readiness.runtimeReachable || readiness.workerReachable) score += 3;
  if (wantedKind && supportedLanes.some((lane) => kindForCapability(lane) === wantedKind)) score += 10;
  score += Math.round(getCompletionScore(agent) * 8);
  const blockers = Array.isArray(readiness.knownBlockers)
    ? readiness.knownBlockers
    : Array.isArray(readiness.blockers)
      ? readiness.blockers
      : [];
  const blockerCount = blockers.length;
  score -= Math.min(blockerCount * 4, 16);
  return Math.max(0, Math.min(Math.round(score), 100));
}

function normalizeSantaClawzAgent(agent) {
  if (isRetiredSantaClawzAgent(agent)) return null;
  if (isSantaClawzUtilityAgent(agent)) return null;
  if (isSantaClawzLocalDevelopmentAgent(agent)) return null;
  if (isSantaClawzPlaceholderListing(agent)) return null;
  const externalAgentId = String(agent?.agentId || agent?.sessionId || '').trim();
  if (!externalAgentId) return null;
  const supportedLanes = inferSupportedLanes(agent);
  const capabilities = supportedLanes.length
    ? supportedLanes
    : arrayOfStrings(agent?.capabilityTags).slice(0, 6);
  const pricingModel = buildPricingModel(agent);
  const publicAgentUrl = String(agent?.publicAgentUrl || '').trim() || null;
  const publicHireUrl = String(agent?.publicHireUrl || '').trim() || publicAgentUrl;
  const label = String(agent?.agentName || agent?.representedPrincipal || externalAgentId).trim();
  const description = String(agent?.headline || 'SantaClawz execution agent').trim();
  const readiness = agent?.readiness && typeof agent.readiness === 'object' ? agent.readiness : {};
  const paymentsReady = hasSantaClawzPaymentReadiness(agent);
  const proofCapable = Boolean(agent?.paidExecutionProven || agent?.pricing?.paidJobsEnabled || readiness.paidExecutionReady);
  const online = isSantaClawzAvailableForMagicCity(agent);
  const hireable = isSantaClawzHireReadyForMagicCity(agent);
  const demoOnline = online && !hireable;
  const privacyModes = modeStrings(agent?.privacyModes);
  const deliveryLanes = arrayOfStrings(agent?.deliveryLanes);
  const marketplaceTags = tagStrings(agent?.marketplaceTags);

  return {
    agentId: `santaclawz:${externalAgentId}`,
    owner: String(agent?.representedPrincipal || 'SantaClawz').trim(),
    publicKey: `santaclawz:${agent?.sessionId || externalAgentId}`,
    endpoint: publicHireUrl,
    capabilities,
    supportedLanes,
    privacyModes: privacyModes.length ? privacyModes : ['private'],
    provenanceModes: proofCapable ? ['signed_receipt', 'zk_receipt'] : ['signed_receipt'],
    retentionPolicy: 'external_santaclawz',
    executionEnvironment: 'marketplace_remote',
    routingVisibility: 'metadata_only',
    pricingModel,
    metadata: {
      label,
      description,
      source: 'santaclawz',
      providerId: 'santaclawz',
      runtime: agent?.runtimeDeliveryMode || 'santaclawz_agent',
      externalAgentId,
      santaclawzAgentId: externalAgentId,
      santaclawzSessionId: agent?.sessionId || null,
      publicAgentUrl,
      publicHireUrl,
      marketplaceReady: Boolean(agent?.hireable || agent?.published),
      walletEnabled: paymentsReady,
      allowWallet: paymentsReady,
      proofCapable,
      online,
      hireable,
      demoOnline,
      demoAgent: demoOnline,
      agentType: demoOnline ? 'demo_santaclawz' : 'paid_santaclawz',
      paidExecutionReady: Boolean(agent?.paidExecutionReady || readiness.paidExecutionReady || agent?.pricing?.paidJobsEnabled),
      quoteReady: Boolean(agent?.quoteReady),
      paymentsReady,
      capabilityTags: arrayOfStrings(agent?.capabilityTags),
      marketplaceTags,
      deliveryLanes,
      limits: agent?.limits || null,
      agentInputRequirements: buildSantaClawzAgentInputRequirements(agent),
      readiness,
      santaclawzPricing: agent?.pricing || null,
      santaclawzReputation: agent?.reputation || null
    }
  };
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'magic-city-santaclawz-provider/1.0'
      }
    });
    if (!response.ok) {
      throw new Error(`SantaClawz agent directory returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function matchesQuery(agent, query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return true;
  return searchableAgentText(agent).includes(normalizedQuery);
}

function matchesLane(agentRow, laneFilter) {
  const normalizedLane = String(laneFilter || '').trim().toLowerCase();
  if (!normalizedLane) return true;
  const supportedLanes = arrayOfStrings(agentRow?.supportedLanes).map((entry) => entry.toLowerCase());
  const capabilities = arrayOfStrings(agentRow?.capabilities).map((entry) => entry.toLowerCase());
  return supportedLanes.includes(normalizedLane) || capabilities.includes(normalizedLane);
}

function matchesKind(agentRow, kind) {
  const normalizedKind = String(kind || '').trim().toLowerCase();
  if (!normalizedKind) return true;
  const wantedCapability = capabilityForKind(normalizedKind);
  return arrayOfStrings(agentRow?.supportedLanes).some((capability) => {
    return capability === wantedCapability || kindForCapability(capability) === normalizedKind;
  });
}

export function getSantaClawzSourceStatus(extra = {}) {
  const config = sourceConfig();
  return {
    enabled: config.enabled,
    apiBase: config.apiBase,
    siteBase: config.siteBase,
    exploreUrl: `${config.siteBase}/explore`,
    addAgentUrl: `${config.siteBase}/connect`,
    timeoutMs: config.timeoutMs,
    refreshMs: config.refreshMs,
    preflightSnapshotMs: config.preflightSnapshotMs,
    cacheLimit: config.cacheLimit,
    ...extra
  };
}

async function fetchSantaClawzDirectoryFromNetwork({ limit = 200, online = true, hireable = true } = {}) {
  const config = sourceConfig();
  if (!config.enabled) {
    return {
      agents: [],
      source: getSantaClawzSourceStatus({ disabled: true, fetched: false })
    };
  }
  const url = new URL(`${config.apiBase}/api/agents/search`);
  // SantaClawz distinguishes socket-online runtimes from hosted active agents.
  // Magic City wants the active hosted marketplace too, so availability is
  // filtered locally with the current directory shape instead of `online=true`.
  if (hireable) url.searchParams.set('hireable', 'true');
  url.searchParams.set('limit', String(Math.max(1, Math.min(Number(limit) || config.cacheLimit, 500))));

  const body = await fetchJsonWithTimeout(url, config.timeoutMs);
  const agents = Array.isArray(body?.agents) ? body.agents : [];
  return {
    agents,
    source: getSantaClawzSourceStatus({
      fetched: true,
      error: null,
      count: agents.length
    })
  };
}

function buildSantaClawzAgentsFromPreflightSnapshots(limit = 200) {
  return listSantaClawzPreflightSnapshots(limit)
    .map((snapshot) => {
      const metadata = snapshot?.metadata && typeof snapshot.metadata === 'object'
        ? snapshot.metadata
        : {};
      const agentId = String(snapshot?.agentId || '').trim();
      if (!agentId || metadata.online !== true || metadata.hireable !== true) return null;
      return {
        agentId,
        sessionId: agentId.split('--session_agent_')[1] ? `session_agent_${agentId.split('--session_agent_')[1]}` : null,
        agentName: String(metadata.label || agentId).trim(),
        representedPrincipal: String(metadata.label || agentId).trim(),
        headline: String(metadata.description || metadata.headline || 'SantaClawz execution agent').trim(),
        publicAgentUrl: metadata.publicAgentUrl || null,
        publicHireUrl: metadata.publicHireUrl || metadata.publicAgentUrl || null,
        online: true,
        published: true,
        hireable: true,
        paymentsReady: Boolean(metadata.paymentsReady || metadata.paidExecutionReady || metadata.quoteReady),
        paidExecutionReady: Boolean(metadata.paidExecutionReady),
        quoteReady: Boolean(metadata.quoteReady),
        paidExecutionProven: Boolean(metadata.proofCapable || metadata.paidExecutionProven),
        capabilityTags: arrayOfStrings(metadata.capabilityTags),
        deliveryLanes: arrayOfStrings(metadata.deliveryLanes),
        marketplaceTags: metadata.marketplaceTags || null,
        pricing: metadata.santaclawzPricing || metadata.pricing || null,
        reputation: metadata.santaclawzReputation || metadata.reputation || null,
        readiness: {
          online: true,
          paidExecutionReady: Boolean(metadata.paidExecutionReady),
          quoteReady: Boolean(metadata.quoteReady),
          runtimeReachable: true,
          workerReachable: true,
          source: snapshot.source || 'preflight_snapshot_fallback'
        }
      };
    })
    .filter(Boolean);
}

export async function refreshSantaClawzAgentCache({ force = false } = {}) {
  const config = sourceConfig();
  const nextConfigKey = configKey(config);
  if (!config.enabled) {
    directoryCache.configKey = nextConfigKey;
    directoryCache.agents = [];
    directoryCache.updatedAt = 0;
    directoryCache.source = getSantaClawzSourceStatus({ disabled: true, fetched: false });
    return {
      agents: [],
      source: directoryCache.source
    };
  }
  const cacheAge = directoryCache.updatedAt ? Date.now() - directoryCache.updatedAt : Infinity;
  const cacheStillFresh = directoryCache.configKey === nextConfigKey && cacheAge < config.refreshMs;
  if (!force && cacheStillFresh) {
    return {
      agents: directoryCache.agents,
      source: cacheSource(config, {
        fetched: false,
        count: directoryCache.agents.length,
        stale: false
      })
    };
  }
  if (directoryCache.refreshPromise) return directoryCache.refreshPromise;

  directoryCache.refreshPromise = (async () => {
    try {
      const result = await fetchSantaClawzDirectoryFromNetwork({
        limit: config.cacheLimit,
        online: true,
        hireable: true
      });
      directoryCache.configKey = nextConfigKey;
      directoryCache.agents = result.agents;
      directoryCache.updatedAt = Date.now();
      directoryCache.source = {
        ...result.source,
        cache: {
          ready: true,
          hit: false,
          updatedAt: new Date(directoryCache.updatedAt).toISOString(),
          ageMs: 0,
          refreshMs: config.refreshMs,
          refreshing: false
        }
      };
      return {
        agents: directoryCache.agents,
        source: directoryCache.source
      };
    } catch (error) {
      const snapshotAgents = buildSantaClawzAgentsFromPreflightSnapshots(config.cacheLimit);
      if (!directoryCache.agents.length && snapshotAgents.length) {
        directoryCache.configKey = nextConfigKey;
        directoryCache.agents = snapshotAgents;
        directoryCache.updatedAt = Date.now();
      }
      const source = cacheSource(config, {
        fetched: false,
        stale: directoryCache.updatedAt > 0,
        error: error?.message || 'santaclawz_directory_unavailable',
        count: directoryCache.agents.length,
        snapshotFallback: Boolean(snapshotAgents.length)
      });
      directoryCache.source = source;
      return {
        agents: directoryCache.agents,
        source
      };
    } finally {
      directoryCache.refreshPromise = null;
    }
  })();

  return directoryCache.refreshPromise;
}

export async function getSantaClawzAuthoritativeRuntimeByMagicId(agentId, { force = true } = {}) {
  const normalizedId = String(agentId || '').trim();
  const externalId = normalizedId.startsWith('santaclawz:')
    ? normalizedId.slice('santaclawz:'.length)
    : normalizedId;
  if (!externalId) return null;
  const snapshot = await refreshSantaClawzAgentCache({ force });
  return snapshot.agents.find((agent) => String(agent?.agentId || '').trim() === externalId) || null;
}

export async function getSantaClawzExecutionAgentByMagicId(agentId, {
  includeEndpoint = false,
  force = true
} = {}) {
  const rawAgent = await getSantaClawzAuthoritativeRuntimeByMagicId(agentId, { force });
  if (!rawAgent || !isSantaClawzProtocolHireReadyForMagicCity(rawAgent)) return null;
  const agentRow = normalizeSantaClawzAgent(rawAgent);
  if (!agentRow) return null;
  const requirementsResolution = await resolveSantaClawzInputRequirements(rawAgent, { allowLivePreflight: true });
  const firstMatchingLane = arrayOfStrings(agentRow.supportedLanes)[0] || '';
  const resolvedKind = kindForCapability(firstMatchingLane) || 'agent';
  const score = scoreSantaClawzAgent(rawAgent, arrayOfStrings(agentRow.supportedLanes), '');
  const reputationStats = getSantaClawzReputationStats(rawAgent);
  return {
    pluginId: agentRow.agentId,
    ownerAgentId: rawAgent.agentId || agentRow.agentId,
    kind: resolvedKind,
    localOnly: false,
    helperAgents: [],
    capabilities: agentRow.capabilities,
    privacyModes: agentRow.privacyModes,
    endpoint: includeEndpoint ? agentRow.endpoint : null,
    metadata: {
      ...agentRow.metadata,
      online: true,
      hireable: true,
      label: agentRow.metadata?.label || agentRow.agentId,
      description: agentRow.metadata?.description || 'SantaClawz execution agent',
      publicHireUrl: agentRow.metadata?.publicHireUrl,
      publicAgentUrl: agentRow.metadata?.publicAgentUrl,
      agentInputRequirements: requirementsResolution.inputRequirements,
      preflight: requirementsResolution.preflight,
      authoritativeSelection: true
    },
    executionScore: {
      pluginId: agentRow.agentId,
      ownerAgentId: rawAgent.agentId || agentRow.agentId,
      kind: resolvedKind,
      score,
      stats: {
        fulfilled: reputationStats.completed,
        claimed: reputationStats.evaluated,
        fulfilledCount: reputationStats.completed,
        claimedCount: reputationStats.evaluated,
        failedCount: reputationStats.failed,
        successRate: reputationStats.successRate,
        proofRate: reputationStats.proofRate,
        positiveAttestations: reputationStats.anchoredSocialFactCount,
        negativeAttestations: reputationStats.pendingSocialAnchorCount,
        humanAttestations: 0,
        acpAttestations: rawAgent?.paidExecutionProven ? 1 : 0,
        localFulfillment: 0,
        santaClawzAgent: true,
        label: reputationStats.label
      }
    }
  };
}

export async function refreshSantaClawzPreflightSnapshots({ force = false } = {}) {
  const config = sourceConfig();
  if (!config.enabled) {
    return {
      refreshed: false,
      reason: 'santaclawz_disabled',
      snapshots: []
    };
  }
  const cacheAge = directoryCache.lastPreflightRefreshAt ? Date.now() - directoryCache.lastPreflightRefreshAt : Infinity;
  if (!force && cacheAge < config.preflightSnapshotMs) {
    return {
      refreshed: false,
      reason: 'fresh',
      lastPreflightRefreshAt: directoryCache.lastPreflightRefreshAt ? new Date(directoryCache.lastPreflightRefreshAt).toISOString() : null,
      snapshots: listSantaClawzPreflightSnapshots(100)
    };
  }
  if (directoryCache.preflightRefreshPromise) return directoryCache.preflightRefreshPromise;

  directoryCache.preflightRefreshPromise = (async () => {
    const checkedAt = new Date();
    const directory = await fetchSantaClawzDirectory({ limit: config.cacheLimit, online: true, hireable: true });
    const rawAgents = directory.agents
      .filter((rawAgent) => isSantaClawzVisibleForMagicCityMarketplace(rawAgent));
    const snapshots = [];
    for (const rawAgent of rawAgents) {
      const preflightPayload = await fetchSantaClawzAgentPreflight(rawAgent.agentId, {
        timeoutMs: Math.min(config.timeoutMs, 2500)
      });
      const snapshot = upsertSantaClawzPreflightSnapshot(buildSnapshotFromAgentPreflight(rawAgent, preflightPayload, {
        checkedAt,
        source: preflightPayload ? 'daily_preflight' : 'daily_directory_metadata'
      }));
      if (snapshot) snapshots.push(snapshot);
    }
    directoryCache.lastPreflightRefreshAt = Date.now();
    return {
      refreshed: true,
      checkedAt: checkedAt.toISOString(),
      count: snapshots.length,
      apiKeyConfigured: Boolean(getSantaClawzApiKey()),
      snapshots
    };
  })().finally(() => {
    directoryCache.preflightRefreshPromise = null;
  });

  return directoryCache.preflightRefreshPromise;
}

export async function fetchSantaClawzDirectory({
  query = '',
  limit = 100,
  online = true,
  hireable = true
} = {}) {
  const config = sourceConfig();
  if (!config.enabled) {
    return {
      agents: [],
      source: getSantaClawzSourceStatus({ disabled: true, fetched: false })
    };
  }
  const cacheAge = directoryCache.updatedAt ? Date.now() - directoryCache.updatedAt : Infinity;
  const cacheMatchesConfig = directoryCache.configKey === configKey(config);
  const hasUsableCache = cacheMatchesConfig && directoryCache.updatedAt > 0;
  const stale = hasUsableCache && cacheAge >= config.refreshMs;
  const snapshot = hasUsableCache
    ? {
        agents: directoryCache.agents,
        source: cacheSource(config, {
          fetched: false,
          count: directoryCache.agents.length,
          stale
        })
      }
    : await refreshSantaClawzAgentCache({ force: true });

  if (stale) void refreshSantaClawzAgentCache({ force: true });

  const trimmedQuery = String(query || '').trim();
  const maxResults = Math.max(1, Math.min(Number(limit) || 100, 500));
  const filteredAgents = snapshot.agents
    .filter((agent) => (online ? isSantaClawzAvailableForMagicCity(agent) : true))
    .filter((agent) => (hireable ? isSantaClawzVisibleForMagicCityMarketplace(agent) : true))
    .filter((agent) => matchesQuery(agent, trimmedQuery))
    .slice(0, maxResults);

  return {
    agents: filteredAgents,
    source: {
      ...snapshot.source,
      count: snapshot.agents.length,
      returnedCount: filteredAgents.length,
      query: trimmedQuery || null,
      limit: maxResults
    }
  };
}

export function startSantaClawzAgentCacheRefresher({ immediate = true } = {}) {
  const config = sourceConfig();
  if (!config.enabled) return getSantaClawzSourceStatus({ disabled: true, started: false });
  if (directoryCache.refresher) return getSantaClawzSourceStatus({ started: true, alreadyStarted: true });
  if (immediate) {
    void refreshSantaClawzAgentCache({ force: true });
    void refreshSantaClawzPreflightSnapshots({ force: false });
  }
  directoryCache.refresher = setInterval(() => {
    void refreshSantaClawzAgentCache({ force: true });
  }, config.refreshMs);
  directoryCache.refresher.unref?.();
  directoryCache.preflightRefresher = setInterval(() => {
    void refreshSantaClawzPreflightSnapshots({ force: true });
  }, config.preflightSnapshotMs);
  directoryCache.preflightRefresher.unref?.();
  return getSantaClawzSourceStatus({ started: true, preflightSnapshotsStarted: true });
}

export async function listSantaClawzAgentRows({
  query = '',
  laneFilter = '',
  limit = 100,
  hireable = true
} = {}) {
  const { agents, source } = await fetchSantaClawzDirectory({ query, limit, online: true, hireable });
  const rows = (await Promise.all(agents
    .filter((agent) => matchesQuery(agent, query))
    .map(async (rawAgent) => {
      const agentRow = normalizeSantaClawzAgent(rawAgent);
      if (!agentRow) return null;
      const requirementsResolution = await resolveSantaClawzInputRequirements(rawAgent, { allowLivePreflight: true });
      return {
        ...agentRow,
        metadata: {
          ...(agentRow.metadata || {}),
          agentInputRequirements: requirementsResolution.inputRequirements,
          preflight: requirementsResolution.preflight
        }
      };
    })))
    .filter(Boolean)
    .filter((agentRow) => agentRow.metadata?.online)
    .filter((agentRow) => !hireable || agentRow.metadata?.hireable)
    .filter((agentRow) => matchesLane(agentRow, laneFilter));
  return {
    agents: rows,
    source: {
      ...source,
      normalizedCount: rows.length,
      laneFilter: laneFilter || null
    }
  };
}

export async function getSantaClawzAgentRowByMagicId(agentId) {
  const normalizedId = String(agentId || '').trim();
  if (!normalizedId.startsWith('santaclawz:')) return null;
  const externalId = normalizedId.slice('santaclawz:'.length);
  const { agents } = await listSantaClawzAgentRows({ query: externalId, limit: 50 });
  return agents.find((agent) => agent.agentId === normalizedId) || null;
}

export async function listSantaClawzExecutionAgentsForSession(session, {
  includeEndpoint = false,
  limit = 100
} = {}) {
  const rawKind = String(session?.handoffData?.kind || '').trim().toLowerCase();
  const kind = rawKind === 'agent' ? '' : rawKind;
  const { agents, source } = await fetchSantaClawzDirectory({ limit, online: true, hireable: true });
  const executionAgents = (await Promise.all(agents
    .map(async (rawAgent) => {
      const agentRow = normalizeSantaClawzAgent(rawAgent);
      if (!agentRow || !matchesKind(agentRow, kind)) return null;
      if (!agentRow.metadata?.online) return null;
      if (!agentRow.metadata?.hireable) return null;
      const requirementsResolution = await resolveSantaClawzInputRequirements(rawAgent, { allowLivePreflight: true });
      const inputRequirements = requirementsResolution.inputRequirements;
      const firstMatchingLane = arrayOfStrings(agentRow.supportedLanes).find((capability) => kindForCapability(capability) === kind)
        || agentRow.supportedLanes?.[0]
        || '';
      const resolvedKind = kind || kindForCapability(firstMatchingLane) || null;
      const score = scoreSantaClawzAgent(rawAgent, arrayOfStrings(agentRow.supportedLanes), kind);
      const reputationStats = getSantaClawzReputationStats(rawAgent);
      return {
        pluginId: agentRow.agentId,
        ownerAgentId: rawAgent.agentId || agentRow.agentId,
        kind: resolvedKind,
        localOnly: false,
        helperAgents: [],
        capabilities: agentRow.capabilities,
        privacyModes: agentRow.privacyModes,
        endpoint: includeEndpoint ? agentRow.endpoint : null,
        metadata: {
          ...agentRow.metadata,
          label: agentRow.metadata?.label || agentRow.agentId,
          description: agentRow.metadata?.description || 'SantaClawz execution agent',
          publicHireUrl: includeEndpoint ? agentRow.metadata?.publicHireUrl : agentRow.metadata?.publicHireUrl,
          publicAgentUrl: agentRow.metadata?.publicAgentUrl,
          agentInputRequirements: inputRequirements,
          preflight: requirementsResolution.preflight
        },
        executionScore: {
          pluginId: agentRow.agentId,
          ownerAgentId: rawAgent.agentId || agentRow.agentId,
          kind: resolvedKind,
          score,
          stats: {
            fulfilled: reputationStats.completed,
            claimed: reputationStats.evaluated,
            fulfilledCount: reputationStats.completed,
            claimedCount: reputationStats.evaluated,
            failedCount: reputationStats.failed,
            successRate: reputationStats.successRate,
            proofRate: reputationStats.proofRate,
            positiveAttestations: reputationStats.anchoredSocialFactCount,
            negativeAttestations: reputationStats.pendingSocialAnchorCount,
            humanAttestations: 0,
            acpAttestations: rawAgent?.paidExecutionProven ? 1 : 0,
            localFulfillment: 0,
            santaClawzAgent: true,
            label: reputationStats.label
          }
        }
      };
    })))
    .filter(Boolean)
    .sort((left, right) => {
      const hireableDiff = Number(right?.metadata?.hireable ? 1 : 0) - Number(left?.metadata?.hireable ? 1 : 0);
      if (hireableDiff !== 0) return hireableDiff;
      const scoreDiff = Number(right?.executionScore?.score || 0) - Number(left?.executionScore?.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return String(left?.metadata?.label || left?.pluginId || '').localeCompare(String(right?.metadata?.label || right?.pluginId || ''));
    });

  return {
    executionAgents,
    source: {
      ...source,
      normalizedCount: executionAgents.length,
      kind: kind || null,
      preflightSnapshots: {
        count: listSantaClawzPreflightSnapshots(500).length,
        freshCount: listSantaClawzPreflightSnapshots(500).filter((snapshot) => isFreshSantaClawzPreflightSnapshot(snapshot)).length,
        ttlMs: sourceConfig().preflightSnapshotMs,
        lastRefreshAt: directoryCache.lastPreflightRefreshAt ? new Date(directoryCache.lastPreflightRefreshAt).toISOString() : null,
        refreshing: Boolean(directoryCache.preflightRefreshPromise)
      }
    }
  };
}

export function isSantaClawzExecutionAgent(agent) {
  return String(agent?.metadata?.source || '').toLowerCase() === 'santaclawz'
    || String(agent?.pluginId || '').startsWith('santaclawz:');
}
