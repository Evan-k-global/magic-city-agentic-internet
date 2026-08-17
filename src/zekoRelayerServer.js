import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import {
  createSubmission,
  findSubmissionByPayloadHash,
  getSubmission,
  getZekoRelayerPersistenceStatus,
  listSubmissions,
  updateSubmission
} from './zekoSubmitterStore.js';

// The relayer is an internal capability. Expose it only when an operator opts in.
const HOST = process.env.ZEKO_RELAYER_HOST || process.env.ZEKO_SUBMITTER_HOST || '127.0.0.1';
const PORT = Number(process.env.ZEKO_RELAYER_PORT ?? process.env.ZEKO_SUBMITTER_PORT ?? 4412);
const TOKEN = process.env.ZEKO_RELAYER_TOKEN || process.env.ZEKO_SUBMITTER_TOKEN || '';
const MODE = process.env.ZEKO_RELAYER_MODE || process.env.ZEKO_SUBMITTER_MODE || 'record';
const DEFAULT_MAGIC_CITY_MISSION_PROOF_NETWORK_ID = 'zeko:testnet';
function resolveMissionProofNetworkId() {
  const explicit = String(process.env.MAGIC_CITY_MISSION_PROOF_NETWORK_ID || '').trim();
  if (explicit) return explicit;
  const legacy = String(process.env.ZEKO_NETWORK_ID || '').trim();
  return legacy || DEFAULT_MAGIC_CITY_MISSION_PROOF_NETWORK_ID;
}

const ZEKO_NETWORK_ID = resolveMissionProofNetworkId();
const ZEKO_O1JS_NETWORK_ID =
  process.env.ZEKO_O1JS_NETWORK_ID ||
  (String(ZEKO_NETWORK_ID).includes('mainnet') ? 'zeko-mainnet' : 'testnet');
const ZEKO_IS_MAINNET = String(ZEKO_NETWORK_ID).includes('mainnet');
const ZEKO_GRAPHQL = process.env.ZEKO_GRAPHQL || (ZEKO_IS_MAINNET ? 'https://mainnet.zeko.io/graphql' : 'https://testnet.zeko.io/graphql');
const ZEKO_ARCHIVE = process.env.ZEKO_ARCHIVE || (ZEKO_IS_MAINNET ? 'https://archive.mainnet.zeko.io/graphql' : ZEKO_GRAPHQL);
const TX_FEE = process.env.TX_FEE || '100000000';
const RELAYER_PRIVATE_KEY =
  process.env.ZEKO_RELAYER_PRIVATE_KEY ||
  process.env.ZEKO_MISSION_AUTH_RELAYER_PRIVATE_KEY ||
  process.env.SUBMITTER_PRIVATE_KEY ||
  '';
const ANCHOR_PAYMENT_AMOUNT = process.env.ZEKO_ANCHOR_PAYMENT_AMOUNT || '1';
const ANCHOR_RECIPIENT = process.env.ZEKO_ANCHOR_RECIPIENT || '';
const MISSION_AUTH_REGISTRY_PUBLIC_KEY = process.env.ZEKO_MISSION_AUTH_REGISTRY_PUBLIC_KEY || '';
const MISSION_AUTH_REGISTRY_PRIVATE_KEY = process.env.ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_KEY || '';
const ZEKO_PROOF_CACHE_DIR = String(process.env.ZEKO_PROOF_CACHE_DIR || '').trim();
const PRE_BROADCAST_RETRY_LIMIT = Math.max(
  1,
  Math.min(Number(process.env.ZEKO_PRE_BROADCAST_RETRY_LIMIT || 2) || 2, 3)
);
const ZEKO_TX_SEND_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.ZEKO_TX_SEND_TIMEOUT_MS || 2 * 60 * 1000) || 2 * 60 * 1000
);
const ZEKO_TX_SEND_RETRY_LIMIT = Math.max(
  1,
  Math.min(Number(process.env.ZEKO_TX_SEND_RETRY_LIMIT || 3) || 3, 5)
);
const ZEKO_RELAYER_JOB_TIMEOUT_MS = Math.max(
  ZEKO_TX_SEND_TIMEOUT_MS + 30_000,
  Number(process.env.ZEKO_RELAYER_JOB_TIMEOUT_MS || 5 * 60 * 1000) || 5 * 60 * 1000
);
const SUBMIT_ONCE_ID = process.argv[2] === '--submit-once' ? String(process.argv[3] || '') : '';
const ZEKO_RELAYER_JOB_PRIORITY = Math.max(
  0,
  Math.min(Number(process.env.ZEKO_RELAYER_JOB_PRIORITY || 19) || 19, 19)
);

if (SUBMIT_ONCE_ID) {
  try {
    os.setPriority(process.pid, ZEKO_RELAYER_JOB_PRIORITY);
  } catch {
    // Best-effort isolation: the web server must stay responsive while o1js works.
  }
}

function withTimeout(promise, timeoutMs, buildError) {
  let timeout = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => {
        reject(typeof buildError === 'function' ? buildError() : new Error(String(buildError || 'operation_timeout')));
      }, timeoutMs);
      timeout.unref?.();
    })
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function resolveProofCache(Cache) {
  return ZEKO_PROOF_CACHE_DIR ? Cache.FileSystem(ZEKO_PROOF_CACHE_DIR) : Cache.FileSystemDefault;
}

function sendJson(res, code, payload) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function readBody(req, maxBytes = 512 * 1024) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      const err = new Error('payload_too_large');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('invalid_json');
    err.statusCode = 400;
    throw err;
  }
}

function assertToken(req) {
  if (!TOKEN) return true;
  const header = req.headers.authorization || '';
  const expected = `Bearer ${TOKEN}`;
  if (header !== expected) {
    const err = new Error('unauthorized');
    err.statusCode = 401;
    throw err;
  }
  return true;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildAnchorKey(anchorPayload, networkId = ZEKO_NETWORK_ID) {
  return `0x${stableHash({
    schema: 'magic-city-anchor-idempotency-v1',
    networkId,
    sourceKind: anchorPayload?.sourceKind ?? null,
    sourceId: anchorPayload?.sourceId ?? null,
    receiptId: anchorPayload?.receiptId ?? null,
    intentId: anchorPayload?.intentId ?? null,
    statementHash: anchorPayload?.statementHash ?? null,
    requestCommitment: anchorPayload?.requestCommitment ?? null,
    batchRoot: anchorPayload?.batchRoot ?? null
  })}`;
}

function fieldFromText(value, Field, Poseidon) {
  const text = String(value || '');
  if (!text) return Field(0);
  return Poseidon.hash(Array.from(text).map((char) => Field(char.charCodeAt(0))));
}

function fieldFromHashLike(value, Field, Poseidon) {
  const text = String(value || '').trim();
  if (/^\d+$/.test(text)) return Field.fromJSON(text);
  return fieldFromText(text, Field, Poseidon);
}

function isTransientSendError(message) {
  return /502|504|Bad Gateway|Gateway Timeout|timeout|timed out|fetch failed|ECONNRESET|UND_ERR|socket/i.test(String(message || ''));
}

async function computeSignedTransactionHash(signedTx, Transaction) {
  try {
    if (!signedTx || typeof signedTx.toJSON !== 'function' || !Transaction?.hash) return null;
    return await Transaction.hash(signedTx.toJSON());
  } catch {
    return null;
  }
}

const ACCOUNT_CACHE_QUERY = `query Account($pk: PublicKey!) {
  account(publicKey: $pk) {
    publicKey
    token
    nonce
    balance { total }
    tokenSymbol
    receiptChainHash
    timing {
      initialMinimumBalance
      cliffTime
      cliffAmount
      vestingPeriod
      vestingIncrement
    }
    permissions {
      editState
      access
      send
      receive
      setDelegate
      setPermissions
      setVerificationKey { auth txnVersion }
      setZkappUri
      editActionState
      setTokenSymbol
      incrementNonce
      setVotingFor
      setTiming
    }
    delegateAccount { publicKey }
    votingFor
    zkappState
    verificationKey { verificationKey hash }
    actionState
    provedState
    zkappUri
  }
}`;

async function fetchAndCacheAccountWithGraphqlFallback({ publicKey, fetchAccount, addCachedAccount, parseFetchedAccount, graphqlUrl }) {
  const first = await fetchAccount({ publicKey });
  if (!first.error && first.account?.zkapp) return first;

  let response;
  let payload;
  try {
    response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: ACCOUNT_CACHE_QUERY,
        variables: { pk: publicKey.toBase58() }
      })
    });
    payload = await response.json();
  } catch {
    return first;
  }
  const fetchedAccount = payload?.data?.account;
  if (!response.ok || payload?.errors?.length || !fetchedAccount) return first;

  let parsedAccount = first.account || null;
  try {
    parsedAccount = parseFetchedAccount(fetchedAccount);
    addCachedAccount(parsedAccount, graphqlUrl);
  } catch {}
  return {
    account: parsedAccount,
    error: undefined,
    fallback: 'graphql_account_cache',
    sourceAccount: fetchedAccount
  };
}

function accountResultHasDeployedZkapp(result) {
  if (result?.account?.zkapp) return true;
  const source = result?.sourceAccount || {};
  const verificationKey = source?.verificationKey?.hash || source?.verificationKey?.verificationKey || null;
  const zkappState = Array.isArray(source?.zkappState) ? source.zkappState : [];
  return Boolean(verificationKey || zkappState.length > 0);
}

function requireAnchorPayload(body) {
  if (!body || typeof body !== 'object' || !body.anchorPayload) {
    const err = new Error('missing_anchor_payload');
    err.statusCode = 400;
    throw err;
  }
  const payload = body.anchorPayload;
  if (payload.schema !== 'magic-city-anchor-v1') {
    const err = new Error('invalid_anchor_schema');
    err.statusCode = 400;
    throw err;
  }
  if (!payload.statementHash || !payload.requestCommitment || !payload.batchRoot) {
    const err = new Error('missing_anchor_fields');
    err.statusCode = 400;
    throw err;
  }
  return payload;
}

function buildTxPlan(anchorPayload, payloadHash) {
  return {
    strategy: 'anchor-commitment',
    networkId: ZEKO_NETWORK_ID,
    graphql: ZEKO_GRAPHQL,
    feeNanomina: TX_FEE,
    payloadHash,
    statementHash: anchorPayload.statementHash,
    memo: `magic-city:${String(anchorPayload.intentId || anchorPayload.receiptId || payloadHash).slice(0, 28)}`,
    note: 'This is a nonce-safe Zeko submission plan scaffold. Wire it to a zkApp or fee-payer transaction path next.'
  };
}

async function submitAnchorPayment(anchorPayload, payloadHash) {
  if (!RELAYER_PRIVATE_KEY) {
    const err = new Error('ZEKO_RELAYER_PRIVATE_KEY_not_configured');
    err.statusCode = 503;
    throw err;
  }

  const { Mina, PrivateKey, PublicKey, AccountUpdate, Bool, UInt32, UInt64, fetchAccount } = await import('o1js');
  const network = Mina.Network({
    networkId: ZEKO_O1JS_NETWORK_ID,
    mina: ZEKO_GRAPHQL,
    archive: ZEKO_ARCHIVE
  });
  Mina.setActiveInstance(network);

  const relayer = PrivateKey.fromBase58(RELAYER_PRIVATE_KEY);
  const sender = relayer.toPublicKey();
  const recipient = ANCHOR_RECIPIENT ? PublicKey.fromBase58(ANCHOR_RECIPIENT) : sender;
  const memo = buildTxPlan(anchorPayload, payloadHash).memo;
  const amount = UInt64.from(ANCHOR_PAYMENT_AMOUNT);
  const fee = UInt64.from(TX_FEE);

  const attemptSend = async (overrideNonce) => {
    const account = await fetchAccount({ publicKey: sender });
    if (account.error) {
      const err = new Error('submitter_account_not_found');
      err.statusCode = 503;
      throw err;
    }
    const chainNonce = Number(account.account.nonce.toString());
    const nonce = overrideNonce ?? chainNonce;

    const tx = await Mina.transaction({ sender, fee, memo, nonce }, async () => {
      const senderUpdate = AccountUpdate.createSigned(sender);
      senderUpdate.send({ to: recipient, amount });
    });

    const feePayerUpdate = tx.feePayer;
    if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
      feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
    }
    if (feePayerUpdate?.body) {
      feePayerUpdate.body.useFullCommitment = Bool(true);
    }

    await tx.sign([relayer]);
    const sent = await tx.send();
    const txHash = sent?.hash?.toString?.() ?? sent?.hash ?? sent?.transactionHash ?? null;
    return {
      txHash,
      nonce,
      memo,
      recipient: recipient.toBase58(),
      sender: sender.toBase58()
    };
  };

  try {
    return await attemptSend();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('Account_nonce_precondition_unsatisfied')) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const account = await fetchAccount({ publicKey: sender });
    if (account.error) throw error;
    const chainNonce = Number(account.account.nonce.toString());
    return await attemptSend(chainNonce + 1);
  }
}

async function readRelayerNonce(publicKey, graphqlUrl, fetchAccount) {
  try {
    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'query SenderNonce($pk: PublicKey!) { account(publicKey: $pk) { nonce inferredNonce } }',
        variables: { pk: publicKey.toBase58() }
      })
    });
    const payload = await response.json();
    const rawNonce = payload?.data?.account?.inferredNonce ?? payload?.data?.account?.nonce;
    if (/^\d+$/.test(String(rawNonce))) return Number(rawNonce);
  } catch {}

  const account = await fetchAccount({ publicKey });
  if (account.error || !account.account) {
    const err = new Error(`relayer_account_not_found:${publicKey.toBase58()}`);
    err.statusCode = 503;
    throw err;
  }
  return Number(account.account.nonce.toString());
}

async function submitMissionAuthRegistryAnchor(anchorPayload, payloadHash) {
  let executionStage = 'initializing';
  if (!RELAYER_PRIVATE_KEY) {
    const err = new Error('ZEKO_RELAYER_PRIVATE_KEY_not_configured');
    err.statusCode = 503;
    throw err;
  }
  if (!MISSION_AUTH_REGISTRY_PRIVATE_KEY) {
    const err = new Error('ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_KEY_not_configured');
    err.statusCode = 503;
    throw err;
  }

  const {
    Mina,
    PrivateKey,
    PublicKey,
    Bool,
    Cache,
    Field,
    Poseidon,
    Transaction,
    UInt32,
    fetchAccount,
    addCachedAccount,
    parseFetchedAccount
  } = await import('o1js');
  const { MagicCityMissionAuthRegistry } = await import('./zekoMissionAuthRegistry.js');

  const network = Mina.Network({
    networkId: ZEKO_O1JS_NETWORK_ID,
    mina: ZEKO_GRAPHQL,
    archive: ZEKO_ARCHIVE
  });
  Mina.setActiveInstance(network);

  executionStage = 'registry_proof_compile';
  console.info('[zeko-relayer] registry_proof_compile_started');
  await MagicCityMissionAuthRegistry.compile({ cache: resolveProofCache(Cache) });
  console.info('[zeko-relayer] registry_proof_compile_completed');

  const relayer = PrivateKey.fromBase58(RELAYER_PRIVATE_KEY);
  const registryKey = PrivateKey.fromBase58(MISSION_AUTH_REGISTRY_PRIVATE_KEY);
  const registryPublicKey = MISSION_AUTH_REGISTRY_PUBLIC_KEY
    ? PublicKey.fromBase58(MISSION_AUTH_REGISTRY_PUBLIC_KEY)
    : registryKey.toPublicKey();
  const relayerPublicKey = relayer.toPublicKey();

  if (registryPublicKey.toBase58() !== registryKey.toPublicKey().toBase58()) {
    const err = new Error('mission_auth_registry_key_mismatch');
    err.statusCode = 500;
    throw err;
  }

  executionStage = 'registry_account_fetch';
  console.info('[zeko-relayer] registry_account_fetch_started');
  const registryAccount = await fetchAndCacheAccountWithGraphqlFallback({
    publicKey: registryPublicKey,
    fetchAccount,
    addCachedAccount,
    parseFetchedAccount,
    graphqlUrl: ZEKO_GRAPHQL
  });
  console.info('[zeko-relayer] registry_account_fetch_completed');
  if (registryAccount.error || !accountResultHasDeployedZkapp(registryAccount)) {
    const err = new Error('mission_auth_registry_not_deployed');
    err.statusCode = 503;
    throw err;
  }

  const statementHash = fieldFromHashLike(anchorPayload.statementHash, Field, Poseidon);
  const payloadDigest = fieldFromText(payloadHash, Field, Poseidon);
  executionStage = 'relayer_nonce_fetch';
  console.info('[zeko-relayer] relayer_nonce_fetch_started');
  const relayerNonce = await readRelayerNonce(relayerPublicKey, ZEKO_GRAPHQL, fetchAccount);
  console.info('[zeko-relayer] relayer_nonce_fetch_completed');
  const zkapp = new MagicCityMissionAuthRegistry(registryPublicKey);

  let tx = null;
  for (let attempt = 1; attempt <= PRE_BROADCAST_RETRY_LIMIT; attempt += 1) {
    executionStage = 'transaction_build';
    console.info(`[zeko-relayer] transaction_build_started attempt=${attempt}`);
    try {
      tx = await Mina.transaction({ sender: relayerPublicKey, fee: TX_FEE, nonce: relayerNonce }, async () => {
        await zkapp.anchorMissionAuth(statementHash, payloadDigest);
      });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transient = /fetch failed|timeout|timed out|ECONNRESET|UND_ERR|socket/i.test(message);
      if (!transient || attempt >= PRE_BROADCAST_RETRY_LIMIT) {
        error.executionStage = executionStage;
        error.safeToRetry = true;
        throw error;
      }
      console.warn(`[zeko-relayer] transaction_build_retry attempt=${attempt} message=${JSON.stringify(message.slice(0, 300))}`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      await fetchAccount({ publicKey: registryPublicKey }).catch(() => null);
    }
  }
  if (!tx) {
    const error = new Error('mission_auth_registry_transaction_not_built');
    error.executionStage = executionStage;
    error.safeToRetry = true;
    throw error;
  }
  console.info('[zeko-relayer] transaction_build_completed');
  const feePayerUpdate = tx.feePayer;
  if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
    feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
  }
  if (feePayerUpdate?.body) {
    feePayerUpdate.body.useFullCommitment = Bool(true);
  }
  executionStage = 'transaction_send';
  console.info('[zeko-relayer] transaction_send_started');
  let pending;
  const signedTx = tx.sign([relayer, registryKey]);
  const localTxHash = await computeSignedTransactionHash(signedTx, Transaction);
  for (let sendAttempt = 1; sendAttempt <= ZEKO_TX_SEND_RETRY_LIMIT; sendAttempt += 1) {
    try {
      const sendPromise = signedTx.send();
      pending = await withTimeout(sendPromise, ZEKO_TX_SEND_TIMEOUT_MS, () => {
        const err = new Error(`mission_auth_registry_send_timeout:${ZEKO_TX_SEND_TIMEOUT_MS}`);
        err.executionStage = executionStage;
        err.submissionUncertain = true;
        err.safeToRetry = sendAttempt < ZEKO_TX_SEND_RETRY_LIMIT;
        err.txHash = localTxHash;
        return err;
      });
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      error.executionStage = executionStage;
      error.submissionUncertain = true;
      error.txHash = error.txHash || localTxHash;
      if (!isTransientSendError(message) || sendAttempt >= ZEKO_TX_SEND_RETRY_LIMIT) {
        error.safeToRetry = false;
        throw error;
      }
      console.warn(`[zeko-relayer] transaction_send_retry attempt=${sendAttempt} txHash=${localTxHash || 'unknown'} message=${JSON.stringify(message.slice(0, 300))}`);
      await new Promise((resolve) => setTimeout(resolve, 2500 * sendAttempt));
    }
  }
  console.info('[zeko-relayer] transaction_send_completed');
  const txHash = pending?.hash?.toString?.() ?? pending?.hash ?? pending?.transactionHash ?? localTxHash;
  if (Array.isArray(pending?.errors) && pending.errors.length > 0) {
    const err = new Error('mission_auth_registry_broadcast_rejected');
    err.statusCode = 502;
    throw err;
  }
  if (!txHash) {
    const err = new Error('mission_auth_registry_broadcast_missing_hash');
    err.statusCode = 502;
    throw err;
  }

  return {
    txHash,
    mode: 'mission_auth_registry',
    registryPublicKey: registryPublicKey.toBase58(),
    relayerPublicKey: relayerPublicKey.toBase58(),
    statementHash: statementHash.toString(),
    payloadDigest: payloadDigest.toString(),
    nonce: relayerNonce
  };
}

async function runSubmitOnce(submissionId) {
  const submission = await getSubmission(submissionId);
  if (!submission?.anchorPayload || !submission?.payloadHash) {
    const err = new Error(`submission_not_found:${submissionId}`);
    err.statusCode = 404;
    throw err;
  }
  try {
    const sent = await submitMissionAuthRegistryAnchor(submission.anchorPayload, submission.payloadHash);
    const updated = await updateSubmission(submission.id, {
      status: sent.txHash ? 'submitted' : 'pending',
      txHash: sent.txHash,
      result: {
        accepted: true,
        ...sent
      }
    });
    console.log(JSON.stringify({
      ok: true,
      id: updated.id,
      status: updated.status,
      txHash: updated.txHash,
      payloadHash: updated.payloadHash,
      result: updated.result
    }));
    return updated;
  } catch (error) {
    const stage = String(error?.executionStage || 'mission_auth_registry');
    const submissionUncertain = Boolean(error?.submissionUncertain);
    const message = error instanceof Error ? error.message : String(error);
    await updateSubmission(submission.id, {
      status: submissionUncertain ? 'submission_unknown' : 'failed',
      txHash: error?.txHash || submission.txHash || null,
      result: {
        accepted: false,
        errorCode: message || 'relayer_submission_failed',
        stage,
        txHash: error?.txHash || submission.txHash || null,
        safeToRetrySamePayload: !submissionUncertain && error?.safeToRetry !== false
      }
    }).catch(() => null);
    error.executionStage = stage;
    error.submissionUncertain = submissionUncertain;
    throw error;
  }
}

function runSubmitOnceChild(submissionId) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(process.execPath, [new URL(import.meta.url).pathname, '--submit-once', submissionId], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      const err = new Error(`mission_auth_registry_child_timeout:${ZEKO_RELAYER_JOB_TIMEOUT_MS}`);
      err.executionStage = 'mission_auth_registry_child';
      err.submissionUncertain = true;
      err.safeToRetry = false;
      finish(() => reject(err));
    }, ZEKO_RELAYER_JOB_TIMEOUT_MS);
    timeout.unref?.();
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 256 * 1024) stdout = stdout.slice(-128 * 1024);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 256 * 1024) stderr = stderr.slice(-128 * 1024);
    });
    child.on('error', (error) => {
      error.executionStage = 'mission_auth_registry_child_spawn';
      finish(() => reject(error));
    });
    child.on('exit', (code, signal) => {
      if (settled) return;
      if (code === 0) {
        try {
          const lines = stdout.trim().split('\n').filter(Boolean);
          const parsed = JSON.parse(lines.at(-1) || '{}');
          return finish(() => resolve(parsed));
        } catch (error) {
          error.executionStage = 'mission_auth_registry_child_parse';
          return finish(() => reject(error));
        }
      }
      const err = new Error(stderr.trim().slice(-1000) || `mission_auth_registry_child_exit:${code ?? signal}`);
      err.executionStage = 'mission_auth_registry_child';
      err.submissionUncertain = /submission_unknown|send_timeout|SIGKILL|timeout|Bad Gateway|Gateway Timeout|502|504/i.test(String(stderr || signal || ''));
      finish(() => reject(err));
    });
  });
}

async function handleSubmit(req, res) {
  assertToken(req);
  const body = await readBody(req);
  const anchorPayload = requireAnchorPayload(body);
  const payloadHash = `0x${stableHash(anchorPayload)}`;
  const networkId = body.networkId || ZEKO_NETWORK_ID;
  const anchorKey = buildAnchorKey(anchorPayload, networkId);

  const recentSubmissions = await listSubmissions(200);
  const previous = recentSubmissions.find((candidate) => {
    if (candidate.anchorKey === anchorKey) return true;
    if (!candidate.anchorPayload) return candidate.payloadHash === payloadHash;
    return buildAnchorKey(candidate.anchorPayload, candidate.networkId || ZEKO_NETWORK_ID) === anchorKey;
  }) || await findSubmissionByPayloadHash(payloadHash);
  if (previous?.status === 'submitted' && previous.txHash) {
    return sendJson(res, 200, {
      id: previous.id,
      status: previous.status,
      txHash: previous.txHash,
      payloadHash: previous.payloadHash,
      anchorKey,
      result: previous.result,
      deduplicated: true
    });
  }
  if (previous?.status === 'submission_unknown') {
    return sendJson(res, 202, {
      id: previous.id,
      status: previous.status,
      txHash: previous.txHash || previous.result?.txHash || null,
      payloadHash: previous.payloadHash,
      anchorKey,
      result: previous.result || {
        accepted: false,
        errorCode: 'mission_auth_submission_unknown',
        txHash: previous.txHash || null
      }
    });
  }
  if (['received', 'processing'].includes(previous?.status)) {
    return sendJson(res, 409, {
      error: 'mission_auth_submission_in_progress',
      id: previous.id,
      status: previous.status,
      payloadHash: previous.payloadHash,
      anchorKey
    });
  }

  const submission = previous?.status === 'failed'
    ? await updateSubmission(previous.id, {
        status: 'received',
        mode: MODE,
        payloadHash,
        anchorKey,
        networkId,
        anchorPayload,
        txPlan: buildTxPlan(anchorPayload, payloadHash),
        result: { retryingSamePayload: true }
      })
    : await createSubmission({
        status: 'received',
        mode: MODE,
        payloadHash,
        anchorKey,
        networkId,
        anchorPayload,
        txPlan: buildTxPlan(anchorPayload, payloadHash)
      });

  if (MODE === 'record') {
    const updated = await updateSubmission(submission.id, {
      status: 'submitted',
      txHash: null,
      result: {
        accepted: true,
        mode: 'record'
      }
    });
    return sendJson(res, 201, {
      id: updated.id,
      status: updated.status,
      txHash: updated.txHash,
      payloadHash: updated.payloadHash
    });
  }

  if (MODE === 'plan') {
    const updated = await updateSubmission(submission.id, {
      status: 'planned',
      txHash: null,
      result: {
        accepted: true,
        mode: 'plan'
      }
    });
    return sendJson(res, 201, {
      id: updated.id,
      status: updated.status,
      txHash: updated.txHash,
      payloadHash: updated.payloadHash,
      txPlan: updated.txPlan
    });
  }

  if (MODE === 'payment_memo') {
    const sent = await submitAnchorPayment(anchorPayload, payloadHash);
    const updated = await updateSubmission(submission.id, {
      status: sent.txHash ? 'submitted' : 'pending',
      txHash: sent.txHash,
      result: {
        accepted: true,
        mode: 'payment_memo',
        ...sent
      }
    });
    return sendJson(res, 201, {
      id: updated.id,
      status: updated.status,
      txHash: updated.txHash,
      payloadHash: updated.payloadHash,
      result: updated.result
    });
  }

  if (MODE === 'mission_auth_registry') {
    try {
      await updateSubmission(submission.id, {
        status: 'processing',
        result: { accepted: true, stage: 'mission_auth_registry' }
      });
      const childResult = await runSubmitOnceChild(submission.id);
      const updated = await getSubmission(submission.id) || childResult;
      return sendJson(res, 201, {
        id: updated.id,
        status: updated.status,
        txHash: updated.txHash,
        payloadHash: updated.payloadHash,
        result: updated.result
      });
    } catch (error) {
      const stage = String(error?.executionStage || 'mission_auth_registry');
      const current = await getSubmission(submission.id).catch(() => null);
      const submissionUncertain = Boolean(error?.submissionUncertain || current?.status === 'submission_unknown');
      const preservedTxHash = error?.txHash || current?.txHash || current?.result?.txHash || null;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[zeko-relayer] mission_auth_submit_failed stage=${stage} uncertain=${submissionUncertain} message=${JSON.stringify(message.slice(0, 500))} cause=${JSON.stringify(String(error?.cause?.message || error?.cause || '').slice(0, 500))}`);
      const updated = await updateSubmission(submission.id, {
        status: submissionUncertain ? 'submission_unknown' : 'failed',
        txHash: preservedTxHash,
        result: {
          accepted: false,
          errorCode: message || 'relayer_submission_failed',
          stage,
          txHash: preservedTxHash,
          safeToRetrySamePayload: !submissionUncertain && error?.safeToRetry !== false
        }
      }).catch(() => null);
      if (submissionUncertain) {
        return sendJson(res, 202, {
          id: updated?.id || submission.id,
          status: updated?.status || 'submission_unknown',
          txHash: updated?.txHash || preservedTxHash,
          payloadHash: updated?.payloadHash || submission.payloadHash,
          anchorKey,
          result: updated?.result || {
            accepted: false,
            errorCode: message || 'relayer_submission_unknown',
            stage,
            txHash: preservedTxHash,
            safeToRetrySamePayload: false
          }
        });
      }
      return sendJson(res, error?.statusCode ?? 502, {
        error: message || 'relayer_submission_failed',
        id: updated?.id || submission.id,
        status: updated?.status || 'failed',
        txHash: updated?.txHash || preservedTxHash,
        payloadHash: updated?.payloadHash || submission.payloadHash,
        anchorKey,
        result: updated?.result || null
      });
    }
  }

  const err = new Error(`unsupported_relayer_mode:${MODE}`);
  err.statusCode = 500;
  throw err;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'zeko-relayer',
        mode: MODE,
        networkId: ZEKO_NETWORK_ID,
        o1jsNetworkId: ZEKO_O1JS_NETWORK_ID,
        graphql: ZEKO_GRAPHQL,
        archive: ZEKO_ARCHIVE,
        registryConfigured: Boolean(MISSION_AUTH_REGISTRY_PUBLIC_KEY || MISSION_AUTH_REGISTRY_PRIVATE_KEY),
        persistence: getZekoRelayerPersistenceStatus()
      });
    }

    if (req.method === 'GET' && url.pathname === '/submissions') {
      assertToken(req);
      return sendJson(res, 200, {
        submissions: await listSubmissions(Number(url.searchParams.get('limit') ?? 20))
      });
    }

    if (req.method === 'GET' && /^\/submissions\/[^/]+$/.test(url.pathname)) {
      assertToken(req);
      const id = url.pathname.split('/').filter(Boolean)[1];
      const submission = await getSubmission(id);
      if (!submission) return sendJson(res, 404, { error: 'not_found' });
      return sendJson(res, 200, submission);
    }

    if (req.method === 'POST' && url.pathname === '/submit') {
      return await handleSubmit(req, res);
    }

    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    return sendJson(res, error?.statusCode ?? 500, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

if (SUBMIT_ONCE_ID) {
  runSubmitOnce(SUBMIT_ONCE_ID).catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exit(1);
  });
} else {
  server.listen(PORT, HOST, () => {
    console.log(`[zeko-relayer] listening on http://${HOST}:${PORT}`);
    console.log(`[zeko-relayer] mode=${MODE} network=${ZEKO_NETWORK_ID} graphql=${ZEKO_GRAPHQL}`);
  });
}
