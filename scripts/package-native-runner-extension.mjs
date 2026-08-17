import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const extensionDir = path.join(rootDir, 'public/native-runner/extension');
const distDir = path.join(rootDir, 'dist/native-runner-extension');
const packageDir = path.join(distDir, 'package');

const requiredFiles = [
  'manifest.json',
  'background.js',
  'background-v0.2.js',
  'executor.js',
  'popup.html',
  'popup.js',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png'
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fail(message) {
  console.error(`native runner extension package failed: ${message}`);
  process.exit(1);
}

function copyFile(relativePath) {
  const from = path.join(extensionDir, relativePath);
  const to = path.join(packageDir, relativePath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

const manifestPath = path.join(extensionDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail('missing manifest.json');

const manifest = readJson(manifestPath);
if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (!manifest.name || !manifest.version) fail('manifest must include name and version');

const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
if (!permissions.includes('tabs') || !permissions.includes('scripting')) {
  fail('the extension executor requires tabs and scripting permissions');
}
if (permissions.includes('webRequest') || permissions.includes('debugger')) {
  fail('network interception and debugging permissions must not ship in the extension executor');
}

const hostPermissions = [
  ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
  ...(Array.isArray(manifest.optional_host_permissions) ? manifest.optional_host_permissions : [])
];
if (hostPermissions.includes('<all_urls>')) fail('use optional HTTPS host access instead of a required all-sites permission');
if (hostPermissions.some((pattern) => /^http:\/\/(localhost|127\.0\.0\.1)(?::|\*|\/)/.test(String(pattern)))) {
  fail('localhost host permissions are intentionally excluded from the Web Store v1 package');
}

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(extensionDir, relativePath))) fail(`missing ${relativePath}`);
}

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(packageDir, { recursive: true, force: true });
fs.mkdirSync(packageDir, { recursive: true });

for (const relativePath of requiredFiles) copyFile(relativePath);

const zipName = `magic-city-runner-${manifest.version}.zip`;
const zipPath = path.join(distDir, zipName);
fs.rmSync(zipPath, { force: true });

const zip = spawnSync('zip', ['-qr', zipPath, ...requiredFiles], {
  cwd: packageDir,
  stdio: 'inherit'
});

if (zip.error) fail(zip.error.message);
if (zip.status !== 0) fail(`zip exited with ${zip.status}`);

console.log(`Packaged Magic City Runner ${manifest.version}`);
console.log(zipPath);
