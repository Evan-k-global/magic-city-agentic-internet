# Enterprise security remediation — 2026-09-26

Scope: practical safeguards in the reusable codebase. No new hosted service,
consumer UI redesign, Runner release, real payment, purchase, or chain
transaction. This patch follows `0343e76` and preserves the preceding deployment
and account-security hardening. Tests use synthetic accounts and isolated data.

## Closed in code

| Finding | Correction |
| --- | --- |
| Requester impersonation | Production intents cannot reserve credits using an unauthenticated email or an anonymous nonzero budget. Authenticated requester identity must match. |
| Privileged mutations | Attestation, slash and dispute resolution require operator authorization. Demo faucet/stake minting is disabled in production, including for operators. |
| Private-record aliases | Billing, ACP intent aliases and agent receipt lists enforce authentication and ownership. Receipt owners may open disputes; caller-supplied actor names do not grant authority. |
| Unpaid or altered Stripe completion | Persist immutable checkout terms before returning the checkout URL. Both webhook and browser-return reconciliation require matching owner, amount, currency, mode and metadata plus paid, complete status. Connect events cannot credit the platform ledger. |
| Duplicate credits | Existing session/event accounting is retained; concurrent completion and async-payment events plus browser return credit the same purchase exactly once. |
| Vulnerable dependencies | Pin ethers 6.17.0 (ws 8.21.0) and SheetJS 0.20.3, with lockfile integrity. Production npm audit returns zero known advisories at this check. |
| Secret packaging | Remove Docker's `COPY env ./env`; exclude env files/directories, private-key files, git data and local audit artifacts from the build context. |

SheetJS comes from its [official Node installation distribution](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/),
not the stale npm `xlsx` release. The archive is pinned in package-lock.json.
Dependency scanning alone does not prove absence of exploitable vulnerabilities.

## Verification

- All **13 original negative security checks pass**, plus five protected-route
  controls and legitimate-owner/cross-account assertions, using real disposable
  PostgreSQL with the production profile. Concurrency, restart and outage tests
  in that integration suite also pass.
- Mock-provider HTTP tests cover Stripe paid/unpaid, changed terms, wrong owner,
  connected-account events, concurrent completion, browser-return replay and
  exactly-once crediting. EVM transfer checks and account lifecycle tests pass.
- **20 focused suites pass**: account/payment, deployment, Runner security and
  pairing, mission boundaries, card reconciliation, final review, terminal
  state, checkout receipts, approval idempotency, persistence, SantaClawz credit
  lifecycle and integration policy, refunds, selection provider/revalidation,
  artifact privacy, custom-helper model/privacy and SDK API.
- Complete packaged browser matrix: **41/41**, plus active-port recovery in
  isolation. The previously intermittent recovery fixture now resets stale
  mission state and asserts that the real resume alarm is armed before stopping
  the worker. No timeout was increased and no Runner behavior was changed.
- Background-anchor, registry-signature, network-split, custom-helper packaging
  and pairing/claim/checkpoint smoke tests pass. Chain/provider fixtures are
  simulated; these are not live settlement proofs.
- XLSX export/import and wallet-signature compatibility checks pass. Clean
  dependency installation and `npm audit --omit=dev` pass.

Useful commands (the PostgreSQL suite needs an installed local PostgreSQL):

```sh
npm ci --ignore-scripts
npm run test:release-security
node scripts/test-account-payment-security-http.mjs
TEST_POSTGRES_BIN=/path/to/postgresql/bin npm run test:release-route-authorization
npm run test:native-runner-active-port-recovery
node scripts/smoke-native-runner-extension-browser.mjs
npm audit --omit=dev
```

## Operator checks before deployment

1. Follow [production-security.md](production-security.md). Explicitly enable
   `DEPLOYMENT_PROFILE=production`; `NODE_ENV` alone is not sufficient. Configure
   existing Postgres, independent secrets, TLS/proxy and verified administrator
   account IDs. The code cannot operate or secure a customer's infrastructure
   on their behalf. Preserve existing encryption and identity keys during
   migration; do not rotate them blindly.
2. **Drain or reconcile outstanding Stripe checkouts before upgrading.** Old
   sessions do not have the new saved checkout terms and are intentionally not
   credited from metadata alone. Reconcile any already-paid session against the
   provider and existing ledger under operator control; do not ask a customer
   to pay again or disable the terms check. Newly prepared sessions work with
   the existing Stripe account; no additional payment service is required.
3. Update API clients to authenticate owner routes and use operator credentials
   only from trusted backend code. Demo faucet/stake endpoints are not production
   funding mechanisms. Do not expose the admin token in a frontend or extension.
4. Build the final image and inspect its layers/context for credentials, then
   smoke-test that exact image in the intended deployment configuration. Local
   Docker was unavailable, so actual image-layer inspection was **not done**.
   Secret filename exclusions do not detect arbitrarily named secret files.
5. Smoke-test real login/callbacks and an approved test-mode payment. Tests here
   do not establish live DNS, provider, webhook or infrastructure correctness.

These known findings are fixed at source/test level. This is not a blanket
enterprise certification or a promise of zero data, funding, authorization or
MEV risk. In particular, simulated chain tests cannot establish protection from
all live ordering/reorg/settlement risks. The standard Runner, selectors, cart,
checkout and mission-authorization policy are unchanged by this remediation.
