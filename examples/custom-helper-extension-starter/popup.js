const $ = (id) => document.getElementById(id);

function send(type, payload = {}) {
  return new Promise((resolve) => chrome.runtime.sendMessage({ type, ...payload }, resolve));
}

async function refresh() {
  const status = await send('HELPER_STATUS');
  $('status').textContent = status.ok
    ? `Paired: ${status.paired ? 'yes' : 'no'}\nRegistered: ${status.registered ? 'yes' : 'no'}\nLast: ${status.last || 'none'}`
    : `Error: ${status.error}`;
}

$('pairBtn').addEventListener('click', async () => {
  const response = await send('HELPER_PAIR', {
    baseUrl: $('baseUrl').value,
    code: $('pairingCode').value
  });
  $('status').textContent = response.ok ? 'Paired.' : `Pair failed: ${response.error}`;
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
