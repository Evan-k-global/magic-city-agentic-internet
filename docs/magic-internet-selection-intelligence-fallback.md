# Magic Internet Agent selection intelligence fallback

This optional fallback is limited to Amazon product selection. It does not run during startup, cart reconciliation, checkout, payment, recovery, or final submission.

## Runtime behavior

1. The Runner performs the existing deterministic card scan.
2. Exact verified matches continue immediately with no model request.
3. After a clean no-mutation abstention, deterministic checks build at most 12 candidates that already satisfy package, price, budget, and fulfillment rules.
4. OpenRouter receives only the signed product wording plus each observed candidate's ID and title. It may select one supplied ID, request clarification, or abstain.
5. Before any Add to Cart click, the Runner rescans the current page and requires the same candidate ID, ASIN, title, package facts, price, and fulfillment evidence.

The request contains only the signed product brief and bounded public product facts. It excludes URLs, account data, addresses, payment data, cookies, and unrelated page content. The model cannot create a candidate or expand mission authority.

## Limits

- One consultation per signed selection action, persisted for replay and restart deduplication.
- At most three consultations per mission.
- Three-second end-to-end Runner deadline, including response-body reading.
- No automatic model retry.
- 4 KB response limit and 100 output-token cap.
- Bounded server concurrency; excess work returns review immediately instead of queuing.
- Responses are bound to session, plan, action, and the normalized observed-candidate snapshot.

## Configuration

The feature is disabled by default:

```env
MAGIC_CITY_AMAZON_SELECTION_INTELLIGENCE_ENABLED=false
MAGIC_CITY_BROWSER_RANK_MODEL=
MAGIC_CITY_BROWSER_RANK_TIMEOUT_MS=3000
MAGIC_CITY_BROWSER_RANK_MAX_CONCURRENCY=4
```

It also requires a configured OpenRouter provider in `AI_PROVIDER_CONFIG` and its API key. Readiness does not make a separate provider health-check request.

Enable only after the matching Runner version is published and available. Disabling the flag restores the deterministic path without an extension rollback.

## Local verification

```bash
npm run test:amazon-selection-intelligence-provider
npm run test:native-runner-selection-intelligence
node scripts/test-amazon-selection-production-shadow.mjs
npm run smoke:native-runner-extension-package
```
