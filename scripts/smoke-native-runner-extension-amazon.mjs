import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'public/native-runner/extension/manifest.json'), 'utf8'));
const packagePath = path.join(rootDir, 'dist/native-runner-extension', `magic-city-runner-${manifest.version}.zip`);
const searchUrl = 'https://www.amazon.com/s?k=nature+valley+granola+bars&rh=p_36%3A-400';
const smokeStartedAt = Date.now();

function stage(label, detail = {}) {
  console.log(JSON.stringify({ stage: label, elapsedMs: Date.now() - smokeStartedAt, ...detail }));
}

function fail(message, detail = null) {
  throw new Error(`${message}${detail ? `:${JSON.stringify(detail)}` : ''}`);
}

async function main() {
  if (!fs.existsSync(packagePath)) fail('extension_package_missing', { packagePath });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-amazon-smoke-'));
  const extensionDir = path.join(tmpDir, 'extension');
  fs.mkdirSync(extensionDir, { recursive: true });
  const unzip = spawnSync('unzip', ['-q', packagePath, '-d', extensionDir], { encoding: 'utf8' });
  if (unzip.status !== 0) fail('extension_package_unzip_failed', { stderr: unzip.stderr });
  // Playwright cannot accept Chromium's native optional-host permission bubble.
  // Pregrant only in this disposable profile; executor/background stay exactly
  // as packaged and the public manifest remains optional-permission based.
  const testManifestPath = path.join(extensionDir, 'manifest.json');
  const testManifest = JSON.parse(fs.readFileSync(testManifestPath, 'utf8'));
  testManifest.host_permissions = [...new Set([...(testManifest.host_permissions || []), 'https://www.amazon.com/*'])];
  fs.writeFileSync(testManifestPath, `${JSON.stringify(testManifest, null, 2)}\n`);

  let context = null;
  const deadline = setTimeout(() => {
    stage('live_smoke_deadline_exceeded');
    context?.close().catch(() => null);
  }, 120_000);
  try {
    context = await chromium.launchPersistentContext(path.join(tmpDir, 'profile'), {
      headless: false,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    });
    stage('chrome_started');
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const commandForTab = (tabId, payload) => worker.evaluate(async ({ tabId: targetTabId, message }) => {
      await chrome.scripting.executeScript({ target: { tabId: targetTabId }, files: ['executor.js'] });
      return Promise.race([
        chrome.tabs.sendMessage(targetTabId, message),
        new Promise((_, reject) => setTimeout(() => reject(new Error('live_content_script_timeout')), 12_000))
      ]);
    }, { tabId, message: payload });

    const fixture = await context.newPage();
    await fixture.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await fixture.setContent(`
      <!doctype html>
      <title>Magic City Amazon refinement fixture</title>
      <header>
        <div id="nav-link-accountList">Hello, Test Account & Lists</div>
        <a href="https://www.amazon.com/gp/video/storefront?ref_=nav_cs_prime_video">Prime Video</a>
        <a href="https://www.amazon.com/customer-preferences/edit?ref_=topnav_lang">EN</a>
      </header>
      <main>
        <div id="s-refinements">
          <a aria-label="Apply Prime Delivery filter to narrow results"
             href="https://www.amazon.com/s?k=nature+valley+granola+bars&rh=p_36%3A-400%2Cp_85%3A2470955011">
            Prime Delivery
          </a>
        </div>
        <div data-component-type="s-search-result" data-asin="B000TEST123">
          <h2><a href="https://www.amazon.com/dp/B000TEST123">Nature Valley Crunchy Granola Bars</a></h2>
          <span>$2.97</span>
        </div>
      </main>
    `);
    const fixtureTab = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((candidate) => candidate.title === 'Magic City Amazon refinement fixture') || null;
    });
    if (!fixtureTab?.id) fail('amazon_refinement_fixture_tab_not_found');
    const fixtureFilter = await commandForTab(fixtureTab.id, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'click_intent', intent: 'prefer_free_delivery' }
    });
    await fixture.waitForTimeout(400);
    const fixtureAfter = await worker.evaluate((tabId) => chrome.tabs.get(tabId), fixtureTab.id);
    if (!fixtureFilter.filterApplied
      || !/p_85/i.test(String(fixtureAfter?.url || ''))
      || /\/gp\/video|primevideo|customer-preferences/i.test(String(fixtureAfter?.url || ''))) {
      fail('amazon_canonical_prime_filter_not_selected_safely', { fixtureFilter, url: fixtureAfter?.url });
    }
    stage('amazon_delivery_filter_scope_verified', { filterApplied: fixtureFilter.filterApplied, url: fixtureAfter?.url });

    await fixture.setContent(`
      <!doctype html>
      <title>Magic City Amazon side-cart identity fixture</title>
      <header><div id="nav-link-accountList">Hello, Test Account & Lists</div></header>
      <main>
        <h1>Results for nature valley granola bars</h1>
        <div data-component-type="s-search-result" data-asin="B000TEST123">
          <h2><a href="https://www.amazon.com/Nature-Valley-Crunchy-Granola-Honey/dp/B000TEST123">Nature Valley Crunchy Granola Bars</a></h2>
          <span>$2.97</span>
          <button id="selected-candidate-cart" onclick="document.body.dataset.cartCandidate='nature-valley'">Add to cart</button>
        </div>
      </main>
      <aside id="nav-flyout-ewc" aria-label="Cart preview">
        <div class="sc-list-item" data-asin="B000WRONG123">
          <a href="https://www.amazon.com/MadeGood-Organic-Chocolate-Granola/dp/B000WRONG123">MadeGood Organic Chocolate Granola Mini Bars</a>
          <span>$3.99</span>
        </div>
        <p>Subtotal (1 item): $3.99</p>
        <button>Go to Cart</button>
      </aside>
    `);
    const sideCartSelection = await commandForTab(fixtureTab.id, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: {
        type: 'select_candidate',
        query: 'nature valley granol abars',
        maxPrice: 4,
        candidatePolicy: 'price_quality_delivery_preference',
        fulfillmentPolicy: 'amazon_free_shipping_preferred'
      }
    });
    if (sideCartSelection.existingCartItemVerified
      || sideCartSelection.navigationRequested !== true
      || sideCartSelection.directCartControlAvailable !== false
      || !/Nature-Valley/i.test(String(sideCartSelection.selected?.url || ''))
      || /MadeGood/i.test(String(sideCartSelection.selected?.url || ''))) {
      fail('amazon_unrelated_sidecart_was_treated_as_requested_item', { sideCartSelection });
    }
    stage('amazon_sidecart_identity_verified', { selectedUrl: sideCartSelection.selected?.url, directCart: false });
    await fixture.close();

    const page = await context.newPage();
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForTimeout(4_000);
    stage('amazon_search_loaded', { title: await page.title().catch(() => '') });

    const tab = await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((candidate) => String(candidate.url || '').startsWith(url)) || null;
    }, 'https://www.amazon.com/');
    if (!tab?.id) fail('amazon_tab_not_found');

    const command = (payload) => commandForTab(tab.id, payload);

    let searchState = null;
    let elapsedMs = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const observedAt = Date.now();
      searchState = await command({ type: 'MAGIC_CITY_BROWSER_STATE' });
      elapsedMs = Date.now() - observedAt;
      stage('amazon_search_observed', { attempt: attempt + 1, browserState: searchState.browserState, observationDurationMs: searchState.observationDurationMs });
      if ((searchState.browserState === 'search_results' || searchState.browserSurface === 'search_results') && (searchState.candidates || []).length) break;
      if (!/sorry|something went wrong|try again/i.test(`${searchState.title || ''} ${await page.locator('body').innerText().catch(() => '')}`)) break;
      await page.waitForTimeout(2_000 * (attempt + 1));
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
      await page.waitForTimeout(2_000);
    }
    if (searchState.providerChallenge) fail('amazon_challenge_visible', { url: searchState.url, title: searchState.title });
    // The disposable smoke profile is signed out, so the production classifier
    // correctly reports a login boundary. Continue only because the underlying
    // public retail-search surface and candidates are independently verified.
    if (searchState.browserState !== 'search_results' && searchState.browserSurface !== 'search_results') {
      fail('amazon_search_not_classified', searchState);
    }
    if (elapsedMs > 12_000 || Number(searchState.observationDurationMs || 0) > 5_000) {
      fail('amazon_search_observation_too_slow', { elapsedMs, observationDurationMs: searchState.observationDurationMs });
    }
    const matchingCandidates = (searchState.candidates || []).filter((candidate) =>
      /nature valley/i.test(`${candidate.title || ''} ${candidate.context || ''}`)
      && Number(candidate.price || Number.POSITIVE_INFINITY) <= 4
    );
    if (!matchingCandidates.length) fail('amazon_matching_candidate_missing', { candidates: searchState.candidates });

    const selection = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: {
        type: 'select_candidate',
        query: 'nature valley granola bars',
        maxPrice: 4,
        candidatePolicy: 'price_quality_delivery_preference',
        fulfillmentPolicy: 'amazon_free_shipping_preferred'
      }
    });
    const selectedUrl = String(selection.selected?.url || selection.navigationUrl || '');
    if (!selection.completed || !selectedUrl) fail('amazon_candidate_not_selected', selection);
    stage('amazon_candidate_selected', { title: selection.selected?.title, price: selection.selected?.price });
    await worker.evaluate(({ tabId, url }) => chrome.tabs.update(tabId, { url, active: false }), { tabId: tab.id, url: selectedUrl });
    await page.waitForLoadState('domcontentloaded', { timeout: 45_000 }).catch(() => null);
    await page.waitForTimeout(3_000);

    const productState = await command({ type: 'MAGIC_CITY_BROWSER_STATE' });
    if (!productState.productOpened || !productState.addToCartAvailable) {
      fail('amazon_product_not_purchasable', productState);
    }
    stage('amazon_product_ready', { observationDurationMs: productState.observationDurationMs });
    const cartAction = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'click_intent', intent: 'add_to_cart' }
    });
    if (!cartAction.completed && productState.loginRequired && /login boundary/i.test(String(cartAction.reason || ''))) {
      stage('amazon_signed_out_boundary_verified', { url: productState.url, title: productState.title });
      console.log(JSON.stringify({
        ok: true,
        version: manifest.version,
        permissionMode: 'temporary_test_profile_pregrant',
        liveScope: 'retail search and purchasable product selection',
        checkoutScope: 'blocked by expected signed-out disposable profile',
        searchObservationMs: searchState.observationDurationMs,
        commandElapsedMs: elapsedMs,
        selected: selection.selected,
        finalUrl: productState.url,
        finalStage: productState.browserSurface,
        loginBoundaryVerified: true
      }, null, 2));
      return;
    }
    if (!cartAction.completed) fail('amazon_add_to_cart_not_invoked', cartAction);
    stage('amazon_add_to_cart_invoked', { label: cartAction.label });
    await page.waitForTimeout(4_000);
    let cartState = await command({ type: 'MAGIC_CITY_BROWSER_STATE' });
    stage('amazon_cart_observed', { url: cartState.url, browserStage: cartState.checkoutSummary?.stage, count: cartState.checkoutSummary?.cartItemCount });
    if (!/\/cart|\/gp\/cart/i.test(String(cartState.url || ''))) {
      const openCart = await command({
        type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
        action: { type: 'click_intent', intent: 'checkout' }
      });
      if (!openCart.completed) fail('amazon_cart_page_not_opened', openCart);
      stage('amazon_open_cart_invoked', { label: openCart.label });
      await page.waitForTimeout(4_000);
      cartState = await command({ type: 'MAGIC_CITY_BROWSER_STATE' });
      stage('amazon_cart_page_observed', { url: cartState.url, browserStage: cartState.checkoutSummary?.stage, count: cartState.checkoutSummary?.cartItemCount });
    }
    const cartReady = /\/cart|\/gp\/cart/i.test(String(cartState.url || ''))
      && Number(cartState.checkoutSummary?.cartItemCount || 0) > 0;
    if (!cartReady) fail('amazon_cart_not_confirmed', cartState);

    console.log(JSON.stringify({
      ok: true,
      version: manifest.version,
      permissionMode: 'temporary_test_profile_pregrant',
      searchObservationMs: searchState.observationDurationMs,
      commandElapsedMs: elapsedMs,
      selected: selection.selected,
      finalUrl: cartState.url,
      finalStage: cartState.checkoutSummary?.stage,
      cartItemCount: cartState.checkoutSummary?.cartItemCount
    }, null, 2));
  } finally {
    clearTimeout(deadline);
    await context?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
