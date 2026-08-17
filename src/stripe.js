import crypto from 'node:crypto';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const CREDITS_PER_USD = Math.max(1, Number(process.env.CREDITS_PER_USD ?? 100));

export function creditsToUsdCents(amountCredits) {
  const numericCredits = Number(amountCredits || 0);
  if (!Number.isFinite(numericCredits) || numericCredits <= 0) return 0;
  return Math.max(1, Math.round((numericCredits * 100) / CREDITS_PER_USD));
}

function getStripeSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key) throw new Error('stripe_not_configured');
  return key;
}

function encodeForm(obj, prefix = '') {
  const params = new URLSearchParams();
  const append = (key, value) => {
    if (value === undefined || value === null) return;
    params.append(key, String(value));
  };

  const walk = (value, keyPath) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, idx) => walk(item, `${keyPath}[${idx}]`));
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        walk(v, keyPath ? `${keyPath}[${k}]` : k);
      }
      return;
    }
    append(keyPath, value);
  };

  walk(obj, prefix);
  return params.toString();
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function stripeRequest(path, payload = {}, options = {}) {
  const secret = getStripeSecretKey();
  const body = encodeForm(payload);
  const headers = {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  if (options.stripeAccount) {
    headers['Stripe-Account'] = options.stripeAccount;
  }

  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: options.method ?? 'POST',
    headers,
    body
  });
  const text = await res.text();
  const data = safeJsonParse(text);
  if (!res.ok) {
    const msg = data?.error?.message ?? `stripe_request_failed:${res.status}`;
    const err = new Error(msg);
    err.statusCode = 502;
    err.details = data;
    throw err;
  }
  return data;
}

export async function createCheckoutSession({ requesterId, amountCredits, successUrl, cancelUrl }) {
  const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
  const unitAmount = creditsToUsdCents(amountCredits);

  const payload = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    'line_items': [
      {
        price_data: {
          currency,
          product_data: {
            name: 'Magic City Credits',
            description: `${Number(amountCredits).toLocaleString()} credits`
          },
          unit_amount: unitAmount
        },
        quantity: 1
      }
    ],
    metadata: {
      requesterId,
      amountCredits: String(amountCredits)
    },
    payment_intent_data: {
      metadata: {
        requesterId,
        amountCredits: String(amountCredits)
      }
    }
  };

  return stripeRequest('/checkout/sessions', payload, {
    idempotencyKey: `checkout_${requesterId}_${amountCredits}_${Date.now()}`
  });
}

export async function getCheckoutSession(sessionId) {
  const secret = getStripeSecretKey();
  const res = await fetch(`${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secret}`
    }
  });
  const text = await res.text();
  const data = safeJsonParse(text);
  if (!res.ok) {
    const msg = data?.error?.message ?? `stripe_request_failed:${res.status}`;
    const err = new Error(msg);
    err.statusCode = 502;
    err.details = data;
    throw err;
  }
  return data;
}

export async function createConnectTransfer({ payoutRequestId, destinationAccount, amountCredits, rail }) {
  const currency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
  const amount = creditsToUsdCents(amountCredits);

  return stripeRequest('/transfers', {
    amount,
    currency,
    destination: destinationAccount,
    metadata: {
      payoutRequestId,
      rail,
      amountCredits: String(amountCredits)
    }
  }, {
    idempotencyKey: `payout_${payoutRequestId}`
  });
}

export async function createConnectAccount({ email, country = 'US' }) {
  return stripeRequest('/accounts', {
    type: 'express',
    country,
    email,
    capabilities: {
      transfers: { requested: true }
    }
  }, {
    idempotencyKey: `acct_${email}_${country}`
  });
}

export async function createConnectAccountLink({ accountId, refreshUrl, returnUrl }) {
  return stripeRequest('/account_links', {
    account: accountId,
    type: 'account_onboarding',
    refresh_url: refreshUrl,
    return_url: returnUrl
  }, {
    idempotencyKey: `acctlink_${accountId}_${Date.now()}`
  });
}

function secureEqualHex(a, b) {
  const aBuf = Buffer.from(a, 'hex');
  const bBuf = Buffer.from(b, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function parseStripeSignature(headerValue) {
  const out = { t: null, v1: [] };
  const parts = String(headerValue || '').split(',');
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (!k || !v) continue;
    if (k === 't') out.t = v;
    if (k === 'v1') out.v1.push(v);
  }
  return out;
}

export function verifyStripeWebhookSignature(rawBody, signatureHeader, secretOverride = null) {
  const secret = secretOverride || process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret) {
    throw new Error('stripe_webhook_secret_not_configured');
  }

  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed.t || parsed.v1.length === 0) {
    throw new Error('invalid_stripe_signature_header');
  }

  const signedPayload = `${parsed.t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  const ok = parsed.v1.some((sig) => secureEqualHex(expected, sig));
  if (!ok) {
    throw new Error('stripe_signature_verification_failed');
  }

  const tolerance = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS ?? 300);
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(parsed.t));
  if (age > tolerance) {
    throw new Error('stripe_signature_too_old');
  }
  return true;
}
