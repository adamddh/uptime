#!/usr/bin/env bash
set -e

PLIST_LABEL="com.uptime-monitor"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$PROJECT_DIR/com.uptime-monitor.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

echo "==> Uptime Monitor install"
echo "    Project: $PROJECT_DIR"

# ── Check Node.js ──
NODE_BIN="$(which node 2>/dev/null || true)"
if [ -z "$NODE_BIN" ]; then
  echo ""
  echo "ERROR: node not found on PATH."
  echo "Install Node.js (>=20) first:"
  echo "  brew install node    # via Homebrew"
  echo "  https://nodejs.org/  # direct download"
  exit 1
fi

NODE_VERSION="$("$NODE_BIN" --version 2>/dev/null | sed 's/v//')"
NODE_MAJOR="$(echo "$NODE_VERSION" | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
  echo "ERROR: Node.js $NODE_VERSION found but >=20 required."
  exit 1
fi
echo "    Node: $NODE_BIN ($NODE_VERSION) ✓"

# ── npm install ──
echo "==> Installing dependencies..."
cd "$PROJECT_DIR"
npm install --omit=dev

# ── Download Chart.js if missing ──
VENDOR_DIR="$PROJECT_DIR/dashboard/js/vendor"
CHART_JS="$VENDOR_DIR/chart.min.js"
if [ ! -f "$CHART_JS" ]; then
  echo "==> Downloading Chart.js..."
  mkdir -p "$VENDOR_DIR"
  curl -fsSL "https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js" -o "$CHART_JS"
  echo "    chart.min.js downloaded ✓"
else
  echo "    chart.min.js already present ✓"
fi

# ── Create runtime dirs ──
mkdir -p "$PROJECT_DIR/data" "$PROJECT_DIR/logs"

# ── Unload existing agent if running ──
if launchctl list "$PLIST_LABEL" &>/dev/null; then
  echo "==> Unloading existing agent..."
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

# ── Write plist with real paths ──
echo "==> Writing launchd plist..."
sed \
  -e "s|NODE_BIN_PLACEHOLDER|$NODE_BIN|g" \
  -e "s|PROJECT_DIR_PLACEHOLDER|$PROJECT_DIR|g" \
  "$PLIST_SRC" > "$PLIST_DEST"

# ── Load agent ──
echo "==> Loading launchd agent..."
launchctl load "$PLIST_DEST"

echo ""
echo "✓ Uptime Monitor is running!"
echo "  Dashboard → http://localhost:5173"
echo ""
echo "  To stop:      npm run uninstall-service"
echo "  View logs:    tail -f $PROJECT_DIR/logs/monitor.log"
