import { runFoodExecutionInBrowser } from './browserExecution.js';
import { writeExecutionArtifact } from './executionArtifacts.js';
import { shouldProcessExecutionSession, buildExecutionResult, describeCompletionState } from './executionRuntime.js';

const BASE_URL = process.env.MAGIC_CITY_BASE_URL || 'http://127.0.0.1:4411';
const API_KEY =
  process.env.MAGIC_CITY_PLUGIN_API_KEY ||
  String(process.env.PUBLIC_API_KEYS || '')
    .split(',')
    .map((value) => value.trim())
    .find(Boolean) ||
  '';
const PLUGIN_ID = process.env.MAGIC_CITY_FOOD_PLUGIN_ID || 'local-food-plugin';
const OWNER_AGENT_ID = process.env.MAGIC_CITY_FOOD_PLUGIN_OWNER || 'food-delivery-agent';
const POLL_MS = Math.max(1500, Number(process.env.MAGIC_CITY_PLUGIN_POLL_MS ?? 4000));
const FOOD_BROWSER_TIMEOUT_MS = Math.max(10000, Number(process.env.MAGIC_CITY_FOOD_BROWSER_TIMEOUT_MS ?? 45000));
const RUN_ONCE = process.argv.includes('--once');

function headers() {
  return {
    'content-type': 'application/json',
    ...(API_KEY ? { 'x-api-key': API_KEY } : {})
  };
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {})
    }
  });
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const text = await response.text();
  if (!contentType.includes('application/json')) {
    const snippet = text.slice(0, 120).replace(/\s+/g, ' ').trim();
    throw new Error(`non_json_response:${path}:${response.status}:${contentType || 'unknown'}:${snippet}`);
  }
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`invalid_json:${path}:${response.status}:${String(error.message)}`);
  }
  if (!response.ok) {
    throw new Error(data.error || `http_${response.status}`);
  }
  return data;
}

function buildOrderArtifact(session, browserExecution, squarePaymentLinkUrl) {
  const selections = session.finalSelections || session.selections || {};
  const payment = session.paymentOrchestration || {};
  const servicePriceLabel = payment.fundingMode === 'direct_square'
    ? 'Direct merchant checkout'
    : payment.pricingLabel || `${Number(payment.requiredCredits || 0).toLocaleString()} credit${Number(payment.requiredCredits || 0) === 1 ? '' : 's'}`;
  const artifact = writeExecutionArtifact({
    sessionId: session.id,
    lane: 'food',
    label: 'order-summary',
    extension: 'md',
    content: [
      `# Food execution summary`,
      ``,
      `- Session: ${session.id}`,
      `- Mode: ${selections.deliveryMode || 'Delivery'}`,
      `- Restaurant: ${selections.restaurant || payment.restaurantName || 'Selected restaurant'}`,
      `- Primary item: ${selections.item1 || 'n/a'}${selections.item1Qty ? ` x${selections.item1Qty}` : ''}`,
      `- Secondary item: ${selections.item2 || 'n/a'}${selections.item2Qty ? ` x${selections.item2Qty}` : ''}`,
      `- Cart note: ${selections.cartNote || session.localContext?.orderText || 'n/a'}`,
      `- Subtotal: ${payment.subtotalUsd ? `$${Number(payment.subtotalUsd).toFixed(2)}` : 'n/a'}`,
      `- Magic City service price: ${servicePriceLabel}`,
      `- Provider: ${payment.provider || 'n/a'}`,
      `- Provider order URL: ${payment.orderUrl || browserExecution?.targetUrl || 'n/a'}`,
      `- Square checkout URL: ${squarePaymentLinkUrl || session.squarePaymentLink?.url || 'n/a'}`,
      `- Browser execution mode: ${browserExecution?.mode || 'none'}`,
      `- Browser page title: ${browserExecution?.pageTitle || 'n/a'}`,
      `- Browser artifact hash: ${browserExecution?.screenshotHash || 'n/a'}`,
      `- Cart prepared: ${browserExecution?.cartPrepared ? 'yes' : 'no'}`,
      `- Items added: ${Array.isArray(browserExecution?.itemsAdded) && browserExecution.itemsAdded.length ? browserExecution.itemsAdded.join(', ') : 'n/a'}`,
      `- Provider challenge detected: ${browserExecution?.providerChallenge ? 'yes' : 'no'}`
    ].join('\n')
  });
  return {
    label: 'Order summary',
    url: artifact.url,
    sha256: artifact.sha256
  };
}

function buildFulfillment(session, browserExecution = null, squarePaymentLinkUrl = null) {
  const selections = session.finalSelections || session.selections || {};
  const handoff = session.handoffData || {};
  const payment = session.paymentOrchestration || {};
  const orderMode = selections.deliveryMode || 'Delivery';
  const restaurant = selections.restaurant || payment.restaurantName || 'Selected restaurant';
  const cartNote = selections.cartNote || session.localContext?.orderText || '';
  const cartItems = [
    selections.item1 ? `${selections.item1}${selections.item1Qty ? ` x${selections.item1Qty}` : ''}` : '',
    selections.item2 ? `${selections.item2}${selections.item2Qty ? ` x${selections.item2Qty}` : ''}` : ''
  ].filter(Boolean);
  const handoffUrl =
    browserExecution?.finalUrl ||
    browserExecution?.targetUrl ||
    squarePaymentLinkUrl ||
    session.squarePaymentLink?.url ||
    payment.orderUrl ||
    session.resolvedOrderUrl ||
    session.taskPackage?.preferredTarget?.url ||
    '/';
  const orderArtifact = buildOrderArtifact(session, browserExecution, squarePaymentLinkUrl);
  const usingDirectSquare = payment.fundingMode === 'direct_square';
  const servicePriceLabel = payment.pricingLabel || `${Number(payment.requiredCredits || 0).toLocaleString()} credit${Number(payment.requiredCredits || 0) === 1 ? '' : 's'}`;
  const providerChallenge = Boolean(browserExecution?.providerChallenge);
  const cartPrepared = Boolean(browserExecution?.cartPrepared || (Array.isArray(browserExecution?.itemsAdded) && browserExecution.itemsAdded.length));
  const browserPrepared = Boolean(browserExecution?.browserAvailable);
  const fundingDisposition = squarePaymentLinkUrl
    ? 'none'
    : usingDirectSquare
      ? 'none'
      : providerChallenge
        ? 'release'
        : (cartPrepared || browserPrepared)
          ? 'hold'
          : 'release';
  const completionState = squarePaymentLinkUrl
    ? 'needs_user_payment'
    : providerChallenge
      ? 'failed'
      : (cartPrepared || browserPrepared)
        ? 'needs_user_confirmation'
        : 'ready_for_review';
  const nextHumanAction = squarePaymentLinkUrl
    ? 'Open direct Square checkout and confirm payment.'
    : providerChallenge
      ? 'The provider challenged automated checkout. Review the prepared order page yourself or switch to the direct merchant fallback.'
      : !usingDirectSquare && payment.requiredCredits > 0
        ? cartPrepared
          ? `Magic City is holding your ${servicePriceLabel} service checkout, not treating the order as done yet. Review the prepared provider cart, place the order, then confirm it in Magic City so the hold can be captured.`
          : `Magic City is holding your ${servicePriceLabel} service checkout while the order stays in a prepared state. If you place the order manually, confirm it in Magic City; otherwise release the hold.`
        : browserPrepared
          ? 'Review the prepared provider page and confirm the final order.'
          : 'Review the prepared order summary and continue from the provider page.';
  const result = buildExecutionResult({
    session,
    completionState,
    nextHumanAction,
    artifacts: [orderArtifact],
    extraResult: {
      restaurant,
      cartNote,
      cartItems,
      eta: '28-36 min',
      total: payment.subtotalUsd ? `$${Number(payment.subtotalUsd).toFixed(2)}` : '$26',
      orderMode,
      checkoutState: browserExecution?.browserAvailable ? 'provider_page_ready' : 'plugin_ready',
      orderProvider: payment.orderProvider || payment.provider || null,
      orderUrl: payment.orderUrl || browserExecution?.targetUrl || null,
      squarePaymentLinkUrl: squarePaymentLinkUrl || session.squarePaymentLink?.url || null,
      browserExecution: browserExecution
        ? {
            mode: browserExecution.mode || null,
            targetUrl: browserExecution.targetUrl || null,
            finalUrl: browserExecution.finalUrl || null,
            pageTitle: browserExecution.pageTitle || null,
            previewArtifact: browserExecution.previewArtifact || null,
            addressFilled: browserExecution.addressFilled ?? null,
            queryFilled: browserExecution.queryFilled ?? null,
            cartPrepared: browserExecution.cartPrepared ?? null,
            cartOpened: browserExecution.cartOpened ?? null,
            itemsAdded: Array.isArray(browserExecution.itemsAdded) ? browserExecution.itemsAdded : [],
            providerChallenge: browserExecution.providerChallenge ?? false,
            providerChallengeReason: browserExecution.providerChallengeReason || null
          }
        : null,
      browserExecutionMode: browserExecution?.mode || 'none',
      browserArtifactHash: browserExecution?.screenshotHash || null,
      browserPageTitle: browserExecution?.pageTitle || null,
      addressFilled: browserExecution?.addressFilled ?? null,
      queryFilled: browserExecution?.queryFilled ?? null,
      cartPrepared,
      itemsAdded: Array.isArray(browserExecution?.itemsAdded) ? browserExecution.itemsAdded : [],
      providerChallenge,
      needsFinalOrderConfirmation: fundingDisposition === 'hold',
      fundingDisposition
    }
  });
  return {
    status: completionState === 'failed' ? 'failed' : 'fulfilled',
    result,
    handoff: {
      label: squarePaymentLinkUrl ? 'Pay direct with Square' : cartPrepared ? 'Review prepared cart' : browserExecution?.browserAvailable ? 'Resume live checkout' : 'Open food checkout',
      url: squarePaymentLinkUrl || handoffUrl
    },
    notes: `${describeCompletionState(session.handoffData?.kind, completionState, nextHumanAction)} Prepared by ${PLUGIN_ID} for ${handoff.title || 'food checkout'}.`,
    fundingDisposition,
    proofRef: `local-food-plugin:${session.id}:${browserExecution?.mode || 'local'}`
  };
}

async function ensurePluginRegistration() {
  try {
    await api('/plugins/register', {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        ownerAgentId: OWNER_AGENT_ID,
        kind: 'food',
        endpoint: `${BASE_URL}/plugins/${PLUGIN_ID}`,
        localOnly: true,
        capabilities: ['food-delivery-agent', 'food.checkout_link'],
        tools: ['food.search_restaurants', 'food.build_cart', 'food.checkout_link'],
        privacyModes: ['private'],
        helperAgents: ['restaurant-scout', 'cart-builder', 'checkout-runner'],
        metadata: {
          runtime: 'local_worker',
          mode: RUN_ONCE ? 'once' : 'watch',
          executionAgent: true,
          executionBackend: 'browser_or_local_handoff'
        }
      })
    });
  } catch (error) {
    if (!String(error.message).includes('plugin')) {
      throw error;
    }
  }
}

async function processSession(session) {
  if (!shouldProcessExecutionSession(session, { kind: 'food', pluginId: PLUGIN_ID })) return false;
  const selections = session.selections || {};
  const orderMode = selections.deliveryMode || 'Delivery';

  if (!session.claimedByPluginId) {
    await api(`/connectors/sessions/${session.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ pluginId: PLUGIN_ID })
    });
  }

  await api(`/connectors/sessions/${session.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      label: 'Resolving Magic City order target',
      detail: session.paymentOrchestration?.provider === 'magic_city_catalog'
        ? 'Using the pinned Magic City 94107 catalog to resolve the restaurant, menu context, and best downstream order surface.'
        : orderMode === 'Reservation'
          ? 'Resolving reservation providers using the prepared restaurant, party size, and timing context.'
          : 'Comparing nearby delivery options using the prepared cuisine, budget, and timing context.',
      state: 'searching'
    })
  });

  let squarePaymentLinkUrl = session.paymentOrchestration?.fundingMode === 'direct_square'
    ? session.squarePaymentLink?.url || null
    : null;
  if (!squarePaymentLinkUrl && session.paymentOrchestration?.fundingMode === 'direct_square') {
    try {
      const square = await api(`/connectors/sessions/${session.id}/square-payment-link`, {
        method: 'POST',
        body: JSON.stringify({
          redirectUrl: `${BASE_URL}/?square=success&session=${encodeURIComponent(session.id)}`,
          mode: session.paymentOrchestration?.squareEnvironment || session.selections?.squareEnvironment || 'sandbox',
          fundingMode: session.paymentOrchestration?.fundingMode || session.selections?.paymentFundingMode || 'magic_city_credits',
          localPrivateInputs: {
            streetAddress: session.localPrivateContext?.streetAddress || '',
            zipCode: session.localPrivateContext?.zipCode || '',
            contactPhone: session.localPrivateContext?.contactPhone || ''
          }
        })
      });
      squarePaymentLinkUrl = square.paymentLinkUrl || null;
      await api(`/connectors/sessions/${session.id}/checkpoint`, {
        method: 'POST',
        body: JSON.stringify({
          pluginId: PLUGIN_ID,
          label: 'Square checkout prepared',
          detail: squarePaymentLinkUrl
            ? 'Generated a direct Square checkout so payment and execution can continue from the same session.'
            : 'Square is configured, but no hosted checkout link was returned for this session.',
          state: 'payment_ready'
        })
      });
    } catch (error) {
      await api(`/connectors/sessions/${session.id}/checkpoint`, {
        method: 'POST',
        body: JSON.stringify({
          pluginId: PLUGIN_ID,
          label: 'Square checkout unavailable',
          detail: error instanceof Error ? error.message : 'square_checkout_unavailable',
          state: 'payment_unavailable'
        })
      }).catch(() => {});
    }
  }

  await api(`/connectors/sessions/${session.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      label: orderMode === 'Reservation' ? 'Preparing reservation context' : 'Preparing checkout-ready cart',
      detail: orderMode === 'Reservation'
        ? 'Holding exact contact details behind the local privacy boundary while preparing the booking search context.'
        : 'Building the prepared cart and holding exact address details behind the local privacy boundary.',
      state: 'cart_ready'
    })
  });

  let browserExecution;
  if (squarePaymentLinkUrl) {
    browserExecution = {
      mode: 'square_checkout_ready',
      browserAvailable: false,
      targetUrl: squarePaymentLinkUrl,
      notes: 'Square checkout is ready, so browser automation is not needed for the primary payment path.'
    };
    await api(`/connectors/sessions/${session.id}/checkpoint`, {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        label: 'Direct Square checkout ready',
        detail: 'A direct Square checkout target is ready. Browser automation is held back unless the payment rail fails or a manual provider resume is needed.',
        state: 'payment_ready'
      })
    });
  } else {
    await api(`/connectors/sessions/${session.id}/checkpoint`, {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        label: 'Launching browser-backed fallback',
        detail: 'No API-grade checkout rail was available, so the agent is opening the downstream provider surface as a fallback path.',
        state: 'browser_launch'
      })
    });

    try {
      browserExecution = await Promise.race([
        runFoodExecutionInBrowser(session),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`browser_execution_timeout_after_${FOOD_BROWSER_TIMEOUT_MS}ms`)), FOOD_BROWSER_TIMEOUT_MS);
        })
      ]);
    } catch (error) {
      browserExecution = {
        mode: 'browser_step_failed',
        browserAvailable: false,
        targetUrl:
          session.paymentOrchestration?.orderUrl ||
          session.resolvedOrderUrl ||
          session.handoffData?.providerLinks?.find((link) => link?.preferredForExecution)?.url ||
          session.handoffData?.providerLinks?.[0]?.url ||
          null,
        notes: error instanceof Error ? error.message : 'browser_step_failed'
      };
    }

    await api(`/connectors/sessions/${session.id}/checkpoint`, {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        label: browserExecution.providerChallenge
          ? 'Provider challenged automation'
          : browserExecution.cartPrepared
            ? 'Prepared provider cart'
            : browserExecution.browserAvailable
              ? 'Live provider page prepared'
              : 'Execution ready for provider resume',
        detail: browserExecution.providerChallenge
          ? 'The provider blocked automated checkout before Magic City could safely finish the order. Credits will not be captured until a real order is confirmed.'
          : browserExecution.cartPrepared
            ? `Loaded ${browserExecution.pageTitle || 'live provider'}, added the prepared items, and held credits pending your final order confirmation.`
            : browserExecution.browserAvailable
              ? `Loaded ${browserExecution.pageTitle || 'live provider'}, applied address/search context where possible, and captured an execution artifact hash for the prepared session.`
              : browserExecution.notes || 'Prepared a provider target, but the browser adapter is not installed yet.',
        state: browserExecution.providerChallenge
          ? 'provider_challenge'
          : browserExecution.cartPrepared
            ? 'cart_ready'
            : browserExecution.browserAvailable
              ? 'provider_ready'
              : 'resume_ready'
      })
    });
  }

  await api(`/connectors/sessions/${session.id}/fulfill`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      ...buildFulfillment(session, browserExecution, squarePaymentLinkUrl)
    })
  });
  console.log(`[local-food-plugin] fulfilled ${session.id}`);
  return true;
}

async function markSessionFailed(session, error) {
  const message = error instanceof Error ? error.message : String(error || 'food_execution_failed');
  try {
    if (!session?.claimedByPluginId) {
      await api(`/connectors/sessions/${session.id}/claim`, {
        method: 'POST',
        body: JSON.stringify({ pluginId: PLUGIN_ID })
      }).catch(() => null);
    }
    await api(`/connectors/sessions/${session.id}/checkpoint`, {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        label: 'Food execution failed',
        detail: message,
        state: 'failed'
      })
    }).catch(() => null);
    await api(`/connectors/sessions/${session.id}/fulfill`, {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        status: 'failed',
        notes: `Food execution failed before a prepared handoff could complete. ${message}`.trim(),
        fundingDisposition: 'release',
        result: {
          completionState: 'failed',
          nextHumanAction: 'Review the session details, then retry or switch to direct merchant checkout.',
          error: message
        },
        handoff: {}
      })
    }).catch(() => null);
  } catch {
    // if this fallback also fails, keep the original worker error in logs
  }
}

async function tick() {
  const { sessions } = await api('/connectors/sessions');
  let processed = 0;
  for (const session of sessions) {
    try {
      const changed = await processSession(session);
      if (changed) processed += 1;
    } catch (error) {
      if (String(error.message).includes('session_claimed_by_other_plugin')) continue;
      await markSessionFailed(session, error);
      console.error(`[local-food-plugin] session ${session.id} failed: ${error.message}`);
    }
  }
  return processed;
}

async function main() {
  if (!API_KEY) {
    throw new Error('missing_plugin_api_key');
  }
  await ensurePluginRegistration();
  if (RUN_ONCE) {
    await tick();
    return;
  }
  console.log(`[local-food-plugin] watching ${BASE_URL} every ${POLL_MS}ms`);
  while (true) {
    try {
      await tick();
    } catch (error) {
      console.error(`[local-food-plugin] ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error(`[local-food-plugin] fatal: ${error.message}`);
  process.exitCode = 1;
});
