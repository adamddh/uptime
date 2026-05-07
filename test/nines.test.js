import { test } from 'node:test';
import assert from 'node:assert/strict';

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
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

test('100% uptime → ∞ nines label', () => {
  const { nines, label } = ninesFromPct(100);
  assert.equal(label, '∞');
  assert.equal(nines, 999);
});

test('99.9% uptime → 3 nines', () => {
  const { label } = ninesFromPct(99.9);
  assert.equal(label, '3');
});

test('99% uptime → 2 nines', () => {
  const { label } = ninesFromPct(99);
  assert.equal(label, '2');
});

test('99.99% uptime → 4 nines', () => {
  const { label } = ninesFromPct(99.99);
  assert.equal(label, '4');
});

test('99.999% uptime → 5+ nines', () => {
  const { label } = ninesFromPct(99.999);
  assert.equal(label, '5+');
});

test('0% uptime → near-0 nines', () => {
  const { nines } = ninesFromPct(0);
  assert.ok(nines >= 0 && nines < 1);
});

test('null uptime → N/A', () => {
  const { label } = ninesFromPct(null);
  assert.equal(label, 'N/A');
});

test('formatDuration handles seconds', () => {
  assert.equal(formatDuration(5000), '5s');
  assert.equal(formatDuration(59000), '59s');
});

test('formatDuration handles minutes', () => {
  assert.equal(formatDuration(60000), '1m');
  assert.equal(formatDuration(90000), '1m 30s');
  assert.equal(formatDuration(3600000 - 1000), '59m 59s');
});

test('formatDuration handles hours', () => {
  assert.equal(formatDuration(3600000), '1h');
  assert.equal(formatDuration(3660000), '1h 1m');
  assert.equal(formatDuration(7200000), '2h');
});

test('formatDuration handles zero and null', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(null), '0s');
  assert.equal(formatDuration(-1000), '0s');
});
