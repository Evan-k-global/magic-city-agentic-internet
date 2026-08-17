# Agent Mission-Bound Auth Integration

Magic City now targets the canonical protocol repo:

- Repository: `https://github.com/zeko-labs/agent-mission-bound-auth`
- Integrated commit: `a93b5c71e0c436cfb18bdf34290e1f0b615bd2a2`
- Protocol: `zk-mission-auth` `0.1`

## Division Of Responsibility

Magic City remains the product/runtime control plane:

- issue Magic City session capabilities
- bind local runner holder keys
- enforce Magic Internet Helper tool boundaries
- keep SantaClawz execution decoupled, with only Magic City hire/payment orchestration receipts
- queue proof generation and Zeko anchoring
- keep raw browser, vault, checkout, and search details out of public exports

`agent-mission-bound-auth` is the portable protocol layer:

- `mission-bound-capability-v1`
- `mission-bound-policy-v1`
- `mission-bound-boundary-event-v1`
- `mission-bound-auth-receipt-v1`
- `mba-registry-v1`
- `mba-browser-mission-profile-v1` (backend-built, hash-only browser state)
- `mba-retail-checkout-step-receipt-v1` (one holder-signed, hash-chained retail checkpoint)
- `mba-retail-checkout-receipt-profile-v1` (the compact verified retail execution summary)
- `mba-redacted-trace-v1` (public event hashes only)
- verifier-facing discovery, JWKS, checkpoint, bundle, and settlement lifecycle names

Magic City uses the lightweight browser profile from the protocol. It records page-state class,
safe-next-action score, stop reason, checkout checkpoint, and session/tab/domain commitments without
exporting URLs, selectors, form values, card data, or search text. The browser remains a compact
checkpoint signer; profile construction and proof work stay on the backend.

For the Amazon retail profile, Magic City makes the browser's verified milestones portable:

`candidate_selected -> cart_confirmed -> checkout_open -> address_confirmed -> card_confirmed -> delivery_confirmed -> final_review_ready`

Each checkpoint creates a hash-chained retail step receipt bound to the same MBA capability,
policy, holder key, extension-plan hash, and prior boundary event. No product text, address,
card data, selectors, or screenshots appear in this protocol view. A final-submit approval is
valid for two minutes, commits to the final-review trace event and checkout summary hashes, and
is accepted only after every required milestone is present. Before the runner can invoke the
merchant control, it must emit a fresh signed final-review checkpoint; Magic City rejects a
replay, expired approval, domain drift, trace mismatch, or a final submit without that recheck.
The final receipt and Zeko anchor commit the aggregate retail profile.

## Public Protocol Endpoints

Magic City exposes the canonical discovery paths:

- `GET /.well-known/agent-authorization.json`
- `GET /.well-known/mission-authority-jwks.json`

It also exposes standard checkpoint and bundle aliases:

- `POST /api/mission/verify-checkpoint`
- `POST /api/mission/enforce-checkpoint`
- `POST /api/mission/export-bundle`

The legacy Magic City endpoints stay live for current runners:

- `GET /.well-known/magic-city-mission-auth`
- `POST /mission-auth/capabilities`
- `POST /mission-auth/verify`
- `POST /mission-auth/sessions/{sessionId}/receipts`
- `GET /mission-auth/sessions/{sessionId}/trace`

## Receipt And Zeko Flow

Every mission-bound execution receipt now carries both Magic City and portable MBA views.

The portable receipt commits to:

- protocol capability hash
- protocol policy hash
- holder key thumbprint
- boundary trace hash and latest event hash
- payment context digest
- nullifier
- settlement state
- hash-only browser mission profile and redacted trace export

The proof artifact public inputs include the portable receipt id/hash/nullifier and protocol trace fields. When a Zeko anchor payload is prepared, Magic City derives an `mba-registry-v1` anchor view so the relayer/zkApp path is tied to the same nullifier and receipt commitment.

## Compatibility Note

Current Magic City Runner releases sign the Magic City PoP challenge (`magic-city-ed25519-pop-v1`). The
server records a protocol boundary-event view and also accepts the latest browser-helper compatibility
label (`browser-helper-ed25519-pop-v1`) during the lightweight migration. New helper agents can move
to full `ed25519-holder-proof-v1` challenge signing through `/api/mission/verify-checkpoint` without
changing the Magic City session model. SantaClawz execution remains outside this browser profile.

Magic City proof anchoring is configured for `zeko:testnet`; SantaClawz proof data remains on its own
`zeko:testnet` integration. Mainnet anchoring requires an explicit network override and is not the
default.

## Test

Run:

```bash
npm run test:mission-boundary
npm run test:retail-checkout-receipts
```

The regression checks discovery, JWKS, holder binding, unsigned checkpoint rejection, signed checkpoint acceptance, protocol boundary-event export, portable receipt creation, standard checkpoint verification, bundle export, and Zeko public input plumbing.
