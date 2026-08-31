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

async function main() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html>
      <main>
        <h1>Review your order</h1>
        <section aria-label="Delivery address">
          <h2>Delivering to Test User</h2>
          <p>1 Magic City Way, San Francisco, CA 94107, United States</p>
        </section>
        <section aria-label="Payment method">
          <h2 id="payment-summary">Paying with Visa 0109</h2>
          <button id="change-payment" onclick="document.querySelector('#payment-options').hidden=false">Change</button>
          <div id="payment-options" class="payment-section" hidden>
            <div class="a-row payment-card-row" data-card-ending="0109" onclick="selectSavedCard(this)"><input type="radio" name="payment" checked onclick="event.preventDefault(); event.stopPropagation()" /><span>Visa ending in 0109</span><span>Evan Kereiakes</span><span>12/2026</span></div>
            <div class="a-row payment-card-row" data-card-ending="6383" onclick="selectSavedCard(this)"><input type="radio" name="payment" onclick="event.preventDefault(); event.stopPropagation()" /><span>Mastercard ending in 6383</span><span>Evan Kereiakes</span><span>07/2031</span></div>
            <button id="use-payment-method" onclick="const selected=document.querySelector('input[name=payment]:checked'); setTimeout(() => { document.querySelector('#payment-summary').textContent=selected.parentElement.innerText; document.querySelector('#payment-options').hidden=true; document.querySelector('#final-review').hidden=false; document.body.dataset.paymentConfirmed='true' }, 650)">Use this payment method</button>
            <button id="use-payment-method-sidebar" onclick="const selected=document.querySelector('input[name=payment]:checked'); setTimeout(() => { document.querySelector('#payment-summary').textContent=selected.parentElement.innerText; document.querySelector('#payment-options').hidden=true; document.querySelector('#final-review').hidden=false; document.body.dataset.paymentConfirmed='true' }, 650)">Use this payment method</button>
          </div>
        </section>
        <p>Items: $2.97</p>
        <p>Shipping &amp; handling: $0.00</p>
        <p>Order total: $2.97</p>
        <button id="final-review" hidden>Place your order</button>
        <script>
          function selectSavedCard(row) {
            document.querySelectorAll('input[name=payment]').forEach((input) => { input.checked = false; });
            row.querySelector('input[name=payment]').checked = true;
            document.body.dataset.cardRowClicked = row.dataset.cardEnding;
          }
        </script>
      </main>`);
  });

  let context = null;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-card-reconcile-'));
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
    await page.goto(baseUrl);
    const tab = await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((candidate) => candidate.url === url) || null;
    }, page.url());
    if (!tab?.id) fail('card_reconciliation_test_tab_missing');

    const command = (message) => worker.evaluate(async ({ tabId, payload }) => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['executor.js'] });
      return chrome.tabs.sendMessage(tabId, payload);
    }, { tabId: tab.id, payload: message });
    const profile = {
      contactName: 'Test User',
      streetAddress: '1 Magic City Way',
      shippingCity: 'San Francisco',
      shippingState: 'CA',
      zipCode: '94107',
      paymentCardLast4: '6383'
    };
    const first = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: profile
    });
    if (!first.completed || first.profileCorrection !== 'payment') {
      fail(`card_reconciliation_did_not_open_picker:${JSON.stringify(first)}`);
    }
    await page.locator('#payment-options').waitFor({ state: 'visible', timeout: 2_000 });
    const pickerSnapshot = await page.locator('input[name=payment]').evaluateAll((inputs) => inputs.map((input) => ({
      checked: input.checked,
      parentText: input.parentElement?.innerText || '',
      inputRect: input.getBoundingClientRect().toJSON(),
      parentRect: input.parentElement?.getBoundingClientRect().toJSON()
    })));
    const second = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: profile
    });
    await page.waitForTimeout(150);
    const prematurelyHidden = await page.locator('#payment-options').getAttribute('hidden');
    if (second.paymentConfirmationPending !== true || prematurelyHidden !== null) {
      fail(`card_reconciliation_did_not_mark_delayed_confirmation_pending:${JSON.stringify({ second, prematurelyHidden })}`);
    }
    await page.waitForTimeout(800);
    const summary = await page.locator('#payment-summary').textContent();
    const pickerHidden = await page.locator('#payment-options').getAttribute('hidden');
    const expectedCardSelected = await page.locator('input[name=payment]').nth(1).isChecked();
    const clickedCardRow = await page.locator('body').getAttribute('data-card-row-clicked');
    const paymentConfirmed = await page.locator('body').getAttribute('data-payment-confirmed');
    const finalReviewVisible = await page.locator('#final-review').isVisible();
    if (!second.completed || !/use this payment method/i.test(String(second.label || ''))) {
      fail(`card_reconciliation_did_not_confirm_matching_card:${JSON.stringify({ pickerSnapshot, second })}`);
    }
    if (!/6383/.test(String(summary || '')) || pickerHidden === null || !expectedCardSelected || clickedCardRow !== '6383' || paymentConfirmed !== 'true' || !finalReviewVisible) {
      fail(`card_reconciliation_dom_not_settled:${JSON.stringify({ summary, pickerHidden, expectedCardSelected, clickedCardRow, paymentConfirmed, finalReviewVisible, second })}`);
    }
    console.log(JSON.stringify({
      ok: true,
      version: manifest.version,
      initialCard: '0109',
      selectedCard: '6383',
      clickedControl: second.label,
      paymentPickerClosed: true
    }, null, 2));
    fs.rmSync(tempDir, { recursive: true, force: true });
  } finally {
    await context?.close().catch(() => null);
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
