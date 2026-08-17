import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const version = process.env.MAGIC_CITY_RUNNER_VERSION || JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.1.0';
const appName = 'Magic City Runner';
const bundleId = 'com.magiccity.runner';
const outputRoot = path.join(root, 'dist', 'native-runner-macos');
const appPath = path.join(outputRoot, `${appName}.app`);
const contentsDir = path.join(appPath, 'Contents');
const macosDir = path.join(contentsDir, 'MacOS');
const resourcesDir = path.join(contentsDir, 'Resources');
const embeddedAppDir = path.join(resourcesDir, 'app');
const payloadRoot = path.join(outputRoot, 'pkg-payload');
const scriptsDir = path.join(outputRoot, 'pkg-scripts');
const componentPkg = path.join(outputRoot, 'MagicCityRunner-component.pkg');
const productPkg = path.join(outputRoot, `MagicCityRunner-${version}.pkg`);

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

function commandExists(command) {
  return spawnSync('/usr/bin/which', [command], { stdio: 'ignore' }).status === 0;
}

function copyRequired(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`Missing required build input: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, dereference: false });
}

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function writeInfoPlist() {
  fs.writeFileSync(path.join(contentsDir, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>${appName}</string>
  <key>CFBundleExecutable</key>
  <string>${appName}</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
</dict>
</plist>
`);
}

function stageApp() {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(macosDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.mkdirSync(embeddedAppDir, { recursive: true });

  writeInfoPlist();
  writeExecutable(path.join(macosDir, appName), `#!/bin/zsh
set -euo pipefail
APP_MACOS_DIR="\${0:A:h}"
APP_RESOURCES_DIR="\${APP_MACOS_DIR:h}/Resources"
exec "$APP_RESOURCES_DIR/node/bin/node" "$APP_RESOURCES_DIR/runner-app.mjs" "$@"
`);
  writeExecutable(path.join(macosDir, 'magic-city-native-host'), `#!/bin/zsh
set -euo pipefail
APP_MACOS_DIR="\${0:A:h}"
APP_RESOURCES_DIR="\${APP_MACOS_DIR:h}/Resources"
export MAGIC_CITY_RUNNER_APP_RESOURCES="$APP_RESOURCES_DIR"
export MAGIC_CITY_RUNNER_REPO_ROOT="$APP_RESOURCES_DIR/app"
exec "$APP_RESOURCES_DIR/node/bin/node" "$APP_RESOURCES_DIR/native-host.mjs"
`);

  copyRequired(process.execPath, path.join(resourcesDir, 'node', 'bin', 'node'));
  fs.chmodSync(path.join(resourcesDir, 'node', 'bin', 'node'), 0o755);
  copyRequired(path.join(root, 'native-runner', 'macos', 'native-host.mjs'), path.join(resourcesDir, 'native-host.mjs'));
  copyRequired(path.join(root, 'native-runner', 'macos', 'runner-app.mjs'), path.join(resourcesDir, 'runner-app.mjs'));
  copyRequired(path.join(root, 'package.json'), path.join(embeddedAppDir, 'package.json'));
  copyRequired(path.join(root, 'package-lock.json'), path.join(embeddedAppDir, 'package-lock.json'));
  copyRequired(path.join(root, 'src'), path.join(embeddedAppDir, 'src'));

  if (args.has('--skip-node-modules')) {
    fs.writeFileSync(path.join(embeddedAppDir, 'NODE_MODULES_OMITTED.txt'), 'node_modules omitted for lightweight installer build testing.\n');
  } else {
    copyRequired(path.join(root, 'node_modules'), path.join(embeddedAppDir, 'node_modules'));
  }
}

function signAppIfConfigured() {
  const identity = process.env.MAGIC_CITY_MAC_CODESIGN_IDENTITY || process.env.CODESIGN_IDENTITY || '';
  if (identity && commandExists('codesign')) {
    run('codesign', ['--force', '--deep', '--options', 'runtime', '--timestamp', '--sign', identity, appPath]);
    return { mode: 'developer_id', identity };
  }
  if (commandExists('codesign')) {
    run('codesign', ['--force', '--deep', '--sign', '-', appPath]);
    return { mode: 'ad_hoc', identity: '-' };
  }
  return { mode: 'unsigned', identity: '' };
}

function writePkgScripts() {
  fs.mkdirSync(scriptsDir, { recursive: true });
  writeExecutable(path.join(scriptsDir, 'postinstall'), `#!/bin/zsh
set -euo pipefail
APP="/Applications/${appName}.app/Contents/MacOS/${appName}"
CONSOLE_USER="$(/usr/bin/stat -f %Su /dev/console || true)"
if [[ -n "$CONSOLE_USER" && "$CONSOLE_USER" != "root" && -x "$APP" ]]; then
  /usr/bin/su -l "$CONSOLE_USER" -c "'$APP' --register-host --quiet" || true
elif [[ -x "$APP" ]]; then
  "$APP" --register-host --quiet || true
fi
exit 0
`);
}

function buildPkgIfAvailable() {
  if (args.has('--no-pkg')) return { built: false, reason: 'disabled' };
  if (!commandExists('pkgbuild') || !commandExists('productbuild')) {
    return { built: false, reason: 'pkgbuild_or_productbuild_missing' };
  }
  fs.mkdirSync(path.join(payloadRoot, 'Applications'), { recursive: true });
  fs.cpSync(appPath, path.join(payloadRoot, 'Applications', `${appName}.app`), { recursive: true });
  writePkgScripts();
  run('pkgbuild', [
    '--root', payloadRoot,
    '--scripts', scriptsDir,
    '--identifier', `${bundleId}.pkg`,
    '--version', version,
    '--install-location', '/',
    componentPkg
  ]);
  const installerIdentity = process.env.MAGIC_CITY_MAC_INSTALLER_IDENTITY || process.env.INSTALLER_SIGN_IDENTITY || '';
  const productArgs = ['--package', componentPkg];
  if (installerIdentity) productArgs.push('--sign', installerIdentity);
  productArgs.push(productPkg);
  run('productbuild', productArgs);
  return { built: true, path: productPkg, signed: Boolean(installerIdentity) };
}

stageApp();
const signing = signAppIfConfigured();
const pkg = buildPkgIfAvailable();

const summary = {
  ok: true,
  appPath,
  version,
  signing,
  pkg,
  notarization: signing.mode === 'developer_id' && pkg.signed
    ? 'ready_for_notarytool_submit'
    : 'set MAGIC_CITY_MAC_CODESIGN_IDENTITY and MAGIC_CITY_MAC_INSTALLER_IDENTITY for public release signing'
};
console.log(JSON.stringify(summary, null, 2));
