import crypto from 'node:crypto';

function normalizeSquareMode(mode = '') {
  const value = String(mode || process.env.SQUARE_ENV || '').trim().toLowerCase();
  return ['live', 'production', 'prod', 'real'].includes(value) ? 'live' : 'sandbox';
}

const SQUARE_VERSION = process.env.SQUARE_VERSION || '2025-10-16';

function getSquareConfig(mode = '') {
  const normalizedMode = normalizeSquareMode(mode);
  const isLive = normalizedMode === 'live';
  const accessToken = String(
    isLive
      ? process.env.SQUARE_PRODUCTION_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN || ''
      : process.env.SQUARE_SANDBOX_ACCESS_TOKEN || process.env.SQUARE_ACCESS_TOKEN || ''
  ).trim();
  const locationId = String(
    isLive
      ? process.env.SQUARE_PRODUCTION_LOCATION_ID || process.env.SQUARE_LOCATION_ID || ''
      : process.env.SQUARE_SANDBOX_LOCATION_ID || process.env.SQUARE_LOCATION_ID || ''
  ).trim();
  const appId = String(
    isLive
      ? process.env.SQUARE_PRODUCTION_APP_ID || process.env.SQUARE_APP_ID || ''
      : process.env.SQUARE_SANDBOX_APP_ID || process.env.SQUARE_APP_ID || ''
  ).trim();
  return {
    mode: normalizedMode,
    apiBase: normalizedMode === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com',
    accessToken,
    locationId,
    appId
  };
}

function getSquareAccessToken(mode = '') {
  const key = getSquareConfig(mode).accessToken;
  if (!key) throw new Error('square_not_configured');
  return key;
}

function getSquareLocationId(locationId = '', mode = '') {
  const resolved = String(locationId || getSquareConfig(mode).locationId || '').trim();
  if (!resolved) throw new Error('square_location_not_configured');
  return resolved;
}

function toMoney(amountUsd, currency = 'USD') {
  const amount = Math.max(0, Math.round(Number(amountUsd || 0) * 100));
  return {
    amount,
    currency
  };
}

async function squareRequest(path, payload = null, options = {}) {
  const config = getSquareConfig(options.mode);
  const accessToken = getSquareAccessToken(options.mode);
  const res = await fetch(`${config.apiBase}${path}`, {
    method: options.method || (payload ? 'POST' : 'GET'),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: payload ? JSON.stringify(payload) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg =
      data?.errors?.[0]?.detail ||
      data?.errors?.[0]?.code ||
      `square_request_failed:${res.status}`;
    const err = new Error(msg);
    err.statusCode = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

function buildIdempotencyKey(prefix, sessionId) {
  return crypto.createHash('sha256').update(`${prefix}:${sessionId}:${Date.now()}`).digest('hex');
}

function normalizeLineItems(lineItems = []) {
  return lineItems
    .filter((row) => row && row.name && Number(row.quantity || 0) > 0 && Number(row.unitPriceUsd || 0) >= 0)
    .map((row) => ({
      name: String(row.name),
      quantity: String(Math.max(1, Number(row.quantity || 1))),
      base_price_money: toMoney(row.unitPriceUsd || 0),
      note: row.category ? String(row.category) : undefined
    }));
}

export function isSquareConfigured() {
  const sandbox = getSquareConfig('sandbox');
  const live = getSquareConfig('live');
  return Boolean(
    (sandbox.accessToken && sandbox.locationId) ||
    (live.accessToken && live.locationId)
  );
}

export function getSquareRuntimeConfig() {
  const sandbox = getSquareConfig('sandbox');
  const live = getSquareConfig('live');
  return {
    configured: Boolean((sandbox.accessToken && sandbox.locationId) || (live.accessToken && live.locationId)),
    defaultMode: normalizeSquareMode(),
    modes: {
      sandbox: {
        configured: Boolean(sandbox.accessToken && sandbox.locationId),
        appIdConfigured: Boolean(sandbox.appId),
        locationIdConfigured: Boolean(sandbox.locationId)
      },
      live: {
        configured: Boolean(live.accessToken && live.locationId),
        appIdConfigured: Boolean(live.appId),
        locationIdConfigured: Boolean(live.locationId)
      }
    }
  };
}

function toSquareBuyerAddress(address = {}) {
  if (!address || typeof address !== 'object') return undefined;
  const line1 = String(address.addressLine1 || address.streetAddress || '').trim();
  const postal = String(address.postalCode || address.zipCode || '').trim();
  const city = String(address.locality || '').trim();
  const state = String(address.administrativeDistrictLevel1 || '').trim();
  if (!line1 && !postal && !city && !state) return undefined;
  return {
    address_line_1: line1 || undefined,
    postal_code: postal || undefined,
    locality: city || undefined,
    administrative_district_level_1: state || undefined,
    country: String(address.country || 'US').trim() || 'US'
  };
}

function normalizeSquareBuyerPhone(phone = '') {
  const digits = String(phone || '').replace(/\D+/g, '');
  if (!digits) return undefined;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(phone).trim().startsWith('+') && digits.length >= 8) {
    return `+${digits}`;
  }
  return undefined;
}

function normalizeSquareBuyerEmail(email = '') {
  const trimmed = String(email || '').trim().toLowerCase();
  if (!trimmed) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return undefined;
  if (/(^|@)(example\.com|example\.org|example\.net)$/.test(trimmed)) return undefined;
  return trimmed;
}

export async function calculateSquareOrder({ mode, locationId, lineItems = [], note = '' }) {
  const normalized = normalizeLineItems(lineItems);
  const payload = {
    idempotency_key: buildIdempotencyKey(`square-calc:${normalizeSquareMode(mode)}`, locationId || 'default'),
    order: {
      location_id: getSquareLocationId(locationId, mode),
      line_items: normalized,
      note: note || undefined
    }
  };
  return squareRequest('/v2/orders/calculate', payload, { mode });
}

export async function createSquarePaymentLink({
  sessionId,
  mode,
  locationId,
  lineItems = [],
  restaurantName = '',
  note = '',
  redirectUrl = '',
  buyerEmail = '',
  buyerPhoneNumber = '',
  buyerAddress = null
}) {
  const normalized = normalizeLineItems(lineItems);
  const resolvedLocationId = getSquareLocationId(locationId, mode);
  const normalizedMode = normalizeSquareMode(mode);
  const squareBuyerAddress = toSquareBuyerAddress(buyerAddress);
  const squareBuyerPhone = normalizeSquareBuyerPhone(buyerPhoneNumber);
  const squareBuyerEmail = normalizeSquareBuyerEmail(buyerEmail);
  const payload = {
    idempotency_key: buildIdempotencyKey(`square-link:${normalizedMode}`, sessionId || resolvedLocationId),
    quick_pay: undefined,
    order: {
      location_id: resolvedLocationId,
      line_items: normalized,
      note: note || undefined
    },
    checkout_options: {
      redirect_url: redirectUrl || undefined,
      ask_for_shipping_address: Boolean(squareBuyerAddress)
    },
    pre_populated_data: {
      buyer_email: squareBuyerEmail,
      buyer_phone_number: squareBuyerPhone,
      buyer_address: squareBuyerAddress
    },
    description: restaurantName ? `Magic City order for ${restaurantName}` : 'Magic City order'
  };
  return squareRequest('/v2/online-checkout/payment-links', payload, { mode });
}

export async function retrieveSquarePaymentLink(paymentLinkId, options = {}) {
  if (!paymentLinkId) throw new Error('square_payment_link_id_required');
  return squareRequest(`/v2/online-checkout/payment-links/${encodeURIComponent(paymentLinkId)}`, null, { method: 'GET', mode: options.mode });
}

export async function retrieveSquareOrder(orderId, options = {}) {
  if (!orderId) throw new Error('square_order_id_required');
  return squareRequest(`/v2/orders/${encodeURIComponent(orderId)}`, null, { method: 'GET', mode: options.mode });
}
