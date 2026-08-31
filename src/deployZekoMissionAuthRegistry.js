import fs from 'node:fs';
import path from 'node:path';
import {
  AccountUpdate,
  Bool,
  Mina,
  PrivateKey,
  UInt32,
  fetchAccount
} from 'o1js';
import { MagicCityMissionAuthRegistry } from './zekoMissionAuthRegistry.js';

function networkSlug(value) {
  const normalized = String(value || 'zeko:testnet')
    .toLowerCase()
    .replace(/^zeko:/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'testnet';
}

function networkLooksMainnet(value) {
  const normalized = String(value ?? '').toLowerCase();
  return normalized.includes('mainnet') && !normalized.includes('testnet');
}

function networkLooksSepolia(value) {
  return String(value ?? '').toLowerCase().includes('sepolia');
}

function endpointLooksTestnet(value) {
  return String(value ?? '').toLowerCase().includes('testnet');
}

function endpointLooksMainnet(value) {
  const normalized = String(value ?? '').toLowerCase();
  return normalized.includes('mainnet') && !normalized.includes('testnet');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value, mode = null) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (mode) fs.chmodSync(filePath, mode);
}

async function fetchAccountViaGraphql(graphqlUrl, publicKey) {
  const response = await fetch(graphqlUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: 'query Account($pk: PublicKey!) { account(publicKey: $pk) { publicKey balance { total } nonce inferredNonce } }',
      variables: { pk: publicKey }
    })
  });
  if (!response.ok) throw new Error(`Unable to query ${graphqlUrl}: HTTP ${response.status}`);
  const payload = await response.json();
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(payload.errors[0]?.message ?? 'GraphQL account query failed.');
  }
  return payload.data?.account ?? null;
}

const pathNetworkId =
  process.env.ZEKO_MISSION_AUTH_NETWORK_ID ||
  process.env.ZEKO_NETWORK_ID ||
  'zeko:testnet';
const pathSlug = networkSlug(pathNetworkId);
const DEFAULT_PRIVATE_PATH = path.resolve(
  process.cwd(),
  '.magic-city-secrets',
  `zeko-${pathSlug}-mission-auth-registry.private.json`
);
const DEFAULT_PUBLIC_PATH = path.resolve(
  process.cwd(),
  'data',
  `zeko-${pathSlug}-mission-auth-registry.public.json`
);

const privatePath = process.env.ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_PATH || DEFAULT_PRIVATE_PATH;
const publicPath = process.env.ZEKO_MISSION_AUTH_REGISTRY_PUBLIC_PATH || DEFAULT_PUBLIC_PATH;
const existing = fs.existsSync(privatePath) ? readJson(privatePath) : {};

const networkId =
  process.env.ZEKO_MISSION_AUTH_NETWORK_ID ||
  existing.networkId ||
  process.env.ZEKO_NETWORK_ID ||
  'zeko:testnet';
const isMainnet = networkLooksMainnet(networkId);
const isSepolia = networkLooksSepolia(networkId);
const mina =
  process.env.ZEKO_MISSION_AUTH_GRAPHQL ||
  existing.mina ||
  (isSepolia ? 'https://sepolia.zeko.io/graphql' : '') ||
  (isMainnet ? 'https://mainnet.zeko.io/graphql' : 'https://testnet.zeko.io/graphql');
const archive =
  process.env.ZEKO_MISSION_AUTH_ARCHIVE ||
  existing.archive ||
  (isSepolia ? 'https://sepolia.zeko.io/graphql' : '') ||
  (isMainnet ? 'https://archive.mainnet.zeko.io/graphql' : 'https://archive.testnet.zeko.io/graphql');
const o1jsNetworkId =
  process.env.ZEKO_O1JS_NETWORK_ID ||
  existing.o1jsNetworkId ||
  (isMainnet ? 'zeko-mainnet' : 'testnet');
const fee = process.env.TX_FEE || (isSepolia ? '200000' : '100000000');
const confirmMainnet =
  process.argv.includes('--confirm-mainnet') ||
  process.env.ZEKO_CONFIRM_MAINNET === 'true' ||
  process.env.ZEKO_CONFIRM_MAINNET === '1';

if (isMainnet && !confirmMainnet) {
  throw new Error('Refusing to deploy to Zeko mainnet without ZEKO_CONFIRM_MAINNET=true or --confirm-mainnet.');
}
if (isMainnet && (endpointLooksTestnet(mina) || endpointLooksTestnet(archive))) {
  throw new Error('Zeko mainnet deployment cannot use testnet GraphQL/archive endpoints.');
}
if (!isMainnet && (endpointLooksMainnet(mina) || endpointLooksMainnet(archive))) {
  throw new Error('Mainnet endpoints require ZEKO_NETWORK_ID=zeko:zeko-mainnet and explicit mainnet confirmation.');
}

const relayerPrivateKey =
  process.env.ZEKO_RELAYER_PRIVATE_KEY ||
  process.env.ZEKO_MISSION_AUTH_RELAYER_PRIVATE_KEY ||
  existing.relayerPrivateKey;
const registryPrivateKey =
  process.env.ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_KEY ||
  existing.registryPrivateKey;

if (!relayerPrivateKey) throw new Error(`Missing relayer private key. Generate ${privatePath} first.`);
if (!registryPrivateKey) throw new Error(`Missing registry private key. Generate ${privatePath} first.`);

Mina.setActiveInstance(Mina.Network({ networkId: o1jsNetworkId, mina, archive }));

const relayer = PrivateKey.fromBase58(relayerPrivateKey);
const registryKey = PrivateKey.fromBase58(registryPrivateKey);
const relayerPublicKey = relayer.toPublicKey();
const registryPublicKey = registryKey.toPublicKey();

const relayerAccount = await fetchAccountViaGraphql(mina, relayerPublicKey.toBase58());
if (!relayerAccount) {
  throw new Error(`Relayer/deployer account is not funded on ${networkId}: ${relayerPublicKey.toBase58()}`);
}

const registryAccount = await fetchAccount({ publicKey: registryPublicKey });
if (!registryAccount.error && registryAccount.account?.zkapp) {
  throw new Error(`Registry zkApp already appears deployed: ${registryPublicKey.toBase58()}`);
}

console.log(JSON.stringify({
  phase: 'prepared',
  networkId,
  o1jsNetworkId,
  mina,
  archive,
  fee,
  relayerPublicKey: relayerPublicKey.toBase58(),
  registryPublicKey: registryPublicKey.toBase58(),
  relayerBalance: relayerAccount.balance?.total ?? null
}, null, 2));

await MagicCityMissionAuthRegistry.compile();

const relayerNonce = Number(relayerAccount.inferredNonce ?? relayerAccount.nonce ?? 0);
const tx = await Mina.transaction({ sender: relayerPublicKey, fee, nonce: relayerNonce }, async () => {
  AccountUpdate.fundNewAccount(relayerPublicKey);
  const zkapp = new MagicCityMissionAuthRegistry(registryPublicKey);
  zkapp.deploy();
});
await tx.prove();
const feePayerUpdate = tx.feePayer;
if (feePayerUpdate?.body?.preconditions?.account?.nonce) {
  feePayerUpdate.body.preconditions.account.nonce = { isSome: Bool(false), value: UInt32.from(0) };
}
if (feePayerUpdate?.body) {
  feePayerUpdate.body.useFullCommitment = Bool(true);
}
const pending = await tx.sign([relayer, registryKey]).send();
const txHash =
  typeof pending === 'object' && pending !== null && typeof pending.hash === 'string'
    ? pending.hash
    : pending?.hash?.toString?.() ?? null;

const deployedAtIso = new Date().toISOString();
const privateDeployment = {
  ...existing,
  label: 'MagicCityMissionAuthRegistry',
  networkId,
  o1jsNetworkId,
  mina,
  archive,
  fee,
  relayerPublicKey: relayerPublicKey.toBase58(),
  relayerPrivateKey,
  registryPublicKey: registryPublicKey.toBase58(),
  registryPrivateKey,
  txHash,
  deployedAtIso,
  status: txHash ? 'submitted' : 'pending',
  fundedNewAccount: true
};
const publicDeployment = {
  ...privateDeployment,
  relayerPrivateKey: '[redacted]',
  registryPrivateKey: '[redacted]'
};

writeJson(privatePath, privateDeployment, 0o600);
writeJson(publicPath, publicDeployment);

console.log(JSON.stringify({
  phase: 'deployed',
  networkId,
  o1jsNetworkId,
  registryPublicKey: registryPublicKey.toBase58(),
  relayerPublicKey: relayerPublicKey.toBase58(),
  txHash,
  privatePath,
  publicPath,
  flyEnv: {
    ZEKO_NETWORK_ID: networkId,
    ZEKO_O1JS_NETWORK_ID: o1jsNetworkId,
    ZEKO_GRAPHQL: mina,
    ZEKO_ARCHIVE: archive,
    ZEKO_SUBMIT_MODE: 'relay',
    ZEKO_RELAYER_MODE: 'mission_auth_registry',
    ZEKO_MISSION_AUTH_REGISTRY_PUBLIC_KEY: registryPublicKey.toBase58(),
    ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_KEY: 'set from privatePath',
    ZEKO_RELAYER_PRIVATE_KEY: 'set from privatePath'
  }
}, null, 2));
