import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const starterDir = path.join(rootDir, 'examples/custom-helper-extension-starter');
const distDir = path.join(rootDir, 'dist/custom-helper-extension-starter');
const packageDir = path.join(distDir, 'package');

const requiredFiles = [
  'manifest.json',
  'background.js',
  'popup.html',
  'popup.js',
  'README.md'
];

const sourceFilesToScan = [
  'background.js',
  'popup.js',
  'popup.html'
];

function fail(message) {
  console.error(`custom helper extension package failed: ${message}`);
  process.exit(1);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(starterDir, relativePath), 'utf8'));
}

function copyFile(relativePath) {
  const from = path.join(starterDir, relativePath);
  const to = path.join(packageDir, relativePath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function assertNoRemoteCode(relativePath) {
  const text = fs.readFileSync(path.join(starterDir, relativePath), 'utf8');
  const blockedPatterns = [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bimportScripts\s*\(\s*['"]https?:\/\//,
    /\bimport\s*\(\s*['"]https?:\/\//,
    /<script[^>]+src=["']https?:\/\//i
  ];
  const matched = blockedPatterns.find((pattern) => pattern.test(text));
  if (matched) fail(`${relativePath} contains remote/dynamic executable code (${matched})`);
}

for (const relativePath of requiredFiles) {
  if (!fs.existsSync(path.join(starterDir, relativePath))) fail(`missing ${relativePath}`);
}

const manifest = readJson('manifest.json');
if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (!manifest.name || !manifest.version) fail('manifest must include name and version');
if (String(manifest.description || '').length > 132) fail('manifest description must be 132 characters or fewer for Chrome Web Store');

const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
for (const permission of ['storage', 'tabs', 'scripting']) {
  if (!permissions.includes(permission)) fail(`manifest permissions must include ${permission}`);
}
if (permissions.includes('debugger') || permissions.includes('webRequest')) {
  fail('starter must not ship debugger or webRequest permissions');
}

const hostPermissions = [
  ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
  ...(Array.isArray(manifest.optional_host_permissions) ? manifest.optional_host_permissions : [])
];
if (hostPermissions.includes('<all_urls>')) fail('use optional HTTPS host access instead of <all_urls>');
if (hostPermissions.some((pattern) => /^http:\/\/(localhost|127\.0\.0\.1)(?::|\*|\/)/.test(String(pattern)))) {
  fail('localhost host permissions are excluded from the Chrome Store release package');
}

for (const relativePath of sourceFilesToScan) assertNoRemoteCode(relativePath);

fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(packageDir, { recursive: true, force: true });
fs.mkdirSync(packageDir, { recursive: true });

for (const relativePath of requiredFiles) copyFile(relativePath);

const zipName = `custom-magic-city-helper-starter-${manifest.version}.zip`;
const zipPath = path.join(distDir, zipName);
fs.rmSync(zipPath, { force: true });

const zip = spawnSync('zip', ['-qr', zipPath, ...requiredFiles], {
  cwd: packageDir,
  stdio: 'inherit'
});

if (zip.error) fail(zip.error.message);
if (zip.status !== 0) fail(`zip exited with ${zip.status}`);

console.log(`Packaged Custom Magic City Helper Starter ${manifest.version}`);
console.log(zipPath);
