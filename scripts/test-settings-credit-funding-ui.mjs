import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const sectionStart = html.indexOf('<details id="settingsWalletSection">');
const sectionEnd = html.indexOf('<details id="settingsYourAgentSection"', sectionStart);

assert.notEqual(sectionStart, -1, 'missing Payment Account settings');
assert.notEqual(sectionEnd, -1, 'missing Payment Account boundary');

const paymentSettings = html.slice(sectionStart, sectionEnd);

assert.doesNotMatch(paymentSettings, /wallet-payment-pill/);
assert.doesNotMatch(paymentSettings, />Pay with Stripe</);
assert.match(paymentSettings, /id="controlsFundingRail" type="hidden" value="stripe"/);
assert.doesNotMatch(paymentSettings, /<select id="controlsFundingRail"/);
assert.doesNotMatch(paymentSettings, />Stablecoin</);
assert.match(paymentSettings, /id="controlsTopupBtn">Add credits with Stripe<\/button>/);
assert.match(html, /button\.textContent = 'Add credits with Stripe';/);

assert.match(paymentSettings, /id="santaclawzPaymentPreference" type="hidden" value="credits"/);
assert.doesNotMatch(paymentSettings, /SantaClawz default/);
assert.doesNotMatch(paymentSettings, /<option value="crypto">/);

assert.match(paymentSettings, /class="wallet-compact-row" hidden/);
assert.match(paymentSettings, /class="connector-account-body" hidden/);
assert.doesNotMatch(paymentSettings, /<summary>Advanced<\/summary>/);

const historyIndex = paymentSettings.indexOf('id="stripeTopupHistory"');
const dormantControlsIndex = paymentSettings.indexOf('data-dormant-payment-controls');
assert.notEqual(historyIndex, -1, 'missing recent top-up history');
assert.notEqual(dormantControlsIndex, -1, 'missing dormant payment controls');
assert.ok(historyIndex < dormantControlsIndex, 'recent top-ups should remain visible outside dormant controls');

const preferenceFunction = html.match(/function getSantaClawzPaymentPreference\(\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
assert.match(preferenceFunction, /return 'credits';/);

console.log('settings credit funding UI tests passed');
