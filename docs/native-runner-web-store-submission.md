# Magic City Runner Web Store Submission

This is the submission checklist for the Magic City Runner Chrome extension. The package pairs a browser with Magic City and executes user-approved, mission-scoped browser work in the existing Chrome profile. It receives a bounded declarative plan, can navigate a permitted site, inspect compact public page state, search, select a high-confidence product match, prepare a cart, and open checkout. It stops before login, CAPTCHA, payment, and final order approval. Normal updates keep the paired device credential and automatically check in with Magic City.

## Package

Run:

```sh
npm run package:native-runner-extension
```

Upload the ZIP from `dist/native-runner-extension/`.

## Listing

Name: Magic City Runner

Short description: Complete user-approved browser tasks locally, then pause for login, payment, and final approval.

Category: Productivity

Initial visibility: Unlisted

Single purpose:

Magic City Runner securely pairs this browser with Magic City so Magic City can run a user-approved, mission-scoped browser task in the user's signed-in Chrome profile. The extension stores a device-scoped token and mission holder key locally, polls Magic City for pending browser missions, and signs compact execution checkpoints.

## Privacy Disclosure

Privacy policy URL:

`https://magic-city.ai/native-runner/extension/privacy.html`

For internal staging review, use:

`https://magic-city-staging.fly.dev/native-runner/extension/privacy.html`

Data handled:

- Pairing code and pairing status.
- Device-scoped runner token stored in Chrome extension storage.
- Magic City base URL, extension version, plugin id, and device status metadata.
- Mission-scoped page URLs, titles, visible page structure, and browser action outcomes for sites the user explicitly enables.
- Compact mission-bound proof metadata and execution receipts.

Chrome Web Store data-use categories to disclose for 0.2.1:

- Authentication information: device-scoped runner token.
- Web history: mission-scoped page URL and title only.
- User activity: agent-performed navigation and click outcomes for the approved mission.
- Website content: visible page structure needed to locate a product, cart, and checkout controls.

Data not collected:

- Passwords.
- Raw card numbers, CVV, or payment sheet contents.
- MFA codes.
- Wallet private keys or seed phrases.
- Arbitrary browsing history outside user-approved Magic City missions.

Data use:

The extension uses data only to pair the user's browser, execute the mission the user approved, and produce mission-bound execution receipts. Magic City does not sell this data or use it for advertising.

## Permissions Justification

`storage`: Stores the Magic City base URL, device token, device id, and pairing status on this browser.

`alarms`: Allows lightweight periodic polling so the runner can stay available without keeping a popup open.

`host_permissions`: Allows the extension to communicate with Magic City staging and Magic City production.

`tabs`: Opens and focuses the user-approved browser task in the existing Chrome profile.

`scripting`: Runs the bundled mission executor only on a site the user enables for a pending Magic City mission.

`optional_host_permissions`: Requests HTTPS access for the specific mission site when the user clicks Allow site and start. The extension does not request localhost, `debugger`, `webRequest`, or raw credential access.

## Reviewer Test Instructions

1. Open `https://magic-city-staging.fly.dev/`.
2. Sign in.
3. Open Settings, then Magic City Runner.
4. Click Install extension and install the Web Store extension.
5. Click Pair.
6. Open the Magic City Runner extension popup.
7. Set the Magic City URL to `https://magic-city-staging.fly.dev`.
8. Paste the pairing code and click Pair.
9. Return to Magic City Settings and click Check runner.
10. Start a Magic Internet Agent shopping task, then open the extension popup and click Allow site and start.
11. Confirm it opens the target site, uses the generic bounded plan to search or select a product, prepares a cart, and pauses before login, payment, or final order approval.

## Production Config

After the Chrome Web Store item exists, set this environment variable on Fly:

```sh
MAGIC_CITY_NATIVE_RUNNER_EXTENSION_INSTALL_URL=https://chromewebstore.google.com/detail/<extension-slug-or-id>
```

The Magic City Settings install button prefers this URL. If the extension URL is unset, it falls back to `/native-runner/extension/` for internal staging.
