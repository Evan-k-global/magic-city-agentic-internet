import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const manifestPath = path.join(rootDir, 'public/native-runner/extension/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const zipPath = path.join(rootDir, 'dist/native-runner-extension', `magic-city-runner-${manifest.version}.zip`);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'magic-city-extension-package-'));
const unpackedDir = path.join(tmpDir, 'unpacked');

function fail(message) {
  console.error(`native runner extension package smoke failed: ${message}`);
  process.exit(1);
}

try {
  const packageResult = spawnSync(process.execPath, ['scripts/package-native-runner-extension.mjs'], {
    cwd: rootDir,
    stdio: 'inherit'
  });
  if (packageResult.error) fail(packageResult.error.message);
  if (packageResult.status !== 0) fail(`package script exited with ${packageResult.status}`);
  if (!fs.existsSync(zipPath)) fail(`missing release zip ${zipPath}`);

  fs.mkdirSync(unpackedDir, { recursive: true });
  const unzip = spawnSync('unzip', ['-q', zipPath, '-d', unpackedDir], {
    cwd: rootDir,
    stdio: 'inherit'
  });
  if (unzip.error) fail(unzip.error.message);
  if (unzip.status !== 0) fail(`unzip exited with ${unzip.status}`);

  const packagedManifestPath = path.join(unpackedDir, 'manifest.json');
  if (!fs.existsSync(packagedManifestPath)) fail('unpacked package is missing manifest.json');
const packagedManifest = JSON.parse(fs.readFileSync(packagedManifestPath, 'utf8'));
  if (packagedManifest.version !== manifest.version) {
  fail(`manifest version mismatch: source ${manifest.version}, package ${packagedManifest.version}`);
}

const packagedBackground = fs.readFileSync(path.join(unpackedDir, 'background.js'), 'utf8');
if (!/import\s+\*\s+as\s+legacyController\s+from\s+['"]\.\/background-v0\.2\.js['"]/.test(packagedBackground)) {
  fail('v0.3 gateway must use the verified legacy controller module');
}
if (/onInstalled[\s\S]*pollAndExecute\(\)/.test(packagedBackground)) {
  fail('extension install must not auto-run browser missions');
}
const packagedLegacyBackgroundPath = path.join(unpackedDir, 'background-v0.2.js');
if (!fs.existsSync(packagedLegacyBackgroundPath)) fail('package is missing the local 0.2.x compatibility controller');
const packagedLegacyBackground = fs.readFileSync(packagedLegacyBackgroundPath, 'utf8');
if (!/export\s*\{[^}]*pollOnly/.test(packagedLegacyBackground)) {
  fail('legacy controller must expose pollOnly for the lean heartbeat');
}
if (/startsWith\('v0\.3\.0'\)/.test(packagedLegacyBackground)) {
  fail('active mission recovery must not be disabled for the v0.3 runtime');
}
if (!/scheduleRunnerResume\(\);[\s\S]{0,240}return data\.session \|\| session/.test(packagedLegacyBackground)) {
  fail('each persisted browser checkpoint must arm active-mission recovery');
}
if (!/ACTIVE_MISSION_CONTINUATION_DELAY_MS/.test(packagedBackground)
  || !/result\?\.status === 'already_running'/.test(packagedBackground)) {
  fail('lean gateway must keep an active mission recoverable across MV3 suspension');
}
if (/EXPLICIT_WAKE_ALARM|queueExplicitMissionWake|dispatchExplicitMissionWake/.test(packagedBackground)
  || !/return dispatch\(message, \{ origin \}\);/.test(packagedBackground)
  || !/Keep the external message open through the exact-session claim/.test(packagedBackground)) {
  fail('external runner wake must run through the direct exact-session claim path, without detached MV3 work');
}
if (!/async function pollAndExecute\(requestedSessionId = ''\)/.test(packagedLegacyBackground)
  || !/String\(session\?\.id \|\| ''\) === normalizedSessionId/.test(packagedLegacyBackground)) {
  fail('runner execution must select the exact session requested by Magic City');
}
if (!/async function pollOnly\(\)[\s\S]*extensionRunDispatch\?\.expiresAt[\s\S]*pollAndExecute\(dispatchedSession\.id\)/.test(packagedLegacyBackground)) {
  fail('heartbeat fallback must execute only a still-valid user-dispatched browser mission');
}
if (!/navigationTargetMatches\(beforeUrl, targetUrl\)/.test(packagedLegacyBackground)
  || !/const navigation = waitForTabNavigation\(tabId, beforeUrl, timeoutMs\);[\s\S]*const updatedTab = await withTimeout/.test(packagedLegacyBackground)) {
  fail('navigation readiness must be idempotent and subscribe before the tab update');
}

  const smoke = spawnSync(process.execPath, ['scripts/smoke-native-runner-extension-browser.mjs'], {
    cwd: rootDir,
    env: {
      ...process.env,
      MAGIC_CITY_EXTENSION_SOURCE: unpackedDir
    },
    stdio: 'inherit'
  });
  if (smoke.error) fail(smoke.error.message);
  if (smoke.status !== 0) fail(`browser smoke exited with ${smoke.status}`);

  console.log(`native-runner extension release package smoke passed: ${zipPath}`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
