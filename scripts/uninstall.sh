#!/usr/bin/env bash
set -e

PLIST_LABEL="com.uptime-monitor"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

echo "==> Stopping Uptime Monitor..."

if launchctl list "$PLIST_LABEL" &>/dev/null; then
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
  echo "    Agent unloaded ✓"
else
  echo "    Agent not running"
fi

if [ -f "$PLIST_DEST" ]; then
  rm "$PLIST_DEST"
  echo "    Plist removed ✓"
fi

echo ""
echo "✓ Uptime Monitor uninstalled."
echo "  (Data in data/uptime.db was kept)"
