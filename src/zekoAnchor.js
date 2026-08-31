import crypto from 'node:crypto';

const DEFAULT_MAGIC_CITY_MISSION_PROOF_NETWORK_ID = 'zeko:testnet';
function resolveMissionProofNetworkId() {
  const explicit = String(process.env.MAGIC_CITY_MISSION_PROOF_NETWORK_ID || '').trim();
  if (explicit) return explicit;
  const legacy = String(process.env.ZEKO_NETWORK_ID || '').trim();
  return legacy || DEFAULT_MAGIC_CITY_MISSION_PROOF_NETWORK_ID;
}

const ZEKO_SUBMIT_MODE = process.env.ZEKO_SUBMIT_MODE || 'record';
const ZEKO_NETWORK_ID = resolveMissionProofNetworkId();
const ZEKO_OFFCHAIN_PROOF_TARGET_NETWORK = String(process.env.ZEKO_OFFCHAIN_PROOF_TARGET_NETWORK || '').trim();
const ZEKO_O1JS_NETWORK_ID =
  process.env.ZEKO_O1JS_NETWORK_ID ||
  (String(ZEKO_NETWORK_ID).includes('mainnet') ? 'zeko-mainnet' : 'testnet');
const ZEKO_RELAYER_URL = process.env.ZEKO_RELAYER_URL || process.env.ZEKO_SUBMITTER_URL || '';
const ZEKO_EXPLICIT_RELAYER_URL = process.env.ZEKO_RELAYER_URL || '';
const ZEKO_RELAYER_TOKEN = process.env.ZEKO_RELAYER_TOKEN || process.env.ZEKO_SUBMITTER_TOKEN || '';
const ZEKO_RELAYER_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.ZEKO_RELAYER_TIMEOUT_MS || 6 * 60 * 1000) || 6 * 60 * 1000
);
const ZEKO_IS_MAINNET = String(ZEKO_NETWORK_ID).includes('mainnet');
const ZEKO_IS_SEPOLIA = String(ZEKO_NETWORK_ID).includes('sepolia');
const ZEKO_GRAPHQL = process.env.ZEKO_GRAPHQL || (ZEKO_IS_SEPOLIA ? 'https://sepolia.zeko.io/graphql' : ZEKO_IS_MAINNET ? 'https://mainnet.zeko.io/graphql' : 'https://testnet.zeko.io/graphql');
const ZEKO_ARCHIVE = process.env.ZEKO_ARCHIVE || (ZEKO_IS_SEPOLIA ? ZEKO_GRAPHQL : ZEKO_IS_MAINNET ? 'https://archive.mainnet.zeko.io/graphql' : ZEKO_GRAPHQL);
const ZEKO_EXPLORER_TX_BASE = process.env.ZEKO_EXPLORER_TX_BASE ||
  (ZEKO_IS_SEPOLIA ? 'https://sepolia.zeko.io/v1/explorer/transactions/{tx}' : String(ZEKO_NETWORK_ID).includes('mainnet') ? 'https://zekoscan.io/mainnet/tx/{tx}?type=zk-tx' : 'https://zekoscan.io/testnet/tx/{tx}?type=zk-tx');
const TX_FEE = process.env.TX_FEE || (ZEKO_IS_SEPOLIA ? '200000' : '100000000');
const ZEKO_RELAYER_MODE = process.env.ZEKO_RELAYER_MODE || process.env.ZEKO_SUBMITTER_MODE || 'record';
const ZEKO_RELAYER_PRIVATE_KEY =
  process.env.ZEKO_RELAYER_PRIVATE_KEY ||
  process.env.ZEKO_MISSION_AUTH_RELAYER_PRIVATE_KEY ||
  process.env.SUBMITTER_PRIVATE_KEY ||
  '';
const ZEKO_MISSION_AUTH_REGISTRY_PUBLIC_KEY = process.env.ZEKO_MISSION_AUTH_REGISTRY_PUBLIC_KEY || '';
const ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_KEY = process.env.ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_KEY || '';

function hasInProcessMissionAuthRelayer() {
  return Boolean(
    ZEKO_RELAYER_MODE === 'mission_auth_registry' &&
    ZEKO_RELAYER_PRIVATE_KEY &&
    ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_KEY
  );
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function makeTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  return { controller, timeout };
}

export function getAnchorConfig() {
  return {
    mode: ZEKO_SUBMIT_MODE,
    networkId: ZEKO_NETWORK_ID,
    offchain: ZEKO_SUBMIT_MODE !== 'relay',
    offchainTargetNetwork: ZEKO_OFFCHAIN_PROOF_TARGET_NETWORK || null,
    o1jsNetworkId: ZEKO_O1JS_NETWORK_ID,
    explorerTxBase: ZEKO_EXPLORER_TX_BASE,
    relayerMode: ZEKO_RELAYER_MODE,
    relayerConfigured: Boolean(ZEKO_RELAYER_URL),
    externalRelayerConfigured: Boolean(ZEKO_EXPLICIT_RELAYER_URL),
    inProcessRelayerConfigured: hasInProcessMissionAuthRelayer(),
    submitterConfigured: Boolean(ZEKO_RELAYER_URL || hasInProcessMissionAuthRelayer())
  };
}

export function zekoExplorerTxUrl(txHash) {
  const trimmed = String(txHash || '').trim();
  if (!trimmed) return null;
  const base = String(ZEKO_EXPLORER_TX_BASE || '').trim();
  if (!base) return null;
  if (base.includes('{tx}')) return base.replaceAll('{tx}', encodeURIComponent(trimmed));
  const separator = base.endsWith('/') ? '' : '/';
  return `${base}${separator}${encodeURIComponent(trimmed)}`;
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

const ACCOUNT_CACHE_QUERY = `query Account($pk: PublicKey!) {
  account(publicKey: $pk) {
    publicKey
    nonce
    balance { total }
    zkappState
    verificationKey { hash }
    provedState
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

async function submitInProcessMissionAuthAnchor(anchorPayload, payloadHash) {
  if (ZEKO_RELAYER_MODE !== 'mission_auth_registry') {
    const err = new Error(`in_process_relayer_unsupported_mode:${ZEKO_RELAYER_MODE}`);
    err.statusCode = 503;
    throw err;
  }
  if (!ZEKO_RELAYER_PRIVATE_KEY) {
    const err = new Error('ZEKO_RELAYER_PRIVATE_KEY_not_configured');
    err.statusCode = 503;
    throw err;
  }
  if (!ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_KEY) {
    const err = new Error('ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_KEY_not_configured');
    err.statusCode = 503;
    throw err;
  }

  const {
    Mina,
    PrivateKey,
    PublicKey,
    Bool,
    Field,
    Poseidon,
    UInt32,
    fetchAccount,
    addCachedAccount,
    parseFetchedAccount
  } = await import('o1js');
  const { MagicCityMissionAuthRegistry } = await import('./zekoMissionAuthRegistry.js');

  Mina.setActiveInstance(Mina.Network({
    networkId: ZEKO_O1JS_NETWORK_ID,
    mina: ZEKO_GRAPHQL,
    archive: ZEKO_ARCHIVE
  }));

  await MagicCityMissionAuthRegistry.compile();

  const relayer = PrivateKey.fromBase58(ZEKO_RELAYER_PRIVATE_KEY);
  const registryKey = PrivateKey.fromBase58(ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_KEY);
  const registryPublicKey = ZEKO_MISSION_AUTH_REGISTRY_PUBLIC_KEY
    ? PublicKey.fromBase58(ZEKO_MISSION_AUTH_REGISTRY_PUBLIC_KEY)
    : registryKey.toPublicKey();
  const relayerPublicKey = relayer.toPublicKey();

  if (registryPublicKey.toBase58() !== registryKey.toPublicKey().toBase58()) {
    const err = new Error('mission_auth_registry_key_mismatch');
    err.statusCode = 500;
    throw err;
  }

  const registryAccount = await fetchAndCacheAccountWithGraphqlFallback({
    publicKey: registryPublicKey,
    fetchAccount,
    addCachedAccount,
    parseFetchedAccount,
    graphqlUrl: ZEKO_GRAPHQL
  });
  if (registryAccount.error || !accountResultHasDeployedZkapp(registryAccount)) {
    const err = new Error(`mission_auth_registry_not_deployed:${registryPublicKey.toBase58()}`);
    err.statusCode = 503;
    throw err;
  }

  const statementHash = fieldFromHashLike(anchorPayload.statementHash, Field, Poseidon);
  const payloadDigest = fieldFromText(payloadHash, Field, Poseidon);
  const nonce = await readRelayerNonce(relayerPublicKey, ZEKO_GRAPHQL, fetchAccount);
  const zkapp = new MagicCityMissionAuthRegistry(registryPublicKey);
  const tx = await Mina.transaction({ sender: relayerPublicKey, fee: TX_FEE, nonce }, async () => {
    await zkapp.anchorMissionAuth(statementHash, payloadDigest);
  });

  const feePayerUpdate = tx.feePayer;
  if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
    feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
  }
  if (feePayerUpdate?.body) {
    feePayerUpdate.body.useFullCommitment = Bool(true);
  }

  const sent = await tx.sign([relayer, registryKey]).send();
  const txHash = sent?.hash?.toString?.() ?? sent?.hash ?? sent?.transactionHash ?? null;
  return {
    mode: 'mission_auth_registry',
    status: txHash ? 'submitted' : 'pending',
    txHash,
    registryPublicKey: registryPublicKey.toBase58(),
    relayerPublicKey: relayerPublicKey.toBase58(),
    statementHash: statementHash.toString(),
    payloadDigest: payloadDigest.toString(),
    nonce
  };
}

export async function submitAnchorPayload(anchorPayload) {
  const payloadHash = `0x${stableHash(anchorPayload)}`;

  if (ZEKO_SUBMIT_MODE === 'relay') {
    if (!ZEKO_EXPLICIT_RELAYER_URL && hasInProcessMissionAuthRelayer()) {
      const direct = await submitInProcessMissionAuthAnchor(anchorPayload, payloadHash);
      return {
        mode: 'relay',
        status: direct.status || 'submitted',
        payloadHash,
        relayer: {
          mode: 'in_process',
          response: direct
        },
        txHash: direct.txHash ?? null,
        networkId: ZEKO_NETWORK_ID
      };
    }

    if (!ZEKO_RELAYER_URL) {
      const err = new Error('zeko_relayer_not_configured');
      err.statusCode = 503;
      throw err;
    }

    const { controller, timeout } = makeTimeoutSignal(ZEKO_RELAYER_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(ZEKO_RELAYER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          ...(ZEKO_RELAYER_TOKEN ? { authorization: `Bearer ${ZEKO_RELAYER_TOKEN}` } : {})
        },
        body: JSON.stringify({
          networkId: ZEKO_NETWORK_ID,
          anchorPayload
        })
      });
    } catch (error) {
      const err = new Error(error?.name === 'AbortError'
        ? `zeko_relayer_timeout:${ZEKO_RELAYER_TIMEOUT_MS}`
        : `zeko_relayer_fetch_failed:${error instanceof Error ? error.message : String(error)}`);
      err.statusCode = error?.name === 'AbortError' ? 504 : 502;
      err.details = { relayerUrl: ZEKO_RELAYER_URL, timeoutMs: ZEKO_RELAYER_TIMEOUT_MS };
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    const raw = await response.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = { raw };
    }

    if (!response.ok) {
      const err = new Error(parsed?.error || `zeko_submit_failed:${response.status}`);
      err.statusCode = 502;
      err.details = parsed;
      throw err;
    }

    return {
      mode: 'relay',
      status: parsed?.status || 'submitted',
      payloadHash,
      relayer: {
        url: ZEKO_RELAYER_URL,
        response: parsed
      },
      relay: {
        url: ZEKO_RELAYER_URL,
        response: parsed
      },
      txHash: parsed?.txHash ?? null,
      networkId: ZEKO_NETWORK_ID
    };
  }

  return {
    mode: 'record',
    status: 'prepared',
    payloadHash,
    txHash: null,
    networkId: ZEKO_NETWORK_ID
  };
}
