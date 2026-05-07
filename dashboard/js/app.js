import { initHourlyChart, updateHourlyChart, initDailyChart, updateDailyChart, initSparkline, pushSparklinePoint, setSparklineData } from './charts.js';
import { renderGauge, renderNinesTable } from './nines.js';

const WS_PORT = 5174;
const API = '';

let ws = null;
let wsReconnectTimer = null;
let lastCheckAt = null;
let activeOutage = null;
let outageOffset = 0;
const OUTAGE_PAGE_SIZE = 20;

// ── DOM refs ──────────────────────────────────────────────
const elStatusDot    = document.getElementById('status-dot');
const elStatusText   = document.getElementById('status-text');
const elStatusSub    = document.getElementById('status-sub');
const elCardStatus   = document.getElementById('card-status');
const elLatency      = document.getElementById('latency-value');
const elUptime24h    = document.getElementById('uptime-24h');
const elUptime24hSub = document.getElementById('uptime-24h-sub');
const elUptime30d    = document.getElementById('uptime-30d');
const elUptime30dSub = document.getElementById('uptime-30d-sub');
const elLastCheck    = document.getElementById('last-check-label');
const elWsDot        = document.getElementById('ws-indicator');
const elTodayDate    = document.getElementById('today-date');
const elOutagesList  = document.getElementById('outages-list');
const elOutageCount  = document.getElementById('outage-count-label');
const elLoadMore     = document.getElementById('load-more-btn');

// ── Utilities ─────────────────────────────────────────────
function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function formatDateTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (isToday) return `Today ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

function timeSince(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5)  return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

// ── Status updates ────────────────────────────────────────
function applyStatus(status, latency_ms, checked_at, active_outage) {
  elStatusDot.className = `status-dot ${status}`;
  elCardStatus.className = `card card-status is-${status}`;

  const labels = { up: 'Online', down: 'Offline', degraded: 'Degraded', unknown: 'Unknown' };
  elStatusText.textContent = labels[status] ?? status;

  if (active_outage) {
    const dur = Date.now() - active_outage.started_at;
    elStatusSub.textContent = `Outage: ${formatDuration(dur)}`;
  } else if (status === 'up') {
    elStatusSub.textContent = latency_ms !== null ? `${Math.round(latency_ms)} ms` : '';
  } else {
    elStatusSub.textContent = '';
  }

  if (latency_ms !== null && latency_ms !== undefined) {
    elLatency.textContent = `${Math.round(latency_ms)} ms`;
    pushSparklinePoint(latency_ms);
  }

  if (checked_at) {
    lastCheckAt = checked_at;
  }
}

function applyUptimeStats(stats24h, stats30d) {
  if (stats24h !== null && stats24h !== undefined) {
    elUptime24h.textContent = stats24h.toFixed(3) + '%';
    const nines = stats24h >= 100 ? '∞' : (-Math.log10(1 - stats24h / 100)).toFixed(1);
    elUptime24hSub.textContent = `${nines} nines`;
  }
  if (stats30d !== null && stats30d !== undefined) {
    elUptime30d.textContent = stats30d.toFixed(3) + '%';
    const nines = stats30d >= 100 ? '∞' : (-Math.log10(1 - stats30d / 100)).toFixed(1);
    elUptime30dSub.textContent = `${nines} nines`;
  }
}

// ── Outages list ──────────────────────────────────────────
function renderOutageRow(o) {
  const div = document.createElement('div');
  div.className = 'outage-row';
  div.dataset.outageId = o.id;

  const isActive = o.ended_at === null || o.ended_at === undefined;
  const duration = isActive
    ? formatDuration(Date.now() - o.started_at)
    : formatDuration(o.duration_ms);

  const timeStr = isActive
    ? `${formatDateTime(o.started_at)} — ongoing`
    : `${formatDateTime(o.started_at)} — ${formatDateTime(o.ended_at)}`;

  div.innerHTML = `
    <span class="outage-dot ${isActive ? 'active' : 'resolved'}"></span>
    <span class="outage-time">${timeStr}</span>
    <span class="outage-duration">${duration}</span>
    <span class="outage-badge ${isActive ? 'active' : 'resolved'}">${isActive ? 'Active' : 'Resolved'}</span>
  `;
  return div;
}

function renderOutages(outages, append = false) {
  if (!append) {
    elOutagesList.innerHTML = '';
    outageOffset = 0;
  }

  if (outages.length === 0 && !append) {
    elOutagesList.innerHTML = '<div class="outage-empty">No outages recorded yet.</div>';
    elLoadMore.style.display = 'none';
    return;
  }

  for (const o of outages) {
    elOutagesList.appendChild(renderOutageRow(o));
  }
}

// ── API fetches ───────────────────────────────────────────
async function fetchStatus() {
  try {
    const r = await fetch(`${API}/api/status`);
    const d = await r.json();
    applyStatus(d.status, d.latency_ms, d.checked_at, d.active_outage);
    applyUptimeStats(d.uptime_24h, null);
    activeOutage = d.active_outage ?? null;
  } catch {}
}

async function fetchUptime30d() {
  try {
    const r = await fetch(`${API}/api/uptime?period=30d`);
    const d = await r.json();
    applyUptimeStats(null, d.uptime_pct);
  } catch {}
}

async function fetchNines() {
  try {
    const r = await fetch(`${API}/api/nines`);
    const d = await r.json();
    renderGauge(d['30d']?.pct ?? null);
    renderNinesTable(d);
  } catch {}
}

async function fetchHourly() {
  try {
    const r = await fetch(`${API}/api/stats/hourly`);
    const d = await r.json();
    updateHourlyChart(d.hours ?? []);
    elTodayDate.textContent = d.date ?? '';
  } catch {}
}

async function fetchDaily() {
  try {
    const r = await fetch(`${API}/api/stats/daily?days=30`);
    const d = await r.json();
    updateDailyChart(d.rollups ?? []);
  } catch {}
}

async function fetchLatencyHistory() {
  try {
    const r = await fetch(`${API}/api/latency?limit=60`);
    const d = await r.json();
    setSparklineData(d.points ?? []);
  } catch {}
}

async function fetchOutages(append = false) {
  try {
    const r = await fetch(`${API}/api/outages?limit=${OUTAGE_PAGE_SIZE}&offset=${outageOffset}`);
    const d = await r.json();
    renderOutages(d.outages ?? [], append);
    outageOffset += (d.outages ?? []).length;
    elOutageCount.textContent = d.total > 0 ? `${d.total} total` : '';
    elLoadMore.style.display = outageOffset < d.total ? 'block' : 'none';
  } catch {}
}

// ── WebSocket ─────────────────────────────────────────────
function connectWs() {
  if (ws) { ws.onclose = null; ws.close(); }
  elWsDot.className = 'ws-dot reconnecting';

  ws = new WebSocket(`ws://localhost:${WS_PORT}`);

  ws.onopen = () => {
    elWsDot.className = 'ws-dot connected';
    clearTimeout(wsReconnectTimer);
  };

  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }

    if (msg.type === 'check') {
      applyStatus(msg.status, msg.latency_ms, msg.checked_at, msg.active_outage);
      applyUptimeStats(msg.uptime_24h ?? null, msg.uptime_30d ?? null);
      activeOutage = msg.active_outage ?? null;
    } else if (msg.type === 'outage_started') {
      activeOutage = { started_at: msg.started_at };
      fetchOutages();
      fetchNines();
    } else if (msg.type === 'outage_ended') {
      activeOutage = null;
      fetchOutages();
      fetchNines();
    } else if (msg.type === 'state_sync') {
      if (msg.status) applyStatus(msg.status.status, msg.status.latency_ms, msg.status.checked_at, msg.status.active_outage);
      if (msg.uptime) applyUptimeStats(msg.uptime['24h'], msg.uptime['30d']);
    }
  };

  ws.onclose = () => {
    elWsDot.className = 'ws-dot disconnected';
    wsReconnectTimer = setTimeout(connectWs, 3000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

// ── Last-check + outage duration ticker ───────────────────
setInterval(() => {
  if (lastCheckAt) {
    elLastCheck.textContent = 'Last check: ' + timeSince(lastCheckAt);
  }
  if (activeOutage) {
    elStatusSub.textContent = `Outage: ${formatDuration(Date.now() - activeOutage.started_at)}`;
  }
}, 1000);

// ── Periodic refresh ──────────────────────────────────────
setInterval(() => {
  fetchHourly();
  fetchDaily();
  fetchNines();
}, 60_000);

// ── Load more ─────────────────────────────────────────────
elLoadMore.addEventListener('click', () => fetchOutages(true));

// ── Boot ──────────────────────────────────────────────────
initHourlyChart();
initDailyChart();
initSparkline();

(async () => {
  await Promise.all([
    fetchStatus(),
    fetchUptime30d(),
    fetchNines(),
    fetchHourly(),
    fetchDaily(),
    fetchLatencyHistory(),
    fetchOutages(),
  ]);
  connectWs();
})();
