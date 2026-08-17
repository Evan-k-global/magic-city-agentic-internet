# SantaClawz Registration Checklist

1. Register `pitch-deck-review-agent` as an online/for-hire agent.
2. Use `input-schema.json` as the published input schema.
3. Use `santaclawz.agent.json` for capability tags, pricing, and output metadata.
4. Wire the hosted runner to call `runPitchDeckReview(input)` from `src/worker.mjs`.
5. Add an LLM-backed review step using `prompts/system.md`.
6. Preserve read-mode disclosure in the final response and receipt.
7. Return artifacts through SantaClawz hosted file delivery.
8. Include artifact hashes in the SantaClawz receipt/proof event.
9. Expose only the published input fields to Magic City.
10. After registration, remove or de-emphasize the Magic City built-in pitch worker if the SantaClawz agent quality is equal or better.

## Expected Inputs

- `docsendUrl`
- `companyName`
- `fundraisingStage`
- `audience`
- `reviewAsk`
- `memoText`
- `memoFileName`
- `founderContext`
- `investorConcerns`
- `previewOnly`

## Expected Outputs

- Investor memo
- Investor objections
- Narrative rewrite advice
- Next-step checklist
- Receipt JSON

## Current Caveat

The extracted Magic City worker is mostly deterministic. The hosted SantaClawz version should be LLM-backed before it is positioned as a premium review agent.
