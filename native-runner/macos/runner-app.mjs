import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOST_NAME = 'com.magiccity.runner';
const WEB_STORE_EXTENSION_ID = 'dfoddgnffmbadfhkekeopjjnfmdlppge';

const args = new Set(process.argv.slice(2));
const resourcesDir = path.dirname(fileURLToPath(import.meta.url));
const contentsDir = path.dirname(resourcesDir);
const appBundleDir = path.dirname(contentsDir);
const hostExecutable = path.join(contentsDir, 'MacOS', 'magic-city-native-host');

function nativeMessagingHostDirs() {
  const support = path.join(os.homedir(), 'Library', 'Application Support');
  return [
    path.join(support, 'Google', 'Chrome', 'NativeMessagingHosts'),
    path.join(support, 'Google', 'Chrome Beta', 'NativeMessagingHosts'),
    path.join(support, 'Google', 'Chrome Dev', 'NativeMessagingHosts'),
    path.join(support, 'Google', 'Chrome Canary', 'NativeMessagingHosts'),
    path.join(support, 'Google', 'ChromeForTesting', 'NativeMessagingHosts'),
    path.join(support, 'Chromium', 'NativeMessagingHosts')
  ];
}

function allowedOrigins() {
  const origins = new Set([`chrome-extension://${WEB_STORE_EXTENSION_ID}/`]);
  const devExtensionId = String(process.env.MAGIC_CITY_EXTENSION_ID || '').trim();
  if (devExtensionId && devExtensionId !== WEB_STORE_EXTENSION_ID) {
    origins.add(`chrome-extension://${devExtensionId}/`);
  }
  return Array.from(origins);
}

function writeNativeHostManifests() {
  if (!fs.existsSync(hostExecutable)) {
    throw new Error(`Native host executable missing: ${hostExecutable}`);
  }
  const manifest = {
    name: HOST_NAME,
    description: 'Magic City local browser runner host',
    path: hostExecutable,
    type: 'stdio',
    allowed_origins: allowedOrigins()
  };
  const written = [];
  for (const hostDir of nativeMessagingHostDirs()) {
    fs.mkdirSync(hostDir, { recursive: true });
    const manifestPath = path.join(hostDir, `${HOST_NAME}.json`);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    written.push(manifestPath);
  }
  const stateDir = path.join(os.homedir(), '.magic-city', 'native-runner');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'native-host-install.json'), `${JSON.stringify({
    hostName: HOST_NAME,
    appBundleDir,
    hostExecutable,
    written,
    installedAt: new Date().toISOString()
  }, null, 2)}\n`);
  return written;
}

function showMessage(title, message) {
  if (args.has('--quiet')) return;
  spawnSync('/usr/bin/osascript', [
    '-e',
    `display dialog ${JSON.stringify(message)} with title ${JSON.stringify(title)} buttons {"OK"} default button "OK"`
  ], { stdio: 'ignore' });
}

function printStatus() {
  const statePath = path.join(os.homedir(), '.magic-city', 'native-runner', 'native-host-install.json');
  const installState = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
  console.log(JSON.stringify({
    appBundleDir,
    hostExecutable,
    registered: Boolean(installState),
    installState
  }, null, 2));
}

try {
  if (args.has('--status')) {
    printStatus();
    process.exit(0);
  }
  const written = writeNativeHostManifests();
  if (!args.has('--register-host') || !args.has('--quiet')) {
    showMessage(
      'Magic City Runner Installed',
      `Magic City Runner is ready. Open the Chrome extension, pair it with Magic City, then click Start helper.\n\nRegistered ${written.length} browser host entries.`
    );
  }
  if (!args.has('--quiet')) {
    console.log(`Magic City Runner registered ${written.length} native host manifest(s).`);
  }
} catch (error) {
  showMessage('Magic City Runner Setup Failed', error?.message || String(error));
  console.error(error?.stack || error?.message || error);
  process.exit(1);
}
