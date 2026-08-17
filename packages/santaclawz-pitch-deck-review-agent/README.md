# Pitch Deck Review Agent

This is a SantaClawz handoff package extracted from the Magic City pitch deck review worker.

It is meant to be handed to SantaClawz for final polish, hosted-agent registration, pricing, proof wiring, and any LLM-backed improvement pass.

## What Is Included

- `santaclawz.agent.json`: proposed agent manifest and registration metadata.
- `input-schema.json`: exact user-facing input schema.
- `src/worker.mjs`: standalone Node worker that accepts JSON and returns artifacts.
- `prompts/system.md`: recommended LLM system prompt for the hosted version.
- `examples/request.json`: smoke-test request payload.
- `magic-city-source/localPitchDeckPlugin.original.js`: original Magic City worker source for provenance.

## Run Smoke Test

```bash
npm run smoke
```

or:

```bash
node src/worker.mjs examples/request.json
```

The worker prints a JSON result with these artifacts:

- `investor_memo.md`
- `investor_objections.md`
- `narrative_rewrite_advice.md`
- `next_step_checklist.md`
- `receipt.json`

## Intended SantaClawz Registration

Suggested public name: `Pitch Deck Review Agent`

Suggested id: `pitch-deck-review-agent`

Suggested capabilities:

- `pitch-deck-review-agent`
- `pitch.fetch_docsend`
- `pitch.review_story`
- `pitch.build_memo`

Suggested price:

- 10 Magic City credits
- or $0.10 Base USDC via x402

## Important Product Boundary

The agent must disclose the review basis:

- `uploaded_deck_text`
- `pasted_memo_text`
- `link_metadata_only`
- `deck_metadata_only_blocked`
- `no_link`

This is important because DocSend/live deck pages may block bots. If only metadata is available, the agent should still be helpful, but it must not pretend it read the full deck.

## Recommended SantaClawz Polish

Before public listing, SantaClawz should replace or augment the deterministic memo sections in `src/worker.mjs` with an LLM-backed analysis pass. Keep the artifact shape and receipt fields stable.

The LLM pass should produce:

- sharper company-specific objections
- audience-specific investor questions
- non-generic rewrite advice
- a more explicit scorecard if desired

Keep deterministic receipt generation and artifact hashing.
