import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { modelConsentKey } from '../examples/custom-helper-extension-starter/model-privacy.js';

// Exercise real background handlers and popup code against explicit Chrome API
// doubles. The separate packaged smoke covers native pairing/claim/checkpoints.
const config = {
  controlPlaneOrigin: 'https://agents.example', launchOrigins: ['https://shop.example'],
  optionalMerchantOrigins: ['https://shop.example/*'],
  modelAdapter: { mode: 'control_plane', dataRouting: 'local', modelId: 'catalog', path: '/model', observationPolicy: { allowedOrigins: ['https://shop.example'] } }
};
const storage = {};
let origins = ['https://agents.example/*', 'https://shop.example/*'];
let listener;
const popupSender = { id: 'test-helper', url: 'chrome-extension://test-helper/popup.html' };
const chrome = {
  runtime: {
    id: popupSender.id, getURL: (p) => `chrome-extension://test-helper/${p}`,
    getManifest: () => ({ host_permissions: ['https://agents.example/*'] }),
    onMessage: { addListener: (fn) => { listener = fn; } },
    sendMessage: (message, reply) => listener(message, popupSender, reply)
  },
  storage: { local: {
    get: async () => ({ ...storage }), set: async (patch) => Object.assign(storage, patch),
    remove: async (keys) => { for (const key of keys) delete storage[key]; }
  } },
  permissions: {
    getAll: async () => ({ origins }),
    remove: async ({ origins: removed }) => { origins = origins.filter((o) => !removed.includes(o)); return true; }
  }
};
const background = fs.readFileSync(new URL('../examples/custom-helper-extension-starter/background.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
vm.runInNewContext(background, { chrome, PARTNER_CONFIG: config, modelConsentKey, URL });
const message = (body, sender = popupSender) => new Promise((resolve) => listener(body, sender, resolve));
assert.equal((await message({ type: 'HELPER_STATUS' })).modelEnabled, false);
const contentSender = { id: popupSender.id, url: 'https://shop.example/product' };
assert.equal((await message({ type: 'HELPER_MODEL_CONSENT', enabled: true }, contentSender)).error, 'popup_required');
assert.equal(storage.modelConsent, undefined);
assert.equal((await message({ type: 'HELPER_REVOKE_SITE_ACCESS', origin: 'https://agents.example/*' })).error, 'permission_not_revocable');

function element() {
  return { textContent: '', checked: false, disabled: false, children: [], handlers: {},
    addEventListener(type, fn) { this.handlers[type] = fn; },
    replaceChildren() { this.children = []; }, append(child) { this.children.push(child); }
  };
}
const elements = new Map();
const get = (id) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
const document = { getElementById: get, createElement: element };
const popup = fs.readFileSync(new URL('../examples/custom-helper-extension-starter/popup.js', import.meta.url), 'utf8');
const popupContext = vm.createContext({ chrome, document });
vm.runInContext(popup, popupContext);
await new Promise(setImmediate);
assert.match(get('modelRouting').textContent, /operator’s local model/);
assert.equal(get('modelConsent').checked, false);
assert.equal(get('grantedSites').children.length, 1);
get('modelConsent').checked = true;
await get('modelConsent').handlers.change();
assert.equal(get('modelConsent').checked, true);
assert.equal(storage.modelConsent, modelConsentKey({ ...config.modelAdapter, controlPlaneOrigin: config.controlPlaneOrigin }));
config.modelAdapter.dataRouting = 'cloud';
await vm.runInContext('refresh()', popupContext);
assert.equal(get('modelConsent').checked, false, 'routing changes invalidate consent');
assert.match(get('modelRouting').textContent, /cloud model/);
await get('grantedSites').children[0].handlers.click();
assert.deepEqual(origins, ['https://agents.example/*']);
assert.equal(get('grantedSites').children.length, 0);
get('modelConsent').checked = false;
await get('modelConsent').handlers.change();
assert.equal(storage.modelConsent, '');
console.log('helper popup opt-in, invalidation, scoped revocation and sender-boundary tests passed');
