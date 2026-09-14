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
    await fixture.evaluate(() => history.replaceState({}, '', '/dp/magic-city-price-fixture'));
    const productPriceFixture = (oneTimePrice) => `
      <!doctype html>
      <title>Magic City Amazon product price fixture</title>
      <style>.a-offscreen { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }</style>
      <main>
        <h1>Test gadget</h1>
        <div id="desktop_buybox">
          <div id="subscribeAndSaveOffer">Subscribe &amp; Save <span class="a-price"><span class="a-offscreen">$2.67</span><span aria-hidden="true">$2.67</span></span></div>
          <div id="newAccordionRow">One-time purchase <span class="a-price"><span class="a-offscreen">$${oneTimePrice}</span><span aria-hidden="true">$${oneTimePrice}</span></span></div>
          <span aria-label="Amazon Prime">Prime delivery</span>
          <div id="deliveryBlockMessage">FREE delivery Tomorrow</div>
          <input id="add-to-cart-button" type="submit" value="Add to Cart" />
        </div>
      </main>`;
    await fixture.setContent(productPriceFixture('3.50'));
    const verifiedOneTimePrice = await commandForTab(fixtureTab.id, { type: 'MAGIC_CITY_BROWSER_STATE' });
    if (verifiedOneTimePrice.checkoutSummary?.productPrice !== '$3.50') {
      fail('amazon_one_time_price_not_preferred_over_subscription', verifiedOneTimePrice.checkoutSummary);
    }
    await fixture.setContent(productPriceFixture('4.97'));
    const overBudgetOneTimePrice = await commandForTab(fixtureTab.id, { type: 'MAGIC_CITY_BROWSER_STATE' });
    if (overBudgetOneTimePrice.checkoutSummary?.productPrice !== '$4.97') {
      fail('amazon_subscription_price_used_as_product_price', overBudgetOneTimePrice.checkoutSummary);
    }
    await fixture.setContent(`
      <!doctype html>
      <title>Magic City Amazon legacy core price fixture</title>
      <style>.a-offscreen { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }</style>
      <main>
        <h1>Test gadget</h1>
        <div id="corePrice_feature_div"><span class="a-offscreen">$3.50</span></div>
        <span aria-label="Amazon Prime">Prime delivery</span>
        <div id="deliveryBlockMessage">FREE delivery Tomorrow</div>
        <input id="add-to-cart-button" type="submit" value="Add to Cart" />
      </main>`);
    const legacyCorePrice = await commandForTab(fixtureTab.id, { type: 'MAGIC_CITY_BROWSER_STATE' });
    if (legacyCorePrice.checkoutSummary?.productPrice !== '$3.50') {
      fail('amazon_legacy_core_price_not_supported', legacyCorePrice.checkoutSummary);
    }
    await fixture.setContent(`
      <!doctype html>
      <title>Magic City Amazon hidden legacy core price fixture</title>
      <main>
        <h1>Test gadget</h1>
        <div style="display:none"><div id="corePrice_feature_div"><span class="a-offscreen">$3.50</span></div></div>
        <span aria-label="Amazon Prime">Prime delivery</span>
        <div id="deliveryBlockMessage">FREE delivery Tomorrow</div>
        <input id="add-to-cart-button" type="submit" value="Add to Cart" />
      </main>`);
    const hiddenLegacyCorePrice = await commandForTab(fixtureTab.id, { type: 'MAGIC_CITY_BROWSER_STATE' });
    if (hiddenLegacyCorePrice.checkoutSummary?.productPrice) {
      fail('amazon_hidden_legacy_core_price_accepted', hiddenLegacyCorePrice.checkoutSummary);
    }
    await fixture.setContent(`
      <!doctype html>
      <title>Magic City Amazon live accordion fixture</title>
      <style>.a-offscreen { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }</style>
      <main>
        <h1>Nature Valley Mixed Berry Peanut-Free Chewy Granola Bar, 5 ct, 4.6 oz</h1>
        <div id="desktop_buybox">
          <section id="apex_desktop_newAccordionRow">
            <div id="corePrice_feature_div" data-feature-name="corePrice" data-csa-c-slot-id="newAccordionRow_0" data-csa-c-is-in-initial-active-row="true">
              <span class="a-price apex-pricetopay-value"><span class="a-offscreen">$2.97</span><span aria-hidden="true">$2.97</span></span>
              <span class="a-price apex-priceperunit-value"><span class="a-offscreen">$0.65</span></span>
            </div>
            <div id="merchantInfoFeature_feature_div" data-feature-name="merchantInfoFeature" data-csa-c-slot-id="newAccordionRow_0" data-csa-c-is-in-initial-active-row="true">
              <span>Shipper / Seller</span><span>Amazon.com</span>
            </div>
          </section>
          <section id="snsAccordionRowMiddle">
            <div id="corePrice_feature_div" data-feature-name="corePrice" data-csa-c-slot-id="snsAccordionRowMiddle" data-csa-c-is-in-initial-active-row="false">
              <span id="subscriptionPrice"><span class="a-price apex-pricetopay-value"><span class="a-offscreen">$2.82</span><span aria-hidden="true">$2.82</span></span></span>
            </div>
            <div id="merchantInfoFeature_feature_div" data-feature-name="merchantInfoFeature" data-csa-c-slot-id="snsAccordionRowMiddle" data-csa-c-is-in-initial-active-row="false">
              <span>Shipper / Seller</span><span>Example Marketplace</span>
            </div>
          </section>
          <div id="deliveryBlockMessage">FREE delivery Tomorrow</div>
          <input id="add-to-cart-button" type="submit" value="Add to Cart" onclick="document.body.dataset.liveOfferCart='clicked'" />
        </div>
      </main>`);
    const liveAccordionState = await commandForTab(fixtureTab.id, { type: 'MAGIC_CITY_BROWSER_STATE' });
    if (liveAccordionState.checkoutSummary?.productPrice !== '$2.97') {
      fail('amazon_live_accordion_one_time_price_not_selected', liveAccordionState.checkoutSummary);
    }
    const liveAccordionCart = await commandForTab(fixtureTab.id, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'click_intent', intent: 'add_to_cart', fulfillmentPolicy: 'amazon_free_shipping_preferred' }
    });
    const liveAccordionClicked = await fixture.evaluate(() => document.body.dataset.liveOfferCart || '');
    if (liveAccordionCart?.completed !== true || liveAccordionClicked !== 'clicked') {
      fail('amazon_live_shipper_seller_not_accepted', { liveAccordionCart, liveAccordionClicked });
    }
    const smartWagonRoute = async (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html>
        <title>Amazon.com Shopping Cart</title>
        <nav>
          <span id="nav-link-accountList-nav-line-1">Hello, Test Shopper</span>
          <a id="nav-cart" href="/gp/cart/view.html"><span id="nav-cart-count">1</span> Cart</a>
        </nav>
        <main data-testid="added-to-cart-confirmation">
          <h1>Added to cart</h1>
          <section><p>Nature Valley Mixed Berry Peanut-Free Chewy Granola Bar</p><p>Cart Subtotal: $2.97</p></section>
          <div id="sw-ptc"><button onclick="sessionStorage.setItem('smart-wagon-checkout-clicks', String(Number(sessionStorage.getItem('smart-wagon-checkout-clicks') || 0) + 1))">Proceed to checkout (1 item)</button></div>
          <div id="sw-gtc"><button onclick="sessionStorage.setItem('smart-wagon-cart-clicks', String(Number(sessionStorage.getItem('smart-wagon-cart-clicks') || 0) + 1)); location.href='/gp/cart/view.html?source=smart-wagon'">Go to Cart</button></div>
        </main>
        <aside class="sc-list-item" data-asin="B0F2PWJV7D" aria-label="Cart preview">
          <span class="a-price">$2.97</span><span>Quantity is 1</span>
        </aside>`
    });
    const fullCartRoute = async (route) => {
      const nonPrimeControl = new URL(route.request().url()).searchParams.get('source') === 'non-prime-control';
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html>
        <title>Amazon.com Shopping Cart</title>
        <nav><span id="nav-link-accountList-nav-line-1">Hello, Test Shopper</span><span id="nav-cart-count">1</span></nav>
        <main><h1>Your cart</h1>
          <div id="activeCartViewForm">
            <div class="sc-list-item" data-asin="B0F2PWJV7D">
              <a href="/Nature-Valley-Peanut-Free-Granola-Facility/dp/B0F2PWJV7D">Nature Valley Mixed Berry Peanut-Free Chewy Granola Bar, 5 ct, 4.6 oz</a>
              ${nonPrimeControl ? '<p>Shipping: $4.99</p>' : '<span aria-label="Amazon Prime">Prime delivery</span><p>FREE delivery Tomorrow</p>'}
              <label>Quantity: <select name="quantity"><option selected>1</option></select></label><button data-action="delete">Delete</button>
            </div>
          </div>
          <p>Subtotal (1 item): $2.97</p>
          <span id="sc-buy-box-ptc-button"><input type="submit" name="proceedToRetailCheckout" value="Proceed to checkout" /></span>
        </main>`
      });
    };
    await fixture.route('https://www.amazon.com/cart/smart-wagon**', smartWagonRoute);
    await fixture.route('https://www.amazon.com/gp/cart/view.html**', fullCartRoute);
    await fixture.evaluate(() => {
      sessionStorage.setItem('smart-wagon-add-clicks', '1');
      sessionStorage.setItem('smart-wagon-cart-clicks', '0');
      sessionStorage.setItem('smart-wagon-checkout-clicks', '0');
    });
    await fixture.goto('https://www.amazon.com/cart/smart-wagon?newItems=B0F2PWJV7D&ref_=sw_refresh');
    const smartWagonState = await commandForTab(fixtureTab.id, { type: 'MAGIC_CITY_BROWSER_STATE' });
    const repeatedSmartWagonState = await commandForTab(fixtureTab.id, { type: 'MAGIC_CITY_BROWSER_STATE' });
    if (smartWagonState.browserState !== 'browse'
      || smartWagonState.browserSurface !== 'post_add_confirmation'
      || smartWagonState.milestoneSignals?.cartVisible !== false
      || smartWagonState.checkoutSummary?.cartPrimeFulfillmentObserved !== false
      || smartWagonState.checkoutSummary?.cartItems?.length
      || repeatedSmartWagonState.browserSurface !== 'post_add_confirmation') {
      fail('amazon_smart_wagon_treated_as_authoritative_cart', { smartWagonState, repeatedSmartWagonState });
    }
    const smartWagonOpenCart = await commandForTab(fixtureTab.id, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'navigate', intent: 'open_cart', preferExistingCartControl: true }
    });
    await fixture.waitForURL(/\/gp\/cart\/view\.html\?source=smart-wagon/, { timeout: 5_000 });
    const authoritativeCartState = await commandForTab(fixtureTab.id, { type: 'MAGIC_CITY_BROWSER_STATE' });
    const smartWagonCounts = await fixture.evaluate(() => ({
      add: Number(sessionStorage.getItem('smart-wagon-add-clicks') || 0),
      openCart: Number(sessionStorage.getItem('smart-wagon-cart-clicks') || 0),
      checkout: Number(sessionStorage.getItem('smart-wagon-checkout-clicks') || 0)
    }));
    if (smartWagonOpenCart?.completed !== true
      || smartWagonOpenCart?.controlStrategy !== 'amazon_post_add_go_to_cart'
      || smartWagonCounts.add !== 1
      || smartWagonCounts.openCart !== 1
      || smartWagonCounts.checkout !== 0
      || authoritativeCartState.browserState !== 'cart'
      || authoritativeCartState.checkoutSummary?.cartPrimeFulfillmentObserved !== true
      || authoritativeCartState.checkoutSummary?.cartPrimeVerified !== true
      || authoritativeCartState.checkoutSummary?.cartItems?.[0]?.asin !== 'B0F2PWJV7D') {
      fail('amazon_smart_wagon_did_not_reach_verified_full_cart', {
        smartWagonOpenCart,
        smartWagonCounts,
        authoritativeCartState
      });
    }
    await fixture.goto('https://www.amazon.com/gp/cart/view.html?source=non-prime-control');
    const nonPrimeCartState = await commandForTab(fixtureTab.id, { type: 'MAGIC_CITY_BROWSER_STATE' });
    if (nonPrimeCartState.browserState !== 'cart'
      || nonPrimeCartState.checkoutSummary?.cartPrimeFulfillmentObserved !== true
      || nonPrimeCartState.checkoutSummary?.cartPrimeVerified !== false
      || !nonPrimeCartState.checkoutSummary?.cartNonPrimeItems?.some((title) => /Nature Valley Mixed Berry/i.test(String(title)))) {
      fail('amazon_smart_wagon_exception_leaked_into_authoritative_cart', nonPrimeCartState);
    }
    await fixture.unroute('https://www.amazon.com/cart/smart-wagon**', smartWagonRoute);
    await fixture.unroute('https://www.amazon.com/gp/cart/view.html**', fullCartRoute);
    stage('amazon_one_time_accessible_price_verified', {
      underCap: verifiedOneTimePrice.checkoutSummary.productPrice,
      overCap: overBudgetOneTimePrice.checkoutSummary.productPrice,
      legacyCore: legacyCorePrice.checkoutSummary.productPrice,
      liveAccordion: liveAccordionState.checkoutSummary.productPrice,
      smartWagon: {
        surface: smartWagonState.browserSurface,
        cartClicks: smartWagonCounts.openCart,
        cartPrimeVerified: authoritativeCartState.checkoutSummary.cartPrimeVerified,
        nonPrimeControlVerified: nonPrimeCartState.checkoutSummary.cartPrimeVerified
      }
    });
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
