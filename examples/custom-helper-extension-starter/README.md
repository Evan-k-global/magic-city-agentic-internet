# Custom Magic City Helper Extension Starter

This is a minimal Chrome MV3 starter for a custom Magic City browser helper.
It is not Magic City's default runner. It shows the protocol pieces a custom
helper must keep:

- Pair with Magic City using a short-lived code.
- Store only the device-scoped runner token locally.
- Register a custom `pluginId`.
- Generate a runtime holder key.
- Poll, claim, checkpoint, and fulfill Magic Internet Agent sessions.
- Send redacted summaries and holder-signed boundary events.

## Setup

1. Pick stable IDs in `background.js`:

   ```js
   const HELPER_PLUGIN_ID = 'acme-shopping-helper';
   const HELPER_OWNER_AGENT_ID = 'acme-shopping-agent';
   ```

2. In Magic City, call:

   `POST /native-runner/helper/pairing/start`

   with those IDs. Paste the returned code into the extension popup.

3. Load this folder as an unpacked Chrome extension during development.

4. Register and poll from the popup.

## Package And Smoke

From the Magic City repo root:

```bash
npm run package:custom-helper-extension
npm run smoke:custom-helper-extension-package
```

The smoke test loads the packaged zip in Chromium, pairs it with a local Magic
City server, starts a helper-assigned browser mission, and verifies a
holder-signed checkpoint. Treat this as the minimum release gate before a Chrome
Store upload.

Release docs:

- `docs/custom-helper-hello-walkthrough.md`
- `docs/custom-helper-release-checklist.md`
- `docs/custom-helper-privacy-template.md`

## Production Notes

- Bundle all code. Do not import remote JavaScript in a Chrome Web Store
  extension.
- Keep host permissions optional and mission-scoped.
- Replace `executeSession` with your own local browser logic, but keep the plan,
  policy, checkpoint, and proof boundaries intact.
- Test the final zip artifact before submission.

## License

This starter directory is licensed under the Apache License, Version 2.0. See
[LICENSE](./LICENSE). Magic City's hosted control plane, default runner, and
protected protocol implementation are not included in this grant; see the
repository [LICENSING.md](../../LICENSING.md).
