export const MODEL_PRIVACY_VERSION = 'public-catalog-v1';
const PAGE_FIELDS = ['url', 'title', 'heading', 'description'];
const CANDIDATE_FIELDS = ['id', 'title', 'price', 'currency', 'availability', 'attributes'];

export function normalizeModelPrivacy(value = {}) {
  const dataRouting = value.dataRouting || 'disabled';
  if (!['disabled', 'local', 'cloud'].includes(dataRouting)) throw new Error('model_data_routing_invalid');
  const policy = value.observationPolicy || {};
  const allowedOrigins = (policy.allowedOrigins || []).map((origin) => {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || origin.includes('*')) throw new Error('model_observation_origin_invalid');
    return origin;
  });
  function fields(values, permitted, required) {
    const selected = values || required;
    if (!Array.isArray(selected) || selected.some((field) => !permitted.includes(field)) || required.some((field) => !selected.includes(field))) throw new Error('model_observation_fields_invalid');
    return [...new Set(selected)];
  }
  return {
    dataRouting,
    observationPolicy: {
      version: MODEL_PRIVACY_VERSION,
      allowedOrigins: [...new Set(allowedOrigins)],
      pageFields: fields(policy.pageFields, PAGE_FIELDS, ['url']),
      candidateFields: fields(policy.candidateFields, CANDIDATE_FIELDS, ['id', 'title'])
    }
  };
}

export function filterModelObservation(observation, config, consent) {
  const privacy = normalizeModelPrivacy(config);
  if (privacy.dataRouting === 'disabled') throw new Error('model_data_routing_disabled');
  // Consent covers the destination/model and the entire configured field and
  // origin policy. A rebuild changing any of these requires new consent.
  if (consent !== modelConsentKey(config)) throw new Error('model_privacy_consent_required');
  const page = observation?.page || {};
  let url;
  try { url = new URL(page.url || observation?.url); } catch { throw new Error('model_page_not_allowed'); }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { throw new Error('model_page_not_allowed'); }
  if (!privacy.observationPolicy.allowedOrigins.includes(url.origin)
    || !['search', 'product', 'catalog'].includes(page.kind)
    || page.containsSensitiveData !== false
    || /(?:login|signin|sign-in|signout|oauth|auth|account|checkout|payment|billing|wallet|password|cart)/i.test(pathname)) {
    throw new Error('model_sensitive_page_blocked');
  }
  const pick = (record, fields) => Object.fromEntries(fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]]));
  return {
    page: pick({ ...page, url: url.href }, privacy.observationPolicy.pageFields),
    candidates: (Array.isArray(observation.candidates) ? observation.candidates : []).slice(0, 20).map((candidate) => pick(candidate || {}, privacy.observationPolicy.candidateFields))
  };
}

export function modelConsentKey(config) {
  return JSON.stringify({ ...normalizeModelPrivacy(config), controlPlaneOrigin: config.controlPlaneOrigin || '', modelId: config.modelId || '', path: config.path || '', allowedQueryParameters: config.allowedQueryParameters || [] });
}
