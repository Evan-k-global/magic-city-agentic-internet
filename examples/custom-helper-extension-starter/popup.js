const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...payload }, resolve));
}

async function refresh() {
  const status = await send('HELPER_STATUS');
  if (status.ok) {
    $('extensionName').textContent = status.extensionName || 'Custom Magic City Helper';
    $('baseUrl').textContent = status.controlPlaneOrigin || 'Not configured';
    $('modelRouting').textContent = status.modelRouting === 'cloud' ? 'Allow catalog facts to the configured cloud model' : status.modelRouting === 'local' ? 'Allow catalog facts to the operator’s local model' : 'Model access disabled';
    $('modelConsent').disabled = status.modelRouting === 'disabled';
    $('modelConsent').checked = status.modelEnabled;
    $('grantedSites').replaceChildren();
    for (const origin of status.requiredPageOrigins || []) {
      const text = document.createElement('div');
      text.textContent = `Required by this build: ${origin}`;
      $('grantedSites').append(text);
    }
    for (const origin of status.grantedOrigins || []) {
      const button = document.createElement('button');
      button.className = 'secondary';
      button.textContent = `Revoke ${origin}`;
      button.addEventListener('click', async () => {
        await send('HELPER_REVOKE_SITE_ACCESS', { origin });
        await refresh();
      });
      $('grantedSites').append(button);
    }
  }
  $('status').textContent = status.ok
    ? `Build: ${status.profile}\nPaired: ${status.paired ? 'yes' : 'no'}\nRegistered: ${status.registered ? 'yes' : 'no'}\nAllowed pages: ${(status.launchOrigins || []).join(', ') || 'none'}\nLast: ${status.last || 'none'}`
    : `Error: ${status.error}`;
}

$('pairBtn').addEventListener('click', async () => {
  const response = await send('HELPER_PAIR', {
    code: $('pairingCode').value
  });
  $('status').textContent = response.ok ? 'Paired.' : `Pair failed: ${response.error}`;
});

$('permissionBtn').addEventListener('click', async () => {
  const response = await send('HELPER_GRANT_SITE_ACCESS');
  $('status').textContent = response.ok
    ? `Site access granted for:\n${(response.origins || []).join('\n')}`
    : 'Site access was not granted.';
  await refresh();
});

$('modelConsent').addEventListener('change', async () => {
  await send('HELPER_MODEL_CONSENT', { enabled: $('modelConsent').checked });
  await refresh();
});

$('registerBtn').addEventListener('click', async () => {
  const response = await send('HELPER_REGISTER');
  $('status').textContent = response.ok ? 'Registered.' : `Register failed: ${response.error}`;
});

$('pollBtn').addEventListener('click', async () => {
  const response = await send('HELPER_POLL_ONCE');
  $('status').textContent = response.ok ? `Poll complete.\n${JSON.stringify(response.result, null, 2)}` : `Poll failed: ${response.error}`;
});

refresh();
