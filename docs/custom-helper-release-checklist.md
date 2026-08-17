# Custom Helper Release Checklist

Use this checklist before publishing a third-party Magic City helper extension.
The goal is a narrow browser helper that keeps user data local while producing
mission-bound receipts Magic City can verify and anchor.

## Release Gates

Run these from the Magic City repo root:

```bash
npm run package:custom-helper-extension
npm run smoke:custom-helper-extension-package
```

The smoke test must pass against the packaged zip, not the source folder. It
loads the unzipped release artifact in Chromium, pairs the helper, registers the
custom plugin ID, starts a Magic Internet Agent mission, polls it, claims it,
emits a holder-signed checkpoint, and fulfills the session with a proof trail.

## Manifest

- `manifest_version` is `3`.
- `description` is 132 characters or fewer.
- `permissions` are limited to `storage`, `tabs`, `scripting`, and any small
  extension-only utilities you truly need.
- No `debugger`, `webRequest`, or `<all_urls>`.
- Site access uses `optional_host_permissions`, preferably `https://*/*`, and is
  requested only for the current mission domain.
- Magic City API origins are the only required `host_permissions`.
- No `http://localhost` or `http://127.0.0.1` permissions in the Web Store zip.
- All JavaScript is bundled with the extension. No remote code, remote scripts,
  `eval`, `new Function`, or model-supplied JavaScript programs.

## Protocol Contract

- Use a stable `pluginId` and `ownerAgentId`; do not use Magic City's reserved
  runner IDs.
- Start pairing through `POST /native-runner/helper/pairing/start`.
- Store the returned device token only in extension local storage.
- Register with:
  - `kind: "browser"`
  - `capabilities` including `browser.extension_dom_executor`
  - `metadata.executionBackend: "extension_dom_executor"`
  - `metadata.runnerProtocol: "declarative-v1"`
  - `metadata.proofMode: "mission-bound-auth-holder-signatures"`
- Poll sessions with the device token and extension headers:
  - `x-magic-city-runner-surface: chrome-extension`
  - `x-magic-city-runner-protocol: declarative-v1`
- Claim with a runtime holder public key.
- Every checkpoint includes `planHash`, `planActionId`, and holder
  proof-of-possession.
- Fulfillment releases held credits on failure and holds/captures only when the
  browser outcome is ready for explicit user approval.

## Privacy Guardrails

- Never send cookies, passwords, MFA codes, raw page HTML, raw localStorage,
  full card numbers, CVV/CVC, wallet secrets, or screenshots by default.
- Redact page state locally. Send URLs, titles, coarse stage labels, compact
  cart totals, selected last-4 checks, and hashes.
- Stop for login, CAPTCHA, payment authentication, card entry, policy conflict,
  and final purchase submit.
- Keep model/browser intelligence local or call your own service only with data
  your privacy policy explicitly covers.

## Chrome Store Privacy Practice Hints

Likely data categories for a browser helper:

- Personally identifiable information, if you read names, emails, addresses, or
  account labels for checkout.
- Financial and payment information, if you inspect card labels, last four
  digits, totals, receipts, or payment method choices.
- Authentication information, only if your extension observes login state or
  prompts. Do not collect passwords.
- Web history, if you store or transmit visited mission URLs.
- User activity, if you automate clicks, form fills, or scroll state.
- Website content, if you inspect page text, products, totals, forms, or links.

Use a narrow explanation: the helper exists only to execute user-approved Magic
City browser missions, keep sensitive browser data local, and send redacted
mission-bound checkpoints to Magic City.

## Submission Notes

Include these points in review notes:

- The extension is not a general crawler and does not run in the background
  without a user-approved Magic City mission.
- The extension uses optional site access so the user grants host permission per
  mission domain.
- The extension does not import or execute remote code.
- Checkout, login, payment authentication, and final submit remain user-visible
  stops.
- Magic City receives only mission-scoped checkpoints and cryptographic proof
  metadata, not raw credentials or full payment details.
