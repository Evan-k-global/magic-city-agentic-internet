# Production security profile and migration

This is a deployment hardening layer, not an enterprise certification. The
standard Runner's selectors, checkout, mission authority and recovery are not
changed. The optional partner helper is versioned separately at 0.3.2.

## New deployments

Start from `.env.production.example`. Supply values through the deployment's
secret manager (or a private local `.env` for isolated testing), never a committed
file or frontend bundle. Run `npm run check:deployment-security` using that same
environment. Then start the service and check `/health`; the configuration check
does not contact the database or validate OAuth callbacks.

`DEPLOYMENT_PROFILE=production` is explicit. `NODE_ENV=production` alone is not
an opt-in. Omitting the profile retains compatibility with existing deployment
configuration, **not the production guarantees below**. Development defaults are
not appropriate for a publicly exposed service.

The production profile requires:

- One exact HTTPS `MAGIC_CITY_CANONICAL_ORIGIN`; no query, path or credentials.
- Postgres with required persistence, state encryption, artifact encryption and
  the existing single-writer lock enabled. Storage failures cannot fall back to
  local plaintext state or silently reset it.
- Independent strong secrets for admin, mission HMAC, MCP OAuth, identifier
  hashing and state encryption; a valid Ed25519 mission-signing key; nonempty
  strong service API keys. Length checks cannot prove entropy: generate secrets
  cryptographically and store them in a secret manager.
- Dedicated Google/GitHub connector encryption secrets for enabled connectors.
  Production no longer derives them from admin, Stripe or provider client keys.
- Postgres request limiting. Missing limiter storage rejects protected requests
  with 503 rather than allowing unlimited attempts.
- No insecure admin, local-IP admin, development password-reset links, automatic
  local free-credit topups or reset-on-read-error mode.

### Origin, proxy and browser policy

The canonical origin supplies public links, OAuth metadata and reset-link bases.
Untrusted `X-Forwarded-Host` is never used. `Host` must match the canonical host
or an exact additional `MAGIC_CITY_ALLOWED_HOSTS` entry (including port if any).
Add only internal health-check hosts you actually need. No wildcard host entries.

`MAGIC_CITY_TRUSTED_PROXY_CIDRS` defaults to none. List only actual controlled
proxy peer ranges; never internet-wide ranges. The resolver walks
`X-Forwarded-For` from the trusted peer backwards, stopping at the first untrusted
hop. Verify the real edge removes/rebuilds client-supplied forwarding headers.
Wrong proxy configuration can aggregate users under one IP and cause false rate
limits. Test the real topology before activation; broad private ranges are not
automatically trusted.

Canonical HTTPS yields Secure cookies and HSTS (`max-age=31536000`, no preload or
includeSubDomains). Terminate TLS at a controlled proxy and prevent direct public
HTTP access to the application port. The canonical setting is not TLS itself.

Responses enforce anti-framing, `nosniff`, no-referrer, base/object restrictions
and camera/geolocation restrictions. WebAuthn remains allowed for the same
origin. Inline script/style restrictions remain **report-only**, so existing
inline UI, OAuth, Stripe and Spotify flows are not intentionally blocked. There
is no remote CSP report collector in this patch; inspect browser violations and
inventory sources before a separately tested nonce-based CSP enforcement rollout.

To allow an embedding partner, set exact HTTPS `MAGIC_CITY_FRAME_ANCESTORS`.
This permits framing, not cross-origin API mutation or delegated authentication.
Cookie-bearing unsafe requests with a different Origin or `Sec-Fetch-Site:
cross-site` are rejected. Headerless non-browser clients retain their existing
authentication requirements. A full cross-origin embedded widget needs a
separate scoped delegation design, not a wildcard exception to this guard.

### Administrator migration

Production UI admins use `AUTH_ADMIN_USER_IDS`, a comma-separated list of
**existing account IDs whose ownership the operator has verified**. Public
signup accepts email text, so email/requester allowlists are not adequate proof
of admin identity. `LOCAL_ADMIN_EMAILS`, `LOCAL_ADMIN_REQUESTER_IDS` and local-IP
admin do not grant production UI privileges or local credit bypasses.

Provision and verify the intended account before enabling the profile; record
its stable ID and test login/admin access in the isolated deployment. Do not
guess future IDs or assume knowing an email proves ownership. Service admin
endpoints that already require `x-admin-token` retain that separate check. This
does not implement organizational roles, SSO provisioning or SCIM.

### Shared limiter storage

Existing per-route quotas remain in place. Postgres uses an atomic per-key update
with its own clock; independent limiter clients and restarts share the window.
Keys are SHA-256 hashes of bucket/IP/subject, not raw emails. These hashes are
pseudonymous, not guaranteed anonymous. Expired entries are removed in bounded
batches on traffic. Monitor table size and provision scheduled cleanup if idle
retention matters; hashing alone is not a retention policy.

Startup creates `magic_city_rate_limits` and its expiry index. A restricted DB
operator may provision the schema from `RATE_LIMIT_SCHEMA` in
`src/requestRateLimits.js` and set `MAGIC_CITY_RATE_LIMIT_SCHEMA_MANAGED=true`.
The runtime needs SELECT/INSERT/UPDATE/DELETE on that table. No transaction or
receipt snapshots are rewritten by rate-limit hits. Memory mode is for
development, bounded to 10,000 identities, and rejects capacity exhaustion.

Database calls have bounded pool/statement/query deadlines. Limiter failure
blocks only the already rate-limited routes; health and unrelated advisory
routes remain available. This is not an edge DDoS defense. Keep edge connection
and request-size limits. Shared limiting does **not** make the global application
snapshot multi-writer-safe: retain one application writer.

## Existing deployment: do not flip every setting at once

1. Record the working server/Runner versions. Back up encrypted state and
   artifacts with separately recoverable key material; prove restore in an
   isolated database. Do not import real user data into a public test instance.
2. Test this code with the current settings and deployed Runner. New security
   headers, untrusted-forwarded-header rejection, cross-site mutation rejection
   and the plugin auth fail-closed correction apply even without the profile.
   Verify health Host, HTTPS callbacks, cookies and proxy IP attribution first.
3. Inventory the **effective old keys** privately. Some old deployments derived
   Google/GitHub or MCP keys from other secrets. Never log them in the checklist.
   Do not replace the state key or identifier salt: doing so can lose decryption
   or identity/credit associations. Keep mission keys stable while missions run.
4. Stage independent connector/MCP keys. Existing connector token envelopes must
   be re-encrypted with a reviewed offline migration, or users must explicitly
   reconnect those connectors. **No automatic key migration is included here.**
   Changing only the environment key makes old tokens unreadable. Do not enable
   the profile on a reused-key installation until that migration is complete.
   Drain in-flight OAuth exchanges before rotating state-signing keys; test
   refresh and sign-in for both providers. Keep encrypted backups until verified.
5. Provision limiter storage, exact canonical/proxy/health settings and approved
   admin account IDs. Set mandatory flags and run the preflight. If legacy
   mission/MCP secrets were shared, use a reviewed key migration and quiet window;
   do not invalidate in-flight missions merely to pass the preflight.
6. Exercise registration/login/logout/reset, OAuth, vault/WebAuthn, pairing,
   dispatch/claim/checkpoint/cancel, and harmless selection in the target staging
   topology. Test wrong Host/Origin, spoofed proxy headers, limiter outages and
   restarts. Never use a paid purchase as the first test.
7. Deploy in a quiet window with one writer and rollback material retained.
   Confirm the same installed Runner still works. No Runner upload is needed
   for these server changes. Partner helper 0.3.2 is a separate artifact and
   intentionally requires new opt-in if its model privacy policy changes.

Rollback must preserve data/key compatibility. Reverting code cannot recover
lost encryption keys or restore tokens invalidated at an OAuth provider. Do not
delete limiter or state tables as a routine rollback.

## Verification commands

```sh
npm run test:deployment-security
npm run test:custom-helper-model-adapter
npm run test:custom-helper-extension-packaging
npm run smoke:custom-helper-extension-package
TEST_POSTGRES_BIN=/path/to/postgresql/bin npm run test:production-security-integration
```

The last test creates and tears down a fresh loopback-only database and fresh
test keys. It does not read the caller's production DATABASE_URL. A PostgreSQL
binary is a test prerequisite, not a new application dependency. Run the normal
Runner, pairing, mission-boundary, payment, recovery and UI regression suites as
well; an isolated test is not proof of an untested live merchant layout.
