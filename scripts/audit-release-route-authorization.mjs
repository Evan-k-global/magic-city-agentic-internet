import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Called only by the disposable PostgreSQL production-profile harness. It has
// no target URL option, production credentials or live external-payment calls.
// This is a release gate: insecure behavior is recorded, never counted as pass.
export async function auditReleaseRoutes({ request, env, ownerCookie, root }) {
  const results = [];
  const controls = [];
  const post = (route, body, headers = {}) => request(route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const record = async (name, response, detail = {}) => {
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { body = {}; }
    const denied = [401, 403, 404].includes(response.status);
    results.push({ name, passed: denied, expected: 'authorization denial', observedStatus: response.status, ...detail });
    return body;
  };
  const admin = { 'x-admin-token': env.ADMIN_TOKEN };
  const service = { 'x-api-key': env.PUBLIC_API_KEYS.split(',')[0] };
  const agentId = 'release-audit-synthetic-agent';
  const registered = await post('/agents/register', { agentId, owner: 'synthetic-owner', publicKey: 'audit-only-public-key', capabilities: ['release-audit'], supportedLanes: ['release-audit'], privacyModes: ['private'], pricingModel: { basePrice: 0 } }, admin);
  assert.equal(registered.status, 201, await registered.text());
  const staked = await record('anonymous stake creation', await post(`/agents/${agentId}/stake`, { amount: 10 }));
  if (staked.stake !== undefined) results.at(-1).observedStakeCredits = staked.stake;
  const slashed = await record('anonymous stake destruction', await post(`/agents/${agentId}/slash`, { amount: 3, reason: 'synthetic-audit' }));
  if (slashed.slashedCredits !== undefined) results.at(-1).observedSlashedCredits = slashed.slashedCredits;
  await record('anonymous provenance attestation creation', await post(`/agents/${agentId}/attestations`, { type: 'synthetic-test', issuer: 'arbitrary-asserted-issuer', commitmentHash: 'synthetic-not-a-proof' }));
  const receiptResponse = await post('/receipts', { agentId, taskId: 'synthetic-audit-task', outcome: 'success', privacy: { mode: 'private' }, metadata: { privateAuditMarker: 'AUDIT_ONLY_PRIVATE_RECEIPT' } }, admin);
  assert.equal(receiptResponse.status, 201, await receiptResponse.clone().text());
  const receiptId = (await receiptResponse.json()).receipt.id;
  const receiptList = await record('agent receipt list bypasses private receipt ownership', await request(`/agents/${agentId}/receipts`));
  results.at(-1).returnedPrivateReceipt = JSON.stringify(receiptList).includes('AUDIT_ONLY_PRIVATE_RECEIPT');
  await record('anonymous dispute opening', await post('/disputes/open', { receiptId, openedBy: 'untrusted-string', reason: 'synthetic-audit' }));
  const resolved = await record('anonymous dispute resolution and slash', await post('/disputes/resolve', { receiptId, resolvedBy: 'untrusted-string', resolution: 'upheld', slashAmount: 2 }));
  if (resolved.slash) results.at(-1).observedSlashedCredits = resolved.slash.slashedCredits;
  const first = await record('anonymous faucet credit creation', await post('/faucet/request', { agentId }));
  const second = await record('repeat anonymous faucet credit creation', await post('/faucet/request', { agentId }));
  if (second.balance !== undefined) results.at(-1).observedBalanceIncrease = second.balance - first.balance;

  const requesterId = 'fixture@example.test';
  const funded = await post('/billing/credits/topup', { requesterId, amount: 20, provider: 'synthetic-audit', eventKey: 'audit-seed-only' }, admin);
  assert.equal(funded.status, 200, await funded.text());
  const own = await request('/billing/account', { headers: { cookie: ownerCookie } });
  assert.equal(own.status, 200);
  assert.equal((await own.json()).account.availableCredits, 20);
  const leaked = await record('anonymous account balance/history read by email', await request(`/billing/account?requesterId=${encodeURIComponent(requesterId)}`));
  if (leaked.account) results.at(-1).observedAvailableCredits = leaked.account.availableCredits;
  const impersonated = await record('anonymous victim-credit reservation', await post('/intent', { capability: 'release-audit', budget: 2, requesterId, context: [{ role: 'user', content: 'AUDIT_ONLY_PRIVATE_CONTEXT' }] }));
  if (impersonated.escrow) results.at(-1).observedReservedCredits = impersonated.escrow.amountCredits;
  const accountAfter = await request('/billing/account', { headers: { cookie: ownerCookie } });
  const account = (await accountAfter.json()).account;
  results.at(-1).victimLockedCredits = account.lockedCredits;
  const ownIntentResponse = await post('/intent', { capability: 'release-audit', budget: 0, requesterId, context: [{ role: 'user', content: 'AUDIT_ONLY_PRIVATE_CONTEXT' }] }, { cookie: ownerCookie });
  assert.equal(ownIntentResponse.status, 201, await ownIntentResponse.clone().text());
  const ownIntent = (await ownIntentResponse.json()).intent;
  // Read-only controls distinguish the bypasses from a globally disabled auth
  // fixture. Alternate routes below must not defeat these guarded surfaces.
  for (const [name, route] of [
    ['ordinary private intent read', `/intent/${ownIntent.id}`],
    ['private receipt proof export', `/proofs/receipt/${receiptId}`],
    ['escrow lock ownership', `/escrow/lock?intentId=${ownIntent.id}`],
    ['admin payout listing', '/payouts'],
    ['admin ledger read', '/admin/ledger']
  ]) {
    const response = await request(route);
    controls.push({ name, passed: [401, 403, 404].includes(response.status), expected: 'anonymous access denied', observedStatus: response.status });
    await response.text();
  }
  {
    const exposed = await record('legacy ACP route bypasses intent read ownership', await request(`/acp/intent/${ownIntent.id}`));
    results.at(-1).returnedIntent = Boolean(exposed.intent);
    results.at(-1).returnedPrivateContext = JSON.stringify(exposed).includes('AUDIT_ONLY_PRIVATE_CONTEXT');
  }
  await record('anonymous stale-lock reconciliation by email', await post('/billing/account/release-stale-locks', { requesterId }));
  assert.equal(account.lockedCredits, 0, 'denied requests must not reserve victim credits');
  const ownRead = await request(`/acp/intent/${ownIntent.id}`, { headers: { cookie: ownerCookie } });
  assert.equal(ownRead.status, 200, 'owner must retain ACP intent access');
  const ownReceiptResponse = await post('/receipts', { agentId, taskId: 'owned-task', intentId: ownIntent.id, outcome: 'success', privacy: { mode: 'private' }, metadata: { privateAuditMarker: 'OWNER_ONLY_REPORT' } }, admin);
  assert.equal(ownReceiptResponse.status, 201, await ownReceiptResponse.clone().text());
  const ownReceiptId = (await ownReceiptResponse.json()).receipt.id;
  const ownedList = await request(`/agents/${agentId}/receipts`, { headers: { cookie: ownerCookie } });
  assert.equal(ownedList.status, 200);
  const ownedText = await ownedList.text();
  assert.match(ownedText, /OWNER_ONLY_REPORT/);
  assert.doesNotMatch(ownedText, /AUDIT_ONLY_PRIVATE_RECEIPT/);
  const opened = await post('/disputes/open', { receiptId: ownReceiptId, openedBy: 'spoofed', reason: 'owner-review' }, { cookie: ownerCookie });
  assert.equal(opened.status, 200, await opened.clone().text());
  assert.notEqual((await opened.json()).receipt.dispute.openedBy, 'spoofed');
  assert.equal((await post('/disputes/resolve', { receiptId: ownReceiptId, resolvedBy: 'operator', resolution: 'dismissed' }, admin)).status, 200);
  const operatorOpened = await post('/disputes/open', { receiptId: ownReceiptId, openedBy: 'spoofed-operator', reason: 'operator-review' }, admin);
  assert.equal(operatorOpened.status, 401, 'an operator token alone is not an owner session for opening a dispute');
  assert.equal((await post(`/agents/${agentId}/attestations`, { type: 'operator_note', issuer: 'trusted-operator', commitmentHash: 'synthetic' }, admin)).status, 201);
  assert.equal((await post('/faucet/request', { agentId }, admin)).status, 403, 'production faucet must be disabled even for admin');
  assert.equal((await post(`/agents/${agentId}/stake`, { amount: 10 }, admin)).status, 403, 'unbacked production stake must stay disabled');
  const otherRegistration = await post('/auth/register', { email: 'other-audit@example.test', passphrase: 'synthetic-test-only-passphrase' });
  assert.equal(otherRegistration.status, 201);
  const otherCookie = otherRegistration.headers.get('set-cookie').split(';')[0];
  assert.equal((await request(`/acp/intent/${ownIntent.id}`, { headers: { cookie: otherCookie } })).status, 404);
  assert.equal((await request(`/billing/account?requesterId=${encodeURIComponent(requesterId)}`, { headers: { cookie: otherCookie } })).status, 409);
  assert.equal((await post('/intent/stream', { capability: 'release-audit', budget: 1, requesterId })).status, 401);
  assert.equal((await post('/intent', { capability: 'release-audit', budget: 1 })).status, 401);
  assert.equal((await post('/intent', { capability: 'release-audit', budget: 1, requesterId }, { cookie: otherCookie })).status, 409);

  // Simulates an authentic Stripe event saying the payment is NOT paid. It
  // proves missing settlement validation, not the ability to forge signatures.
  const event = { id: 'evt_release_audit_unpaid', type: 'checkout.session.completed', data: { object: { id: 'cs_release_audit_unpaid', payment_status: 'unpaid', amount_total: 0, currency: 'usd', metadata: { requesterId, amountCredits: '100' } } } };
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${raw}`).digest('hex');
  const unpaid = await request('/billing/stripe/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` }, body: raw });
  const afterUnpaid = (await (await request('/billing/account', { headers: { cookie: ownerCookie } })).json()).account;
  results.push({ name: 'signed unpaid Stripe completion must not mint credits', passed: afterUnpaid.availableCredits === account.availableCredits, expected: 'zero credit increase', observedStatus: unpaid.status, observedCreditIncrease: afterUnpaid.availableCredits - account.availableCredits });

  const report = { candidate: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), workingTreePatch: Boolean(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim()), productionProfile: true, realPostgres: true, syntheticFixturesOnly: true, ownerAndCrossAccountRegressions: 'passed', failed: results.filter((row) => !row.passed).length, controlFailures: controls.filter((row) => !row.passed).length, controls, results };
  const output = path.join(root, 'artifacts', 'enterprise-release-audit-2026-09-26');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'route-boundaries.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (report.failed || report.controlFailures) throw new Error(`release_gate_failed:${report.failed}_route_boundary_checks:${report.controlFailures}_control_failures`);
}
