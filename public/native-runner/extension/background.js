import * as legacyController from './background-v0.2.js';

// v0.3.1 lean gateway. The compatibility controller is statically imported
// because MV3 does not support dynamic import() in extension service workers.
// The gateway owns wake/execution policy; the controller owns the proven 0.2.x
// browser protocol and checkout behavior.
const POLL_ALARM = 'magic-city-runner-poll';
const RESUME_ALARM = 'magic-city-runner-resume';
const POLL_PERIOD_MINUTES = 1;
const ACTIVE_MISSION_CONTINUATION_DELAY_MS = 30_000;
const LEAN_RUNTIME_MODE = 'v0.4.1-durable-recovery';
const ALLOWED_EXTERNAL_ORIGINS = new Set([
  'https://magic-city.ai',
  'https://magic-city-staging.fly.dev'
]);

async function setLeanRuntimeMode() {
  await chrome.storage.local.set({ runtimeMode: LEAN_RUNTIME_MODE });
}

async function hasPairedDevice() {
  const config = await chrome.storage.local.get({ deviceToken: '' });
  return Boolean(config.deviceToken);
}

async function ensureHeartbeatAlarm() {
  if (await hasPairedDevice()) {
    await chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MINUTES });
  } else {
    await chrome.alarms.clear(POLL_ALARM);
  }
}

async function clearLegacyResumeAlarm() {
  await chrome.alarms.clear(RESUME_ALARM);
}

async function dispatch(message, sender = null) {
  const result = await legacyController.handleMessage(message, sender);
  await ensureHeartbeatAlarm();
  return result;
}

async function dispatchAlarm(alarm = null) {
  if (!await hasPairedDevice()) return;
  if (alarm?.name === RESUME_ALARM) {
    // Resume only the session that was already authorized and persisted by
    // the executor. This is recovery, not autonomous mission discovery.
    const result = await legacyController.resumeActiveRun();
    // If the original worker is still finishing an action, leave one quiet
    // continuation behind it. If that worker is suspended later, the alarm
    // resumes the already-signed next plan step instead of losing the run.
    if (result?.status === 'already_running') {
      await chrome.alarms.create(RESUME_ALARM, {
        when: Date.now() + ACTIVE_MISSION_CONTINUATION_DELAY_MS
      });
    }
    return result;
  }
  const { activeSessionId = '', activeRun = null } = await chrome.storage.local.get({ activeSessionId: '', activeRun: null });
  const activeRunSessionId = String(activeRun?.sessionId || activeSessionId || '').trim();
  if (activeRunSessionId) {
    // A worker restart may clear the one-shot alarm. Recover only this
    // already-authorized session; ordinary heartbeats remain poll-only.
    return legacyController.resumeActiveRun();
  }
  // A heartbeat may resume only a short-lived, user-authorized dispatch.
  // It is recovery for a missed website wake, never open-ended discovery.
  await legacyController.pollOnly();
}

async function bootLeanRuntime() {
  await setLeanRuntimeMode();
  const { activeSessionId = '', activeRun = null } = await chrome.storage.local.get({ activeSessionId: '', activeRun: null });
  if (String(activeRun?.sessionId || activeSessionId || '').trim()) {
    // Preserve recovery across a service-worker restart. The marker is set
    // only after the user-approved mission has been claimed.
    await chrome.alarms.create(RESUME_ALARM, { when: Date.now() + 1_000 });
  } else {
    await clearLegacyResumeAlarm();
  }
  await ensureHeartbeatAlarm();
}

chrome.runtime.onInstalled.addListener(() => { void bootLeanRuntime(); });

chrome.runtime.onStartup.addListener(() => { void bootLeanRuntime(); });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (![POLL_ALARM, RESUME_ALARM].includes(alarm.name)) return;
  try {
    await dispatchAlarm(alarm);
  } catch (error) {
    await chrome.storage.local.set({
      lastError: error?.message || String(error),
      lastExecution: { status: 'heartbeat_failed', at: new Date().toISOString() }
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  dispatch(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  (async () => {
    let origin = '';
    try {
      origin = new URL(sender?.url || sender?.origin || '').origin;
    } catch {
      origin = '';
    }
    if (!ALLOWED_EXTERNAL_ORIGINS.has(origin)) throw new Error('origin_not_allowed');
    // Keep the external message open through the exact-session claim. MV3
    // can suspend detached promises after sendResponse, so a fire-and-forget
    // wake is not a valid execution boundary. The page handles its brief
    // pending state while this user-authorized run starts.
    return dispatch(message, { origin });
  })()
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
