const MODEL_REQUEST_SCHEMA = 'magic-city-helper-model-request-v1';
const MODEL_RESPONSE_SCHEMA = 'magic-city-helper-model-response-v1';
const MODEL_DECISIONS = new Set(['select_candidate', 'abstain', 'request_user']);
const MAX_MODEL_RESPONSE_BYTES = 64 * 1024;

function compact(value, limit) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

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

function base64Url(bytes) {
  const values = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(digest);
}

function requestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function missionBinding(session = {}, planAction = {}) {
  const binding = {
    sessionId: compact(session.id, 96),
    planHash: compact(session.extensionMissionPlan?.planHash, 160),
    planActionId: compact(planAction.id, 96)
  };
  if (!binding.sessionId || !binding.planHash || !binding.planActionId) {
    throw new Error('model_mission_binding_missing');
  }
  return binding;
}

function safePrice(value) {
  if (value == null || typeof value === 'string' && !value.trim()) return null;
  const price = Number(value);
  return Number.isFinite(price) ? price : null;
}

function safePageUrl(value, allowedQueryParameters = []) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = '';
    url.password = '';
    url.hash = '';
    const allowed = new Set(allowedQueryParameters);
    for (const key of [...url.searchParams.keys()]) {
      if (!allowed.has(key)) url.searchParams.delete(key);
    }
    return compact(url.href, 500);
  } catch {
    return '';
  }
}

function boundedObservation(observation = {}, allowedQueryParameters = []) {
  const candidates = Array.isArray(observation.candidates)
    ? observation.candidates.slice(0, 20).map((candidate, index) => ({
        id: compact(candidate?.id || `candidate-${index + 1}`, 96),
        title: compact(candidate?.title, 240),
        price: safePrice(candidate?.price),
        currency: compact(candidate?.currency, 12),
        availability: compact(candidate?.availability, 80),
        attributes: Array.isArray(candidate?.attributes)
          ? candidate.attributes.slice(0, 12).map((value) => compact(value, 120)).filter(Boolean)
          : []
      })).filter((candidate) => candidate.id && candidate.title)
    : [];
  const candidateIds = new Set();
  for (const candidate of candidates) {
    if (candidateIds.has(candidate.id)) throw new Error('model_observation_candidate_id_duplicate');
    candidateIds.add(candidate.id);
  }
  return {
    page: {
      url: safePageUrl(observation.page?.url || observation.url, allowedQueryParameters),
      title: compact(observation.page?.title || observation.title, 180),
      heading: compact(observation.page?.heading || observation.heading, 240),
      description: compact(observation.page?.description || observation.description, 500)
    },
    candidates
  };
}

async function readBoundedJson(response, signal) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MODEL_RESPONSE_BYTES) {
    throw new Error('model_response_too_large');
  }
  let text = '';
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    while (true) {
      if (signal.aborted) throw new Error('model_adapter_timeout');
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error('model_adapter_timeout');
      if (done) break;
      received += value?.byteLength || 0;
      if (received > MAX_MODEL_RESPONSE_BYTES) {
        await reader.cancel().catch(() => null);
        throw new Error('model_response_too_large');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } else if (typeof response.text === 'function') {
    text = await response.text();
    if (signal.aborted) throw new Error('model_adapter_timeout');
    if (new TextEncoder().encode(text).byteLength > MAX_MODEL_RESPONSE_BYTES) {
      throw new Error('model_response_too_large');
    }
  } else {
    const data = await response.json();
    if (signal.aborted) throw new Error('model_adapter_timeout');
    text = JSON.stringify(data);
    if (new TextEncoder().encode(text).byteLength > MAX_MODEL_RESPONSE_BYTES) {
      throw new Error('model_response_too_large');
    }
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error('model_response_json_invalid');
  }
}

function validateResponse(data, expected, candidateIds) {
  const response = data?.result || data;
  if (response?.schema !== MODEL_RESPONSE_SCHEMA) throw new Error('model_response_schema_invalid');
  if (response.requestId !== expected.requestId) throw new Error('model_response_request_mismatch');
  if (response.observationHash !== expected.observationHash) throw new Error('model_response_observation_mismatch');
  for (const [key, value] of Object.entries(expected.binding)) {
    if (response.binding?.[key] !== value) throw new Error(`model_response_${key}_mismatch`);
  }
  const kind = compact(response.decision?.kind, 40);
  if (!MODEL_DECISIONS.has(kind)) throw new Error('model_response_decision_invalid');
  const candidateId = compact(response.decision?.candidateId, 96);
  if (kind === 'select_candidate' && (!candidateId || !candidateIds.has(candidateId))) {
    throw new Error('model_response_candidate_unobserved');
  }
  return {
    kind,
    candidateId: kind === 'select_candidate' ? candidateId : '',
    reason: compact(response.decision?.reason, 500),
    confidence: Number.isFinite(Number(response.decision?.confidence))
      ? Math.max(0, Math.min(1, Number(response.decision.confidence)))
      : null
  };
}

export async function consultPartnerModel({
  config,
  controlPlaneOrigin,
  bearer,
  session,
  planAction,
  observation,
  purpose = 'select_observed_candidate',
  fetchImpl = fetch
}) {
  const mode = String(config?.mode || 'disabled');
  if (mode === 'disabled') return { status: 'disabled', decision: null };
  if (mode !== 'control_plane') throw new Error('model_adapter_mode_unsupported');
  if (!bearer) throw new Error('model_device_token_required');
  const origin = new URL(controlPlaneOrigin).origin;
  const endpoint = new URL(String(config.path || ''), origin);
  if (endpoint.origin !== origin) throw new Error('model_adapter_origin_mismatch');
  const binding = missionBinding(session, planAction);
  const safeObservation = boundedObservation(observation, config.allowedQueryParameters || []);
  const observationHash = await sha256(stableJson(safeObservation));
  const request = {
    schema: MODEL_REQUEST_SCHEMA,
    requestId: requestId(),
    binding,
    observationHash,
    purpose: compact(purpose, 80),
    modelId: compact(config.modelId, 120),
    observation: safeObservation
  };
  const timeoutMs = Math.max(1000, Math.min(20000, Number(config.timeoutMs) || 15000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('model_timeout'), timeoutMs);
  let response;
  let data;
  try {
    response = await fetchImpl(endpoint.href, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearer}`,
        'content-type': 'application/json',
        'x-magic-city-helper-model-schema': MODEL_REQUEST_SCHEMA
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    data = await readBoundedJson(response, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error('model_adapter_timeout');
    throw error;
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(data.error || `model_adapter_${response.status}`);
  return {
    status: 'completed',
    requestId: request.requestId,
    observationHash,
    decision: validateResponse(data, request, new Set(safeObservation.candidates.map((candidate) => candidate.id)))
  };
}

export const MODEL_ADAPTER_SCHEMAS = Object.freeze({
  request: MODEL_REQUEST_SCHEMA,
  response: MODEL_RESPONSE_SCHEMA,
  maxResponseBytes: MAX_MODEL_RESPONSE_BYTES
});
