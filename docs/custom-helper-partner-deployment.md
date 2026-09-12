# Partner Website And Custom Helper Deployment

This path lets a team build, test and ship its own website, Magic
City-compatible control plane and Chrome helper. It does not modify or replace
Magic City's production Runner, hosted agent, protocol fields or checkout flow.

## Architecture

```text
partner website -> partner control plane -> explicitly assigned mission
                                           |
partner extension <- pair/register/poll/claim/checkpoint/fulfill
                                           |
                                  partner browser behavior
```

The website creates and displays missions through the partner's authenticated
backend. The extension polls the same control-plane origin. Direct web-page to
extension messaging is optional and is not required for a deployable product.
Do not put an administrative API key or runner device token in website code.

## 1. Build An Isolated Extension

Copy `examples/custom-helper-extension-starter/partner.config.example.json` to a
partner-owned path and set:

- `controlPlaneOrigin`: the exact deployed backend origin.
- `launchOrigins`: exact page origins the helper may execute against.
- `optionalMerchantOrigins`: matching Chrome host patterns ending in `/*`.
- `helperPluginId` and `helperOwnerAgentId`: stable non-reserved identities.
- `extensionName` and `extensionDescription`: partner branding.

Build development and release packages separately:

```bash
node scripts/package-custom-helper-extension.mjs \
  --config path/to/partner.config.json \
  --profile development

node scripts/package-custom-helper-extension.mjs \
  --config path/to/partner.config.json \
  --profile release
```

Release builds reject loopback HTTP, paths inside origins and wildcard hosts.
They keep page access optional and user-granted. Development builds pre-authorize
only their exact configured fixture origins so automated local browser tests do
not depend on Chrome's native permission dialog. The build generates the
manifest and bundled `partner-config.js` together, so the visible backend,
network permission and runtime backend cannot drift.

Changing `controlPlaneOrigin` invalidates locally stored pairing state. Pair the
new build to the new backend; never copy a device token between deployments.

## 2. Run The Included Example

The starter performs one real, harmless browser action:

1. Poll an explicitly dispatched helper session.
2. Claim it with the short-lived dispatch nonce and holder public key.
3. Validate the signed plan schema, protocol, hash, first action and target
   origin before opening a tab.
4. Open the allow-listed page after the user grants its exact Chrome host
   permission.
5. Return only URL, title, first heading and meta description in a signed
   checkpoint and JSON result.
6. Stop before the next unsupported shopping action.

It does not read page HTML, credentials, cookies, local storage, payment fields
or checkout state. It advertises no cart or purchase capability.

Run both repository gates:

```bash
npm run test:custom-helper-extension-packaging
npm run smoke:custom-helper-extension-package
```

The packaging test proves partner origins do not leak Magic City production or
localhost permissions into a release build and confirms production Runner files
are unchanged. The browser smoke loads the generated ZIP, pairs it to an
isolated local server, opens an intercepted partner fixture and verifies the
signed result and terminal handoff.

## 3. Deploy The Partner Control Plane And Website

Deploy the current source using fresh infrastructure and identities described
in `docs/partner-white-label-quickstart.md`. At minimum use a new database,
state-encryption key, mission-authorization signing identity, login/session
configuration and public origin. Keep optional SantaClawz, payment, relayer and
chain integrations disabled until separately configured and tested.

The partner website should use its own authenticated backend to:

- Create a session with the partner `preferredExecutionAgentId`.
- Collect and validate user inputs.
- Request execution only after an explicit user action.
- Display redacted session progress, handoffs, outputs and receipts.
- Cancel the existing session rather than creating replacement work.

The extension remains independently installed and paired. The popup is a valid
initial launch mechanism. A direct website launch/status bridge can be added
later with exact `externally_connectable` origins and session-bound messages;
it is not part of this starter and must not be approximated with broad CORS or
wildcard website messaging.

## 4. Add Partner Browser Intelligence

Use the production Magic Internet Agent only as a behavior reference. Implement
the partner's own adapters inside `executeSession()` and add capabilities only
after their tests pass.

For reversible actions, preserve:

- Signed plan schema, plan hash, ordered action ID and target-domain checks.
- Cancellation and expiry checks before every browser mutation.
- Redacted checkpoints and server cursor reconciliation after lost responses.
- Deterministic fixtures for changed or contradictory page state.

Before implementing cart or checkout, reproduce the relevant safeguards from
the Runner reference map in `docs/partner-white-label-quickstart.md`. An
irreversible action additionally needs scoped final authority, exact item/price/
quantity verification, durable intent and dispatch receipts, and a no-replay
test at every interruption boundary.

## Honest Product Claim

After completing its own browser adapters and release tests, a partner can say:

> Build and deploy your own browser helper and website using Magic City's
> mission authorization, dispatch, signed checkpoint and receipt protocol.

The included starter proves that integration boundary. It is not a turnkey
shopping agent, and protocol-compatible receipts do not make arbitrary installed
extension code trustworthy. The partner remains responsible for its browser
behavior, permissions, privacy disclosures, merchant tests and release review.

## Production Isolation

This partner path uses only `examples/custom-helper-extension-starter/`, its
packaging/smoke scripts and documentation. It does not rebuild, re-version or
publish `public/native-runner/extension/`, change the Magic Internet Agent, or
broaden production origin allow-lists.
