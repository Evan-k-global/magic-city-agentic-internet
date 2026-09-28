# Authorization and receipt-accounting follow-up

## Scope and result

Local fixes on top of `a6438f0` address the residual findings in
`audits/2026-09-25-security/HARDENED-RECHECK-2026-09-26.md` from the original checkout.
No production configuration, key, session, balance, or deployment was changed.
No Runner source changes or version bump. No x402 or SantaClawz service changes.

| Finding | Correction |
| --- | --- |
| SDK cross-tenant access | Access derives from an authenticated account, a valid runtime ID, or the exact API credential that created the mission. Agent labels are filters, not authorization. Anonymous listing and foreign reads/writes fail. Revoked/expired runtimes fail. Client requester IDs cannot impersonate a user. |
| Receipt-created provider balances | `addReceipt` is evidence-only, including internal callers. Imported amounts cannot mint earnings. The existing platform credit capture/burn and refund paths remain in `settleLockedCredits`/`refundSettledCredits`. |
| External receipt settlement | Operator receipt imports, ACP imports and relayer imports cannot settle or release user locks. Attached intent/provider identity must match stored routing. Execution acceptance, not a reported outcome, authorizes credit capture. |
| Registry takeover | HTTP agent registration and key/owner changes require the operator token. General API credentials and user cookies cannot provision/replace registry identities. Trusted internal registration is unchanged. |
| Plugin credential confusion | General API keys cannot register/claim/checkpoint/fulfill as service plugins. A distinct plugin key, explicit plugin allowlist, configured owner and matching session assignment are required. Paired native/custom-extension device authorization is unchanged. |
| Email-based admin grants | Only provisioned `AUTH_ADMIN_USER_IDS` grants account administration, including compatibility mode. Unverified emails/requester strings never grant admin access or bypass credit checks. Explicit development-only loopback admin remains opt-in. |

## Integration migration — intentional security boundaries

1. Legacy `/agents/register`, `/receipts`, `/acp/intent`, `/integrations/acp/intent-sync`, and `/integrations/acp/fulfill-sync` are operator-provisioning/import endpoints. Use `x-admin-token` only from trusted server-side tooling. Do not put that token in a browser or distribute it to partners. Existing internal Magic City execution does not call these HTTP imports.
2. General SDK API credentials remain supported but are tenant identities: issue separate high-entropy keys to independent integrations. A shared key means shared mission access. New key-owned missions store a hash of the authenticating credential, never its plaintext. Existing account/runtime-owned missions keep their ownership. Older key-only missions lacking ownership metadata must be inventoried and explicitly reassigned from authoritative evidence or retired; never adopt them by caller-supplied agent ID. API-key rotation likewise needs deliberate ownership rebinding. Browser/MCP sessions are unaffected.
3. Service plugin configuration example (paired extensions do not need this):

   ```dotenv
   MAGIC_CITY_PLUGIN_API_KEY=<independent secret>
   MAGIC_CITY_PLUGIN_ALLOWED_IDS=local-browser-worker-plugin
   MAGIC_CITY_PLUGIN_OWNER_AGENT_IDS={"local-browser-worker-plugin":"browser-worker-agent"}
   ```

   The dedicated key is an operator-managed service credential authorized for the entire configured plugin allowlist, **not** a partner multi-tenant credential. Do not distribute it to independent partners; they should use paired helper devices. If no owner mapping is supplied for an allowed plugin, its owner ID must equal its plugin ID. Missing scopes fail closed. The queue filters by assignment and claims; native extension IDs cannot be impersonated with a service key. Supply the same dedicated key to the hosted worker.
4. Provision actual administrator account IDs before activating the release. Existing email-only admin configuration intentionally stops granting privileges.
5. Receipt import is not a settlement API. Integrations relying on arbitrary receipt amounts to accrue provider earnings must migrate to a separately authorized funded settlement workflow; this release does not invent a new external provider-payout protocol. The hosted product's platform-credit capture, merchant payable and refunds continue through existing execution settlement.
6. Historical provider balances are not silently deleted or rewritten. Before any payout, reconcile pre-fix balances against genuine funding. The patch prevents future receipt-based minting but does not retroactively prove historical balances were funded.

## Verification

- New reusable HTTP cases run in both compatibility mode and strict production mode with a real disposable PostgreSQL database.
- Exact deny/allow controls cover anonymous and cross-account SDK reads/writes; two valid API-key tenants; authorized owner options; registry provisioning and forbidden replacement; unsigned receipt denial; repeated operator evidence imports producing zero provider balance; wrong-provider receipts across import routes; dedicated plugin registration, wrong key/ID/owner rejection; and unverified admin-email denial.
- Additional disposable HTTP fixture proves success/failure/replayed receipt imports across all three import routes leave a funded lock untouched, and rejects plugin claim/checkpoint/fulfillment against foreign or unassigned sessions.
- Existing 13 release-route checks and 5 protected-route controls pass under strict production; PostgreSQL concurrency, restart, timeout isolation and fail-closed outage tests pass.
- Existing SDK, native pairing/claim/checkpoint, Runner security, mission-boundary, account/payment HTTP, key-cutover/session continuity, credit refund and SantaClawz reservation tests pass.
- Full browser simulation matrix: 41/41, including recovery/no-replay cases. This uses local fixtures, not live Amazon purchases.
- Custom helper packaging/model tests and real packaged-helper pairing/claim/checkpoint/handoff smoke pass; final-review, terminal and receipt-profile regressions pass.

These results close the scoped reproduced paths in the local candidate. They are not a universal security certification or evidence of production deployment. Deployment still requires the documented credential/configuration inventory, session-preserving key transition, historical balance/SDK ownership review and non-paid live smoke checks.
