const $ = (id) => document.getElementById(id);

function setStatus(message) {
  $('status').textContent = message;
}

function setPairedUi(paired) {
  $('pairingSetup').hidden = paired;
  $('missionActions').hidden = !paired;
  $('advancedActions').hidden = !paired;
}

function setMissionButton({ label = 'Allow site and start', disabled = false } = {}) {
  const button = $('allowStartBtn');
  if (!button) return;
  button.textContent = label;
  button.disabled = Boolean(disabled);
}

function send(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (!response?.ok) throw new Error(response?.error || 'extension_request_failed');
    return response.result;
  });
}

async function getPendingMissionSite() {
  const pending = await send({ type: 'GET_PENDING_MISSION_SITE' });
  if (!pending?.origin || !pending?.domain) throw new Error('No browser mission is waiting for site access.');
  return pending;
}

async function refreshStatus() {
  const result = await send({ type: 'CHECK_STATUS' });
  const config = result.config || {};
  const poll = result.poll || {};
  if (!poll.paired && !config.deviceId) {
    setPairedUi(false);
    setStatus('Not paired. Start setup in Magic City Settings, then paste the code here.');
    return;
  }
  setPairedUi(true);
  const lastPoll = config.lastPollAt ? new Date(config.lastPollAt).toLocaleTimeString() : 'just now';
  const count = Number(poll.actionableCount || poll.sessions?.length || 0) || 0;
  const enabledSites = Array.isArray(result.origins) && result.origins.length
    ? ` Browser access: ${result.origins.length} site${result.origins.length === 1 ? '' : 's'} enabled.`
    : '';
  let pending = null;
  try {
    pending = await getPendingMissionSite();
  } catch {
    pending = null;
  }
  if (pending?.domain) {
    setMissionButton({
      label: pending.alreadyGranted ? `Start ${pending.domain}` : `Allow ${pending.domain} and start`,
      disabled: false
    });
    setStatus(`Connected to ${config.baseUrl}. ${pending.domain} is waiting. Last checked ${lastPoll}.${enabledSites}`);
    return;
  }
  setMissionButton({ label: 'No waiting mission', disabled: true });
  setStatus(`Connected to ${config.baseUrl}. No waiting mission right now. Click Run agent in Magic City, then reopen this popup if Chrome asks for site access.${enabledSites}`);
}

document.addEventListener('DOMContentLoaded', async () => {
  const config = await chrome.storage.local.get({ baseUrl: 'https://magic-city.ai', deviceId: '' });
  $('baseUrl').value = config.baseUrl || 'https://magic-city.ai';
  if (config.deviceId) {
    setPairedUi(true);
    setMissionButton({ label: 'Checking mission...', disabled: true });
    setStatus(`Paired device ${config.deviceId}.`);
    refreshStatus().catch((error) => setStatus(error?.message || String(error)));
  } else {
    setPairedUi(false);
  }
});

$('pairBtn').addEventListener('click', async () => {
  try {
    setStatus('Pairing...');
    await send({
      type: 'PAIR_WITH_CODE',
      baseUrl: $('baseUrl').value,
      code: $('pairingCode').value
    });
    await refreshStatus();
  } catch (error) {
    setStatus(error?.message || String(error));
  }
});

$('statusBtn').addEventListener('click', async () => {
  try {
    setStatus('Checking...');
    await refreshStatus();
  } catch (error) {
    setStatus(error?.message || String(error));
  }
});

$('allowStartBtn').addEventListener('click', async () => {
  const button = $('allowStartBtn');
  try {
    button.disabled = true;
    setStatus('Finding the waiting mission...');
    const pending = await getPendingMissionSite();
    let granted = Boolean(pending.alreadyGranted);
    if (!granted) {
      setStatus(`Chrome will ask for access to ${pending.domain}. Approve it to start the mission.`);
      granted = await chrome.permissions.request({ origins: [pending.origin] });
    }
    if (!granted) throw new Error(`Browser access for ${pending.domain} was not granted.`);
    setStatus(`Browser access enabled for ${pending.domain}. Starting the mission...`);
    const result = await send({ type: 'START_PENDING_MISSION_SITE', sessionId: pending.sessionId });
    const status = String(result.execution?.status || 'started').replace(/_/g, ' ');
    setStatus(`Browser access enabled for ${result.domain}. Mission ${status}.`);
    await refreshStatus();
  } catch (error) {
    setStatus(error?.message || String(error));
    await refreshStatus().catch(() => {});
  } finally {
    if (button.textContent !== 'No waiting mission') button.disabled = false;
  }
});

$('runBtn').addEventListener('click', async () => {
  try {
    setStatus('Running the pending mission...');
    const result = await send({ type: 'RUN_PENDING_SESSIONS' });
    const latest = (result.executed || [])[0];
    setStatus(latest ? `Mission ${latest.sessionId}: ${String(latest.status || 'started').replace(/_/g, ' ')}.` : 'No pending browser mission.');
    await refreshStatus();
  } catch (error) {
    setStatus(error?.message || String(error));
  }
});
