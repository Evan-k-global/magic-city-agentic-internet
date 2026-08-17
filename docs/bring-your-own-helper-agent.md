# Bring Your Own Magic City Helper

Magic City ships a default Magic Internet Agent runner, but the browser-helper
surface is intentionally pluggable. A custom helper can improve site-specific
automation while Magic City keeps the mission authority, policy checks, receipt
format, and Zeko/MBA proof trail.

The rule is simple:

- Magic City sends mission-scoped plans and verifies the proof trail.
- The helper executes locally in the user's browser/profile.
- Private page data, cookies, credentials, full card data, MFA, and vault values
  stay local.
- The helper emits redacted, holder-signed boundary events.
- Magic City turns those events into receipts and compact on-chain proof anchors.

## Lifecycle

1. A signed-in user starts custom helper pairing on Magic City:

   `POST /native-runner/helper/pairing/start`

   ```json
   {
     "pluginId": "acme-shopping-helper",
     "ownerAgentId": "acme-shopping-agent",
     "label": "Acme Shopping Helper",
     "trustMode": "trusted_under_cap",
     "useExistingBrowser": true
   }
   ```

2. Magic City returns a short-lived pairing code.

3. The helper extension claims the code:

   `POST /native-runner/extension/pairing/claim`

4. Magic City returns a per-device token scoped only to that helper's
   `pluginId` and `ownerAgentId`.

5. The helper registers itself:

   `POST /plugins/register`

   Required shape:

   ```json
   {
     "pluginId": "acme-shopping-helper",
     "ownerAgentId": "acme-shopping-agent",
     "kind": "browser",
     "endpoint": "chrome-extension://<extension-id>",
     "executionAgent": true,
     "capabilities": [
       "browser-worker-agent",
       "browser.extension_dom_executor",
       "browser.prepare_cart",
       "browser.open_checkout",
       "browser.pause_before_sensitive_action"
     ],
     "privacyModes": ["local-private", "private"],
     "metadata": {
       "customHelperAgent": true,
       "executionBackend": "extension_dom_executor",
       "runnerProtocol": "declarative-v1",
       "proofMode": "mission-bound-auth-holder-signatures"
     }
   }
   ```

6. The helper polls for sessions with its bearer token.

7. For each session, it claims with a runtime holder public key, then executes
   only the server-issued `magic-city-browser-plan-v1`.

8. Each meaningful boundary emits:

   - `pluginId`
   - `missionAction`
   - `targetUrl` or redacted browser URL
   - `planHash`
   - ordered `planActionId`
   - redacted page/checkpoint summary
   - proof-of-possession signed by the holder key

9. Fulfillment sends either:

   - `status: "fulfilled"` with `fundingDisposition: "hold"` when the browser is
     prepared and waiting for the user's final local approval, or
   - `status: "failed"` with `fundingDisposition: "release"` when the helper
     cannot safely continue.

## What The Helper Must Never Send

- Passwords, MFA codes, cookies, session tokens, localStorage dumps, or page HTML.
- Full card numbers, CVV/CVC, raw payment-sheet contents, or raw wallet secrets.
- Full Local Data Vault values unless the user explicitly typed them into a site
  and the value is already non-sensitive enough for a redacted receipt.
- Arbitrary screenshots by default. If screenshots are needed, redact locally and
  attach only hashes or cropped public evidence.
- Remote code, model-supplied JavaScript, `eval`, or selector programs from Magic
  City. Plans are declarative data only.

## Required Proof Contract

Custom helpers do not need to submit directly to Zeko. They need to produce a
clean proof trail that Magic City can anchor.

Each checkpoint proof signs this stable payload:

```json
{
  "schema": "magic-city-mission-pop-v1",
  "capabilityId": "<session.missionBoundAuth.capabilityId>",
  "capabilityHash": "<session.missionBoundAuth.tokenHash>",
  "action": "<normalized mission action>",
  "targetDomain": "<domain>",
  "nonce": "<random base64url nonce>",
  "previousHash": "<session.missionBoundaryLatestHash or null>",
  "audience": "<session.missionBoundAuth.audience>",
  "sessionId": "<session id>"
}
```

Magic City verifies the holder signature, chains the boundary hash, includes the
plan binding, creates the receipt, and anchors compact public proof inputs via
the relayer/zkApp path. Private inputs remain local.

## Starter Package

Use `examples/custom-helper-extension-starter` as the base package. It includes:

- MV3 manifest.
- Pairing popup.
- Scoped helper registration.
- Ed25519 holder-key generation.
- Proof-of-possession signing.
- Session polling/claim/checkpoint/fulfill skeleton.

The starter intentionally does not contain advanced browsing intelligence. Add
site logic behind the existing plan executor boundary. Keep the public protocol
surface small and stable.

Package and smoke-test the starter before you submit anything:

```bash
npm run package:custom-helper-extension
npm run smoke:custom-helper-extension-package
```

The release smoke loads the packaged zip in Chromium, pairs it to a local Magic
City server, registers the custom helper, starts a mission, and verifies a
holder-signed checkpoint. Do not submit a helper package that has only been
tested as a source folder.

Release kit docs:

- [Hello custom helper](custom-helper-hello-walkthrough.md)
- [Release checklist](custom-helper-release-checklist.md)
- [Privacy template](custom-helper-privacy-template.md)

## Compliance Checklist

Before shipping a custom helper:

- Pairing token is scoped to the helper's own `pluginId`.
- Helper cannot register or claim as Magic City's default runner.
- All actions map to the server-issued plan hash and ordered action ID.
- Every checkpoint has a valid holder signature.
- No private fields or raw HTML leave the browser.
- Login, CAPTCHA, payment authentication, and final purchase submit are hard
  stops unless the user is visibly approving locally.
- A packaged release artifact is tested, not only source files.
