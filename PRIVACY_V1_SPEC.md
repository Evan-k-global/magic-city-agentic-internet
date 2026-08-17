# Magic City / AgentLayer Privacy v1

Privacy v1 augments the core protocol. It does not replace the original vision.

The base protocol remains:

1. agent registry
2. intent routing
3. agent-to-agent coordination over ACP
4. verifiable receipts
5. lane-based trust and ranking

Privacy v1 adds:

1. unlinkable requester handling
2. minimal-retention routing
3. batch-oriented request commitments
4. private settlement and receipt proofs
5. provider privacy labels and private-lane routing

## Goals

Privacy v1 is designed to beat "trust us, we do not retain prompts" by making non-retention and unlinkability more structural.

Goals:

1. do not build durable user history by default
2. reduce linkability between requests from the same user
3. allow private routing without exposing raw prompts to protocol state
4. preserve agent registry, routing, and coordination as first-class protocol primitives
5. make privacy a competitive dimension for registered models and agents

Non-goals for v1:

1. full private LLM inference via ZK
2. perfect network anonymity
3. complete blindness of the execution provider without confidential hardware

## Core Principle

ZK is used in v1 for:

1. private commitments
2. batch membership proofs
3. routing and settlement validity proofs
4. reputation and receipt update proofs

ZK is not the primary tool for private inference itself.

Inference privacy in v1 is achieved through:

1. no prompt retention
2. ephemeral requester identity
3. relayed and mixed routing
4. optional encrypted payload mode
5. private-lane provider constraints

## Entities

1. Requester
- a human or agent submitting work
- not required to have a durable public identity

2. Router
- ranks and selects providers/agents
- should operate on minimal metadata whenever possible

3. Provider Agent
- a registered model or agent capable of executing work
- publishes privacy and provenance guarantees

4. Relayer
- optional submission layer that separates network identity from protocol identity

5. Settlement Layer
- Zeko-backed commitment and proof layer

## Privacy Modes

Every intent declares a privacy mode.

Modes:

1. `plain`
- standard routing
- no plaintext retention
- provider may still see prompt

2. `private`
- requester identity hidden behind ephemeral hash/session
- prompt not retained in plaintext
- routing uses minimal metadata

3. `confidential`
- route only to providers advertising confidential execution
- encrypted payload or enclave path preferred

4. `agent-private`
- same as `private`, but optimized for agent-to-agent coordination
- stable agent identities are allowed, stable human identities are not required

## Provider Registry Extensions

Registered models and agents must publish privacy attributes.

Add these fields to the registry:

1. `privacyModes`
- supported privacy modes
- example: `["plain", "private", "confidential"]`

2. `provenanceModes`
- how the provider proves execution
- example: `["signed_receipt", "tlsnotary", "tee_attestation", "zk_receipt"]`

3. `retentionPolicy`
- declared retention behavior
- example: `none`, `ephemeral`, `session_only`

4. `executionEnvironment`
- example: `standard`, `tee`, `self_hosted_private`, `confidential_compute`

5. `routingVisibility`
- what the provider/router can see
- example: `plaintext`, `encrypted_payload`, `metadata_only`

This keeps the original agent registry intact while making privacy part of discovery and competition.

## Request Lifecycle

### 1. Client-side intent creation

The client creates:

1. `ephemeralSessionId`
2. `requestCommitment = H(prompt, nonce, sessionKey)`
3. `routingMetadata`

Routing metadata should contain only what is needed:

1. capability lane
2. budget
3. privacy mode
4. latency target
5. preferred provider class if any

Optional:

1. encrypted payload blob for private/confidential modes

### 2. Minimal server handling

The server must not store plaintext prompt by default.

Store:

1. `requestCommitment`
2. `promptHash`
3. `encryptedPayload` only if private mode requires it
4. `ephemeralRequesterHash`
5. routing metadata

Do not store:

1. raw prompt as a durable field
2. stable user profile unless user opts in

### 3. Batch mixing

Requests enter short routing windows.

For each routing window:

1. collect eligible requests
2. shuffle order
3. group into a batch
4. compute `batchRoot`
5. route each request after mixing

This does not make requests anonymous by magic, but it reduces direct one-to-one traceability.

### 4. Routing proof

The router proves:

1. request was included in a valid batch
2. selected provider was in the eligible set
3. privacy constraints were satisfied
4. payment/credit checks passed

The proof does not need to reveal:

1. stable requester identity
2. raw prompt
3. full batch contents

### 5. Execution

Execution path depends on privacy mode:

1. `plain`
- provider may receive plaintext prompt

2. `private`
- prompt may still be plaintext to provider, but not durable in protocol state

3. `confidential`
- payload should be encrypted or routed only to attested confidential providers

### 6. Receipt generation

Every completed request produces a receipt:

1. `intentId`
2. `requestCommitment`
3. `outputCommitment`
4. `providerId`
5. `proofType`
6. `proofHash`
7. `privacyMode`
8. `batchRoot`

Receipts update:

1. lane trust
2. provider ranking
3. settlement state

## Identity and Linkability

Privacy v1 removes durable identity by default for human requesters.

Rules:

1. each requester gets an ephemeral identifier
2. human-facing sessions rotate
3. free mode should not require persistent login
4. internal accounting should use anonymous or semi-anonymous credit references where possible

Agent identity remains durable because coordination and reputation depend on it.

This preserves the original agent-registry vision while avoiding human surveillance by default.

## Settlement and ZK Commitments

Zeko/o1js should be used for:

1. request batch commitment
2. anonymous credit spend proof
3. routing policy proof
4. receipt validity proof
5. reputation update proof

Suggested proof objects:

1. `BatchCommitmentProof`
- proves a valid request was inside batch `B`

2. `RoutingPolicyProof`
- proves the selected provider satisfied lane/privacy/bond constraints

3. `PrivateSpendProof`
- proves credits were validly spent without linking to a stable account history

4. `ReceiptUpdateProof`
- proves the receipt and lane-score update were protocol-valid

This is where ZK becomes elemental in the protocol, without pretending zkML inference is cheap today.

## Agent Coordination

Privacy v1 must preserve agent-to-agent coordination.

For agent coordination:

1. ACP remains the interaction rail
2. AgentLayer remains the registry and trust layer
3. private agent workflows may use:
- hashed inputs
- encrypted payload references
- attested receipts

An orchestrator agent should be able to:

1. hire sub-agents
2. route private tasks to them
3. settle privately
4. prove workflow correctness at the receipt layer

## Frontend Marketplace

Registered models should compete in the frontend on:

1. quality
2. speed
3. cost
4. privacy
5. provenance

Every model/provider card should expose:

1. lane coverage
2. score
3. avg latency
4. dispute rate
5. privacy mode support
6. provenance mode support

This keeps the long-term goal intact:

an open registry where models and agents compete for work.

## Storage Rules

Default storage rules for v1:

1. no raw prompt retention by default
2. store only prompt hash and commitment
3. encrypted payloads only when necessary
4. no durable human history unless explicitly enabled
5. receipts and ranking state may persist
6. provider execution details persist only as commitments and proofs

## v1 Deliverables

1. ephemeral requester/session IDs
2. no durable plaintext prompt storage
3. request batching and batch root commitments
4. private-lane provider registry fields
5. routing policy proof schema
6. receipt schema with privacy metadata
7. frontend privacy selector
8. provider privacy labels in marketplace/routing

## v1 Honest Claim

The claim Magic City can defend in v1 is:

"Magic City minimizes retention and linkability by default, routes private work through declared privacy lanes, and can prove routing, settlement, and receipt integrity with cryptographic commitments."

That is stronger than:

"we do not store your prompts"

and it does not drift from the original protocol vision.

## Future Versions

### v2

1. relayer/mixnet layer
2. anonymous credits
3. stronger provider attestations
4. tenant and policy proofs

### v3

1. confidential compute lanes by default for private mode
2. TEE attestation verification
3. deeper Zeko/o1js proof integration for routing and private settlement
4. cross-app portable privacy reputation for providers
