#!/bin/zsh
set -euo pipefail

HOST_NAME="com.magiccity.runner"
rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/$HOST_NAME.json"
rm -f "$HOME/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/$HOST_NAME.json"
rm -f "$HOME/Library/Application Support/Chromium/NativeMessagingHosts/$HOST_NAME.json"
echo "Magic City native host registration removed. You can also remove $HOME/.magic-city/native-runner if you want to delete logs and state."
