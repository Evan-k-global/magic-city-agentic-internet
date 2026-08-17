# Zeko -> Ethereum Payment Plan

This document defines the concrete plan for using Zeko as the authorization and truth layer for Ethereum payments in Magic City.

## Core thesis

Magic City should not try to make Zeko itself be the user-facing payment rail.

The right split is:

- Stripe / Square / wallet-funded USDC / credits = money movement
- Zeko = proof, authorization, settlement truth, and agent infrastructure
- Ethereum = treasury and real asset settlement

Short version:

- Zeko authorizes
- Ethereum settles

That remains true across all stages:

1. Zeko testnet now
2. Mina / Zeko mainnet later
3. More direct Ethereum settlement or verification later

## What exists already

Magic City already has the right foundation in the runtime:

1. Compact proof artifacts
- `src/zekoProof.js`
- o1js proof over compact execution / settlement state

2. Anchor payload preparation and submit modes
- `src/zekoAnchor.js`
- `record` and `relay` modes

3. Sponsored background proof queue
- proof generation, local verification, anchor prep, submission
- non-blocking for user outcomes

4. Settlement registry
- `GET /zeko/settlement-registry`
- `POST /zeko/settlement-registry/register`
- external commitments and platform-auto entries

5. EVM-linked wallet commitments
- wallet challenge / signature flows already exist for settlement commitments

That means we do not need to invent the protocol surface from scratch. We need to specialize it for payment authorization.

## Product objective

Enable an Ethereum USDC payment to be triggered only when Magic City has a valid Zeko-backed authorization record for that payment.

This gives us:

- normal user-facing payment UX
- Zeko-backed truth under the hood
- a path from testnet experimentation to mainnet settlement
- a future bridge story without redoing the product model

## Design principles

1. No user should need a Mina wallet to pay for normal Magic City usage
2. Zeko should gate settlement, not replace Stripe or Ethereum treasury rails
3. Every outbound Ethereum payment must be:
- policy checked
- idempotent
- replay protected
- auditable
4. Every inbound wallet-funded top-up must be:
- verified onchain
- mapped to a user/session/request
- credited only after confirmation
5. The first production architecture should use a relayer, not recursive onchain proof verification

## Payment authorization schema

We should introduce a dedicated `payment_authorization` statement family in the settlement registry.

### Statement kinds

Core statement kinds:

1. `payment_authorization:treasury_usdc_transfer`
- Magic City treasury is allowed to send USDC on Ethereum

2. `payment_authorization:user_wallet_topup`
- a user wallet transfer to Magic City treasury should mint credits after confirmation

3. `payment_authorization:merchant_settlement`
- a merchant payable tracked in Magic City may now be settled on Ethereum

4. `payment_authorization:refund_release`
- a previously held or captured amount may be refunded or released

### Canonical authorization fields

Every payment authorization statement should bind at least:

- `authorizationId`
- `statementKind`
- `network`
- `intentId`
- `sessionId`
- `settlementId`
- `sourceKind`
- `sourceId`
- `payerType`
  - `magic_city_treasury`
  - `linked_user_wallet`
- `asset`
  - `USDC`
- `chainId`
  - `1` for Ethereum mainnet initially
- `tokenAddress`
- `recipientAddress`
- `amountBaseUnits`
- `amountUsdCents`
- `policyHash`
- `expiryAt`
- `nonce`
- `requestCommitment`
- `statementHash`
- `actorHash`
- `treasuryHash`
- `settlementHash`

### Optional authorization fields

- `merchantClass`
- `recipientLabel`
- `maxSlippageBps`
- `spendCapWindow`
- `requiresReview`
- `reviewApprovedBy`
- `walletAddress`
- `walletSignatureHash`
- `evmTxHash`
- `anchorSubmissionId`

### Canonical payload example

```json
{
  "schema": "magic-city-payment-authorization-v1",
  "authorizationId": "payauth_01",
  "statementKind": "payment_authorization:treasury_usdc_transfer",
  "network": "zeko:testnet",
  "chainId": 1,
  "asset": "USDC",
  "tokenAddress": "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "recipientAddress": "0x1234...",
  "amountBaseUnits": "25000000",
  "amountUsdCents": 2500,
  "intentId": "intent-42",
  "sessionId": "cs-42",
  "settlementId": "mset-42",
  "payerType": "magic_city_treasury",
  "policyHash": "0x...",
  "nonce": "0x...",
  "expiryAt": "2026-04-10T00:00:00.000Z",
  "requestCommitment": "0x...",
  "statementHash": "0x..."
}
```

## Registry model

The settlement registry remains the protocol surface.

We should extend it so payment authorizations are stored as:

- `scope = payment_authorization`
- `registryMode = anchor_commitment | signature_commitment | memo_commitment`
- `statementKind = payment_authorization:*`

### Required registry entry metadata

- `authorizationId`
- `statementKind`
- `statementHash`
- `settlementId`
- `sessionId`
- `intentId`
- `anchorSubmissionId`
- `anchorStatus`
- `payloadHash`
- `txHash`
- `signer`
- `signerType`
- `walletAddress`
- `signatureVerified`
- `expiryAt`
- `executedAt`
- `executionStatus`
- `ethereumExecutionRef`

## Relayer architecture

The relayer is the near-term execution bridge between Zeko truth and Ethereum settlement.

### Responsibilities

1. Observe authorized payment intents
- watch settlement registry entries
- or consume an internal event stream sourced from the registry

2. Verify payment authorization locally before sending anything
- registry entry exists
- statement kind is allowed
- anchor status is valid enough
- signature policy passes
- review policy passes
- authorization not expired
- authorization not already executed

3. Enforce treasury policy
- supported chain: Ethereum mainnet only initially
- supported asset: USDC only
- supported recipient classes
- amount caps
- rate limits
- replay protection

4. Execute Ethereum payment
- using the configured treasury path

5. Persist execution result back into Magic City
- tx hash
- sent timestamp
- success / failure reason
- final execution state

### Recommended relayer services

Split into three logical workers:

1. `authorization-indexer`
- watches registry entries
- derives executable jobs

2. `payment-relayer`
- signs and submits Ethereum transactions
- strictly idempotent

3. `confirmation-writer`
- waits for confirmations
- writes final execution state back to Magic City

### Idempotency requirements

Every payment job must be keyed by:

- `authorizationId`
- `statementHash`
- `recipientAddress`
- `amountBaseUnits`
- `chainId`

A payment may only be executed once for a given authorization key.

### Replay protection

Use all of:

- authorization nonce
- expiry time
- executed flag in registry
- relayer-side durable dedupe store
- treasury-side sequence tracking if using a contract

## Ethereum settlement flow

We should support two treasury patterns.

### Phase 1 treasury pattern: relayer-controlled treasury signer

This is the fastest workable path.

Flow:

1. Magic City creates payment authorization proof/registry entry
2. Relayer verifies the entry and local policy
3. Relayer submits a USDC transfer on Ethereum
4. Relayer writes tx hash and status back to Magic City
5. Confirmation worker marks execution complete after N confirmations

Pros:
- fastest to implement
- no custom settlement contract required
- good for testnet and early mainnet rollouts

Cons:
- trust rests in relayer + treasury signer controls

### Phase 2 treasury pattern: treasury Safe or execution contract

Recommended production direction:

1. Treasury lives in a Safe or treasury execution module
2. Relayer cannot arbitrarily pay; it can only propose or call constrained execution methods
3. Contract/module enforces:
- token allowlist
- recipient policy class
- amount cap
- nonce / replay checks
- optional expiry

Pros:
- stronger operational safety
- better separation of duties
- easier auditing

## Treasury contract / module scope

If we move beyond a direct treasury signer, the first contract should be minimal.

### `MagicCitySettlementExecutor`

Responsibilities:

- execute USDC transfer only
- enforce authorization nonce uniqueness
- enforce max spend per authorization
- enforce signer / relayer allowlist
- emit stable events for indexing

### Suggested functions

```solidity
executeAuthorizedUsdcTransfer(
  bytes32 authorizationId,
  address recipient,
  uint256 amount,
  uint64 expiry,
  bytes32 statementHash,
  bytes calldata relayerAuthorization
)
```

```solidity
markAuthorizationCancelled(bytes32 authorizationId)
```

```solidity
setRelayer(address relayer, bool allowed)
```

```solidity
setPolicy(bytes32 policyHash)
```

### Contract constraints

- USDC token address immutable or owner-set once
- only allowed relayers may call
- authorizationId cannot be reused
- expired authorizations revert
- amount must match authorization payload

## User wallet-funded USDC top-up flow

This is the other half of the bridge.

### Phase 1

Current product shape is already close:

1. Magic City prepares wallet payment request to treasury address
2. user signs and submits in wallet
3. Magic City records pending verification
4. indexer watches Ethereum for matching USDC transfer
5. on confirmation, Magic City credits the user
6. Magic City writes `payment_authorization:user_wallet_topup` proof and registry entry

### Important note

Because we currently use a direct USDC transfer to the treasury address, attribution depends on:

- wallet address
- expected amount
- pending request id
- recent transfer matching

That is acceptable now.

### Better later

If we need stronger attribution and composability later, move to:

- a dedicated deposit contract
- or a Circle authorization-based deposit flow

This would reduce ambiguity for direct treasury transfers.

## Recommended signing modes

### For user wallets

Use user-controlled wallet signatures for:

- top-up requests
- settlement commitments
- future payment approvals

Default UX:
- sign each action

Optional future UX:
- capped delegated spending with expiry and revoke path

### For relayer / treasury

Use either:

- managed treasury signer in the early phase
- Safe or execution contract in later phases

## Exact phases from testnet to mainnet

## Phase 0: current state

What exists now:

- o1js artifact proofs
- Zeko anchor payloads
- settlement registry
- sponsored queue
- wallet-linked commitment signing
- Ethereum wallet-linked USDC top-up request prep

Missing:

- payment authorization schema
- relayer
- Ethereum treasury execution path
- onchain confirmation-driven credit finalization

## Phase 1: Zeko testnet + shadow Ethereum relayer

Goal:
- run the whole flow without moving real treasury funds automatically

Build:

1. payment authorization statement kinds
2. registry entry extensions
3. relayer in shadow mode
4. confirmation indexer for inbound user top-ups

Behavior:
- relayer verifies authorizations
- logs whether each authorization would have executed
- does not send real treasury txs yet

Exit criteria:
- zero replay issues
- deterministic matching for top-ups
- no false-positive executable authorizations

## Phase 2: Zeko testnet + limited real Ethereum settlement

Goal:
- allow very small real USDC payments under strict caps

Build:

1. treasury signer or Safe-backed relayer
2. per-authorization spend caps
3. recipient allowlist classes
4. operator alerting and rollback procedures

Behavior:
- only low-risk statement kinds execute
- only approved recipient classes
- manual review still default for most flows

Exit criteria:
- clean end-to-end settlement logs
- no duplicate sends
- confirmation reconciliation is stable

## Phase 3: Mina / Zeko mainnet mirror mode

Goal:
- move proof/anchor truth to mainnet-grade Zeko while keeping relayer architecture the same

Build:

1. switch network config from testnet to mainnet where available
2. keep Ethereum settlement unchanged
3. keep the registry / relayer model unchanged

Behavior:
- user UX remains the same
- trust in the proof/anchor plane improves

Exit criteria:
- mainnet-grade anchor stability
- no schema migration breakage

## Phase 4: mainnet limited production

Goal:
- allow selected payment authorization kinds to settle automatically on Ethereum

Production candidates:

1. user wallet-funded credit top-up finalization
2. small merchant settlements
3. pre-approved treasury transfers under strict caps

Required controls:

- rate limits
- spend caps
- recipient policy classes
- manual freeze switch
- alerting
- durable audit trail

## Phase 5: trust-minimized bridge path

Goal:
- reduce dependence on an off-chain relayer as the sole trust point

Possible routes:

1. EVM verifier / bridge consumes Zeko-valid proof or commitment
2. settlement executor contract verifies stronger attestations before releasing funds
3. bridge-assisted proof portability when Zeko bridge stack matures

This is the long-term destination, not the first production requirement.

## Recommended build order

1. Add `payment_authorization:*` statement kinds
2. Extend settlement registry entries for authorization execution metadata
3. Build inbound USDC top-up confirmation indexer
4. Build shadow relayer
5. Add treasury execution path with strict caps
6. Add Safe / executor contract if needed
7. Promote selected payment classes to real automatic settlement

## What we should not do first

1. Do not make users handle Mina wallets for ordinary payment flows
2. Do not block product outcomes on proof submission
3. Do not jump directly to recursive onchain proof verification
4. Do not support many chains or many assets first

Keep v1 narrow:

- chain: Ethereum mainnet
- asset: USDC
- proof network: Zeko testnet initially
- payment mode: authorization-driven relayer settlement

## Recommended first implementation target

The best first fully wired flow is:

1. user buys credits with linked Ethereum wallet using USDC
2. Magic City watches for treasury transfer confirmation
3. credits finalize automatically
4. Magic City writes a Zeko-backed `payment_authorization:user_wallet_topup` record
5. settlement registry exposes the truth to external agents and MCP consumers

Why this first:

- smallest blast radius
- directly useful to users
- already close to existing wallet product surface
- proves the thesis without introducing outbound treasury risk immediately

## Later zkTLS angle

zkTLS is not required for the first payment bridge.

But later it can prove third-party facts that feed authorization logic, for example:

- a provider order state exists
- a travel fare existed at booking time
- an ATS submission state was reached
- an off-platform invoice page showed a required amount

That evidence can then be hashed into the payment authorization statement before it is anchored to Zeko.

## References

- [Zeko docs](https://docs.zeko.io/)
- [Zeko bridge docs](https://docs.zeko.io/users/guides/zeko-bridge.html)
- [ERC-3009](https://eips.ethereum.org/EIPS/eip-3009)
- [Circle USDC docs](https://developers.circle.com/stablecoins/what-is-usdc)
- [Circle Gateway docs](https://developers.circle.com/gateway)
