import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sourceDir = process.env.MAGIC_CITY_EXTENSION_SOURCE
  ? path.resolve(process.env.MAGIC_CITY_EXTENSION_SOURCE)
  : path.join(rootDir, 'public/native-runner/extension');

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
            <button id="use-payment-method" onclick="document.body.dataset.paymentConfirmClicks=String(Number(document.body.dataset.paymentConfirmClicks||0)+1); const selected=document.querySelector('input[name=payment]:checked'); setTimeout(() => { document.querySelector('#payment-summary').textContent=selected.parentElement.innerText; document.querySelector('#payment-options').hidden=true; document.querySelector('#final-review').hidden=false; document.body.dataset.paymentConfirmed='true' }, 650)">Use this payment method</button>
            <button id="use-payment-method-sidebar" onclick="document.body.dataset.paymentConfirmClicks=String(Number(document.body.dataset.paymentConfirmClicks||0)+1); const selected=document.querySelector('input[name=payment]:checked'); setTimeout(() => { document.querySelector('#payment-summary').textContent=selected.parentElement.innerText; document.querySelector('#payment-options').hidden=true; document.querySelector('#final-review').hidden=false; document.body.dataset.paymentConfirmed='true' }, 650)">Use this payment method</button>
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
    const reconcileAction = {
      id: 'reconcile-payment-profile',
      receiptScope: 'test-plan:reconcile-payment-profile',
      type: 'fill_checkout_profile',
      primeRequired: true
    };
    const first = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: reconcileAction,
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
      action: reconcileAction,
      checkoutProfile: profile
    });
    await page.waitForTimeout(150);
    const prematurelyHidden = await page.locator('#payment-options').getAttribute('hidden');
    if (second.paymentConfirmationPending !== true || prematurelyHidden !== null) {
      fail(`card_reconciliation_did_not_mark_delayed_confirmation_pending:${JSON.stringify({ second, prematurelyHidden })}`);
    }
    const pendingRecheck = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: reconcileAction,
      checkoutProfile: profile
    });
    const confirmationReceiptsWhilePending = (pendingRecheck.state?.checkoutSummary?.browserActionReceipts || [])
      .filter((receipt) => receipt.kind === 'payment_confirm'
        && receipt.actionId === reconcileAction.id
        && receipt.receiptScope === reconcileAction.receiptScope).length;
    if (pendingRecheck.paymentConfirmationPending !== true
      || pendingRecheck.paymentConfirmationAlreadyRequested !== true
      || confirmationReceiptsWhilePending !== 1) {
      fail(`card_reconciliation_repeated_pending_confirmation:${JSON.stringify({ pendingRecheck, confirmationReceiptsWhilePending })}`);
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

    const setSharedPaymentFixture = async (rows) => {
      await page.setContent(`<!doctype html>
        <style>label { display: block; min-height: 36px; } input { width: 18px; height: 18px; }</style>
        <main>
          <h1>Review checkout</h1>
          <section aria-label="Delivery address">
            <h2>Delivering to Test User</h2>
            <p>1 Magic City Way, San Francisco, CA 94107, United States</p>
          </section>
          <section id="payment-method" aria-label="Payment method">
            <h2>Payment method</h2>
            ${rows.join('\n')}
          </section>
          <p>Items: $2.97</p>
          <p>Shipping &amp; handling: $0.00</p>
          <p>Order total: $2.97</p>
          <button hidden>Place your order</button>
        </main>`);
      await page.evaluate(() => {
        window.__paymentClicks = [];
        document.querySelectorAll('input[name="payment"]').forEach((input) => {
          input.addEventListener('click', () => window.__paymentClicks.push(input.value));
        });
      });
    };

    await setSharedPaymentFixture([
      '<label><input type="radio" name="payment" value="6383" /> Mastercard ending in 6383</label>',
      '<label><input type="radio" name="payment" value="1817" /> Mastercard ending in 1817</label>',
      '<label><input type="radio" name="payment" value="0109" checked /> Visa ending in 0109</label>'
    ]);
    const sharedBefore = await command({
      type: 'MAGIC_CITY_BROWSER_STATE',
      checkoutProfile: profile
    });
    const sharedSelection = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: profile
    });
    const sharedAfter = await page.evaluate(() => ({
      selected: document.querySelector('input[name="payment"]:checked')?.value || '',
      clicks: window.__paymentClicks
    }));
    if (sharedBefore.checkoutSummary?.selectedCardLast4 !== '0109' || sharedBefore.checkoutSummary?.cardMatches !== false) {
      fail(`shared_payment_initial_selection_misreported:${JSON.stringify(sharedBefore.checkoutSummary)}`);
    }
    if (sharedAfter.selected !== '6383'
      || JSON.stringify(sharedAfter.clicks) !== JSON.stringify(['6383'])
      || !sharedSelection.checkoutSelections?.includes('matching payment card')
      || sharedSelection.state?.checkoutSummary?.cardMatches !== true) {
      fail(`shared_payment_row_binding_failed:${JSON.stringify({ sharedSelection, sharedAfter })}`);
    }

    await page.setContent(`<!doctype html>
      <style>
        #payment-method { display: grid; grid-template-columns: 32px 1fr; grid-auto-rows: 48px; align-items: center; }
        #payment-method h2 { grid-column: 1 / 3; }
        #payment-method input { width: 18px; height: 18px; }
        .card-detail { min-height: 30px; }
      </style>
      <main>
        <h1>Review checkout</h1>
        <section aria-label="Delivery address"><h2>Delivering to Test User</h2><p>1 Magic City Way, San Francisco, CA 94107, United States</p></section>
        <section id="payment-method" aria-label="Payment method">
          <h2>Payment method</h2>
          <input style="grid-row:2" type="radio" name="payment" value="0109" checked />
          <input style="grid-row:3" type="radio" name="payment" value="6383" />
          <input style="grid-row:4" type="radio" name="payment" value="1817" />
          <div style="grid-row:2" class="card-detail">Visa ending in 0109</div>
          <div style="grid-row:3" class="card-detail">Mastercard ending in 6383</div>
          <div style="grid-row:4" class="card-detail">Mastercard ending in 1817</div>
        </section>
        <p>Items: $2.97</p><p>Shipping &amp; handling: $0.00</p><p>Order total: $2.97</p>
      </main>`);
    await page.evaluate(() => {
      window.__paymentClicks = [];
      document.querySelectorAll('input[name="payment"]').forEach((input) => {
        input.addEventListener('click', () => window.__paymentClicks.push(input.value));
      });
    });
    const splitColumnSelection = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: profile
    });
    const splitColumnAfter = await page.evaluate(() => ({
      selected: document.querySelector('input[name="payment"]:checked')?.value || '',
      clicks: window.__paymentClicks
    }));
    if (splitColumnAfter.selected !== '6383'
      || JSON.stringify(splitColumnAfter.clicks) !== JSON.stringify(['6383'])
      || !splitColumnSelection.checkoutSelections?.includes('matching payment card')
      || splitColumnSelection.state?.checkoutSummary?.cardMatches !== true) {
      fail(`split_column_payment_row_binding_failed:${JSON.stringify({ splitColumnSelection, splitColumnAfter })}`);
    }

    await setSharedPaymentFixture([
      '<label><input type="radio" name="payment" value="6383-a" /> Mastercard ending in 6383</label>',
      '<label><input type="radio" name="payment" value="6383-b" /> Backup Mastercard ending in 6383</label>',
      '<label><input type="radio" name="payment" value="0109" checked /> Visa ending in 0109</label>'
    ]);
    const duplicateSelection = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: profile
    });
    const duplicateAfter = await page.evaluate(() => ({
      selected: document.querySelector('input[name="payment"]:checked')?.value || '',
      clicks: window.__paymentClicks
    }));
    if (duplicateAfter.selected !== '0109' || duplicateAfter.clicks.length || duplicateSelection.checkoutSelections?.includes('matching payment card')) {
      fail(`duplicate_payment_ending_was_not_rejected:${JSON.stringify({ duplicateSelection, duplicateAfter })}`);
    }

    await setSharedPaymentFixture([
      '<label><input type="radio" name="payment" value="6383" /> Mastercard ending in 6383 - Expired</label>',
      '<label><input type="radio" name="payment" value="0109" checked /> Visa ending in 0109</label>'
    ]);
    const expiredSelection = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: { type: 'fill_checkout_profile', primeRequired: true },
      checkoutProfile: profile
    });
    const expiredAfter = await page.evaluate(() => ({
      selected: document.querySelector('input[name="payment"]:checked')?.value || '',
      clicks: window.__paymentClicks
    }));
    if (expiredAfter.selected !== '0109' || expiredAfter.clicks.length || expiredSelection.checkoutSelections?.includes('matching payment card')) {
      fail(`expired_payment_card_was_not_rejected:${JSON.stringify({ expiredSelection, expiredAfter })}`);
    }

    const assertSelectedInvalidCardRejected = async ({ name, selectedRow }) => {
      await page.setContent(`<!doctype html>
        <style>label { display: block; min-height: 36px; } input { width: 18px; height: 18px; }</style>
        <main>
          <h1>Review checkout</h1>
          <section aria-label="Delivery address"><h2>Delivering to Test User</h2><p>1 Magic City Way, San Francisco, CA 94107, United States</p></section>
          <section id="payment-method" aria-label="Payment method">
            <h2>Payment method</h2>
            ${selectedRow}
            <label><input type="radio" name="payment" value="0109" /> Visa ending in 0109</label>
            <button id="use-invalid-payment" onclick="document.body.dataset.invalidPaymentConfirmClicks=String(Number(document.body.dataset.invalidPaymentConfirmClicks||0)+1)">Use this payment method</button>
          </section>
          <p>Items: $2.97</p><p>Shipping &amp; handling: $0.00</p><p>Order total: $2.97</p>
        </main>`);
      const action = {
        id: `reject-${name}`,
        receiptScope: `test-plan:reject-${name}`,
        type: 'fill_checkout_profile',
        primeRequired: true
      };
      const outcome = await command({
        type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
        action,
        checkoutProfile: profile
      });
      const confirmationClicks = Number(await page.locator('body').getAttribute('data-invalid-payment-confirm-clicks') || 0);
      if (confirmationClicks !== 0
        || outcome.paymentConfirmationPending === true
        || outcome.checkoutSelections?.some((selection) => /^confirm .*payment card$/i.test(String(selection || '')))
        || outcome.state?.checkoutSummary?.cardMatches === true) {
        fail(`selected_invalid_payment_card_was_approved:${JSON.stringify({ name, outcome, confirmationClicks })}`);
      }
    };

    await assertSelectedInvalidCardRejected({
      name: 'expired',
      selectedRow: '<label><input type="radio" name="payment" value="6383" checked /> Mastercard ending in 6383 - Expired</label>'
    });
    await assertSelectedInvalidCardRejected({
      name: 'disabled',
      selectedRow: '<label><input type="radio" name="payment" value="6383" checked disabled /> Mastercard ending in 6383</label>'
    });
    await assertSelectedInvalidCardRejected({
      name: 'ambiguous',
      selectedRow: '<label><input type="radio" name="payment" value="6383" checked /> Mastercard ending in 6383; backup card ending in 1817</label>'
    });

    await page.setContent(`<!doctype html>
      <style>label { display: block; min-height: 36px; } input { width: 18px; height: 18px; }</style>
      <main>
        <h1>Review checkout</h1>
        <section aria-label="Delivery address"><h2>Delivering to Test User</h2><p>1 Magic City Way, San Francisco, CA 94107, United States</p></section>
        <section id="duplicate-selected-payment" aria-label="Payment method">
          <h2>Payment method</h2>
          <label><input type="radio" name="payment" value="6383-primary" checked /> Mastercard ending in 6383</label>
          <label><input type="radio" name="payment" value="6383-secondary" /> Business Mastercard ending in 6383</label>
          <label><input type="radio" name="payment" value="0109" /> Visa ending in 0109</label>
          <button id="use-duplicate-selected-payment" onclick="document.body.dataset.duplicateSelectedConfirmClicks=String(Number(document.body.dataset.duplicateSelectedConfirmClicks||0)+1)">Use this payment method</button>
        </section>
        <p>Items: $2.97</p><p>Shipping &amp; handling: $0.00</p><p>Order total: $2.97</p>
      </main>`);
    const duplicateSelectedOutcome = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: {
        id: 'reject-duplicate-selected-ending',
        receiptScope: 'test-plan:reject-duplicate-selected-ending',
        type: 'fill_checkout_profile',
        primeRequired: true
      },
      checkoutProfile: profile
    });
    const duplicateSelectedConfirmClicks = Number(
      await page.locator('body').getAttribute('data-duplicate-selected-confirm-clicks') || 0
    );
    if (duplicateSelectedConfirmClicks !== 0
      || duplicateSelectedOutcome.paymentConfirmationPending === true
      || duplicateSelectedOutcome.checkoutSelections?.some((selection) => /^confirm .*payment card$/i.test(String(selection || '')))
      || duplicateSelectedOutcome.state?.checkoutSummary?.cardMatches === true) {
      fail(`duplicate_selected_payment_ending_was_approved:${JSON.stringify({ duplicateSelectedOutcome, duplicateSelectedConfirmClicks })}`);
    }

    await page.setContent(`<!doctype html>
      <style>label { display: block; min-height: 36px; } input { width: 18px; height: 18px; }</style>
      <main>
        <h1>Review checkout</h1>
        <section aria-label="Delivery address"><h2>Delivering to Test User</h2><p>1 Magic City Way, San Francisco, CA 94107, United States</p></section>
        <section aria-label="Payment method">
          <h2 id="stale-payment-summary">Paying with Visa 0109</h2>
          <button id="stale-change-payment" onclick="document.body.dataset.staleChangeClicks=String(Number(document.body.dataset.staleChangeClicks||0)+1); document.querySelector('#stale-payment-options').hidden=false">Change payment method</button>
          <div id="stale-payment-options">
            <label><input type="radio" name="payment" value="0109" /> Visa ending in 0109</label>
            <label><input type="radio" name="payment" value="6383" checked /> Mastercard ending in 6383</label>
            <button id="stale-use-payment" onclick="document.body.dataset.staleConfirmClicks=String(Number(document.body.dataset.staleConfirmClicks||0)+1); document.querySelector('#stale-payment-options').hidden=true; setTimeout(() => { document.querySelector('#stale-payment-summary').textContent='Paying with Mastercard 6383'; document.querySelector('#stale-final-review').hidden=false; }, 700)">Use this payment method</button>
          </div>
        </section>
        <p>Items: $2.97</p><p>Shipping &amp; handling: $0.00</p><p>Order total: $2.97</p>
        <button id="stale-final-review" hidden>Place your order</button>
      </main>`);
    const staleAction = {
      id: 'stale-payment-confirmation',
      receiptScope: 'test-plan:stale-payment-confirmation',
      type: 'fill_checkout_profile',
      primeRequired: true
    };
    const staleConfirmation = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: staleAction,
      checkoutProfile: profile
    });
    const stalePending = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: staleAction,
      checkoutProfile: profile
    });
    const staleTransitionSnapshot = {
      pickerHidden: await page.locator('#stale-payment-options').getAttribute('hidden'),
      changeClicks: Number(await page.locator('body').getAttribute('data-stale-change-clicks') || 0),
      confirmClicks: Number(await page.locator('body').getAttribute('data-stale-confirm-clicks') || 0)
    };
    if (staleConfirmation.paymentConfirmationPending !== true
      || stalePending.paymentConfirmationPending !== true
      || stalePending.paymentConfirmationAlreadyRequested !== true
      || staleTransitionSnapshot.pickerHidden === null
      || staleTransitionSnapshot.changeClicks !== 0
      || staleTransitionSnapshot.confirmClicks !== 1) {
      fail(`stale_payment_summary_reopened_picker:${JSON.stringify({ staleConfirmation, stalePending, staleTransitionSnapshot })}`);
    }
    await page.waitForTimeout(800);
    const staleSettled = await command({
      type: 'MAGIC_CITY_EXECUTE_PLAN_STEP',
      action: staleAction,
      checkoutProfile: profile
    });
    const staleSettledChangeClicks = Number(await page.locator('body').getAttribute('data-stale-change-clicks') || 0);
    if (staleSettled.state?.checkoutSummary?.finalReviewReady !== true || staleSettledChangeClicks !== 0) {
      fail(`stale_payment_summary_did_not_settle:${JSON.stringify({ staleSettled, staleSettledChangeClicks })}`);
    }
    console.log(JSON.stringify({
      ok: true,
      version: manifest.version,
      initialCard: '0109',
      selectedCard: '6383',
      clickedControl: second.label,
      paymentPickerClosed: true,
      paymentConfirmationReceipts: confirmationReceiptsWhilePending,
      sharedContainerClickSequence: sharedAfter.clicks,
      splitColumnClickSequence: splitColumnAfter.clicks,
      duplicateEndingRejected: true,
      expiredCardRejected: true,
      selectedInvalidCardsRejected: ['expired', 'disabled', 'ambiguous'],
      duplicateSelectedEndingRejected: true,
      staleSummaryPickerReopened: false
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
