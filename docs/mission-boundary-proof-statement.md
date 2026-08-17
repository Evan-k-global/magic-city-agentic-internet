# Mission Boundary Proof Statement

This is the backend proof target for Magic City mission-bound auth. The browser/UI is only a viewer for trace exports and proof links.

## Statement

Given private boundary events, prove every event was signed by the holder key, chained to the previous event hash, within allowed domains/actions, and tied to the payment commitment.

## Public Inputs

- Zeko proof statement hash
- Anchor payload digest
- Mission capability hash
- Mission policy hash
- Runtime holder key thumbprint
- Mission boundary trace hash
- Latest trace event hash
- Payment authorization commitment
- Mission boundary public inputs commitment
- Receipt proof hash
- Retail checkout receipt-profile hash, when the mission is a retail checkout
- Latest holder-signed retail step-receipt hash, when the mission is a retail checkout
- Verified-milestones hash and final-approval commitment, when a retail order is approved

## Private Witness

- Full mission boundary event sequence
- Non-public target URLs and selectors
- Redacted user-provided field values
- Runtime nonces and signatures
- Payment authorization details not exposed to the UI

## Predicates

- Capability signature verifies against the Magic City mission auth issuer.
- Each event signature verifies against the bound runtime holder key.
- Each event `previousHash` equals the previous event `eventHash`.
- Each event action is included in `policy.allowedActions`.
- Each domain-scoped event is inside `policy.allowedDomains`.
- Spend and payment rail remain inside policy limits.
- Receipt proof hash commits to the trace hash and payment authorization commitment.
- For retail checkout, the ordered milestone set includes candidate selection, cart confirmation,
  checkout opening, saved address confirmation, saved card confirmation, delivery confirmation,
  and final review.
- A final-submit transition is permitted only when every required retail milestone is present and
  a still-live user approval commitment is bound to the final-review trace event. The runtime
  must re-attest final-review readiness immediately before the irreversible submit; expired,
  replayed, cross-session, or drifted approvals are rejected.
- The Zeko relayer anchors the proof statement hash and payload digest through the mission auth registry zkApp.

## Integration Path

1. The Magic Internet Agent runtime signs only mission boundary checkpoints.
2. Magic City stores the redacted, hash-chained trace and creates a mission-bound receipt.
3. The receipt proof artifact exposes compact MBA public inputs.
4. The backend generates or queues the Zeko proof/anchor job.
5. The relayer anchors `statementHash` and `payloadDigest` in the mission auth registry zkApp.
6. Credits, x402, or merchant settlement release can reference the anchored execution verification summary.

## Non-Goals

- No ZK proving inside the browser.
- No mission-bound constraints inside SantaClawz agent execution.
- No raw card, password, MFA, or vault plaintext in public proof inputs.
