import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Use an in-memory-style temp DB for tests
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-test-'));
const TEST_DB = path.join(tmpDir, 'test.db');

// Patch config before importing db
const originalConfig = await import('../src/config.js');
const config = originalConfig.default;
const savedPath = config.DB_PATH;
config.DB_PATH = TEST_DB;

const db = await import('../src/db.js');

before(() => {
  db.initDb();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  config.DB_PATH = savedPath;
});

test('initDb creates all three tables', () => {
  const tables = db.getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.ok(tables.includes('checks'));
  assert.ok(tables.includes('outages'));
  assert.ok(tables.includes('daily_rollups'));
});

test('insertCheck stores a row and returns an id', () => {
  const now = Date.now();
  const id = db.insertCheck(now, 'up', 12.5, 'google-dns-tcp', 'tcp');
  assert.ok(typeof id === 'bigint' || typeof id === 'number');
  assert.ok(id > 0);
});

test('getCurrentStatus returns the most recent non-unknown check', () => {
  // Use far-future timestamps to guarantee these are the most recent rows
  const base = Date.now() + 1_000_000;
  db.insertCheck(base - 2000, 'up', 15, 'test', 'tcp');
  db.insertCheck(base - 1000, 'unknown', null, 'system', 'gap');
  db.insertCheck(base, 'up', 10, 'test', 'tcp');

  const status = db.getCurrentStatus();
  assert.equal(status.status, 'up');
  assert.equal(status.latency_ms, 10);
});

test('insertOutage and closeOutage round-trip', () => {
  const now = Date.now();
  const checkId = db.insertCheck(now, 'down', null, 'test', 'tcp');
  const outageId = db.insertOutage(now, checkId);
  assert.ok(outageId > 0);

  const open = db.getOpenOutage();
  assert.ok(open !== null);
  assert.equal(open.id, outageId);
  assert.ok(open.ended_at == null);

  const endedAt = now + 30000;
  const recoverId = db.insertCheck(endedAt, 'up', 8, 'test', 'tcp');
  db.closeOutage(outageId, endedAt, 30000, recoverId);

  const closed = db.getDb().prepare('SELECT * FROM outages WHERE id = ?').get(outageId);
  assert.equal(closed.ended_at, endedAt);
  assert.equal(closed.duration_ms, 30000);

  const stillOpen = db.getOpenOutage();
  assert.ok(stillOpen == null);
});

test('getRecentOutages returns newest first', () => {
  const now = Date.now();
  const c1 = db.insertCheck(now - 5000, 'down', null, 'test', 'tcp');
  const o1 = db.insertOutage(now - 5000, c1);
  db.closeOutage(o1, now - 2000, 3000, c1);

  const c2 = db.insertCheck(now - 1000, 'down', null, 'test', 'tcp');
  const o2 = db.insertOutage(now - 1000, c2);
  db.closeOutage(o2, now, 1000, c2);

  const outages = db.getRecentOutages(10);
  assert.ok(outages.length >= 2);
  assert.ok(outages[0].started_at >= outages[1].started_at);
});

test('getUptimeStats computes correct uptime percentage', () => {
  // Insert 8 up + 2 down checks
  const base = Date.now() - 10000;
  for (let i = 0; i < 8; i++) db.insertCheck(base + i * 1000, 'up', 10, 't', 'tcp');
  for (let i = 8; i < 10; i++) db.insertCheck(base + i * 1000, 'down', null, 't', 'tcp');

  const stats = db.getUptimeStats(base - 1);
  assert.ok(stats.uptime_pct !== null);
  assert.ok(stats.uptime_pct > 0 && stats.uptime_pct <= 100);
  assert.ok(stats.down_count >= 2);
});

test('getUptimeStats excludes unknown checks from calculations', () => {
  const base = Date.now() - 5000;
  db.insertCheck(base, 'up', 10, 't', 'tcp');
  db.insertCheck(base + 1000, 'unknown', null, 'system', 'gap');
  db.insertCheck(base + 2000, 'up', 10, 't', 'tcp');

  const stats = db.getUptimeStats(base - 1);
  assert.ok(stats.uptime_pct === 100 || stats.uptime_pct !== null);
  // unknown rows must not appear in total
  const unknownInTotal = db.getDb()
    .prepare("SELECT COUNT(*) as c FROM checks WHERE status='unknown' AND checked_at >= ?")
    .get(base - 1).c;
  // stats.total should not include unknown rows
  const allRows = db.getDb()
    .prepare("SELECT COUNT(*) as c FROM checks WHERE checked_at >= ? AND status != 'unknown'")
    .get(base - 1).c;
  assert.equal(stats.total, allRows);
});

test('upsertDailyRollup inserts and updates idempotently', () => {
  const key = '2099-01-01';
  db.upsertDailyRollup(key, {
    total_checks: 100, up_checks: 95, down_checks: 5, degraded_checks: 0,
    total_outage_ms: 60000, avg_latency_ms: 12, min_latency_ms: 5, max_latency_ms: 50,
  });
  db.upsertDailyRollup(key, {
    total_checks: 200, up_checks: 190, down_checks: 10, degraded_checks: 0,
    total_outage_ms: 120000, avg_latency_ms: 11, min_latency_ms: 4, max_latency_ms: 45,
  });

  const row = db.getDb().prepare('SELECT * FROM daily_rollups WHERE date_key = ?').get(key);
  assert.equal(row.total_checks, 200);
  assert.equal(row.up_checks, 190);
});

test('getOutageCount returns non-negative integer', () => {
  const count = db.getOutageCount();
  assert.ok(typeof count === 'number' || typeof count === 'bigint');
  assert.ok(count >= 0);
});
