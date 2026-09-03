import crypto from 'node:crypto';
import {
  getMbaMissionRegistryState,
  upsertMbaMissionRegistryState
} from '../store.js';

export const MBA_MISSION_REGISTRY_ADDRESS = 'B62qikuceF52NVPb8VAVSaRoCRMusFz38pLLENjvLaUuLiDnULAVohe';
const MBA_MISSION_REGISTRY_BOOTSTRAP = {
  version: 'mba-mission-registry-index-v1',
  sequence: '1',
  registryRoot: '28831116683740239225579803815979923155620183932789174387615564682385525427460',
  entries: [[
    '5568780413347644218822699808451866302063660054856528586459457408365175579051',
    '19093684846766124718732301466241521468728985321725733058078675734657878573393'
  ]]
};

let compilePromise = null;
let anchorTail = Promise.resolve();

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalValueToField(value, Field) {
  const input = typeof value === 'string' ? value : canonicalize(value);
  const digest = crypto.createHash('sha256').update(input).digest('hex');
  return Field(BigInt(`0x${digest}`) % Field.ORDER);
}

function configuredRegistryAddress() {
  return String(process.env.ZEKO_MBA_MISSION_REGISTRY_PUBLIC_KEY || process.env.MISSION_REGISTRY_PUBLIC_KEY || MBA_MISSION_REGISTRY_ADDRESS).trim();
}

function getConfig() {
  return {
    registryAddress: configuredRegistryAddress(),
    authorityPrivateKey: String(process.env.ZEKO_MBA_MISSION_AUTHORITY_PRIVATE_KEY || process.env.MISSION_AUTHORITY_ZEKO_PRIVATE_KEY || '').trim(),
    relayerPrivateKey: String(process.env.ZEKO_RELAYER_PRIVATE_KEY || process.env.ZEKO_MISSION_AUTH_RELAYER_PRIVATE_KEY || process.env.SUBMITTER_PRIVATE_KEY || '').trim(),
    graphql: String(process.env.ZEKO_GRAPHQL || 'https://sepolia.zeko.io/graphql').trim(),
    archive: String(process.env.ZEKO_ARCHIVE || process.env.ZEKO_GRAPHQL || 'https://sepolia.zeko.io/graphql').trim(),
    networkId: String(process.env.ZEKO_O1JS_NETWORK_ID || 'testnet').trim(),
    fee: String(process.env.TX_FEE || '200000').trim()
  };
}

export function getMbaMissionRegistryConfig() {
  const config = getConfig();
  return {
    mode: 'mba_mission_registry',
    registryAddress: config.registryAddress || null,
    authorityConfigured: Boolean(config.authorityPrivateKey),
    relayerConfigured: Boolean(config.relayerPrivateKey),
    configured: Boolean(config.registryAddress && config.authorityPrivateKey && config.relayerPrivateKey)
  };
}

function bootstrapState(registryAddress) {
  if (registryAddress !== MBA_MISSION_REGISTRY_ADDRESS) {
    const err = new Error(`mba_mission_registry_bootstrap_missing:${registryAddress}`);
    err.statusCode = 503;
    throw err;
  }
  return {
    registryAddress,
    ...MBA_MISSION_REGISTRY_BOOTSTRAP,
    entries: MBA_MISSION_REGISTRY_BOOTSTRAP.entries.map((entry) => [...entry]),
    pending: null
  };
}

function mapFromState(stored, Field, MerkleMap) {
  if (stored?.version !== 'mba-mission-registry-index-v1') {
    throw new Error('mba_mission_registry_state_version_invalid');
  }
  const map = new MerkleMap();
  for (const [key, value] of stored.entries ?? []) map.set(Field(key), Field(value));
  if (String(stored.registryRoot || '') !== map.getRoot().toString()) {
    throw new Error('mba_mission_registry_state_root_invalid');
  }
  return map;
}

function registryStateSnapshot(registry) {
  return {
    registryRoot: registry.registryRoot.get().toString(),
    sequence: registry.sequence.get().toString()
  };
}

async function compileContracts(MissionComplianceProgram, MissionRegistry) {
  if (!compilePromise) {
    compilePromise = (async () => {
      await MissionComplianceProgram.compile();
      return MissionRegistry.compile();
    })();
  }
  return compilePromise;
}

async function waitForRegistryState({ registry, fetchAccount, registryAddress, expectedRoot, expectedSequence, timeoutMs = 90_000 }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await fetchAccount({ publicKey: registryAddress });
    last = registryStateSnapshot(registry);
    if (last.registryRoot === expectedRoot && last.sequence === String(expectedSequence)) return last;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  const err = new Error(`mba_mission_registry_confirmation_timeout:${last?.registryRoot || 'unknown'}:${last?.sequence || 'unknown'}`);
  err.statusCode = 504;
  throw err;
}

function withAnchorLock(operation) {
  const next = anchorTail.then(operation, operation);
  anchorTail = next.catch(() => undefined);
  return next;
}

async function submitAnchor(anchorPayload, payloadHash) {
  const config = getConfig();
  if (!config.authorityPrivateKey) {
    const err = new Error('ZEKO_MBA_MISSION_AUTHORITY_PRIVATE_KEY_not_configured');
    err.statusCode = 503;
    throw err;
  }
  if (!config.relayerPrivateKey) {
    const err = new Error('ZEKO_RELAYER_PRIVATE_KEY_not_configured');
    err.statusCode = 503;
    throw err;
  }

  const {
    Field,
    MerkleMap,
    Mina,
    PrivateKey,
    PublicKey,
    Signature,
    UInt64,
    fetchAccount
  } = await import('o1js');
  const {
    MissionRegistry,
    approvalAuthorizationMessage,
    approvalRegistryKey
  } = await import('./MissionRegistry.js');
  const { MissionComplianceProgram } = await import('./MissionComplianceProgram.js');

  Mina.setActiveInstance(Mina.Network({
    networkId: config.networkId,
    mina: config.graphql,
    archive: config.archive
  }));
  await compileContracts(MissionComplianceProgram, MissionRegistry);

  const registryAddress = PublicKey.fromBase58(config.registryAddress);
  const authorityKey = PrivateKey.fromBase58(config.authorityPrivateKey);
  const relayerKey = PrivateKey.fromBase58(config.relayerPrivateKey);
  const relayerPublicKey = relayerKey.toPublicKey();
  const registryAccount = await fetchAccount({ publicKey: registryAddress });
  if (registryAccount.error || !registryAccount.account?.zkapp) {
    const err = new Error(`mba_mission_registry_not_deployed:${registryAddress.toBase58()}`);
    err.statusCode = 503;
    throw err;
  }

  const persisted = getMbaMissionRegistryState(registryAddress.toBase58()) || bootstrapState(registryAddress.toBase58());
  const registry = new MissionRegistry(registryAddress);
  let map = mapFromState(persisted, Field, MerkleMap);
  let onchain = registryStateSnapshot(registry);

  if (persisted.pending) {
    if (onchain.registryRoot === persisted.pending.nextRegistryRoot && onchain.sequence === String(persisted.pending.nextSequence)) {
      const entries = new Map(persisted.entries ?? []);
      entries.set(persisted.pending.registryKey, persisted.pending.approvalCommitment);
      const recovered = {
        ...persisted,
        sequence: String(persisted.pending.nextSequence),
        registryRoot: persisted.pending.nextRegistryRoot,
        entries: Array.from(entries.entries()).sort(([left], [right]) => BigInt(left) < BigInt(right) ? -1 : 1),
        pending: null,
        recoveredAt: new Date().toISOString()
      };
      upsertMbaMissionRegistryState(registryAddress.toBase58(), recovered);
      map = mapFromState(recovered, Field, MerkleMap);
      onchain = registryStateSnapshot(registry);
    } else {
      const err = new Error(`mba_mission_registry_pending_confirmation:${persisted.pending.txHash || 'unknown'}`);
      err.statusCode = 409;
      err.details = { pending: persisted.pending, observed: onchain };
      throw err;
    }
  }

  if (onchain.registryRoot !== map.getRoot().toString() || onchain.sequence !== String(persisted.sequence)) {
    const err = new Error('mba_mission_registry_state_out_of_sync');
    err.statusCode = 409;
    err.details = { local: { registryRoot: map.getRoot().toString(), sequence: String(persisted.sequence) }, onchain };
    throw err;
  }

  const missionBoundary = anchorPayload?.missionBoundary || {};
  const rawCapabilityHash = String(missionBoundary.protocolCapabilityHash || anchorPayload?.publicInputs?.protocolCapabilityHash || '').trim();
  if (!rawCapabilityHash) {
    const err = new Error('mba_mission_capability_commitment_missing');
    err.statusCode = 400;
    throw err;
  }
  const statementHash = String(anchorPayload?.statementHash || '').trim();
  if (!/^\d+$/.test(statementHash)) {
    const err = new Error('mba_anchor_statement_hash_invalid');
    err.statusCode = 400;
    throw err;
  }
  const capabilityCommitment = canonicalValueToField(rawCapabilityHash, Field);
  const approvalCommitment = Field(statementHash);
  const registryKey = approvalRegistryKey(capabilityCommitment);
  const witness = map.getWitness(registryKey);
  const sequence = UInt64.from(String(persisted.sequence));
  const authoritySignature = Signature.create(
    authorityKey,
    approvalAuthorizationMessage(registryAddress, sequence, capabilityCommitment, approvalCommitment)
  );
  const tx = await Mina.transaction({ sender: relayerPublicKey, fee: UInt64.from(config.fee) }, async () => {
    await registry.anchorApproval(capabilityCommitment, approvalCommitment, authoritySignature, witness);
  });
  await tx.prove();
  const sent = await tx.sign([relayerKey]).send();
  const txHash = sent?.hash?.toString?.() ?? sent?.hash ?? sent?.transactionHash ?? null;

  map.set(registryKey, approvalCommitment);
  const nextSequence = BigInt(persisted.sequence) + 1n;
  const pending = {
    txHash,
    capabilityCommitment: capabilityCommitment.toString(),
    approvalCommitment: approvalCommitment.toString(),
    registryKey: registryKey.toString(),
    nextRegistryRoot: map.getRoot().toString(),
    nextSequence: nextSequence.toString(),
    payloadHash,
    submittedAt: new Date().toISOString()
  };
  upsertMbaMissionRegistryState(registryAddress.toBase58(), { ...persisted, pending });

  await waitForRegistryState({
    registry,
    fetchAccount,
    registryAddress,
    expectedRoot: pending.nextRegistryRoot,
    expectedSequence: pending.nextSequence
  });

  const entries = new Map(persisted.entries ?? []);
  entries.set(pending.registryKey, pending.approvalCommitment);
  const stored = upsertMbaMissionRegistryState(registryAddress.toBase58(), {
    ...persisted,
    sequence: pending.nextSequence,
    registryRoot: pending.nextRegistryRoot,
    entries: Array.from(entries.entries()).sort(([left], [right]) => BigInt(left) < BigInt(right) ? -1 : 1),
    pending: null,
    lastAnchor: {
      txHash,
      capabilityCommitment: pending.capabilityCommitment,
      approvalCommitment: pending.approvalCommitment,
      registryKey: pending.registryKey,
      payloadHash,
      anchoredAt: new Date().toISOString()
    }
  });

  return {
    mode: 'mba_mission_registry',
    status: 'submitted',
    txHash,
    registryAddress: registryAddress.toBase58(),
    previousRegistryRoot: persisted.registryRoot,
    registryRoot: stored.registryRoot,
    sequence: stored.sequence,
    capabilityCommitment: pending.capabilityCommitment,
    approvalCommitment: pending.approvalCommitment,
    registryKey: pending.registryKey,
    relayerPublicKey: relayerPublicKey.toBase58()
  };
}

export function submitMbaMissionRegistryAnchor(anchorPayload, payloadHash) {
  return withAnchorLock(() => submitAnchor(anchorPayload, payloadHash));
}
