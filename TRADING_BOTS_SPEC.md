# Magic City Trading Bots Spec

This document turns the trading-bots idea into a concrete implementation plan for Magic City.

The goal is not to bolt a generic crypto bot onto the side of the app. The goal is to create a new product lane where:

- Ethereum handles execution and settlement
- Zeko handles privacy, authorization, verification, and coordination
- `Your Agent` becomes the user-owned policy and runtime envelope
- Magic City becomes the marketplace and orchestration layer

## Core thesis

The clean split is:

- Ethereum = custody, swaps, routing, execution, settlement
- Zeko = private strategy state, policy proofs, verification, automation triggers, and marketplace reputation
- Magic City = product UX, strategy selection, funding, execution orchestration, and user approvals
- Your Agent = the user-owned runtime that carries local continuity, approvals, and private context when useful

Short version:

- ZK is fundamental for privacy and verification
- Zeko is fundamental for automation and coordination
- Ethereum is fundamental for live DeFi execution and money movement

That split should remain true until a later stage where Zeko can settle directly to Ethereum in a stronger, more trust-minimized way.

## Product goal

Magic City should support an Ethereum-native `Trading Bots` section where users can:

1. browse strategy lanes
2. enable `Your Trading Agent`
3. fund it with credits or on-chain value
4. choose execution policy and approval mode
5. run safer trading flows first
6. later opt into faster or more autonomous strategies

The first live wedge should not be pure arbitrage.

The first live wedge should be:

- protected swaps
- rebalance bots
- market-watch with conditional execution
- treasury routing / stablecoin rotations

True arbitrage should be a later lane after the product has:

- strong budgets
- replay protection
- reputation and execution logs
- guarded relayer / searcher infra

## Product surfaces

## 1. `Trading Bots`

Top-level section in the app.

Primary sub-surfaces:

- `Marketplace`
- `Your Trading Agent`
- `Funding`
- `Policy`
- `Activity`
- `Verification`

## 2. `Marketplace`

What the user sees:

- strategy cards
- risk class
- supported chains
- supported tokens
- live vs simulated
- creator / source
- fee model
- current status

Initial strategy categories:

- Protected swap
- Rebalance
- Stablecoin routing
- Market watch
- Strategy bundles
- later: Arbitrage

Each card should show:

- strategy label
- what it does
- what it can spend
- what approvals it needs
- whether it uses:
  - user wallet approvals
  - treasury relayer
  - or a funded agent budget

## 3. `Your Trading Agent`

This is a specialization of `Your Agent`, not a separate totally unrelated identity.

It should include:

- `Agent name`
- `Agent ID`
- `Runtime`
  - local runtime
  - remote MCP worker
  - marketplace envelope
- `Trading enabled`
- `Allowed strategy classes`
- `Allowed chains`
- `Allowed tokens`
- `Budget`
- `Per-trade cap`
- `Daily cap`
- `Approval mode`

Suggested approval modes:

- `Always ask`
- `Ask above threshold`
- `Auto within policy`
- `Simulate only`

## 4. `Funding`

This must be split clearly from the normal `Wallet + Credits` flow.

### A. User account funding
This already exists.

Use for:

- buying Magic City credits
- paying for strategy setup or service work

Rails:

- Stripe
- on-chain USDC

### B. Trading agent budget
This is specific to `Your Trading Agent`.

Use for:

- strategy execution budget
- relayer-eligible notional caps
- simulation vs live budget envelopes
- marketplace strategy usage budget

The UI should never blur these 2 together.

## 5. `Activity`

Trading activity needs its own timeline instead of being mixed into generic execution history.

Show:

- strategy selected
- authorization created
- simulation run
- quote accepted
- transaction submitted
- transaction confirmed
- execution verified
- pnl snapshot updated
- strategy paused / revoked

## 6. `Verification`

Show the Zeko side explicitly, but compactly.

Each execution row can show:

- `policy authorized`
- `proof prepared`
- `anchor prepared`
- `execution receipt indexed`
- `verified`

The user should feel:

- Ethereum did the trade
- Zeko recorded and verified the important truth

## First live UX

## A. Protected swap

1. user opens `Trading Bots`
2. selects `Protected swap`
3. picks token pair and max spend
4. chooses:
   - wallet-sign path
   - or funded agent execution path
5. Magic City simulates and quotes
6. Magic City creates a `trade_authorization`
7. Zeko records the policy and execution envelope
8. Ethereum executor performs the swap
9. Magic City indexes and verifies the result

## B. Rebalance

1. user enables `Rebalance`
2. sets target allocation
3. sets max drift and max trade size
4. chooses approval mode
5. Magic City watches and proposes
6. on trigger, it creates a `trade_authorization`
7. execution and verification follow the same pattern

## C. Arbitrage later

1. user enables `Arbitrage`
2. user explicitly accepts higher-risk policy
3. strategy runs only with:
   - higher minimum balance
   - tighter caps
   - relayer/searcher infra
   - stronger pause rules

This should not be the first trading product.

## Design principles

1. Separate strategy choice from execution engine
- strategy selection is user-facing
- execution stack can change underneath

2. Simulation first
- users should be able to run most strategies in simulate mode before going live

3. Policy-gated autonomy
- autonomy must be explicit, capped, and revocable

4. Wallet safety first
- Magic City never gets a user's private key
- wallet-sign paths stay user-approved

5. Zeko-backed truth
- every live trade should have a compact proof / attestation path

6. Marketplace-compatible
- every strategy should fit a common installation / budget / approval model

## `Your Trading Agent` data model

Use this as a specialization of `Your Agent`.

## 1. `trading_agent_profiles`

One row per user's trading-enabled agent profile.

Suggested columns:

```sql
id uuid primary key
user_id text not null
agent_id text not null
name text not null
status text not null default 'disabled'
runtime_type text not null
runtime_endpoint text null
enabled boolean not null default false
trading_enabled boolean not null default false
simulation_mode boolean not null default true
approval_mode text not null default 'ask_above_threshold'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## 2. `trading_agent_policies`

```sql
id uuid primary key
trading_agent_profile_id uuid not null references trading_agent_profiles(id)
allowed_chain_ids_json jsonb not null default '[]'
allowed_tokens_json jsonb not null default '[]'
allowed_strategy_classes_json jsonb not null default '[]'
max_notional_usd_cents bigint not null default 0
per_trade_cap_usd_cents bigint not null default 0
daily_cap_usd_cents bigint not null default 0
max_slippage_bps integer not null default 0
allow_wallet_execution boolean not null default true
allow_relayer_execution boolean not null default false
allow_marketplace_strategies boolean not null default false
allow_private_orderflow boolean not null default false
pause_on_loss_bps integer not null default 0
pause_on_failure_count integer not null default 0
require_review_above_usd_cents bigint not null default 0
policy_hash text null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## 3. `trading_agent_wallets`

This is the trading budget envelope, not the whole identity.

```sql
id uuid primary key
trading_agent_profile_id uuid not null references trading_agent_profiles(id)
funding_mode text not null
budget_credits bigint not null default 0
budget_usd_cents bigint not null default 0
onchain_budget_token text null
onchain_budget_chain_id integer null
onchain_budget_wallet text null
available_budget_usd_cents bigint not null default 0
locked_budget_usd_cents bigint not null default 0
spent_budget_usd_cents bigint not null default 0
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## 4. `trade_strategy_catalog`

```sql
id uuid primary key
strategy_key text not null unique
label text not null
category text not null
risk_class text not null
status text not null default 'active'
execution_type text not null
supported_chain_ids_json jsonb not null default '[]'
supported_tokens_json jsonb not null default '[]'
config_schema_json jsonb not null default '{}'
fee_model_json jsonb not null default '{}'
verification_mode text not null default 'zeko_attested'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## 5. `trade_strategy_installations`

```sql
id uuid primary key
user_id text not null
trading_agent_profile_id uuid not null references trading_agent_profiles(id)
strategy_catalog_id uuid not null references trade_strategy_catalog(id)
status text not null default 'installed'
mode text not null default 'simulate'
config_json jsonb not null default '{}'
last_run_at timestamptz null
last_success_at timestamptz null
last_failure_at timestamptz null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## 6. `trade_authorizations`

This is the core execution envelope.

```sql
id uuid primary key
user_id text not null
trading_agent_profile_id uuid not null references trading_agent_profiles(id)
strategy_installation_id uuid null references trade_strategy_installations(id)
statement_kind text not null
status text not null
mode text not null
chain_id integer not null
token_in text null
token_out text null
notional_usd_cents bigint not null
max_slippage_bps integer not null
recipient_address text null
executor_type text not null
executor_ref text null
policy_hash text null
authorization_hash text null
expires_at timestamptz null
review_required boolean not null default false
review_approved_by text null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## 7. `trade_executions`

```sql
id uuid primary key
trade_authorization_id uuid not null references trade_authorizations(id)
status text not null
chain_id integer not null
executor_type text not null
execution_mode text not null
quote_json jsonb not null default '{}'
simulation_json jsonb not null default '{}'
transaction_hash text null
receipt_json jsonb null
effective_price_json jsonb null
gas_cost_json jsonb null
pnl_json jsonb null
started_at timestamptz null
completed_at timestamptz null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

## `trade_authorization:*` schema on Zeko

The same pattern as `payment_authorization:*` should be used for trading.

Zeko should not execute the trade.
Zeko should authorize, constrain, and verify it.

## Statement families

### Core statement kinds

1. `trade_authorization:protected_swap`
- one approved swap route within policy bounds

2. `trade_authorization:rebalance`
- a rebalance action is allowed because the portfolio drift crossed threshold

3. `trade_authorization:market_watch_trigger`
- a strategy trigger condition was met and execution is allowed

4. `trade_authorization:treasury_rotation`
- treasury or stablecoin routing action is allowed

5. `trade_authorization:arbitrage_bundle`
- later, multi-leg or searcher-style strategy authorization

6. `trade_authorization:refund_release`
- unwind or release of a reserved strategy budget

7. `trade_authorization:strategy_enable`
- a strategy was enabled under a given policy hash

### Required fields

Every `trade_authorization` statement should bind:

- `authorizationId`
- `statementKind`
- `strategyKey`
- `strategyInstallationId`
- `tradingAgentId`
- `userHash`
- `policyHash`
- `chainId`
- `executionMode`
  - `simulate`
  - `wallet_sign`
  - `relayer_execute`
  - `searcher_execute`
- `tokenIn`
- `tokenOut`
- `amountInBaseUnits`
- `amountInUsdCents`
- `maxSlippageBps`
- `quoteHash`
- `simulationHash`
- `requestCommitment`
- `statementHash`
- `actorHash`
- `expiryAt`
- `nonce`

### Optional fields

- `routeHash`
- `poolSetHash`
- `expectedOutBaseUnits`
- `minOutBaseUnits`
- `privateOrderflowRequested`
- `reviewRequired`
- `reviewApprovedBy`
- `walletAddress`
- `walletSignatureHash`
- `executionTxHash`
- `receiptHash`
- `pnlHash`
- `anchorSubmissionId`

### Registry posture

Trading authorizations should reuse the settlement registry model with:

- `scope = trade_authorization`
- `statementKind = trade_authorization:*`
- `executionStatus`
- `anchorStatus`
- `ethereumExecutionRef`
- `verificationStatus`

## Ethereum execution stack

The execution stack should be adapter-based.

Do not hardcode the first routing provider into the product model.

## Shared execution pipeline

Every strategy should go through:

1. `Intent builder`
- turn product selections into a typed execution intent

2. `Quote adapter`
- gather quotes or route candidates

3. `Simulation adapter`
- estimate outputs, fees, and failure conditions

4. `Policy gate`
- compare against caps, slippage, token allowlist, chain allowlist, approval mode

5. `Zeko authorization`
- create `trade_authorization`
- record or anchor the compact statement

6. `Executor`
- wallet-sign path
- guarded relayer
- later searcher / arbitrage executor

7. `Confirmation writer`
- index receipt
- write execution state
- update pnl / snapshots

8. `Verification writer`
- prepare proof / anchor / execution attestation

## Protected swaps

This should be the first live execution type.

Recommended execution stack:

- quote/simulation adapter
- protected routing
- wallet-sign path first
- optional guarded relayer later
- post-trade receipt indexing
- Zeko attestation of:
  - policy used
  - quote/simulation commitment
  - tx/receipt commitment

Protected swap properties:

- understandable to users
- easier to debug
- lower risk than arbitrage
- easier to verify and present in UI

## Rebalance

Execution stack:

- portfolio-state reader
- threshold trigger
- quote/simulation
- policy gate
- wallet-sign or relayer execute
- receipt indexing
- post-trade allocation snapshot
- Zeko attestation

## Market watch

Execution stack:

- watch conditions
- store trigger snapshot
- create authorization only when threshold is crossed
- then follow the protected-swap pipeline

## True arbitrage

This should be treated as a later specialized executor.

Important difference:

- `Your Agent` is useful for policy ownership, local preferences, and approvals
- but a local runtime is usually not the best direct arbitrage executor because it adds latency

So the architecture should split:

### A. User-facing control plane
- Magic City
- Your Trading Agent
- Zeko authorization and verification

### B. Fast execution plane
- relayer/searcher infrastructure
- private orderflow
- fast route assembly
- bundle submission where relevant

Arbitrage execution requirements:

- stricter caps
- tighter expiry windows
- replay protection
- private orderflow support
- stronger simulation
- explicit higher-risk UX
- automatic pause rules

## Executor types

Support these execution modes in the data model from day one:

1. `wallet_sign`
- user signs the transaction from their linked wallet
- safest first path

2. `relayer_execute`
- guarded treasury or delegated executor path
- only within explicit caps

3. `searcher_execute`
- later arbitrage/searcher lane
- not default

4. `simulate_only`
- no live chain submission
- strongly recommended as a first mode for most new strategies

## Verification and privacy on Zeko

Zeko should carry the parts Ethereum is bad at exposing privately.

Use Zeko for:

- private policy state
- strategy configuration commitments
- approval commitments
- quote/simulation commitments
- execution receipts / pnl attestations
- marketplace reputation
- automation triggers

Do not force Zeko to do the raw trade execution today.

Near-term truth model:

- Ethereum executes
- Magic City indexes
- Zeko verifies and records the compact truth

## Marketplace model

The marketplace should sit above the execution adapters.

Each marketplace strategy should publish:

- label
- category
- risk class
- supported assets
- supported chains
- config schema
- fee model
- verification mode
- execution type

Magic City should track per-strategy reputation from:

- execution success rate
- slippage vs expectation
- realized performance
- user feedback
- proof / verification completeness

## Phase plan

## Milestone 1: Protected swaps

Build first:

- `Trading Bots` section
- `Your Trading Agent` trading policy extension
- strategy catalog with protected swap
- quote + simulation adapter
- wallet-sign execution path
- `trade_authorization:protected_swap`
- receipt indexing and basic Zeko attestation

Success criteria:

- user can configure a protected swap policy
- user can simulate before going live
- live swap writes an execution record
- Zeko gets the compact authorization + verification trail

## Milestone 2: Rebalance + market watch

Add:

- rebalance strategy
- threshold watches
- approval rules
- snapshot cards
- strategy activity timeline

## Milestone 3: Strategy marketplace

Add:

- installable strategy cards
- creator metadata
- strategy fees
- user strategy installs
- reputation and performance views

## Milestone 4: Guarded relayer execution

Add:

- relayer executor for approved strategies
- stricter policy checks
- rate limits
- replay protection
- treasury / delegated execution support

## Milestone 5: Arbitrage lane

Only after the earlier pieces are stable.

Add:

- searcher executor
- private orderflow support
- arbitrage-specific authorization kinds
- pause-on-loss / pause-on-failure controls
- advanced verification and execution reporting

## Recommended next implementation target

Start with:

1. `Trading Bots` UI shell
2. `Your Trading Agent` data model extension
3. `trade_authorization:protected_swap`
4. wallet-sign protected swap path
5. execution history + verification timeline

That is the cleanest, safest path into an Ethereum-native DeFi lane without pretending the first product should be an autonomous arbitrage bot.
