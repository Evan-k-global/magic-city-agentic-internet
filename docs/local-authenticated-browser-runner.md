# Local Authenticated Browser Runner

The server Browser Helper can open public pages, search, and prepare unauthenticated handoffs. The local authenticated runner is the real checkout/account unlock: it runs on the user's device and uses a local Chrome profile.

## Product Ladder

Magic City should stay useful before the native runner is installed, then let users climb into stronger local execution only when they need it.

1. No install: Magic City uses the fast Fly/server path for public prep and hands off when login, checkout, payment, vault, or device state is required.
2. Local runner installed: a local browser plugin can claim Magic Internet Helper sessions and use the user's browser profile, cookies, autofill, wallet prompts, and local approval surfaces.
3. Local runner plus trusted under-cap policy: Magic City can continue through routine browser actions inside a mission-bound policy and pauses for hard auth, payment sheets, out-of-policy changes, or final approval rules.

The native runner is a Magic City-owned execution boundary. It should not be forced into SantaClawz agents; for SantaClawz, Magic City only needs an orchestration receipt proving it routed, hired, and paid within the user-approved mission.

## Architecture

- Magic City queues a browser session with `preferredExecutionAgentId: local-authenticated-browser-plugin`.
- The browser extension stores the device runner token locally, registers the Magic Internet Helper plugin, and polls Magic City for that session.
- The runner connects to local Chrome through Chrome DevTools Protocol or launches a dedicated local user-data directory.
- Browser cookies, logged-in sessions, password manager prompts, autofill, Apple Pay/Google Pay surfaces, and payment challenges stay local.
- Magic City receives only checkpoints, URL state, screenshots when available, artifacts, receipt hashes, and proof metadata.
- The runner registers as a plugin (`local-authenticated-browser-plugin`) and signs mission checkpoint proof-of-possession events with a runtime holder key.

## Settings UX

The Magic City settings panel exposes a small **Local Runner** section near the bottom:

- **Pair browser extension** creates a short-lived pairing code. This does not expose a device token to the web page.
- **Install** opens the staging extension setup page. In public release this should become the Chrome Web Store/enterprise install page.
- The Magic City Runner extension redeems that code, receives the per-device token, stores it in extension storage, registers the plugin, and polls for Magic Internet Helper work.
- **Check status** verifies that the extension has checked in.
- **Advanced** contains trusted under-cap mode, rotate token, remove runner, and the internal developer command fallback.

The device token uses `MAGIC_CITY_NATIVE_RUNNER_TOKEN` semantics, not a broad `PUBLIC_API_KEYS` entry. It is bound to the signed-in user, native browser plugin ID, and device registration. In the normal extension flow, the page only sees a pairing code; the extension receives and stores the token after redemption.

## Extension Pairing

1. User clicks **Install** and installs/opens the Magic City Runner extension.
2. User clicks **Pair** in Settings.
3. Magic City calls `POST /native-runner/extension/pairing/start` and returns a short-lived one-use code.
4. The extension calls `POST /native-runner/extension/pairing/claim` with the code.
5. Magic City creates the native runner device and returns the device token only to the extension response.
6. The extension calls `/plugins/register` and polls `/connectors/sessions` with the bearer token.

The staging extension package lives at `public/native-runner/extension/` and is documented in `native-runner/extension/README.md`. Public release should ship it as a signed Chrome Web Store/enterprise extension so average users never need terminal commands.

## Chrome DevTools Mode

This path is now an Advanced developer fallback for staging and debugging.

Start Chrome with a DevTools endpoint:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222
```

Then run:

```bash
MAGIC_CITY_BASE_URL=https://magic-city-staging.fly.dev \
MAGIC_CITY_NATIVE_RUNNER_TOKEN=<device-token> \
MAGIC_CITY_BROWSER_CDP_URL=http://127.0.0.1:9222 \
npm run start:local-auth-browser
```

This attaches to the existing Chrome profile exposed through the DevTools endpoint. If Chrome was not launched with remote debugging, the runner cannot attach to it.

## Dedicated Local Profile Mode

For safer testing, use a separate local profile and sign into merchants once:

```bash
MAGIC_CITY_BASE_URL=https://magic-city-staging.fly.dev \
MAGIC_CITY_NATIVE_RUNNER_TOKEN=<device-token> \
MAGIC_CITY_BROWSER_USER_DATA_DIR="$HOME/.magic-city/browser-profile" \
npm run start:local-auth-browser
```

This avoids touching the user's main Chrome profile while still preserving cookies between runs.

## Boundaries

- The runner does not store passwords.
- The runner does not send raw card number, CVV, MFA codes, wallet keys, or payment sheet contents to Magic City.
- Payment profile in Magic City remains label/last4/billing hint and mission policy.
- Final submit behavior is controlled by the mission policy and local device/user approval.

## Server-First, Local-Next

The intended two-stage model:

1. Server worker does public search and option prep when no account state is required.
2. Local runner takes over for logged-in state, cart continuity, autofill, payment sheets, and receipt capture.

For account/cart/checkout tasks, Magic City should prefer the local runner from the start so a Fly worker does not claim the session first.

## Native Runner Token

The native runner path uses short-lived, per-device credentials:

- User signs in and starts extension pairing.
- Magic City creates a short-lived pairing code without exposing a runner token to the page.
- The extension redeems the code once; Magic City then creates a device-scoped runner token with allowed plugin ID, owner agent ID, user binding, requester hash, expiry, and status.
- The local runner sends the token as `Authorization: Bearer <device-token>`.
- `/plugins/register`, `/connectors/sessions`, `/connectors/sessions/:id/claim`, checkpoint, and fulfillment endpoints accept the native token only for authorized Magic Internet Helper sessions owned by that user.
- `/native-runner/rotate` replaces the token hash for a paired device.
- `/native-runner/revoke` marks the device as revoked so the old token no longer lists, claims, checkpoints, or fulfills.
- Broad `PUBLIC_API_KEYS` remain for internal service/admin integrations, not the public native runner install flow.

## Production Guardrails

- Production/Fly deployments must use database-backed state for `nativeRunnerDevices`; file-backed `data/state.json` is only acceptable for local/single-instance development.
- Set `MAGIC_CITY_REQUIRE_PRODUCTION_PERSISTENCE=true` in Fly/prod. The server refuses startup unless `DATABASE_URL` is configured and `/health` reports a Postgres-backed store.
- Run `npm run check:native-runner-production` against staging/prod before public release.
- Run `npm run test:native-runner-security` in CI. It verifies cross-user isolation, plugin mismatch denial, session mismatch denial, revoked/expired token denial, and unsigned checkpoint denial.
- Run `npm run test:native-runner-extension-pairing` in CI. It verifies code start does not leak a token, extension claim creates the device, replay is denied, and the claimed token can register/poll.
- Run `npm run smoke:native-runner-production` against staging for the full token mint -> plugin register -> session list -> claim -> signed checkpoint -> fulfill -> MBA receipt -> proof/anchor preparation path.
- Use `MAGIC_CITY_SMOKE_SUBMIT_ANCHOR=true npm run smoke:native-runner-production` only when the funded MBA/Zeko relayer path should accept a live anchor submission.
- Native runner activity is recorded under the `native_runner` connector activity provider for creation, rotation, revocation, polling, registration, claim, checkpoint, fulfillment, and denied access events.

## Signed Distribution

The command-copy flow is still useful for internal testing. Public release should use signed distribution:

- signed Chrome Web Store/enterprise browser extension as the primary flow
- optional signed/notarized native-host bundle only when OS-level capabilities are required
- token stored in extension storage or Keychain/native secure storage depending on package
- Settings-managed revoke/rotate
- no raw token embedded in plist, shell history, page localStorage, or shared docs
