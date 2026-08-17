# Magic City Native Runner Installer Contract

This folder defines the native-host/helper contract for the Magic City local authenticated browser runner. The browser extension in `public/native-runner/extension/` is the pairing/status/control surface; this native host is the executable browser worker surface.

## Public Release Path

- Package the browser extension as the default public install path.
- Ship this helper as a signed macOS `.pkg` that installs `Magic City Runner.app` into `/Applications`.
- The installer runs the app once after install to register the Chrome native messaging host for the signed-in macOS user.
- Notarize the package with Apple before public distribution.
- Store `MAGIC_CITY_NATIVE_RUNNER_TOKEN` in Keychain, not shell history, `.env`, localStorage, or shared docs.
- Launch the runner as the signed user agent with least privilege.
- Let users revoke the device from Magic City Settings.
- Rotate device credentials during reinstall, compromise recovery, or periodic hardening.

Build the production helper package on macOS:

```bash
MAGIC_CITY_MAC_CODESIGN_IDENTITY="Developer ID Application: <Team>" \
MAGIC_CITY_MAC_INSTALLER_IDENTITY="Developer ID Installer: <Team>" \
npm run build:native-runner-macos
```

The build emits:

- `dist/native-runner-macos/Magic City Runner.app`
- `dist/native-runner-macos/MagicCityRunner-<version>.pkg`

For local packaging checks without Apple identities, the app is ad-hoc signed and the pkg is unsigned. That is for development only.

After uploading the notarized `.pkg`, set:

```bash
MAGIC_CITY_NATIVE_RUNNER_HELPER_INSTALL_URL=https://<download-host>/MagicCityRunner.pkg
```

## Internal Scaffolding

From the Magic City repo:

```bash
native-runner/macos/install-native-host.command
```

Then open the Magic City Runner extension and click **Start helper**.

This command is only for internal staging/debugging. Public users should install the signed helper package instead.

## Runtime Environment

The native helper should resolve:

```bash
MAGIC_CITY_BASE_URL=https://magic-city-staging.fly.dev
MAGIC_CITY_NATIVE_RUNNER_TOKEN=<read from Keychain>
MAGIC_CITY_BROWSER_WORKER_PLUGIN_ID=local-authenticated-browser-plugin
MAGIC_CITY_BROWSER_WORKER_OWNER=local-authenticated-browser-agent
MAGIC_CITY_BROWSER_USER_DATA_DIR="$HOME/.magic-city/browser-profile"
```

For existing Chrome-profile mode, the helper can use:

```bash
MAGIC_CITY_BROWSER_CDP_URL=http://127.0.0.1:9222
```

## Keychain Shape

Recommended item:

- service: `com.magiccity.native-runner`
- account: Magic City native runner device id
- secret: device-scoped runner token
- access group: signed helper/app only

## LaunchAgent

The LaunchAgent should be generated from `com.magiccity.runner.plist.template` with:

- absolute Node/helper binary path
- app repo/helper path
- Keychain lookup wrapper
- no raw token embedded in the plist

## Verification

Before public release:

1. Run `npm run test:native-runner-security`.
2. Run `npm run check:native-runner-production` against staging/prod.
3. Run `npm run smoke:native-runner-production` against staging.
4. Run `MAGIC_CITY_SMOKE_SUBMIT_ANCHOR=true npm run smoke:native-runner-production` only when the funded MBA/Zeko relayer path is expected to accept a live anchor.
