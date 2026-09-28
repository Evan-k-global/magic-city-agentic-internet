# Enterprise security follow-up — accounts, sessions and funding

September 26, 2026. Local review branch only; no production changes, secret
rotation, paid transaction or live exploit attempt. Treat these findings as
restricted release-review material until reviewed and deployed.

## Result

Additional concrete weaknesses were found and fixed locally. The largest were
mutable wallet-payment terms and an unprotected administrative payout request.
No Runner, selector, checkout, model-ranking, mission-policy or Zeko-contract
changes. Runner remains 0.5.19.

This is scoped hardening, not proof of zero data, funding, authorization or MEV
risk, and not an enterprise certification.

## Corrections

| Area | Previous issue | Local correction |
| --- | --- | --- |
| Prepared wallet payments | Submission could create an authorization from browser fields or overwrite prepared terms | Require original server-prepared request and owner; reject altered credits/amount/recipient/chain; bind one transaction to one authorization; retries preserve confirmation |
| Credit issuance | Finalization accepted absent/incomplete observed-transfer evidence | Require actual matching sender, treasury, token, transaction hash, chain, base-unit amount and credit conversion; safe integer bounds; one ledger event per chain/transaction |
| Receipt source | Static RPC configuration trusted without explicit network check | Check RPC chain ID; bind receipt hash to requested transaction; persist observed hash; future-block receipts get zero confirmations |
| Payouts | Request route lacked admin check | Admin token plus stable idempotency key; reject changed terms; persist reservation before transfer; no automatic resend on uncertainty |
| Escrow data | Lock details fetchable by intent ID alone | Authenticated owner or administrator required |
| Provider linking | Email could silently adopt password account; incomplete email verification | Verified Google/GitHub email and stable subject; fresh same-account first-party sign-in required to link; conflicting subjects blocked |
| OAuth sign-in | Signed state not bound to initiating browser | Random HttpOnly SameSite=Lax cookie bound into state; missing/wrong cookie rejected; Secure over HTTPS |
| OAuth callback HTML | Error text was serialized into scripts without HTML-safe escaping | Existing script-safe JSON escaping now protects callback strings; malicious closing-script payloads remain inert data |
| Password reset/change | Other credentials remained valid | Revoke browser sessions, MCP tokens/codes, reset links, wallet challenges and paired devices; issue fresh caller session |
| MCP refresh | Refresh token reusable | Rotate refresh token, retain absolute expiry, revoke family on reuse; explicit refresh revocation includes access tokens |
| Fail-closed checks | Malformed expiries could pass; disabled password accounts still compared passwords | Finite future expiry; disabled flag enforced; constant-time admin/service secret comparison |
| Production config | Simulated confirmation and legacy live shadow relayer could be enabled | Strict production profile refuses both unsafe modes |

## Tests passed

Tests used temporary state, synthetic keys/accounts, mocked provider responses
and fixture pages. No live purchase or blockchain transaction.

- `test-account-payment-security.mjs`: verified provider identity, account linking,
  stale sessions, browser binding, tampered payment terms, missing/wrong receipt
  fields, credit inflation/overflow, transaction reuse, account/family revocation
  and payout deduplication.
- `test-account-payment-security-http.mjs`: actual server routes for password
  change/reset, old-cookie invalidation, unaffected second account, Google
  callback linking/binding, refresh rotation/reuse, payout auth/idempotency,
  escrow access, cross-account and altered payment submissions. Callback tests
  also cover hostile error query text on both providers and
  provider-thrown errors, preserving the error without injected script execution.
  Local fake EVM RPC: wrong chain/hash cannot finalize; correct evidence issues exactly 50
  credits; replay leaves exactly 50 and confirmed state.
- Real disposable PostgreSQL 18 integration: production startup, encrypted
  persistence, shared limiter concurrency/restart/outage, Host/proxy checks,
  headers, Secure cookies, cross-origin rejection and admin signup denial.
- Full unchanged Runner Chromium fixture suite: **41/41**, including payment,
  multi-item carts, recovery and final-submit protections. This is not a new
  packaged Runner certification or proof of every live Amazon layout.
- Existing Runner security, pairing/claim/checkpoint, mission boundary, card reconciliation, final review,
  terminal state, receipts, approval idempotency, persistence write-failure,
  SantaClawz reservation/refund/policy, selection provider/revalidation and
  execution-artifact privacy regressions.
- Syntax/whitespace checks; empty Runner source diff against preceding hardening
  commit. No extension update required by this pass.

## Intentional compatibility changes and rollout

1. Password reset/change signs out other devices and revokes pairing. Users must
   sign in and re-pair. This does not undo already-issued browser actions or
   cancel an in-flight merchant transaction.
2. Existing Google/GitHub accounts with matching stored subjects still work.
   Password-only accounts must sign in before linking a provider. In-flight
   pre-upgrade OAuth state must restart sign-in to obtain the browser cookie.
3. MCP clients must atomically save replacement `refresh_token`. Concurrent
   refresh or replay after a lost response may require reconnecting. Check the
   actual clients before rollout; this is intentional conservative reuse handling.
4. Payout clients must send `x-admin-token` and a stable `Idempotency-Key` (or body
   `requestId`, 8–128 allowed identifier characters). A transfer timeout needs
   reconciliation with Stripe using the original payout/idempotency key, not a
   newly keyed payout. No automatic reconciliation worker was added.
5. Current wallet UI already submits original prepared terms and request ID.
   Custom clients submitting arbitrary transactions must adopt preparation.
   Do not recreate/re-pay legacy pending transfers. A confirmed-but-uncredited
   legacy job missing full receipt evidence needs operator re-query of the same
   transaction before finalization; automatic legacy repair is not included.
6. Follow the preceding key/config migration checklist. No real key was rotated,
   exported, replaced or logged here. Do not blindly enable strict production
   profile on an existing installation with shared keys.
7. Before release, stage real provider callback origins/cookies, MCP refresh,
   password reset/re-pairing and provider test-mode funding. Retain one writer;
   this patch does not make multi-writer deployment safe.

## Sandwich / MEV scope

The wallet-payment paths reviewed construct fixed-recipient, fixed-amount
ERC-20 transfers, not AMM swaps. There is no swap-slippage parameter to harden in
these paths. Current controls concern exact terms, sender/chain/token/receipt
binding, replay, confirmation policy and treasury/relayer keys.

This is **not MEV immunity**: ordering, censorship, front-running and reorg risks
are not eliminated. RPC chain-ID checking is not independent consensus
verification. Confirmation depth and reorg recovery need chain-specific
acceptance. ZK proofs do not by themselves remove these risks. Future swaps need
separate slippage/deadline/quote-binding and transaction-routing review.

## Remaining enterprise gates

- Dependency advisories from the first review remain open; no surprise dependency
  upgrade was bundled with these fixes.
- Public password signup still does not verify email ownership. Organization
  enrollment, SSO/SCIM, RBAC and recovery policy need separate acceptance. Never
  grant privileges from an asserted email/domain.
- Legacy live EVM shadow relayer still needs durable pre-broadcast intents,
  restart reconciliation and aggregate spend reservations. Strict profile blocks
  it; compatibility deployments must explicitly keep it off. This is separate
  from the Zeko anchoring service; background Zeko anchoring is unchanged.
- Full script CSP, tenant isolation review, egress controls, audited key rotation,
  backup restore drills and incident response remain open.
- No comprehensive Git-history secret scan, independent penetration test,
  chain-consensus verification or live OAuth/Stripe acceptance was performed.
  Tracked secret-like file inventory showed example environment files; this is
  not a guarantee of secret absence.

See [first review](enterprise-readiness-review-2026-09-26.md) and
[production migration checklist](production-security.md). Appropriate claim:
**self-hostable agent foundation with explicit, tested security controls**, not
a risk-free or universally enterprise-ready deployment.
