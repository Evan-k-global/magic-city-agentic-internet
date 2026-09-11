# Magic Internet post-success code-reduction track

## Trigger

Start this track only after the first confirmed successful live Amazon purchase using Magic City. Revisit it immediately when Evan reports or celebrates that successful run.

Do not begin cleanup merely because the synthetic suite is green. The successful live run is the behavioral baseline that cleanup must preserve.

## Objective

Reduce the checkout implementation's moving parts without changing its behavior, authority model, privacy boundary, or merchant safety rules.

The goal is not an arbitrary line-count reduction. The goal is one obvious path through final checkout, one canonical source of truth for irreversible-action state, fewer duplicated representations, and tests that describe real failures instead of implementation details.

## Current baseline

Record these again immediately before cleanup because they may change:

- `public/native-runner/extension/executor.js`: 4,315 lines.
- `public/native-runner/extension/background-v0.2.js`: 3,893 lines.
- `scripts/smoke-native-runner-extension-browser.mjs`: 3,214 lines.
- `scripts/smoke-native-runner-extension-package.mjs`: 154 lines.
- Final-submit receipt/state terminology currently appears approximately 114 times across the executor and background controller.

## Successful canary record

- Mission: `cs-227` (reported successful live Amazon canary).
- Runner: `0.4.22`.
- Source snapshot: [`69766b0`](https://github.com/Evan-k-global/magic-city-agentic-internet/commit/69766b016948fd400553596beb1b7369c353ff5b).
- Immutable tag: `magic-internet-amazon-canary-0.4.22-cs-227`.
- Production release: Fly `v689`.
- Original Chrome ZIP SHA-256: `97a9c0469ab9171549d10494a3d71b7ab55edeaa8af1f64e87b7ba451f30570f`.
- Trace: `https://magic-city.ai/mission-auth/sessions/cs-227/trace`.
- Plan hash and portable receipt ID: retrieve from the authenticated trace before publishing a postmortem; the public trace endpoint correctly returns `auth_required`.

Version 0.4.22 is the canary baseline. It completed the prerequisite hardening:

- Production requires the corrected runner version.
- `final_submit_intent` is distinct from `click_dispatched`.
- Intent-only interruption is covered by a regression and does not count as dispatch.
- Executor reinjection replaces the current message handler while retaining one listener.
- Vault-derived checkout data lives in volatile `chrome.storage.session`, survives MV3 service-worker restarts within the current browser session, and is not retained in persistent extension storage.
- Legacy persistent checkout profiles are purged instead of migrated.
- A final click may use a recently verified local authority lease for at most 45 seconds, avoiding a synchronous control-plane dependency without creating an unlimited offline bypass.
- Automatic-submit failures no longer become false manual-approval prompts, and a failed dispatch is not accepted as proof.

Do not reimplement those fixes during cleanup.

### 0.4.22 follow-up before reduction

- Preserve the successful live 0.4.22 Amazon canary before changing checkout logic again.
- `npm run test:native-runner-final-submit-lease` drives the copied MV3 runner through the real final-submit path with a short test-only lease. It proves an expired production-equivalent lease cannot click, create a final-order receipt, or claim submission. The frozen canary runner leaves this pre-dispatch rejection local rather than publishing a terminal final-submit report; changing that recovery policy belongs in a separately versioned runner change. Keep the positive fresh-lease dispatch regression separate.
- Preserve the existing positive regression proving that a fresh lease can dispatch without making a final synchronous runner-status request.
- Describe checkout-profile storage accurately as **volatile extension session storage**, not encrypted storage. If application-layer encryption is added later, treat it as a separate security change rather than part of code reduction.
- Preserve explicit cleanup of volatile profiles after success, cancellation, disconnect, or abandonment. Do not move the profile back to `chrome.storage.local` merely to simplify recovery.

## Non-negotiable invariants

Every cleanup commit must preserve all of the following:

1. The signed plan is the only authority for final submission.
2. The product, merchandise subtotal, delivery address, selected card cue, and free permitted delivery are reverified before final submission.
3. Pickup, locker, subscription, trial, and paid-delivery controls remain excluded unless explicitly authorized.
4. The visible final-order label may live on an Amazon wrapper while the actual click target is a nested native input.
5. Exactly one native final-order click may be invoked for one signed action scope.
6. Intent alone never proves dispatch. Only `click_dispatched` or observed merchant confirmation satisfies `final_submit_requested`.
7. A dispatch with uncertain merchant outcome is observed, never replayed.
8. An intent-only interruption fails closed and does not claim that an order was submitted.
9. Login, captcha, payment authentication, address mismatch, card mismatch, delivery mismatch, and budget mismatch continue to pause or fail safely.
10. Portable receipts expose no address, card digits, page text, or other sensitive checkout data.
11. Control-plane timeouts cannot replay browser mutations.
12. The existing 26 browser scenarios remain passing; do not delete a real regression to make cleanup easier.
13. Vault-derived checkout profiles remain in volatile extension session storage and are never written back to persistent extension-local storage.
14. A fresh, bounded final-submit lease may avoid a synchronous status request; an expired lease must fail closed before the click.

## Strategy

### Phase 0 — Freeze and capture the successful baseline

- Save the successful mission ID, runner version, plan hash, sanitized checkpoint sequence, terminal state, and merchant confirmation evidence.
- Record the exact production release and extension ZIP hash.
- Tag or otherwise identify the successful source commit.
- Do not mix cleanup with feature work, merchant expansion, UI redesign, or protocol changes.

Exit condition: another engineer can identify exactly which live behavior must remain unchanged.

### Phase 1 — Produce a deletion map before editing

Trace one successful final-checkout path from signed plan to merchant confirmation. For every function and state field on that path, classify it as:

- authority;
- merchant-state verification;
- click dispatch;
- durable replay protection;
- control-plane reporting;
- presentation only;
- obsolete or duplicated.

Create a small table listing:

- producer;
- canonical owner;
- consumers;
- whether it survives navigation;
- whether it contains sensitive data;
- whether a regression requires it.

Pay particular attention to:

- `final_submit_intent`;
- `click_dispatched`;
- `native_click_invoked`;
- `finalSubmitReceipt` and `finalSubmitReceipts`;
- `finalSubmitRequested`;
- `browserActionReceipts`;
- `finalOrderDispatches`;
- `receiptScope`;
- active-run cursor and merchant-confirmation fields;
- executor handler/listener globals.

Do not edit until the duplicate owners are visible on one page.

### Phase 2 — Establish one canonical irreversible-action state machine

Use one explicit state model for the final action:

1. `authorized`
2. `intent_persisted`
3. `dispatch_persisted`
4. `merchant_confirmed` or `merchant_unconfirmed`

`native_click_invoked` may remain diagnostic evidence, but it must not become a competing authority state.

Rules:

- Store each transition once in one canonical durable owner.
- Derive compatibility booleans such as `finalSubmitRequested` only at API/checkpoint boundaries.
- Do not independently infer the same transition in executor state, background state, checkpoint assembly, and UI state.
- Keep the action scope bound to the signed plan hash and action ID.
- Reject impossible transitions explicitly.

Preferred simplification target: the background extension store owns durable irreversible-action state; the content script performs verification and sends a bounded transition request before the click. Page `sessionStorage` should not be treated as trusted authority. Retain it only if a demonstrated lifecycle requirement cannot be met by the extension store.

Exit condition: one function answers “may this click run?” and one function answers “what happened afterward?”

### Phase 3 — Collapse duplicated receipt plumbing

Look for safe removal or consolidation of:

- repeated receipt normalization;
- repeated receipt merge/deduplication;
- parallel singular and plural receipt fields;
- repeated phase checks;
- page-storage reloads that duplicate background storage;
- checkpoint fields that can be derived from the canonical transition;
- comments describing superseded receipt behavior.

Keep categorical, privacy-preserving receipts. Remove transport-specific copies that do not add recovery or audit value.

Do not combine intent and dispatch merely to reduce lines.

Exit condition: a receipt is created once, normalized once, stored once, and projected into public proof once.

### Phase 4 — Simplify runner recovery and cursor handling

Reduce the recovery logic to three cases:

- No durable dispatch: do not claim submission. Follow the explicit intent-only safety policy.
- Durable dispatch without confirmation: observe merchant state and never click again.
- Merchant confirmation observed: complete the mission.

Then remove branches that separately encode equivalent combinations of:

- `finalSubmitRequested`;
- receipt existence;
- active-run phase;
- next-action index;
- `orderSubmitted`;
- confirmation deadline.

Keep unrelated cart, address, card, and delivery recovery behavior out of this refactor.

Exit condition: recovery behavior can be described by the three cases above without exceptions hidden elsewhere.

### Phase 5 — Simplify executor installation

Choose one model and document it:

- one persistent runtime listener whose handler is replaced on every injection; or
- one freshly injected listener with explicit removal of the prior listener.

Do not retain both an installation flag and replacement machinery unless each has an independently tested purpose. Keep the current reinjection regression.

Exit condition: the installation lifecycle is understandable from the top and bottom of `executor.js` without relying on stale-closure assumptions.

### Phase 6 — Reduce tests without reducing coverage

Keep all 26 behavioral scenarios, but extract shared fixture builders and assertion helpers where that produces a net reduction.

Tests must continue to cover these distinct final-submit cases:

- wrapper label plus unlabeled nested native input;
- normal successful native click;
- intent-only interruption;
- persisted dispatch followed by worker/control-plane interruption;
- fresh final-submit lease with the control plane unavailable at dispatch time;
- expired final-submit lease rejected before dispatch;
- merchant confirmation success;
- merchant confirmation timeout without replay;
- pickup overlay present but not selected;
- incorrect card, address, delivery, and budget fail closed.

Package checks should validate behavior through the packaged extension. Avoid regex assertions that merely mirror implementation names when a behavioral assertion already proves the property.

Exit condition: fewer fixture and assertion lines, unchanged behavioral matrix, and no test coupled only to a private helper name.

### Phase 7 — Consolidate version gating

Make the required runner version derive from one release value or add a test that fails whenever these disagree:

- extension manifest;
- web UI minimum;
- server minimum;
- production-served manifest;
- packaged ZIP manifest.

Do not rely on a deployment-time environment override to hide inconsistent source defaults.

Exit condition: one automated check proves all version gates align.

## Commit strategy

Use small, reviewable, net-negative commits. Recommended order:

1. Add characterization tests only if an invariant lacks coverage.
2. Centralize final-submit state derivation without changing storage.
3. Consolidate durable receipt storage and remove redundant copies.
4. Collapse recovery/cursor branches.
5. Simplify executor installation.
6. Consolidate test fixtures and package assertions.
7. Align version-gate source of truth.

For each commit:

- state exactly what duplication is being removed;
- show before/after line counts for touched files;
- keep the commit net-negative unless it is a prerequisite characterization test;
- run targeted tests first, then the full packaged browser smoke;
- stop immediately if merchant behavior changes.

Do not create a single large “cleanup” commit.

## Review checklist

Before accepting each reduction, answer yes to every applicable question:

- Is the signed authority check unchanged?
- Is the final-review verification unchanged?
- Is the exact native click target unchanged?
- Can the action still execute at most once?
- Can intent still never masquerade as dispatch?
- Can a control-plane timeout still never replay the click?
- Does an expired local final-submit lease still prevent the click?
- Do vault-derived checkout details remain absent from persistent extension storage?
- Is merchant confirmation still required for success?
- Are failure reasons at least as specific as before?
- Are portable receipts still free of private checkout data?
- Did the change delete more production code than it added?
- Did the actual packaged extension pass the regression matrix?

## Required verification

At minimum, run:

- browser final-review policy tests;
- retail receipt/privacy tests;
- native-runner security tests;
- pairing/version-gate tests;
- address reconciliation tests;
- card reconciliation tests;
- terminal-contract tests;
- the full browser smoke against source;
- the full browser smoke against the exact packaged ZIP.

After all cleanup commits pass locally:

1. Deploy to staging or a controlled production canary.
2. Verify served runner hashes match the reviewed package.
3. Run one controlled live Amazon purchase.
4. Confirm exactly one native final-order click and merchant confirmation.
5. Freeze the checkout path again.

## Stop conditions

Stop cleanup and revert the current reduction if any of these occur:

- a new checkout branch is required to make tests pass;
- an existing regression must be weakened or removed;
- intent and dispatch become less distinguishable;
- the canonical authority source becomes ambiguous;
- private checkout data enters logs or receipts;
- an irreversible action can be replayed;
- the exact packaged ZIP differs from reviewed source;
- the live canary differs from the saved successful baseline.

When stopped, diagnose the divergence separately. Do not patch around it inside the cleanup series.

## Deliverable expected from the cleanup agent

Provide:

- a concise map of the original duplication;
- the commits in reduction order;
- before/after line counts by file;
- a list of removed states, fields, helpers, and branches;
- the preserved invariants;
- targeted and packaged test results;
- the final ZIP hash and production-served hash comparison;
- any complexity deliberately retained and the real failure that justifies it.

## Handoff prompt for the coding agent

> Begin only after the first successful live Magic City Amazon purchase has been captured as the baseline. This is a behavior-preserving, net-code-reduction task—not a feature pass. First map every final-submit state and receipt producer/consumer. Then make small net-negative commits that establish one canonical irreversible-action state machine, consolidate duplicate receipt plumbing, collapse equivalent recovery branches, simplify executor reinjection, and reduce test duplication without deleting any of the 26 behavioral scenarios. Preserve every invariant and stop condition in this document. Do not add merchant-specific branches without a captured reproducible failure. Verify the exact packaged ZIP and finish with one controlled live canary.

The cleanup agent must retain the 0.4.21 volatile-session profile boundary and bounded 45-second final-submit lease. Before reduction, add the missing negative regression showing that an expired lease cannot click. Do not describe `chrome.storage.session` as encrypted, and do not reintroduce persistent checkout-profile storage for convenience.

## Success evidence to preserve

- Correct product and merchandise budget.
- Correct home-delivery address.
- Correct saved card.
- Free permitted delivery selected; no pickup flow opened.
- Exactly one native final-order click.
- Merchant order confirmation observed.
- Signed mission and receipt trail contains no sensitive payment or address data.
