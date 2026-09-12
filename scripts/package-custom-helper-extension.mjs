import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const starterDir = path.join(rootDir, 'examples/custom-helper-extension-starter');

function fail(message) {
  console.error(`custom helper extension package failed: ${message}`);
  process.exit(1);
}

function readArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!['--config', '--profile', '--out-dir'].includes(name)) fail(`unknown argument ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`${name} requires a value`);
    args[name.slice(2)] = value;
    index += 1;
  }
  return args;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`cannot read ${filePath}: ${error.message}`);
  }
}

function normalizeOrigin(value, { field, profile }) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    fail(`${field} must be an absolute origin`);
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    fail(`${field} must be an origin without credentials, path, query, or hash`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(profile === 'development' && url.protocol === 'http:' && loopback)) {
    fail(`${field} must use HTTPS${profile === 'development' ? ' or loopback HTTP' : ''}`);
  }
  return url.origin;
}

function normalizePermission(value, { field, profile }) {
  const raw = String(value || '').trim();
  if (!raw.endsWith('/*') || raw.slice(0, -2).includes('*')) {
    fail(`${field} must be an exact origin followed by /*`);
  }
  return `${normalizeOrigin(raw.slice(0, -2), { field, profile })}/*`;
}

function validateId(value, field) {
  const id = String(value || '').trim();
  if (!/^[a-z][a-z0-9._-]{2,63}$/.test(id)) fail(`${field} must be a lowercase stable ID (3-64 characters)`);
  if (['magic-city-runner-extension', 'magic-city-browser-agent'].includes(id)) {
    fail(`${field} cannot use a reserved Magic City identity`);
  }
  return id;
}

function assertNoRemoteCode(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const blockedPatterns = [
    /\beval\s*\(/,
    /\bnew\s+Function\s*\(/,
    /\bimportScripts\s*\(\s*['"]https?:\/\//,
    /\bimport\s*\(\s*['"]https?:\/\//,
    /<script[^>]+src=["']https?:\/\//i
  ];
  const matched = blockedPatterns.find((pattern) => pattern.test(text));
  if (matched) fail(`${path.basename(filePath)} contains remote/dynamic executable code (${matched})`);
}

const args = readArgs(process.argv.slice(2));
const profile = String(args.profile || 'release').trim().toLowerCase();
if (!['development', 'release'].includes(profile)) fail('--profile must be development or release');

const configPath = path.resolve(rootDir, args.config || 'examples/custom-helper-extension-starter/partner.config.example.json');
const rawConfig = readJson(configPath);
const controlPlaneOrigin = normalizeOrigin(rawConfig.controlPlaneOrigin, { field: 'controlPlaneOrigin', profile });
const launchOrigins = Array.from(new Set((rawConfig.launchOrigins || []).map((value, index) => (
  normalizeOrigin(value, { field: `launchOrigins[${index}]`, profile })
))));
if (!launchOrigins.length) fail('launchOrigins must include at least one approved page origin');
const optionalMerchantOrigins = Array.from(new Set((rawConfig.optionalMerchantOrigins || []).map((value, index) => (
  normalizePermission(value, { field: `optionalMerchantOrigins[${index}]`, profile })
))));
for (const origin of launchOrigins) {
  if (!optionalMerchantOrigins.includes(`${origin}/*`) && origin !== controlPlaneOrigin) {
    fail(`launch origin ${origin} needs a matching optionalMerchantOrigins entry`);
  }
}

const helperPluginId = validateId(rawConfig.helperPluginId, 'helperPluginId');
const helperOwnerAgentId = validateId(rawConfig.helperOwnerAgentId, 'helperOwnerAgentId');
const extensionName = String(rawConfig.extensionName || '').trim();
const extensionDescription = String(rawConfig.extensionDescription || '').trim();
if (!extensionName || extensionName.length > 75) fail('extensionName must be 1-75 characters');
if (!extensionDescription || extensionDescription.length > 132) fail('extensionDescription must be 1-132 characters');

const sourceManifest = readJson(path.join(starterDir, 'manifest.json'));
const manifest = {
  ...sourceManifest,
  name: extensionName,
  description: extensionDescription,
  host_permissions: Array.from(new Set([
    `${controlPlaneOrigin}/*`,
    ...(profile === 'development' ? launchOrigins.map((origin) => `${origin}/*`) : [])
  ])),
  optional_host_permissions: optionalMerchantOrigins
};
if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
for (const permission of ['storage', 'tabs', 'scripting']) {
  if (!permissions.includes(permission)) fail(`manifest permissions must include ${permission}`);
}
if (permissions.includes('debugger') || permissions.includes('webRequest')) fail('starter must not ship debugger or webRequest permissions');

const staticFiles = ['background.js', 'popup.html', 'popup.js', 'README.md', 'LICENSE'];
for (const relativePath of staticFiles) {
  const sourcePath = path.join(starterDir, relativePath);
  if (!fs.existsSync(sourcePath)) fail(`missing ${relativePath}`);
  if (['background.js', 'popup.html', 'popup.js'].includes(relativePath)) assertNoRemoteCode(sourcePath);
}

const slug = helperPluginId.replace(/[^a-z0-9._-]/g, '-');
const distDir = path.resolve(rootDir, args['out-dir'] || path.join('dist/custom-helper-extension-starter', slug, profile));
const packageDir = path.join(distDir, 'package');
fs.mkdirSync(distDir, { recursive: true });
fs.rmSync(packageDir, { recursive: true, force: true });
fs.mkdirSync(packageDir, { recursive: true });
for (const relativePath of staticFiles) fs.copyFileSync(path.join(starterDir, relativePath), path.join(packageDir, relativePath));
fs.writeFileSync(path.join(packageDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(
  path.join(packageDir, 'partner-config.js'),
  `// Generated at build time. Do not fetch runtime configuration.\nexport const PARTNER_CONFIG = Object.freeze(${JSON.stringify({
    controlPlaneOrigin,
    launchOrigins,
    helperPluginId,
    helperOwnerAgentId,
    extensionName,
    optionalMerchantOrigins,
    profile
  }, null, 2)});\n`
);

const packageFiles = [...staticFiles, 'manifest.json', 'partner-config.js'];
const zipName = `${slug}-${manifest.version}-${profile}.zip`;
const zipPath = path.join(distDir, zipName);
fs.rmSync(zipPath, { force: true });
const zip = spawnSync('zip', ['-qr', zipPath, ...packageFiles], { cwd: packageDir, stdio: 'inherit' });
if (zip.error) fail(zip.error.message);
if (zip.status !== 0) fail(`zip exited with ${zip.status}`);

console.log(`Packaged ${extensionName} ${manifest.version} (${profile})`);
console.log(`Package directory: ${packageDir}`);
console.log(`ZIP: ${zipPath}`);
