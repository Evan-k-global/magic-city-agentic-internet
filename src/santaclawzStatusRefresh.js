import crypto from 'node:crypto';

const VOLATILE_STATUS_KEYS = new Set([
  'checkedat',
  'checkedatiso',
  'generatedat',
  'generatedatiso',
  'heartbeatat',
  'heartbeatatiso',
  'lastcheckedat',
  'lastheartbeatat',
  'lastheartbeatatiso',
  'laststatusat',
  'polledat',
  'pollstartedat',
  'runtimeStatusUpdatedAtIso'.toLowerCase(),
  'stateprojectionupdatedat',
  'stateprojectionupdatedatiso',
  'updatedat',
  'updatedatiso'
]);

function isVolatileStatusKey(key) {
  return VOLATILE_STATUS_KEYS.has(String(key || '').replace(/[_-]/g, '').toLowerCase());
}

function normalizeSemanticValue(value) {
  if (Array.isArray(value)) return value.map((entry) => normalizeSemanticValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, nested]) => nested !== undefined && !isVolatileStatusKey(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalizeSemanticValue(nested)])
    );
  }
  return value;
}

export function semanticSantaClawzStatusDigest(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalizeSemanticValue(value ?? null)))
    .digest('hex');
}

export function hasSemanticSantaClawzStatusChanged(current, next) {
  return semanticSantaClawzStatusDigest(current) !== semanticSantaClawzStatusDigest(next);
}

export function createSantaClawzStatusRefreshCoordinator({
  freshnessMs = 4000,
  now = () => Date.now()
} = {}) {
  const inFlight = new Map();
  const lastCheckedAt = new Map();

  return {
    async run(key, task, { force = false } = {}) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return task();
      const active = inFlight.get(normalizedKey);
      if (active) return active;
      const lastChecked = lastCheckedAt.get(normalizedKey);
      if (!force && Number.isFinite(lastChecked) && now() - lastChecked < freshnessMs) {
        return { skipped: true, reason: 'fresh_status_cache' };
      }
      const pending = Promise.resolve()
        .then(task)
        .finally(() => {
          lastCheckedAt.set(normalizedKey, now());
          if (inFlight.get(normalizedKey) === pending) inFlight.delete(normalizedKey);
        });
      inFlight.set(normalizedKey, pending);
      return pending;
    },
    clear(key) {
      const normalizedKey = String(key || '').trim();
      inFlight.delete(normalizedKey);
      lastCheckedAt.delete(normalizedKey);
    }
  };
}
