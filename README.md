# Uptime Monitor

Tracks your internet connection 24/7 and shows a dashboard with outage history, durations, and uptime percentages ("how many nines").

## How it works

Every 5 seconds, the app probes 4 targets in parallel (two TCP DNS checks, one HTTP check, one DNS resolve). If 2+ targets fail simultaneously, an outage is recorded. A local SQLite database stores every check and outage session forever. A web dashboard at `http://localhost:5173` shows live status, charts, and history.

The app runs as a macOS launchd background service — it starts automatically on login, restarts itself if it crashes, and keeps running while your Mac is sleeping (when plugged in via Power Nap).

## Requirements

- macOS
- Node.js 20 or later

Check if you have it:
```bash
node --version
```

If not, install via Homebrew:
```bash
brew install node
```

Or download from [nodejs.org](https://nodejs.org).

## Setup

```bash
npm run install-service
```

This will:
1. Install dependencies (`better-sqlite3`, `ws`)
2. Download Chart.js for the dashboard
3. Register and start the launchd background service

Once complete, open the dashboard:
```
http://localhost:5173
```

The monitor is now running. It will start automatically on every login.

## Running manually (without the background service)

```bash
npm start
```

Then open `http://localhost:5173`. The monitor runs until you stop it with `Ctrl+C`.

For development with auto-restart on file changes:
```bash
npm run dev
```

## Configuration

All settings are in `src/config.js`:

| Setting | Default | Description |
|---|---|---|
| `CHECK_INTERVAL_MS` | `5000` | How often to probe (ms) |
| `PROBE_TIMEOUT_MS` | `3000` | Per-probe timeout (ms) |
| `OUTAGE_THRESHOLD` | `2` | Consecutive failures before recording an outage |
| `RECOVERY_THRESHOLD` | `2` | Consecutive successes before closing an outage |
| `CONSENSUS_THRESHOLD` | `2` | Number of targets that must fail to count as down |
| `HTTP_PORT` | `5173` | Dashboard port |

After changing config, restart the service:
```bash
npm run uninstall-service && npm run install-service
```

**On battery life:** The 5-second interval wakes the process ~17,000 times per day. If you're often on battery, raising `CHECK_INTERVAL_MS` to `30000` reduces that significantly while still detecting outages within ~60 seconds.

**On false positives:** If you see brief outages that didn't affect your browsing, raise `OUTAGE_THRESHOLD` to `3`. This requires 15 seconds of consecutive failures before recording an outage, filtering out single-cycle network blips.

## Sleep and shutdown behavior

**Sleep:** When your Mac sleeps, the monitor pauses. On wake, it detects the gap and records it as `unknown` (shown as a gray gap in the dashboard). These periods are excluded from uptime calculations so they don't count as outages.

**Shutdown / restart:** The service starts automatically on next login. All history is preserved.

**Hard shutdown (power loss):** Any outage that was open when the machine died will remain open until the next probe cycle after reboot. Its duration will be inflated to include the downtime. This is a known limitation.

## Stopping and uninstalling

### Stop the service (keep your data)

```bash
npm run uninstall-service
```

The process stops and won't restart on reboot. Your database and all history are untouched. To restart later: `npm run install-service`.

### Delete everything

First uninstall the service, then delete the project folder:

```bash
npm run uninstall-service
rm -rf /path/to/uptime
```

> **Important:** uninstall before deleting. If you delete the folder first, launchd will keep trying to restart a missing process every 10 seconds. If that happens, clean up manually:
> ```bash
> launchctl unload ~/Library/LaunchAgents/com.uptime-monitor.plist
> rm ~/Library/LaunchAgents/com.uptime-monitor.plist
> ```

## Database

The SQLite database lives at `data/uptime.db`. You can inspect it directly:

```bash
sqlite3 data/uptime.db
```

Useful queries:
```sql
-- All outages
SELECT id, datetime(started_at/1000, 'unixepoch', 'localtime') as started,
       datetime(ended_at/1000, 'unixepoch', 'localtime') as ended,
       round(duration_ms / 60000.0, 1) as duration_min
FROM outages ORDER BY started_at DESC;

-- Uptime % last 7 days
SELECT round(100.0 * SUM(status = 'up') / COUNT(*), 4) as uptime_pct
FROM checks
WHERE checked_at > (unixepoch('now') - 604800) * 1000
  AND status != 'unknown';
```

Export a backup:
```bash
npm run db:export
```

## Running tests

```bash
npm test
```

39 tests covering the database layer, API endpoints, monitor state machine, and nines calculations.
