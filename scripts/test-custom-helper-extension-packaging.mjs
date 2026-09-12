import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const packager = path.join(rootDir, 'scripts/package-custom-helper-extension.mjs');
const protectedRunnerFiles = [
  'public/native-runner/extension/manifest.json',
  'public/native-runner/extension/background.js',
  'public/native-runner/extension/background-v0.2.js',
  'public/native-runner/extension/executor.js'
];

function digest(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(rootDir, relativePath))).digest('hex');
}

function runPackage(configPath, profile, outDir) {
  return spawnSync(process.execPath, [packager, '--config', configPath, '--profile', profile, '--out-dir', outDir], {
    cwd: rootDir,
    encoding: 'utf8'
  });
}

const before = Object.fromEntries(protectedRunnerFiles.map((file) => [file, digest(file)]));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-helper-packaging-'));
try {
  const releaseConfig = path.join(tmpDir, 'release.json');
  fs.writeFileSync(releaseConfig, JSON.stringify({
    controlPlaneOrigin: 'https://agents.partner.test',
    launchOrigins: ['https://shop.partner.test'],
    helperPluginId: 'partner-reading-helper',
    helperOwnerAgentId: 'partner-reading-agent',
    extensionName: 'Partner Reading Helper',
    extensionDescription: 'Partner-owned read-only browser helper.',
    optionalMerchantOrigins: ['https://shop.partner.test/*']
  }));
  const releaseOut = path.join(tmpDir, 'release-output');
  const release = runPackage(releaseConfig, 'release', releaseOut);
  assert.equal(release.status, 0, release.stderr || release.stdout);
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseOut, 'package/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.host_permissions, ['https://agents.partner.test/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['https://shop.partner.test/*']);
  assert.equal(JSON.stringify(manifest).includes('magic-city.ai'), false);
  assert.equal(JSON.stringify(manifest).includes('localhost'), false);
  const generatedConfig = fs.readFileSync(path.join(releaseOut, 'package/partner-config.js'), 'utf8');
  assert.match(generatedConfig, /https:\/\/agents\.partner\.test/);
  assert.match(generatedConfig, /"profile": "release"/);

  const developmentConfig = path.join(tmpDir, 'development.json');
  fs.writeFileSync(developmentConfig, JSON.stringify({
    controlPlaneOrigin: 'http://127.0.0.1:4000',
    launchOrigins: ['http://localhost:4100'],
    helperPluginId: 'partner-reading-helper-dev',
    helperOwnerAgentId: 'partner-reading-agent-dev',
    extensionName: 'Partner Reading Helper Dev',
    extensionDescription: 'Local-only read-only browser helper.',
    optionalMerchantOrigins: ['http://localhost:4100/*']
  }));
  const development = runPackage(developmentConfig, 'development', path.join(tmpDir, 'development-output'));
  assert.equal(development.status, 0, development.stderr || development.stdout);
  const rejectedRelease = runPackage(developmentConfig, 'release', path.join(tmpDir, 'rejected-output'));
  assert.notEqual(rejectedRelease.status, 0);
  assert.match(rejectedRelease.stderr, /must use HTTPS/);

  const wildcardConfig = path.join(tmpDir, 'wildcard.json');
  fs.writeFileSync(wildcardConfig, JSON.stringify({
    ...JSON.parse(fs.readFileSync(releaseConfig, 'utf8')),
    optionalMerchantOrigins: ['https://*.partner.test/*']
  }));
  const rejectedWildcard = runPackage(wildcardConfig, 'release', path.join(tmpDir, 'wildcard-output'));
  assert.notEqual(rejectedWildcard.status, 0);
  assert.match(rejectedWildcard.stderr, /exact origin/);

  const after = Object.fromEntries(protectedRunnerFiles.map((file) => [file, digest(file)]));
  assert.deepEqual(after, before, 'partner packaging must not modify the production Runner');
  console.log('custom helper extension packaging tests passed');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
