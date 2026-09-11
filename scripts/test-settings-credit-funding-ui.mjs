import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const sectionStart = html.indexOf('<details id="settingsWalletSection">');
const sectionEnd = html.indexOf('<details id="settingsYourAgentSection"', sectionStart);

assert.notEqual(sectionStart, -1, 'missing Payment Account settings');
assert.notEqual(sectionEnd, -1, 'missing Payment Account boundary');

const paymentSettings = html.slice(sectionStart, sectionEnd);

assert.match(paymentSettings, /class="wallet-payment-pill">Pay with Stripe<\/span>/);
assert.match(paymentSettings, /id="controlsFundingRail" type="hidden" value="stripe"/);
assert.doesNotMatch(paymentSettings, /<select id="controlsFundingRail"/);
assert.doesNotMatch(paymentSettings, />Stablecoin</);

assert.match(paymentSettings, /id="santaclawzPaymentPreference" type="hidden" value="credits"/);
assert.doesNotMatch(paymentSettings, /SantaClawz default/);
assert.doesNotMatch(paymentSettings, /<option value="crypto">/);

assert.match(paymentSettings, /class="wallet-compact-row" hidden/);
assert.match(paymentSettings, /class="connector-account-body" hidden/);

const preferenceFunction = html.match(/function getSantaClawzPaymentPreference\(\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
assert.match(preferenceFunction, /return 'credits';/);

console.log('settings credit funding UI tests passed');
