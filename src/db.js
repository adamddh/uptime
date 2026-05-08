import Database from 'better-sqlite3';
import config from './config.js';

let db;

export function initDb() {
  db = new Database(config.DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS checks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      checked_at  INTEGER NOT NULL,
      status      TEXT    NOT NULL CHECK (status IN ('up','down','degraded','unknown')),
      latency_ms  REAL,
      target      TEXT    NOT NULL,
      method      TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_checks_checked_at ON checks(checked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_checks_status     ON checks(status, checked_at DESC);

    CREATE TABLE IF NOT EXISTS outages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at     INTEGER NOT NULL,
      ended_at       INTEGER,
      duration_ms    INTEGER,
      first_check_id INTEGER REFERENCES checks(id),
      last_check_id  INTEGER REFERENCES checks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_outages_started_at ON outages(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_outages_ended_at   ON outages(ended_at DESC);

    CREATE TABLE IF NOT EXISTS daily_rollups (
      date_key        TEXT    PRIMARY KEY,
      total_checks    INTEGER NOT NULL DEFAULT 0,
      up_checks       INTEGER NOT NULL DEFAULT 0,
      down_checks     INTEGER NOT NULL DEFAULT 0,
      degraded_checks INTEGER NOT NULL DEFAULT 0,
      total_outage_ms INTEGER NOT NULL DEFAULT 0,
      avg_latency_ms  REAL,
      min_latency_ms  REAL,
      max_latency_ms  REAL,
      updated_at      INTEGER NOT NULL
    );
  `);

  return db;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function insertCheck(checked_at, status, latency_ms, target, method) {
  return getDb()
    .prepare('INSERT INTO checks (checked_at, status, latency_ms, target, method) VALUES (?,?,?,?,?)')
    .run(checked_at, status, latency_ms ?? null, target, method)
    .lastInsertRowid;
}

export function insertOutage(started_at, first_check_id) {
  return getDb()
    .prepare('INSERT INTO outages (started_at, first_check_id) VALUES (?,?)')
    .run(started_at, first_check_id)
    .lastInsertRowid;
}

export function closeOutage(outage_id, ended_at, duration_ms, last_check_id) {
  getDb()
    .prepare('UPDATE outages SET ended_at=?, duration_ms=?, last_check_id=? WHERE id=?')
    .run(ended_at, duration_ms, last_check_id, outage_id);
}

export function getOpenOutage() {
  return getDb()
    .prepare('SELECT * FROM outages WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
    .get();
}

export function getRecentOutages(limit = 20, offset = 0) {
  return getDb()
    .prepare(`
      SELECT id, started_at, ended_at, duration_ms
      FROM outages
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(limit, offset);
}

export function getOutageCount() {
  return getDb()
    .prepare('SELECT COUNT(*) as count FROM outages')
    .get().count;
}

export function getCurrentStatus() {
  return getDb()
    .prepare(`
      SELECT status, latency_ms, checked_at
      FROM checks
      WHERE status != 'unknown'
      ORDER BY checked_at DESC
      LIMIT 1
    `)
    .get();
}

export function getRecentLatency(limit = 60) {
  return getDb()
    .prepare(`
      SELECT checked_at, latency_ms
      FROM checks
      WHERE status = 'up' AND latency_ms IS NOT NULL
      ORDER BY checked_at DESC
      LIMIT ?
    `)
    .all(limit)
    .reverse();
}

export function getUptimeStats(since_ms) {
  const row = getDb()
    .prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as up_count,
        SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) as down_count,
        SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) as degraded_count,
        AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) as avg_latency
      FROM checks
      WHERE checked_at >= ? AND status != 'unknown'
    `)
    .get(since_ms);

  const total = row.total || 0;
  const uptime_pct = total > 0 ? (row.up_count / total) * 100 : null;
  return { ...row, total, uptime_pct };
}

export function getHourlyStats(date_str) {
  const [y, m, d] = date_str.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const dayEnd = dayStart + 86_400_000;

  return getDb()
    .prepare(`
      SELECT
        CAST((checked_at - ?) / 3600000 AS INTEGER) as hour,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as up_count,
        SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) as down_count,
        SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) as degraded_count,
        AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) as avg_latency_ms
      FROM checks
      WHERE checked_at >= ? AND checked_at < ? AND status != 'unknown'
      GROUP BY hour
      ORDER BY hour
    `)
    .all(dayStart, dayStart, dayEnd);
}

export function getDailyRollups(days) {
  return getDb()
    .prepare(`
      SELECT *
      FROM daily_rollups
      ORDER BY date_key DESC
      LIMIT ?
    `)
    .all(days);
}

export function upsertDailyRollup(date_key, stats) {
  getDb()
    .prepare(`
      INSERT INTO daily_rollups
        (date_key, total_checks, up_checks, down_checks, degraded_checks,
         total_outage_ms, avg_latency_ms, min_latency_ms, max_latency_ms, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(date_key) DO UPDATE SET
        total_checks    = excluded.total_checks,
        up_checks       = excluded.up_checks,
        down_checks     = excluded.down_checks,
        degraded_checks = excluded.degraded_checks,
        total_outage_ms = excluded.total_outage_ms,
        avg_latency_ms  = excluded.avg_latency_ms,
        min_latency_ms  = excluded.min_latency_ms,
        max_latency_ms  = excluded.max_latency_ms,
        updated_at      = excluded.updated_at
    `)
    .run(
      date_key,
      stats.total_checks,
      stats.up_checks,
      stats.down_checks,
      stats.degraded_checks,
      stats.total_outage_ms,
      stats.avg_latency_ms ?? null,
      stats.min_latency_ms ?? null,
      stats.max_latency_ms ?? null,
      Date.now()
    );
}

export function computeAndUpsertRollup(date_str) {
  const [y, m, d] = date_str.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const dayEnd = dayStart + 86_400_000;

  const checks = getDb()
    .prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as up_checks,
        SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) as down_checks,
        SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) as degraded_checks,
        AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) as avg_latency_ms,
        MIN(latency_ms) as min_latency_ms,
        MAX(latency_ms) as max_latency_ms
      FROM checks
      WHERE checked_at >= ? AND checked_at < ? AND status != 'unknown'
    `)
    .get(dayStart, dayEnd);

  const outages = getDb()
    .prepare(`
      SELECT COALESCE(SUM(
        CASE
          WHEN ended_at IS NOT NULL
            THEN MIN(ended_at, ?) - MAX(started_at, ?)
          ELSE
            MIN(?, ?) - MAX(started_at, ?)
        END
      ), 0) as total_outage_ms
      FROM outages
      WHERE started_at < ? AND (ended_at IS NULL OR ended_at > ?)
    `)
    .get(dayEnd, dayStart, Date.now(), dayEnd, dayStart, dayEnd, dayStart);

  upsertDailyRollup(date_str, {
    total_checks:    checks.total,
    up_checks:       checks.up_checks,
    down_checks:     checks.down_checks,
    degraded_checks: checks.degraded_checks,
    total_outage_ms: outages.total_outage_ms,
    avg_latency_ms:  checks.avg_latency_ms,
    min_latency_ms:  checks.min_latency_ms,
    max_latency_ms:  checks.max_latency_ms,
  });
}

export function getUptimeStatsSince(since_ms) {
  return getUptimeStats(since_ms);
}

export function getAllTimeUptimeStats() {
  const row = getDb()
    .prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as up_count,
        SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) as down_count,
        SUM(CASE WHEN status = 'degraded' THEN 1 ELSE 0 END) as degraded_count,
        AVG(CASE WHEN latency_ms IS NOT NULL THEN latency_ms END) as avg_latency,
        MIN(checked_at) as first_check_at
      FROM checks
      WHERE status != 'unknown'
    `)
    .get();

  const total = row.total || 0;
  const uptime_pct = total > 0 ? (row.up_count / total) * 100 : null;
  return { ...row, total, uptime_pct };
}
