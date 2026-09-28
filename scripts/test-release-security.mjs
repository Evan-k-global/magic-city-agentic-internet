import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as XLSX from 'xlsx';
import { Wallet, verifyMessage, version as ethersVersion } from 'ethers';
import { verifyStripeWebhookSignature } from '../src/stripe.js';

assert.equal(ethersVersion, '6.17.0');
assert.equal(XLSX.version, '0.20.3');
const wallet = Wallet.createRandom();
assert.equal(verifyMessage('synthetic release regression', await wallet.signMessage('synthetic release regression')), wallet.address);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Name', 'Quantity'], ['A&B <test>', 2], ['=not a formula', 3]]), 'Cleaned');
const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
const read = XLSX.read(bytes, { type: 'buffer' });
assert.equal(read.Sheets.Cleaned.A3.t, 's');
assert.equal(read.Sheets.Cleaned.A3.f, undefined);
assert.deepEqual(XLSX.utils.sheet_to_json(read.Sheets.Cleaned, { header: 1 }), [['Name', 'Quantity'], ['A&B <test>', 2], ['=not a formula', 3]]);
const secret = 'synthetic-webhook-secret';
const raw = '{}';
for (const timestamp of ['NaN', 'Infinity', '1', '9999999999999999999999']) {
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  assert.throws(() => verifyStripeWebhookSignature(raw, `t=${timestamp},v1=${sig}`, secret));
}
const docker = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const ignore = fs.readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8');
assert.doesNotMatch(docker, /^COPY\s+(?:env|\.|\.env)(?:\s|\/)/m);
for (const rule of ['env', '.env', '.env.*', '**/.env', '**/.env.*', '**/*.pem', '**/*.key']) assert.ok(ignore.split('\n').includes(rule), rule);
console.log('Patched dependencies, synthetic signatures, XLSX export roundtrip, Stripe timestamps, and Docker secret exclusion rules passed');
