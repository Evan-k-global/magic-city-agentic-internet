# Custom Magic City Helper Extension Starter

This is a minimal Chrome MV3 starter for a partner-owned Magic City browser
helper. It is not Magic City's default Runner. It shows the protocol pieces a
custom helper must keep:

- Pair with Magic City using a short-lived code.
- Store only the device-scoped runner token locally.
- Register a custom `pluginId`.
- Generate a runtime holder key.
- Poll explicitly dispatched sessions, claim with the session-scoped dispatch
  nonce, checkpoint, and fulfill Magic Internet Agent sessions.
- Send redacted summaries and holder-signed boundary events.
- Open and summarize one explicitly configured page without cart, checkout, or
  payment authority.

## Setup

1. Copy `partner.config.example.json` outside the starter and set stable IDs,
   the partner control plane, and exact page origins:

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

2. Build a separate release artifact:

   ```bash
   node scripts/package-custom-helper-extension.mjs \
     --config path/to/partner.config.json \
     --profile release
   ```

3. In the configured Magic City-compatible control plane, call:

   `POST /native-runner/helper/pairing/start`

   with those IDs. Paste the returned code into the extension popup.

4. Load the generated `package/` directory as an unpacked Chrome extension
   during development, or publish the generated ZIP through the partner's own
   Chrome Web Store process.

5. Pair, grant the configured page access, register, and poll from the popup.

Polling is a recovery/discovery mechanism, not purchase authorization. A user
must start the mission in Magic City first. The returned session contains a
short-lived `extensionRunDispatch.nonce`; the starter presents that same nonce
when claiming the mission. Do not remove or persist the nonce outside the
session payload.

## Package And Smoke

From the Magic City repo root:

```bash
npm run package:custom-helper-extension
npm run smoke:custom-helper-extension-package
```

The smoke test builds a development-only package, loads that ZIP in Chromium,
pairs it with a local Magic City server, opens an intercepted harmless partner
page, and verifies the redacted page result plus holder-signed boundary events.
The example then stops before the next unsupported shopping action. Treat this
as a protocol and packaging gate, not proof of completed merchant automation.

Release docs:

- `docs/custom-helper-hello-walkthrough.md`
- `docs/custom-helper-release-checklist.md`
- `docs/custom-helper-privacy-template.md`

## Production Notes

- Bundle all code. Do not import remote JavaScript in a Chrome Web Store
  extension.
- Keep host permissions optional and mission-scoped.
- Extend `executeSession` with the partner's own browser logic, but keep the
  plan, policy, checkpoint, and proof boundaries intact.
- Advertise only implemented capabilities. The checked-in example intentionally
  has no cart, checkout, credential, or purchase capability.
- Test the final zip artifact before submission.

## License

This starter directory is licensed under the Apache License, Version 2.0. See
[LICENSE](./LICENSE). Magic City's hosted control plane, default runner, and
protected protocol implementation are not included in this grant; see the
repository [LICENSING.md](../../LICENSING.md).
