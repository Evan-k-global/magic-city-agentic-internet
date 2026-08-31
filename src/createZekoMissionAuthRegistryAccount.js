import fs from 'node:fs';
import path from 'node:path';
import { PrivateKey } from 'o1js';

function networkSlug(value) {
  const normalized = String(value || 'zeko:testnet')
    .toLowerCase()
    .replace(/^zeko:/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'testnet';
}

function writeJson(filePath, value, mode = null) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  if (mode) fs.chmodSync(filePath, mode);
}

const networkId =
  process.env.ZEKO_MISSION_AUTH_NETWORK_ID ||
  process.env.ZEKO_NETWORK_ID ||
  'zeko:testnet';
const slug = networkSlug(networkId);
const DEFAULT_PRIVATE_PATH = path.resolve(
  process.cwd(),
  '.magic-city-secrets',
  `zeko-${slug}-mission-auth-registry.private.json`
);
const DEFAULT_PUBLIC_PATH = path.resolve(
  process.cwd(),
  'data',
  `zeko-${slug}-mission-auth-registry.public.json`
);
const mina =
  process.env.ZEKO_MISSION_AUTH_GRAPHQL ||
  process.env.ZEKO_GRAPHQL ||
  'https://testnet.zeko.io/graphql';
const archive =
  process.env.ZEKO_MISSION_AUTH_ARCHIVE ||
  process.env.ZEKO_ARCHIVE ||
  'https://archive.testnet.zeko.io/graphql';
const o1jsNetworkId = process.env.ZEKO_O1JS_NETWORK_ID || 'testnet';
const privatePath = process.env.ZEKO_MISSION_AUTH_REGISTRY_PRIVATE_PATH || DEFAULT_PRIVATE_PATH;
const publicPath = process.env.ZEKO_MISSION_AUTH_REGISTRY_PUBLIC_PATH || DEFAULT_PUBLIC_PATH;

const configuredRelayerPrivateKey =
  process.env.ZEKO_RELAYER_PRIVATE_KEY ||
  process.env.ZEKO_MISSION_AUTH_RELAYER_PRIVATE_KEY ||
  process.env.SUBMITTER_PRIVATE_KEY ||
  '';
const relayerKey = configuredRelayerPrivateKey
  ? PrivateKey.fromBase58(configuredRelayerPrivateKey)
  : PrivateKey.random();
const registryKey = PrivateKey.random();
const relayerPublicKey = relayerKey.toPublicKey().toBase58();
const registryPublicKey = registryKey.toPublicKey().toBase58();
const generatedAtIso = new Date().toISOString();

const privateDeployment = {
  label: 'MagicCityMissionAuthRegistry',
  networkId,
  o1jsNetworkId,
  mina,
  archive,
  generatedAtIso,
  relayerPublicKey,
  relayerPrivateKey: relayerKey.toBase58(),
  registryPublicKey,
  registryPrivateKey: registryKey.toBase58(),
  status: 'keys_generated_waiting_for_funded_relayer',
  fundThisAddressForDeploy: relayerPublicKey
};

const publicDeployment = {
  ...privateDeployment,
  relayerPrivateKey: '[redacted]',
  registryPrivateKey: '[redacted]'
};

writeJson(privatePath, privateDeployment, 0o600);
writeJson(publicPath, publicDeployment);

console.log(JSON.stringify({
  role: 'magic_city_zeko_mission_auth_registry',
  networkId,
  o1jsNetworkId,
  mina,
  archive,
  registryPublicKey,
  relayerPublicKey,
  fundThisAddressForDeploy: relayerPublicKey,
  privatePath,
  publicPath,
  next: [
    `Fund ${relayerPublicKey} on ${networkId} for deploy fees and future relayer anchor fees.`,
    'Run npm run zeko:registry:deploy after funding.',
    'Set Magic City/Fly env to use the deployed registry address after deployment.'
  ]
}, null, 2));
