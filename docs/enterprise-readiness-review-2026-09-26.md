# MIA / Magic City: hardening implementation and second readiness review

Date: 2026-09-26. Base: `de62bb404c13bf94120af8b2643e531ede4596ee`.
Branch: `harden-partner-deployment-20260925`.

## Verdict

The seven requested hardening areas now have local implementation and regression
coverage. This is ready for code review and isolated staging, **not an unqualified
enterprise-ready release**. Production has not been changed, keys have not been
rotated, and no purchases or payments were made. The stricter profile must be
activated through the migration checklist, not blindly enabled on existing data.

The standard Runner remains **0.5.19**, byte-unchanged in this patch. Its selectors,
cart, checkout, payment, authority and recovery files are unchanged. The partner
helper starter is independently **0.3.2**; no standard Runner update is needed.

## Implemented

| Area | Change | Important boundary |
| --- | --- | --- |
| Public URLs / proxies | Canonical HTTPS origin, exact Host allowlist, explicit proxy trust and right-to-left IP resolution | Real ingress topology still needs staging validation |
| Deployment fail-closed | Explicit production profile validates persistence, encryption, keys and unsafe flags before storage imports | Not automatically enabled by NODE_ENV; not live yet |
| Connector key separation | Production requires dedicated Google/GitHub secrets; removes admin/Stripe/client-secret fallbacks there | Existing envelopes require re-encryption or reconnect before key changes |
| Browser headers | Anti-framing, nosniff, no-referrer, base/object restrictions, HTTPS HSTS; cross-site cookie mutations denied | Script/style CSP remains report-only to preserve current UI |
| Rate limiting | Atomic shared Postgres windows, restart persistence, bounded errors; capped development memory store | Existing route limits only; not edge DDoS protection or multi-writer support |
| Partner model privacy | Field/origin allowlist, public-catalog-only classification, sensitive-page block, local/cloud declaration and popup opt-in | Caller must still redact text; backend must enforce provider/data routing |
| Helper permissions | Exact origins retained; granted optional sites visible and revocable; required development permissions labelled honestly | Revocation does not undo past actions; only the partner starter changed |

Second-pass corrections: production UI admin grants now require operator-approved
existing account IDs, not self-asserted email/requester strings; unauthenticated
plugin callers cannot exploit an empty service-key configuration. Model consent
changes are restricted to the helper popup, not merchant content-script messages.

## Verification performed

All tests below passed locally. No live Amazon checkout or production service
was used. Tests use isolated state, synthetic users, test keys and fixture pages.

- Production security integration against a **real disposable PostgreSQL 18**:
  60 concurrent requests through two independent pools admitted exactly 10 for a
  quota of 10; restarting a limiter did not reset the limit. Expiry and a removed
  limiter table exercised recovery/fail-closed behavior. Server started with a
  complete production profile, rejected incomplete secrets and wrong Host,
  ignored spoofed forwarded headers, set Secure cookies and security headers,
  rejected cross-origin logout, permitted same-origin logout, and did not grant
  admin access to a signup email matching legacy admin settings.
- Deployment unit checks: missing/duplicate/weak secrets, unsafe flags, invalid
  signing keys, proxy spoofing, dangerous CIDRs, memory capacity and model privacy
  rejection before network requests.
- Standard Runner browser matrix: **41/41** deterministic scenarios on the
  unchanged Runner source, loaded into isolated Chromium. This is not a new
  Runner ZIP certification or proof of all live merchant layouts.
- Runner security, mission boundary, pairing/claim/first-checkpoint tests.
  Latest local pairing test: registration 1 ms, claim 3 ms, first checkpoint 8 ms;
  claim-to-first-checkpoint 11 ms. These are local fixtures, not production SLAs.
- Payment-card reconciliation, final-review policy, receipt, terminal,
  selection-intelligence provider/revalidation and browser recovery coverage.
- Approval idempotency and persistence-revision tests, including injected write
  failures. UI parser, startup state and Code Audit chat intake.
- SantaClawz integration policy, credit reservation lifecycle and credit refund
  regressions. Execution-artifact privacy and agent SDK API smoke.
- Partner model adapter deadlines, body bounds, bindings, duplicate candidates,
  URL stripping, privacy filters and zero-network denial cases.
- Partner release packaging tests, including invalid privacy policy rejection.
  Popup/handler tests cover opt-in, route-change invalidation, revoke and sender
  restrictions with Chrome API doubles. Actual Chromium development-ZIP smoke
  passed pairing, claim, four signed boundary events and unsupported-origin
  rejection. Actual release-ZIP permission prompts still need partner HTTPS
  staging validation; the development ZIP pregrants its fixture origin.
- Syntax checks and `git diff --check`.

These tests found and corrected two harness assumptions: Node fetch rewrote the
test Host header, and Chrome cannot revoke required development host permissions.
The integration test now uses raw HTTP for Host tests; the helper UI only offers
revocation for genuinely optional grants. The final passing tests include those
corrections.

## Remaining enterprise gates from the second review

1. **Dependency advisories remain open.** `npm audit --omit=dev --json` reports
   three affected package records (two high, one moderate; no critical):
   `ws@8.17.1`, its parent `ethers@6.16.0`, and `xlsx@0.18.5`. The ws maintainer
   fixes the fragmentation memory-exhaustion issue in 8.21.0; update/pin a
   compatible dependency graph and rerun chain/provider and full application
   tests. [ws advisory](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p).
   SheetJS has prototype-pollution and ReDoS advisories; npm audit offers no
   registry fix for the installed xlsx package. Assess a vetted patched
   distribution or replacement separately. The observed local spreadsheet plugin
   exports workbooks; this review did not find an XLSX parser call there, so a
   package finding is **not proof of reachable exploitation**. Do not add
   untrusted workbook ingestion while unresolved.
   [SheetJS prototype pollution](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6),
   [SheetJS ReDoS](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9).
   Dependency versions were not silently changed in this compatibility-focused
   patch; a clean audit is not claimed.
2. **Identity lifecycle needs a dedicated follow-up.** Static review shows public
   password signup does not prove email ownership, and provider sign-in can
   merge into an account by email. Google sign-in lacks an explicit
   `email_verified` check here; GitHub can fall back to profile email. Before an
   enterprise rollout, require verified provider identities, bind stable
   provider subjects, and require authenticated confirmation for account linking.
   Test pre-registered email, existing password/session retention, changed
   provider subjects and account recovery. The new admin-ID guard reduces one
   consequence; it is not a full account-linking repair. No takeover was attempted.
3. **Configuration and credential migration are not deployed.** Validate real
   proxy/Host behavior and prepare independent connector/MCP keys without losing
   encrypted tokens or in-flight authority. Keep existing state/identifier keys
   stable. See [production security migration](production-security.md).
4. **CSP is partial.** Anti-framing and base/object policy are enforced; full
   inline-script protection needs nonce/hash migration plus OAuth, payment and
   embedded-media browser coverage. Report-only is not an XSS fix.
5. **Scale/operations are not enterprise HA.** State remains one encrypted
   snapshot with one writer. Shared rate limits do not remove that constraint.
   Restore drills, failure alerts, key rotation, audit retention/export,
   incident response and measured capacity still need operator acceptance.
6. **Tenant governance is not established by this patch.** It does not add SSO,
   SCIM, organization RBAC, customer-managed key rotation or a multi-tenant
   isolation certification. Define those requirements per enterprise deployment.
7. **Model sovereignty depends on the operator.** Consent and allowlists protect
   the supplied adapter path, not arbitrary partner code. The actual model route,
   retention policy, cloud fallback prohibition and egress controls must be
   implemented and tested server-side. Text filtering is not semantic DLP.

No external penetration test, comprehensive dependency reachability audit,
Git-history secret scan or live OAuth/WebAuthn/Stripe acceptance was performed.

## Release recommendation

Review this isolated branch, close the dependency and identity-lifecycle gates,
then run the staged activation checklist with the existing Runner. Do not change
the browser shopping flow or promise a certified enterprise product based only
on these tests. A defensible description today is: **a customizable, self-hostable
agent foundation with explicit mission authority and tested security controls**.
