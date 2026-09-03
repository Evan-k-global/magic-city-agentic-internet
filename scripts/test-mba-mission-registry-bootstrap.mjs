import assert from 'node:assert/strict';
import { Field, MerkleMap } from 'o1js';

const registryAddress = 'B62qikuceF52NVPb8VAVSaRoCRMusFz38pLLENjvLaUuLiDnULAVohe';
const expectedRoot = '28831116683740239225579803815979923155620183932789174387615564682385525427460';
const expectedSequence = '1';
const expectedEntries = [[
  '5568780413347644218822699808451866302063660054856528586459457408365175579051',
  '19093684846766124718732301466241521468728985321725733058078675734657878573393'
]];

const map = new MerkleMap();
for (const [key, value] of expectedEntries) map.set(Field(key), Field(value));

assert.equal(map.getRoot().toString(), expectedRoot, 'Magic City bootstrap must reproduce the deployed MBA registry root');
assert.equal(expectedSequence, '1');
assert.match(registryAddress, /^B62/);

console.log('mba_mission_registry_bootstrap_ok');
