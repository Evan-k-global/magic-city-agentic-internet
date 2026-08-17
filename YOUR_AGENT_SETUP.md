# Your Agent Setup

`Your Agent` is the user-owned runtime that works alongside Magic City.

The important split is:
- Magic City handles planning, routing, shared workflows, credits, and marketplace behavior.
- Your Agent keeps local browser continuity, wallet prompts, private context, and on-device follow-through.

## What to configure in Magic City

In `Settings -> Your Agent`, set:
- `Enable Your Agent`
- `Agent name`
- `Agent ID`
- `Runtime`
- `Funding source`
- `Autonomy mode`
- `Credits budget`
- `Per-task cap`
- `Daily cap`
- account / wallet / marketplace permissions
- marketplace reserve

Magic City then exposes:
- your agent identity
- the Magic City MCP endpoint
- a runtime registration token
- a poll URL for queued job and pitch-review handoffs
- a callback URL for reporting ATS/browser progress back into Magic City
- the policy envelope for credits, accounts, wallet actions, and marketplace access

## Runtime choices

### 1. OpenClaw local runtime
Use this when the user wants their own agent to run on their machine.

Recommended for:
- browser-heavy flows
- travel checkout continuity
- local wallet prompts
- local context and private data

What to wire:
- run a local OpenClaw-style runtime on the user's machine
- connect it to the Magic City MCP endpoint shown in settings
- register the runtime from the settings payload so it gets a runtime token, poll URL, and callback URL
- poll Magic City for prepared job sessions when you want the local agent to take over the brittle ATS/browser tail
- poll Magic City for prepared pitch-review sessions when you want the local agent to open DocSend locally
- send progress back through the callback URL so the per-job ledger or pitch review state updates in Magic City
- use the Agent ID from settings as the agent identity when the runtime registers or authenticates

Reference runner:
- `/Users/evankereiakes/Documents/Codex/agent-verification/src/referenceYourAgentRuntime.js`
- start it with:
  - `MAGIC_CITY_AGENT_RUNTIME_TOKEN=... node src/referenceYourAgentRuntime.js`

Runtime queue now covers:
- job application ATS/browser continuation
- DocSend-first pitch review continuation
- travel checkout continuation when `Your Agent` is selected for the checkout handoff

Pitch-review callback shape:
- `POST /your-agent/runtime/callback`
- include:
  - `sessionId`
  - `note`
  - `pitchReview`
- example payload:
```json
{
  "sessionId": "session_123",
  "note": "Opened the DocSend link locally and prepared a review package.",
  "pitchReview": {
    "status": "ready_for_review",
    "readMode": "your_agent_docsend_handoff",
    "readSummary": "Your Agent opened the live DocSend page locally and summarized it back into Magic City.",
    "memo": "# Investor memo\n\n...",
    "objections": "# Investor objections\n\n...",
    "rewriteAdvice": "# Rewrite advice\n\n...",
    "nextSteps": "# Next steps\n\n...",
    "nextHumanAction": "Review the memo, tighten the deck, and rerun if needed."
  }
}
```

Travel callback shape:
- `POST /your-agent/runtime/callback`
- include:
  - `sessionId`
  - `note`
  - `travelUpdate`
- example payload:
```json
{
  "sessionId": "session_456",
  "note": "Opened the live supplier links locally and prepared the checkout continuation.",
  "travelUpdate": {
    "status": "ready_for_review",
    "bookingStatus": "checkout_prepared_for_review",
    "confirmationState": "supplier_review_required",
    "nextHumanAction": "Review the prepared supplier tabs and complete the final purchase if you still want this trip.",
    "travelLinks": [
      {
        "label": "Open supplier checkout",
        "url": "https://example.com/checkout"
      }
    ],
    "summary": "# Travel checkout summary\n\n..."
  }
}
```

### 2. Remote MCP worker
Use this when the user already has a hosted agent runtime.

What to wire:
- point the worker at Magic City's MCP endpoint
- register the worker so it receives the runtime token and callback/poll URLs
- configure the worker to use the Agent ID from settings
- enforce the same budget and approval policy from Magic City

### 3. Marketplace-ready envelope
Use this when the user wants a policy and budget envelope first, before attaching a full runtime.

This is the path that will later let marketplace agents act within:
- the user's agent budget
- the user's approval policy
- the user's connected-account and wallet permissions

## Recommended first use cases

Start with:
- travel follow-through
- food handoff continuity
- browser-based checkout flows
- DocSend / browser-gated pitch review
- wallet-backed payment approvals

These benefit the most from a user-owned local runtime.

## Funding model

There are 2 separate lanes:

### A. Buy credits for yourself
This lives in `Wallet + Credits`.

Use:
- Stripe
- on-chain USDC

### B. Budget your own agent
This lives in `Your Agent`.

Use this to decide:
- how many credits the agent can spend
- per-task cap
- daily cap
- whether it always asks, asks above cap, or can act within policy

## Recommended deployable envelope

Start with:
- `Funding source`: `Magic City balance`
- `Autonomy mode`: `Ask above cap`
- `Credits budget`: your current available credits or a smaller test budget
- `Wallet actions`: off by default unless you want explicit wallet-request handoff

That gives you a real, named personal agent surface without overcommitting to full autonomy too early.

## Good default policy

For an alpha user agent:
- credits spend: on
- connected accounts: on only if the user wants direct Google/GitHub follow-through
- wallet actions: off by default, or on with review
- marketplace access: off by default
- review required: on above cap

## What Magic City should send into execution

When a session is created or started, Magic City should pass through:
- agent name
- agent ID
- runtime type
- MCP endpoint
- budget/caps
- policy flags

That lets execution agents and future marketplace workers treat `Your Agent` as the preferred local handoff when it improves continuity.
