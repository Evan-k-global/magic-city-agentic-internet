# Magic Web Actions Protocol v0

Draft surface for websites that want reliable agent interactions without forcing every agent to scrape human UI.

## Goals

- Let a site publish machine-readable search, product, cart, booking, auth, checkout, and receipt capabilities.
- Let a user delegate bounded authority to an agent without sharing raw passwords, card numbers, wallet keys, or MFA secrets with the remote service.
- Let an agent use the site safely: discover options, prepare a cart or form, pause at sensitive gates, and return receipts/proofs.
- Let the site verify mission-bound authorization, budgets, merchant allowlists, and stop rules before accepting agent actions.

## Discovery

Sites can publish one or more of:

- `/.well-known/magic-web-actions.json`
- `<link rel="agent-actions" type="application/json" href="/.well-known/magic-web-actions.json">`
- Schema.org `WebSite` + `SearchAction`
- OpenSearch description
- `llms.txt` for plain-language policy/context, not executable action

Magic City should read in this order:

1. Magic Web Actions manifest.
2. Schema.org `SearchAction` / OpenSearch.
3. Existing structured product/offer data.
4. Human browser UI.

## Manifest Shape

```json
{
  "schema": "magic-web-actions-v0",
  "site": "https://merchant.example",
  "name": "Merchant Example",
  "capabilities": {
    "search": {
      "method": "GET",
      "urlTemplate": "https://merchant.example/search?q={query}",
      "resultSchema": "ProductSearchResults"
    },
    "product": {
      "urlTemplate": "https://merchant.example/products/{productId}"
    },
    "cart": {
      "method": "POST",
      "endpoint": "https://merchant.example/agent/cart",
      "requiresMissionAuth": true
    },
    "checkout": {
      "mode": "local_payment_sheet",
      "stopBeforeFinalSubmit": true,
      "requiresUserPresence": ["new_login", "mfa", "captcha", "payment_challenge", "final_submit"]
    },
    "receipt": {
      "method": "GET",
      "endpoint": "https://merchant.example/agent/receipts/{orderId}",
      "hashFields": ["merchant", "orderId", "total", "currency", "createdAt"]
    }
  },
  "auth": {
    "accepts": ["mission-bound-auth-jwt", "oauth-dpop"],
    "audience": "merchant.example",
    "requiredClaims": ["mission_id", "merchant_allowlist", "max_total", "expires_at"]
  },
  "limits": {
    "supportsMaxSpend": true,
    "supportsMerchantAllowlist": true,
    "supportsNoRecurringBilling": true
  },
  "proofs": {
    "receiptHash": true,
    "screenshots": "optional",
    "zekoAnchor": "optional"
  }
}
```

## Mission-Bound Claims

A Magic City mission token should bind:

- Mission id.
- User id hash, not raw identity.
- Agent id.
- Merchant/domain allowlist.
- Max spend and currency.
- Stop rules.
- Payment profile label/last4 only, never raw card.
- Expiry.
- Nonce/replay protection.
- Receipt hash requirements.

## Stop Rules

The site or runner must pause for:

- New domain not covered by the mission.
- Total exceeds mission cap.
- Recurring billing, gift card, cash equivalent, financial service, or policy conflict.
- Login wall, password field, MFA, captcha, 3DS, CVV challenge, or payment sheet challenge.
- Final purchase/submit unless mission explicitly allows auto-submit under cap.
- Ambiguous item, ambiguous cancellation/refund terms, or low-confidence match.

## Product Model

- Website: publishes machine-readable actions and validates mission-bound auth.
- Magic City: mission authority, policy, queue, receipts, proof.
- Local runner: authenticated browser state, autofill/payment sheet, local device auth.
- Issuer/wallet: card authority and spend controls.
- Zeko/proof layer: receipt commitments and mission attestations.

## Why This Matters

Without this, agents must use human UI and brittle selectors. With it, a site can be agent-native while still preserving user control and merchant risk checks.
