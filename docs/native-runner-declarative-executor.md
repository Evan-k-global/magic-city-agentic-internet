# Magic City Runner Declarative Executor

## Boundary

Magic City plans. The Chrome extension executes. Neither side can substitute
for the other.

- Magic City owns task extraction, merchant and spend policy, mission-bound
  auth, receipt creation, and Zeko settlement anchoring.
- The extension owns the user-visible browser tab, local Chrome profile,
  optional host access, and the final stop before login, payment, CAPTCHA, or
  final submission.
- OpenRouter is a server-side intelligence provider only. It can extract a
  small task schema on ambiguous input with a short timeout; it never runs in
  the extension and never receives passwords, payment fields, cookies, local
  vault values, or arbitrary page HTML.

## Plan Format

`magic-city-browser-plan-v1` is static JSON sent over the authenticated runner
channel. It contains a plan ID/hash, one HTTPS target domain, a bounded action
list, a query derived from user-approved task text, and explicit pause limits.

The extension rejects plans that do not match its schema, exceed fourteen
actions, cross the mission domain, contain an unsupported primitive, exceed the
query limit, or name an MBA action outside the signed capability policy.

The bundled action vocabulary is deliberately small:

- `navigate`
- `inspect`
- `search`
- `select_candidate`
- `click_intent` for `add_to_cart` or `checkout`
- `pause`

There is no JavaScript, WASM, selector program, `eval` input, or remote script
URL in a plan.

## Local Execution

The extension executes semantic DOM helpers packaged in `executor.js`. It can
find an accessible search field, gather compact public result candidates, score
them against the approved query and maximum price, open a high-confidence
non-sponsored match, prepare a cart, and open checkout.

It does not export page HTML. The browser report is limited to page URL/title,
safe state flags, and a short list of public product candidates. Password,
payment, MFA, cookie, and other sensitive field values never leave Chrome.

## MBA Binding

`0.2.1` sends `x-magic-city-runner-protocol: declarative-v1`. Every completed
or intentionally waiting step carries the server plan hash, ordered step ID,
and an Ed25519 holder-signed MBA proof-of-possession.

Magic City rejects a missing plan hash, tampered hash, out-of-order step, or
step whose mission action differs from the server-issued plan. The signed
boundary trace includes the plan binding, so the later receipt/proof commits to
both the approved policy and the action sequence.

The browser keeps this lightweight: one signed checkpoint per meaningful state
transition, not a network call per click, mouse movement, or DOM mutation.

## Revision Policy

The first `0.2.1` plan uses a deterministic local candidate scorer after the
existing bounded OpenRouter schema extraction. A future revision may occur only
from a compact public observation, only on the server, only within the same
domain/action policy, and at most twice. It will produce a new hashed plan
revision; it will never send executable code into Chrome.
