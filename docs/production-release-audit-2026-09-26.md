# Production release audit — 2026-09-26

Internal security review. Keep detailed reproductions internal until remediation and disclosure decisions are complete.

## Remediation update — 2026-09-26

The findings below are the **historical assessment of `0343e76`**, not the
status of the subsequent remediation. Practical application fixes are now
implemented. The 13 previously failing checks and five protected-route controls
pass against a real disposable PostgreSQL production-profile fixture, along
with legitimate-owner and cross-account cases. The complete 41-scenario browser
matrix, including active-port restart recovery, passes after isolating that
test's inherited fixture state. Runner source is unchanged.

See [remediation and deployment requirements](enterprise-security-remediation-2026-09-26.md)
for the current evidence and remaining operator checks. The unsafe Docker copy
rule is removed and exclusion tests pass, but a built-image inspection could
not run because the local Docker daemon is unavailable. This is code-level
remediation, **not approval of an untested production configuration or image**.

## Historical decision: NO-GO for `0343e76`

Audited candidate: `0343e76`, branch `harden-partner-deployment-20260925`, following hardening commit `54b3edb`; original baseline `de62bb4`.

The prior hardening and browser regression suites pass, but newly added negative security probes reproduce authorization and accounting failures under the **production deployment profile with real disposable PostgreSQL**. Do not release this candidate as cleared of high vulnerabilities. No critical exploit was established; that is not a guarantee that none exists.

This audit added tests and this report only. Application source, dependencies, Runner, contracts, and production were not changed. No real payment, purchase, or chain transaction was initiated. Findings below concern this local candidate; live exposure and deployed configuration were not tested.

## Historical auditor reassessment (before remediation)

**Remediation status: NOT DONE. Release authorization: WITHHELD.** The follow-up inspection found no application changes since the findings were reproduced. A fresh execution of the production-profile probes again failed all 13 recorded cases. Recording a finding or adding its regression test is not remediation.

Exact assessed revision: `0343e76a45993c7d23e8476cce2ee69e62fd5a0f`. The separate local main checkout is at `45b4b3f` with unrelated uncommitted changes; it is not a descendant of the hardening revision. This assessment must not be represented as clearance of that checkout, a deployed image, or an unspecified latest ZIP. Those changes were left untouched.

| Finding | Security property / classification | Evidence confidence | Closure status |
| --- | --- | --- | --- |
| R1 | High: account authorization / CWE-862 | Confirmed local production-profile credit reservation | Open |
| R2 | High: integrity of financial/provenance records / CWE-862 | Confirmed local unauthorized mutations | Open |
| R3 | High: private-record ownership / CWE-862, CWE-200 | Confirmed local data disclosure | Open |
| R4 | High conditional: payment settlement validation / CWE-841 | Confirmed accounting error with an authentic synthetic event; attacker reachability depends on payment flows | Open |
| R5 | High: vulnerable production components | Confirmed lockfile/advisory match; application exploitability not established | Open |
| R6 | High conditional: credential packaging / CWE-538 | Confirmed unsafe build rule; actual secret exposure not established | Open |

No critical exploit was demonstrated. This is **not** a critical-free certification, nor are the six grouped release issues six independently demonstrated high-severity remote exploits. The severity distinction and prerequisites above are intentional.

Follow-up method: inspected the candidate and branch divergence; reran the isolated authorization/accounting probes and npm production dependency audit; reinspected ownership aliases, privileged payout/relayer guards, OAuth code/refresh lifecycle, signup identity handling, proof endpoints, artifact access, and container configuration. Ten focused account/payment, deployment, Runner security, mission, final-review, receipt, artifact privacy, and partner-model/privacy suites passed again. Five additional read-only control checks correctly denied anonymous intent, receipt-proof, escrow, payout-list, and ledger access, while the 13 bypass/accounting cases still failed. This confirms the fixture did not simply disable all authentication. The dependency scan again returned zero critical, two high, and one moderate package records. The prior network-configuration assertion drift remains unresolved.

**Fresh full-browser rerun: failed, not 41/41 green.** It reached the final active-port disconnection / MV3 worker-restart scenario and timed out at `scripts/smoke-native-runner-extension-browser.mjs:5992` with `browser_extension_active_port_disconnect_recovery_timeout`. The captured synthetic run remained at read-only `confirm-disconnected-order`, with startup/navigation checkpoints but no confirmation completion in the 60-second test window. The earlier 41/41 pass remains historical evidence only. Runner source has not changed in the hardening delta. The cause is not established: isolate fixture timing versus actual restart-recovery behavior; do not increase timeouts or claim a fix merely to obtain a passing run. No new security bypass or repeated order click was demonstrated by this timeout. It is an additional reliability-validation blocker.

Release sign-off requires evidence tied to **one immutable candidate**: remediation diffs; passing negative and legitimate-user tests; an acceptable production dependency scan; secret-free image validation; production-profile staging verification; regression results for that same revision; and the final image/package hashes. A waiver is not equivalent to meeting the user's requested zero-known-critical/high release gate. Independent external assessment is still appropriate before handling external-client funds or sensitive enterprise data.

## Release blockers

### R1 — High: anonymous requester impersonation can reserve another account's credits

Locations: `src/server.js:1474` (`resolveRequesterIdentity`), `:22990` (`POST /intent`), `:23118` (credit locking). The streaming intent route at `:22493` uses the same identity pattern and needs coverage too.

The resolver rejects a supplied requester ID that conflicts with an authenticated user, but accepts a supplied identity when there is **no authenticated user**. A synthetic anonymous request naming the fixture owner's email returned HTTP 201 and reserved two of that owner's credits.

Required repair: derive account ownership from authenticated context for funded/owned operations. Reject anonymous asserted identities; separate any supported free anonymous workflow from registered-account balances. Trusted service delegation must have explicit scope, not authority inferred from an email string. Cover anonymous, wrong-owner, valid-owner, streaming, retry, and cancellation paths. Do not change signed checkout authority or weaken existing checks.

### R2 — High: legacy financial and provenance mutations lack caller authority

Locations: `src/server.js:22234` (attestations), `:22254` (stake), `:22269` (slash), `:27011` and `:27031` (disputes), `:27130` (faucet).

Production-profile probes anonymously created ten internal stake credits, slashed three, attached an arbitrary issuer attestation, opened and resolved a dispute with a further two-credit slash, and requested faucet credits repeatedly (25 additional credits on the second request).

These are demonstrated **internal ledger/provenance mutations**, not demonstrated theft of on-chain collateral or a bypass of the newly protected payout endpoint.

Required repair: disable demo minting/faucet routes in production; require independently verified funding for real stake, appropriate owner authority for dispute opening, and authorized arbitrator/admin authority for resolution and slashing. Bind attestation issuers to verified authority. Check every route that mutates the same underlying records, not just these handlers. Preserve legitimate authenticated flows in positive tests.

### R3 — High: alternate routes bypass private-record access controls

Locations: `src/server.js:22212` (agent receipt listing), `:26772` (billing account), `:26839` (stale-lock reconciliation), `:27123` (ACP intent read).

Confirmed anonymously:

- Account balance, lock/history response is accessible by supplying the account email.
- The ACP intent alias returns an owner-created intent containing synthetic private context.
- The agent receipt list returns a receipt explicitly marked private, including its private metadata marker.
- Stale-lock reconciliation accepts an anonymous account email (HTTP 200). This fixture did not contain a stale lock, so an actual stale-lock release was **not** demonstrated.

Required repair: consistently enforce ownership on list, detail, alias, and account-mutation routes. If a public listing is needed, return an explicitly redacted public projection that excludes private records and fields. Test both denial and public-redaction behavior, plus successful owner reads. A public 200 response is acceptable only when its contents actually satisfy that public contract.

### R4 — High, conditional payment-flow risk: unpaid Stripe completion credits the account

Location: `src/server.js:26634–26700`, especially the `checkout.session.completed` handler at `:26649` and credit mutation at `:26674`.

A correctly HMAC-signed **synthetic test event** with `payment_status: unpaid`, `amount_total: 0`, and metadata requesting 100 credits increased the fixture balance by 100. Signature verification itself was not bypassed. This does not demonstrate that an external caller can forge Stripe events; current checkout is card-only, and live exploitability depends on event/payment flows. The missing settled-payment invariant is nevertheless a release blocker.

Required repair: credit only a paid payment matching the server-prepared session, owner, currency, amount, expected Stripe account, and mode. Do not accept metadata alone as the settlement authority. Keep Connect events separated from platform top-ups. Explicitly handle any supported asynchronous settlement flow. Preserve session/event idempotency and durable accounting. Test unpaid, failed, cancelled, wrong amount/currency/account, duplicate event IDs, distinct events for one session, and valid paid settlement.

### R5 — High dependency advisories remain in the production lockfile

Fresh `npm audit --omit=dev`: **0 critical, 2 high package records, 1 moderate**. This counts package records, not distinct application exploits.

- `ws@8.17.1`, via `ethers@6.16.0`: [memory-exhaustion DoS](https://github.com/advisories/GHSA-96hv-2xvq-fx4p); also [uninitialized-memory disclosure](https://github.com/advisories/GHSA-58qx-3vcg-4xpx). Registry metadata checked during this audit shows `ethers@6.17.0` pins `ws@8.21.0`.
- `xlsx@0.18.5`: [prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and [ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9). The npm package still reports 0.18.5 and the audit reports no registry fix.

Observed spreadsheet usage is workbook export; a reachable malicious-file parsing exploit was not established. A reachable WebSocket exploit was also not established. Both vulnerable packages are nevertheless in the production dependency set and fail the requested known-high release gate.

Required repair: review and pin an updated ethers dependency; replace, remove from the released surface, or obtain a verified patched distribution for SheetJS. Do not use an unreviewed download or blanket `npm audit fix --force`. Test a fresh isolated install, payment-signature/receipt behavior, spreadsheet output, and the complete security/regression suites. Do not mutate the shared `node_modules` symlink when testing dependency changes.

### R6 — High conditional secret-packaging risk: environment files enter the image

Locations: `Dockerfile:10` (`COPY env ./env`), `.dockerignore`, and `src/securityBootstrap.js:6` (loads provider/payment/OAuth environment files).

The Docker build copies `env/`, while the ignore file does not exclude credential environment files. Untracked files still enter Docker build contexts. If deployment credentials are supplied through those files, they can be embedded in image layers and exposed to image/build access. No real secret value was read or printed and no live image leak was established.

Required repair: remove credential-file copying, explicitly exclude secrets from build contexts, and inject them at runtime. Verify with synthetic secret markers in a staging build context and resulting image layers. Rotate only credentials shown to have been exposed, using a planned migration that preserves active sessions and signing compatibility where appropriate.

## Verification performed

| Check | Result |
| --- | --- |
| Full Runner browser fixture matrix, initial pass | **41/41 passed** on the same candidate |
| Full Runner browser fixture matrix, final reassessment | **Failed** at active-port disconnect / worker-restart recovery; initial success does not override this result |
| 20 focused account/payment, deployment, pairing, Runner security, mission, final-review, terminal, receipt, approval, persistence, SantaClawz, selection, artifact privacy, and custom-helper regressions | **Passed** |
| Existing production security integration with real temporary PostgreSQL | **Passed** |
| New production-profile authorization/accounting probes | **13 failed assertions**; these are cases across the grouped findings, not 13 separate high vulnerabilities |
| Follow-up read-only protected-route controls | **5/5 passed**; anonymous reads correctly denied on guarded counterparts |
| Background mission anchoring | **Passed**, mocked relayer; run response 7 ms in this local fixture, asynchronous outage policy and retry preserved |
| Mission authorization registry signature | **Passed**, local simulated blockchain with proofs disabled; not a proof-generation or live-chain benchmark |
| Network-split configuration regression | **Failed**, pre-existing assertion drift described below |
| Production dependency audit | **Failed**, 2 high / 1 moderate package records |

The network-split script still asserts `SANTACLAWZ_PROOF_NETWORK=zeko:testnet`, whereas `.env.example` already used `zeko:sepolia` at baseline `de62bb4`. The script is unchanged between that baseline and this candidate. Confirm the intended network semantics and correct the fixture/assertions; do not revert working network configuration merely to satisfy a stale test. Subsequent assertions in that failed script were not reached.

Detailed synthetic results: [route-boundaries.json](../artifacts/enterprise-release-audit-2026-09-26/route-boundaries.json).

Reproduce the new release gate, with a local PostgreSQL installation:

```sh
MAGIC_CITY_AUDIT_RELEASE_ROUTES=1 TEST_POSTGRES_BIN=/path/to/postgresql/bin node scripts/test-production-security-integration.mjs
```

This creates its own temporary database and credentials; it does not use the caller's `DATABASE_URL`. Current expected process result is nonzero with `release_gate_failed:13_route_boundary_checks:0_control_failures`. The baseline integration suite runs without `MAGIC_CITY_AUDIT_RELEASE_ROUTES`.

## Closeout requirements

1. Patch server authorization/ownership and production demo routes first; protect all aliases and mutations. Keep browser selection, cart, payment UI, and final-submit logic untouched.
2. Repair Stripe settlement binding, dependencies, and secret packaging with targeted regressions.
3. Rerun all negative cases and positive legitimate-account/service flows; expand the route access matrix beyond the demonstrated cases. The new probe suite is a reproducer, not an exhaustive inventory.
4. Resolve the pre-existing configuration regression, run a fresh dependency install/audit, rerun the 41-case browser suite and protocol suites, and inspect the final diff.
5. Verify deployment actually enables `DEPLOYMENT_PROFILE=production`. `NODE_ENV=production` alone does not enable it; the checked-in Fly configuration sets the latter, but live secret/config state was not inspected. Complete staging rollout and rollback checks before a separately authorized deployment.

## Limits of this assessment

This is an internal source/dependency audit and targeted local regression pass, not an independent penetration test, comprehensive route fuzzing, formal circuit verification, or production incident investigation. The limited tracked-file key-pattern scan found no matches, but does not cover repository history, untracked secrets, build caches, logs, or deployed images. No zero-data-risk, zero-funding-risk, zero-authorization-risk, or zero-MEV guarantee is made. No DEX swap or sandwich-resistance claim was tested. Broad sovereign/private/enterprise messaging should not be used as a security certification.

Passing checkout tests shows the tested flow still works. It does **not** override failing security invariants. Release approval remains withheld until the blockers above are remediated and retested.
