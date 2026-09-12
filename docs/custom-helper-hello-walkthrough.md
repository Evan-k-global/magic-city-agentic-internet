# Hello Custom Helper

This walkthrough proves the smallest useful custom helper path:

pairing code -> scoped device token -> helper registration -> explicit dispatch
-> mission poll -> nonce-bound claim -> holder-signed checkpoint -> fulfillment.

## 1. Create The Partner Config

Copy `examples/custom-helper-extension-starter/partner.config.example.json` and
set the partner-owned control plane, page origins, identity and visible name:

```json
{
  "controlPlaneOrigin": "https://agents.example.com",
  "launchOrigins": ["https://shop.example.com"],
  "helperPluginId": "example-reading-helper",
  "helperOwnerAgentId": "example-reading-agent",
  "extensionName": "Example Browser Helper",
  "extensionDescription": "Read-only mission helper for Example.",
  "optionalMerchantOrigins": ["https://shop.example.com/*"]
}
```

The build validates exact origins. Release builds require HTTPS; development
builds may use explicit loopback HTTP origins.

## 2. Package The Starter

```bash
node scripts/package-custom-helper-extension.mjs \
  --config path/to/partner.config.json \
  --profile release
```

Output:

```text
dist/custom-helper-extension-starter/<helper-plugin-id>/release/
  <helper-plugin-id>-0.3.0-release.zip
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
9. Explicitly starts execution and dispatches it to the paired helper device.
10. Polls again and receives the short-lived dispatch nonce.
11. Claims the mission with that nonce and a holder key.
12. Emits a holder-signed checkpoint.
13. Opens and summarizes an allow-listed intercepted partner page.
14. Stops before the next unsupported shopping action.
15. Verifies Magic City recorded the redacted result and mission-bound events
    without leaking the runner token or pairing code.

## 4. Manual Pairing Flow

For staging or your own Magic City environment, create a pairing code:

```http
POST /native-runner/helper/pairing/start
Content-Type: application/json
Cookie: <signed-in Magic City user cookie>

{
  "pluginId": "example-reading-helper",
  "ownerAgentId": "example-reading-agent",
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
  "pluginId": "example-reading-helper",
  "ownerAgentId": "example-reading-agent",
  "kind": "browser",
  "endpoint": "chrome-extension://<extension-id>",
  "executionAgent": true,
  "capabilities": [
    "browser-worker-agent",
    "browser.extension_dom_executor",
    "browser.open",
    "browser.read_public_page",
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
  "pluginId": "example-reading-helper",
  "label": "Read approved page",
  "state": "read_only_page_summarized",
  "missionAction": "browser_open",
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

Extend `executeSession` in `background.js`. The checked-in implementation is a
real read-only example, not shopping automation. Keep these boundaries intact:

- Consume only Magic City's declarative plan.
- Score and execute safe next browser actions locally.
- Emit checkpoints after meaningful boundaries.
- Stop on uncertainty, login, CAPTCHA, payment auth, card entry, policy conflict,
  and final submit.
- Fulfill with redacted state and proof metadata, not raw page data.
