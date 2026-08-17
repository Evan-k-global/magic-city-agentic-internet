# Nava On Zeko

This document captures the current reverse-engineered Nava-compatible layer implemented inside AgentLayer.

The goal is to preserve the core Nava product idea:

1. a user proposes an execution-escrow transaction in natural language
2. a verification service evaluates the request and records an approval decision
3. verification artifacts are published to a proof-friendly network
4. final economic settlement can still point at Ethereum

Today, step 3 runs on the current Zeko testnet. The long-term settlement direction remains Ethereum.

## Reverse-engineered inputs

This compatibility layer was shaped from:

1. the public Nava site at [navalabs.ai](https://navalabs.ai/)
2. the public docs at [docs.navalabs.ai](https://docs.navalabs.ai/)
3. Nava documentation pages covering architecture, execution escrow, arbiter, NavaChain, quickstart, transactions, and public endpoints
4. local Codex projects that already implement intent routing, receipts, Zeko anchoring, MCP metadata, and Ethereum settlement planning

The implementation is a compatibility layer, not a claim of protocol-perfect parity.

## Local code reused

The main local base is:

- [agent-verification](/Users/evankereiakes/Documents/Codex/agent-verification)

Key reused pieces:

- [src/server.js](/Users/evankereiakes/Documents/Codex/agent-verification/src/server.js): HTTP surface, MCP metadata, auth helpers, anchor submission integration
- [src/store.js](/Users/evankereiakes/Documents/Codex/agent-verification/src/store.js): persistent state for transactions, approvals, and settlement tracking
- [src/zekoAnchor.js](/Users/evankereiakes/Documents/Codex/agent-verification/src/zekoAnchor.js): anchor payload preparation and submission plumbing
- [src/zekoSubmitterServer.js](/Users/evankereiakes/Documents/Codex/agent-verification/src/zekoSubmitterServer.js): submitter relay modes for local and testnet flows
- [ZEKO_ETHEREUM_PAYMENT_PLAN.md](/Users/evankereiakes/Documents/Codex/agent-verification/ZEKO_ETHEREUM_PAYMENT_PLAN.md): the existing "prove on Zeko, settle on Ethereum" plan

The Nava-specific adapter logic lives in:

- [src/navaCompatibility.js](/Users/evankereiakes/Documents/Codex/agent-verification/src/navaCompatibility.js)

## Component mapping

Nava concept to current implementation:

1. Execution Escrow
   AgentLayer accepts `POST /transactions` requests with `escrowAddress`, `userPrompt`, `tx`, and optional `chainId`.
2. Orion Arbiter
   The local arbiter performs deterministic transaction checks, basic prompt-to-value consistency checks, selector classification, and approval heuristics.
3. NavaChain
   Verified results are wrapped into a Zeko anchor payload and tracked on `zeko:testnet`.
4. Agent profile and public stats
   Public endpoints expose an agent profile, transaction feed, single-transaction detail, and aggregate metrics.
5. OAuth-protected resource metadata
   Existing MCP/OAuth metadata endpoints are exposed under the Nava-compatible surface.
6. Ethereum settlement
   The compatibility layer keeps `settlementPlan = ethereum` in the service and public agent views even though anchoring currently happens on Zeko testnet.

## Request flow

The current happy path is:

1. The client submits a Nava-style transaction request to `POST /transactions`.
2. The request is normalized into an internal intent plus a persisted `navaTransaction`.
3. The arbiter evaluates the request and creates an Orion-style approval object with reasoning.
4. The service derives a statement hash and anchor payload.
5. The payload is submitted through the existing Zeko anchor flow.
6. The transaction can then be queried through approval, verification, and public agent endpoints.

## Current endpoint surface

Service metadata:

- `GET /`
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-authorization-server`

Verification service discovery:

- `GET /verification-services`
- `GET /verification-services/active`
- `GET /verification-services/:id`
- `GET /verification-services/inbox/:inbox`

Transaction lifecycle:

- `POST /transactions`
- `GET /transactions/users/:ethereumAddress`
- `GET /transactions/:requestHash`
- `POST /transactions/:requestHash/approvals`
- `GET /transactions/:requestHash/approval-status`
- `GET /transactions/:requestHash/verification-status`

Public agent reads:

- `GET /public/agents/:ethereumAddress`
- `GET /public/agents/:ethereumAddress/transactions`
- `GET /public/agents/:ethereumAddress/transactions/:requestHash`
- `GET /public/agents/:ethereumAddress/metrics`

## Example request

```bash
curl -X POST http://127.0.0.1:4411/transactions \
  -H 'content-type: application/json' \
  -d '{
    "escrowAddress":"0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    "userPrompt":"Send 0.01 ETH to 0x1111111111111111111111111111111111111111",
    "tx":{
      "to":"0x1111111111111111111111111111111111111111",
      "value":"10000000000000000",
      "data":"0x"
    },
    "chainId":11155111
  }'
```

Then read the resulting state:

```bash
curl http://127.0.0.1:4411/transactions/<requestHash>/approval-status
curl http://127.0.0.1:4411/transactions/<requestHash>/verification-status
curl http://127.0.0.1:4411/public/agents/0x742d35Cc6634C0532925a3b844Bc454e4438f44e
```

## What is real today

Implemented now:

1. Nava-shaped transaction creation
2. deterministic and heuristic approval generation
3. public verification-service discovery
4. public agent and transaction read APIs
5. Zeko testnet anchor preparation and submission tracking
6. preserved Ethereum settlement intent in service metadata

## Current gaps

This is intentionally a first compatibility pass. It does not yet provide:

1. full calldata decoding for every protocol-specific transaction type
2. recursive zk-proof verification of the arbiter itself
3. exact Nava production auth semantics
4. real Ethereum-side settlement execution from the same request lifecycle
5. canonical parity with every field or status transition in Nava's production backend

Right now the arbiter is best described as a policy engine plus an anchorable reasoning artifact, with Zeko used as the current public audit network.

## Why Zeko first still makes sense

The reason this adapter uses Zeko testnet first is simple:

1. Zeko is the fastest path available in the current local stack for publishing proof-friendly verification artifacts
2. the repo already has Zeko anchoring and submitter scaffolding
3. the architecture still supports an Ethereum settlement registry and execution rail once the proving and settlement bridge is hardened

That gives us the right product shape now without pretending the settlement bridge is finished.
