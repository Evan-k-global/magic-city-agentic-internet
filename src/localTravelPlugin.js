import { writeExecutionArtifact } from './executionArtifacts.js';
import { shouldProcessExecutionSession, buildExecutionResult, describeCompletionState } from './executionRuntime.js';
import { runTravelExecutionInBrowser } from './browserExecution.js';
import { buildRoadTripProviderLinks, getRoadTripGuide } from './roadTripGuides.js';

const BASE_URL = process.env.MAGIC_CITY_BASE_URL || 'http://127.0.0.1:4411';
const API_KEY =
  process.env.MAGIC_CITY_PLUGIN_API_KEY ||
  String(process.env.PUBLIC_API_KEYS || '')
    .split(',')
    .map((value) => value.trim())
    .find(Boolean) ||
  '';
const PLUGIN_ID = process.env.MAGIC_CITY_TRAVEL_PLUGIN_ID || 'local-travel-plugin';
const OWNER_AGENT_ID = process.env.MAGIC_CITY_TRAVEL_PLUGIN_OWNER || 'travel-agent';
const POLL_MS = Math.max(1500, Number(process.env.MAGIC_CITY_PLUGIN_POLL_MS ?? 4000));
const RUN_ONCE = process.argv.includes('--once');

function resolveTravelMode(session) {
  const requested = String(
    session?.finalSelections?.travelMode
    || session?.selections?.travelMode
    || session?.handoffData?.defaults?.travelMode
    || 'itinerary_build'
  ).trim().toLowerCase();
  if (requested === 'checkout_handoff') return 'checkout_handoff';
  if (requested === 'road_trip_guidebook') return 'road_trip_guidebook';
  return 'itinerary_build';
}

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

function buildSearchLinks(session, flight, stay, browserExecution = null) {
  const providerLinks = Array.isArray(session.handoffData?.providerLinks) ? session.handoffData.providerLinks : [];
  const destination =
    session.handoffData?.defaults?.destination ||
    session.finalSelections?.destination ||
    session.selections?.destination ||
    'destination';
  const flightUrl = browserExecution?.flightSearchUrl || providerLinks.find((row) => /flight/i.test(row.label || ''))?.url || `https://www.google.com/search?q=${encodeURIComponent(flight)}`;
  const stayUrl = browserExecution?.staySearchUrl || providerLinks.find((row) => /stay|hotel/i.test(row.label || ''))?.url || `https://www.google.com/search?q=${encodeURIComponent(`${destination} ${stay}`)}`;
  const highlightsUrl = browserExecution?.highlightsUrl || providerLinks.find((row) => /highlight/i.test(row.label || ''))?.url || `https://www.google.com/search?q=${encodeURIComponent(`${destination} local food`)}`;
  return { flightUrl, stayUrl, highlightsUrl };
}

function buildTravelArtifact(session, selections, links, browserExecution = null) {
  const destination = session.handoffData?.defaults?.destination || selections.destination || 'Selected destination';
  const artifact = writeExecutionArtifact({
    sessionId: session.id,
    lane: 'travel',
    label: 'trip-package',
    extension: 'md',
    content: [
      `# Travel execution package`,
      ``,
      `- Session: ${session.id}`,
      `- Destination: ${destination}`,
      `- Goal: ${selections.tripGoal || session.handoffData?.defaults?.tripGoal || 'Travel planning'}`,
      `- Flight: ${selections.flight || 'Morning route'}`,
      `- Stay: ${selections.stay || 'Central stay'}`,
      `- Nights: ${selections.nights || '4 nights'}`,
      `- Flight search: ${links.flightUrl}`,
      `- Stay search: ${links.stayUrl}`,
      `- Local highlights: ${links.highlightsUrl}`,
      `- Live page title: ${browserExecution?.pageTitle || 'n/a'}`,
      `- Browser artifact hash: ${browserExecution?.screenshotHash || 'n/a'}`
    ].join('\n')
  });
  return {
    label: 'Trip package',
    url: artifact.url,
    sha256: artifact.sha256
  };
}

function buildRoadTripArtifact(session, selections, guide, links) {
  const artifact = writeExecutionArtifact({
    sessionId: session.id,
    lane: 'travel',
    label: 'road-trip-guidebook',
    extension: 'md',
    content: [
      `# ${guide.region} road trip guidebook`,
      '',
      `- Session: ${session.id}`,
      `- Route: ${guide.label}`,
      `- Theme: ${selections.roadTripInterests || guide.theme}`,
      `- Pacing: ${selections.roadTripPace || guide.defaultPace}`,
      `- Length: ${selections.roadTripLength || guide.defaultLength}`,
      `- Start / end: ${(selections.startCity || guide.startCity)} -> ${(selections.endCity || guide.endCity)}`,
      `- Route map: ${links.routeMapUrl}`,
      `- Stay search: ${links.staysUrl}`,
      `- Highlights search: ${links.highlightsUrl}`,
      '',
      '## Day-by-day route',
      ...guide.dayStops.flatMap((stop) => ([
        `### Day ${stop.day}`,
        `- Route: ${stop.route}`,
        `- Drive time: ${stop.driveTime}`,
        `- Highlights: ${stop.highlights.join(', ')}`,
        `- Meal stop: ${stop.mealStop}`,
        `- Overnight: ${stop.overnight}`,
        ''
      ]))
    ].join('\n')
  });
  return {
    label: 'Road trip guidebook',
    url: artifact.url,
    sha256: artifact.sha256
  };
}

function buildFulfillment(session, browserExecution = null) {
  const selections = session.finalSelections || session.selections || {};
  const travelMode = resolveTravelMode(session);
  const handoff = session.handoffData || {};
  if (travelMode === 'road_trip_guidebook') {
    const guide = getRoadTripGuide(selections.roadTripRoute || handoff.defaults?.roadTripRoute || '');
    const providerLinks = buildRoadTripProviderLinks(guide);
    const links = {
      routeMapUrl: providerLinks[0]?.url || '/',
      staysUrl: providerLinks[1]?.url || '/',
      highlightsUrl: providerLinks[2]?.url || '/'
    };
    const artifact = buildRoadTripArtifact(session, selections, guide, links);
    const nextHumanAction = 'Download the guidebook, open the route map, and use the stay or park searches to finish the trip locally.';
    return {
      status: 'fulfilled',
      result: buildExecutionResult({
        session,
        completionState: 'completed',
        nextHumanAction,
        artifacts: [artifact],
        extraResult: {
          travelMode: 'road_trip_guidebook',
          routeLabel: guide.label,
          routeTheme: selections.roadTripInterests || guide.theme,
          routePace: selections.roadTripPace || guide.defaultPace,
          routeLength: selections.roadTripLength || guide.defaultLength,
          startCity: selections.startCity || guide.startCity,
          endCity: selections.endCity || guide.endCity,
          roadTripLinks: links,
          dayStops: guide.dayStops
        }
      }),
      handoff: {
        label: 'Download road trip guidebook',
        url: artifact.url
      },
      notes: `${describeCompletionState(session.handoffData?.kind, 'completed', nextHumanAction)} Prepared by ${PLUGIN_ID} for ${handoff.title || `${guide.region} road trip guidebook`}.`,
      proofRef: `local-travel-plugin:${session.id}:road_trip_guidebook`
    };
  }
  const flight = selections.flight || 'Morning route';
  const stay = selections.stay || 'Central stay';
  const nights = selections.nights || '4 nights';
  const links = buildSearchLinks(session, flight, stay, browserExecution);
  const artifact = buildTravelArtifact(session, selections, links, browserExecution);
  const browserPreview = browserExecution?.previewArtifact
    ? {
        label: 'Live booking preview',
        url: browserExecution.previewArtifact.url,
        sha256: browserExecution.previewArtifact.sha256
      }
    : null;
  const completionState = browserExecution?.browserAvailable ? 'needs_user_confirmation' : 'ready_for_review';
  const nextHumanAction = browserExecution?.browserAvailable
    ? 'Open the prepared live flight search and click through to book the itinerary you want.'
    : 'Open the trip package and confirm your preferred flight and stay.';
  return {
    status: 'fulfilled',
    result: buildExecutionResult({
      session,
      completionState,
      nextHumanAction,
      artifacts: [artifact, browserPreview].filter(Boolean),
      extraResult: {
        flight,
        stay,
        nights,
        budget: '$1,450-$2,100',
        bookingState: browserExecution?.browserAvailable ? 'live_search_ready' : 'plugin_ready',
        searchLinks: links,
        bookingUrl: browserExecution?.finalUrl || links.flightUrl,
        browserExecution: browserExecution
          ? {
              mode: browserExecution.mode,
              pageTitle: browserExecution.pageTitle,
              screenshotHash: browserExecution.screenshotHash,
              previewArtifact: browserExecution.previewArtifact,
              finalUrl: browserExecution.finalUrl
            }
          : null
      }
    }),
    handoff: {
      label: browserExecution?.browserAvailable ? 'Open live flight search' : 'Review trip package',
      url: browserExecution?.finalUrl || links.flightUrl || artifact.url
    },
    notes: `${describeCompletionState(session.handoffData?.kind, completionState, nextHumanAction)} Prepared by ${PLUGIN_ID} for ${handoff.title || 'travel concierge'}.`,
    proofRef: `local-travel-plugin:${session.id}:${browserExecution?.mode || 'local'}`
  };
}

async function ensurePluginRegistration() {
  try {
    await api('/plugins/register', {
      method: 'POST',
      body: JSON.stringify({
        pluginId: PLUGIN_ID,
        ownerAgentId: OWNER_AGENT_ID,
        kind: 'travel',
        endpoint: `${BASE_URL}/plugins/${PLUGIN_ID}`,
        localOnly: true,
        capabilities: ['travel-agent', 'travel.build_itinerary'],
        tools: ['travel.search_flights', 'travel.search_hotels', 'travel.build_itinerary'],
        privacyModes: ['private'],
        helperAgents: ['flight-scout', 'stay-scout', 'itinerary-builder'],
        metadata: {
          runtime: 'local_worker',
          mode: RUN_ONCE ? 'once' : 'watch',
          executionAgent: true,
          executionBackend: 'travel_package'
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
  if (!shouldProcessExecutionSession(session, { kind: 'travel', pluginId: PLUGIN_ID })) return false;

  if (!session.claimedByPluginId) {
    await api(`/connectors/sessions/${session.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ pluginId: PLUGIN_ID })
    });
  }

  const travelMode = resolveTravelMode(session);
  await api(`/connectors/sessions/${session.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      label: travelMode === 'road_trip_guidebook' ? 'Planning road trip route' : 'Preparing live flight search',
      detail: travelMode === 'road_trip_guidebook'
        ? 'Building a road trip guidebook with day stops, drive times, and route links that feel more like an old AAA trip book than a fake checkout.'
        : 'Building a live booking search from the approved destination, home airport, and local travel window so the user can click straight into bookable results.',
      state: 'searching'
    })
  });

  let browserExecution;
  if (travelMode !== 'road_trip_guidebook') {
    try {
      browserExecution = await runTravelExecutionInBrowser(session, {
        onProgress: async (step) => {
          await api(`/connectors/sessions/${session.id}/checkpoint`, {
            method: 'POST',
            body: JSON.stringify({
              pluginId: PLUGIN_ID,
              label: step.label,
              detail: step.detail,
              state: step.state,
              browser: step.browser
            })
          });
        }
      });
    } catch (error) {
      browserExecution = {
        mode: 'browser_error',
        browserAvailable: false,
        notes: error instanceof Error ? error.message : 'browser_error'
      };
    }
  }

  await api(`/connectors/sessions/${session.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      label: travelMode === 'road_trip_guidebook' ? 'Compiling guidebook artifact' : 'Compiling trip package artifact',
      detail: travelMode === 'road_trip_guidebook'
        ? 'Saving the route, day stops, overnight areas, and map links into a durable guidebook you can reopen at any time.'
        : browserExecution.browserAvailable
          ? 'The live flight search is prepared. Saving the search links and preview artifact into a durable package you can reopen at any time.'
          : 'Saving the selected route, stay, and travel links into a durable package the user can reopen at any time.',
      state: 'packaging',
      browser: browserExecution?.currentBrowser || browserExecution?.previewArtifact
        ? {
            tool: 'browser',
            url: browserExecution.finalUrl || browserExecution.targetUrl || null,
            title: browserExecution.pageTitle || 'Live flight search',
            previewArtifact: browserExecution.previewArtifact || null
          }
        : null
    })
  });

  await api(`/connectors/sessions/${session.id}/fulfill`, {
    method: 'POST',
    body: JSON.stringify({
      pluginId: PLUGIN_ID,
      ...buildFulfillment(session, browserExecution)
    })
  });
  console.log(`[local-travel-plugin] fulfilled ${session.id}`);
  return true;
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
      console.error(`[local-travel-plugin] session ${session.id} failed: ${error.message}`);
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
  console.log(`[local-travel-plugin] watching ${BASE_URL} every ${POLL_MS}ms`);
  while (true) {
    try {
      await tick();
    } catch (error) {
      console.error(`[local-travel-plugin] ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error(`[local-travel-plugin] fatal: ${error.message}`);
  process.exitCode = 1;
});
