# Magic Internet final-submit state map

This map describes the confirmed Amazon canary baseline: Runner `0.4.22`,
commit `69766b0`, mission `cs-227`. It is a prerequisite for cleanup, not a
new checkout design.

## Canonical path

`signed final_submit action` -> `verified checkout` -> `intent persisted` ->
`dispatch persisted` -> `merchant confirmation observed`.

The background store is the canonical durable owner after browser dispatch.
The content script may verify merchant state and request a transition, but it
does not grant authority or decide that an order was submitted.

| State or evidence | Producer | Canonical owner | Consumers | Survives navigation | Sensitive data | Required regression |
| --- | --- | --- | --- | --- | --- | --- |
| Signed plan/action scope | Server and MBA signer | Mission session + signed plan | Background authorization gate, proof export | Yes | No private checkout values | Final-submit policy and receipt tests |
| Final-submit lease | Background after reviewed-checkout verification | Active runner action | `assertFinalSubmitLocalAuthority` | Service-worker lifetime only | No | Fresh-lease dispatch and behavioral expired-lease MV3 tests |
| `final_submit_intent` | Executor before scheduling the native click | Browser receipt ledger, projected to checkpoint | Background diagnostics and recovery | No; never sufficient for submission | No portable private data | Intent-only interruption test |
| `click_dispatched` | Executor timer callback immediately before native click | `finalOrderDispatches` in extension background storage | Cursor advancement, checkpoints, recovery | Yes | No portable private data | Wrapper-label/native-input click and worker interruption tests |
| Native click diagnostic | Executor | Receipt diagnostic only | Debug trace | No | No | Native target click test |
| Merchant order confirmation | Executor observation after navigation | Terminal mission result | Background terminal transition, UI, proof receipt | Yes after checkpoint | Public order outcome only; no raw page text | Merchant confirmation and timeout-without-replay tests |
| `finalSubmitRequested` | Background checkpoint projection | Derived compatibility field only | Server/UI payloads | Yes through checkpoint | No | Derived from dispatch or confirmation only |
| `browserActionReceipts` | Background receipt assembly | Checkpoint/proof projection | Server, portable receipt exporter | Yes after upload | Redacted categorical evidence only | Receipt/privacy tests |
| Active-run cursor | Background runner state | Extension background storage | Resume/recovery loop | Yes | No checkout profile | No-replay recovery tests |
| Checkout profile | Vault bridge | `chrome.storage.session` | Executor verification only | Browser session only | Yes: normalized address/contact/card cue | Profile reprovision and cleanup tests |

## Invariants for cleanup

1. `final_submit_intent` is diagnostic and never proves dispatch.
2. Only `click_dispatched` or observed merchant confirmation permits
   `finalSubmitRequested`.
3. A stale lease produces `final_submit_authority_lease_expired`, creates no
   dispatch receipt, and cannot invoke the native final-order control.
4. A durable dispatch without merchant confirmation is observed, never replayed.
5. Checkout-profile data remains in `chrome.storage.session`; receipt and
   proof projections contain no address, phone, email, or card digits.

## Cleanup boundary

No Amazon branch, selector, address, card, delivery, or final-click behavior
will be added during this track without a captured reproducible failure. The
first reduction target is duplicate state projection, not merchant behavior.
