import * as db from './db.js';
import { getCurrentMonitorState } from './monitor.js';

function ninesFromPct(pct) {
  if (pct === null) return { nines: null, label: 'N/A' };
  if (pct >= 100) return { nines: 999, label: '∞' };
  const nines = -Math.log10(1 - pct / 100);
  const label = nines >= 4.9999 ? '5+' : nines.toFixed(1).replace(/\.0$/, '');
  return { nines, label };
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

export async function handleRequest(req, res, pathname, params) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    if (pathname === '/api/status') {
      const current = db.getCurrentStatus();
      const monState = getCurrentMonitorState();
      const stats24h = db.getUptimeStats(Date.now() - 86_400_000);
      const latency = db.getRecentLatency(1)[0];

      res.writeHead(200);
      res.end(JSON.stringify({
        status: current?.status ?? 'unknown',
        latency_ms: latency?.latency_ms ?? null,
        checked_at: current?.checked_at ?? null,
        uptime_24h: stats24h.uptime_pct,
        active_outage: monState.isOutage ? {
          id: monState.activeOutageId,
          started_at: monState.outageStartedAt,
          duration_ms: Date.now() - monState.outageStartedAt,
        } : null,
      }));
      return;
    }

    if (pathname === '/api/outages') {
      const limit = Math.min(parseInt(params.get('limit') ?? '20', 10), 100);
      const offset = parseInt(params.get('offset') ?? '0', 10);
      const outages = db.getRecentOutages(limit, offset);
      const total = db.getOutageCount();
      res.writeHead(200);
      res.end(JSON.stringify({ outages, total, limit, offset }));
      return;
    }

    if (pathname === '/api/uptime') {
      const period = params.get('period') ?? '24h';
      let since;
      const now = Date.now();
      if (period === '24h')  since = now - 86_400_000;
      else if (period === '7d')   since = now - 7 * 86_400_000;
      else if (period === '30d')  since = now - 30 * 86_400_000;
      else if (period === '90d')  since = now - 90 * 86_400_000;
      else if (period === 'all')  since = 0;
      else { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid period' })); return; }

      const stats = since === 0 ? db.getAllTimeUptimeStats() : db.getUptimeStats(since);
      res.writeHead(200);
      res.end(JSON.stringify({
        period,
        uptime_pct: stats.uptime_pct,
        total_checks: stats.total,
        up_checks: stats.up_count,
        down_checks: stats.down_count,
        ...ninesFromPct(stats.uptime_pct),
      }));
      return;
    }

    if (pathname === '/api/stats/hourly') {
      const today = new Date();
      const defaultDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const date = params.get('date') ?? defaultDate;
      const rows = db.getHourlyStats(date);
      res.writeHead(200);
      res.end(JSON.stringify({ date, hours: rows }));
      return;
    }

    if (pathname === '/api/stats/daily') {
      const days = Math.min(parseInt(params.get('days') ?? '30', 10), 365);
      const rows = db.getDailyRollups(days);
      res.writeHead(200);
      res.end(JSON.stringify({ days, rollups: rows }));
      return;
    }

    if (pathname === '/api/nines') {
      const now = Date.now();
      const periods = [
        { key: '1h',   ms: 3_600_000 },
        { key: '24h',  ms: 86_400_000 },
        { key: '7d',   ms: 7 * 86_400_000 },
        { key: '30d',  ms: 30 * 86_400_000 },
        { key: '90d',  ms: 90 * 86_400_000 },
        { key: 'all',  ms: null },
      ];

      const result = {};
      for (const p of periods) {
        const stats = p.ms === null
          ? db.getAllTimeUptimeStats()
          : db.getUptimeStats(now - p.ms);
        const { nines, label } = ninesFromPct(stats.uptime_pct);
        const periodMs = p.ms ?? (now - (stats.first_check_at ?? now));
        const downtime_ms = stats.total > 0
          ? Math.round((1 - (stats.up_count ?? 0) / stats.total) * periodMs)
          : 0;
        result[p.key] = {
          pct: stats.uptime_pct,
          nines,
          label,
          downtime_ms,
          downtime_readable: formatDuration(downtime_ms),
          total_checks: stats.total,
        };
      }

      res.writeHead(200);
      res.end(JSON.stringify(result));
      return;
    }

    if (pathname === '/api/latency') {
      const limit = Math.min(parseInt(params.get('limit') ?? '60', 10), 500);
      const rows = db.getRecentLatency(limit);
      res.writeHead(200);
      res.end(JSON.stringify({ points: rows }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (err) {
    console.error('[api] Error:', err);
    res.writeHead(500);
    res.end(JSON.stringify({ error: 'internal server error' }));
  }
}
