import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sourceDir = path.join(rootDir, 'public/native-runner/extension');

function fail(message) {
  throw new Error(message);
}

function savedAddressRow({ id, checked = false, name, address, phone, pickup = false, unreadable = false, noAria = false, visualOnly = false }) {
  const detailId = `address-details-${id}`;
  return {
    choice: [
      `<div class="choice-cell" data-address-id="${id}">`,
      `<input type="radio" name="address" ${checked ? 'checked' : ''} ${(unreadable || noAria) ? '' : `aria-describedby="${detailId}"`} style="position:absolute;opacity:0;width:1px;height:1px" />`,
      '</div>'
    ].join(''),
    detail: unreadable
      ? [
        '<div class="detail">Saved delivery choice</div>'
      ].join('')
      : visualOnly
        ? [
          '<div class="merchant-detail">',
          `<span>${name}</span>`,
          `<span>${address}</span>`,
          `<span>${pickup ? 'This item is ineligible for this Pickup Location.' : `Phone number: ${phone}`}</span>`,
          '</div>'
        ].join('')
        : [
        `<article class="${pickup ? 'pickup-row' : 'address-row'}" id="${detailId}">`,
        `<strong>${name}</strong>`,
        `<p>${address}</p>`,
        `<p>${pickup ? 'This item is ineligible for this Pickup Location.' : `Phone number: ${phone}`}</p>`,
        '</article>'
      ].join('')
  };
}

function addressPickerHtml({ selectedAddress, selectedName = 'Andreessen Horowitz', selectedPhone = '(650) 798-5800', unreadable = false, noAria = false, visualOnly = false }) {
  const otherRows = [
    ['townsend', 'Andreessen Horowitz', '180 TOWNSEND ST, SAN FRANCISCO, CA, 94107-2588, United States', '(650) 798-5800'],
    ['valiant', 'Chris Hamman', '314 VALIANT DR, ROCKWALL, TX, 75032-8403, United States', '972-533-0862'],
    ['coastal', 'EVAN KEREIAKES', '16192 COASTAL HWY, LEWES, DE, 19958-3608, United States', '646-691-5137'],
    ['coastal-phone', 'Evan Kereiakes', '16192 COASTAL HWY, LEWES, DE, 19958-3608, United States', '+16466915137'],
    ['sand-hill-wrong-suite', 'Andreessen Horowitz', '2865 SAND HILL RD STE 102, MENLO PARK, CA, 94025-7022, United States', '(650) 798-5800'],
    ['oak', 'Taylor Example', '42 OAK STREET, AUSTIN, TX, 78701, United States', '512-555-0199'],
    ['market', 'Jordan Example', '1 MARKET STREET, SAN FRANCISCO, CA, 94105, United States', '415-555-0188'],
    ['palm', 'Avery Example', '530 PALM DRIVE, LOS ANGELES, CA, 90001, United States', '323-555-0118'],
    ['cedar', 'Casey Example', '700 CEDAR AVENUE, SEATTLE, WA, 98101, United States', '206-555-0133'],
    ['lakeshore', 'Morgan Example', '11 LAKESHORE DRIVE, CHICAGO, IL, 60601, United States', '312-555-0144'],
    ['orchard', 'Riley Example', '9 ORCHARD ROAD, BOSTON, MA, 02108, United States', '617-555-0177']
  ];
  const rows = [
    savedAddressRow({ id: 'saved-selected-address', checked: true, name: selectedName, address: selectedAddress, phone: selectedPhone, unreadable, noAria, visualOnly }),
    ...otherRows.map(([id, name, address, phone]) => savedAddressRow({ id, name, address, phone, unreadable, noAria, visualOnly })),
    savedAddressRow({
      id: 'pickup-charon',
      name: 'Amazon Locker - Charon',
      address: '7-Eleven, 535 8th Ave, New York, NY, 10018-4305, United States',
      pickup: true,
      unreadable,
      noAria,
      visualOnly
    })
  ];
  return `<!doctype html>
    <style>
      main { font: 16px/1.4 Arial, sans-serif; max-width: 1100px; margin: 24px auto; }
      .address-row, .pickup-row { padding: 12px 0; border-bottom: 1px solid #d5d9d9; }
      .choice-cell { min-height: 24px; position: relative; }
      .address-picker-grid { display: grid; grid-template-columns: 36px 1fr; gap: 12px; }
      button { background: #ffd814; border: 0; border-radius: 18px; padding: 10px 24px; font-weight: 700; }
      aside { float: right; width: 280px; padding: 18px; background: #f7f8f8; }
      #delivery-addresses { max-width: 700px; }
    </style>
    <main>
      <aside>
        <button class="address-confirm" onclick="confirmAddress()">Deliver to this address</button>
        <p>Items: $2.97</p><p>Shipping &amp; handling: $0.00</p><p>Order total: $2.97</p>
      </aside>
      <h1>Select a delivery address</h1>
      <section id="delivery-addresses" aria-label="Delivery addresses">
        <div class="address-picker-grid">
          <div class="address-choice-column">${rows.map((row) => row.choice).join('')}</div>
          <div class="address-details-column">${rows.map((row) => row.detail).join('')}</div>
        </div>
      </section>
      <section aria-label="Payment method"><h2>Paying with Mastercard 6383</h2><label><input type="radio" name="payment" checked /> Mastercard ending in 6383</label></section>
      <button class="address-confirm" onclick="confirmAddress()">Deliver to this address</button>
      <p id="delivery-summary">Select a delivery address</p>
    </main>
    <script>
      function confirmAddress() {
        document.body.dataset.addressConfirmed = 'true';
        document.body.dataset.addressConfirmClicks = String(Number(document.body.dataset.addressConfirmClicks || 0) + 1);
        document.querySelector('#delivery-summary').textContent = 'Delivering to Andreessen Horowitz, 2865 Sand Hill Road, Menlo Park, CA 94025';
      }
    </script>`;
}

function closedCheckoutSummaryHtml() {
  return `<!doctype html>
    <main>
      <section aria-label="Delivery address">
        <h2>Delivering to Andreessen Horowitz</h2>
        <p>2865 SAND HILL RD STE 101, MENLO PARK, CA, 94025-7022, United States</p>
      </section>
      <section aria-label="Payment method"><h2>Paying with Mastercard 6383</h2></section>
      <label><input type="checkbox" /> Default to this delivery address and payment method.</label>
      <button>Place your order</button>
    </main>`;
}

function finalReviewWithPickupOverlayHtml() {
  return `<!doctype html>
    <style>
      body { font: 16px/1.4 Arial, sans-serif; }
      main { padding: 28px; }
      .summary { margin-bottom: 20px; padding: 18px; border: 1px solid #d5d9d9; }
      button { background: #ffd814; border: 0; border-radius: 18px; padding: 10px 24px; font-weight: 700; }
      .a-popover { position: fixed; inset: 36px; z-index: 20; background: white; border: 2px solid #f08804; padding: 24px; }
      .a-popover button.close { position: absolute; top: 12px; right: 12px; background: white; border: 1px solid #777; }
    </style>
    <main>
      <section class="summary" aria-label="Delivery address">
        <h2>Delivering to Andreessen Horowitz</h2>
        <p>2865 SAND HILL RD STE 101, MENLO PARK, CA, 94025-7022, United States</p>
        <a href="#pickup">FREE pickup available nearby</a>
      </section>
      <section class="summary" aria-label="Payment method"><h2>Paying with Mastercard 6383</h2></section>
      <section class="summary"><p>Items: $2.97</p><p>Shipping &amp; handling: $0.00</p><p>Order total: $2.97</p><button>Place your order</button></section>
      <div class="a-popover" id="pickup-overlay">
        <button class="close" aria-label="Close" onclick="closePickup()">X</button>
        <h2>Select a pickup location</h2>
        <p>Amazon Counter at Whole Foods Market</p>
        <button onclick="window.__pickupSelected = true">Pick up here</button>
      </div>
    </main>
    <script>
      function closePickup() {
        window.__pickupClosed = true;
        document.querySelector('#pickup-overlay')?.remove();
      }
    </script>`;
}

function collapsedShippingSpeedHtml() {
  return `<!doctype html>
    <style>
      main { font: 16px/1.4 Arial, sans-serif; max-width: 1100px; margin: 24px auto; }
      .checkout-card { margin: 18px 0; padding: 18px; border: 1px solid #d5d9d9; }
      [hidden] { display: none; }
      button, a { cursor: pointer; }
    </style>
    <main>
      <section aria-label="Delivery address"><h2>Delivering to Andreessen Horowitz</h2><p>2865 SAND HILL RD STE 101, MENLO PARK, CA, 94025-7022, United States</p><button id="pickup-disclosure" onclick="window.__pickupOpened = true">FREE pickup available nearby</button></section>
      <section aria-label="Payment method"><h2>Paying with Mastercard 6383</h2></section>
      <section class="checkout-card" id="shipping-speed-card">
        <div class="checkout-card-copy"><h2>Shipping speed</h2><p>Fast delivery $3.99</p></div>
        <div class="checkout-card-action"><a href="#shipping-speed" id="shipping-speed-change" onclick="event.preventDefault(); document.querySelector('#shipping-speed-options').hidden = false">Change</a></div>
        <div id="shipping-speed-options" hidden>
          <label><input type="radio" name="shipping-speed" value="fast" /> Fast delivery $3.99</label>
          <label><input type="radio" name="shipping-speed" value="standard" /> Standard delivery FREE</label>
          <label><input type="radio" name="shipping-speed" value="one-day" /> One-Day delivery FREE</label>
          <label><input type="radio" name="shipping-speed" value="trial" /> Try Prime FREE one-day trial</label>
        </div>
      </section>
      <section aria-label="Order summary"><p>Items: $2.97</p><p>Shipping &amp; handling: $0.00</p><p>Order total: $2.97</p></section>
    </main>`;
}

async function main() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/closed-summary') {
      response.end(closedCheckoutSummaryHtml());
      return;
    }
    if (pathname === '/checkout/final-review-with-pickup-overlay') {
      response.end(finalReviewWithPickupOverlayHtml());
      return;
    }
    if (pathname === '/checkout/shipping-speed') {
      response.end(collapsedShippingSpeedHtml());
      return;
    }
    const conflict = pathname === '/different-unit';
    response.end(addressPickerHtml({
      selectedAddress: conflict
        ? '2865 SAND HILL RD STE 102, MENLO PARK, CA, 94025-7022, United States'
        : '2865 SAND HILL RD STE 101, MENLO PARK, CA, 94025-7022, United States',
      unreadable: pathname === '/unverified',
      noAria: pathname === '/ordinal' || pathname === '/visual-row',
      visualOnly: pathname === '/visual-row'
    }));
  });

  let context = null;
  let tempDir = '';
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-address-reconcile-'));
    const extensionDir = path.join(tempDir, 'extension');
    fs.cpSync(sourceDir, extensionDir, { recursive: true });
    const manifestPath = path.join(extensionDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.host_permissions = [...new Set([...(manifest.host_permissions || []), 'http://127.0.0.1/*'])];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    context = await chromium.launchPersistentContext(path.join(tempDir, 'profile'), {
      headless: false,
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(`${baseUrl}/selected`);
    const tab = await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((candidate) => candidate.url === url) || null;
    }, page.url());
    if (!tab?.id) fail('address_reconciliation_test_tab_missing');

    const execute = (message) => worker.evaluate(async ({ tabId, payload }) => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['executor.js'] });
      return chrome.tabs.sendMessage(tabId, payload);
    }, { tabId: tab.id, payload: message });

    const outcome = await execute({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: {
        contactName: 'Andreessen Horowitz',
        streetAddress: '2865 Sand Hill Road',
        shippingCity: 'Menlo Park',
        shippingState: 'CA',
        zipCode: '94025'
      }
    });
    await page.waitForTimeout(250);
    const confirmed = await page.locator('body').getAttribute('data-address-confirmed');
    const matchingInputChecked = await page.locator('[data-address-id="saved-selected-address"] input').isChecked();
    const pickupInputChecked = await page.locator('[data-address-id="pickup-charon"] input').isChecked();
    const confirmClicks = await page.locator('body').getAttribute('data-address-confirm-clicks');
    const summary = await page.locator('#delivery-summary').textContent();
    if (!outcome?.completed || !/deliver to this address/i.test(String(outcome.label || ''))) {
      fail(`address_reconciliation_did_not_confirm_selected_address:${JSON.stringify(outcome)}`);
    }
    if (confirmed !== 'true' || confirmClicks !== '1' || !matchingInputChecked || pickupInputChecked || !/2865 Sand Hill/i.test(String(summary || ''))) {
      fail(`address_reconciliation_dom_not_settled:${JSON.stringify({ confirmed, confirmClicks, matchingInputChecked, pickupInputChecked, summary, outcome })}`);
    }
    await page.goto(`${baseUrl}/different-unit`);
    const strictMismatchOutcome = await execute({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: {
        contactName: 'Andreessen Horowitz',
        streetAddress: '2865 Sand Hill Road Ste 101',
        shippingCity: 'Menlo Park',
        shippingState: 'CA',
        zipCode: '94025'
      }
    });
    await page.waitForTimeout(250);
    const strictMismatchConfirmed = await page.locator('body').getAttribute('data-address-confirmed');
    const strictMismatchState = strictMismatchOutcome?.state?.checkoutSummary || {};
    if (strictMismatchConfirmed === 'true'
      || strictMismatchOutcome?.navigationRequested === true
      || strictMismatchOutcome?.profileCorrection !== 'address'
      || strictMismatchState.addressMatches !== false) {
      fail(`address_reconciliation_allowed_different_unit:${JSON.stringify({ strictMismatchConfirmed, strictMismatchOutcome, strictMismatchState })}`);
    }
    await page.goto(`${baseUrl}/ordinal`);
    const ordinalOutcome = await execute({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: {
        contactName: 'Andreessen Horowitz',
        streetAddress: '2865 Sand Hill Road Ste 101',
        shippingCity: 'Menlo Park',
        shippingState: 'CA',
        zipCode: '94025'
      }
    });
    await page.waitForTimeout(250);
    const ordinalSummary = ordinalOutcome?.state?.checkoutSummary || {};
    const ordinalConfirmed = await page.locator('body').getAttribute('data-address-confirmed');
    if (!ordinalOutcome?.completed
      || ordinalConfirmed !== 'true'
      || ordinalSummary.addressMatches !== true
      || ordinalSummary.addressVerification !== 'matched'
      || !ordinalSummary.addressVerificationDiagnostics?.selectedChoiceSources?.includes('amazon_visual_row')) {
      fail(`address_reconciliation_sibling_columns_not_matched:${JSON.stringify({ ordinalOutcome, ordinalSummary, ordinalConfirmed })}`);
    }
    await page.goto(`${baseUrl}/visual-row`);
    const visualRowOutcome = await execute({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: {
        contactName: 'Andreessen Horowitz',
        streetAddress: '2865 Sand Hill Road Ste 101',
        shippingCity: 'Menlo Park',
        shippingState: 'CA',
        zipCode: '94025'
      }
    });
    await page.waitForTimeout(250);
    const visualRowSummary = visualRowOutcome?.state?.checkoutSummary || {};
    const visualRowConfirmed = await page.locator('body').getAttribute('data-address-confirmed');
    if (!visualRowOutcome?.completed
      || visualRowConfirmed !== 'true'
      || visualRowSummary.addressMatches !== true
      || !visualRowSummary.addressVerificationDiagnostics?.selectedChoiceSources?.includes('amazon_visual_row')) {
      fail(`address_reconciliation_visual_row_not_matched:${JSON.stringify({ visualRowOutcome, visualRowSummary, visualRowConfirmed })}`);
    }
    await page.goto(`${baseUrl}/unverified`);
    const unreadableOutcome = await execute({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: {
        contactName: 'Andreessen Horowitz',
        streetAddress: '2865 Sand Hill Road Ste 101',
        shippingCity: 'Menlo Park',
        shippingState: 'CA',
        zipCode: '94025'
      }
    });
    const unreadableSummary = unreadableOutcome?.state?.checkoutSummary || {};
    if (unreadableOutcome?.profileCorrection !== 'address_verification'
      || unreadableSummary.addressMatches !== null
      || unreadableSummary.addressVerification !== 'unverified') {
      fail(`address_reconciliation_unreadable_row_was_not_tri_state:${JSON.stringify({ unreadableOutcome, unreadableSummary })}`);
    }
    await page.goto(`${baseUrl}/closed-summary`);
    const closedSummaryOutcome = await execute({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'inspect' },
      checkoutProfile: {
        contactName: 'Andreessen Horowitz',
        streetAddress: '2865 Sand Hill Road Ste 101',
        shippingCity: 'Menlo Park',
        shippingState: 'CA',
        zipCode: '94025',
        paymentCardLast4: '6383'
      }
    });
    const closedSummary = closedSummaryOutcome?.state?.checkoutSummary || {};
    if (closedSummary.addressMatches !== true
      || closedSummary.addressVerification !== 'matched'
      || !['checkout_summary', 'checkout_summary_final_review'].includes(closedSummary.addressVerificationSource)) {
      fail(`address_reconciliation_closed_summary_misclassified:${JSON.stringify({ closedSummaryOutcome, closedSummary })}`);
    }
    await page.goto(`${baseUrl}/checkout/final-review-with-pickup-overlay`);
    const pickupOverlayOutcome = await execute({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: {
        contactName: 'Andreessen Horowitz',
        streetAddress: '2865 Sand Hill Road Ste 101',
        shippingCity: 'Menlo Park',
        shippingState: 'CA',
        zipCode: '94025',
        paymentCardLast4: '6383'
      }
    });
    await page.waitForTimeout(250);
    const pickupOverlayClosed = await page.evaluate(() => window.__pickupClosed === true);
    const pickupSelected = await page.evaluate(() => window.__pickupSelected === true);
    const pickupOverlaySummary = pickupOverlayOutcome?.state?.checkoutSummary || {};
    const pickupOverlayReceipt = (pickupOverlaySummary.browserActionReceipts || [])
      .some((receipt) => receipt?.kind === 'pickup_overlay_close');
    if (!pickupOverlayOutcome?.checkoutPickupModalClosed
      || !pickupOverlayClosed
      || pickupSelected
      || !pickupOverlaySummary.finalReviewReady
      || !pickupOverlaySummary.finalReviewDeliverySummaryMatches
      || !pickupOverlayReceipt) {
      fail(`address_reconciliation_pickup_overlay_not_closed_safely:${JSON.stringify({ pickupOverlayOutcome, pickupOverlayClosed, pickupSelected, pickupOverlaySummary })}`);
    }
    await page.goto(`${baseUrl}/checkout/shipping-speed`);
    const shippingSpeedOutcome = await execute({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true, fulfillmentMode: 'home_delivery' },
      checkoutProfile: {
        contactName: 'Andreessen Horowitz',
        streetAddress: '2865 Sand Hill Road Ste 101',
        shippingCity: 'Menlo Park',
        shippingState: 'CA',
        zipCode: '94025',
        paymentCardLast4: '6383'
      }
    });
    const selectedShippingSpeed = await page.locator('input[name="shipping-speed"]:checked').getAttribute('value');
    const shippingOptionsVisible = await page.locator('#shipping-speed-options').isVisible();
    const pickupOpened = await page.evaluate(() => window.__pickupOpened === true);
    const shippingSpeedSummary = shippingSpeedOutcome?.state?.checkoutSummary || {};
    if (selectedShippingSpeed !== 'one-day'
      || !shippingOptionsVisible
      || pickupOpened
      || shippingSpeedSummary.deliveryConfirmed !== true
      || shippingSpeedSummary.selectedDeliveryPrice !== 0
      || !/delivery option free/i.test(String(shippingSpeedOutcome?.checkoutSelections || ''))) {
      fail(`address_reconciliation_shipping_speed_not_selected_safely:${JSON.stringify({ shippingSpeedOutcome, selectedShippingSpeed, shippingOptionsVisible, pickupOpened, shippingSpeedSummary })}`);
    }
    console.log(JSON.stringify({
      ok: true,
      version: manifest.version,
      selectedAddress: '2865 SAND HILL RD STE 101',
      vaultAddress: '2865 Sand Hill Road',
      zipVariantAccepted: true,
      selectedAddressRecognizedWithoutReselecting: true,
      siblingRadioAndAddressColumnsHandled: true,
      realWorldSiblingRowWithoutSemanticMarkupHandled: true,
      unreadableRowIsNotMisreportedAsMismatch: true,
      closedDeliverySummaryPreferredOverUnrelatedDefaultCheckbox: true,
      pickupLocationExcluded: true,
      pickupOverlayClosedWithoutChangingFulfillment: true,
      collapsedShippingSpeedChoosesFastestFreeHomeDelivery: true,
      duplicateAddressConfirmationHandled: true,
      differentSuiteRejected: true
    }, null, 2));
  } finally {
    await context?.close().catch(() => null);
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
