#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h:h}"
STATE_DIR="$HOME/.magic-city/native-runner"
HOST_DIR="$STATE_DIR/host"
CHROME_HOST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
CHROME_FOR_TESTING_HOST_DIR="$HOME/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts"
CHROMIUM_HOST_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
HOST_NAME="com.magiccity.runner"
NODE_BIN="$(command -v node)"
WEB_STORE_EXTENSION_ID="dfoddgnffmbadfhkekeopjjnfmdlppge"
DEV_EXTENSION_ID="${MAGIC_CITY_EXTENSION_ID:-}"

mkdir -p "$HOST_DIR" "$CHROME_HOST_DIR" "$CHROME_FOR_TESTING_HOST_DIR" "$CHROMIUM_HOST_DIR"

cat > "$HOST_DIR/magic-city-native-host.sh" <<EOF
#!/bin/zsh
cd "$REPO_ROOT"
exec "$NODE_BIN" "$REPO_ROOT/native-runner/macos/native-host.mjs"
EOF
chmod 700 "$HOST_DIR/magic-city-native-host.sh"

if [[ -n "$DEV_EXTENSION_ID" && "$DEV_EXTENSION_ID" != "$WEB_STORE_EXTENSION_ID" ]]; then
  ALLOWED_ORIGINS="[
    \"chrome-extension://$WEB_STORE_EXTENSION_ID/\",
    \"chrome-extension://$DEV_EXTENSION_ID/\"
  ]"
else
  ALLOWED_ORIGINS="[
    \"chrome-extension://$WEB_STORE_EXTENSION_ID/\"
  ]"
fi

cat > "$HOST_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Magic City local browser runner host",
  "path": "$HOST_DIR/magic-city-native-host.sh",
  "type": "stdio",
  "allowed_origins": $ALLOWED_ORIGINS
}
EOF

cp "$HOST_DIR/$HOST_NAME.json" "$CHROME_HOST_DIR/$HOST_NAME.json"
cp "$HOST_DIR/$HOST_NAME.json" "$CHROME_FOR_TESTING_HOST_DIR/$HOST_NAME.json"
cp "$HOST_DIR/$HOST_NAME.json" "$CHROMIUM_HOST_DIR/$HOST_NAME.json"

echo "Magic City native host installed."
echo "Host: $HOST_DIR/magic-city-native-host.sh"
echo "Chrome manifest: $CHROME_HOST_DIR/$HOST_NAME.json"
echo "Chrome for Testing manifest: $CHROME_FOR_TESTING_HOST_DIR/$HOST_NAME.json"
echo "Open the Magic City Runner extension and click Start helper."
