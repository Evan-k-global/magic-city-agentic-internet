const GOOGLE_OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const GOOGLE_PEOPLE_CREATE_CONTACT_URL = 'https://people.googleapis.com/v1/people:createContact?personFields=names,emailAddresses';
const GOOGLE_GMAIL_DRAFTS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';
const GOOGLE_GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export const GOOGLE_CAPABILITY_SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  contacts: 'https://www.googleapis.com/auth/contacts',
  gmailDrafts: 'https://www.googleapis.com/auth/gmail.compose',
  gmailSend: 'https://www.googleapis.com/auth/gmail.compose'
};

export const GOOGLE_CAPABILITY_LABELS = {
  calendar: 'Calendar events',
  contacts: 'Contacts',
  gmailDrafts: 'Gmail drafts',
  gmailSend: 'Gmail send'
};

export const GOOGLE_SCOPE_PRESETS = {
  sign_in: [
    'openid',
    'email',
    'profile'
  ],
  meeting_sync: [
    'openid',
    'email',
    'profile',
    GOOGLE_CAPABILITY_SCOPES.calendar,
    GOOGLE_CAPABILITY_SCOPES.contacts,
    GOOGLE_CAPABILITY_SCOPES.gmailDrafts
  ]
};

function getGoogleClientId() {
  const value = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!value) throw new Error('google_not_configured');
  return value;
}

function getGoogleClientSecret() {
  const value = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!value) throw new Error('google_not_configured');
  return value;
}

export function getGoogleRedirectUri() {
  const value = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
  if (!value) throw new Error('google_redirect_uri_not_configured');
  return value;
}

export function isGoogleConfigured() {
  return Boolean(
    String(process.env.GOOGLE_CLIENT_ID || '').trim() &&
    String(process.env.GOOGLE_CLIENT_SECRET || '').trim() &&
    String(process.env.GOOGLE_REDIRECT_URI || '').trim()
  );
}

function normalizeScopes(scopes = []) {
  return [...new Set((Array.isArray(scopes) ? scopes : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

export function parseGoogleCapabilities(rawValue = '') {
  return [...new Set(
    String(rawValue || '')
      .split(',')
      .map((value) => String(value || '').trim())
      .filter((value) => Object.prototype.hasOwnProperty.call(GOOGLE_CAPABILITY_SCOPES, value))
  )];
}

export function buildGoogleScopesForCapabilities(capabilities = [], { includeIdentity = true } = {}) {
  const resolved = Array.isArray(capabilities) ? capabilities : [];
  const scopes = [];
  if (includeIdentity) {
    scopes.push('openid', 'email', 'profile');
  }
  for (const capability of resolved) {
    const scope = GOOGLE_CAPABILITY_SCOPES[capability];
    if (scope) scopes.push(scope);
  }
  return normalizeScopes(scopes);
}

export function getScopesForPreset(preset = 'meeting_sync') {
  return normalizeScopes(GOOGLE_SCOPE_PRESETS[preset] || GOOGLE_SCOPE_PRESETS.meeting_sync);
}

export function buildGoogleAuthorizationUrl({ state, scopes = [], prompt = 'consent', loginHint = '' }) {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: getGoogleRedirectUri(),
    response_type: 'code',
    access_type: 'offline',
    include_granted_scopes: 'true',
    state,
    scope: normalizeScopes(scopes).join(' ')
  });
  if (prompt) params.set('prompt', prompt);
  if (loginHint) params.set('login_hint', loginHint);
  return `${GOOGLE_OAUTH_BASE}?${params.toString()}`;
}

async function readGoogleJson(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(data?.error_description || data?.error?.message || data?.error || `google_request_failed:${response.status}`);
    err.statusCode = response.status;
    err.details = data;
    throw err;
  }
  return data;
}

export async function exchangeGoogleCode({ code }) {
  const params = new URLSearchParams({
    code: String(code || ''),
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    redirect_uri: getGoogleRedirectUri(),
    grant_type: 'authorization_code'
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  return readGoogleJson(response);
}

export async function refreshGoogleAccessToken({ refreshToken }) {
  const params = new URLSearchParams({
    refresh_token: String(refreshToken || ''),
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    grant_type: 'refresh_token'
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  return readGoogleJson(response);
}

export async function revokeGoogleToken(token) {
  if (!token) return { revoked: false };
  const params = new URLSearchParams({ token: String(token) });
  const response = await fetch(GOOGLE_REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!response.ok) {
    const text = await response.text();
    const err = new Error(text || `google_revoke_failed:${response.status}`);
    err.statusCode = response.status;
    throw err;
  }
  return { revoked: true };
}

async function googleApiRequest(url, accessToken, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return readGoogleJson(response);
}

export async function fetchGoogleUserProfile(accessToken) {
  return googleApiRequest(GOOGLE_USERINFO_URL, accessToken);
}

export async function createGoogleCalendarEvent(accessToken, { summary, description, attendees = [], startIso, endIso }) {
  return googleApiRequest(GOOGLE_CALENDAR_EVENTS_URL, accessToken, {
    method: 'POST',
    body: {
      summary,
      description,
      start: { dateTime: startIso },
      end: { dateTime: endIso },
      attendees: attendees.filter(Boolean).map((email) => ({ email })),
      reminders: { useDefault: true }
    }
  });
}

export async function createGoogleContact(accessToken, { name, email, phone }) {
  const emailValue = String(email || '').trim().toLowerCase();
  const phoneValue = String(phone || '').trim();
  const body = {
    names: [{ givenName: name, displayName: name }]
  };
  if (emailValue) {
    body.emailAddresses = [{ value: emailValue }];
  }
  if (phoneValue) {
    body.phoneNumbers = [{ value: phoneValue }];
  }
  return googleApiRequest(GOOGLE_PEOPLE_CREATE_CONTACT_URL, accessToken, {
    method: 'POST',
    body
  });
}

function toBase64Url(value) {
  return Buffer.from(String(value || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildMimeMessage({ to = [], cc = [], bcc = [], subject = '', body = '' }) {
  return [
    `To: ${to.filter(Boolean).join(', ')}`,
    cc.filter(Boolean).length ? `Cc: ${cc.filter(Boolean).join(', ')}` : '',
    bcc.filter(Boolean).length ? `Bcc: ${bcc.filter(Boolean).join(', ')}` : '',
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
    `Subject: ${subject}`,
    '',
    body
  ].filter(Boolean).join('\r\n');
}

export async function createGoogleDraft(accessToken, { to = [], cc = [], bcc = [], subject = '', body = '' }) {
  const mime = buildMimeMessage({ to, cc, bcc, subject, body });
  return googleApiRequest(GOOGLE_GMAIL_DRAFTS_URL, accessToken, {
    method: 'POST',
    body: {
      message: {
        raw: toBase64Url(mime)
      }
    }
  });
}

export async function sendGoogleMessage(accessToken, { to = [], cc = [], bcc = [], subject = '', body = '' }) {
  const mime = buildMimeMessage({ to, cc, bcc, subject, body });
  return googleApiRequest(GOOGLE_GMAIL_SEND_URL, accessToken, {
    method: 'POST',
    body: {
      raw: toBase64Url(mime)
    }
  });
}
