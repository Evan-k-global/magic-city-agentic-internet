# Partner and White-Label Quickstart

Partners can reuse Magic City's existing boundaries without changing the
default Magic Internet Agent flow. There are three distinct integration paths.
Choose one; they are not successive setup steps.

## 1. Custom Helper Extension

Use this when the partner wants its own Chrome extension and browser logic but
will keep Magic City's control plane, mission authorization, policy checks and
receipts.

Start from `examples/custom-helper-extension-starter/`, which is separately
licensed under Apache-2.0. Configure these constants and files:

| Setting | Location | Partner value |
| --- | --- | --- |
| Control-plane URL | `DEFAULT_BASE_URL` in `background.js` and popup input | Partner or Magic City HTTPS origin |
| Helper identity | `HELPER_PLUGIN_ID` and `HELPER_OWNER_AGENT_ID` | Stable, unique, non-reserved IDs |
| Extension identity | `manifest.json` name, description and icons | Partner branding |
| Control-plane access | `manifest.json` `host_permissions` | Exact partner HTTPS origin |
| Merchant access | Optional host permissions requested at runtime | Only sites the user authorizes |

The existing handshake is:

1. A signed-in user requests `POST /native-runner/helper/pairing/start` with the
   helper IDs.
2. The extension redeems the one-use pairing code and stores its device-scoped
   token locally.
3. The helper registers its identity and capabilities.
4. The user starts a mission. Magic City explicitly dispatches it to the paired
   device and returns a short-lived `extensionRunDispatch.nonce` in the scoped
   queue response.
5. The helper claims that exact session with the nonce and its runtime holder
   public key.
6. The helper follows the signed declarative plan, emits holder-signed
   checkpoints and fulfills or pauses the existing session.

The starter deliberately ends with `starter_not_implemented`. Replace only
`executeSession()` with partner browser behavior. Keep the dispatch nonce,
plan hash, ordered action IDs, holder signatures, cancellation checks,
single-submit receipts and sensitive-data boundaries.

Package and test the actual artifact:

```bash
npm run package:custom-helper-extension
npm run smoke:custom-helper-extension-package
```

Passing this test proves pairing, explicit dispatch, claim, signed checkpoint
and terminal handoff. It does not prove that custom merchant automation is
complete.

## 2. Independently Hosted Magic City

Use this when the partner needs its own domain, database, users, signing keys,
branding and deployment. This is possible today, but it is an advanced source
deployment rather than a one-command white-label product.

Create new infrastructure and credentials. Never copy production users,
database contents, pairing tokens, extension tokens or private keys.

| Concern | Existing configuration point |
| --- | --- |
| Public service origin | `MAGIC_CITY_BASE_URL`, `MAGIC_CITY_PUBLIC_BASE_URL`, `HOST`, `PORT` |
| Durable state | `DATABASE_URL`, database TLS settings, `MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE` |
| State encryption | `MAGIC_CITY_REQUIRE_STATE_ENCRYPTION`, `MAGIC_CITY_STATE_ENCRYPTION_KEY` |
| Mission authorization | `MISSION_BOUND_AUTH_SECRET`, `MISSION_BOUND_AUTH_PUBLIC_KEY_ID`, `MISSION_BOUND_AUTH_ED25519_PRIVATE_KEY` |
| Administrative/API access | `ADMIN_TOKEN`, `PUBLIC_API_KEYS`, `PRIVACY_SALT` |
| Login/session scope | `AUTH_SESSION_COOKIE_DOMAIN`, public URL and provider callback settings |
| Extension origins | `manifest.json` host permissions, `externally_connectable`, and allowed origins in the extension controller |
| Branding | `public/index.html`, static assets, extension manifest, popup and icons |
| Optional services | SantaClawz, payment, proof and relayer feature flags and credentials |
| Zeko | GraphQL URL, network IDs, registry identity, isolated relayer URL and token |

Start optional integrations disabled. Enable only those with independently
provisioned credentials and passing health/capability checks. The current state
store requires a single writer; preserve that deployment constraint until the
documented persistence migration is complete.

Minimum clean-install acceptance:

- New domain, database, encryption key and signing namespace.
- New extension identity with only the new domain allow-listed.
- Pairing and registration use fresh credentials.
- Explicit dispatch, claim and first signed checkpoint succeed.
- Cancellation, terminal recovery and duplicate-submit protections pass.
- A deterministic harmless merchant fixture completes with no production API
  calls and no secrets in logs or returned session data.
- The packaged extension matches its tested source and has its own privacy and
  Chrome Web Store disclosures.

## 3. Embedded Merchant Integration

Use this when a merchant wants a branded shopping experience on its existing
website. The simplest long-term form is a frontend widget plus a merchant
backend adapter for catalog search, authoritative quotes, cart changes,
mission verification, idempotent order submission and receipts. A browser
extension is unnecessary when the merchant exposes those server APIs.

This repository contains useful mission schemas, SDK and verifier foundations,
but does not yet contain a turnkey drop-in merchant widget. Treat this as a
future integration product, not a documented production quickstart.

## What Stays Unchanged

None of these paths requires modifying Magic City's built-in Runner or Amazon
checkout flow. Partner helpers receive only sessions explicitly assigned to
their own plugin identity. The default Magic Internet Agent continues using its
existing pairing, dispatch, plan, proof and receipt contract.

## Licensing

The custom helper starter has its own Apache-2.0 license. The hosted Magic City
service, default Runner and protected protocol implementation use the licenses
and terms in `LICENSE`, `LICENSING.md`,
`LICENSES/ZEKO-ADDITIONAL-USE-GRANT.md`, `PRICING.md` and
`COMMERCIAL-TERMS.md`. White-label branding and independent deployment should
be confirmed against those controlling terms; the helper starter's license
does not extend to the rest of the repository.

## Related Documentation

- `docs/bring-your-own-helper-agent.md`
- `docs/custom-helper-hello-walkthrough.md`
- `docs/custom-helper-release-checklist.md`
- `docs/custom-helper-privacy-template.md`
- `docs/local-authenticated-browser-runner.md`
- `docs/production-persistence.md`
