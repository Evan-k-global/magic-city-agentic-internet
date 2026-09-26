import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { futureExpiry, equalSecret, verifiedProviderIdentity, assertProviderAccountLink, assertOauthBrowserBinding } from '../src/accountSecurity.js';
import { assertPreparedPaymentSubmission, validTopupTransfer } from '../src/paymentSecurity.js';

const future = new Date(Date.now() + 3600000).toISOString();
for (const invalid of ['', 'invalid', null, '2000-01-01']) assert.equal(futureExpiry(invalid), false);
assert.equal(futureExpiry(future), true);
assert.equal(equalSecret('secret', 'secret'), true);
assert.equal(equalSecret('', ''), false);
assert.equal(equalSecret('secret', 'other'), false);
const identity = verifiedProviderIdentity('google', { sub: 'subject', email: 'OWNER@example.test', email_verified: true });
assert.equal(identity.email, 'owner@example.test');
assert.throws(() => verifiedProviderIdentity('google', { sub: 'subject', email: identity.email }), /verified_identity/);
assert.throws(() => verifiedProviderIdentity('github', { id: 1, email: identity.email }, []), /verified_identity/);
assert.equal(verifiedProviderIdentity('github', { id: 1 }, [{ email: 'bad@example.test', primary: true, verified: false }, { email: identity.email, verified: true }]).email, identity.email);
const user = { id: 'owner' };
assert.throws(() => assertProviderAccountLink(user, identity), /recent_signin/);
assertProviderAccountLink({ ...user, googleProfile: { subject: 'subject' } }, identity);
assert.throws(() => assertProviderAccountLink({ ...user, googleProfile: { subject: 'different' } }, identity), /subject_mismatch/);
const auth = { authUser: user, authSession: { createdAt: new Date().toISOString(), expiresAt: future } };
assertProviderAccountLink(user, identity, auth);
for (const session of [{ ...auth.authSession, revokedAt: 'now' }, { ...auth.authSession, createdAt: '2000-01-01' }, { ...auth.authSession, expiresAt: 'invalid' }]) assert.throws(() => assertProviderAccountLink(user, identity, { ...auth, authSession: session }));
assert.throws(() => assertProviderAccountLink(user, identity, { ...auth, authUser: { id: 'other' } }));
const binding = { browserBinding: crypto.createHash('sha256').update('browser-cookie').digest('hex') };
assertOauthBrowserBinding(binding, 'browser-cookie');
assert.throws(() => assertOauthBrowserBinding(binding, 'other'), /binding/);
assert.throws(() => assertOauthBrowserBinding(binding, ''), /binding/);

const address = (digit) => `0x${digit.repeat(40)}`;
const txHash = `0x${'a'.repeat(64)}`;
const authorization = { id: 'pay-1', requestId: 'req-1', userId: 'owner', mode: 'credit_topup', chainId: 8453, senderAddress: address('1'), recipientAddress: address('2'), tokenAddress: address('3'), amountUsdCents: 50, amountBaseUnits: '500000', credits: 50, metadata: { source: 'wallet_request' }, authorizationState: 'requested' };
const body = { requestId: 'req-1', txHash };
assert.equal(assertPreparedPaymentSubmission(authorization, body, 'owner').replay, false);
assert.equal(assertPreparedPaymentSubmission({ ...authorization, walletTxHash: txHash, authorizationState: 'confirmed' }, body, 'owner').replay, true);
for (const [key, value] of Object.entries({ mode: 'direct_payment', chainId: 1, senderAddress: address('9'), recipientAddress: address('9'), tokenAddress: address('9'), amountUsdCents: 1, amountBaseUnits: '1', credits: 50000 })) assert.throws(() => assertPreparedPaymentSubmission(authorization, { ...body, [key]: value }, 'owner'), /terms_mismatch/);
assert.throws(() => assertPreparedPaymentSubmission(null, body, 'owner'), /not_found/);
assert.throws(() => assertPreparedPaymentSubmission(authorization, body, 'other'), /not_found/);
assert.throws(() => assertPreparedPaymentSubmission(authorization, body, 'owner', { id: 'pay-2' }), /already_assigned/);
assert.throws(() => assertPreparedPaymentSubmission({ ...authorization, walletTxHash: `0x${'b'.repeat(64)}` }, body, 'owner'), /already_bound/);
const confirmed = { ...authorization, walletTxHash: txHash };
const observed = { matched: true, transactionHash: txHash, from: address('1'), to: address('2'), tokenAddress: address('3'), value: '500000' };
const chain = { chainId: 8453, treasuryAddress: address('2'), tokenAddress: address('3') };
assert.equal(validTopupTransfer(confirmed, observed, chain, (credits) => credits), true);
assert.equal(validTopupTransfer(confirmed, null, chain, (credits) => credits), false);
for (const key of ['transactionHash', 'from', 'to', 'tokenAddress', 'value']) {
  assert.equal(validTopupTransfer(confirmed, { ...observed, [key]: null }, chain, (credits) => credits), false, key);
  assert.equal(validTopupTransfer(confirmed, { ...observed, [key]: 'wrong' }, chain, (credits) => credits), false, key);
}
assert.equal(validTopupTransfer({ ...confirmed, credits: 50000 }, observed, chain, (credits) => credits), false);
assert.equal(validTopupTransfer({ ...confirmed, credits: Number.MAX_SAFE_INTEGER, amountUsdCents: Number.MAX_SAFE_INTEGER }, observed, chain, (credits) => credits), false);
assert.equal(validTopupTransfer({ ...confirmed, chainId: 1 }, observed, chain, (credits) => credits), false);

if (process.env.DATABASE_URL) throw new Error('Test refuses inherited DATABASE_URL');
const cwd = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mia-account-payment-unit-'));
try {
  process.chdir(dir);
  const s = await import('../src/store.js');
  for (const id of ['owner', 'other']) {
    s.createAuthSession({ tokenHash: id, userId: id, requesterId: id, expiresAt: future });
    s.createAuthPasswordReset({ tokenHash: id, userId: id, expiresAt: future });
    s.createOAuthAuthorizationCode({ codeHash: id, userId: id, expiresAt: future });
    s.createOAuthRefreshToken({ tokenHash: id, userId: id, expiresAt: future });
    s.createOAuthAccessToken({ tokenHash: id, refreshTokenHash: id, userId: id, expiresAt: future });
    s.createWalletChallenge({ challengeId: id, userId: id, expiresAt: future });
    s.createNativeRunnerDevice({ id, authUserId: id });
  }
  s.revokeUserCredentials('owner');
  for (const getter of ['getAuthSession', 'getAuthPasswordReset', 'getOAuthAuthorizationCode', 'getOAuthRefreshToken', 'getOAuthAccessToken', 'getWalletChallenge']) {
    assert.ok(s[getter]('owner').revokedAt, getter);
    assert.equal(s[getter]('other').revokedAt, null, getter);
  }
  assert.equal(s.getNativeRunnerDevice('owner').status, 'revoked');
  assert.equal(s.getNativeRunnerDevice('other').status, 'active');
  s.createOAuthRefreshToken({ tokenHash: 'rotated', userId: 'other', expiresAt: future, metadata: { familyId: 'other' } });
  s.createOAuthAccessToken({ tokenHash: 'rotated-access', refreshTokenHash: 'rotated', userId: 'other', expiresAt: future });
  s.revokeOAuthRefreshToken('other', { rotatedTo: 'rotated' });
  assert.equal(s.getOAuthRefreshToken('other').metadata.rotatedTo, 'rotated');
  s.revokeOAuthTokenFamily('other', 'reuse');
  assert.ok(s.getOAuthRefreshToken('rotated').revokedAt);
  assert.ok(s.getOAuthAccessToken('rotated-access').revokedAt);
  s.grantFaucetCredits('agent', 1000);
  const payout = { agentId: 'agent', amount: 100, rail: 'test', destination: 'fixture', requestId: 'payout-test' };
  assert.equal(s.createPayoutRequest(payout).ok, true);
  assert.equal(s.createPayoutRequest(payout).deduped, true);
  assert.equal(s.getBalance('agent'), 900);
  assert.equal(s.createPayoutRequest({ ...payout, amount: 200 }).reason, 'payout_idempotency_conflict');
  assert.equal(s.createPayoutRequest({ ...payout, amount: Infinity }).reason, 'invalid_payout_amount');
  await s.flushPersistence();
  console.log('Account, browser-bound OAuth, immutable payment, full transfer evidence, revocation and payout regressions passed');
} finally {
  process.chdir(cwd);
  fs.rmSync(dir, { recursive: true, force: true });
}
