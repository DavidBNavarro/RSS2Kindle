#!/usr/bin/env bash
# Web2Kindle/PDF2Kindle — remove LaunchAgent and stop the server.
set -euo pipefail

LABEL="com.web2kindle.server"
PLIST_NAME="$LABEL.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"
LAUNCH_DOMAIN="gui/$(id -u)"

if [ -f "$PLIST_PATH" ]; then
  if [ "${DRY_RUN:-}" != "1" ]; then
    launchctl bootout "$LAUNCH_DOMAIN" "$PLIST_PATH" 2>/dev/null || \
      launchctl unload -w "$PLIST_PATH" 2>/dev/null || true
  fi
  rm "$PLIST_PATH"
  echo "✓ LaunchAgent removed"
else
  echo "Nothing to uninstall — plist not found at $PLIST_PATH"
fi
