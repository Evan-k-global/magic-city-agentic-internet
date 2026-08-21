import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { buildBrowserExtensionMissionPlan } from '../src/browserMissionPlan.js';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const extensionSource = path.resolve(process.env.MAGIC_CITY_EXTENSION_SOURCE || path.join(rootDir, 'public/native-runner/extension'));
const extensionManifest = JSON.parse(fs.readFileSync(path.join(extensionSource, 'manifest.json'), 'utf8'));

function supportsFinalSubmit(version = '') {
  const parts = String(version).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const minimum = [0, 2, 27];
  for (let index = 0; index < minimum.length; index += 1) {
    const delta = (parts[index] || 0) - minimum[index];
    if (delta) return delta > 0;
  }
  return true;
}

const extensionFinalSubmitEnabled = supportsFinalSubmit(extensionManifest.version);

function buildExtensionPlan(session = {}) {
  return buildBrowserExtensionMissionPlan({
    ...session,
    extensionFinalSubmitEnabled
  });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

function rehashExtensionPlan(plan) {
  const { planHash: _ignored, ...unsignedPlan } = plan;
  return {
    ...unsignedPlan,
    planHash: `0x${crypto.createHash('sha256').update(JSON.stringify(stableValue(unsignedPlan))).digest('hex')}`
  };
}
let checkoutFixture = {
  total: '$4.15',
  merchandiseSubtotal: '$3.50',
  shipping: '$0.00',
  itemCount: 1,
  showAddressPrimeModal: false,
  selectedCardLast4: '1817',
  matchingAddressAvailable: false,
  startWithNewAddressModal: true,
  checkoutPrelude: true
};
let multiBasketItems = [];
let brandCandidateVisits = [];
let conditionalCandidateVisits = [];
let lateShippingCandidateVisits = [];
let brandCartItem = null;
let lateShippingCartItem = null;
let delayFirstProductControl = true;
const purchaseScenarioResults = [];
const multiCatalog = [
  {
    id: 'whole-foods-marshmallows',
    query: 'marshmallows',
    title: 'Whole Foods Market Marshmallows',
    price: 1.99,
    rating: '4.9',
    reviews: '8,000',
    fulfillment: 'Sold by Whole Foods Market.'
  },
  {
    id: 'gourmet-marshmallows',
    query: 'marshmallows',
    title: 'Gourmet Campfire Marshmallows',
    price: 14.99,
    rating: '4.9',
    reviews: '8,000',
    fulfillment: 'Ships from Amazon.com. Prime delivery.'
  },
  {
    id: 'marshmallows',
    query: 'marshmallows',
    title: 'Campfire Marshmallows',
    price: 2.5,
    rating: '4.6',
    reviews: '1,000',
    fulfillment: 'Ships from Amazon.com. Prime delivery.'
  },
  {
    id: 'graham-crackers-marketplace',
    query: 'graham crackers',
    title: 'Graham Crackers - Marketplace Pack',
    price: 2.25,
    rating: '4.7',
    reviews: '3,000',
    fulfillment: 'Ships from Lucky Market.'
  },
  {
    id: 'graham-crackers',
    query: 'graham crackers',
    title: 'Honey Graham Crackers',
    price: 2.25,
    rating: '4.7',
    reviews: '3,000',
    fulfillment: 'Ships from Amazon.com. Prime delivery.'
  },
  {
    id: 'hersheys-chocolate',
    query: 'chocolate',
    title: "Hershey's Milk Chocolate Bar",
    price: 3,
    rating: '4.6',
    reviews: '1,000',
    fulfillment: 'Ships from Amazon.com. Prime delivery.'
  }
];

function fail(message) {
  throw new Error(message);
}

function recordPurchaseScenario(name, details = {}) {
  purchaseScenarioResults.push({ name, ok: true, ...details });
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : {};
}

function createCertificate(directory) {
  const keyPath = path.join(directory, 'key.pem');
  const certPath = path.join(directory, 'cert.pem');
  const result = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-keyout', keyPath, '-out', certPath
  ], { stdio: 'ignore' });
  if (result.status !== 0) fail('test_certificate_generation_failed');
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

function copyTestExtension(directory, externalOrigin = '') {
  const destination = path.join(directory, 'extension');
  fs.cpSync(extensionSource, destination, { recursive: true });
  const manifestPath = path.join(destination, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), 'https://127.0.0.1/*'])];
  manifest.externally_connectable = {
    ...(manifest.externally_connectable || {}),
    matches: [...new Set([
      ...(manifest.externally_connectable?.matches || []),
      'https://127.0.0.1/*'
    ])]
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (externalOrigin) {
    const backgroundPath = path.join(destination, 'background.js');
    const background = fs.readFileSync(backgroundPath, 'utf8');
    const origin = new URL(externalOrigin).origin;
    const marker = "  'https://magic-city-staging.fly.dev'\n]);";
    if (!background.includes(marker)) fail('test_extension_external_origin_marker_missing');
    fs.writeFileSync(backgroundPath, background.replace(
      marker,
      `  'https://magic-city-staging.fly.dev',\n  '${origin}'\n]);`
    ));
  }
  return destination;
}

function waitFor(check, timeoutMs = 20_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error('browser_extension_smoke_timeout'));
      }
    }, 100);
  });
}

function storefront(pathname, searchParams = new URLSearchParams()) {
  if (pathname === '/signed-out-search') {
    return [
      '<main>',
      '<nav><a id="nav-link-accountList" href="/ap/signin"><span id="nav-link-accountList-nav-line-1">Hello, sign in</span><span>Account & Lists</span></a></nav>',
      '<h1>Results</h1>',
      '<form><input type="search" role="searchbox" /></form>',
      '<div data-component-type="s-search-result" data-asin="SIGNED-OUT"><h2><a href="/dp/test-gadget">Test gadget</a></h2><span class="a-price">$3.50</span></div>',
      '</main>'
    ].join('');
  }
  if (pathname === '/free-shipping-search') {
    return [
      '<main>',
      '<nav><span id="nav-link-accountList-nav-line-1">Hello, Test Shopper</span></nav>',
      '<h1>Results</h1>',
      '<form><input type="search" role="searchbox" /></form>',
      '<label for="free-only-filter"><input id="free-only-filter" type="checkbox" aria-label="Free shipping" /> Free shipping</label>',
      '<div data-component-type="s-search-result" data-asin="FREE-SHIPPING"><h2><a href="/dp/test-gadget">Test gadget</a></h2><span class="a-price">$3.50</span><span>FREE shipping</span></div>',
      '</main>'
    ].join('');
  }
  if (pathname === '/direct-result-cart-search') {
    return [
      '<main>',
      '<nav><span id="nav-link-accountList-nav-line-1">Hello, Test Shopper</span></nav>',
      '<h1>Results for nature valley granola bars</h1>',
      '<form action="/direct-result-cart-search"><label>Search <input type="search" name="q" role="searchbox" value="nature valley granola bars" /></label><button type="submit">Search</button></form>',
      '<aside id="s-refinements-left">',
      '<label><input id="prime-filter" type="checkbox" aria-label="Prime" /> All Prime</label>',
      '<label><input id="delivery-today-filter" type="checkbox" aria-label="Today by 6PM" /> Today by 6PM</label>',
      '</aside>',
      '<div data-component-type="s-search-result" data-asin="NATURE-VALLEY-DIRECT">',
      '<h2><a href="/dp/nature-valley-direct">Nature Valley Crunchy Granola Bars, Oats & Honey, 12 ct, 8.94 oz</a></h2>',
      '<span class="a-price">$2.97</span><span>4.7 out of 5 stars</span><span>20,571 ratings</span>',
      '<span aria-label="Amazon Prime">Prime</span>',
      '<p><span class="a-icon-prime">prime</span> FREE delivery Overnight 7 AM - 11 AM on $25 of qualifying items</p>',
      '<button id="direct-result-add" onclick="document.querySelector(\'#nav-cart-count\').textContent=\'1\'; document.querySelector(\'#direct-result-sidecart\').hidden=false; this.textContent=\'Added to cart\';">Add to cart</button>',
      '</div>',
      '<div data-component-type="s-search-result" data-asin="CLIF-SPONSORED">',
      '<h2><a href="/dp/clif-sponsored">CLIF Bar Cool Mint Chocolate with Caffeine</a></h2>',
      '<span>Sponsored</span><span class="a-price">$2.49</span><button>Add to cart</button>',
      '</div>',
      '<aside id="direct-result-sidecart" aria-label="Cart preview" hidden><p>Subtotal $2.97</p><button id="direct-result-go-to-cart" onclick="location.href=\'/cart?source=side-cart\'">Go to Cart</button></aside>',
      '<a id="nav-cart" href="/cart?source=header-cart"><span id="nav-cart-count">0</span> Cart</a>',
      '</main>'
    ].join('');
  }
  if (pathname === '/header-cart-search') {
    return [
      '<main>',
      '<nav><span id="nav-link-accountList-nav-line-1">Hello, Test Shopper</span><a id="nav-cart" href="/cart?source=header-cart">1 Cart</a></nav>',
      '<h1>Cart ready</h1>',
      '</main>'
    ].join('');
  }
  if (pathname === '/brand-search') {
    return [
      '<main>',
      '<h1>Results</h1>',
      '<form action="/brand-search"><label>Search <input type="search" name="q" role="searchbox" /></label><button type="submit">Search</button></form>',
      '<div data-component-type="s-search-result" data-asin="NUTRIGRAIN-DECOY">',
      '<h2><a href="/dp/nutri-grain-decoy">Kellogg\'s Nutri-Grain Breakfast Blueberry Granola Bar</a></h2>',
      '<span class="a-price">$2.79</span><span>4.7 out of 5 stars</span><span>4,000 ratings</span>',
      '<button>Add to Cart</button>',
      '</div>',
     '<div data-component-type="s-search-result" data-asin="NATURE-VALLEY-UNAVAILABLE">',
     '<h2><a href="/dp/nature-valley-unavailable">Nature Valley Crunchy Granola Bars</a></h2>',
     '<span class="a-price">$2.97</span><span>4.8 out of 5 stars</span><span>8,000 ratings</span>',
     '<button>Add to Cart</button>',
     '</div>',
      '<div data-component-type="s-search-result" data-asin="NATURE-VALLEY-LOCAL-MARKET">',
      '<h2><a href="/dp/nature-valley-local-market">Nature Valley Crunchy Granola Bars</a></h2>',
      '<span class="a-price">$2.50</span><span>4.9 out of 5 stars</span><span>20,000 ratings</span><span>Ships from Lucky Supermarket. FREE delivery.</span>',
      '<button onclick="location.href=\'/cart?brand=local-market\'">Add to Cart</button>',
      '</div>',
     '<div data-component-type="s-search-result" data-asin="NATURE-VALLEY-VALID">',
      '<h2><a href="/dp/nature-valley-valid">Nature Valley Oats n Honey Granola Bars</a></h2>',
      '<span class="a-price">$3.50</span><span>4.7 out of 5 stars</span><span>12,000 ratings</span><span>Ships from Amazon.com. Prime delivery. FREE delivery Tomorrow.</span>',
      '<button onclick="location.href=\'/cart?brand=nature-valley-valid\'">Add to Cart</button>',
      '</div>',
      '</main>'
    ].join('');
  }
  if (pathname === '/dp/nutri-grain-decoy') {
    brandCandidateVisits.push('nutri-grain-decoy');
    return '<main><h1>Kellogg\'s Nutri-Grain Breakfast Blueberry Granola Bar</h1><p>$2.79</p><p>Buying options unavailable.</p></main>';
  }
 if (pathname === '/dp/nature-valley-unavailable') {
   brandCandidateVisits.push('nature-valley-unavailable');
   return '<main><h1>Nature Valley Crunchy Granola Bars</h1><div id="corePrice_feature_div"><span class="a-offscreen">$19.93</span></div><input id="add-to-cart-button" type="submit" value="Add to Cart" /></main>';
 }
  if (pathname === '/dp/nature-valley-local-market') {
    return '<main><h1>Nature Valley Crunchy Granola Bars</h1><div id="corePrice_feature_div"><span class="a-offscreen">$2.50</span></div><p>Ships from Lucky Supermarket. FREE delivery.</p><input id="add-to-cart-button" type="submit" value="Add to Cart" /></main>';
  }
  if (pathname === '/dp/nature-valley-valid') {
    brandCandidateVisits.push('nature-valley-valid');
    return [
      '<span id="nav-cart-count">0</span>',
      '<main><h1>Nature Valley Oats n Honey Granola Bars</h1>',
      '<div id="corePrice_feature_div"><span class="a-offscreen">$3.50</span></div>',
      '<span aria-label="Amazon Prime">Prime delivery</span>',
      '<div id="deliveryBlockMessage">FREE delivery</div>',
      '<input id="add-to-cart-button" type="submit" value="Add to Cart" onclick="location.href=\'/cart\'" />',
      '<input id="buy-now-button" type="submit" value="Buy Now" />',
      '<aside aria-label="Cart preview"><h2>Cart</h2><p>Subtotal $19.93</p><button onclick="location.href=\'/cart\'">Go to Cart</button></aside>',
      '</main>'
    ].join('');
  }
  if (pathname === '/conditional-shipping-search') {
    return [
      '<main>',
      '<h1>Results</h1>',
      '<form action="/conditional-shipping-search"><label>Search <input type="search" name="q" role="searchbox" /></label><button type="submit">Search</button></form>',
      '<div data-component-type="s-search-result" data-asin="NATURE-VALLEY-CONDITIONAL">',
      '<h2><a href="/dp/nature-valley-conditional">Nature Valley Sweet & Salty Almond Granola Bars</a></h2>',
      '<span class="a-price">$2.97</span><span>4.9 out of 5 stars</span><span>20,000 ratings</span><span aria-label="Amazon Prime">Prime Overnight</span><p>FREE delivery on $25 of qualifying items. Or $4.99 delivery in 3 hours.</p>',
      '<button>Add to Cart</button>',
      '</div>',
      '<div data-component-type="s-search-result" data-asin="NATURE-VALLEY-VALID">',
      '<h2><a href="/dp/nature-valley-valid">Nature Valley Oats n Honey Granola Bars</a></h2>',
      '<span class="a-price">$3.50</span><span>4.7 out of 5 stars</span><span>12,000 ratings</span><span aria-label="Amazon Prime">Prime delivery</span><p>FREE delivery Tomorrow</p>',
      '<button onclick="location.href=\'/cart?brand=nature-valley-valid\'">Add to Cart</button>',
      '</div>',
      '</main>'
    ].join('');
  }
  if (pathname === '/dp/nature-valley-conditional') {
    conditionalCandidateVisits.push('nature-valley-conditional');
    return [
      '<span id="nav-cart-count">0</span>',
      '<main><h1>Nature Valley Sweet & Salty Almond Granola Bars</h1>',
      '<div id="corePrice_feature_div"><span class="a-offscreen">$2.97</span></div>',
      '<span aria-label="Amazon Prime">Prime Overnight</span>',
      '<div id="deliveryBlockMessage">FREE delivery on $25 of qualifying items. Or $4.99 delivery in 3 hours.</div>',
      '<input id="add-to-cart-button" type="submit" value="Add to Cart" onclick="location.href=\'/cart?brand=conditional-paid\'" />',
      '</main>'
    ].join('');
  }
  if (pathname === '/late-shipping-search') {
    return [
      '<main>',
      '<h1>Results</h1>',
      '<form action="/late-shipping-search"><label>Search <input type="search" name="q" role="searchbox" /></label><button type="submit">Search</button></form>',
      '<div data-component-type="s-search-result" data-asin="TEST-GADGET-LATE-PAID">',
      '<h2><a href="/dp/test-gadget-late-paid">Test Gadget Prime Snack Pack</a></h2>',
      '<span class="a-price">$3.50</span><span>4.9 out of 5 stars</span><span>20,000 ratings</span><span aria-label="Amazon Prime">Prime delivery</span><p>FREE delivery Tomorrow</p>',
      '</div>',
      '<div data-component-type="s-search-result" data-asin="TEST-GADGET-FREE-PRIME">',
      '<h2><a href="/dp/test-gadget-free-prime">Test Gadget Free Prime Pack</a></h2>',
      '<span class="a-price">$3.75</span><span>4.7 out of 5 stars</span><span>12,000 ratings</span><span aria-label="Amazon Prime">Prime delivery</span><p>FREE delivery Tomorrow</p>',
      '</div>',
      '</main>'
    ].join('');
  }
  if (pathname === '/dp/test-gadget-late-paid') {
    lateShippingCandidateVisits.push('test-gadget-late-paid');
    return [
      '<span id="nav-cart-count">0</span>',
      '<main><h1>Test Gadget Prime Snack Pack</h1>',
      '<div id="corePrice_feature_div"><span class="a-offscreen">$3.50</span></div>',
      '<span aria-label="Amazon Prime">Prime delivery</span>',
      '<div id="deliveryBlockMessage">FREE delivery Tomorrow</div>',
      '<input id="add-to-cart-button" type="submit" value="Add to Cart" onclick="location.href=\'/cart?late=paid\'" />',
      '</main>'
    ].join('');
  }
  if (pathname === '/dp/test-gadget-free-prime') {
    lateShippingCandidateVisits.push('test-gadget-free-prime');
    return [
      '<span id="nav-cart-count">0</span>',
      '<main><h1>Test Gadget Free Prime Pack</h1>',
      '<div id="corePrice_feature_div"><span class="a-offscreen">$3.75</span></div>',
      '<span aria-label="Amazon Prime">Prime delivery</span>',
      '<div id="deliveryBlockMessage">FREE delivery Tomorrow</div>',
      '<input id="add-to-cart-button" type="submit" value="Add to Cart" onclick="location.href=\'/cart?late=free\'" />',
      '</main>'
    ].join('');
  }
  if (pathname === '/multi-search') {
    const query = String(searchParams.get('q') || '').toLowerCase();
    const items = multiCatalog.filter((item) => query.includes(item.query) || (item.query === 'chocolate' && /hershey/.test(query)));
    return [
      '<main>',
      '<h1>Results</h1>',
      '<form action="/multi-search"><label>Search <input type="search" name="q" role="searchbox" /></label><button type="submit">Search</button></form>',
      ...items.map((item) => [
        `<div data-component-type="s-search-result" data-asin="BROWSER-SMOKE-${item.id.toUpperCase()}">`,
        `<h2><a href="/dp/${item.id}">${item.title}</a></h2>`,
        `<span class="a-price">$${item.price.toFixed(2)}</span><span>${item.rating} out of 5 stars</span><span>${item.reviews} ratings</span><span>${item.fulfillment}</span>`,
        '</div>'
      ].join('')),
      '</div>',
      '</main>'
    ].join('');
  }
  if (pathname.startsWith('/dp/')) {
    const item = multiCatalog.find((candidate) => pathname === `/dp/${candidate.id}`);
    if (item) return `<main><h1>${item.title}</h1><p>$${item.price.toFixed(2)}</p><button onclick="location.href='/multi-cart?add=${item.id}'">Add to cart</button></main>`;
  }
  if (pathname === '/multi-cart') {
    const added = String(searchParams.get('add') || '');
    if (added && !multiBasketItems.includes(added)) multiBasketItems.push(added);
    const selectedItems = multiBasketItems.map((item) => multiCatalog.find((candidate) => candidate.id === item)).filter(Boolean);
    const total = selectedItems.reduce((sum, item) => sum + item.price, 0);
    const labels = selectedItems.map((item) => item.title);
    return [
      '<main><h1>Your cart</h1>',
      `<p>${labels.join(' · ') || 'No items yet'}</p>`,
      `<p>Subtotal (${multiBasketItems.length} ${multiBasketItems.length === 1 ? 'item' : 'items'}): $${total.toFixed(2)}</p>`,
      '<button onclick="location.href=\'/checkout\'">Proceed to checkout</button>',
      '</main>'
    ].join('');
  }
  if (pathname === '/dp/test-gadget') {
    const delayed = delayFirstProductControl;
    delayFirstProductControl = false;
    const addControl = '<input id="add-to-cart-button-ubb" name="submit.add-to-cart.retail" type="submit" value="Add to Cart" onclick="location.href=\'/cart\'" />';
    return [
      '<main><h1>Test Gadget</h1><p>$3.50</p><span aria-label="Amazon Prime">Prime delivery</span><div id="deliveryBlockMessage">FREE delivery</div>',
      delayed ? '<div id="purchase-box">Loading purchase options...</div>' : addControl,
      '</main>',
      delayed ? `<script>setTimeout(() => { document.querySelector('#purchase-box').outerHTML = ${JSON.stringify(addControl)}; }, 1800);</script>` : ''
    ].join('');
  }
  if (pathname === '/cart-preview-start') {
    return [
      '<main><h1>Results for "test gadget"</h1>',
      '<p>Search results are visible, but the approved item is already in the cart preview.</p>',
      '<aside aria-label="Cart preview">',
      '<h2>Cart</h2>',
      '<p>Test Gadget</p>',
      '<p>Subtotal $3.50</p>',
      '<button onclick="location.href=\'/cart\'">Go to Cart</button>',
      '<button aria-label="Decrease quantity">-</button>',
      '<button aria-label="Increase quantity">+</button>',
      '</aside>',
      '</main>'
    ].join('');
  }
  if (pathname === '/post-add-confirmation') {
    return [
      '<main data-testid="added-to-cart-confirmation">',
      '<nav><span id="nav-link-accountList-nav-line-1">Hello, Test Shopper</span><a id="nav-cart" href="/cart?source=post-add-header"><span id="nav-cart-count">1</span> Cart</a></nav>',
      '<h1>Added to cart</h1>',
      '<section><p>Nature Valley Crunchy Granola Bars</p><p>Cart Subtotal: $3.50</p>',
      '<div id="sw-ptc"><button onclick="location.href=\'/checkout/from-post-add\'">Proceed to checkout (1 item)</button></div>',
      '<div id="sw-gtc"><a href="/cart?source=post-add-confirmation">Go to Cart</a></div>',
      '</section>',
      '<aside aria-label="Cart preview"><p>Subtotal $3.50</p><a href="/cart?source=post-add-side">Go to Cart</a></aside>',
      '</main>'
    ].join('');
  }
  if (pathname === '/cart' || pathname === '/gp/cart/view.html') {
    if (searchParams.get('brand') === 'nature-valley-valid') brandCartItem = 'nature-valley-valid';
    if (searchParams.get('late') === 'paid') {
      lateShippingCartItem = 'paid';
      checkoutFixture = {
        ...checkoutFixture,
        total: '$7.49',
        merchandiseSubtotal: '$3.50',
        shipping: '$3.99',
        itemCount: 1,
        freeDeliveryAvailable: false
      };
    }
    if (searchParams.get('late') === 'free') {
      lateShippingCartItem = 'free';
      checkoutFixture = {
        ...checkoutFixture,
        total: '$3.75',
        merchandiseSubtotal: '$3.75',
        shipping: '$0.00',
        itemCount: 1,
        freeDeliveryAvailable: true
      };
    }
    const selectedBrandItem = brandCartItem === 'nature-valley-valid';
    const selectedLatePaidItem = lateShippingCartItem === 'paid';
    const selectedLateFreeItem = lateShippingCartItem === 'free';
    const cartAsin = selectedBrandItem ? 'NATURE-VALLEY-VALID' : selectedLatePaidItem ? 'TEST-GADGET-LATE-PAID' : selectedLateFreeItem ? 'TEST-GADGET-FREE-PRIME' : 'BROWSER-SMOKE-ASIN';
    const cartUrl = selectedBrandItem ? '/dp/nature-valley-valid' : selectedLatePaidItem ? '/dp/test-gadget-late-paid' : selectedLateFreeItem ? '/dp/test-gadget-free-prime' : '/dp/test-gadget';
    const cartTitle = selectedBrandItem ? 'Nature Valley Oats n Honey Granola Bars' : selectedLatePaidItem ? 'Test Gadget Prime Snack Pack' : selectedLateFreeItem ? 'Test Gadget Free Prime Pack' : 'Test Gadget';
    const cartPrice = selectedLateFreeItem ? '$3.75' : '$3.50';
    const cartDelivery = selectedLatePaidItem
      ? 'Prime Overnight. FREE delivery on $25 of qualifying items. Or $3.99 delivery Tomorrow.'
      : 'Prime delivery. FREE delivery Tomorrow.';
    const checkoutTarget = checkoutFixture.checkoutPrelude
      ? `/checkout/byg?sessionID=browser-smoke&useDefaultCart=1&cartItemCount=1&partialCheckoutCart=1&pipelineType=Chewbacca&referrer=cart&tangoIngressUrl=${encodeURIComponent('/checkout/entry/cart?proceedToCheckout=1&pipelineType=Chewbacca&referrer=cart')}`
      : '/checkout/p/p-106-7044535-6467434/pip?pipelineType=Chewbacca&referrer=cart';
    return [
      '<a href="#skippedLink">Skip to main content</a>',
      '<main><h1>Your cart</h1>',
      `<div id="activeCartViewForm"><div class="sc-list-item" data-asin="${cartAsin}"><a href="${cartUrl}">${cartTitle}</a><span aria-label="Amazon Prime">Prime delivery</span><p>${cartDelivery}</p><button data-action="delete" onclick="lateShippingCartItem=null; brandCartItem=null; document.querySelector('#activeCartViewForm').innerHTML='<p>Your cart is empty.</p>'; document.querySelector('#nav-cart-count')?.replaceChildren(document.createTextNode('0'));">Delete</button></div></div>`,
      `<p>Subtotal (1 item): ${cartPrice}</p>`,
      '<button>Subscribe & Save</button>',
      `<span id="sc-buy-box-ptc-button"><input type="submit" name="proceedToRetailCheckout" value="Proceed to checkout" onclick="location.href='${checkoutTarget}'" /></span>`,
      '</main>',
      '<aside data-item-index="recommended-melitta"><a href="/dp/MELITTA-COFFEE">Melitta Junior Basket Coffee Filter</a><span>Free delivery</span></aside>',
      '<aside>',
      '<p>Add $32.21 of eligible items or Join Prime to get FREE delivery on eligible items with no order minimum.</p>',
      '<button>Try Prime FREE</button>',
      '<button>No thanks</button>',
      '</aside>'
    ].join('');
  }
  if (pathname === '/checkout/byg') {
    return '';
  }
  if (pathname === '/alm/byg') {
    return [
      '<main><h1>Need anything else?</h1>',
      '<section><h2>Recommended for you</h2><button>Add a suggested item</button></section>',
      '<button onclick="location.href=\'/alm/substitution?pipelineType=Chewbacca&referrer=cart\'">Continue</button>',
      '</main>'
    ].join('');
  }
  if (pathname === '/alm/substitution') {
    return [
      '<main><h1>Choose your substitution preferences</h1>',
      '<p>Substitute with best available.</p>',
      '<button>Change</button>',
      '<button onclick="location.href=\'/checkout/p/p-106-7044535-6467434/pip?pipelineType=Chewbacca&referrer=prime\'">Continue</button>',
      '</main>'
    ].join('');
  }
  if (pathname === '/checkout/entry/cart') {
    return [
      '<main><h1>Opening checkout</h1>',
      '<script>setTimeout(() => { location.href = "/checkout/p/p-106-7044535-6467434/pip?pipelineType=Chewbacca&referrer=cart"; }, 50);</script>',
      '</main>'
    ].join('');
  }
  if (pathname === '/checkout/p/p-106-7044535-6467434/pip') {
    return [
      '<main><h1>Try Prime FREE for 30 days</h1>',
      '<p>Receive eligible items tomorrow with Prime. After trial, Prime auto-renews.</p>',
      '<p>Select a payment method for Prime. Visa ending in 0109.</p>',
      '<a class="a-link-normal" href="/checkout/p/p-106-7044535-6467434/spc?pipelineType=Chewbacca&referrer=spc"><span>No thanks</span></a>',
      '<button>Get FREE One-Day Delivery with Prime</button>',
      '</main>'
    ].join('');
  }
  if (pathname === '/checkout' || pathname === '/checkout/p/p-106-7044535-6467434/spc') {
    const selectedCardLast4 = String(checkoutFixture.selectedCardLast4 || '0109');
    const selectedCardBrand = selectedCardLast4 === '1817' ? 'Mastercard' : 'Visa';
    const addressPrimeModal = checkoutFixture.showAddressPrimeModal
      ? [
          '<div id="prime-address-modal" role="dialog" aria-modal="true">',
          '<h2>Try Prime free for 30 days and get Two-Day Delivery</h2>',
          '<p>After trial, Prime auto-renews. Cancel anytime.</p>',
          '<p>Select a payment method for Prime. Visa ending in 0109.</p>',
          '<button onclick="document.querySelector(\'#prime-address-modal\').remove()">No thanks</button>',
          '<button>Start your free trial of Prime</button>',
          '</div>'
        ].join('')
      : '';
    const matchingAddressSummary = checkoutFixture.matchingAddressSummary || '1 Magic City Way, San Francisco, CA 94107';
    const matchingAddressText = checkoutFixture.matchingAddressText || 'Test User 1 Magic City Way, San Francisco, CA 94107, United States Phone number: 415-555-0100';
    const conflictingUnitChoice = checkoutFixture.includeConflictingUnitAddress
      ? '<label><input type="radio" name="address" data-summary="1 MAGIC CITY ST, UNIT 999, SAN FRANCISCO, CA 94107" /> Test User 1 MAGIC CITY ST Unit 999 San Francisco, CA 94107 United States</label>'
      : '';
    const matchingAddressChoice = checkoutFixture.matchingAddressAvailable
      ? `<label><input type="radio" name="address" data-summary="${matchingAddressSummary}" /> ${matchingAddressText}</label>`
      : '';
    const freeDeliveryOptions = checkoutFixture.freeDeliveryAvailable === false
      ? ''
      : [
          '<label><input type="radio" name="delivery" /> Standard delivery FREE</label>',
          '<label><input type="radio" name="delivery" /> One-Day delivery FREE</label>'
        ].join('');
    return [
      addressPrimeModal,
      '<main><h1>Review your order</h1>',
      `<p>Order total: ${checkoutFixture.total}</p>`,
      `<p>Items: ${checkoutFixture.merchandiseSubtotal || checkoutFixture.total}</p>`,
      `<p>Shipping &amp; handling: ${checkoutFixture.shipping || '$0.00'}</p>`,
      `<p>Subtotal (${checkoutFixture.itemCount} ${checkoutFixture.itemCount === 1 ? 'item' : 'items'}): ${checkoutFixture.merchandiseSubtotal || checkoutFixture.total}</p>`,
      '<div class="checkout-card"><div class="checkout-card-copy">',
      '<h2>Delivering to Test User</h2>',
      '<p id="delivery-summary">99 Wrong Road, New York, NY 10001</p>',
      '<p>Add delivery instructions</p></div>',
      '<div class="checkout-card-action"><a href="#" onclick="event.preventDefault(); document.querySelector(\'#address-options\').hidden=false">Change</a></div>',
      '<div id="address-options" hidden>',
      '<label><input type="radio" name="address" /> 99 Wrong Road, 10001</label>',
      conflictingUnitChoice,
      matchingAddressChoice,
      '<button onclick="const selected=document.querySelector(\'input[name=address]:checked\'); if(selected?.dataset.summary){document.querySelector(\'#delivery-summary\').textContent=selected.dataset.summary; document.querySelector(\'#address-options\').hidden=true}">Deliver to this address</button>',
      '<button onclick="document.querySelector(\'#new-address-form\').hidden=false">Add a new delivery address</button></div>',
      `<div id="new-address-form" role="dialog" aria-modal="true" style="position:fixed;inset:24px;z-index:10;background:white;overflow:auto" ${checkoutFixture.startWithNewAddressModal ? '' : 'hidden'}><h2>Add a new delivery address</h2>`,
      '<input aria-label="Full name" value="Wrong Name" />',
      '<input aria-label="Phone number" value="2125550100" />',
      '<input aria-label="Street address" value="99 Wrong Road" />',
      '<input aria-label="City" value="New York" />',
      '<select aria-label="State"><option value="CA">California</option><option value="NY" selected>New York</option></select>',
      '<input aria-label="ZIP code" value="10001" />',
      '<button onclick="const street=document.querySelector(\'[aria-label=\\\'Street address\\\']\').value; const city=document.querySelector(\'[aria-label=\\\'City\\\']\').value; const state=document.querySelector(\'[aria-label=\\\'State\\\']\').value; const zip=document.querySelector(\'[aria-label=\\\'ZIP code\\\']\').value; document.querySelector(\'#delivery-summary\').textContent=`${street}, ${city}, ${state} ${zip}`; document.querySelector(\'#new-address-form\').hidden=true; document.querySelector(\'#address-options\').hidden=true">Deliver to this address</button></div></div>',
      '<div class="checkout-card"><div class="checkout-card-copy">',
      `<h2 id="payment-summary">Paying with ${selectedCardBrand} ${selectedCardLast4}</h2>`,
      '<p>Use a gift card, voucher, or promo code</p></div>',
      '<div class="checkout-card-action"><a href="#" onclick="event.preventDefault(); document.querySelector(\'#payment-options\').hidden=false">Change</a></div>',
      '<div id="payment-options" hidden>',
      `<label><input style="position:absolute;opacity:0;width:1px;height:1px" type="radio" name="payment" ${selectedCardLast4 === '0109' ? 'checked' : ''} /> Visa ending in 0109</label>`,
      `<label><input style="position:absolute;opacity:0;width:1px;height:1px" type="radio" name="payment" ${selectedCardLast4 === '1817' ? 'checked' : ''} /> Mastercard ending 1817</label>`,
      '<label><input style="position:absolute;opacity:0;width:1px;height:1px" type="radio" name="payment" /> Visa ending in 6383</label>',
      '<a href="#" onclick="event.preventDefault(); document.querySelector(\'#add-card-form\').hidden=false">Add a credit or debit card</a>',
      '<button id="use-payment-method" onclick="const selected=document.querySelector(\'input[name=payment]:checked\'); const text=selected?.closest(\'label\')?.innerText || \'\'; if(selected && /(?:visa|mastercard|amex|discover)/i.test(text)){document.querySelector(\'#payment-summary\').textContent=`Paying with ${text.replace(/ ending in /i, \' \')}`; document.querySelector(\'#payment-options\').hidden=true}">Use this payment method</button></div>',
      '<div id="add-card-form" hidden><h2>Add a credit or debit card</h2><input id="card-number-input" aria-label="Card number" autocomplete="cc-number" /><input aria-label="Name on card" autocomplete="cc-name" /><button onclick="const number=document.querySelector(\'#card-number-input\').value.replace(/\\D/g,\'\'); const last4=number.slice(-4); document.querySelector(\'#payment-summary\').textContent=`Paying with Mastercard ${last4}`; document.querySelector(\'#add-card-form\').hidden=true; document.querySelector(\'#payment-options\').hidden=true">Add your card</button></div></div>',
      '<div class="checkout-card"><div class="checkout-card-copy">',
      '<h2>Shipping speed</h2>',
      '<p>Fast delivery $3.99</p></div>',
      '<div class="checkout-card-action"><a href="#" onclick="event.preventDefault(); document.querySelector(\'#delivery-options\').hidden=false">Change</a></div>',
      '<div id="delivery-options" hidden>',
      '<label><input type="radio" name="delivery" /> Fast delivery $3.99</label>',
      freeDeliveryOptions,
      '<label><input type="radio" name="delivery" /> Try Prime FREE one-day trial</label></div></div>',
      '<input aria-label="Billing street address" value="1 Wrong Billing Way" />',
      '<input aria-label="Billing ZIP code" value="99999" />',
      '<button onclick="document.querySelector(\'#order-result\').textContent=\'Order placed\'; this.remove()">Place order</button>',
      '<p id="order-result"></p>',
      '</main>'
    ].join('');
  }
  if (pathname === '/checkout/pay-confirm') {
    return [
      '<main><h1>Select a payment method</h1>',
      '<section aria-label="Order summary">',
      '<p>Items: $2.97</p>',
      '<p>Shipping &amp; handling: $0.00</p>',
      '<p>Order total: $2.97</p>',
      '</section>',
      '<section aria-label="Payment method">',
      '<h2 id="payment-summary">Paying with Mastercard 6383</h2>',
      '<div id="payment-options-noise">',
      '<label><input type="radio" name="payment" /> Visa ending in 0109</label>',
      '<label><input type="radio" name="payment" checked /> Mastercard ending in 6383</label>',
      '<label>Reference number (optional): <input aria-label="Reference number (optional)" type="text" /></label>',
      '<a href="#add-card">Add a credit or debit card</a>',
      '<a href="#gift-card">Use a gift card, voucher, or promo code</a>',
      '</div>',
      '<span class="a-button"><span class="a-button-inner"><input id="ppw-widgetEvent:SetPaymentPlanSelectContinueEvent" name="ppw-widgetEvent:SetPaymentPlanSelectContinueEvent" type="submit" aria-labelledby="ppw-widgetEvent:SetPaymentPlanSelectContinueEvent-announce" onclick="location.href=\'/checkout/final-review\'" /><span id="ppw-widgetEvent:SetPaymentPlanSelectContinueEvent-announce" class="a-button-text">Use this payment method</span></span></span>',
      '</section>',
      '<section aria-label="Delivery address">',
      '<h2>Delivering to Test User</h2>',
      '<p>1 Magic City Way, San Francisco, CA 94107, United States</p>',
      '<a href="#">Change</a>',
      '</section>',
      '</main>'
    ].join('');
  }
  if (pathname === '/checkout/final-review') {
    return [
      '<main><h1>Review your order</h1>',
      '<section aria-label="Order summary"><p>Items: $2.97</p><p>Shipping &amp; handling: $0.00</p><p>Order total: $2.97</p></section>',
      '<section aria-label="Payment method"><h2>Paying with Mastercard 6383</h2></section>',
      '<section aria-label="Delivery address"><h2>Delivering to Test User</h2><p>1 Magic City Way, San Francisco, CA 94107, United States</p></section>',
      '<span class="a-button"><span class="a-button-inner"><input id="submitOrderButtonId" type="submit" aria-labelledby="submitOrderButtonId-announce" onclick="document.body.dataset.orderSubmitted=\'1\'; location.href=\'/checkout/order-confirmation\'" /><span id="submitOrderButtonId-announce" class="a-button-text">Place your order</span></span></span>',
      '</main>'
    ].join('');
  }
  if (pathname === '/checkout/order-confirmation') {
    return [
      '<main><h1>Order placed</h1>',
      '<p>Thank you, your order has been placed.</p>',
      '</main>'
    ].join('');
  }
  const catalogNoise = Array.from({ length: 1200 }, (_, index) => `<a href="/help/noise-${index}">Catalog navigation ${index}</a>`).join('');
  return [
    '<main>',
    '<nav><span id="nav-link-accountList-nav-line-1">Hello, Test Shopper</span><a href="/prime">Join Prime</a><button>No thanks</button></nav>',
    '<h1>Results for test gadget</h1>',
    '<form action="/search"><label>Search <input type="search" name="q" role="searchbox" /></label><button type="submit">Search</button></form>',
    '<section aria-label="Search filters"><label for="prime-filter"><input id="prime-filter" type="checkbox" aria-label="Prime" /> Prime</label><label for="free-shipping-filter"><input id="free-shipping-filter" type="checkbox" aria-label="Free shipping" /> Free shipping</label></section>',
    catalogNoise,
    '<div data-component-type="s-search-result" data-asin="BROWSER-SMOKE-ASIN">',
    '<h2><a href="/dp/test-gadget">Test gadget collection</a></h2>',
    '<span class="a-price">$3.50</span><span>4.7 out of 5 stars</span><span>1,240 ratings</span><span aria-label="Amazon Prime">Prime delivery</span>',
    '<button id="browser-smoke-search-add" onclick="location.href=\'/post-add-confirmation\'">Add to cart</button>',
    '</div>',
    '<aside id="browser-smoke-sidecart" aria-label="Cart preview" hidden><p>Subtotal $3.50</p><button onclick="location.href=\'/cart?source=browser-smoke-sidecart\'">Go to Cart</button></aside>',
    '<a id="nav-cart" href="/cart?source=browser-smoke-header"><span id="nav-cart-count">0</span> Cart</a>',
    '</main>'
  ].join('');
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-extension-browser-'));
  let context = null;
  let server = null;
  // Playwright's browser protocol promises are intentionally unref'd. Keep
  // Node alive until the assertions below resolve instead of letting a quiet
  // MV3 startup make the smoke exit before it exercises any scenario.
  const keepAlive = setInterval(() => {}, 1_000);
  try {
    const certificate = createCertificate(tmpDir);
    const checkpoints = [];
    const claimedSessionIds = [];
    let fulfillment = null;
    let session = null;
    let distractorSession = null;
    let slowInitialSearchResponse = true;
    // Exhaust the in-action retries once. The runner must preserve the plan
    // cursor, schedule a resume, and finish instead of posting a failed receipt.
    let transientRunnerStatusFailures = 3;
    let transientRunnerStatusFailureCount = 0;
    server = https.createServer(certificate, async (req, res) => {
      const origin = `https://${req.headers.host}`;
      const url = new URL(req.url || '/', origin);
      if (!url.pathname.startsWith('/connectors/') && !url.pathname.startsWith('/plugins/') && !url.pathname.startsWith('/native-runner/')) {
        if (url.pathname === '/search' && slowInitialSearchResponse) {
          slowInitialSearchResponse = false;
          await new Promise((resolve) => setTimeout(resolve, 3_300));
        }
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<!doctype html><title>Test Store</title>${storefront(url.pathname, url.searchParams)}`);
        return;
      }
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method || '') ? await readJson(req) : {};
      if (req.method === 'POST' && url.pathname === '/native-runner/extension/pairing/claim') {
        return json(res, 201, { setup: { baseUrl: origin, deviceToken: 'mcnr_browser_smoke_token', deviceId: 'browser-smoke-device' } });
      }
      if (req.method === 'POST' && url.pathname === '/plugins/register') return json(res, 201, { registered: true });
      if (req.method === 'GET' && url.pathname === '/connectors/sessions') {
        const active = [distractorSession, session]
          .filter(Boolean)
          .filter((candidate) => !['fulfilled', 'failed'].includes(candidate.status));
        return json(res, 200, { sessions: active, actionableCount: active.length });
      }
      if (req.method === 'POST' && url.pathname.endsWith('/claim')) {
        const matched = url.pathname.match(/^\/connectors\/sessions\/([^/]+)\/claim$/);
        const claimedSessionId = decodeURIComponent(matched?.[1] || '');
        claimedSessionIds.push(claimedSessionId);
        if (claimedSessionId === session?.id) {
          session = { ...session, status: 'claimed', claimedByPluginId: body.pluginId };
          return json(res, 200, { claimed: true, session });
        }
        if (claimedSessionId === distractorSession?.id) {
          distractorSession = { ...distractorSession, status: 'claimed', claimedByPluginId: body.pluginId };
          return json(res, 200, { claimed: true, session: distractorSession });
        }
        return json(res, 404, { error: 'test_claim_session_not_found' });
      }
      if (req.method === 'POST' && url.pathname.endsWith('/runner-status')) {
        if (transientRunnerStatusFailures > 0) {
          transientRunnerStatusFailures -= 1;
          transientRunnerStatusFailureCount += 1;
          req.socket.destroy();
          return;
        }
        return json(res, 200, { active: !['fulfilled', 'failed'].includes(session.status), session });
      }
      if (req.method === 'POST' && url.pathname.endsWith('/checkpoint')) {
        const plan = session.extensionMissionPlan;
        const state = session.extensionMissionPlanState;
        const expected = plan.actions[state.nextActionIndex];
        if (!expected || expected.id !== body.planActionId || expected.missionAction !== body.missionAction) {
          return json(res, 409, { error: 'test_plan_step_out_of_order' });
        }
        const reportedMilestones = Array.isArray(body.verifiedMilestones) ? body.verifiedMilestones : [];
        if (body.milestoneProtocol === 'verified-v1'
          && body.planActionStatus !== 'waiting'
          && expected.expectedMilestone
          && !reportedMilestones.includes(expected.expectedMilestone)) {
          return json(res, 409, { error: 'test_plan_milestone_not_verified', expectedMilestone: expected.expectedMilestone });
        }
        checkpoints.push(body);
        const advanced = body.planActionStatus !== 'waiting';
        session = {
          ...session,
          status: 'executing',
          missionBoundaryLatestHash: `0x${crypto.randomBytes(8).toString('hex')}`,
          missionBoundaryEventCount: Number(session.missionBoundaryEventCount || 0) + 1,
          extensionMissionPlanState: advanced
            ? {
                ...state,
                nextActionIndex: state.nextActionIndex + 1,
                completedActionIds: [...state.completedActionIds, expected.id],
                verifiedMilestones: [...new Set([
                  ...(Array.isArray(state.verifiedMilestones) ? state.verifiedMilestones : []),
                  ...reportedMilestones
                ])]
              }
            : state
        };
        return json(res, 200, { updated: true, session });
      }
      if (req.method === 'POST' && url.pathname.endsWith('/fulfill')) {
        fulfillment = body;
        session = { ...session, status: body.status || 'fulfilled', fulfilledByPluginId: body.pluginId };
        return json(res, 200, { session });
      }
      return json(res, 404, { error: 'test_route_not_found' });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const baseUrl = `https://127.0.0.1:${port}`;
    const plan = buildExtensionPlan({
      id: 'browser-smoke-session',
      handoffData: { kind: 'browser' },
      selections: {
        targetUrl: `${baseUrl}/search`,
        goal: 'buy test gadget',
        budget: '$4',
        finalApprovalPolicy: 'auto_submit_after_verified_checkout'
      },
      extensionCheckoutProfileEnabled: true,
      extensionFulfillmentPolicy: 'amazon_free_shipping_preferred',
      extensionPrimeRequired: true
    });
    session = {
      id: 'browser-smoke-session',
      connectorId: 'browser-worker-demo-v1',
      status: 'queued',
      completionMode: 'agent_checkout',
      preferredExecutionAgentId: 'magic-city-runner-extension',
      extensionCheckoutProfileEnabled: true,
      handoffData: { kind: 'browser' },
      missionBoundAuth: {
        capabilityId: 'browser-smoke-capability',
        tokenHash: '0xbrowser-smoke-token',
        token: 'browser-smoke-token',
        audience: 'magic_internet_helper',
        subject: { sessionId: 'browser-smoke-session' },
        policy: {
          allowedDomains: ['127.0.0.1'],
          allowedActions: ['browser_open', 'read_public_page', 'browser_type', 'browser_click', 'fill_safe_fields', 'prepare_cart', 'final_submit', 'handoff']
        },
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        confirmation: { method: 'proof-of-possession' }
      },
      extensionMissionPlan: plan,
      extensionMissionPlanState: { planHash: plan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    distractorSession = {
      ...session,
      id: 'browser-smoke-distractor-session',
      missionBoundAuth: {
        ...session.missionBoundAuth,
        capabilityId: 'browser-smoke-distractor-capability',
        subject: { sessionId: 'browser-smoke-distractor-session' }
      }
    };

    const extensionDir = copyTestExtension(tmpDir, baseUrl);
    const profileDir = path.join(tmpDir, 'profile');
    const launchOptions = {
      headless: false,
      args: ['--ignore-certificate-errors', `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    };
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
    await waitFor(() => context.serviceWorkers()[0], 15_000);
    let worker = context.serviceWorkers()[0];
    const extensionId = new URL(worker.url()).host;
    let popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.locator('#baseUrl').fill(baseUrl);
    await popup.locator('#pairingCode').fill('BROWSER-SMOKE');
    await popup.locator('#pairBtn').click();
    await popup.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Connected'), null, { timeout: 30_000 }).catch(async (error) => {
      const status = await popup.locator('#status').textContent().catch(() => 'unreadable');
      console.error(`pairing_status_timeout:${status}`);
      throw error;
    });
    if (process.env.MAGIC_CITY_BROWSER_SMOKE_FOCUS === 'recovery') {
      const runRecoveryScenario = async ({ id, startPath, action, selectedCandidate = null, checkoutProfile = null, assertCheckpoint }) => {
        checkpoints.length = 0;
        fulfillment = null;
        const page = await context.newPage();
        await page.goto(`${baseUrl}${startPath}`);
        const tab = await popup.evaluate((url) => chrome.tabs.query({}).then((tabs) =>
          tabs.find((candidate) => candidate.url === url) || null), page.url());
        if (!tab?.id) fail(`browser_extension_${id}_tab_missing`);
        const recoveryPlan = rehashExtensionPlan({
          ...plan,
          planId: `mplan_${id}`,
          startUrl: page.url(),
          limits: { ...plan.limits, stopBeforeFinalSubmit: false },
          actions: [action, { id: 'pause-for-user', type: 'pause', missionAction: 'handoff', reason: 'recovery_smoke' }]
        });
        session = {
          ...session,
          id,
          status: 'claimed',
          claimedByPluginId: 'magic-city-runner-extension',
          fulfillment: null,
          missionBoundAuth: { ...session.missionBoundAuth, subject: { sessionId: id } },
          extensionMissionPlan: recoveryPlan,
          extensionMissionPlanState: { planHash: recoveryPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
          missionBoundaryLatestHash: null,
          missionBoundaryEventCount: 0
        };
        if (checkoutProfile) {
          await popup.evaluate(({ sessionId, profile }) => new Promise((resolve) => {
            chrome.storage.local.get(['localCheckoutProfiles'], (stored) => {
              chrome.storage.local.set({
                localCheckoutProfiles: {
                  ...(stored.localCheckoutProfiles || {}),
                  [sessionId]: { profile, expiresAt: new Date(Date.now() + 60_000).toISOString() }
                }
              }, resolve);
            });
          }), { sessionId: id, profile: checkoutProfile });
        }
        await popup.evaluate(({ sessionId, tabId, planHash, action: interruptedAction, selected }) => new Promise((resolve) => {
          chrome.storage.local.get(['activeMissionTabs'], (stored) => {
            chrome.storage.local.set({
              activeMissionTabs: { ...(stored.activeMissionTabs || {}), [sessionId]: tabId },
              activeSessionId: sessionId,
              activeRun: {
                sessionId,
                planHash,
                phase: 'executing_step',
                tabId,
                actionId: interruptedAction.id,
                actionIndex: 0,
                nextActionIndex: 0,
                selectedCandidate: selected,
                startedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              }
            }, () => {
              chrome.alarms.create('magic-city-runner-resume', { when: Date.now() + 400 });
              resolve();
            });
          });
        }), { sessionId: id, tabId: tab.id, planHash: recoveryPlan.planHash, action, selected: selectedCandidate });
        const cdp = await context.newCDPSession(page);
        await cdp.send('ServiceWorker.enable');
        await cdp.send('ServiceWorker.stopAllWorkers');
        await waitFor(() => Boolean(fulfillment), 12_000);
        const checkpoint = checkpoints.find((entry) => entry.planActionId === action.id);
        assertCheckpoint(checkpoint, fulfillment);
        await page.close();
      };
      await runRecoveryScenario({
        id: 'browser-smoke-cart-recovery-session',
        startPath: '/cart',
        action: {
          id: 'prepare-cart', type: 'click_intent', missionAction: 'prepare_cart', intent: 'add_to_cart',
          query: 'test gadget', requiredBasketItem: true, expectedMilestone: 'cart_confirmed', expectedCartItemCount: 1, maxPrice: 4
        },
        selectedCandidate: { title: 'Test Gadget', asin: 'BROWSER-SMOKE-ASIN', price: 3.5 },
        assertCheckpoint: (checkpoint) => {
          if (checkpoint?.browser?.runnerStep?.recoveredFromInterruption !== true || !checkpoint?.verifiedMilestones?.includes('cart_confirmed')) {
            fail(`browser_extension_cart_recovery_not_verified:${JSON.stringify({ checkpoint, fulfillment })}`);
          }
        }
      });
      await runRecoveryScenario({
        id: 'browser-smoke-payment-recovery-session',
        startPath: '/checkout/pay-confirm',
        action: {
          id: 'fill-checkout-profile', type: 'fill_checkout_profile', missionAction: 'fill_safe_fields',
          expectedMilestone: 'checkout_profile_verified', primeRequired: true
        },
        checkoutProfile: {
          contactName: 'Test User', streetAddress: '1 Magic City Way', shippingCity: 'San Francisco',
          shippingState: 'CA', zipCode: '94107', contactPhone: '4155550100',
          billingStreetAddress: '99 Billing Plaza', billingZipCode: '10001', paymentCardLast4: '6383'
        },
        assertCheckpoint: (checkpoint) => {
          if (checkpoint?.browser?.runnerStep?.recoveredFromInterruption !== true
            || !checkpoint?.verifiedMilestones?.includes('checkout_profile_verified')) {
            fail(`browser_extension_payment_recovery_not_verified:${JSON.stringify({ checkpoint, fulfillment })}`);
          }
        }
      });
      await runRecoveryScenario({
        id: 'browser-smoke-checkout-recovery-session',
        startPath: '/checkout/p/p-106-7044535-6467434/spc?pipelineType=Chewbacca&referrer=spc',
        action: {
          id: 'open-checkout', type: 'click_intent', missionAction: 'browser_click', intent: 'checkout',
          expectedMilestone: 'checkout_open'
        },
        assertCheckpoint: (checkpoint) => {
          if (checkpoint?.browser?.runnerStep?.recoveredFromInterruption !== true
            || !checkpoint?.verifiedMilestones?.includes('checkout_open')) {
            fail(`browser_extension_checkout_recovery_not_verified:${JSON.stringify({ checkpoint, fulfillment })}`);
          }
        }
      });
      await runRecoveryScenario({
        id: 'browser-smoke-final-recovery-session',
        startPath: '/checkout/order-confirmation',
        action: {
          id: 'submit-final-order', type: 'final_submit', missionAction: 'final_submit', autoSubmitAfterVerifiedCheckout: true,
          expectedMilestone: 'final_submit_requested', maxPrice: 4
        },
        assertCheckpoint: (checkpoint) => {
          if (checkpoint?.browser?.runnerStep?.recoveredFromInterruption !== true
            || checkpoint?.browser?.finalSubmitRequested !== true
            || checkpoint?.browser?.orderSubmitted !== true
            || !checkpoint?.verifiedMilestones?.includes('final_submit_requested')) {
            fail(`browser_extension_final_recovery_not_verified:${JSON.stringify({ checkpoint, fulfillment })}`);
          }
        }
      });
      recordPurchaseScenario('Forced MV3 restart recovers cart, checkout, payment confirmation, and final-order mutations', { scenarios: 4 });
      console.log(JSON.stringify({ amazonPurchaseSimulations: purchaseScenarioResults.length, scenarios: purchaseScenarioResults }, null, 2));
      console.log('native-runner focused recovery smoke passed');
      return;
    }
    const commandPage = async (page, message) => {
      const tab = await worker.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({});
        return tabs.find((candidate) => candidate.url === url) || null;
      }, page.url());
      if (!tab?.id) fail(`browser_extension_policy_test_tab_missing:${page.url()}`);
      return worker.evaluate(async ({ tabId, payload }) => {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['executor.js'] });
        return chrome.tabs.sendMessage(tabId, payload);
      }, { tabId: tab.id, payload: message });
    };
    const signedOutPage = await context.newPage();
    await signedOutPage.goto(`${baseUrl}/signed-out-search`);
    const signedOutState = await commandPage(signedOutPage, { type: 'MAGIC_CITY_BROWSER_STATE' });
    if (signedOutState.amazonAccountState !== 'signed_out' || signedOutState.loginRequired !== true) {
      fail(`browser_extension_did_not_fail_closed_for_signed_out_amazon:${JSON.stringify(signedOutState)}`);
    }
    recordPurchaseScenario('signed-out Amazon account stops before purchase work', {
      state: signedOutState.amazonAccountState
    });
    await signedOutPage.close();

    const freeShippingPage = await context.newPage();
    await freeShippingPage.goto(`${baseUrl}/free-shipping-search`);
    const fallbackAction = await commandPage(freeShippingPage, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'click_intent', intent: 'prefer_free_delivery', fulfillmentPolicy: 'amazon_free_shipping_preferred', primeRequired: true }
    });
    if (!fallbackAction.completed || fallbackAction.fulfillmentFilter !== 'prime_unavailable') {
      fail(`browser_extension_prime_only_mission_fell_back_to_free_shipping:${JSON.stringify(fallbackAction)}`);
    }
    const freeShippingState = await commandPage(freeShippingPage, { type: 'MAGIC_CITY_BROWSER_STATE' });
    if (freeShippingState.amazonFulfillmentFilterSelected === 'free_shipping') {
      fail(`browser_extension_prime_only_selected_generic_free_shipping:${JSON.stringify(freeShippingState)}`);
    }
    recordPurchaseScenario('Prime-only mission does not silently use generic free-shipping filter', {
      selectedFilter: freeShippingState.amazonFulfillmentFilterSelected || 'none'
    });
    await freeShippingPage.close();

    const directResultCartPage = await context.newPage();
    await directResultCartPage.goto(`${baseUrl}/direct-result-cart-search`);
    const directResultSelection = await commandPage(directResultCartPage, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: {
        type: 'select_candidate',
        query: 'nature valley granola bars',
        maxPrice: 4,
        candidatePolicy: 'price_quality_delivery_preference',
        fulfillmentPolicy: 'amazon_free_shipping_preferred',
        primeRequired: true
      }
    });
    if (!directResultSelection?.completed
      || directResultSelection.navigationRequested !== false
      || directResultSelection.directCartControlAvailable !== true
      || directResultSelection.directSearchResultCart !== true
      || !/Nature Valley/i.test(String(directResultSelection.selected?.title || ''))) {
      fail(`browser_extension_direct_result_cart_candidate_not_selected:${JSON.stringify(directResultSelection)}`);
    }
    const directResultStateAfterSelection = await commandPage(directResultCartPage, { type: 'MAGIC_CITY_BROWSER_STATE' });
    if (Number(directResultStateAfterSelection.checkoutSummary?.cartItemCount || 0) !== 1) {
      fail(`browser_extension_direct_result_selection_did_not_add_exact_card:${JSON.stringify(directResultStateAfterSelection)}`);
    }
    const directResultCartAction = await commandPage(directResultCartPage, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: {
        type: 'click_intent',
        intent: 'add_to_cart',
        boundCandidate: directResultSelection.selected,
        fulfillmentPolicy: 'amazon_free_shipping_preferred',
        primeRequired: true
      }
    });
    const directResultCartState = await commandPage(directResultCartPage, { type: 'MAGIC_CITY_BROWSER_STATE' });
    if (!directResultCartAction?.completed
      || directResultCartAction.directSearchResultCart !== true
      || directResultCartAction.alreadyStarted !== true
      || Number(directResultCartState.checkoutSummary?.cartItemCount || 0) !== 1
      || directResultCartPage.url().includes('/dp/')) {
      fail(`browser_extension_direct_result_card_add_to_cart_failed:${JSON.stringify({
        action: directResultCartAction,
        state: directResultCartState,
        url: directResultCartPage.url()
      })}`);
    }
    recordPurchaseScenario('Visible Prime search result is selected and added atomically without a duplicate', {
      title: directResultSelection.selected?.title,
      cartCount: directResultCartState.checkoutSummary?.cartItemCount
    });
    const directResultOpenCartAction = await commandPage(directResultCartPage, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'navigate', intent: 'open_cart', preferExistingCartControl: true }
    });
    await directResultCartPage.waitForURL(/\/cart\?source=side-cart/);
    if (!directResultOpenCartAction?.completed || directResultOpenCartAction?.controlStrategy !== 'amazon_side_cart') {
      fail(`browser_extension_side_cart_transition_failed:${JSON.stringify(directResultOpenCartAction)}`);
    }
    recordPurchaseScenario('Visible side-cart Go to Cart is preferred over generic navigation', {
      strategy: directResultOpenCartAction.controlStrategy
    });
    await directResultCartPage.close();

    const headerCartPage = await context.newPage();
    await headerCartPage.goto(`${baseUrl}/header-cart-search`);
    const headerCartAction = await commandPage(headerCartPage, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'navigate', intent: 'open_cart', preferExistingCartControl: true }
    });
    await headerCartPage.waitForURL(/\/cart\?source=header-cart/);
    if (!headerCartAction?.completed || headerCartAction?.controlStrategy !== 'amazon_header_cart') {
      fail(`browser_extension_header_cart_transition_failed:${JSON.stringify(headerCartAction)}`);
    }
    recordPurchaseScenario('Header cart is used when no side-cart action is visible', {
      strategy: headerCartAction.controlStrategy
    });
    await headerCartPage.close();

    const postAddConfirmationPage = await context.newPage();
    await postAddConfirmationPage.goto(`${baseUrl}/post-add-confirmation`);
    const postAddCartAction = await commandPage(postAddConfirmationPage, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'navigate', intent: 'open_cart', preferExistingCartControl: true }
    });
    await postAddConfirmationPage.waitForURL(/\/cart\?source=post-add-confirmation/, { timeout: 5_000 }).catch(() => null);
    if (!postAddCartAction?.completed
      || postAddCartAction?.controlStrategy !== 'amazon_post_add_go_to_cart'
      || !/\/cart\?source=post-add-confirmation/.test(postAddConfirmationPage.url())
      || postAddConfirmationPage.url().includes('/checkout/')) {
      fail(`browser_extension_post_add_confirmation_transition_failed:${JSON.stringify({
        action: postAddCartAction,
        url: postAddConfirmationPage.url()
      })}`);
    }
    recordPurchaseScenario('Full-page Added to cart confirmation enters the cart before checkout', {
      strategy: postAddCartAction.controlStrategy,
      url: postAddConfirmationPage.url()
    });
    await postAddConfirmationPage.close();

    const cartProceedPage = await context.newPage();
    await cartProceedPage.goto(`${baseUrl}/gp/cart/view.html`);
    const cartProceedState = await commandPage(cartProceedPage, { type: 'MAGIC_CITY_BROWSER_STATE' });
    if (cartProceedState?.browserState !== 'cart'
      || Number(cartProceedState.checkoutSummary?.cartItemCount || 0) !== 1
      || !cartProceedState.checkoutSummary?.availableActions?.some((label) => /proceed to checkout/i.test(String(label)))) {
      fail(`browser_extension_cart_fast_state_not_ready_for_checkout:${JSON.stringify(cartProceedState)}`);
    }
    const cartProceedAction = await commandPage(cartProceedPage, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: {
        type: 'click_intent',
        intent: 'checkout',
        fulfillmentPolicy: 'amazon_free_shipping_preferred',
        primeRequired: true,
        expectedMilestone: 'checkout_open'
      }
    });
    await cartProceedPage.waitForURL(/\/checkout\//, { timeout: 5_000 }).catch(() => null);
    if (!cartProceedAction?.completed
      || cartProceedAction.cartCheckoutStarted !== true
      || !/proceed to checkout/i.test(String(cartProceedAction.label || ''))
      || !cartProceedPage.url().includes('/checkout/')) {
      fail(`browser_extension_cart_proceed_to_checkout_failed:${JSON.stringify({
        action: cartProceedAction,
        url: cartProceedPage.url()
      })}`);
    }
    recordPurchaseScenario('Cart page clicks Proceed to checkout directly', {
      strategy: cartProceedAction.controlStrategy,
      url: cartProceedPage.url()
    });
    await cartProceedPage.close();

    const checkoutInterstitialPage = await context.newPage();
    await checkoutInterstitialPage.goto(`${baseUrl}/alm/byg?pipelineType=Chewbacca&referrer=cart`);
    const checkoutInterstitialAction = await commandPage(checkoutInterstitialPage, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'click_intent', intent: 'checkout', fulfillmentPolicy: 'amazon_free_shipping_preferred' }
    });
    if (checkoutInterstitialAction?.completed !== false || checkoutInterstitialAction?.localMarketBlocked !== true) {
      fail('browser_extension_did_not_block_amazon_local_market:' + JSON.stringify(checkoutInterstitialAction));
    }
    recordPurchaseScenario('Amazon Local Market checkout prelude is blocked under Prime-only policy', {
      path: '/alm/byg'
    });
   await checkoutInterstitialPage.close();

    const thirdPartyProductPage = await context.newPage();
    await thirdPartyProductPage.goto(`${baseUrl}/dp/nature-valley-local-market`);
    const thirdPartyProductAction = await commandPage(thirdPartyProductPage, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'click_intent', intent: 'add_to_cart', fulfillmentPolicy: 'amazon_free_shipping_preferred' }
    });
    if (thirdPartyProductAction?.completed !== false || !/third-party seller/i.test(String(thirdPartyProductAction?.reason || ''))) {
      fail('browser_extension_did_not_block_third_party_product:' + JSON.stringify(thirdPartyProductAction));
    }
    recordPurchaseScenario('Third-party product page is blocked before cart add', {
      path: '/dp/nature-valley-local-market'
    });
    await thirdPartyProductPage.close();

   await worker.evaluate(() => chrome.storage.local.set({
      localCheckoutProfiles: {
        'browser-smoke-session': {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          profile: {
            contactName: 'Test User',
            streetAddress: '1 Magic City Way',
            shippingCity: 'San Francisco',
            shippingState: 'CA',
            zipCode: '94107',
            contactPhone: '4155550100',
            billingStreetAddress: '99 Billing Plaza',
            billingZipCode: '10001',
            paymentCardLast4: '6383'
          }
        }
      }
    }));

    const paymentConfirmPage = await context.newPage();
    await paymentConfirmPage.goto(`${baseUrl}/checkout/pay-confirm`);
    const paymentConfirmAction = await commandPage(paymentConfirmPage, {
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: {
        contactName: 'Test User',
        streetAddress: '1 Magic City Way',
        shippingCity: 'San Francisco',
        shippingState: 'CA',
        zipCode: '94107',
        contactPhone: '4155550100',
        billingStreetAddress: '99 Billing Plaza',
        billingZipCode: '10001',
        paymentCardLast4: '6383'
      }
    });
    await paymentConfirmPage.waitForURL(/\/checkout\/final-review/, { timeout: 5_000 }).catch(() => null);
    if (!paymentConfirmAction?.completed
      || !/use this payment method/i.test(String(paymentConfirmAction.label || ''))
      || !paymentConfirmPage.url().includes('/checkout/final-review')) {
      fail(`browser_extension_did_not_confirm_already_selected_payment_method:${JSON.stringify({
        action: paymentConfirmAction,
        url: paymentConfirmPage.url()
      })}`);
    }
    recordPurchaseScenario('Already-selected matching payment card clicks Use this payment method', {
      label: paymentConfirmAction.label
    });
    await paymentConfirmPage.close();

    await popup.close();
    const externalWakePage = await context.newPage();
    await externalWakePage.goto(`${baseUrl}/external-wake`);
    const cdp = await context.newCDPSession(externalWakePage);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    const externalWakePromise = externalWakePage.evaluate(({ extensionId: targetExtensionId, sessionId }) => new Promise((resolve) => {
      const startedAt = performance.now();
      chrome.runtime.sendMessage(targetExtensionId, {
        type: 'RUN_PENDING_SESSIONS',
        sessionId
      }, (response) => {
        resolve({
          response,
          error: chrome.runtime.lastError?.message || '',
          elapsedMs: performance.now() - startedAt
        });
      });
    }), { extensionId, sessionId: session.id });
    const initialWakeState = await Promise.race([
      externalWakePromise,
      new Promise((resolve) => setTimeout(() => resolve({ pending: true }), 2_000))
    ]);
    // The extension must keep the MV3 external event alive until it has
    // claimed the exact mission. An early accepted response followed by a
    // detached promise is the production regression this test protects.
    if (!initialWakeState?.pending) {
      fail(`browser_extension_external_wake_replied_before_claim:${JSON.stringify(initialWakeState)}`);
    }
    await waitFor(() => claimedSessionIds.length > 0, 5_000);
    if (claimedSessionIds[0] !== session.id) {
      fail(`browser_extension_claimed_wrong_queued_session:${JSON.stringify(claimedSessionIds)}`);
    }
    try {
      await waitFor(() => Boolean(fulfillment), 40_000);
    } catch (error) {
      const diagnosticPage = await context.newPage();
      await diagnosticPage.goto(`chrome-extension://${extensionId}/popup.html`);
      const runnerState = await diagnosticPage.evaluate(() => new Promise((resolve) => {
        chrome.storage.local.get(['lastError', 'lastExecution', 'activeSessionId', 'explicitWakeSessionId'], resolve);
      }));
      await diagnosticPage.close();
      fail(`browser_extension_smoke_timeout:steps=${checkpoints.map((checkpoint) => checkpoint.planActionId).join(',')}:last_error=${runnerState.lastError || 'none'}:last_execution=${runnerState.lastExecution?.status || 'none'}`);
    }
    const externalWake = await externalWakePromise;
    if (externalWake.error || !externalWake.response?.ok || !externalWake.response?.result?.requestedSessionFound) {
      fail(`browser_extension_external_wake_failed:${JSON.stringify(externalWake)}`);
    }
    if (externalWake.response.result.requestedSessionId !== session.id) {
      fail(`browser_extension_external_wake_wrong_session:${JSON.stringify(externalWake)}`);
    }
    recordPurchaseScenario('Cold external website wake stays alive through exact mission claim', {
      sessionId: session.id,
      queuedSessions: 2,
      completionMs: Math.round(externalWake.elapsedMs)
    });

    popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    // The service worker was deliberately stopped above. Use a fresh extension
    // page to wake the worker and expose Chrome APIs for the retained-tab test.
    worker = popup;

    // A retained Amazon tab is allowed to already be on the approved target.
    // This guards the production failure where open-site reloaded the same URL
    // and then waited for an event that Chrome had already emitted.
    const retainedTargetPage = await context.newPage();
    await retainedTargetPage.goto(`${baseUrl}/search`);
    const retainedTargetTab = await worker.evaluate((url) => chrome.tabs.query({}).then((tabs) =>
      tabs.find((candidate) => candidate.url === url) || null), retainedTargetPage.url());
    if (!retainedTargetTab?.id) fail(`browser_extension_same_url_tab_missing:${retainedTargetPage.url()}`);
    const sameUrlSessionId = 'browser-smoke-same-url-session';
    const sameUrlPlan = rehashExtensionPlan({
      ...plan,
      planId: 'mplan_browser-smoke-same-url-session',
      startUrl: retainedTargetPage.url(),
      actions: [{
        ...plan.actions[0],
        id: 'open-site',
        url: retainedTargetPage.url(),
        missionAction: 'browser_open'
      }]
    });
    const primaryCheckpoints = checkpoints.slice();
    const primaryFulfillment = fulfillment;
    const primarySession = session;
    const primaryDistractorSession = distractorSession;
    checkpoints.length = 0;
    fulfillment = null;
    session = {
      ...session,
      id: sameUrlSessionId,
      status: 'queued',
      claimedByPluginId: null,
      fulfillment: null,
      missionBoundAuth: {
        ...session.missionBoundAuth,
        subject: { sessionId: sameUrlSessionId }
      },
      extensionMissionPlan: sameUrlPlan,
      extensionMissionPlanState: { planHash: sameUrlPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(({ sessionId, tabId }) => new Promise((resolve) => {
      chrome.storage.local.get(['activeMissionTabs'], (stored) => {
        chrome.storage.local.set({
          activeMissionTabs: { ...(stored.activeMissionTabs || {}), [sessionId]: tabId }
        }, resolve);
      });
    }), { sessionId: sameUrlSessionId, tabId: retainedTargetTab.id });
    const sameUrlWake = await popup.evaluate((sessionId) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RUN_PENDING_SESSIONS', sessionId }, resolve);
    }), sameUrlSessionId);
    if (!sameUrlWake?.ok) fail(`browser_extension_same_url_wake_failed:${sameUrlWake?.error || 'no_response'}`);
    try {
      await waitFor(() => Boolean(fulfillment), 15_000);
    } catch {
      const diagnosticPage = await context.newPage();
      await diagnosticPage.goto(`chrome-extension://${extensionId}/popup.html`);
      const runnerState = await diagnosticPage.evaluate(() => new Promise((resolve) => {
        chrome.storage.local.get(['lastError', 'lastExecution', 'activeSessionId', 'explicitWakeSessionId'], resolve);
      }));
      await diagnosticPage.close();
      fail(`browser_extension_same_url_timeout:steps=${checkpoints.map((checkpoint) => checkpoint.planActionId).join(',')}:last_error=${runnerState.lastError || 'none'}:last_execution=${runnerState.lastExecution?.status || 'none'}:active=${runnerState.activeSessionId || 'none'}:wake=${runnerState.explicitWakeSessionId || 'none'}`);
    }
    // This fixture intentionally contains only the open-site action. The
    // runner must record that action and then stop at the normal handoff
    // boundary; it should not pretend a one-step plan placed an order.
    if (fulfillment.status !== 'failed'
      || fulfillment.result?.browserExecution?.stopState !== 'handoff_ready'
      || checkpoints[0]?.planActionId !== 'open-site') {
      fail(`browser_extension_same_url_not_idempotent:${JSON.stringify({ fulfillment, checkpoints })}`);
    }
    recordPurchaseScenario('Retained tab on the approved URL completes open-site idempotently', {
      url: retainedTargetPage.url(),
      steps: checkpoints.map((checkpoint) => checkpoint.planActionId),
      stopState: fulfillment.result?.browserExecution?.stopState
    });

    // Simulate an MV3 worker suspension immediately after Amazon accepted an
    // add-to-cart click. The persisted candidate identity must let the resumed
    // worker verify the cart and checkpoint the existing mutation, never click
    // Add to cart a second time.
    const recoveredCartSessionId = 'browser-smoke-cart-recovery-session';
    const recoveredCartPlan = rehashExtensionPlan({
      ...plan,
      planId: 'mplan_browser-smoke-cart-recovery-session',
      startUrl: `${baseUrl}/cart`,
      actions: [
        {
          id: 'prepare-cart',
          type: 'click_intent',
          missionAction: 'prepare_cart',
          intent: 'add_to_cart',
          query: 'test gadget',
          requiredBasketItem: true,
          expectedMilestone: 'cart_confirmed',
          expectedCartItemCount: 1,
          maxPrice: 4
        },
        { id: 'pause-for-user', type: 'pause', missionAction: 'handoff', reason: 'cart_recovered' }
      ]
    });
    checkpoints.length = 0;
    fulfillment = null;
    await retainedTargetPage.goto(`${baseUrl}/cart`);
    const recoveredCartTab = await worker.evaluate((url) => chrome.tabs.query({}).then((tabs) =>
      tabs.find((candidate) => candidate.url === url) || null), retainedTargetPage.url());
    if (!recoveredCartTab?.id) fail('browser_extension_cart_recovery_tab_missing');
    session = {
      ...session,
      id: recoveredCartSessionId,
      status: 'claimed',
      claimedByPluginId: 'magic-city-runner-extension',
      fulfillment: null,
      missionBoundAuth: {
        ...session.missionBoundAuth,
        subject: { sessionId: recoveredCartSessionId }
      },
      extensionMissionPlan: recoveredCartPlan,
      extensionMissionPlanState: { planHash: recoveredCartPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(({ sessionId, tabId, planHash }) => new Promise((resolve) => {
      chrome.storage.local.get(['activeMissionTabs'], (stored) => {
        chrome.storage.local.set({
          activeMissionTabs: { ...(stored.activeMissionTabs || {}), [sessionId]: tabId },
          activeSessionId: sessionId,
          activeRun: {
            sessionId,
            planHash,
            phase: 'executing_step',
            tabId,
            actionId: 'prepare-cart',
            actionIndex: 0,
            nextActionIndex: 0,
            selectedCandidate: { title: 'Test Gadget', asin: 'BROWSER-SMOKE-ASIN', price: 3.5 },
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }, () => {
          chrome.alarms.create('magic-city-runner-resume', { when: Date.now() + 500 });
          resolve();
        });
      });
    }), { sessionId: recoveredCartSessionId, tabId: recoveredCartTab.id, planHash: recoveredCartPlan.planHash });
    const cartRecoveryCdp = await context.newCDPSession(retainedTargetPage);
    await cartRecoveryCdp.send('ServiceWorker.enable');
    await cartRecoveryCdp.send('ServiceWorker.stopAllWorkers');
    try {
      await waitFor(() => Boolean(fulfillment), 20_000);
    } catch {
      fail(`browser_extension_cart_recovery_timeout:${JSON.stringify(await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['lastError', 'lastExecution', 'activeRun'], resolve))))}`);
    }
    const recoveredCartCheckpoint = checkpoints.find((checkpoint) => checkpoint.planActionId === 'prepare-cart');
    if (recoveredCartCheckpoint?.browser?.runnerStep?.recoveredFromInterruption !== true
      || !Array.isArray(recoveredCartCheckpoint?.verifiedMilestones)
      || !recoveredCartCheckpoint.verifiedMilestones.includes('cart_confirmed')) {
      fail(`browser_extension_cart_recovery_not_verified:${JSON.stringify({ fulfillment, checkpoints })}`);
    }
    recordPurchaseScenario('MV3 restart after cart mutation verifies the bound cart item without replay', {
      recovered: recoveredCartCheckpoint.browser.runnerStep.recoveredFromInterruption,
      milestones: recoveredCartCheckpoint.verifiedMilestones
    });

    // The final-order equivalent is just as important: once the merchant has
    // confirmed an order, a resumed worker must preserve that fact rather than
    // retrying a no-longer-visible purchase control.
    const recoveredFinalSessionId = 'browser-smoke-final-recovery-session';
    const recoveredFinalPlan = rehashExtensionPlan({
      ...plan,
      planId: 'mplan_browser-smoke-final-recovery-session',
      startUrl: `${baseUrl}/checkout/order-confirmation`,
      limits: { ...plan.limits, stopBeforeFinalSubmit: false },
      actions: [
        {
          id: 'submit-final-order',
          type: 'final_submit',
          missionAction: 'final_submit',
          autoSubmitAfterVerifiedCheckout: true,
          expectedMilestone: 'final_submit_requested',
          maxPrice: 4
        },
        { id: 'pause-for-user', type: 'pause', missionAction: 'handoff', reason: 'order_confirmed' }
      ]
    });
    checkpoints.length = 0;
    fulfillment = null;
    await retainedTargetPage.goto(`${baseUrl}/checkout/order-confirmation`);
    const recoveredFinalTab = await worker.evaluate((url) => chrome.tabs.query({}).then((tabs) =>
      tabs.find((candidate) => candidate.url === url) || null), retainedTargetPage.url());
    if (!recoveredFinalTab?.id) fail('browser_extension_final_recovery_tab_missing');
    session = {
      ...session,
      id: recoveredFinalSessionId,
      status: 'claimed',
      claimedByPluginId: 'magic-city-runner-extension',
      fulfillment: null,
      missionBoundAuth: {
        ...session.missionBoundAuth,
        subject: { sessionId: recoveredFinalSessionId }
      },
      extensionMissionPlan: recoveredFinalPlan,
      extensionMissionPlanState: { planHash: recoveredFinalPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(({ sessionId, tabId, planHash }) => new Promise((resolve) => {
      chrome.storage.local.get(['activeMissionTabs'], (stored) => {
        chrome.storage.local.set({
          activeMissionTabs: { ...(stored.activeMissionTabs || {}), [sessionId]: tabId },
          activeSessionId: sessionId,
          activeRun: {
            sessionId,
            planHash,
            phase: 'executing_step',
            tabId,
            actionId: 'submit-final-order',
            actionIndex: 0,
            nextActionIndex: 0,
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        }, () => {
          chrome.alarms.create('magic-city-runner-resume', { when: Date.now() + 500 });
          resolve();
        });
      });
    }), { sessionId: recoveredFinalSessionId, tabId: recoveredFinalTab.id, planHash: recoveredFinalPlan.planHash });
    const finalRecoveryCdp = await context.newCDPSession(retainedTargetPage);
    await finalRecoveryCdp.send('ServiceWorker.enable');
    await finalRecoveryCdp.send('ServiceWorker.stopAllWorkers');
    try {
      await waitFor(() => Boolean(fulfillment), 20_000);
    } catch {
      fail(`browser_extension_final_recovery_timeout:${JSON.stringify(await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['lastError', 'lastExecution', 'activeRun'], resolve))))}`);
    }
    const recoveredFinalCheckpoint = checkpoints.find((checkpoint) => checkpoint.planActionId === 'submit-final-order');
    if (recoveredFinalCheckpoint?.browser?.runnerStep?.recoveredFromInterruption !== true
      || recoveredFinalCheckpoint?.browser?.finalSubmitRequested !== true
      || recoveredFinalCheckpoint?.browser?.orderSubmitted !== true
      || !recoveredFinalCheckpoint?.verifiedMilestones?.includes('final_submit_requested')) {
      fail(`browser_extension_final_recovery_not_verified:${JSON.stringify({ fulfillment, checkpoints })}`);
    }
    recordPurchaseScenario('MV3 restart after merchant order confirmation preserves final-submit proof', {
      recovered: recoveredFinalCheckpoint.browser.runnerStep.recoveredFromInterruption,
      orderSubmitted: recoveredFinalCheckpoint.browser.orderSubmitted
    });

    await retainedTargetPage.close();
    await externalWakePage.close();
    checkpoints.splice(0, checkpoints.length, ...primaryCheckpoints);
    fulfillment = primaryFulfillment;
    session = primarySession;
    distractorSession = primaryDistractorSession;

    const completedIds = checkpoints
      .filter((checkpoint) => checkpoint.planActionStatus !== 'waiting')
      .map((checkpoint) => checkpoint.planActionId);
    const completedPlanPrefix = plan.actions
      .slice(0, completedIds.length)
      .map((action) => action.id);
    if (JSON.stringify(completedIds) !== JSON.stringify(completedPlanPrefix)) {
      fail(`browser_extension_skipped_plan_action:${JSON.stringify({ completedIds, completedPlanPrefix })}`);
    }
    if (transientRunnerStatusFailureCount !== 3) {
      fail(`browser_extension_transient_runner_status_not_exercised:${transientRunnerStatusFailureCount}:steps=${checkpoints.map((checkpoint) => checkpoint.planActionId).join(',')}:fulfillment=${JSON.stringify(fulfillment)}`);
    }
    const inspectCartCheckpoint = checkpoints.find((checkpoint) => checkpoint.planActionId === 'inspect-cart');
    if (inspectCartCheckpoint?.browser?.checkoutSummary?.stage !== 'cart') {
      fail(`browser_extension_cart_promo_misclassified:${JSON.stringify({
        stage: inspectCartCheckpoint?.browser?.checkoutSummary?.stage || null,
        optionalOfferVisible: inspectCartCheckpoint?.browser?.optionalOfferVisible || false,
        nextAction: inspectCartCheckpoint?.browser?.checkoutSummary?.nextAction || null,
        availableActions: inspectCartCheckpoint?.browser?.checkoutSummary?.availableActions || []
      })}`);
    }
    const openCheckoutCheckpoint = checkpoints.find((checkpoint) => checkpoint.planActionId === 'open-checkout');
    if (openCheckoutCheckpoint?.browser?.runnerStep?.checkoutPreludeRecovered !== true) {
      fail(`browser_extension_checkout_prelude_not_recovered:${JSON.stringify({
        url: openCheckoutCheckpoint?.browser?.url || null,
        finalUrl: openCheckoutCheckpoint?.browser?.finalUrl || null,
        stage: openCheckoutCheckpoint?.browser?.checkoutSummary?.stage || null,
        runnerStep: openCheckoutCheckpoint?.browser?.runnerStep || null
      })}`);
    }
    const deliveryFilterCheckpoint = checkpoints.find((checkpoint) => checkpoint.planActionId === 'prefer-delivery-filter');
    if (deliveryFilterCheckpoint?.browser?.checkoutSummary?.stage !== 'search_results') {
      fail(`browser_extension_search_header_promo_misclassified:${JSON.stringify({
        stage: deliveryFilterCheckpoint?.browser?.checkoutSummary?.stage || null,
        optionalOfferVisible: deliveryFilterCheckpoint?.browser?.optionalOfferVisible || false,
        candidates: deliveryFilterCheckpoint?.browser?.candidates || []
      })}`);
    }
    if (Number(deliveryFilterCheckpoint?.browser?.observationDurationMs || 0) > 2500) {
      fail(`browser_extension_catalog_observation_too_slow:${deliveryFilterCheckpoint.browser.observationDurationMs}ms`);
    }
    if (deliveryFilterCheckpoint?.planActionStatus !== 'completed'
      || deliveryFilterCheckpoint?.browser?.amazonAccountState !== 'signed_in'
      || deliveryFilterCheckpoint?.browser?.amazonFulfillmentFilterSelected !== 'prime') {
      fail(`browser_extension_did_not_apply_signed_in_prime_filter:${JSON.stringify({
        status: deliveryFilterCheckpoint?.planActionStatus || null,
        account: deliveryFilterCheckpoint?.browser?.amazonAccountState || null,
        available: deliveryFilterCheckpoint?.browser?.amazonFulfillmentFilterAvailable || null,
        selected: deliveryFilterCheckpoint?.browser?.amazonFulfillmentFilterSelected || null
      })}`);
    }
    const selectedMatchCheckpoint = checkpoints.find((checkpoint) => checkpoint.planActionId === 'select-match');
    if (selectedMatchCheckpoint?.planActionStatus !== 'completed') {
      fail(`browser_extension_amazon_result_not_selected:${JSON.stringify({
        status: selectedMatchCheckpoint?.planActionStatus || null,
        detail: selectedMatchCheckpoint?.detail || null,
        candidates: deliveryFilterCheckpoint?.browser?.candidates || []
      })}`);
    }
    if (selectedMatchCheckpoint?.browser?.runnerStep?.directSearchResultCart !== true
      || !['amazon_search_card_fast_path', 'selected_search_result'].includes(selectedMatchCheckpoint?.browser?.runnerStep?.controlStrategy)) {
      fail(`browser_extension_candidate_direct_cart_not_verified:${JSON.stringify({
        url: selectedMatchCheckpoint?.browser?.url || null,
        navigationConfirmed: selectedMatchCheckpoint?.browser?.runnerStep?.navigationConfirmed ?? null,
        directSearchResultCart: selectedMatchCheckpoint?.browser?.runnerStep?.directSearchResultCart ?? null,
        controlStrategy: selectedMatchCheckpoint?.browser?.runnerStep?.controlStrategy || null,
        requestedNavigationUrl: selectedMatchCheckpoint?.browser?.runnerStep?.requestedNavigationUrl || null,
        observedNavigationUrl: selectedMatchCheckpoint?.browser?.runnerStep?.observedNavigationUrl || null
      })}`);
    }
    if (selectedMatchCheckpoint?.browser?.runnerStep?.postAddCartOpened !== true
      || !selectedMatchCheckpoint?.browser?.runnerStep?.cartOpenControlStrategy) {
      fail(`browser_extension_post_add_cart_not_atomic:${JSON.stringify(selectedMatchCheckpoint?.browser?.runnerStep || {})}`);
    }
    if (fulfillment.result?.browserExecution?.checkoutProgress?.addToCartClicked !== true
      || fulfillment.result?.browserExecution?.checkoutProgress?.checkoutOpened !== true
      || fulfillment.result?.browserExecution?.finalApprovalRequired !== false
      || fulfillment.result?.browserExecution?.orderSubmitted !== true) {
      const currentStorePage = context.pages().find((page) => page.url().startsWith(baseUrl));
      const paymentRadios = currentStorePage ? await currentStorePage.evaluate(() => Array.from(document.querySelectorAll('input[type="radio"]')).map((input) => ({
        checked: input.checked,
        hidden: Boolean(input.closest('[hidden]')),
        text: String(input.labels?.[0]?.textContent || input.closest('label')?.textContent || '').trim()
      }))) : [];
      const addressFixtureState = currentStorePage ? await currentStorePage.evaluate(() => ({
        summary: document.querySelector('#delivery-summary')?.textContent || '',
        optionsHidden: document.querySelector('#address-options')?.hidden,
        newFormHidden: document.querySelector('#new-address-form')?.hidden,
        shippingValues: Array.from(document.querySelectorAll('#new-address-form input, #new-address-form select')).map((field) => ({ label: field.getAttribute('aria-label'), value: field.value }))
      })) : null;
      fail(`browser_extension_auto_submit_not_verified:steps=${JSON.stringify(checkpoints.map((checkpoint) => ({
        id: checkpoint.planActionId,
        status: checkpoint.planActionStatus,
        detail: checkpoint.detail,
        action: checkpoint.browser?.lastRunnerAction,
        selections: checkpoint.browser?.checkoutSelections,
        profileTransitions: checkpoint.browser?.runnerStep?.profileTransitions || []
      })))}:payment_radios=${JSON.stringify(paymentRadios)}:address=${JSON.stringify(addressFixtureState)}:execution=${JSON.stringify(fulfillment.result?.browserExecution || {})}`);
    }
    if (fulfillment.result?.browserExecution?.checkoutSummary?.merchandiseSubtotal !== '$3.50'
      || fulfillment.result?.browserExecution?.checkoutSummary?.shippingTotal !== '$0.00'
      || fulfillment.result?.browserExecution?.checkoutSummary?.likelyTotal !== '$4.15') {
      fail(`browser_extension_did_not_separate_item_budget_from_all_in_total:${JSON.stringify(fulfillment.result?.browserExecution?.checkoutSummary || {})}`);
    }
    const verifiedMilestones = fulfillment.result?.browserExecution?.verifiedMilestones || [];
    for (const milestone of [
      'candidate_selected',
      'cart_confirmed',
      'checkout_open',
      'address_confirmed',
      'card_confirmed',
      'delivery_confirmed',
      'checkout_profile_verified',
      'final_review_ready',
      'final_submit_requested',
      'order_submitted'
    ]) {
      if (!verifiedMilestones.includes(milestone)) {
        fail(`browser_extension_missing_verified_milestone:${milestone}:${JSON.stringify(verifiedMilestones)}`);
      }
    }
    if (fulfillment.result?.browserExecution?.milestoneProtocol !== 'verified-v1') {
      fail('browser_extension_missing_verified_milestone_protocol');
    }
    const productCheckpoint = checkpoints.find((checkpoint) => checkpoint.planActionId === 'select-match');
    if (productCheckpoint?.browser?.runnerStep?.directSearchResultCart !== true
      || !['amazon_search_card_fast_path', 'selected_search_result'].includes(productCheckpoint?.browser?.runnerStep?.controlStrategy)
      || !/test gadget/i.test(String(productCheckpoint?.browser?.runnerStep?.selectedCandidate?.title || ''))) {
      fail(`browser_extension_did_not_use_direct_search_card_receipt:${JSON.stringify({
        runnerStep: productCheckpoint?.browser?.runnerStep || null,
        summary: productCheckpoint?.browser?.checkoutSummary || null
      })}`);
    }
    const cartCheckpoint = checkpoints.find((checkpoint) => checkpoint.planActionId === 'inspect-cart');
    if (cartCheckpoint?.browser?.checkoutSummary?.cartPrimeFreeShippingVerified !== true) {
      fail(`browser_extension_did_not_verify_every_cart_item_prime_eligible:${JSON.stringify(cartCheckpoint?.browser?.checkoutSummary || {})}`);
    }
    const storePage = context.pages().find((page) => page.url().startsWith(baseUrl));
    if (!storePage || !storePage.url().includes('/checkout')) fail('browser_extension_did_not_reach_checkout');
    if (await storePage.locator('#prime-address-modal').count()) {
      fail('browser_extension_did_not_decline_checkout_prime_modal');
    }
    if (await storePage.locator('input[aria-label="Street address"]').inputValue() !== '1 Magic City Way') {
      fail(`browser_extension_did_not_fill_local_checkout_profile:${JSON.stringify({
        street: await storePage.locator('input[aria-label="Street address"]').inputValue(),
        billingStreet: await storePage.locator('input[aria-label="Billing street address"]').inputValue(),
        checkpoints: checkpoints.map((checkpoint) => ({
          id: checkpoint.planActionId,
          status: checkpoint.planActionStatus,
          state: checkpoint.browser?.checkoutSummary?.stage,
          nextAction: checkpoint.browser?.checkoutSummary?.nextAction,
          fields: checkpoint.browser?.safeFieldsFilled,
          selections: checkpoint.browser?.checkoutSelections,
          optionalOfferVisible: checkpoint.browser?.optionalOfferVisible
        })),
        fulfillment: fulfillment.result?.browserExecution
      })}`);
    }
    if (await storePage.locator('input[aria-label="Billing street address"]').inputValue() !== '99 Billing Plaza'
      || await storePage.locator('input[aria-label="Billing ZIP code"]').inputValue() !== '10001') {
      fail('browser_extension_did_not_fill_billing_checkout_profile');
    }
    if (!(await storePage.locator('#delivery-summary').textContent() || '').includes('1 Magic City Way, San Francisco, CA 94107')) {
      fail(`browser_extension_did_not_create_vault_delivery_address:summary=${await storePage.locator('#delivery-summary').textContent()}:steps=${JSON.stringify(checkpoints.map((checkpoint) => ({
        id: checkpoint.planActionId,
        status: checkpoint.planActionStatus,
        state: checkpoint.browser?.checkoutSummary?.stage,
        selections: checkpoint.browser?.checkoutSelections,
        summary: checkpoint.browser?.checkoutSummary
      })))}:profile=${JSON.stringify({
        expected: fulfillment.result?.browserExecution?.localCheckoutProfileExpected,
        available: fulfillment.result?.browserExecution?.localCheckoutProfileAvailable
      })}:selections=${JSON.stringify(fulfillment.result?.browserExecution?.checkoutSelections || [])}:summary=${JSON.stringify(fulfillment.result?.browserExecution?.checkoutSummary || {})}`);
    }
    if (!await storePage.locator('input[name="payment"]').nth(2).isChecked()) {
      const paymentState = await storePage.locator('input[name="payment"]').evaluateAll((inputs) => inputs.map((input) => ({
        checked: input.checked,
        visible: Boolean(input.offsetWidth || input.offsetHeight || input.getClientRects().length),
        text: input.closest('label')?.innerText || ''
      })));
      fail(`browser_extension_did_not_select_matching_card:${JSON.stringify(paymentState)}:selections=${JSON.stringify(fulfillment.result?.browserExecution?.checkoutSelections || [])}:summary=${JSON.stringify(fulfillment.result?.browserExecution?.checkoutSummary || {})}`);
    }
    if (!(await storePage.locator('#payment-summary').textContent() || '').includes('6383')
      || !await storePage.locator('#payment-options').isHidden()) {
      fail(`browser_extension_did_not_confirm_matching_saved_payment_method:${JSON.stringify({
        summary: await storePage.locator('#payment-summary').textContent(),
        optionsHidden: await storePage.locator('#payment-options').isHidden(),
        useButtonVisible: await storePage.locator('#use-payment-method').isVisible(),
        checkedCards: await storePage.locator('input[name="payment"]:checked').evaluateAll((inputs) => inputs.map((input) => input.closest('label')?.innerText || '')),
        steps: checkpoints.map((checkpoint) => ({
          id: checkpoint.planActionId,
          label: checkpoint.browser?.lastRunnerAction || '',
          selections: checkpoint.browser?.checkoutSelections || [],
          transitions: checkpoint.browser?.runnerStep?.profileTransitions || []
        }))
      })}`);
    }
    if (!await storePage.locator('input[name="delivery"]').nth(2).isChecked()) {
      const deliveryState = await storePage.locator('input[name="delivery"]').evaluateAll((inputs) => inputs.map((input) => ({
        checked: input.checked,
        visible: Boolean(input.offsetWidth || input.offsetHeight || input.getClientRects().length),
        text: input.closest('label')?.innerText || ''
      })));
      fail(`browser_extension_did_not_select_fastest_free_delivery:${JSON.stringify(deliveryState)}:selections=${JSON.stringify(fulfillment.result?.browserExecution?.checkoutSelections || [])}:summary=${JSON.stringify(fulfillment.result?.browserExecution?.checkoutSummary || {})}`);
    }
    if (!fulfillment.result?.browserExecution?.safeFieldsFilled?.includes('street address')) {
      fail('browser_extension_did_not_report_safe_checkout_fields');
    }
    if (!fulfillment.result?.browserExecution?.safeFieldsFilled?.includes('billing street address')) {
      fail('browser_extension_did_not_report_billing_checkout_fields');
    }
    const finalStage = fulfillment.result?.browserExecution?.checkoutSummary?.stage || '';
    if (!['checkout', 'final_review', 'payment'].includes(finalStage)) {
      fail('browser_extension_did_not_report_checkout_summary');
    }
    if (fulfillment.result?.browserExecution?.checkoutSummary?.cardMatches !== true) {
      fail('browser_extension_did_not_report_card_match');
    }
    if (!fulfillment.result?.browserExecution?.checkoutSelections?.includes('matching payment card')
      || !fulfillment.result?.browserExecution?.checkoutSelections?.includes('confirm matching payment card')
      || !fulfillment.result?.browserExecution?.checkoutSelections?.includes('confirm vault delivery address')) {
      fail('browser_extension_did_not_report_checkout_option_selection');
    }
    if (!completedIds.includes('submit-final-order') || !/Order placed/i.test(await storePage.locator('#order-result').textContent())) {
      fail('browser_extension_did_not_submit_verified_order');
    }
    const storeTab = (await worker.evaluate(() => chrome.tabs.query({})))
      .find((tab) => String(tab.url || '').startsWith(baseUrl));
    if (!storeTab || storeTab.active) fail('browser_extension_tab_stole_focus');
    recordPurchaseScenario('Single Prime item reaches verified checkout and auto-submits when authorized', {
      merchandiseSubtotal: fulfillment.result?.browserExecution?.checkoutSummary?.merchandiseSubtotal,
      shippingTotal: fulfillment.result?.browserExecution?.checkoutSummary?.shippingTotal,
      orderSubmitted: fulfillment.result?.browserExecution?.orderSubmitted === true
    });

    await Promise.all(context.pages()
      .filter((page) => page.url().startsWith(baseUrl))
      .map((page) => page.close().catch(() => null)));
    checkoutFixture = {
      total: '$3.50',
      itemCount: 1,
      showAddressPrimeModal: false,
      selectedCardLast4: '1817'
    };
    brandCandidateVisits = [];
    brandCartItem = null;
    checkpoints.length = 0;
    fulfillment = null;
    const brandFallbackPlan = buildExtensionPlan({
      id: 'browser-smoke-brand-fallback-session',
      handoffData: { kind: 'browser' },
      selections: {
        targetUrl: `${baseUrl}/brand-search`,
        goal: 'buy nature valley granol abars',
        budget: '$4',
        finalApprovalPolicy: 'auto_submit_after_verified_checkout'
      },
      extensionCheckoutProfileEnabled: true,
      extensionFulfillmentPolicy: 'amazon_free_shipping_preferred',
      extensionPrimeRequired: true
    });
    session = {
      ...session,
      id: 'browser-smoke-brand-fallback-session',
      status: 'queued',
      claimedByPluginId: null,
      extensionMissionPlan: brandFallbackPlan,
      extensionMissionPlanState: { planHash: brandFallbackPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(() => chrome.storage.local.set({
      activeMissionTabs: {},
      localCheckoutProfiles: {
        'browser-smoke-brand-fallback-session': {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          profile: {
            contactName: 'Test User',
            streetAddress: '1 Magic City Way',
            shippingCity: 'San Francisco',
            shippingState: 'CA',
            zipCode: '94107',
            contactPhone: '4155550100',
            billingStreetAddress: '99 Billing Plaza',
            billingZipCode: '10001',
            paymentCardLast4: '1817'
          }
        }
      }
    }));
    const brandFallbackStartResponse = await popup.evaluate((sessionId) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RUN_PENDING_SESSIONS', sessionId }, resolve);
    }), session.id);
    if (!brandFallbackStartResponse?.ok) fail(`browser_extension_brand_fallback_start_failed:${brandFallbackStartResponse?.error || 'no_response'}`);
    try {
      await waitFor(() => Boolean(fulfillment));
    } catch {
      const runnerState = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['lastError', 'lastExecution'], resolve)));
      fail(`browser_extension_brand_fallback_timeout:steps=${checkpoints.map((checkpoint) => checkpoint.planActionId).join(',')}:last_error=${runnerState.lastError || 'none'}`);
    }
    if (fulfillment.status !== 'fulfilled') {
      fail(`browser_extension_brand_fallback_not_fulfilled:${JSON.stringify({
        execution: fulfillment.result?.browserExecution || {},
        steps: checkpoints.map((checkpoint) => ({
          id: checkpoint.planActionId,
          status: checkpoint.planActionStatus,
          control: checkpoint.browser?.runnerStep?.controlStrategy,
          directCart: checkpoint.browser?.runnerStep?.directSearchResultCart,
          selected: checkpoint.browser?.runnerStep?.selectedCandidate,
          detail: checkpoint.detail
        }))
      })}`);
    }
    if (brandCandidateVisits.includes('nutri-grain-decoy')) {
      fail(`browser_extension_selected_wrong_brand:${JSON.stringify(brandCandidateVisits)}`);
    }
    if (brandCandidateVisits.length) {
      fail(`browser_extension_direct_search_cart_unexpectedly_opened_product_page:${JSON.stringify(brandCandidateVisits)}`);
    }
    const brandFilterCheckpoint = checkpoints.find((checkpoint) => checkpoint.planActionId === 'prefer-delivery-filter');
    if (brandFilterCheckpoint?.browser?.browserState !== 'search_results') {
      fail(`browser_extension_inline_cart_misclassified_search:${JSON.stringify(brandFilterCheckpoint?.browser || {})}`);
    }
    const brandSelectCheckpoint = checkpoints.find((checkpoint) => checkpoint.planActionId === 'select-match');
    if (brandSelectCheckpoint?.planActionStatus !== 'completed' || brandSelectCheckpoint?.browser?.runnerStep?.skipped) {
      fail(`browser_extension_inline_cart_skipped_required_selection:${JSON.stringify(brandSelectCheckpoint || {})}`);
    }
    if (brandSelectCheckpoint?.browser?.runnerStep?.directSearchResultCart !== true
      || brandSelectCheckpoint?.browser?.runnerStep?.controlStrategy !== 'amazon_search_card_fast_path') {
      fail(`browser_extension_selection_did_not_click_bound_result_cart:${JSON.stringify(brandSelectCheckpoint?.browser?.runnerStep || {})}`);
    }
    if (!/Nature Valley Oats n Honey/i.test(String(brandSelectCheckpoint?.browser?.runnerStep?.selectedCandidate?.title || ''))) {
      fail(`browser_extension_direct_search_selection_wrong_candidate:${JSON.stringify(brandSelectCheckpoint?.browser || {})}`);
    }
    if (fulfillment.result?.browserExecution?.checkoutProgress?.addToCartClicked !== true
      || fulfillment.result?.browserExecution?.checkoutProgress?.checkoutOpened !== true) {
      fail(`browser_extension_brand_fallback_did_not_reach_checkout:${JSON.stringify(fulfillment.result?.browserExecution || {})}`);
    }
    const retainedBrandTab = await worker.evaluate((sessionId) => new Promise((resolve) => {
      chrome.storage.local.get(['activeMissionTabs'], (stored) => resolve(stored.activeMissionTabs?.[sessionId] || null));
    }), session.id);
    if (!retainedBrandTab) fail('browser_extension_terminal_handoff_lost_tab_ownership');
    const brandPrepareCart = checkpoints.find((checkpoint) => checkpoint.planActionId === 'prepare-cart');
    const brandOpenCheckout = checkpoints.find((checkpoint) => checkpoint.planActionId === 'open-checkout');
    const reusedPreparedCart = brandPrepareCart?.browser?.runnerStep?.completed === true
      && /already prepared|not adding a duplicate/i.test(String(brandPrepareCart?.browser?.runnerStep?.reason || brandPrepareCart?.detail || ''));
    if (!reusedPreparedCart
      || brandOpenCheckout?.planActionStatus !== 'completed') {
      fail(`browser_extension_direct_search_cart_did_not_use_bound_controls:${JSON.stringify({
        prepareCart: brandPrepareCart?.browser?.runnerStep || null,
        openCheckout: brandOpenCheckout?.browser?.runnerStep || null
      })}`);
    }
    recordPurchaseScenario('Typoed Nature Valley query picks the correct direct Add to Cart result', {
      selectedTitle: brandSelectCheckpoint?.browser?.runnerStep?.selectedCandidate?.title,
      visitedProductPages: brandCandidateVisits.length
    });

    await Promise.all(context.pages()
      .filter((page) => page.url().startsWith(baseUrl))
      .map((page) => page.close().catch(() => null)));
    checkoutFixture = {
      total: '$3.50',
      itemCount: 1,
      showAddressPrimeModal: false,
      selectedCardLast4: '1817'
    };
    conditionalCandidateVisits = [];
    brandCartItem = null;
    checkpoints.length = 0;
    fulfillment = null;
    const conditionalShippingPlan = buildExtensionPlan({
      id: 'browser-smoke-conditional-prime-shipping-session',
      handoffData: { kind: 'browser' },
      selections: {
        targetUrl: `${baseUrl}/conditional-shipping-search`,
        goal: 'buy nature valley almond granola bars',
        budget: '$4',
        finalApprovalPolicy: 'auto_submit_after_verified_checkout'
      },
      extensionCheckoutProfileEnabled: true,
      extensionFulfillmentPolicy: 'amazon_free_shipping_preferred',
      extensionPrimeRequired: true
    });
    session = {
      ...session,
      id: 'browser-smoke-conditional-prime-shipping-session',
      status: 'queued',
      claimedByPluginId: null,
      extensionMissionPlan: conditionalShippingPlan,
      extensionMissionPlanState: { planHash: conditionalShippingPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(() => chrome.storage.local.set({
      activeMissionTabs: {},
      localCheckoutProfiles: {
        'browser-smoke-conditional-prime-shipping-session': {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          profile: {
            contactName: 'Test User',
            streetAddress: '1 Magic City Way',
            shippingCity: 'San Francisco',
            shippingState: 'CA',
            zipCode: '94107',
            contactPhone: '4155550100',
            billingStreetAddress: '99 Billing Plaza',
            billingZipCode: '10001',
            paymentCardLast4: '1817'
          }
        }
      }
    }));
    const conditionalShippingStartResponse = await popup.evaluate((sessionId) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RUN_PENDING_SESSIONS', sessionId }, resolve);
    }), session.id);
    if (!conditionalShippingStartResponse?.ok) fail(`browser_extension_conditional_shipping_start_failed:${conditionalShippingStartResponse?.error || 'no_response'}`);
    try {
      await waitFor(() => Boolean(fulfillment));
    } catch {
      const runnerState = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['lastError', 'lastExecution'], resolve)));
      fail(`browser_extension_conditional_shipping_timeout:steps=${checkpoints.map((checkpoint) => checkpoint.planActionId).join(',')}:last_error=${runnerState.lastError || 'none'}`);
    }
    if (fulfillment.status !== 'fulfilled') {
      fail(`browser_extension_conditional_shipping_not_fulfilled:${JSON.stringify({
        execution: fulfillment.result?.browserExecution || {},
        steps: checkpoints.map((checkpoint) => ({
          id: checkpoint.planActionId,
          status: checkpoint.planActionStatus,
          selected: checkpoint.browser?.runnerStep?.selectedCandidate,
          reason: checkpoint.browser?.runnerStep?.reason,
          detail: checkpoint.detail
        }))
      })}`);
    }
    const conditionalSelect = checkpoints.find((checkpoint) => checkpoint.planActionId === 'select-match');
    const selectedTitle = String(conditionalSelect?.browser?.runnerStep?.selectedCandidate?.title || '');
    if (!/Oats n Honey/i.test(selectedTitle)) {
      fail(`browser_extension_conditional_shipping_did_not_fallback_to_free_prime:${JSON.stringify({
        visits: conditionalCandidateVisits,
        selected: conditionalSelect?.browser?.runnerStep?.selectedCandidate || null,
        reason: conditionalSelect?.browser?.runnerStep?.reason || null
      })}`);
    }
    recordPurchaseScenario('Prime item with paid-only delivery is skipped for another matching SKU', {
      rejectedProductPages: conditionalCandidateVisits.length,
      selectedTitle
    });

    await Promise.all(context.pages()
      .filter((page) => page.url().startsWith(baseUrl))
      .map((page) => page.close().catch(() => null)));
    checkoutFixture = {
      total: '$7.75',
      itemCount: 3,
      showAddressPrimeModal: false,
      selectedCardLast4: '1817'
    };
    multiBasketItems = [];
    checkpoints.length = 0;
    fulfillment = null;
    const multiItemPlan = buildExtensionPlan({
      id: 'browser-smoke-multi-item-session',
      handoffData: { kind: 'browser' },
      selections: {
        targetUrl: `${baseUrl}/multi-search`,
        goal: "buy marshmallows, graham crackers, and hershey's chocolate",
        budget: '$15',
        shoppingItems: ['marshmallows', 'graham crackers', "hershey's chocolate"]
      },
      extensionCheckoutProfileEnabled: true
    });
    session = {
      ...session,
      id: 'browser-smoke-multi-item-session',
      status: 'queued',
      claimedByPluginId: null,
      extensionMissionPlan: multiItemPlan,
      extensionMissionPlanState: { planHash: multiItemPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(() => chrome.storage.local.set({
      activeMissionTabs: {},
      localCheckoutProfiles: {
        'browser-smoke-multi-item-session': {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          profile: {
            contactName: 'Test User',
            streetAddress: '1 Magic City Way',
            shippingCity: 'San Francisco',
            shippingState: 'CA',
            zipCode: '94107',
            contactPhone: '4155550100',
            billingStreetAddress: '99 Billing Plaza',
            billingZipCode: '10001',
            paymentCardLast4: '1817'
          }
        }
      }
    }));
    const multiItemStartResponse = await popup.evaluate((sessionId) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RUN_PENDING_SESSIONS', sessionId }, resolve);
    }), session.id);
    if (!multiItemStartResponse?.ok) fail(`browser_extension_multi_item_start_failed:${multiItemStartResponse?.error || 'no_response'}`);
    try {
      await waitFor(() => Boolean(fulfillment));
    } catch {
      const runnerState = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['lastError', 'lastExecution'], resolve)));
      fail(`browser_extension_multi_item_timeout:steps=${checkpoints.map((checkpoint) => checkpoint.planActionId).join(',')}:last_error=${runnerState.lastError || 'none'}:last_execution=${runnerState.lastExecution?.status || 'none'}`);
    }
    if (fulfillment.status !== 'fulfilled') {
      const failedMultiItemPage = context.pages().find((page) => page.url().startsWith(baseUrl));
      const failedMultiItemPageText = failedMultiItemPage ? await failedMultiItemPage.locator('body').innerText() : '';
      fail(`browser_extension_multi_item_not_fulfilled:${fulfillment.status || 'none'}:${JSON.stringify(fulfillment.result?.browserExecution || {})}:page=${JSON.stringify(failedMultiItemPageText)}`);
    }
    const multiItemCompletedIds = checkpoints
      .filter((checkpoint) => checkpoint.planActionStatus !== 'waiting')
      .map((checkpoint) => checkpoint.planActionId);
    for (const actionId of [
      'search-item-1', 'inspect-results-1', 'select-match-1', 'prepare-cart-1', 'verify-cart-1',
      'search-item-2', 'inspect-results-2', 'select-match-2', 'prepare-cart-2', 'verify-cart-2',
      'search-item-3', 'inspect-results-3', 'select-match-3', 'prepare-cart-3', 'verify-cart-3',
      'inspect-cart', 'open-checkout'
    ]) {
      if (!multiItemCompletedIds.includes(actionId)) {
        fail(`browser_extension_multi_item_missing_step:${actionId}:${multiItemCompletedIds.join(',')}`);
      }
    }
    if (multiBasketItems.length !== 3
      || !multiBasketItems.includes('marshmallows')
      || !multiBasketItems.includes('graham-crackers')
      || !multiBasketItems.includes('hersheys-chocolate')
      || multiBasketItems.some((item) => /whole-foods|marketplace|gourmet/.test(item))) {
      fail(`browser_extension_multi_item_cart_incomplete:${JSON.stringify(multiBasketItems)}`);
    }
    const multiItemPage = context.pages().find((page) => page.url().startsWith(baseUrl));
    if (!multiItemPage || !multiItemPage.url().includes('/checkout')) {
      fail(`browser_extension_multi_item_did_not_reach_checkout:${multiItemPage?.url() || 'none'}:${multiItemCompletedIds.join(',')}`);
    }
    if (!/\$7\.75/.test(String(fulfillment.result?.browserExecution?.checkoutSummary?.likelyTotal || ''))) {
      fail(`browser_extension_multi_item_wrong_total:${JSON.stringify(fulfillment.result?.browserExecution?.checkoutSummary || {})}`);
    }
    recordPurchaseScenario('Three-item camping basket reaches checkout with only approved items', {
      items: [...multiBasketItems],
      likelyTotal: fulfillment.result?.browserExecution?.checkoutSummary?.likelyTotal
    });

    await Promise.all(context.pages()
      .filter((page) => page.url().startsWith(baseUrl))
      .map((page) => page.close().catch(() => null)));
    multiBasketItems = [];
    checkpoints.length = 0;
    fulfillment = null;
    const incompleteBasketPlan = buildExtensionPlan({
      id: 'browser-smoke-incomplete-basket-session',
      handoffData: { kind: 'browser' },
      selections: {
        targetUrl: `${baseUrl}/multi-search`,
        goal: 'buy marshmallows and unavailable sleeping bag',
        budget: '$15',
        shoppingItems: ['marshmallows', 'unavailable sleeping bag']
      },
      extensionCheckoutProfileEnabled: true
    });
    session = {
      ...session,
      id: 'browser-smoke-incomplete-basket-session',
      status: 'queued',
      claimedByPluginId: null,
      extensionMissionPlan: incompleteBasketPlan,
      extensionMissionPlanState: { planHash: incompleteBasketPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(() => chrome.storage.local.set({
      activeMissionTabs: {},
      localCheckoutProfiles: {
        'browser-smoke-incomplete-basket-session': {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          profile: {
            contactName: 'Test User',
            streetAddress: '1 Magic City Way',
            shippingCity: 'San Francisco',
            shippingState: 'CA',
            zipCode: '94107',
            contactPhone: '4155550100',
            billingStreetAddress: '99 Billing Plaza',
            billingZipCode: '10001',
            paymentCardLast4: '1817'
          }
        }
      }
    }));
    const incompleteBasketStartResponse = await popup.evaluate((sessionId) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RUN_PENDING_SESSIONS', sessionId }, resolve);
    }), session.id);
    if (!incompleteBasketStartResponse?.ok) fail(`browser_extension_incomplete_basket_start_failed:${incompleteBasketStartResponse?.error || 'no_response'}`);
    try {
      await waitFor(() => Boolean(fulfillment));
    } catch {
      const runnerState = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['lastError', 'lastExecution'], resolve)));
      fail(`browser_extension_incomplete_basket_timeout:steps=${checkpoints.map((checkpoint) => checkpoint.planActionId).join(',')}:last_error=${runnerState.lastError || 'none'}:last_execution=${runnerState.lastExecution?.status || 'none'}`);
    }
    if (fulfillment.status !== 'failed'
      || fulfillment.fundingDisposition !== 'release'
      || fulfillment.result?.browserExecution?.stopState !== 'basket_item_not_added') {
      fail(`browser_extension_incomplete_basket_not_failed_closed:${JSON.stringify(fulfillment)}`);
    }
    const incompleteBasketActionIds = checkpoints
      .filter((checkpoint) => checkpoint.planActionStatus !== 'waiting')
      .map((checkpoint) => checkpoint.planActionId);
    if (!incompleteBasketActionIds.includes('prepare-cart-1')
      || incompleteBasketActionIds.includes('open-cart')
      || incompleteBasketActionIds.includes('open-checkout')) {
      fail(`browser_extension_incomplete_basket_reached_checkout:${incompleteBasketActionIds.join(',')}`);
    }
    recordPurchaseScenario('Incomplete basket fails closed before checkout', {
      completedSteps: incompleteBasketActionIds
    });
    await Promise.all(context.pages()
      .filter((page) => page.url().startsWith(baseUrl))
      .map((page) => page.close().catch(() => null)));
    checkoutFixture = {
      total: '$3.50',
      itemCount: 1,
      showAddressPrimeModal: false,
      selectedCardLast4: '1817'
    };
    checkpoints.length = 0;
    fulfillment = null;
    const sideCartPlan = buildExtensionPlan({
      id: 'browser-smoke-sidecart-session',
      handoffData: { kind: 'browser' },
      selections: { targetUrl: `${baseUrl}/cart-preview-start`, goal: 'buy test gadget', budget: '$4' },
      extensionCheckoutProfileEnabled: true
    });
    session = {
      ...session,
      id: 'browser-smoke-sidecart-session',
      status: 'queued',
      claimedByPluginId: null,
      extensionMissionPlan: sideCartPlan,
      extensionMissionPlanState: { planHash: sideCartPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(() => chrome.storage.local.set({
      activeMissionTabs: {},
      localCheckoutProfiles: {
        'browser-smoke-sidecart-session': {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          profile: {
            contactName: 'Test User',
            streetAddress: '1 Magic City Way',
            shippingCity: 'San Francisco',
            shippingState: 'CA',
            zipCode: '94107',
            contactPhone: '4155550100',
            billingStreetAddress: '99 Billing Plaza',
            billingZipCode: '10001',
            paymentCardLast4: '1817'
          }
        }
      }
    }));
    const sideCartStartResponse = await popup.evaluate((sessionId) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RUN_PENDING_SESSIONS', sessionId }, resolve);
    }), session.id);
    if (!sideCartStartResponse?.ok) fail(`browser_extension_sidecart_start_failed:${sideCartStartResponse?.error || 'no_response'}`);
    try {
      await waitFor(() => Boolean(fulfillment));
    } catch {
      const runnerState = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['lastError', 'lastExecution'], resolve)));
      fail(`browser_extension_sidecart_timeout:steps=${checkpoints.map((checkpoint) => checkpoint.planActionId).join(',')}:last_error=${runnerState.lastError || 'none'}:last_execution=${runnerState.lastExecution?.status || 'none'}`);
    }
    if (fulfillment.status !== 'fulfilled') {
      fail(`browser_extension_sidecart_not_fulfilled:${fulfillment.status || 'none'}:${JSON.stringify({
        checkpoints: checkpoints.map((checkpoint) => ({
          id: checkpoint.planActionId,
          status: checkpoint.planActionStatus,
      detail: checkpoint.detail,
      url: checkpoint.browser?.url,
      stage: checkpoint.browser?.checkoutSummary?.stage,
      action: checkpoint.browser?.lastRunnerAction,
      strategy: checkpoint.browser?.runnerStep?.controlStrategy,
      continuedInterstitial: checkpoint.browser?.runnerStep?.checkoutInterstitialContinued,
      milestones: checkpoint.browser?.verifiedMilestones
        })),
        execution: fulfillment.result?.browserExecution || {}
      })}`);
    }
    const sideCartCompletedIds = checkpoints
      .filter((checkpoint) => checkpoint.planActionStatus !== 'waiting')
      .map((checkpoint) => checkpoint.planActionId);
    if (!sideCartCompletedIds.includes('select-match') || !sideCartCompletedIds.includes('prepare-cart') || !sideCartCompletedIds.includes('open-checkout')) {
      fail(`browser_extension_sidecart_did_not_skip_forward:${sideCartCompletedIds.join(',')}`);
    }
    const sideCartPage = context.pages().find((page) => page.url().startsWith(baseUrl));
    if (!sideCartPage || !sideCartPage.url().includes('/checkout')) {
      fail(`browser_extension_sidecart_did_not_reach_checkout:${sideCartPage?.url() || 'none'}:steps=${JSON.stringify(checkpoints.map((checkpoint) => ({
        id: checkpoint.planActionId,
        status: checkpoint.planActionStatus,
        label: checkpoint.label,
        state: checkpoint.browser?.checkoutSummary?.stage,
        nextAction: checkpoint.browser?.checkoutSummary?.nextAction,
        actions: checkpoint.browser?.checkoutSummary?.availableActions,
        url: checkpoint.browser?.url
      })))}:fulfillment=${JSON.stringify(fulfillment.result?.browserExecution || {})}`);
    }
    recordPurchaseScenario('Existing matching side-cart item advances to checkout without duplicate add', {
      completedSteps: sideCartCompletedIds
    });

    checkoutFixture = {
      total: '$12.57',
      itemCount: 2
    };
    checkpoints.length = 0;
    fulfillment = null;
    const overBudgetPlan = buildExtensionPlan({
      id: 'browser-smoke-overbudget-session',
      handoffData: { kind: 'browser' },
      selections: { targetUrl: `${baseUrl}/search`, goal: 'buy test gadget', budget: '$4' },
      extensionCheckoutProfileEnabled: true
    });
    session = {
      ...session,
      id: 'browser-smoke-overbudget-session',
      status: 'queued',
      claimedByPluginId: null,
      extensionMissionPlan: overBudgetPlan,
      extensionMissionPlanState: { planHash: overBudgetPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(() => chrome.storage.local.set({
      activeMissionTabs: {},
      localCheckoutProfiles: {
        'browser-smoke-overbudget-session': {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          profile: {
            contactName: 'Test User',
            streetAddress: '1 Magic City Way',
            shippingCity: 'San Francisco',
            shippingState: 'CA',
            zipCode: '94107',
            contactPhone: '4155550100',
            billingStreetAddress: '99 Billing Plaza',
            billingZipCode: '10001',
            paymentCardLast4: '1817'
          }
        }
      }
    }));
    const overBudgetStartResponse = await popup.evaluate((sessionId) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RUN_PENDING_SESSIONS', sessionId }, resolve);
    }), session.id);
    if (!overBudgetStartResponse?.ok) fail(`browser_extension_overbudget_start_failed:${overBudgetStartResponse?.error || 'no_response'}`);
    try {
      await waitFor(() => Boolean(fulfillment));
    } catch {
      const runnerState = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['lastError', 'lastExecution'], resolve)));
      fail(`browser_extension_overbudget_timeout:steps=${checkpoints.map((checkpoint) => checkpoint.planActionId).join(',')}:last_error=${runnerState.lastError || 'none'}:last_execution=${runnerState.lastExecution?.status || 'none'}`);
    }
    if (fulfillment.status !== 'failed') {
      fail(`browser_extension_overbudget_not_failed:${JSON.stringify(fulfillment.result?.browserExecution?.checkoutSummary || {})}`);
    }
    if (fulfillment.fundingDisposition !== 'release') {
      fail(`browser_extension_overbudget_did_not_release:${fulfillment.fundingDisposition || 'none'}`);
    }
    if (fulfillment.result?.browserExecution?.stopState !== 'budget_exceeded') {
      fail(`browser_extension_overbudget_wrong_stop:${fulfillment.result?.browserExecution?.stopState || 'none'}`);
    }
    if (!/12\.57/.test(String(fulfillment.result?.browserExecution?.stopEvidence || ''))) {
      fail(`browser_extension_overbudget_missing_evidence:${fulfillment.result?.browserExecution?.stopEvidence || 'none'}`);
    }
    recordPurchaseScenario('Over-budget prepared cart releases credits and stops before checkout', {
      stopState: fulfillment.result?.browserExecution?.stopState,
      evidence: fulfillment.result?.browserExecution?.stopEvidence
    });

    await Promise.all(context.pages()
      .filter((page) => page.url().startsWith(baseUrl))
      .map((page) => page.close().catch(() => null)));
    checkpoints.length = 0;
    fulfillment = null;
    lateShippingCartItem = null;
    lateShippingCandidateVisits = [];
    checkoutFixture = {
      total: '$7.49',
      merchandiseSubtotal: '$3.50',
      shipping: '$3.99',
      itemCount: 1,
      selectedCardLast4: '1817',
      matchingAddressAvailable: true,
      freeDeliveryAvailable: false
    };
    const paidDeliveryStopPlan = buildExtensionPlan({
      id: 'browser-smoke-paid-delivery-stop-session',
      handoffData: { kind: 'browser' },
      selections: {
        targetUrl: `${baseUrl}/late-shipping-search`,
        goal: 'buy test gadget',
        budget: '$4',
        finalApprovalPolicy: 'auto_submit_after_verified_checkout'
      },
      extensionCheckoutProfileEnabled: true,
      extensionFulfillmentPolicy: 'amazon_free_shipping_preferred',
      extensionPrimeRequired: true
    });
    session = {
      ...session,
      id: 'browser-smoke-paid-delivery-stop-session',
      status: 'queued',
      claimedByPluginId: null,
      extensionMissionPlan: paidDeliveryStopPlan,
      extensionMissionPlanState: { planHash: paidDeliveryStopPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(() => chrome.storage.local.set({
      activeMissionTabs: {},
      localCheckoutProfiles: {
        'browser-smoke-paid-delivery-stop-session': {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          profile: {
            contactName: 'Test User',
            streetAddress: '1 Magic City Way',
            shippingCity: 'San Francisco',
            shippingState: 'CA',
            zipCode: '94107',
            contactPhone: '4155550100',
            billingStreetAddress: '99 Billing Plaza',
            billingZipCode: '10001',
            paymentCardLast4: '1817'
          }
        }
      }
    }));
    const paidDeliveryStartResponse = await popup.evaluate((sessionId) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RUN_PENDING_SESSIONS', sessionId }, resolve);
    }), session.id);
    if (!paidDeliveryStartResponse?.ok) fail(`browser_extension_paid_delivery_start_failed:${paidDeliveryStartResponse?.error || 'no_response'}`);
    await waitFor(() => Boolean(fulfillment));
    if (fulfillment.status !== 'failed'
      || fulfillment.fundingDisposition !== 'release'
      || fulfillment.result?.browserExecution?.stopState !== 'prime_required') {
      fail(`browser_extension_paid_delivery_stop_not_failed:${JSON.stringify({
        status: fulfillment.status,
        fundingDisposition: fulfillment.fundingDisposition,
        fulfillment: fulfillment.result?.browserExecution || {},
        visits: lateShippingCandidateVisits,
        steps: checkpoints.map((checkpoint) => ({
          id: checkpoint.planActionId,
          status: checkpoint.planActionStatus,
          runnerStep: checkpoint.browser?.runnerStep || null,
          detail: checkpoint.detail
        }))
      })}`);
    }
    if (!/Prime-only checkout requires \$0 delivery|No free Prime delivery/i.test(String(fulfillment.result?.browserExecution?.stopEvidence || ''))) {
      fail(`browser_extension_paid_delivery_stop_missing_evidence:${fulfillment.result?.browserExecution?.stopEvidence || 'none'}`);
    }
    if (!lateShippingCandidateVisits.includes('test-gadget-late-paid')) {
      fail(`browser_extension_paid_delivery_stop_did_not_visit_paid_item:${JSON.stringify(lateShippingCandidateVisits)}`);
    }
    const paidDeliveryRecoveryCheckpoint = checkpoints.find((checkpoint) =>
      checkpoint.browser?.runnerStep?.primeDeliverySubstitution?.attempted === true
    );
    if (paidDeliveryRecoveryCheckpoint) {
      fail(`browser_extension_paid_delivery_stop_should_not_recover_in_extension:${JSON.stringify(checkpoints.map((checkpoint) => ({
        id: checkpoint.planActionId,
        runnerStep: checkpoint.browser?.runnerStep || null
      })))}`);
    }
    recordPurchaseScenario('Prime item with paid checkout delivery stops cleanly', {
      stopState: fulfillment.result?.browserExecution?.stopState,
      evidence: fulfillment.result?.browserExecution?.stopEvidence,
      shippingTotal: fulfillment.result?.browserExecution?.checkoutSummary?.shippingTotal
    });

    checkpoints.length = 0;
    fulfillment = null;
    checkoutFixture = {
      total: '$3.50',
      itemCount: 1,
      showAddressPrimeModal: false,
      selectedCardLast4: '0109',
      matchingAddressAvailable: true,
      includeConflictingUnitAddress: true,
      matchingAddressSummary: '1 MAGIC CITY ST, UNIT 303, SAN FRANCISCO, CA 94107-1234',
      matchingAddressText: 'Test User\n1 MAGIC CITY ST\nUnit 303\nSan Francisco, CA 94107-1234\nUnited States\nPhone number: 415-555-0100'
    };
    const mismatchPlan = buildExtensionPlan({
      id: 'browser-smoke-mismatch-session',
      handoffData: { kind: 'browser' },
      selections: { targetUrl: `${baseUrl}/search`, goal: 'buy test gadget', budget: '$20' },
      extensionCheckoutProfileEnabled: true
    });
    session = {
      ...session,
      id: 'browser-smoke-mismatch-session',
      status: 'queued',
      claimedByPluginId: null,
      extensionMissionPlan: mismatchPlan,
      extensionMissionPlanState: { planHash: mismatchPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(() => chrome.storage.local.set({
      activeMissionTabs: {},
      localCheckoutProfiles: {
        'browser-smoke-mismatch-session': {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          profile: {
            contactName: 'Test User',
            streetAddress: '1 Magic City Street Apt 303',
            shippingCity: 'San Francisco',
            shippingState: 'CA',
            zipCode: '94107',
            contactPhone: '4155550100',
            billingStreetAddress: '99 Billing Plaza',
            billingZipCode: '10001',
            paymentCardLast4: '9999'
          }
        }
      }
    }));
    const mismatchStartResponse = await popup.evaluate((sessionId) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RUN_PENDING_SESSIONS', sessionId }, resolve);
    }), session.id);
    if (!mismatchStartResponse?.ok) fail(`browser_extension_mismatch_start_failed:${mismatchStartResponse?.error || 'no_response'}`);
    let mismatchPage = null;
    const mismatchPageDeadline = Date.now() + 20_000;
    while (!mismatchPage && Date.now() < mismatchPageDeadline) {
      for (const candidatePage of context.pages().filter((page) => page.url().startsWith(baseUrl)).reverse()) {
        if (await candidatePage.locator('#delivery-summary').count().catch(() => 0)) {
          mismatchPage = candidatePage;
          break;
        }
      }
      if (!mismatchPage) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!mismatchPage) fail('browser_extension_card_handoff_missing_page');
    await mismatchPage.locator('input[aria-label="Card number"]').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => null);
    const cardEntryVisible = await mismatchPage.locator('input[aria-label="Card number"]').isVisible();
    if (!(await mismatchPage.locator('#delivery-summary').textContent() || '').includes('1 MAGIC CITY ST, UNIT 303')) {
      fail(`browser_extension_did_not_select_matching_unlabeled_address:${await mismatchPage.locator('#delivery-summary').textContent()}`);
    }
    if (!checkpoints.some((checkpoint) => checkpoint.browser?.checkoutSelections?.includes('matching delivery address'))) {
      fail(`browser_extension_missing_matching_address_checkpoint:${JSON.stringify(checkpoints.map((checkpoint) => ({ id: checkpoint.planActionId, selections: checkpoint.browser?.checkoutSelections || [] })))}`);
    }
    const pendingPaymentState = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['pendingPaymentWaits', 'activeRun', 'lastExecution'], resolve)));
    if (fulfillment) fail(`browser_extension_card_handoff_fulfilled_before_user_autofill:${JSON.stringify({
      fulfillment,
      steps: checkpoints.map((checkpoint) => ({
        id: checkpoint.planActionId,
        status: checkpoint.planActionStatus,
        state: checkpoint.state,
        stage: checkpoint.browser?.checkoutSummary?.stage,
        issue: checkpoint.browser?.checkoutSummary?.paymentIssue,
        runner: checkpoint.browser?.runnerStep
      }))
    })}`);
    if (!pendingPaymentState.pendingPaymentWaits?.['browser-smoke-mismatch-session']) {
      fail(`browser_extension_card_handoff_not_parked:${JSON.stringify(pendingPaymentState.lastExecution || {})}`);
    }
    if (pendingPaymentState.activeRun?.sessionId !== 'browser-smoke-mismatch-session'
      || pendingPaymentState.activeRun?.phase !== 'waiting_for_payment_autofill') {
      fail(`browser_extension_card_handoff_missing_durable_run:${JSON.stringify(pendingPaymentState.activeRun || {})}`);
    }
    if (!checkpoints.some((checkpoint) => checkpoint.state === 'waiting_for_payment_autofill' && checkpoint.planActionStatus === 'waiting')) {
      fail(`browser_extension_card_handoff_missing_waiting_checkpoint:${JSON.stringify(checkpoints.map((checkpoint) => ({ id: checkpoint.planActionId, state: checkpoint.state, status: checkpoint.planActionStatus })))}`);
    }
    if (!cardEntryVisible) {
      const paymentFormState = mismatchPage ? await mismatchPage.evaluate(() => ({
        paymentOptionsHidden: document.querySelector('#payment-options')?.hidden,
        addCardFormHidden: document.querySelector('#add-card-form')?.hidden,
        controls: Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"]')).map((control) => ({
          text: String(control.textContent || control.getAttribute('aria-label') || '').trim().slice(0, 100),
          hidden: Boolean(control.closest('[hidden]')),
          display: getComputedStyle(control).display,
          width: Math.round(control.getBoundingClientRect().width),
          height: Math.round(control.getBoundingClientRect().height)
        }))
      })) : null;
      fail(`browser_extension_card_handoff_did_not_open_browser_autofill_form:url=${mismatchPage?.url() || 'none'}:steps=${JSON.stringify(checkpoints.map((checkpoint) => ({
        id: checkpoint.planActionId,
        status: checkpoint.planActionStatus,
        label: checkpoint.label,
        detail: checkpoint.detail,
        stage: checkpoint.browser?.checkoutSummary?.stage,
        nextAction: checkpoint.browser?.checkoutSummary?.nextAction,
        card: checkpoint.browser?.checkoutSummary?.selectedCardLast4,
        runnerAction: checkpoint.browser?.lastRunnerAction,
        actions: checkpoint.browser?.checkoutSummary?.availableActions
      })))}:payment_form=${JSON.stringify(paymentFormState)}`);
    }
    if (cardEntryVisible && await mismatchPage.locator('input[aria-label="Card number"]').inputValue()) {
      fail('browser_extension_card_handoff_typed_sensitive_card_data');
    }
    // Simulate MV3 suspending the service worker while the user is choosing a
    // local card. The persisted active run plus the real resume alarm must
    // recover this without any test-only wake message.
    const paymentWaitCdp = await context.newCDPSession(mismatchPage);
    await paymentWaitCdp.send('ServiceWorker.enable');
    await paymentWaitCdp.send('ServiceWorker.stopAllWorkers');
    await mismatchPage.locator('input[aria-label="Card number"]').fill('5555555555559999');
    await mismatchPage.locator('input[aria-label="Name on card"]').fill('Test User');
    await mismatchPage.getByRole('button', { name: 'Add your card' }).click();
    try {
      await waitFor(() => Boolean(fulfillment), 30_000);
    } catch {
      const runnerState = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['lastError', 'lastExecution', 'pendingPaymentWaits', 'activeRun'], resolve)));
      fail(`browser_extension_mismatch_resume_timeout:steps=${checkpoints.map((checkpoint) => checkpoint.planActionId).join(',')}:last_error=${runnerState.lastError || 'none'}:last_execution=${runnerState.lastExecution?.status || 'none'}:pending=${JSON.stringify(runnerState.pendingPaymentWaits || {})}`);
    }
    if (fulfillment.status !== 'fulfilled' || fulfillment.fundingDisposition !== 'hold') {
      fail(`browser_extension_card_resume_not_fulfilled:${JSON.stringify(fulfillment)}`);
    }
    const mismatchStopState = fulfillment.result?.browserExecution?.stopState || '';
    if (!['final_approval_required', 'review_ready'].includes(mismatchStopState)) {
      fail(`browser_extension_card_resume_wrong_stop:${mismatchStopState}`);
    }
    if (fulfillment.result?.browserExecution?.checkoutSummary?.cardMatches !== true) {
      fail(`browser_extension_card_resume_did_not_verify_expected_card:${JSON.stringify(fulfillment.result?.browserExecution?.checkoutSummary || {})}`);
    }
    const resumedPaymentState = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['pendingPaymentWaits', 'activeRun'], resolve)));
    if (resumedPaymentState.pendingPaymentWaits?.['browser-smoke-mismatch-session']) {
      fail('browser_extension_card_resume_did_not_clear_wait_state');
    }
    if (resumedPaymentState.activeRun) fail(`browser_extension_card_resume_did_not_clear_durable_run:${JSON.stringify(resumedPaymentState.activeRun)}`);
    recordPurchaseScenario('Approximate saved address match plus wrong card opens card handoff and resumes', {
      stopState: fulfillment.result?.browserExecution?.stopState,
      cardMatches: fulfillment.result?.browserExecution?.checkoutSummary?.cardMatches
    });

    // A user opting into final review must be able to approve the already
    // prepared checkout without replaying search/cart work or opening a tab.
    await Promise.all(context.pages()
      .filter((page) => page.url().startsWith(baseUrl))
      .map((page) => page.close().catch(() => null)));
    checkoutFixture = {
      total: '$3.50',
      itemCount: 1,
      showAddressPrimeModal: false,
      selectedCardLast4: '1817'
    };
    checkpoints.length = 0;
    fulfillment = null;
    const manualReviewPlan = buildExtensionPlan({
      id: 'browser-smoke-final-review-session',
      handoffData: { kind: 'browser' },
      selections: {
        targetUrl: `${baseUrl}/search`,
        goal: 'buy test gadget',
        budget: '$4',
        finalApprovalPolicy: 'pause_before_final_approval'
      },
      extensionCheckoutProfileEnabled: true
    });
    session = {
      ...session,
      id: 'browser-smoke-final-review-session',
      status: 'queued',
      claimedByPluginId: null,
      fulfillment: null,
      extensionFinalSubmitResume: false,
      extensionMissionPlan: manualReviewPlan,
      extensionMissionPlanState: { planHash: manualReviewPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(() => chrome.storage.local.set({
      activeMissionTabs: {},
      localCheckoutProfiles: {
        'browser-smoke-final-review-session': {
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          profile: {
            contactName: 'Test User',
            streetAddress: '2865 Sand Hill Road Suite 101',
            shippingCity: 'Menlo Park',
            shippingState: 'CA',
            zipCode: '94025',
            contactPhone: '4155550100',
            billingStreetAddress: '99 Billing Plaza',
            billingZipCode: '10001',
            paymentCardLast4: '1817'
          }
        }
      }
    }));
    const manualReviewStartResponse = await popup.evaluate((sessionId) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RUN_PENDING_SESSIONS', sessionId }, resolve);
    }), session.id);
    if (!manualReviewStartResponse?.ok) fail(`browser_extension_final_review_start_failed:${manualReviewStartResponse?.error || 'no_response'}`);
    try {
      await waitFor(() => Boolean(fulfillment));
    } catch {
      const runnerState = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['lastError', 'lastExecution'], resolve)));
      fail(`browser_extension_final_review_timeout:steps=${checkpoints.map((checkpoint) => checkpoint.planActionId).join(',')}:last_error=${runnerState.lastError || 'none'}:last_execution=${runnerState.lastExecution?.status || 'none'}`);
    }
    if (fulfillment.status !== 'fulfilled'
      || fulfillment.result?.browserExecution?.stopState !== 'final_approval_required'
      || fulfillment.result?.browserExecution?.orderSubmitted === true) {
      fail(`browser_extension_final_review_not_paused:${JSON.stringify(fulfillment)}`);
    }
    const preservedReviewState = await worker.evaluate(() => new Promise((resolve) => {
      chrome.storage.local.get(['activeMissionTabs', 'localCheckoutProfiles'], resolve);
    }));
    const reviewTabId = preservedReviewState.activeMissionTabs?.['browser-smoke-final-review-session'];
    if (!reviewTabId || !preservedReviewState.localCheckoutProfiles?.['browser-smoke-final-review-session']) {
      fail(`browser_extension_final_review_context_not_preserved:${JSON.stringify(preservedReviewState)}`);
    }
    const preparedReviewPage = context.pages().find((page) => page.url().startsWith(baseUrl)
      && page.url().includes('/checkout/'));
    if (!preparedReviewPage) fail('browser_extension_final_review_page_missing');
    await preparedReviewPage.evaluate(() => {
      const summary = document.querySelector('#delivery-summary');
      if (summary) summary.textContent = '2865 SAND HILL RD STE 101, MENLO PARK, CA, 94025-7022, United States';
      const unrelated = document.createElement('label');
      unrelated.innerHTML = '<input type="checkbox" checked /> Default to this delivery address and payment method.';
      document.querySelector('main')?.appendChild(unrelated);
    });
    const reviewTabCount = (await worker.evaluate(() => chrome.tabs.query({})))
      .filter((tab) => String(tab.url || '').startsWith(baseUrl)).length;

    checkpoints.length = 0;
    fulfillment = null;
    const resumeFinalSubmitPlan = buildExtensionPlan({
      id: 'browser-smoke-final-review-session',
      handoffData: { kind: 'browser' },
      selections: {
        targetUrl: `${baseUrl}/search`,
        goal: 'buy test gadget',
        budget: '$4',
        finalApprovalPolicy: 'auto_submit_after_verified_checkout'
      },
      extensionCheckoutProfileEnabled: true,
      extensionFinalSubmitResume: true
    });
    session = {
      ...session,
      status: 'queued',
      claimedByPluginId: null,
      fulfillment: null,
      extensionFinalSubmitResume: true,
      extensionMissionPlan: resumeFinalSubmitPlan,
      extensionMissionPlanState: { planHash: resumeFinalSubmitPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    const resumeFinalSubmitResponse = await popup.evaluate((sessionId) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RUN_PENDING_SESSIONS', sessionId }, resolve);
    }), session.id);
    if (!resumeFinalSubmitResponse?.ok) fail(`browser_extension_final_review_resume_failed:${resumeFinalSubmitResponse?.error || 'no_response'}`);
    try {
      await waitFor(() => Boolean(fulfillment));
    } catch {
      const runnerState = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['lastError', 'lastExecution'], resolve)));
      fail(`browser_extension_final_review_resume_timeout:steps=${checkpoints.map((checkpoint) => checkpoint.planActionId).join(',')}:last_error=${runnerState.lastError || 'none'}:last_execution=${runnerState.lastExecution?.status || 'none'}`);
    }
    if (fulfillment.status !== 'fulfilled'
      || fulfillment.result?.browserExecution?.orderSubmitted !== true
      || fulfillment.result?.browserExecution?.stopState !== 'order_submitted') {
      fail(`browser_extension_final_review_resume_not_submitted:${JSON.stringify(fulfillment)}`);
    }
    const resumeActionIds = checkpoints
      .filter((checkpoint) => checkpoint.planActionStatus !== 'waiting')
      .map((checkpoint) => checkpoint.planActionId);
    if (resumeActionIds.some((actionId) => /^(open-site|inspect-landing|inspect-results|select-match|prepare-cart|open-cart|inspect-cart|open-checkout)$/.test(actionId))
      || !resumeActionIds.includes('submit-final-order')) {
      fail(`browser_extension_final_review_replayed_checkout:${resumeActionIds.join(',')}`);
    }
    const resumeTabs = (await worker.evaluate(() => chrome.tabs.query({})))
      .filter((tab) => String(tab.url || '').startsWith(baseUrl));
    if (resumeTabs.length !== reviewTabCount || !resumeTabs.some((tab) => tab.id === reviewTabId)) {
      fail(`browser_extension_final_review_did_not_reuse_tab:${JSON.stringify({ reviewTabId, reviewTabCount, resumeTabs })}`);
    }
    recordPurchaseScenario('Manual final-review handoff resumes in the same prepared checkout tab', {
      resumedSteps: resumeActionIds,
      addressVariant: 'RD/STE and ZIP+4 with unrelated checked checkout control'
    });

    checkpoints.length = 0;
    fulfillment = null;
    const invalidStartupPlan = {
      ...mismatchPlan,
      planId: 'mplan_browser-smoke-invalid-startup-session',
      startUrl: 'http://example.invalid/not-allowed'
    };
    session = {
      ...session,
      id: 'browser-smoke-invalid-startup-session',
      status: 'queued',
      claimedByPluginId: null,
      extensionMissionPlan: invalidStartupPlan,
      extensionMissionPlanState: { planHash: invalidStartupPlan.planHash, nextActionIndex: 0, completedActionIds: [] },
      missionBoundaryLatestHash: null,
      missionBoundaryEventCount: 0
    };
    await worker.evaluate(() => chrome.storage.local.set({ activeMissionTabs: {}, localCheckoutProfiles: {} }));
    const invalidStartupResponse = await popup.evaluate((sessionId) => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'RUN_PENDING_SESSIONS', sessionId }, resolve);
    }), session.id);
    if (!invalidStartupResponse?.ok) fail(`browser_extension_invalid_startup_failed_to_return:${invalidStartupResponse?.error || 'no_response'}`);
    try {
      await waitFor(() => Boolean(fulfillment));
    } catch {
      const runnerState = await worker.evaluate(() => new Promise((resolve) => chrome.storage.local.get(['lastError', 'lastExecution'], resolve)));
      fail(`browser_extension_invalid_startup_watchdog_risk:last_error=${runnerState.lastError || 'none'}:last_execution=${runnerState.lastExecution?.status || 'none'}`);
    }
    if (fulfillment.status !== 'failed'
      || fulfillment.result?.browserExecution?.stopState !== 'runner_startup_failed'
      || fulfillment.fundingDisposition !== 'release') {
      fail(`browser_extension_invalid_startup_not_reported:${JSON.stringify(fulfillment)}`);
    }

    const stalePermissionPlan = buildExtensionPlan({
      id: 'browser-smoke-stale-permission-session',
      handoffData: { kind: 'browser' },
      selections: { targetUrl: `${baseUrl}/search`, goal: 'prepare an old travel search', budget: '$4000' }
    });
    const stalePermissionCreatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    session = {
      ...session,
      id: 'browser-smoke-stale-permission-session',
      status: 'executing',
      completionMode: 'agent_checkout',
      preferredExecutionAgentId: 'magic-city-runner-extension',
      claimedByPluginId: 'magic-city-runner-extension',
      executionRequestedAt: stalePermissionCreatedAt,
      executionLive: {
        state: 'permission_required',
        label: 'Browser access needed',
        createdAt: stalePermissionCreatedAt
      },
      extensionMissionPlan: stalePermissionPlan,
      extensionMissionPlanState: { planHash: stalePermissionPlan.planHash, nextActionIndex: 0, completedActionIds: [] }
    };
    const stalePendingResponse = await popup.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_PENDING_MISSION_SITE' }, resolve);
    }));
    if (stalePendingResponse?.ok || !/no browser mission is waiting/i.test(String(stalePendingResponse?.error || ''))) {
      fail(`browser_extension_stale_permission_mission_visible:${JSON.stringify(stalePendingResponse)}`);
    }
    if (purchaseScenarioResults.length < 10) {
      fail(`browser_extension_purchase_matrix_incomplete:${JSON.stringify(purchaseScenarioResults)}`);
    }
    console.log(JSON.stringify({
      amazonPurchaseSimulations: purchaseScenarioResults.length,
      scenarios: purchaseScenarioResults
    }, null, 2));
    console.log('native-runner browser extension smoke passed');
  } finally {
    clearInterval(keepAlive);
    await context?.close();
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
}
