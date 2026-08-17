# Next Magic City Runner Release

Do not increment the Chrome extension during daytime iteration. Keep the current
`0.2.0` Store submission stable, ship ordinary product work on Magic City, and
batch extension-only changes into one end-of-day release for overnight review.

`0.2.1` is prepared locally and intentionally not submitted yet. It is the
single end-of-day package for the generic declarative executor and the simpler
first-site permission handoff.

## Release Gate

An extension release is justified only for:

- A new Chrome permission or user-consented browser boundary.
- A new bundled browser primitive.
- A security, privacy, or reliability fix in the local runtime.

It is not justified for a prompt change, model change, site strategy, routing
choice, Magic City UI change, MBA policy change, receipt/anchor change, or
ordinary server bug fix.

## 0.2.1 Contents

- Replace Amazon-first flow code with a generic declarative mission executor.
- Keep every executable primitive packaged in the extension: navigate, inspect
  visible page state, find by accessible role/text, click, type approved values,
  select, scroll, wait, upload, prepare cart, open checkout, pause, and capture
  a redacted artifact.
- Let Magic City send signed mission-plan data only. Plans may name a bounded
  action, locator, value reference, retry limit, and stop condition; they must
  never contain JavaScript, WASM, eval input, or a remote script URL.
- Require the mission gate before each plan action and preserve holder-signed
  boundary checkpoints for each action.
- Redact password, payment, MFA, cookie, and sensitive form values before any
  page summary or artifact leaves the browser.
- Improve the first-site permission handoff so the popup clearly asks once for
  the exact mission domain with one "Allow site and start" action, then resumes
  the pending mission automatically. Keep the separate run control as an
  advanced recovery action only.

## Next Bundled Runtime Work

- Add bounded server-side plan revision for a public, redacted observation only
  when the local candidate scorer cannot choose safely.
- Add a second generic-site regression fixture before adding any new primitive.

## Release Verification

- Existing paired device survives an update and auto-registers without a new
  pairing code.
- A browser mission runs from a generic plan on at least two unrelated sites.
- The runtime pauses at login, captcha, payment, and final submit.
- No private vault or sensitive page data reaches Magic City.
- Holder-signed MBA checkpoint rejection and success regressions pass.
- Chrome Web Store privacy answers and permission justifications still match the
  shipped behavior.
