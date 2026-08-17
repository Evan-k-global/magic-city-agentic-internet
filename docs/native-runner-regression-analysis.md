# Magic City Runner Regression Analysis

## 0.2.47 local candidate

- Treats a visibly signed-out Amazon account as an authentication handoff before catalog work. The runner preserves the prepared tab but never chooses a password-manager account, enters credentials, or triggers biometrics.
- Applies a non-promotional Prime search refinement when a signed-in search page exposes one. If Prime is unavailable, it applies a visible free-shipping refinement; if neither exists, it continues with product and checkout delivery verification.
- Records account/filter state in browser checkpoints and binds the reversible `prefer_free_delivery` action into the signed mission plan.
- Retains the 0.2.46 bounded wait for Amazon's dynamically rendered Add to Cart controls and the 0.2.45 fastest-free/cheapest-paid checkout policy.

## 0.2.46 local candidate

- Separates product navigation from purchase-control readiness. After a candidate URL loads, the runner re-observes briefly for dynamically rendered Add to Cart controls before trying an alternative.
- Recognizes Amazon Add to Cart ID/name variants and cart-add forms instead of requiring one exact control shape.
- Reports an accurate purchase-control timeout when a product genuinely remains unavailable; a valid product URL alone no longer fails the candidate milestone after the first observation.

## 0.2.45 local candidate

- Keeps Amazon tax and delivery outside the merchandise budget while reporting both in checkout.
- Prefers Prime/free-shipping search results without hard-filtering away paid-delivery fallbacks for users who do not have Prime.
- Chooses the fastest non-promotional free delivery option when available; otherwise chooses the cheapest paid option, with speed breaking price ties.
- Never starts a Prime membership or trial. The mission contract records `amazon_free_shipping_preferred` and `fastest_free_else_cheapest`.

## 0.2.44 local candidate

- Makes Amazon Prime/free delivery an item-admission rule: search candidates need Prime evidence and the product page must verify Prime eligibility without an explicit delivery charge before Add to Cart.
- Verifies visible active cart rows remain Prime/free eligible, chooses the fastest non-promotional `$0` delivery option, and requires an authoritative `$0` checkout shipping total before final submission.
- Stops with `free_delivery_unavailable` when Amazon offers paid delivery only. Magic City never starts a promotional Prime membership or trial.
- Binds `amazon_prime_free_shipping`, `fastest_free`, and the no-membership-signup rule into the browser plan and mission-bound auth policy.

## 0.2.43 local candidate

- Defines the user budget as a merchandise-subtotal limit. Shipping and tax remain visible in the checkout trace but do not trigger a late budget failure.
- Keeps delivery selection independent: choose the cheapest non-promotional option and never enroll the user in a Prime trial automatically.
- Records `maxSpendBasis: merchandise_subtotal` in the Magic City mission contract so the enforcement and proof statement use the same meaning.

## 0.2.42 local candidate

- Treats an approved spend cap as delivered cost when the product page exposes shipping/handling, and falls back to the next ranked result before adding an over-cap offer to cart.
- Distinguishes a Prime badge from verified free delivery; Prime eligibility alone is not treated as a zero-dollar shipping promise.
- Requires a user-initiated device assertion before a purchase mission receives exact Local Data Vault checkout data, then resolves any missing ZIP locality before launch.
- Retains and reuses the runner-owned merchant tab across handoff, retry, and later same-merchant missions so the UI focuses the prepared checkout instead of opening a duplicate.

## 0.2.41 local candidate

- Canonicalizes case, punctuation, line breaks, street/direction abbreviations, and ZIP versus ZIP+4 before selecting a saved address.
- Requires the same house number, ZIP5, street identity, and apartment/unit before automatic selection.
- Promotes address, payment, sign-in, verification, budget, and final-review handoffs to specific top-of-widget actions instead of a generic `Needs attention` state.
- Stays local until 0.2.40 field feedback is incorporated.

Date: 2026-08-04

Scope: Chrome extension packages `0.2.0` through `0.2.38`, the retained package
contents, the current browser smoke, and the observed Magic City/Amazon runs.

`0.2.37` passed the synthetic browser release smoke but failed on live Amazon:
`inspect-results` blocked for 27.5 seconds and ended in
`browser_content_script_timeout`. `0.2.38` is the local candidate fix and is not
counted as a working live release until it passes the same Amazon task.

## Executive Finding

There is no single previously published release that proved the entire flow
reliably. Different releases proved different parts:

- `0.2.19` is the clearest product-selection-to-cart baseline.
- `0.2.11`, `0.2.24`, and `0.2.29` reached progressively deeper checkout and
  address/payment pages.
- `0.2.24` reached a populated address form but stopped before confirming it.
- `0.2.29` reached address selection and the final checkout/order surface, but
  did not reliably confirm the address or select the required card.
- No observed live run proves reliable automatic final-order submission.

The correct recovery is not a wholesale rollback. It is to preserve the proven
cart and checkout primitives, remove state-classification ambiguity, and gate
each stage with explicit postconditions.

## Observed Release Milestones

| Version | Observed live result | Furthest proven stage | Assessment |
| --- | --- | --- | --- |
| `0.2.7` | Correct item reached the cart; visible **Proceed to checkout** was not used. | Cart | Useful early cart baseline. |
| `0.2.8` | Item was added; an existing cart made quantity/total appear doubled; watchdog stopped during checkout work. | Cart / checkout attempt | Cart add worked. Existing-cart state confused policy and reporting. |
| `0.2.11` | Reached checkout/final-order surface, but selected address and card did not match the vault. | Checkout | First strong evidence that navigation could reach checkout. Profile reconciliation was not effective live. |
| `0.2.13` | Reached checkout again; address/card correction still did not complete. Kayak also failed to launch reliably. | Checkout | Checkout navigation persisted; correction logic remained incomplete. |
| `0.2.16` | Sessions were claimed without progress and watchdog-stopped; multi-item behavior also failed. | Queue / startup | Runner wake/continuation regression dominated. |
| `0.2.19` | Correct Nature Valley item was selected and added to cart for `$2.97`; stopped at visible **Proceed to checkout**. | Cart | Best clean single-item product-to-cart baseline. |
| `0.2.23` | Opened Amazon and ranked search results, but did not add the selected item to cart. | Search results | Regression from `0.2.19`: observation/ranking no longer reliably advanced to action. |
| `0.2.24` | Reached the Amazon address editor with the address workflow open; stopped at **Use this address**. | Address confirmation | Deep checkout progress, but confirmation postcondition was missing or not satisfied. |
| `0.2.27` | Correct item reached cart; stopped again before **Proceed to checkout** and mislabeled the page as an offer. | Cart | Checkout state classification remained unreliable. |
| `0.2.29` | Reached delivery-address selection and later the final checkout/order page. It did not reliably click **Deliver to this address** or change the selected card. | Final checkout surface | Furthest observed browser navigation, but address/card reconciliation was not complete. |
| `0.2.31` | Failed early on search/product selection and sometimes exposed unrelated pending-site state in the popup. | Search results | Major regression in mission/page-state handling. |
| `0.2.36` candidate lineage | Latest observed failure treated an Amazon search-result page with an inline **Add to cart** control as if a product page were already open. | Search results | Root classifier defect prevented the proven cart path from running. |
| `0.2.37` | Synthetic suite passed, but live `cs-126` timed out during `inspect-results` after candidate hints were already extracted. | Search results | Real Amazon DOM traversal exceeded the content-script response deadline. |
| `0.2.38` | Exact package passes the consolidated suite with 1,200 irrelevant catalog links and a 2.5-second observation ceiling. | Unproven live | Performance/recovery candidate awaiting live Amazon proof. |

## Code Lineage

| Release range | Main capability added | Regression risk introduced |
| --- | --- | --- |
| `0.2.7` -> `0.2.9` | Browser-state classifier and scored next actions. | A broad classifier could override simple working controls. |
| `0.2.9` -> `0.2.11` | Checkout profile reconciliation and optional-delivery handling. | More checkout branches without live page-shape fixtures. |
| `0.2.13` -> `0.2.16` | Offer handling, budget guards, and boundary stops. | More ways to pause or report success before the shopping goal was complete. |
| `0.2.16` -> `0.2.19` | Multi-item plan support. | Basket state and existing-cart state became more important. |
| `0.2.19` -> `0.2.23` | Ranking, cart preview, retries, and remote planning support. | The clean `select -> add -> checkout` path became subordinate to observation and ranking. |
| `0.2.23` -> `0.2.24` | Address matching, address entry, and address-confirm controls. | Large executor change with no retained live Amazon DOM regression fixture. |
| `0.2.24` -> `0.2.27` | Card-add flow and final-order controls. | More checkout surface detection; code presence did not equal live completion. |
| `0.2.27` -> `0.2.31` | Existing-cart guards, exact address confirmation, stored-card selection, and runner lease checks. | State and continuation complexity increased across both executor and background worker. |
| `0.2.31` -> `0.2.35` | Relevance coverage, exact controls, direct candidate navigation, handoff verification, and retry refactors. | Largest late-stage complexity increase; search/product progression regressed. |
| `0.2.35` -> `0.2.36` | Card-autofill wait/resume and semantic payment sections. | Inherited the search classifier problem; added another resumable state. |
| `0.2.36` -> `0.2.37` | Search-result inline-cart classification fix. | Small targeted change, but live behavior is still unverified. |
| `0.2.37` -> `0.2.38` | Single product-card scan, search-page control narrowing, checkout-only profile analysis, and idempotent inspect retries. | No shopping-action changes; live Amazon remains the release gate. |

## Confirmed Root Regression

From `0.2.29` through `0.2.36`, the classifier used this effective rule:

```text
product page = product URL OR any visible Add to cart control
```

Amazon search cards contain inline **Add to cart** controls. That caused a
search-results page to be classified as a product page. The executor then
reported **A product page is already open**, skipped result selection, and later
failed because no product-level cart action had actually completed.

`0.2.37` changes the rule to give a recognized search-results surface priority
over an inline cart control. That directly addresses the latest failure, but it
does not prove the rest of checkout against live Amazon.

## Consolidated `0.2.38` Behavior

The current candidate keeps the strongest earlier behavior behind explicit,
server-validated milestones:

- search results must resolve to a purchasable matching product
- an existing side cart resumes only when its visible item text matches the
  approved query
- cart confirmation requires the expected item-count postcondition
- checkout can safely advance through side cart -> cart -> checkout
- address entry must be followed by **Use/Deliver to this address** and a closed
  matching summary
- the stored-card last four must match before checkout is verified
- delivery must select the cheapest non-promotional option, with speed as the
  equal-price tie breaker
- final review requires address, card, and delivery milestones together
- automatic final submit requires the configured policy and a subsequent
  merchant order-confirmation surface

Each checkpoint declares `milestoneProtocol: verified-v1`; the server rejects a
checkpoint that claims a required action without its expected milestone. The
widget reads the same milestone list, so its status now reflects evidence rather
than a generic page label.

## Why The Synthetic Smoke Is Not Live Proof

The packaged browser smoke covers a valuable synthetic flow:

- result selection and inline cart behavior
- multi-item basket completion and incomplete-basket fail-closed behavior
- cart and checkout navigation
- matching or adding an address
- selecting a stored card
- waiting for browser card autofill and resuming
- final-review pause and final-submit resume
- automatic final submit followed by visible order confirmation
- evidence-based side-cart resume and bounded side-cart -> cart -> checkout
- cheapest non-promotional delivery selection

It does not use Amazon's real, changing DOM, nested checkout panels, redirects,
or account-specific offers. Passing it proves internal state-machine integrity;
it does not prove Amazon compatibility. The release process treated those two
claims as equivalent.

## Required Recovery Architecture

Use explicit milestone postconditions instead of letting a broad page label
decide that work is complete:

1. `candidate_selected`: chosen title, price, and merchant constraints match.
2. `cart_confirmed`: the requested item is visible in cart and the cart delta is
   attributable to this mission.
3. `checkout_open`: a checkout-specific URL or checkout heading is visible.
4. `address_confirmed`: selected address matches the unlocked vault fingerprint
   and the address-selection panel is closed.
5. `card_confirmed`: selected card last four matches the vault preference, or a
   local payment-input wait is active.
6. `final_review_ready`: item count, mission-attributable total, address, card, and
   delivery policy are all verified.
7. `order_submitted`: the final action ran only under the configured approval policy,
   followed by a merchant confirmation identifier or success surface.

Every action should be: classify locally, choose one bounded control, act once,
re-observe, verify the next postcondition, and either continue or return a
specific blocked reason. A generic `ready`, `offer`, or `product` label must not
fulfill the mission.

## Release Gate Before Another Store Upload

Run these cases against the exact packaged ZIP, first on retained redacted DOM
fixtures and then in a signed-in live Chrome profile:

1. Empty cart, one exact item under budget.
2. Search results containing inline **Add to cart** controls.
3. Existing unrelated cart items; mission budget applies to mission additions.
4. Matching saved address; select and confirm it.
5. Missing address; fill it and click **Use/Deliver to this address**.
6. Matching saved card; select and verify last four.
7. Wrong selected card with target card already stored; click **Change**, select,
   and verify.
8. Target card absent; open local browser autofill, wait without polling payment
   fields or triggering biometrics, then resume after user completion.
9. Optional Prime/upsell page; decline and continue.
10. Final-review policy enabled; pause once with a usable approval action.
11. Final-review policy disabled; submit only after all checkout postconditions.
12. Three-item shared-budget basket; each requested item is independently
    confirmed before checkout.

The package should not advance to Web Store submission until all twelve produce
a saved milestone trace. A failure must include the installed runner version,
URL class, attempted control, observed postcondition, and redacted structural
snapshot.

## Recommended Baseline

Keep the current code rather than reverting wholesale, but treat the following
behavior as protected:

- `0.2.19`: deterministic product selection and cart confirmation.
- `0.2.24`: address discovery, entry, and confirmation controls.
- `0.2.27`: guarded final-order control support.
- `0.2.29`/`0.2.31`: existing-cart accounting, matching-address confirmation,
  stored-card selection, and runner continuity.
- `0.2.36`: local card-autofill wait/resume without reading card secrets.
- `0.2.37`: search-result inline-cart classifier correction.
- `0.2.38`: bounded catalog observation and idempotent inspect recovery, pending
  live proof.
- `0.2.39`: typed browser-surface and total evidence. Product/search pages keep
  their primary surface when Amazon renders a mini-cart; product buy-box prices
  are revalidated after navigation; cart/checkout budget enforcement requires
  an authoritative total and a verified cart or checkout milestone.
- `0.2.40`: match-first delivery address selection using normalized street and
  ZIP evidence even when merchant address rows do not literally say
  "address". Exact saved matches are confirmed before the create-new-address
  fallback.

The next release should be a consolidation release with no new shopping
features. Its job is to prove this single sequence end to end on live Amazon:

```text
search -> select -> cart-confirmed -> checkout -> address-confirmed
-> card-confirmed/local-wait -> final-review -> approved submit
```
