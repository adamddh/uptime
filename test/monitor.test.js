import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-mon-test-'));
const TEST_DB = path.join(tmpDir, 'test.db');

const config = (await import('../src/config.js')).default;
const savedDbPath = config.DB_PATH;
const savedInterval = config.CHECK_INTERVAL_MS;
config.DB_PATH = TEST_DB;
config.CHECK_INTERVAL_MS = 99999;

const db = await import('../src/db.js');
db.initDb();

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  config.DB_PATH = savedDbPath;
  config.CHECK_INTERVAL_MS = savedInterval;
});

test('recoverState finds no open outage when DB is empty', async () => {
  const monitor = await import('../src/monitor.js');
  monitor.recoverState();
  const state = monitor.getCurrentMonitorState();
  assert.equal(state.isOutage, false);
  assert.equal(state.activeOutageId, null);
});

test('recoverState finds open outage from DB', async () => {
  const now = Date.now();
  const cId = db.insertCheck(now - 10000, 'down', null, 'test', 'tcp');
  db.insertOutage(now - 10000, cId);

  // Re-import to get fresh state (module cache means we need to reset manually)
  const monitor = await import('../src/monitor.js');
  monitor.recoverState();
  const state = monitor.getCurrentMonitorState();
  assert.equal(state.isOutage, true);
  assert.ok(state.activeOutageId !== null);
});

test('getCurrentMonitorState returns expected shape', async () => {
  const monitor = await import('../src/monitor.js');
  const state = monitor.getCurrentMonitorState();
  assert.ok('isOutage' in state);
  assert.ok('activeOutageId' in state);
  assert.ok('outageStartedAt' in state);
  assert.ok('consecutiveFailures' in state);
  assert.ok('consecutiveSuccesses' in state);
});

test('DB WAL mode is enabled', () => {
  const mode = db.getDb().pragma('journal_mode', { simple: true });
  assert.equal(mode, 'wal');
});

test('checks table has correct schema columns', () => {
  const cols = db.getDb()
    .prepare("PRAGMA table_info(checks)")
    .all()
    .map((c) => c.name);
  assert.ok(cols.includes('id'));
  assert.ok(cols.includes('checked_at'));
  assert.ok(cols.includes('status'));
  assert.ok(cols.includes('latency_ms'));
  assert.ok(cols.includes('target'));
  assert.ok(cols.includes('method'));
});

test('outages table has correct schema columns', () => {
  const cols = db.getDb()
    .prepare("PRAGMA table_info(outages)")
    .all()
    .map((c) => c.name);
  assert.ok(cols.includes('id'));
  assert.ok(cols.includes('started_at'));
  assert.ok(cols.includes('ended_at'));
  assert.ok(cols.includes('duration_ms'));
});

test('status CHECK constraint rejects invalid values', () => {
  assert.throws(() => {
    db.insertCheck(Date.now(), 'invalid-status', null, 'test', 'tcp');
  });
});

test('insertCheck returns incrementing IDs', () => {
  const now = Date.now();
  const id1 = db.insertCheck(now, 'up', 10, 'test', 'tcp');
  const id2 = db.insertCheck(now + 1, 'up', 11, 'test', 'tcp');
  assert.ok(BigInt(id2) > BigInt(id1));
});
