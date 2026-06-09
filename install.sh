#!/usr/bin/env bash
# Web2Kindle/PDF2Kindle — one-time setup: installs deps + LaunchAgent for auto-start.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_PY="$SCRIPT_DIR/server.py"
LABEL="com.web2kindle.server"
PLIST_NAME="$LABEL.plist"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME"
LOG_PATH="$HOME/Library/Logs/web2kindle.log"
PYTHON="$(command -v python3 || true)"
LAUNCH_DOMAIN="gui/$(id -u)"

if [ -z "$PYTHON" ]; then
  echo "✗ python3 not found. Install Python 3 first." >&2
  exit 1
fi

# ── Install Python deps ──────────────────────────────────────────────────────
if [ "${DRY_RUN:-}" != "1" ]; then
  echo "Installing Python dependencies…"
  "$PYTHON" -m pip install -r "$SCRIPT_DIR/requirements.txt" -q
fi

# ── Write LaunchAgent plist ───────────────────────────────────────────────────
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$SERVER_PY</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$HOME</string>

  <key>KeepAlive</key>
  <true/>

  <key>RunAtLoad</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$LOG_PATH</string>

  <key>StandardErrorPath</key>
  <string>$LOG_PATH</string>
</dict>
</plist>
PLIST

echo "✓ Plist written to $PLIST_PATH"

# ── Load the agent ────────────────────────────────────────────────────────────
if [ "${DRY_RUN:-}" != "1" ]; then
  # Replace any stale registration before loading the current plist.
  launchctl bootout "$LAUNCH_DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootout "$LAUNCH_DOMAIN" "$PLIST_PATH" 2>/dev/null || true
  launchctl bootstrap "$LAUNCH_DOMAIN" "$PLIST_PATH"
  launchctl enable "$LAUNCH_DOMAIN/$LABEL" 2>/dev/null || true
  launchctl kickstart -k "$LAUNCH_DOMAIN/$LABEL" 2>/dev/null || true
  echo "✓ LaunchAgent loaded"

  # Poll /health for up to 10 seconds
  echo -n "Waiting for server"
  for i in $(seq 1 10); do
    if curl -sf http://127.0.0.1:5001/health >/dev/null 2>&1; then
      echo ""
      echo "✓ Server running on http://127.0.0.1:5001"
      exit 0
    fi
    echo -n "."
    sleep 1
  done
  echo ""
  echo "✗ Server did not start within 10s. Check $LOG_PATH for errors." >&2
  exit 1
fi
