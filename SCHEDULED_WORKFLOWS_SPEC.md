# Magic City Scheduled Workflows Spec

This document turns the cron / scheduled-workflow idea into a concrete production implementation plan for Magic City.

The goal is not generic background jobs. The goal is:

- per-user scheduled agent workflows
- durable fresh-data snapshots
- safe approvals for sensitive actions
- strong compatibility with connected accounts, credits, wallets, and Zeko-backed verification later

## Product Goal

Magic City should support recurring, user-owned workflows such as:

- "Every morning at 8am, give me my brief"
- "Watch my Cancun travel dates and refresh the best options"
- "Monitor my GitHub PRs and tell me when review is needed"
- "Watch my wallet top-ups and finalize credits when funds land"
- "Prepare my reminders and follow-up drafts before I need them"

The user experience should feel like:

1. create a scheduled workflow once
2. Magic City refreshes it in the background
3. the UI shows the freshest snapshot immediately
4. anything sensitive moves into `Needs approval` instead of auto-executing blindly

## Design Principles

1. Per-user ownership
- every automation belongs to a specific Magic City account
- it runs with that user's connected accounts, policies, and wallet context

2. Snapshot-first UX
- each run produces a durable latest snapshot
- the UI renders latest useful state first, not raw job logs

3. Safe side effects
- read-only refresh can run unattended
- payments, sends, submissions, and external writes should require policy gates or approval

4. Idempotent execution
- each scheduled run must be safe to retry
- duplicate emails, orders, applications, or payouts are not acceptable

5. Production persistence
- schedule state and run history must live in Postgres
- file-state is acceptable for local dev only

6. Futureproofing
- the same scheduled workflow model should work for:
  - web UI
  - remote MCP
  - future external agents
  - Zeko-backed attestation and automation layers

## What Counts As A Scheduled Workflow

A scheduled workflow is a saved user automation with:

- workflow capability
- schedule
- timezone
- configuration payload
- approval policy
- latest snapshot
- run history

It is not just "run this prompt every hour."

Each workflow should have a typed config model so the worker can safely re-run it.

## Production Storage Model

Use Postgres as the source of truth.

### 1. `automation_definitions`

One row per saved scheduled workflow.

Suggested columns:

```sql
id uuid primary key
user_id text not null
name text not null
workflow_capability text not null
status text not null default 'active'
kind text not null default 'scheduled_workflow'
schedule_type text not null default 'rrule'
schedule_expression text not null
timezone text not null
config_json jsonb not null default '{}'
approval_policy_json jsonb not null default '{}'
connected_account_requirements_json jsonb not null default '[]'
fresh_snapshot_id uuid null
last_run_id uuid null
last_run_at timestamptz null
next_run_at timestamptz null
last_success_at timestamptz null
last_failure_at timestamptz null
failure_count integer not null default 0
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Important indexes:

```sql
create index automation_definitions_due_idx
  on automation_definitions (status, next_run_at);

create index automation_definitions_user_idx
  on automation_definitions (user_id, status);
```

### 2. `automation_runs`

One row per actual execution attempt.

Suggested columns:

```sql
id uuid primary key
automation_id uuid not null references automation_definitions(id)
user_id text not null
workflow_capability text not null
trigger_kind text not null default 'schedule'
status text not null
lease_token text null
claimed_by text null
claimed_at timestamptz null
started_at timestamptz null
completed_at timestamptz null
snapshot_id uuid null
result_summary text null
error_code text null
error_message text null
metrics_json jsonb not null default '{}'
artifacts_json jsonb not null default '[]'
execution_context_json jsonb not null default '{}'
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Important indexes:

```sql
create index automation_runs_automation_idx
  on automation_runs (automation_id, created_at desc);

create index automation_runs_claim_idx
  on automation_runs (status, claimed_at);
```

### 3. `automation_snapshots`

Stores the latest normalized user-facing output for quick rendering.

Suggested columns:

```sql
id uuid primary key
automation_id uuid not null references automation_definitions(id)
user_id text not null
workflow_capability text not null
status text not null
title text not null
summary text null
snapshot_json jsonb not null
freshness_timestamp timestamptz not null
expires_at timestamptz null
created_at timestamptz not null default now()
```

Important indexes:

```sql
create index automation_snapshots_latest_idx
  on automation_snapshots (automation_id, freshness_timestamp desc);

create index automation_snapshots_user_idx
  on automation_snapshots (user_id, freshness_timestamp desc);
```

### 4. `automation_run_events`

Optional but recommended. Structured trace for debugging and internal diagnostics.

Suggested columns:

```sql
id uuid primary key
run_id uuid not null references automation_runs(id)
phase text not null
event_type text not null
message text null
detail_json jsonb not null default '{}'
created_at timestamptz not null default now()
```

Use this for:

- `queued`
- `claimed`
- `refresh_started`
- `approval_required`
- `connected_account_missing`
- `snapshot_written`
- `failed`

### 5. `automation_approvals`

For sensitive follow-through.

Suggested columns:

```sql
id uuid primary key
run_id uuid not null references automation_runs(id)
automation_id uuid not null references automation_definitions(id)
user_id text not null
action_kind text not null
status text not null default 'pending'
approval_payload_json jsonb not null
expires_at timestamptz null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

This is how scheduled workflows remain safe while still feeling proactive.

## Worker And Scheduler Architecture

Run three separate logical components.

### 1. Scheduler

Responsibility:

- find active automations where `next_run_at <= now()`
- create a new `automation_run`
- advance `next_run_at`

Rules:

- one run should be created per due occurrence
- use a transactional claim to avoid double-enqueue
- do not execute the workflow here

### 2. Workflow Worker

Responsibility:

- claim queued runs
- load the user context
- execute the workflow safely
- write artifacts and snapshot
- mark completion or failure

This should reuse the existing workflow/runtime model where possible:

- `workflowRegistry`
- connector execution sessions
- stable local plugins
- credit / wallet / connected account policies

### 3. Snapshot Refresher / Approval Worker

Responsibility:

- normalize output for fast UI rendering
- expire stale approval requests
- fan out non-blocking side work
- optionally enqueue Zeko truth / attestation work later

This split keeps request latency and background refresh concerns separate.

## Execution Model

Each scheduled run should follow this shape:

1. Load automation definition
2. Resolve user account and connected account state
3. Validate required connectors and policies
4. Execute in `read_refresh`, `prepare`, or `follow_through` mode
5. Produce:
   - summary
   - structured snapshot
   - artifacts
   - approval request if needed
6. Update latest snapshot reference
7. Write next run / success / failure metadata

## Approval Policy Model

Each automation definition should include a compact approval policy.

Example:

```json
{
  "mode": "prepare_only",
  "requireApprovalFor": [
    "email_send",
    "calendar_write",
    "direct_payment",
    "merchant_checkout",
    "job_submit"
  ],
  "allowBackgroundRefresh": true
}
```

Recommended modes:

- `refresh_only`
- `prepare_then_approve`
- `allow_safe_follow_through`

Magic City should default toward safety:

- reminders: can often follow through
- GitHub comment/PR watch: safe to refresh
- wallet confirmation: safe to refresh
- travel booking: prepare only
- food order: prepare only
- job submit: prepare or limited supported ATS only

## Rendering Fresh Data

The UI should never force users to open raw logs just to see value.

Render latest snapshots in three places.

### 1. New `Scheduled` / `Automations` surface

Each saved workflow card should show:

- name
- workflow type
- next run time
- latest status
- freshness timestamp
- latest summary
- `Needs approval` if applicable

Card actions:

- pause
- run now
- edit schedule
- open latest result
- approve pending action

### 2. Homepage / main chat surface

Add a compact `Fresh for you` strip for signed-in users.

Show the freshest snapshots first:

- travel watch refreshed 18 minutes ago
- PR review watch needs approval
- wallet top-up confirmed
- morning brief ready

This makes scheduled work feel alive without forcing users into a settings screen.

### 3. Inside workflow lanes

When a workflow has a saved automation:

- show last refresh time
- show latest snapshot summary
- show whether the next run is scheduled

That keeps the workflow UI anchored to the automation model.

## First Workflows To Support

Start with lanes that already map well to safe background refresh.

### Tier 1: Build first

#### 1. Reminder

Why first:

- already structured
- already has Google follow-through
- low-risk recurring use case

Good automations:

- "Every weekday at 8am remind me to review my priorities"
- "Every night at 9pm prepare tomorrow's calendar reminder"

Recommended mode:

- `allow_safe_follow_through` when Google policy allows

#### 2. Travel Concierge Watch

Why first:

- read-heavy
- high user value
- no need to fake booking

Good automations:

- watch a route/date range
- refresh best 3 options
- notify on price drop or better itinerary

Recommended mode:

- `refresh_only`

#### 3. Developer GitHub Watch

Why first:

- strong connector value
- high leverage for power users
- mostly read/prepare workflows

Good automations:

- watch PRs for review requests
- watch CI failures
- prepare patch package after new review comments

Recommended mode:

- `prepare_then_approve`

#### 4. Wallet Confirmation Watch

Why first:

- already close to existing payment-authorization / confirmation flow
- strong fit for automation

Good automations:

- watch USDC top-up confirmations
- auto-finalize credits after safe verification

Recommended mode:

- `allow_safe_follow_through`

### Tier 2: Build next

#### 5. Meeting Follow-Through

Good automations:

- recurring meeting package prep
- draft follow-up after each meeting template

Recommended mode:

- `prepare_then_approve`

#### 6. Spreadsheet Cleanup Feed

Good automations:

- recurring ingest + cleanup for known uploaded source
- daily normalization snapshot

Recommended mode:

- `refresh_only`

### Tier 3: Keep review-gated longer

#### 7. Job Applications

Only support scheduled:

- new-role discovery
- ATS state refresh
- draft application prep

Do not default to unattended auto-submit.

#### 8. Food Order

Only support scheduled:

- menu refresh
- cart prep
- reorder suggestion

Do not default to unattended merchant checkout.

## Workflows To Avoid For Cron At First

Do not ship unattended versions of:

- direct payments
- merchant checkout
- job submission on arbitrary sites
- external account disconnects
- broad GitHub writes without explicit approval policy

These should remain approval-gated even if discovered by an automation.

## API Surface

Recommended initial endpoints:

### Definitions

- `GET /automations`
- `POST /automations`
- `GET /automations/:id`
- `PATCH /automations/:id`
- `POST /automations/:id/pause`
- `POST /automations/:id/resume`
- `POST /automations/:id/run-now`

### Runs and snapshots

- `GET /automations/:id/runs`
- `GET /automations/:id/snapshots`
- `GET /automations/feed`

### Approvals

- `GET /automations/approvals`
- `POST /automations/approvals/:id/approve`
- `POST /automations/approvals/:id/reject`

## UI Surface

Add one new top-level surface:

- `Scheduled`

Recommended sections:

### Scheduled

- saved workflow cards
- latest snapshot
- next run
- pending approvals

### Create scheduled workflow

Flow:

1. pick workflow
2. fill typed config
3. choose schedule
4. choose approval mode
5. save

### Fresh for you

Compact homepage strip:

- top 3 latest fresh snapshots
- approvals needing action

## Relationship To Current Magic City Architecture

This spec fits the current codebase well because Magic City already has:

- workflow definitions in `workflowRegistry`
- execution sessions and local workers
- connected-account policies
- wallet/payment authorization objects
- background queue patterns for sponsored proofs and confirmations

What is missing is:

- durable per-user automation definitions
- durable run history
- latest snapshot rendering model
- a first-class scheduler/worker loop

## Suggested Build Order

### Milestone 1

- Postgres tables
- scheduler loop
- reminder automation
- wallet confirmation automation
- minimal `Scheduled` UI

### Milestone 2

- travel watch snapshots
- GitHub watch snapshots
- approvals table + UI
- homepage `Fresh for you`

### Milestone 3

- meeting follow-through
- spreadsheet recurring cleanup
- MCP exposure for scheduled workflows

### Milestone 4

- job discovery watch
- food reorder/menu watch
- stronger admin diagnostics

## ZK / Zeko Fit

This model fits the existing Magic City thesis cleanly:

- ZK remains the privacy + verification layer
- Zeko remains the automation + coordination layer

For scheduled workflows later, Zeko can anchor:

- approval decisions
- snapshot attestations
- payment authorization outcomes
- workflow completion claims

But that should remain off the critical path for the user-facing refresh loop.

## Recommendation

Build scheduled workflows now, but start with:

1. reminder
2. wallet confirmation
3. travel watch
4. GitHub watch

That gives Magic City recurring value without immediately stepping into the hardest unattended side-effect problems.

Once those four are solid, the automation surface becomes one of the strongest parts of the product.
