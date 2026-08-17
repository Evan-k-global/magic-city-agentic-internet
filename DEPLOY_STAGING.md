## Staging Deploy

Current staging host:

- `https://magic-city-staging.fly.dev`

Webhook endpoint:

- `https://magic-city-staging.fly.dev/billing/stripe/webhook`

This repo is prepared for a Fly.io staging deploy via [fly.toml](/Users/evankereiakes/Documents/Codex/agent-verification/fly.toml).

### 1. Install Fly CLI

```bash
brew install flyctl
fly auth login
```

### 2. Create the staging app

```bash
cd /Users/evankereiakes/Documents/Codex/agent-verification
fly apps create magic-city-staging
```

### 3. Create a persistent volume

```bash
fly volumes create magic_city_data --region sjc --size 1 --app magic-city-staging
```

### 4. Set staging secrets

Use Stripe live keys only if you intentionally want live charges. For safer staging, prefer Stripe test keys and Square sandbox.

Generate a Mission-Bound Auth issuer key once per environment. This enables
`/.well-known/mission-authority-jwks.json` and third-party-verifiable capability
signatures.

```bash
MBA_ISSUER_KEY="$(node --input-type=module -e "import crypto from 'node:crypto'; const { privateKey } = crypto.generateKeyPairSync('ed25519'); process.stdout.write(Buffer.from(privateKey.export({ format: 'pem', type: 'pkcs8' }), 'utf8').toString('base64'));")"
```

```bash
fly secrets set \
  MISSION_BOUND_AUTH_SECRET='replace-me' \
  MISSION_BOUND_AUTH_ED25519_PRIVATE_KEY="$MBA_ISSUER_KEY" \
  STRIPE_SECRET_KEY='...' \
  STRIPE_PUBLISHABLE_KEY='...' \
  STRIPE_WEBHOOK_SECRET='<stripe-webhook-secret>' \
  SQUARE_ENV='sandbox' \
  SQUARE_APP_ID='sandbox-sq0idb-7nCQSs0cONP4mp-vvFfwQw' \
  SQUARE_ACCESS_TOKEN='<square-sandbox-access-token>' \
  SQUARE_LOCATION_ID='LQMV3PJ2T1RSE' \
  CREDITS_PER_USD='1000' \
  DEFAULT_TOPUP_CREDITS='25000' \
  PRIVACY_SALT='replace-me' \
  ADMIN_TOKEN='replace-me' \
  RELAYER_TOKEN='replace-me' \
  --app magic-city-staging
```

If you want Square production later, switch to:

```bash
fly secrets set \
  SQUARE_ENV='production' \
  SQUARE_APP_ID='sq0idp-rlnz4JxSAV-3j5qe86AQQw' \
  SQUARE_ACCESS_TOKEN='<square-production-access-token>' \
  SQUARE_LOCATION_ID='LERARCYR6WF97' \
  --app magic-city-staging
```

### 5. Deploy

```bash
fly deploy --remote-only
```

### 6. Optional custom domain

```bash
fly certs add staging.magic.city --app magic-city-staging
```

Only do this if you actually own `magic.city` and want `staging.magic.city`.

### 7. Smoke test

```bash
curl https://magic-city-staging.fly.dev/health
curl https://magic-city-staging.fly.dev/billing/stripe/config
curl https://magic-city-staging.fly.dev/billing/square/config
```

Expected:

- `/health` returns `status: ok`
- Stripe config shows publishable key present
- Square config shows `configured: true` and `locationIdConfigured: true`
