# Custom Helper Privacy Template

This template is for teams shipping a Magic City-compatible helper extension.
Replace bracketed sections before publishing.

## Purpose

[Helper Name] helps users complete browser tasks they explicitly start through
Magic City. The extension works inside the user's Chrome profile, follows the
mission scope approved in Magic City, and stops for login, payment
authentication, CAPTCHA, policy conflicts, and final purchase submission.

## Data We Process

During an active mission, the extension may process:

- Mission instructions, target domain, budget, allowed actions, and stop rules.
- Web page titles, URLs, product names, visible prices, cart totals, checkout
  stages, and form labels needed to complete the mission.
- User-selected checkout cues such as shipping address labels, billing ZIP, card
  label, card network, and last four digits.
- Local extension state including pairing status, helper registration status,
  runtime holder key material, and a device-scoped Magic City runner token.
- Redacted checkpoint summaries and cryptographic proof metadata.

## Data We Do Not Collect

The extension must not collect or transmit:

- Passwords, MFA codes, cookies, session tokens, or raw browser storage.
- Full card numbers, CVV/CVC, bank credentials, wallet seed phrases, or private
  keys.
- Raw full-page HTML, unredacted screenshots, or arbitrary browsing history.
- Health, biometric, or government identification information unless your helper
  has a separate explicit purpose and consent flow.

## How Data Is Used

Data is used only to:

- Execute user-approved Magic City browser missions.
- Keep browser/login/payment state local to the user's device.
- Produce redacted mission checkpoints.
- Sign mission boundary events with the runtime holder key.
- Let Magic City verify policy compliance, prepare receipts, and anchor compact
  proof statements.

We do not sell user data. We do not use user data for creditworthiness or
lending. We do not use or transfer user data for purposes unrelated to the
extension's single purpose.

## Data Shared With Magic City

The extension sends Magic City:

- Pairing and registration metadata.
- Device-scoped helper token authentication.
- Mission claim and checkpoint requests.
- Redacted browser state such as current URL, page title, stage, totals, and
  selected last-4 checks.
- Holder public key, holder-key signatures, plan hash, action IDs, and receipt
  references.

Magic City should not receive raw credentials, raw payment secrets, or full page
content.

## Local Storage

The extension stores on the user's device:

- Magic City base URL.
- Device-scoped runner token.
- Helper registration status.
- Runtime holder public/private key pair used only for mission-bound signatures.
- Last status/error message.

Users can revoke the helper from Magic City settings or remove the extension
from Chrome.

## Retention

Local extension data remains on the device until the user disconnects the helper,
rotates/revokes the token, clears extension storage, or uninstalls the extension.
Magic City retains redacted mission receipts and proof metadata according to
[Your Company]'s retention policy.

## Contact

For privacy requests, contact: [privacy@example.com]
