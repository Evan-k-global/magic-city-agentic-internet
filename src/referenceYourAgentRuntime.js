const BASE_URL = process.env.MAGIC_CITY_BASE_URL || 'http://127.0.0.1:4411';
const RUNTIME_TOKEN = String(process.env.MAGIC_CITY_AGENT_RUNTIME_TOKEN || '').trim();
const RUNTIME_ENDPOINT = String(process.env.MAGIC_CITY_AGENT_RUNTIME_ENDPOINT || '').trim() || null;
const POLL_MS = Math.max(3000, Number(process.env.MAGIC_CITY_AGENT_POLL_MS || 10000));

if (!RUNTIME_TOKEN) {
  console.error('[your-agent-runtime] missing MAGIC_CITY_AGENT_RUNTIME_TOKEN');
  process.exit(1);
}

function headers(extra = {}) {
  return {
    'content-type': 'application/json',
    'x-agent-runtime-token': RUNTIME_TOKEN,
    ...extra
  };
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: headers(options.headers || {})
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`invalid_json:${path}:${response.status}`);
  }
  if (!response.ok) throw new Error(data.error || `http_${response.status}`);
  return data;
}

function summarizeSession(session) {
  const kind = String(session?.kind || '').trim().toLowerCase();
  if (kind === 'travel') {
    const travel = session?.travelCheckout || {};
    return {
      kind,
      sessionId: session?.sessionId || travel.sessionId || 'unknown-session',
      title: travel.title || session?.title || 'Travel checkout',
      status: session?.status || travel.status || 'unknown',
      actionableCount: ['confirmed', 'queued', 'claimed', 'executing'].includes(String(session?.status || '').toLowerCase()) ? 1 : 0,
      actionable: [{
        sequence: 1,
        jobTitle: travel.destination || travel.title || 'Travel checkout',
        boardLabel: travel.executionOwnerLabel || 'Your Agent travel handoff',
        nextHumanAction: travel.nextHumanAction || 'Open the live travel targets locally and continue the checkout handoff.'
      }]
    };
  }
  const dashboard = session?.jobDashboard || {};
  const entries = Array.isArray(dashboard.entries) ? dashboard.entries : [];
  const actionable = entries.filter((row) => String(row.status || '').toLowerCase() === 'prepared_for_agent');
  return {
    kind: kind || 'job',
    sessionId: session?.sessionId || dashboard.sessionId || 'unknown-session',
    title: dashboard.title || session?.title || 'Application browser run',
    status: session?.status || dashboard.status || 'unknown',
    actionableCount: actionable.length,
    actionable
  };
}

async function heartbeat(currentSessionId = null) {
  return api('/your-agent/runtime/heartbeat', {
    method: 'POST',
    body: JSON.stringify({
      runtimeEndpoint: RUNTIME_ENDPOINT,
      currentSessionId
    })
  });
}

async function pollJobs() {
  return api('/your-agent/runtime/jobs');
}

async function main() {
  const seen = new Set();
  console.log(`[your-agent-runtime] connected to ${BASE_URL}`);
  console.log('[your-agent-runtime] polling for Magic City sessions prepared for Your Agent');

  while (true) {
    try {
      const data = await pollJobs();
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      const firstSessionId = sessions[0]?.sessionId || null;
      await heartbeat(firstSessionId).catch(() => null);
      for (const session of sessions) {
        const summary = summarizeSession(session);
        const key = `${summary.sessionId}:${summary.status}:${summary.actionableCount}`;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`\n[your-agent-runtime] session ${summary.sessionId}`);
        console.log(`kind: ${summary.kind}`);
        console.log(`title: ${summary.title}`);
        console.log(`status: ${summary.status}`);
        console.log(`actionable rows: ${summary.actionableCount}`);
        for (const row of summary.actionable) {
          console.log(`- ${row.sequence || '?'}: ${row.jobTitle || row.boardLabel || 'Application target'} · ${row.boardLabel || 'ATS'} · ${row.nextHumanAction || 'ready for local continuation'}`);
        }
      }
    } catch (error) {
      console.error(`[your-agent-runtime] ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error(`[your-agent-runtime] fatal: ${error.message}`);
  process.exit(1);
});
