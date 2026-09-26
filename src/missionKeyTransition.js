import crypto from 'node:crypto';

const PREFIX = 'MISSION_BOUND_AUTH_LEGACY_';
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const digest = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Explicit, finite migration allowlist. Never trust an old key alone: it may
// still serve another legacy purpose until the transition has drained.
export function readMissionKeyTransition(env = process.env) {
  const fields = ['SECRET', 'TOKEN_SHA256', 'CUTOVER_AT', 'ACCEPT_UNTIL'];
  if (!fields.some((field) => env[PREFIX + field])) return null;
  if (fields.some((field) => !env[PREFIX + field])) throw new Error('mission_key_transition_incomplete');
  const secret = String(env[PREFIX + 'SECRET']).trim();
  const hashes = String(env[PREFIX + 'TOKEN_SHA256']).split(',').map((v) => v.trim());
  const cutoverAt = Date.parse(env[PREFIX + 'CUTOVER_AT']);
  const acceptUntil = Date.parse(env[PREFIX + 'ACCEPT_UNTIL']);
  if (secret.length < 32 || secret === String(env.MISSION_BOUND_AUTH_SECRET || '').trim()) throw new Error('mission_key_transition_invalid_secret');
  if (!Number.isFinite(cutoverAt) || !Number.isFinite(acceptUntil) || acceptUntil <= cutoverAt || acceptUntil - cutoverAt > MAX_WINDOW_MS) throw new Error('mission_key_transition_invalid_window');
  if (hashes.length > 256 || hashes.some((h) => !/^[a-f0-9]{64}$/.test(h)) || new Set(hashes).size !== hashes.length) throw new Error('mission_key_transition_invalid_allowlist');
  return { secret, hashes: new Set(hashes), cutoverAt, acceptUntil };
}

function matches(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== 'mcap' || !parts[1] || !/^[A-Za-z0-9_-]{43}$/.test(parts[2]) || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(parts[1]).digest('base64url');
  return crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected));
}

export function verifyMissionTokenSignature(token, primarySecret, transition = null, now = Date.now()) {
  if (matches(token, primarySecret)) return true;
  if (!transition || now < transition.cutoverAt || now >= transition.acceptUntil
    || !transition.hashes.has(digest(token)) || !matches(token, transition.secret)) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const issued = Date.parse(payload.issuedAt), expires = Date.parse(payload.expiresAt);
    return Number.isFinite(issued) && issued <= transition.cutoverAt && issued <= now
      && Number.isFinite(expires) && expires > now && expires > issued && expires <= transition.acceptUntil;
  } catch { return false; }
}

// Run against authoritative, already-issued tokens during a quiet cutover.
// Outputs hashes only, not tokens or keys. Missing/unpersisted tokens require
// draining before cutover; never reconstruct authority from client requests.
export function buildMissionTransitionManifest(tokens, secret, cutoverAt = Date.now()) {
  const hashes = new Set();
  let acceptUntil = cutoverAt;
  for (const token of tokens) {
    if (!matches(token, secret)) throw new Error('mission_transition_invalid_source_token');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const issued = Date.parse(payload.issuedAt), expires = Date.parse(payload.expiresAt);
    if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > cutoverAt || expires <= issued) throw new Error('mission_transition_invalid_source_dates');
    if (expires <= cutoverAt) continue;
    if (expires > cutoverAt + MAX_WINDOW_MS) throw new Error('mission_transition_drain_long_lived_token');
    hashes.add(digest(token));
    if (hashes.size > 256) throw new Error('mission_transition_drain_excess_tokens');
    acceptUntil = Math.max(acceptUntil, expires);
  }
  return { tokenSha256: [...hashes].sort(), cutoverAt: new Date(cutoverAt).toISOString(), acceptUntil: new Date(acceptUntil).toISOString() };
}
