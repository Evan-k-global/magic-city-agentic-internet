# Model Access For Custom Helpers

A partner-owned helper can consult a local or cloud model while executing a
Magic City-compatible mission. The model supplies bounded judgment. It does not
receive or expand mission authority, and it does not return executable browser
code.

This is a partner starter feature. It does not change Magic City's production
Runner, Magic Internet Agent, signed protocol fields or normal execution path.
The checked-in starter keeps the adapter disabled.

## Supported Starter Path

The simplest production shape is:

```text
partner extension
  -> authenticated partner control-plane route
  -> local model or cloud model
  <- structured advisory decision
  -> extension revalidates observation and mission authority
```

The partner control plane already has an authenticated relationship with the
paired helper. It can keep cloud-provider keys server-side or call a model on
the same private machine or network. The extension needs no additional release
host permission because the adapter route shares `controlPlaneOrigin`.

Enable the packaged adapter in the partner build configuration:

```json
{
  "modelAdapter": {
    "mode": "control_plane",
    "path": "/partner/model/consult",
    "modelId": "partner-selection-model",
    "timeoutMs": 15000,
    "allowedQueryParameters": ["q"]
  }
}
```

`path` must remain relative to the configured control plane. `timeoutMs` is
bounded to 1-20 seconds and covers response headers plus the complete response
body. Responses larger than 64 KiB are rejected. Query parameters default to
none; list only the exact keys the model needs. URL credentials and fragments
are always removed. The starter does not contain a provider API key, general
model proxy or implementation of that partner-owned server route.

## Packaged Client Contract

`examples/custom-helper-extension-starter/model-adapter.js` exports
`consultPartnerModel()`. A partner can import it in `background.js` and call it
from its own `executeSession()` implementation after deterministic extraction:

```js
import { consultPartnerModel } from './model-adapter.js';

const config = await getConfig();
const consultation = await consultPartnerModel({
  config: PARTNER_CONFIG.modelAdapter,
  controlPlaneOrigin: CONTROL_PLANE_ORIGIN,
  bearer: config.deviceToken,
  session,
  planAction,
  purpose: 'select_observed_candidate',
  observation: {
    page: { url, title, heading, description },
    candidates: observedCandidates
  }
});
```

The adapter sends only bounded page metadata and at most 20 structured
candidates. It drops unknown fields, including raw HTML and cookies. Candidate
records contain an ID, title, numeric price or `null`, currency, availability
and a small attribute list. Duplicate normalized candidate IDs are rejected.

Bounded is not the same as redacted. Before calling the adapter, partner code
must remove personal data, secrets and irrelevant content from titles,
headings, descriptions, candidate attributes and allowlisted query values. The
adapter cannot determine whether otherwise valid text contains private data.

The request is `magic-city-helper-model-request-v1` and binds:

- `sessionId`
- `planHash`
- `planActionId`
- `requestId`
- SHA-256 hash of the exact bounded observation
- purpose and partner-configured model ID

The response must use `magic-city-helper-model-response-v1`, echo every binding
and choose one advisory result:

```json
{
  "schema": "magic-city-helper-model-response-v1",
  "requestId": "same request ID",
  "binding": {
    "sessionId": "same session",
    "planHash": "same plan hash",
    "planActionId": "same action"
  },
  "observationHash": "same observation hash",
  "decision": {
    "kind": "select_candidate",
    "candidateId": "candidate-2",
    "confidence": 0.91,
    "reason": "Matches the requested observed variant."
  }
}
```

Allowed decision kinds are `select_candidate`, `abstain` and `request_user`.
An unobserved or duplicate candidate ID, stale action, wrong session, wrong
observation hash, unknown schema, oversized body, timeout or malformed response
is rejected.

## Server Adapter Responsibilities

The authenticated partner route should:

1. Authenticate the helper's device token and confirm it owns the session.
2. Recheck the session, plan hash, next action, cancellation and expiry.
3. Treat page text as untrusted data, not model instructions.
4. Construct a provider-specific prompt from the bounded schema.
5. Require a structured response and return the response envelope above.
6. Log timing and redacted identifiers, never raw secrets or full page content.

The route may call Ollama, another local inference server, or a hosted model.
Provider credentials belong in the control plane or its secret manager. Do not
put them in `partner.config.json`, generated extension files or browser storage.

## Resume And Authority Rules

Model output is advisory. Before any browser mutation, the helper must:

1. Re-read the current tab and compute a fresh bounded observation.
2. Reject the response if the observation hash or candidate set changed.
3. Recheck cancellation, expiry, ordered action ID and target origin.
4. Apply the helper's deterministic product, budget, variant and policy checks.
5. Emit the normal signed checkpoint after the action, then reconcile the
   durable server cursor before retrying after a lost response.

Persist a small pending-consultation record before a long request: session ID,
plan hash, action ID, request ID, observation hash, start time and tab ID. On an
extension-worker restart, re-read the server cursor and page before consulting
again. Never infer that a browser mutation did not happen merely because a
model or checkpoint response was lost.

Use `Consulting model` only as progress. A timeout or `request_user` result must
pause or hand off without advancing the signed action. A model response cannot
authorize a substitution, increase a budget, add a merchant, extend an expired
lease or approve an irreversible action.

## Local Model Alternatives

For local development, run the partner control plane on loopback and let its
adapter route call the local model. Development packages already permit an
exact loopback control-plane origin.

For a distributed production extension that must communicate directly with a
local companion, use Chrome Native Messaging and install an explicitly named
native host for that extension ID. That requires partner-specific installer,
host manifest, authentication and lifecycle work and is not bundled here.

Do not broaden the release packager to arbitrary loopback HTTP. An unauthenticated
localhost model endpoint is not an acceptable production trust boundary.

## First Recommended Capability

Start with read-only candidate selection:

1. Extract a bounded set of candidate facts from an approved page.
2. Ask the model to choose an observed candidate or abstain.
3. Validate the returned candidate against the current page and signed mission.
4. Return the advisory result in a checkpoint or handoff without clicking.

Add mutation only after tests prove malformed responses, prompt injection,
timeouts, cancellation, changed pages, stale responses and extension-worker
restart all fail closed. Model-generated JavaScript, selectors or action lists
must never be executed.

## Release Evidence

Run:

```bash
npm run test:custom-helper-model-adapter
npm run test:custom-helper-extension-packaging
npm run smoke:custom-helper-extension-package
```

Add a partner-owned integration test for the authenticated model route. The
test should use a harmless page, disable browser mutations, restart the worker
during consultation and prove that the response cannot select an unobserved
candidate or advance a stale action.
