import assert from 'node:assert/strict';
import {
  AccountUpdate,
  Field,
  Mina,
  PrivateKey,
  UInt64
} from 'o1js';
import { MagicCityMissionAuthRegistry } from '../src/zekoMissionAuthRegistry.js';

const local = await Mina.LocalBlockchain({ proofsEnabled: false });
Mina.setActiveInstance(local);

const feePayer = local.testAccounts[0];
const registryKey = PrivateKey.random();
const registry = new MagicCityMissionAuthRegistry(registryKey.toPublicKey());

const deploy = await Mina.transaction(feePayer, async () => {
  AccountUpdate.fundNewAccount(feePayer);
  await registry.deploy();
});
await deploy.prove();
await deploy.sign([feePayer.key, registryKey]).send();

const update = await Mina.transaction(feePayer, async () => {
  await registry.anchorMissionAuth(Field(123), Field(456));
});
await update.sign([feePayer.key, registryKey]).send();

assert.equal(registry.latestStatementHash.get().toString(), '123');
assert.equal(registry.latestPayloadDigest.get().toString(), '456');
assert.equal(registry.anchoredCount.get().toString(), UInt64.from(1).toString());

console.log('mission authorization signature registry regression passed');
