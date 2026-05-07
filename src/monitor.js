import net from 'net';
import dns from 'dns';
import https from 'https';
import config from './config.js';
import * as db from './db.js';
import { broadcast } from './broadcaster.js';

const dnsResolver = new dns.promises.Resolver();
dnsResolver.setServers(['8.8.8.8']);

let state = {
  isOutage: false,
  activeOutageId: null,
  outageStartedAt: null,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  lastCheckAt: null,
  lastCheckId: null,
};

function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let done = false;

    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ ok, latency: ok ? Date.now() - start : null });
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
    socket.connect(port, host);
  });
}

function probeHttp(url, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    let done = false;

    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve({ ok, latency: ok ? Date.now() - start : null });
    };

    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      finish(res.statusCode < 500);
    });

    req.on('timeout', () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
    setTimeout(() => { req.destroy(); finish(false); }, timeoutMs + 500);
  });
}

function probeDns(host, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setTimeout(() => resolve({ ok: false, latency: null }), timeoutMs);

    dnsResolver.resolve4(host)
      .then(() => {
        clearTimeout(timer);
        resolve({ ok: true, latency: Date.now() - start });
      })
      .catch(() => {
        clearTimeout(timer);
        resolve({ ok: false, latency: null });
      });
  });
}

async function runProbe(target) {
  try {
    if (target.method === 'tcp') {
      return probeTcp(target.host, target.port, config.PROBE_TIMEOUT_MS);
    } else if (target.method === 'http') {
      return probeHttp(target.url, config.PROBE_TIMEOUT_MS);
    } else if (target.method === 'dns') {
      return probeDns(target.host, config.PROBE_TIMEOUT_MS);
    }
  } catch {
    return { ok: false, latency: null };
  }
}

function toLocalDateStr(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function runCheckCycle() {
  const now = Date.now();

  if (state.lastCheckAt !== null && now - state.lastCheckAt > config.SLEEP_GAP_THRESHOLD_MS) {
    const gapId = db.insertCheck(now, 'unknown', null, 'system', 'gap');
    console.log(`[monitor] Sleep gap detected: ${Math.round((now - state.lastCheckAt) / 1000)}s`);
    state.lastCheckId = gapId;
  }

  const results = await Promise.allSettled(
    config.TARGETS.map((t) => runProbe(t))
  );

  const probeResults = results.map((r, i) => ({
    target: config.TARGETS[i],
    ok: r.status === 'fulfilled' ? r.value.ok : false,
    latency: r.status === 'fulfilled' ? r.value.latency : null,
  }));

  const failures = probeResults.filter((r) => !r.ok).length;
  let cycleStatus;
  if (failures >= config.CONSENSUS_THRESHOLD) {
    cycleStatus = 'down';
  } else if (failures >= 1) {
    cycleStatus = 'degraded';
  } else {
    cycleStatus = 'up';
  }

  const avgLatency = probeResults
    .filter((r) => r.ok && r.latency !== null)
    .reduce((acc, r, _, arr) => acc + r.latency / arr.length, 0) || null;

  let lastId;
  for (const r of probeResults) {
    lastId = db.insertCheck(now, cycleStatus, r.latency, r.target.id, r.target.method);
  }
  state.lastCheckId = lastId;
  state.lastCheckAt = now;

  updateOutageStateMachine(cycleStatus, now, lastId);

  broadcast({
    type: 'check',
    status: cycleStatus,
    latency_ms: avgLatency ? Math.round(avgLatency * 10) / 10 : null,
    checked_at: now,
  });

  const dateStr = toLocalDateStr(now);
  try { db.computeAndUpsertRollup(dateStr); } catch {}
}

function updateOutageStateMachine(status, now, checkId) {
  if (status === 'down' || status === 'degraded') {
    state.consecutiveSuccesses = 0;
    state.consecutiveFailures++;

    if (!state.isOutage && state.consecutiveFailures >= config.OUTAGE_THRESHOLD) {
      state.isOutage = true;
      const startedAt = now - (config.consecutiveFailures - 1) * config.CHECK_INTERVAL_MS;
      state.outageStartedAt = now;
      state.activeOutageId = db.insertOutage(now, checkId);
      broadcast({ type: 'outage_started', outage_id: state.activeOutageId, started_at: now });
      console.log(`[monitor] Outage started at ${new Date(now).toISOString()}`);
    }
  } else {
    state.consecutiveFailures = 0;
    state.consecutiveSuccesses++;

    if (state.isOutage && state.consecutiveSuccesses >= config.RECOVERY_THRESHOLD) {
      const duration = now - state.outageStartedAt;
      db.closeOutage(state.activeOutageId, now, duration, checkId);
      broadcast({
        type: 'outage_ended',
        outage_id: state.activeOutageId,
        ended_at: now,
        duration_ms: duration,
      });
      console.log(`[monitor] Outage ended. Duration: ${Math.round(duration / 1000)}s`);
      state.isOutage = false;
      state.activeOutageId = null;
      state.outageStartedAt = null;
    }
  }
}

export function recoverState() {
  const open = db.getOpenOutage();
  if (open) {
    state.isOutage = true;
    state.activeOutageId = open.id;
    state.outageStartedAt = open.started_at;
    state.consecutiveFailures = config.OUTAGE_THRESHOLD;
    console.log(`[monitor] Recovered open outage #${open.id} from ${new Date(open.started_at).toISOString()}`);
  }
}

export function getCurrentMonitorState() {
  return {
    isOutage: state.isOutage,
    activeOutageId: state.activeOutageId,
    outageStartedAt: state.outageStartedAt,
    consecutiveFailures: state.consecutiveFailures,
    consecutiveSuccesses: state.consecutiveSuccesses,
  };
}

let intervalHandle = null;

export function start() {
  recoverState();
  runCheckCycle().catch(console.error);
  intervalHandle = setInterval(() => {
    runCheckCycle().catch(console.error);
  }, config.CHECK_INTERVAL_MS);
  console.log(`[monitor] Started. Checking every ${config.CHECK_INTERVAL_MS / 1000}s`);
}

export function stop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  if (state.isOutage && state.activeOutageId) {
    const now = Date.now();
    db.closeOutage(state.activeOutageId, now, now - state.outageStartedAt, state.lastCheckId);
    console.log('[monitor] Closed open outage on shutdown');
  }
}
