import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import vm from 'node:vm';
import { spawn } from 'node:child_process';

// Disposable file store; all provider HTTP in the child is mocked. Never load
// the repository .env or inherit RPC, payment, database or signing credentials.
if (process.env.DATABASE_URL) throw new Error('Test refuses inherited DATABASE_URL');
const root = path.resolve(new URL('..', import.meta.url).pathname);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mia-account-payment-http-'));
const cwd = process.cwd();
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const future = new Date(Date.now() + 3600000).toISOString();
let child;
let rpc;
let rpcChainId = '0x1';
let badReceiptHash = true;
let output = '';
try {
  process.chdir(dir);
  const store = await import('../src/store.js');
  const password = 'test-only-passphrase';
  const user = store.createAuthUser({ email: 'owner@example.test', passwordSalt: 'test-salt', passwordHash: crypto.scryptSync(password, 'test-salt', 64).toString('hex') });
  const other = store.createAuthUser({ email: 'other@example.test', passwordLoginEnabled: false, passwordSalt: 'test-salt', passwordHash: crypto.scryptSync(password, 'test-salt', 64).toString('hex') });
  for (const [token, id] of [['owner-one', user.id], ['owner-two', user.id], ['other', other.id]]) store.createAuthSession({ tokenHash: sha(token), userId: id, requesterId: id, expiresAt: future });
  store.createAuthPasswordReset({ tokenHash: sha('reset-one'), userId: user.id, expiresAt: future });
  store.createAuthPasswordReset({ tokenHash: sha('reset-two'), userId: user.id, expiresAt: future });
  store.createOAuthClient({ clientId: 'fixture-client', tokenEndpointAuthMethod: 'none', redirectUris: ['http://127.0.0.1/callback'] });
  store.createOAuthRefreshToken({ tokenHash: sha('initial-refresh'), userId: user.id, clientId: 'fixture-client', expiresAt: future, metadata: { familyId: sha('initial-refresh') } });
  store.createOAuthAccessToken({ tokenHash: sha('initial-access'), refreshTokenHash: sha('initial-refresh'), userId: user.id, clientId: 'fixture-client', expiresAt: future });
  const payment = store.createPaymentAuthorization({ requestId: 'fixture-payment', userId: user.id, mode: 'credit_topup', chainId: 8453, senderAddress: `0x${'1'.repeat(40)}`, recipientAddress: `0x${'2'.repeat(40)}`, tokenAddress: `0x${'3'.repeat(40)}`, amountUsdCents: 50, amountBaseUnits: '500000', credits: 50, authorizationState: 'requested', metadata: { source: 'wallet_request' } });
  store.createPaymentAuthorization({ ...payment, id: undefined, requestId: 'fixture-payment-two', walletTxHash: null });
  store.registerAgent({ agentId: 'payout-agent' });
  store.grantFaucetCredits('payout-agent', 1000);
  await store.flushPersistence();
  process.chdir(cwd);
  const port = await new Promise((resolve, reject) => { const server = net.createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const p = server.address().port; server.close(() => resolve(p)); }); });
  rpc = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks));
    const respond = (call) => {
      const hash = call.params?.[0];
      const blockHash = `0x${'b'.repeat(64)}`;
      const receiptHash = badReceiptHash ? `0x${'c'.repeat(64)}` : hash;
      const receipt = { transactionHash: receiptHash, transactionIndex: '0x0', blockHash, blockNumber: '0x10', from: payment.senderAddress, to: payment.tokenAddress, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, status: '0x1', type: '0x2', logsBloom: `0x${'0'.repeat(512)}`, logs: [{ address: payment.tokenAddress, blockNumber: '0x10', blockHash, transactionHash: receiptHash, transactionIndex: '0x0', logIndex: '0x0', removed: false, topics: ['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', `0x${payment.senderAddress.slice(2).padStart(64, '0')}`, `0x${payment.recipientAddress.slice(2).padStart(64, '0')}`], data: `0x${BigInt(payment.amountBaseUnits).toString(16).padStart(64, '0')}` }] };
      const values = { eth_chainId: rpcChainId, eth_blockNumber: '0x20', eth_getTransactionReceipt: receipt };
      return { jsonrpc: '2.0', id: call.id, result: values[call.method] ?? null };
    };
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(Array.isArray(input) ? input.map(respond) : respond(input)));
  });
  await new Promise((resolve) => rpc.listen(0, '127.0.0.1', resolve));
  const mock = path.join(dir, 'provider-fixture.mjs');
  fs.writeFileSync(mock, `globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') {
      const code = new URLSearchParams(options.body).get('code');
      if (code === 'provider-error') throw new Error('</script><script>globalThis.injected=true</script>');
      return Response.json({ access_token: code });
    }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
      const token = String(options.headers?.Authorization || options.headers?.authorization || '').replace('Bearer ', '');
      return Response.json({ sub: token === 'owner' ? 'owner-subject' : 'new-subject', email: token === 'owner' ? 'owner@example.test' : 'new@example.test', email_verified: token !== 'unverified' });
    }
    throw new Error('Fixture forbids external HTTP: ' + new URL(url).origin);
  };`);
  const env = {
    PATH: process.env.PATH, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
    ADMIN_TOKEN: 'test-only-admin-token', PRIVACY_SALT: 'test-only-privacy-salt', PUBLIC_API_KEYS: 'test-only-api-key',
    MAGIC_CITY_CANONICAL_ORIGIN: `http://127.0.0.1:${port}`,
    AUTO_START_LOCAL_EXECUTION_AGENTS: 'false', AUTO_SEED_DEFAULT_AGENTS: 'false', MAGIC_CITY_SAFE_HTTP_STARTUP: 'true',
    AUTO_PREPARE_EXECUTION_PROOFS: 'false', AUTO_DRAIN_SPONSORED_PROOF_QUEUE: 'false', AUTO_RECOVER_SPONSORED_PROOF_QUEUE: 'false',
    ETHEREUM_CONFIRMATION_INDEXER_ENABLED: 'true', ETHEREUM_CONFIRMATION_INDEXER_WINDOW_MS: '250', ETHEREUM_SHADOW_RELAYER_ENABLED: 'false',
    EVM_BASE_RPC_URL: `http://127.0.0.1:${rpc.address().port}`, EVM_BASE_USDC_ADDRESS: payment.tokenAddress, MAGIC_CITY_EVM_BASE_TREASURY_ADDRESS: payment.recipientAddress,
    MAGIC_CITY_GOOGLE_PRODUCTION_ONLY: 'false', GOOGLE_CLIENT_ID: 'fixture', GOOGLE_CLIENT_SECRET: 'fixture', GOOGLE_CONNECTOR_SECRET: 'fixture-secret', GOOGLE_REDIRECT_URI: `http://127.0.0.1:${port}/auth/google/callback`,
    GITHUB_CLIENT_ID: 'fixture', GITHUB_CLIENT_SECRET: 'fixture', GITHUB_CONNECTOR_SECRET: 'fixture-github-secret', GITHUB_REDIRECT_URI: `http://127.0.0.1:${port}/auth/github/callback`,
    MAGIC_CITY_NATIVE_RUNNER_STORE_VERSION_REFRESH_MS: '86400000',
    MISSION_BOUND_AUTH_ED25519_PRIVATE_KEY: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
  child = spawn(process.execPath, ['--import', mock, path.join(root, 'src/server.js')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (b) => { output += b; }); child.stderr.on('data', (b) => { output += b; });
  const cookie = (token) => `magic_city_session=${token}`;
  const request = (route, { body, token, headers = {}, method = body ? 'POST' : 'GET', form } = {}) => fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { ...(token ? { cookie: cookie(token) } : {}), ...(body ? { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}), ...headers }, body: body ? (form ? new URLSearchParams(body).toString() : JSON.stringify(body)) : undefined, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  for (let i = 0; i < 100; i++) { try { if ((await request('/health')).ok) break; } catch {} if (child.exitCode !== null) throw new Error(output); await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.equal((await request('/health')).status, 200, output);
  const authenticated = async (token, bearer = false) => (await (await request('/auth/session', bearer ? { headers: { authorization: `Bearer ${token}` } } : { token })).json()).authenticated;
  assert.equal(await authenticated('owner-one'), true);
  const maliciousError = '</script><script>globalThis.injected=true</script>';
  const assertSafeCallback = (html) => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    assert.equal(html.includes(maliciousError), false);
    let payload;
    const context = { window: { opener: { postMessage: (value) => { payload = value; } }, location: { origin: 'http://127.0.0.1' }, close() {} } };
    vm.runInNewContext(scripts[0][1], context, { timeout: 1000 });
    assert.equal(context.injected, undefined);
    assert.equal(payload.error, maliciousError, 'error must survive serialization as data');
  };
  for (const provider of ['google', 'github']) assertSafeCallback(await (await request(`/auth/${provider}/callback?error=${encodeURIComponent(maliciousError)}`)).text());
  assert.equal((await request('/payouts/request', { body: { agentId: 'none', amount: 1, rail: 'test' } })).status, 401);
  assert.equal((await request('/payouts/request', { headers: { 'x-admin-token': env.ADMIN_TOKEN }, body: { agentId: 'none', amount: 1, rail: 'test' } })).status, 400);
  const payout = { agentId: 'payout-agent', amount: 1, rail: 'stablecoin', destination: 'test-only', requestId: 'test-payout-one' };
  assert.equal((await request('/payouts/request', { headers: { 'x-admin-token': env.ADMIN_TOKEN }, body: payout })).status, 201);
  assert.equal((await (await request('/payouts/request', { headers: { 'x-admin-token': env.ADMIN_TOKEN }, body: payout })).json()).replayed, true);
  assert.equal((await request('/payouts/request', { headers: { 'x-admin-token': env.ADMIN_TOKEN }, body: { ...payout, amount: 2 } })).status, 400);
  assert.equal((await request('/escrow/lock?intentId=unknown')).status, 401);
  assert.equal((await request('/escrow/lock?intentId=unknown', { token: 'other' })).status, 404);
  const txHash = `0x${'a'.repeat(64)}`;
  const submitted = { requestId: 'fixture-payment', txHash };
  for (const [key, value] of Object.entries({ credits: 50000, amountUsdCents: 1, chainId: 1, recipientAddress: `0x${'9'.repeat(40)}`, mode: 'direct_payment' })) {
    const response = await request('/connectors/evm-wallet/payment-submitted', { token: 'owner-one', body: { ...submitted, [key]: value } });
    assert.equal(response.status, 409, await response.text());
  }
  assert.equal((await request('/connectors/evm-wallet/payment-submitted', { token: 'other', body: submitted })).status, 404);
  assert.equal((await request('/connectors/evm-wallet/payment-submitted', { token: 'owner-one', body: { ...submitted, requestId: 'unknown' } })).status, 404);
  const good = await request('/connectors/evm-wallet/payment-submitted', { token: 'owner-one', body: submitted });
  assert.equal(good.status, 200, await good.clone().text());
  const repeated = await request('/connectors/evm-wallet/payment-submitted', { token: 'owner-one', body: submitted });
  assert.equal(repeated.status, 200); assert.equal((await repeated.json()).replayed, true);
  const reused = await request('/connectors/evm-wallet/payment-submitted', { token: 'owner-one', body: { ...submitted, requestId: 'fixture-payment-two' } });
  assert.equal(reused.status, 409, await reused.text());
  const waitForPayment = async (predicate) => {
    let state;
    for (let i = 0; i < 100; i++) {
      state = await (await request(`/connectors/evm-wallet/payment-authorizations/${payment.id}`, { token: 'owner-one' })).json();
      if (predicate(state)) return state;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail(JSON.stringify(state));
  };
  const wrongChain = await waitForPayment((state) => state.confirmationJob?.lastError === 'payment_rpc_chain_mismatch');
  assert.equal(Boolean(wrongChain.authorization.metadata?.topupFinalizedAt), false);
  rpcChainId = '0x2105';
  const wrongHash = await waitForPayment((state) => state.confirmationJob?.lastError === 'payment_receipt_hash_mismatch');
  assert.equal(Boolean(wrongHash.authorization.metadata?.topupFinalizedAt), false);
  badReceiptHash = false;
  const settled = await waitForPayment((state) => Boolean(state.authorization.metadata?.topupFinalizedAt));
  assert.equal(settled.authorization.metadata.topupFinalizedCredits, 50);
  const beforeReplay = (await (await request('/auth/session', { token: 'owner-one' })).json()).account;
  assert.equal((await request('/connectors/evm-wallet/payment-submitted', { token: 'owner-one', body: submitted })).status, 200);
  const afterReplay = (await (await request('/auth/session', { token: 'owner-one' })).json()).account;
  assert.equal(beforeReplay.availableCredits, 50);
  assert.equal(afterReplay.availableCredits, 50);
  assert.equal((await waitForPayment((state) => state.authorization.confirmationState === 'confirmed')).authorization.confirmationState, 'confirmed');
  const refresh = await request('/oauth/mcp/token', { form: true, body: { client_id: 'fixture-client', grant_type: 'refresh_token', refresh_token: 'initial-refresh' } });
  assert.equal(refresh.status, 200, await refresh.clone().text());
  const tokens = await refresh.json();
  assert.ok(tokens.refresh_token && tokens.refresh_token !== 'initial-refresh');
  assert.equal(await authenticated(tokens.access_token, true), true);
  const replay = await request('/oauth/mcp/token', { form: true, body: { client_id: 'fixture-client', grant_type: 'refresh_token', refresh_token: 'initial-refresh' } });
  assert.equal(replay.status, 400);
  assert.equal(await authenticated(tokens.access_token, true), false);
  assert.equal((await request('/oauth/mcp/token', { form: true, body: { client_id: 'fixture-client', grant_type: 'refresh_token', refresh_token: tokens.refresh_token } })).status, 400);
  const startGoogle = async () => { const response = await request('/auth/google/start'); assert.equal(response.status, 200, await response.clone().text()); return { state: new URL((await response.json()).authorizationUrl).searchParams.get('state'), bindingCookie: response.headers.get('set-cookie').split(';')[0] }; };
  const google = async (code, { includeBinding = true, token } = {}) => {
    const { state, bindingCookie } = await startGoogle();
    return request(`/auth/google/callback?state=${encodeURIComponent(state)}&code=${code}`, { headers: { cookie: [includeBinding ? bindingCookie : '', token ? cookie(token) : ''].filter(Boolean).join('; ') } });
  };
  assert.match(await (await google('new', { includeBinding: false })).text(), /oauth_browser_binding_mismatch/);
  assertSafeCallback(await (await google('provider-error')).text());
  assert.match(await (await google('unverified')).text(), /provider_verified_identity_required/);
  assert.match(await (await google('owner')).text(), /account_link_requires_recent_signin/);
  assert.match(await (await google('owner', { token: 'owner-one' })).text(), /ok:true/);
  assert.match(await (await google('owner')).text(), /ok:true/);
  assert.match(await (await google('new')).text(), /ok:true/);
  assert.equal((await request('/auth/login', { body: { email: other.email, passphrase: password } })).status, 401);
  const changed = await request('/auth/password/change', { token: 'owner-one', body: { currentPassphrase: password, newPassphrase: 'new-test-passphrase' } });
  assert.equal(changed.status, 200, await changed.clone().text());
  const fresh = changed.headers.get('set-cookie').split(';')[0].split('=')[1];
  assert.equal(await authenticated(fresh), true);
  assert.equal(await authenticated('owner-one'), false);
  assert.equal(await authenticated('owner-two'), false);
  assert.equal(await authenticated('other'), true);
  assert.equal((await request('/auth/password-reset/confirm', { body: { token: 'reset-two', passphrase: password } })).status, 400);
  const resetRequest = await request('/auth/password-reset/request', { body: { email: user.email } });
  const resetUrl = (await resetRequest.json()).resetUrl;
  assert.ok(resetUrl);
  const resetToken = new URL(resetUrl).searchParams.get('password_reset_token');
  assert.ok(resetToken, resetUrl);
  const reset = await request('/auth/password-reset/confirm', { body: { token: resetToken, passphrase: 'reset-test-passphrase' } });
  assert.equal(reset.status, 200, await reset.clone().text());
  assert.equal(await authenticated(fresh), false);
  assert.equal((await request('/auth/login', { body: { email: user.email, passphrase: 'reset-test-passphrase' } })).status, 200);
  console.log('HTTP account linking, OAuth browser binding/refresh rotation, session reset, payout auth and immutable payment regressions passed');
} finally {
  process.chdir(cwd);
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise((resolve) => child.once('exit', resolve)); }
  if (rpc) await new Promise((resolve) => rpc.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
}
