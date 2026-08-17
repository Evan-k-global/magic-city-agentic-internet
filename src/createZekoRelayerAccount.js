import { PrivateKey } from 'o1js';

const key = PrivateKey.random();
const publicKey = key.toPublicKey();
const missionProofNetworkId =
  process.env.MAGIC_CITY_MISSION_PROOF_NETWORK_ID ||
  process.env.ZEKO_NETWORK_ID ||
  'zeko:testnet';

console.log(JSON.stringify({
  role: 'zeko_relayer',
  networkId: missionProofNetworkId,
  publicKey: publicKey.toBase58(),
  privateKey: key.toBase58(),
  next: [
    'Fund the public key on Zeko testnet for Magic City mission-proof anchoring.',
    'Set ZEKO_RELAYER_PRIVATE_KEY in .env.',
    'Run npm run start:relayer.'
  ]
}, null, 2));
