import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBrowserExtensionMissionPlan } from '../src/browserMissionPlan.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(rootDir, 'public/native-runner/extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const extensionSourceFiles = fs.readdirSync(extensionDir)
  .filter((fileName) => fileName.endsWith('.js'))
  .map((fileName) => path.join(extensionDir, fileName));

const prohibitedAmazonParameters = new Set([
  'tag',
  'ascsubtag',
  'affid',
  'aff_id',
  'affiliate',
  'affiliate_id',
  'linkcode',
  'camp',
  'creative',
  'creativeasin',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term'
]);

function assertNoCookieAccess(source, filePath) {
  assert.doesNotMatch(
    source,
    /\b(?:chrome|browser)\.cookies\b|\bdocument\.cookie\b|\bset-cookie\b/i,
    `${path.basename(filePath)} must not read or write browser cookies`
  );
}

function assertNoAffiliateParameters(urlValue, label) {
  const url = new URL(urlValue);
  for (const [name] of url.searchParams) {
    assert.ok(
      !prohibitedAmazonParameters.has(name.toLowerCase()),
      `${label} must not include affiliate or campaign parameter ${name}`
    );
  }
}

assert.ok(Array.isArray(manifest.permissions), 'Runner manifest must declare permissions');
assert.ok(!manifest.permissions.includes('cookies'), 'Runner manifest must not request the Chrome cookies permission');

for (const filePath of extensionSourceFiles) {
  assertNoCookieAccess(fs.readFileSync(filePath, 'utf8'), filePath);
}

const plan = buildBrowserExtensionMissionPlan({
  finalSelections: {
    targetUrl: 'https://www.amazon.com/?tag=not-magic-city-20&utm_source=spoofed&ascsubtag=bad',
    goal: 'Buy nature valley granola bars from amazon.com with max spend $4',
    maxSpend: '$4',
    allowedMerchants: 'amazon.com'
  },
  localContext: {
    targetUrl: 'https://www.amazon.com/?tag=not-magic-city-20&utm_source=spoofed&ascsubtag=bad',
    goal: 'Buy nature valley granola bars from amazon.com with max spend $4'
  }
});

assert.equal(plan.targetDomain, 'amazon.com', 'fixture must create an Amazon plan');
assertNoAffiliateParameters(plan.startUrl, 'Amazon start URL');
for (const action of plan.actions || []) {
  if (action?.url) assertNoAffiliateParameters(action.url, `Amazon action ${action.id || action.type || 'url'}`);
}

const resumedCheckoutPlan = buildBrowserExtensionMissionPlan({
  extensionCheckoutReconcileResume: true,
  extensionCheckoutReconcileUrl: 'https://www.amazon.com/checkout/p/example?pipelineType=Chewbacca&tag=not-magic-city-20&utm_source=spoofed&ascsubtag=bad',
  finalSelections: {
    targetUrl: 'https://www.amazon.com/',
    goal: 'Buy nature valley granola bars from amazon.com with max spend $4',
    maxSpend: '$4',
    allowedMerchants: 'amazon.com'
  }
});

assertNoAffiliateParameters(resumedCheckoutPlan.startUrl, 'Amazon resumed checkout URL');
for (const action of resumedCheckoutPlan.actions || []) {
  if (action?.url) assertNoAffiliateParameters(action.url, `Amazon resumed action ${action.id || action.type || 'url'}`);
}

console.log('browser affiliate safety regression passed');
