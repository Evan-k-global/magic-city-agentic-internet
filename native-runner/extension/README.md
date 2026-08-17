# Magic City Runner Extension

Magic City Runner 0.2.0 is extension-only.

It keeps the Chrome Web Store package intentionally boring:

- pairs this browser with Magic City using a short-lived code
- stores a device-scoped token in `chrome.storage.local`
- reports account/device status to Magic City
- uses a mission-scoped holder key to sign browser checkpoints
- opens approved shopping pages, selects a product, prepares a cart, and opens checkout
- stops before login, captcha, payment, and final order approval

It does not use Chrome Native Messaging, does not start local software, and cannot read raw passwords, card numbers, CVV, MFA codes, or payment-sheet contents.

## Local Staging Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click **Load unpacked**.
4. Select `public/native-runner/extension`.
5. Pair from Magic City Settings using the displayed code.

For public production, upload the packaged ZIP through the Chrome Web Store.
