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
        <h1>Select a delivery address</h1>
        <section id="delivery-addresses" aria-label="Delivery addresses">
          <div class="address-choice" data-address-id="saved-matching-address">
            <input type="radio" name="address" checked style="display:none" />
            <div>
              <strong>Andreessen Horowitz</strong>
              <p>2865 SAND HILL RD STE 101, MENLO PARK, CA, 94025-7022, United States</p>
              <p>Phone number: (650) 798-5800</p>
            </div>
          </div>
          <div class="address-choice" data-address-id="other-address">
            <input type="radio" name="address" style="display:none" />
            <div>
              <strong>Other Recipient</strong>
              <p>180 TOWNSEND ST, SAN FRANCISCO, CA, 94107-2588, United States</p>
            </div>
          </div>
        </section>
        <button id="deliver-address" onclick="document.body.dataset.addressConfirmed='true'; document.querySelector('#delivery-summary').textContent='Delivering to Andreessen Horowitz, 2865 Sand Hill Road, Menlo Park, CA 94025'">Deliver to this address</button>
        <aside>
          <p id="delivery-summary">Select a delivery address</p>
          <p>Items: $2.97</p>
          <p>Shipping &amp; handling: $0.00</p>
          <p>Order total: $2.97</p>
        </aside>
      </main>`);
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
    await page.goto(baseUrl);
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
    const matchingInputChecked = await page.locator('[data-address-id="saved-matching-address"] input').isChecked();
    const otherInputChecked = await page.locator('[data-address-id="other-address"] input').isChecked();
    const summary = await page.locator('#delivery-summary').textContent();
    if (!outcome?.completed || !/deliver to this address/i.test(String(outcome.label || ''))) {
      fail(`address_reconciliation_did_not_confirm_selected_address:${JSON.stringify(outcome)}`);
    }
    if (confirmed !== 'true' || !matchingInputChecked || otherInputChecked || !/2865 Sand Hill/i.test(String(summary || ''))) {
      fail(`address_reconciliation_dom_not_settled:${JSON.stringify({ confirmed, matchingInputChecked, otherInputChecked, summary, outcome })}`);
    }
    console.log(JSON.stringify({
      ok: true,
      version: manifest.version,
      selectedAddress: '2865 SAND HILL RD STE 101',
      vaultAddress: '2865 Sand Hill Road',
      zipVariantAccepted: true,
      addressConfirmationClicked: true
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
