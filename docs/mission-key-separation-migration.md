# Mission key separation without signing users out

This transition affects **Magic City only**, not the x402 or SantaClawz services.
It does not change the standard Runner, signed action schema, selectors,
checkout policy, Ed25519 authority key or chain contracts.

## What stays unchanged

- Keep Google/GitHub connector secrets and OAuth client credentials unchanged.
  They encrypt stored connector tokens and sign provider callback state.
- Keep the state-encryption key and identifier salt unchanged.
- Keep the Ed25519 mission-signing key unchanged.
- Preserve browser-session, MCP authorization-code, access-token and refresh-token
  records. They use opaque tokens stored by hash; they are **not** HMAC-signed
  with `MCP_OAUTH_SECRET`. Changing that configuration value does not revoke them.
- Existing expiry, refresh rotation/reuse detection, ownership, domain, action,
  proof-of-possession and checkout enforcement remain in effect.

## New mission signing and finite legacy acceptance

Generate independent random values for `MISSION_BOUND_AUTH_SECRET` and
`MCP_OAUTH_SECRET` (at least 32 random bytes each). Do not derive them from the
old shared Google key. All newly issued mission tokens use only the new mission
key; the old key is verification-only during a bounded transition.

Legacy acceptance requires **all** of:

1. A valid signature from the explicitly configured legacy key.
2. SHA-256 of the exact complete token in an operator-frozen allowlist.
3. Issuance no later than cutover, and its original expiry still in the future.
4. Time within the fixed migration window, at most 24 hours after cutover.
5. All existing verifier and runtime policy checks.

Knowing the old shared key is insufficient to mint another accepted mission,
backdate one, modify a budget, extend expiry or broaden permissions. An altered
token has a different hash. No request can populate or expand this allowlist.
New tokens never use the legacy key. Expired migration configuration does not
prevent a restart; it simply no longer accepts legacy tokens.

Configuration (all four fields required together, or omit all four):

```text
MISSION_BOUND_AUTH_LEGACY_SECRET=<existing effective mission HMAC key>
MISSION_BOUND_AUTH_LEGACY_TOKEN_SHA256=<comma-separated exact token SHA-256 hashes>
MISSION_BOUND_AUTH_LEGACY_CUTOVER_AT=<fixed ISO timestamp>
MISSION_BOUND_AUTH_LEGACY_ACCEPT_UNTIL=<latest included expiry, <= cutover + 24h>
```

`buildMissionTransitionManifest(tokens, oldKey, cutoverTime)` in
`src/missionKeyTransition.js` verifies source signatures, excludes expired tokens,
deduplicates hashes and returns only hashes/timestamps. It refuses malformed,
future-issued, excessively long-lived or more than 256 active tokens. It does
not read production state, retrieve secrets, write configuration or deploy.

## Operator cutover

1. Retain a recoverable encrypted backup and record the live image/configuration.
   Inventory old **effective** keys, including historical fallback values,
   without logging them. Move required image-backed credentials into deployment
   secrets unchanged before excluding env files from the image.
2. Establish a quiet issuance window. Capture every still-valid token that must
   survive from authoritative server records. Some standalone capabilities are
   returned without retaining the token in server state: drain their lifetime,
   or collect them from an authenticated authoritative issuance record. Do not
   claim zero interruption based on a scan of stored sessions alone. Do not
   accept client-supplied tokens as additions to the migration allowlist.
3. Create the manifest from that frozen inventory and validate every source
   token. No new old-key tokens may be issued after the snapshot. If issuance
   continued, stop and recapture; do not quietly omit active missions. With no
   surviving tokens, omit all legacy fields rather than configure an empty list.
4. Generate the two independent new secrets and stage them together with the
   manifest, legacy secret and remaining validated production configuration.
   Use a secrets manager/stdin pipeline, not command-line secret literals,
   logs, git, plaintext artifacts or a frontend bundle.
5. Deploy the transition-aware server and matching configuration together.
   Never activate the new mission key on an old server that lacks legacy
   verification. Run production preflight with the actual effective settings;
   do not bypass independent-key validation to get a deployment through.
6. Verify existing browser/MCP sessions, old allowlisted mission tokens and new
   mission issuance. Verify changed/unknown old-key tokens are rejected. Check
   login callbacks, pairing and normal mission operations without a purchase.
7. After the fixed deadline and completion of old missions, remove the four
   legacy settings. Keep the new primary keys. This does not invalidate current
   browser/MCP sessions. Do not extend the deadline on every restart.

Rollback must use a **transition-aware** image and preserve the current primary
keys and manifest until its fixed expiry. Rolling back to the old shared-key
configuration would invalidate new missions and undo separation. It is not a
safe automatic rollback. Do not delete or rewrite session records as recovery.

Canonical origin, verified administrator IDs, actual proxy topology, existing
Stripe checkouts and the final image remain independent deployment prerequisites.
This code is a bounded migration mechanism, not automatic production activation.

## Fly/PostgreSQL pooler compatibility

The limiter no longer sends `statement_timeout` in startup parameters. Each
operation acquires a pooled client, starts a transaction, applies
`SET LOCAL statement_timeout = '2000ms'`, executes and commits. PgBouncer pins the
backend for that transaction. Failed/uncertain clients are destroyed instead of
returned to the pool; connection and client query deadlines remain bounded.
The setting cannot leak to another request. Existing atomic counters and
fail-closed behavior are retained. This adds transaction round trips to
rate-limited requests, not model calls or browser steps.

## Evidence

- Unit tests: exact allowlist, changed/backdated authority, expired/future-issued
  tokens, fixed deadline, malformed configuration and primary-only new signing.
- HTTP restart test: token issued before cutover still verifies afterward;
  old browser/MCP sessions survive, refresh works, altered old-key authority is
  rejected, domain/action checks still apply, new tokens survive legacy removal.
  A Google callback started before cutover still passes state/binding verification
  afterward (provider mocked; no live sign-in or token refresh performed).
- Disposable PostgreSQL: slow-query cancellation, timeout isolation, recovery,
  concurrent counters, restart persistence, outage fail-closed, and the 13
  release-security probes plus protected-route/ownership controls pass.
- Read-only check through the actual Fly database pooler: the exact wrapper
  succeeds, the 2-second server timeout cancels a slow SELECT, and the next
  transaction succeeds. No production table or record was changed by that test.
- Full packaged browser matrix: **41/41 passed**, including active-port restart
  recovery. Account/payment HTTP, deployment, mission-boundary, Runner security
  and SDK API regressions also pass. Standard Runner source is unchanged.

```sh
npm run test:mission-key-transition
npm run test:mission-key-transition-http
TEST_POSTGRES_BIN=/path/to/postgresql/bin npm run test:release-route-authorization
node scripts/test-account-payment-security-http.mjs
node scripts/test-mission-boundary.mjs
```
