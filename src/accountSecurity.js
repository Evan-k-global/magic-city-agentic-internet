import crypto from 'node:crypto';

const denied = (message, statusCode = 403) => Object.assign(new Error(message), { statusCode });
export const futureExpiry = (value, now = Date.now()) => Number.isFinite(Date.parse(value || '')) && Date.parse(value) > now;
export function equalSecret(left, right) {
  const a = crypto.createHash('sha256').update(String(left || '')).digest();
  const b = crypto.createHash('sha256').update(String(right || '')).digest();
  return Boolean(left && right) && crypto.timingSafeEqual(a, b);
}
export function verifiedProviderIdentity(provider, profile = {}, emails = []) {
  const subject = String(provider === 'google' ? profile.sub || '' : profile.id || '').trim();
  const email = String(provider === 'google'
    ? (profile.email_verified === true ? profile.email || '' : '')
    : (emails.find((row) => row.primary === true && row.verified === true)?.email || emails.find((row) => row.verified === true)?.email || '')).trim().toLowerCase();
  if (!['google', 'github'].includes(provider) || !subject || !email.includes('@')) throw denied('provider_verified_identity_required');
  return { provider, subject, email };
}
export function assertProviderAccountLink(user, identity, currentAuth = null, now = Date.now()) {
  if (!user) return;
  const existing = String(identity.provider === 'google' ? user.googleProfile?.subject || '' : user.githubProfile?.id || '').trim();
  if (existing === identity.subject) return;
  if (existing) throw denied('provider_subject_mismatch');
  // A verified provider email cannot silently adopt a pre-registered password
  // account. Linking requires a fresh first-party login to that same account.
  const session = currentAuth?.authSession;
  const age = now - Date.parse(session?.createdAt || '');
  if (currentAuth?.authUser?.id !== user.id || !session || session.revokedAt || !futureExpiry(session.expiresAt, now)
    || !Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000) throw denied('account_link_requires_recent_signin');
}
export function assertOauthBrowserBinding(state, cookie) {
  const digest = crypto.createHash('sha256').update(String(cookie || '')).digest('hex');
  if (!cookie || !equalSecret(state?.browserBinding, digest)) throw denied('oauth_browser_binding_mismatch');
}
