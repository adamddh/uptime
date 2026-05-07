import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-api-test-'));
const TEST_DB = path.join(tmpDir, 'test.db');

const config = (await import('../src/config.js')).default;
const savedDbPath = config.DB_PATH;
const savedHttpPort = config.HTTP_PORT;
const savedWsPort = config.WS_PORT;
config.DB_PATH = TEST_DB;
config.HTTP_PORT = 15173;
config.WS_PORT = 15174;

const db = await import('../src/db.js');
db.initDb();

// Seed some data
const now = Date.now();
for (let i = 0; i < 10; i++) {
  db.insertCheck(now - i * 5000, i < 8 ? 'up' : 'down', i < 8 ? 15 - i : null, 'test', 'tcp');
}
const c = db.insertCheck(now - 60000, 'down', null, 'test', 'tcp');
const oid = db.insertOutage(now - 60000, c);
db.closeOutage(oid, now - 30000, 30000, c);

const broadcasterMod = await import('../src/broadcaster.js');
broadcasterMod.init();

const server = await import('../src/server.js');
const httpServer = server.start();

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${config.HTTP_PORT}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    }).on('error', reject);
  });
}

after(() => {
  httpServer.close();
  broadcasterMod.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  config.DB_PATH = savedDbPath;
  config.HTTP_PORT = savedHttpPort;
  config.WS_PORT = savedWsPort;
});

test('GET /api/status returns status object', async () => {
  const { status, body } = await get('/api/status');
  assert.equal(status, 200);
  assert.ok(['up', 'down', 'degraded', 'unknown'].includes(body.status));
  assert.ok('checked_at' in body);
  assert.ok('uptime_24h' in body);
});

test('GET /api/outages returns outage list with total', async () => {
  const { status, body } = await get('/api/outages');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.outages));
  assert.ok(typeof body.total === 'number');
  assert.ok(body.total >= 1);
  const o = body.outages[0];
  assert.ok('started_at' in o);
  assert.ok('ended_at' in o);
  assert.ok('duration_ms' in o);
});

test('GET /api/outages respects limit param', async () => {
  const { body } = await get('/api/outages?limit=1');
  assert.ok(body.outages.length <= 1);
});

test('GET /api/uptime?period=24h returns percentage', async () => {
  const { status, body } = await get('/api/uptime?period=24h');
  assert.equal(status, 200);
  assert.ok(body.uptime_pct === null || (body.uptime_pct >= 0 && body.uptime_pct <= 100));
  assert.ok('nines' in body);
  assert.ok('label' in body);
});

test('GET /api/uptime with invalid period returns 400', async () => {
  const { status } = await get('/api/uptime?period=xyz');
  assert.equal(status, 400);
});

test('GET /api/stats/hourly returns 24-hour breakdown', async () => {
  const { status, body } = await get('/api/stats/hourly');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.hours));
  assert.ok('date' in body);
});

test('GET /api/stats/daily returns rollup array', async () => {
  const { status, body } = await get('/api/stats/daily?days=7');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.rollups));
  assert.equal(body.days, 7);
});

test('GET /api/nines returns all six periods', async () => {
  const { status, body } = await get('/api/nines');
  assert.equal(status, 200);
  for (const period of ['1h', '24h', '7d', '30d', '90d', 'all']) {
    assert.ok(period in body, `Missing period: ${period}`);
    assert.ok('label' in body[period]);
    assert.ok('downtime_readable' in body[period]);
    assert.ok('total_checks' in body[period]);
  }
});

test('GET /api/latency returns array of points', async () => {
  const { status, body } = await get('/api/latency?limit=10');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.points));
});

test('GET / serves HTML dashboard', async () => {
  const { status, body } = await get('/');
  assert.equal(status, 200);
  assert.ok(typeof body === 'string');
  assert.ok(body.includes('<!DOCTYPE html'));
});

test('GET /unknown returns 404', async () => {
  const { status } = await get('/totally-unknown-route');
  assert.equal(status, 404);
});
