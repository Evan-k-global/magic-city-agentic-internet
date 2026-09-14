import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const fixtureDir = path.join(root, 'artifacts/amazon-selection-calibration-100-2026-09-12');
const destination = path.join(fixtureDir, 'shadow-v10/production-candidate');
const audit = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'shadow-v10/final/audit.json'), 'utf8'));
const sourcePath = path.join(root, 'public/native-runner/extension/amazon-selection.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-selection-production-shadow-'));
const extension = path.join(temp, 'extension');
fs.mkdirSync(extension);
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(sourcePath, path.join(extension, 'amazon-selection.js'));
fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({
  manifest_version: 3,
  name: 'Magic City production selection shadow',
  version: '0.0.1',
  permissions: ['tabs', 'scripting'],
  host_permissions: ['https://www.amazon.com/*'],
  background: { service_worker: 'background.js', type: 'module' }
}));
fs.writeFileSync(path.join(extension, 'background.js'), `
  import { selectAmazonSearchCard } from './amazon-selection.js';
  globalThis.setSelectionFixture = async (tabId, html) => chrome.scripting.executeScript({
    target: { tabId },
    func: (fixture) => { document.body.innerHTML = fixture; },
    args: [html]
  });
  globalThis.runSelectionShadow = async (tabId, action) => {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: selectAmazonSearchCard,
      args: [action, false]
    });
    return result[0]?.result || null;
  };
  globalThis.runSelectionAction = async (tabId, action) => {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: selectAmazonSearchCard,
      args: [action, true]
    });
    return result[0]?.result || null;
  };
`);

const output = {
  scope: 'Production-candidate selector in an MV3 isolated world over 100 saved Amazon DOM fixtures; clicks and external network blocked.',
  sourceSha256: hash(source),
  startedAt: new Date().toISOString(),
  items: [],
  networkBlocked: 0,
  mutationNetworkAttempts: 0
};
let activeHtml = '';
let context;
try {
  context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
    headless: false,
    viewport: { width: 1440, height: 1050 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  await context.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.isNavigationRequest()
      && request.method() === 'GET'
      && url.hostname === 'www.amazon.com'
      && url.pathname === '/s'
      && url.searchParams.has('productionSelectionShadow')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'content-security-policy': "script-src 'none'; connect-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; frame-src 'none'; object-src 'none'" },
        body: activeHtml
      });
    }
    output.networkBlocked += 1;
    if (!['GET', 'HEAD'].includes(request.method()) || /cart|checkout|buy|order/i.test(url.pathname)) output.mutationNetworkAttempts += 1;
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    globalThis.__selectionGuard = { clicks: 0, forms: 0 };
    const originalClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function guardedClick() {
      globalThis.__selectionGuard.clicks += 1;
      return originalClick.call(this);
    };
    HTMLFormElement.prototype.submit = function guardedSubmit() {
      globalThis.__selectionGuard.forms += 1;
      throw new Error('selection_shadow_form_forbidden');
    };
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20_000 });
  const page = await context.newPage();
  const replayLimit = Math.max(1, Number(process.env.SELECTION_SHADOW_LIMIT || audit.rows.length));
  const replayRows = process.env.SELECTION_SHADOW_FIXTURE_ONLY === '1' ? [] : audit.rows.slice(0, replayLimit);
  for (const expected of replayRows) {
    activeHtml = fs.readFileSync(path.join(fixtureDir, `${String(expected.id).padStart(2, '0')}-search.html`), 'utf8');
    const url = `https://www.amazon.com/s?productionSelectionShadow=${expected.id}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    const started = performance.now();
    const result = await worker.evaluate(async ({ url, action }) => {
      const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
      if (!tab) throw new Error('selection_shadow_tab_missing');
      return globalThis.runSelectionShadow(tab.id, action);
    }, {
      url,
      action: {
        type: 'select_candidate',
        query: expected.request,
        maxPrice: expected.cap,
        candidatePolicy: 'price_quality_delivery_preference',
        fulfillmentPolicy: 'amazon_free_shipping_preferred',
        primeRequired: false
      }
    });
    const guard = await page.evaluate(() => globalThis.__selectionGuard);
    assert.equal(guard.clicks, 0, `fixture ${expected.id} click`);
    assert.equal(guard.forms, 0, `fixture ${expected.id} form`);
    output.items.push({
      id: expected.id,
      request: expected.request,
      expectedClassification: expected.classification,
      expectedAsin: expected.asin,
      selectionKind: result?.selectionKind || 'none',
      selectedAsin: result?.selected?.asin || result?.proposedCandidate?.asin || null,
      result,
      elapsedMs: performance.now() - started
    });
    if (result?.selectionKind === 'size_alternative') {
      assert.equal(result.completed, true, `fixture ${expected.id} closest-size completion`);
      assert.equal(result.requiresApproval, undefined, `fixture ${expected.id} closest-size approval`);
      assert.ok(result.selected?.asin, `fixture ${expected.id} closest-size selected candidate`);
    }
  }
  const wrongProductFixtures = [
    { id: 27, product: 'Ziploc Gallon Freezer Bags', bad: 'Ziploc Half Gallon Freezer Bags, Food Storage, 12 Count' },
    { id: 28, product: 'Ziploc Sandwich Bags', bad: 'Ziploc Sandwich and Snack Bags, Plastic Food Storage Bags, 12 Count' },
    { id: 39, product: 'OXO Good Grips POP Container', bad: 'OXO Good Grips POP Container Brown Sugar Keeper, 12 Count' },
    { id: 51, product: 'Neutrogena Hydro Boost Water Gel', bad: 'Neutrogena Hydro Boost Tint Foundation Makeup Water Gel, 12 Count' },
    { id: 60, product: 'Gillette Fusion5 Razor Blades', bad: 'Gillette Fusion5 Razor Handle Kit, 12 Count' },
    { id: 85, product: 'Gatorade Thirst Quencher Variety Pack', bad: 'Gatorade Thirst Quencher Powder Drink Mix Variety Pack, 12 Count' }
  ];
  const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const cardHtml = (asin, title) => `
    <div data-component-type="s-search-result" data-asin="${asin}" style="display:block;width:600px;min-height:160px">
      <div data-cy="title-recipe"><h2><a href="/dp/${asin}">${escapeHtml(title)}</a></h2></div>
      <span class="a-price"><span class="a-offscreen">$5.00</span></span>
      <button style="display:block;width:120px;height:32px">Add to cart</button>
    </div>`;
  output.wrongProductRegressions = [];
  const regressionTab = (await worker.evaluate(async () => (await chrome.tabs.query({ active: true }))[0]))?.id;
  assert.ok(regressionTab, 'wrong-product regression tab');
  for (const fixture of wrongProductFixtures) {
    const action = { query: `${fixture.product}, 12 ct`, maxPrice: 10, primeRequired: false };
    await worker.evaluate(({ tabId, html }) => globalThis.setSelectionFixture(tabId, html), {
      tabId: regressionTab,
      html: cardHtml('B000000001', fixture.bad)
    });
    const badOnly = await worker.evaluate(({ tabId, action }) => globalThis.runSelectionShadow(tabId, action), { tabId: regressionTab, action });
    await worker.evaluate(({ tabId, html }) => globalThis.setSelectionFixture(tabId, html), {
      tabId: regressionTab,
      html: cardHtml('B000000001', fixture.bad) + cardHtml('B000000002', `${fixture.product}, 12 Count`)
    });
    const withSibling = await worker.evaluate(({ tabId, action }) => globalThis.runSelectionShadow(tabId, action), { tabId: regressionTab, action });
    const record = {
      id: fixture.id,
      badOnly: badOnly?.selectionKind || null,
      selectedWithSibling: withSibling?.selected?.asin || withSibling?.proposedCandidate?.asin || null
    };
    output.wrongProductRegressions.push(record);
    assert.equal(record.badOnly, 'no_verified_candidate', `wrong-product fixture ${fixture.id}`);
    assert.equal(record.selectedWithSibling, 'B000000002', `valid sibling fixture ${fixture.id}`);
  }
  await worker.evaluate(({ tabId, html }) => globalThis.setSelectionFixture(tabId, html), {
    tabId: regressionTab,
    html: '<div data-component-type="s-search-result" data-asin="B000SMOKE1" style="display:block;width:600px;min-height:160px"><h2><a href="/dp/test-gadget">Test gadget</a></h2><span class="a-price"><span class="a-offscreen">$3.50</span></span><span aria-label="Amazon Prime">Prime delivery</span><span>FREE delivery</span><button style="display:block;width:120px;height:32px">Add to cart</button></div>'
  });
  output.packagedFixture = await worker.evaluate(({ tabId }) => globalThis.runSelectionShadow(tabId, {
    type: 'select_candidate', query: 'test gadget', maxPrice: null, primeRequired: true
  }), { tabId: regressionTab });
  assert.equal(output.packagedFixture?.selectionKind, 'exact', 'packaged lifecycle fixture');
  await worker.evaluate(({ tabId, html }) => globalThis.setSelectionFixture(tabId, html), {
    tabId: regressionTab,
    html: cardHtml('NATURE-VALLEY-UNAVAILABLE', 'Nature Valley Crunchy Granola Bars')
      + cardHtml('NATURE-VALLEY-LOCAL-MARKET', 'Nature Valley Crunchy Granola Bars')
      + '<div data-component-type="s-search-result" data-asin="B000NVGOOD" style="display:block;width:600px;min-height:160px"><h2><a href="/dp/nature-valley-valid">Nature Valley Oats n Honey Granola Bars</a></h2><span class="a-price">$3.50</span><span aria-label="Amazon Prime">Prime delivery</span><span>FREE delivery Tomorrow</span><button style="display:block;width:120px;height:32px">Add to cart</button></div>'
  });
  output.brandFixture = await worker.evaluate(({ tabId }) => globalThis.runSelectionShadow(tabId, {
    type: 'select_candidate', query: 'nature valley granol abars', maxPrice: 4, primeRequired: true
  }), { tabId: regressionTab });
  assert.equal(output.brandFixture?.selected?.asin, 'B000NVGOOD', 'brand lifecycle fixture');
  await worker.evaluate(({ tabId, html }) => globalThis.setSelectionFixture(tabId, html), {
    tabId: regressionTab,
    html: cardHtml('B000SIZE12', 'Test Wipes, 12 Count')
  });
  await page.evaluate(() => {
    globalThis.__selectionGuard.clicks = 0;
    document.querySelector('button')?.addEventListener('click', () => { globalThis.__selectionGuard.clicks += 1; });
  });
  output.closestSizeActionFixture = await worker.evaluate(({ tabId }) => globalThis.runSelectionAction(tabId, {
    type: 'select_candidate', query: 'test wipes, 24 ct', maxPrice: 10, primeRequired: false
  }), { tabId: regressionTab });
  const closestSizeGuard = await page.evaluate(() => globalThis.__selectionGuard);
  assert.equal(output.closestSizeActionFixture?.selectionKind, 'size_alternative', 'closest-size action fixture');
  assert.equal(output.closestSizeActionFixture?.completed, true, 'closest-size action completion');
  assert.equal(output.closestSizeActionFixture?.selected?.asin, 'B000SIZE12', 'closest-size action identity');
  assert.equal(closestSizeGuard.clicks, 1, 'closest-size action clicks once');
  output.finishedAt = new Date().toISOString();
  output.summary = output.items.reduce((summary, item) => {
    summary[item.selectionKind] = (summary[item.selectionKind] || 0) + 1;
    if (item.selectedAsin === item.expectedAsin) summary.expectedAsinMatches += 1;
    return summary;
  }, { expectedAsinMatches: 0 });
  assert.equal(output.mutationNetworkAttempts, 0);
} finally {
  await context?.close();
  fs.writeFileSync(path.join(destination, 'results.json'), JSON.stringify(output, null, 2));
}

const report = [
  '# Production Candidate Selection Replay',
  '',
  `Source SHA-256: \`${output.sourceSha256}\``,
  '',
  `Result: ${output.summary?.exact || 0} exact, ${output.summary?.size_alternative || 0} verified closest-size selections, ${output.summary?.no_verified_candidate || 0} abstentions.`,
  '',
  '| # | Request | Prior review | Candidate result | ASIN |',
  '|---:|---|---|---|---|',
  ...output.items.map((item) => {
    const result = item.selectionKind === 'exact'
      ? 'exact'
      : item.selectionKind === 'size_alternative'
        ? 'closest verified size'
        : 'abstain';
    return `| ${item.id} | ${String(item.request).replaceAll('|', '\\|')} | ${item.expectedClassification} | ${result} | ${item.selectedAsin ? `\`${item.selectedAsin}\`` : '-'} |`;
  }),
  '',
  '## Wrong-product controls',
  '',
  '| Fixture | Bad card alone | Valid sibling |',
  '|---:|---|---|',
  ...(output.wrongProductRegressions || []).map((item) => `| ${item.id} | ${item.badOnly} | \`${item.selectedWithSibling}\` |`),
  ''
].join('\n');
fs.writeFileSync(path.join(destination, 'REVIEW.md'), report);

console.log(JSON.stringify(output.summary, null, 2));
