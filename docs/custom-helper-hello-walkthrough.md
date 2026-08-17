# Hello Custom Helper

This walkthrough proves the smallest useful custom helper path:

pairing code -> scoped device token -> helper registration -> mission poll ->
claim -> holder-signed checkpoint -> fulfillment.

## 1. Pick Helper IDs

The starter uses:

```js
const HELPER_PLUGIN_ID = 'acme-shopping-helper';
const HELPER_OWNER_AGENT_ID = 'acme-shopping-agent';
```

Change these in `examples/custom-helper-extension-starter/background.js` before
shipping your own helper.

## 2. Package The Starter

```bash
npm run package:custom-helper-extension
```

Output:

```text
dist/custom-helper-extension-starter/custom-magic-city-helper-starter-0.2.0.zip
```

## 3. Run The Release Smoke

```bash
npm run smoke:custom-helper-extension-package
```

The smoke does the full local loop with the packaged artifact:

1. Starts a local Magic City server.
2. Creates a test user and credits.
3. Starts custom helper pairing.
4. Loads the packaged helper extension in Chromium.
5. Enters the pairing code in the popup.
6. Registers the custom helper.
7. Polls once so Magic City sees the helper is awake.
8. Starts a Magic Internet Agent mission assigned to the helper.
9. Polls again.
10. Claims the mission with a holder key.
11. Emits a holder-signed checkpoint.
12. Fulfills with the starter's `starter_not_implemented` result.
13. Verifies Magic City recorded mission-bound events without leaking the runner
    token or pairing code.

## 4. Manual Pairing Flow

For staging or your own Magic City environment, create a pairing code:

```http
POST /native-runner/helper/pairing/start
Content-Type: application/json
Cookie: <signed-in Magic City user cookie>

{
  "pluginId": "acme-shopping-helper",
  "ownerAgentId": "acme-shopping-agent",
  "label": "Acme Shopping Helper",
  "trustMode": "trusted_under_cap",
  "useExistingBrowser": true
}
```

Magic City returns a short-lived code. Paste it into the helper extension popup.
The extension stores only the resulting device-scoped token locally.

## 5. Registration Shape

The helper registers itself with:

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
  "metadata": {
    "customHelperAgent": true,
    "executionBackend": "extension_dom_executor",
    "runnerProtocol": "declarative-v1",
    "proofMode": "mission-bound-auth-holder-signatures"
  }
}
```

That is the line between a generic plugin and a Magic City-compatible browser
executor.

## 6. Signed Checkpoint Shape

Each checkpoint binds the helper's local action to the mission:

```json
{
  "pluginId": "acme-shopping-helper",
  "label": "Custom helper starter checkpoint",
  "state": "needs_implementation",
  "missionAction": "read_public_page",
  "targetUrl": "https://example.com",
  "planHash": "<magic-city-browser-plan-v1 hash>",
  "planActionId": "<ordered action id>",
  "planActionStatus": "completed",
  "proofOfPossession": {
    "nonce": "<random>",
    "previousHash": "<latest trace hash or null>",
    "publicKeyJwk": "<runtime holder public key>",
    "signature": "<Ed25519 signature>"
  }
}
```

The signature covers:

```json
{
  "schema": "magic-city-mission-pop-v1",
  "capabilityId": "<mission capability id>",
  "capabilityHash": "<mission capability token hash>",
  "action": "<normalized mission action>",
  "targetDomain": "<domain>",
  "nonce": "<random>",
  "previousHash": "<latest trace hash or null>",
  "audience": "magic_internet_helper",
  "sessionId": "<session id>"
}
```

## 7. Where To Add Smarts

Replace `executeSession` in `background.js`. Keep these boundaries intact:

- Consume only Magic City's declarative plan.
- Score and execute safe next browser actions locally.
- Emit checkpoints after meaningful boundaries.
- Stop on uncertainty, login, CAPTCHA, payment auth, card entry, policy conflict,
  and final submit.
- Fulfill with redacted state and proof metadata, not raw page data.
