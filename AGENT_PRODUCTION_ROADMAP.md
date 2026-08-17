# Agent Production Roadmap

This document turns the three experimental lanes into an execution plan we can actually ship against:

- `developer-tools-agent` -> GitHub execution lane
- `travel-agent` -> travel concierge
- `job-application-agent` -> adapter-first ATS lane

The goal is not to make them sound better. The goal is to narrow each promise until the lane can be reliable, measurable, and safe enough to remove the `Experimental` label.

## Production Bar

Every lane must clear these before it becomes a core workflow:

1. Clear promise
- one sentence the user can trust
- no hidden caveats in the last mile

2. Deterministic terminal state
- `completed`
- `needs_review`
- `failed`
- no vague "maybe done"

3. Idempotent side effects
- no duplicate apply/submit/push side effects
- no duplicate funding or duplicate merchant settlement

4. Capability-scoped permissions
- only request permissions needed for the lane
- allow review-gated and auto modes
- full revoke path

5. Replayable eval harness
- fixed fixtures
- success/failure reasons
- latency and duplicate-side-effect tracking

6. Durable outcome artifact
- patch, PR, job packet, or concierge package
- user can reopen it and continue from it later

## Graduation Order

Recommended order:

1. `developer-tools-agent`
2. `job-application-agent`
3. `travel-agent`

Why:
- developer can become truly end-to-end fastest with GitHub
- job has high value, but needs adapter discipline
- travel is strongest when re-scoped, not over-automated

## Lane 1: Developer -> GitHub Execution

### Production Promise

Magic City can take a scoped GitHub task, prepare a safe patch, and return a reviewable artifact or PR draft.

### What We Stop Pretending

- not a general "developer tool recommender"
- not a repo search card
- not "autonomous software engineer" without repo-level controls

### Supported Modes

1. Review only
- inspect issue/PR/repo and return a plan + risk notes

2. Draft patch
- generate a patch artifact against an allowed repo/branch

3. Draft PR
- push a branch and create a PR draft only after explicit approval

### Required Connectors

1. GitHub
- repo read
- issue read/write
- PR read/write
- branch/commit/push with repo allowlist

### Success Metrics

Core launch metrics:

1. `task_success_rate >= 90%`
- for benchmarked patch tasks that end in either:
  - valid patch artifact
  - or valid PR draft

2. `unsafe_write_rate <= 0.1%`
- writes outside allowed repo/branch scope

3. `duplicate_pr_rate <= 0.5%`

4. `median_time_to_first_artifact <= 45s`

### Exact Code Changes

1. Add GitHub connected-account policy surface
- scopes, repo allowlist, branch prefix, PR-only mode
- files:
  - `public/index.html`
  - `src/server.js`
  - `src/store.js`

2. Replace `localDeveloperToolsPlugin` recommendation logic with task execution modes
- parse GitHub issue/PR/repo task
- produce:
  - review artifact
  - patch artifact
  - optional PR draft handoff
- files:
  - `src/localDeveloperToolsPlugin.js`
  - `src/knowledgeWorkExecution.js`
  - `src/executionArtifacts.js`

3. Add GitHub MCP/server path
- so remote MCP users can invoke only safe GitHub execution verbs
- files:
  - `src/magicCityMcpCore.js`
  - `src/server.js`

4. Add eval harness
- fixture repos/tasks
- patch validity checks
- regression scoreboard

### Ship Gate

Remove `Experimental` only after:
- GitHub connected account is live
- repo allowlists work
- patch artifact path is stable
- PR draft path is review-gated and idempotent

## Lane 2: Jobs -> ATS-First Application Runner

### Production Promise

Magic City finds matching jobs, pre-fills applications on supported ATSes, auto-submits the simple ones, and queues the rest for review.

### What We Stop Pretending

- not universal job automation
- not generic browser optimism across every site
- not zero-click apply on login-gated or captcha-heavy flows

### Supported ATSes

Production v1 should support only:

1. Greenhouse
2. Lever
3. Workable
4. Ashby

Everything else stays fallback or unsupported.

### Supported Modes

1. Prepare for review
- always available

2. Auto-submit simple forms
- only for supported ATSes and safe field sets

3. Skip unsupported flows
- explicit terminal state, not silent failure

### Required Inputs

Structured applicant profile, not just a resume blob:

1. resume
2. name
3. email
4. phone
5. location
6. work authorization
7. visa sponsorship preference
8. LinkedIn
9. portfolio
10. compensation floor
11. relocation preference
12. default cover-letter variants

### Success Metrics

1. `supported_ats_success_rate >= 80%`
- result is either:
  - `submitted`
  - or `prepared_for_review`

2. `duplicate_application_rate <= 1%`

3. `unsupported_flow_label_rate >= 95%`
- unsupported flows must terminate honestly as:
  - `login_required`
  - `captcha`
  - `unsupported_form`
  - `needs_review`

4. `median_time_to_application_packet <= 60s`

### Exact Code Changes

1. Split job execution by adapter
- `browserExecution.js` should route by ATS type first
- generic fallback becomes last resort

2. Add ATS adapters
- files:
  - `src/browserExecution.js`
  - new adapter helpers under `src/` if needed

3. Add application memory and duplicate guard
- per user:
  - role URL attempted
  - submission state
  - last attempt time
- files:
  - `src/store.js`
  - `src/server.js`

4. Upgrade job profile model
- save structured applicant data locally/private
- files:
  - `public/index.html`
  - `src/connectors.js`
  - `src/knowledgeWorkExecution.js`

5. Make result states explicit
- `submitted`
- `prepared_for_review`
- `login_required`
- `unsupported_form`
- `captcha_blocked`
- files:
  - `src/localJobApplicationPlugin.js`
  - `src/executionRuntime.js`

### Ship Gate

Remove `Experimental` only for supported ATSes.
Generic web apply can remain hidden behind `Advanced` until it meets the same bar.

## Lane 3: Travel -> Concierge

### Production Promise

Magic City finds the best bookable live travel search and gives the user a fast, clear booking handoff.

### What We Stop Pretending

- not airline checkout automation
- not "books your trip end to end"
- not browser-clicking all the way through volatile airline flows

### Product Shape

Travel becomes a concierge lane:

1. best flight search
2. best stay search
3. comparison artifact
4. saved links
5. optional calendar follow-through

### Supported Outcomes

1. Live flight search ready
2. Live stay search ready
3. Comparison package ready
4. Needs review

### Success Metrics

1. `useful_result_rate >= 95%`
- ends in a useful live search or comparison package

2. `median_time_to_handoff <= 30s`

3. `broken_link_rate <= 1%`

4. `destination_resolution_accuracy >= 95%`

### Exact Code Changes

1. Re-scope UI and copy to concierge
- done partially now
- continue through result cards and approval text
- files:
  - `public/index.html`
  - `src/providers.js`
  - `src/connectors.js`

2. Provider-grade search templates
- Google Flights
- airline deep links where reliable
- hotel/stay links
- files:
  - `src/browserExecution.js`
  - `src/localTravelPlugin.js`

3. Better travel memory
- home airport
- loyalty hints
- budget
- trip style
- local/private storage first

4. Comparison artifact with normalized tradeoffs
- price
- duration
- stop count
- arrival/departure quality

### Ship Gate

Remove `Experimental` only when the lane consistently reaches:
- `live_search_ready`
- or `comparison_ready`

Do not require direct booking automation for graduation.

## Shared Infrastructure Work

These changes benefit all three lanes:

### 1. Eval Harness

Add lane-specific fixtures and replay tests.

Files:
- new eval scripts or harness under repo tooling
- optional storage additions in `src/store.js`

### 2. Capability Policies

Each lane needs:
- connected-account scopes
- review-gated mode
- auto mode
- allowlists
- revoke path

### 3. Better Terminal Statuses

Every lane should only emit:
- `completed`
- `needs_review`
- `failed`

And map browser/provider sub-states underneath that, not instead of it.

### 4. MCP Exposure Discipline

Remote MCP should expose only production-safe verbs.
Experimental-only actions stay internal until they meet the production bar.

## Immediate Execution Plan

If we want one lane out of `Experimental` first, do this order:

1. Developer GitHub execution
- highest chance of a real end-to-end lane

2. Job ATS adapters
- Greenhouse + Lever first

3. Travel concierge polish
- fast, useful, honest handoff

## First Milestone

The first graduation target should be:

`developer-tools-agent` -> `GitHub execution`

Definition of done:

1. GitHub connected account exists
2. user can authorize one repo
3. Magic City can produce a review artifact and a patch artifact
4. optional PR draft is approval-gated
5. lane passes replayed benchmark tasks at the production bar
