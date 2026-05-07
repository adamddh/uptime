const SVG_NS = 'http://www.w3.org/2000/svg';

function polarToXY(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const s = polarToXY(cx, cy, r, startDeg);
  const e = polarToXY(cx, cy, r, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

const TICKS = [
  { label: '0',  pct: 90,      deg: -135 },
  { label: '1',  pct: 99,      deg: -90  },
  { label: '2',  pct: 99.9,    deg: -45  },
  { label: '3',  pct: 99.99,   deg: 0    },
  { label: '4',  pct: 99.999,  deg: 45   },
  { label: '5+', pct: 99.9999, deg: 90   },
];

const CX = 100, CY = 105, R = 75;
const START_DEG = -135, END_DEG = 90;

function pctToDeg(pct) {
  if (pct === null || pct === undefined) return START_DEG;
  const clamped = Math.max(90, Math.min(99.9999, pct));
  const nines = clamped >= 100 ? 5 : -Math.log10(1 - clamped / 100);
  const ninesClamped = Math.min(5, Math.max(0, nines));
  return START_DEG + (ninesClamped / 5) * (END_DEG - START_DEG);
}

export function renderGauge(pct) {
  const svg = document.getElementById('nines-gauge');
  svg.innerHTML = '';

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const trackColor  = isDark ? '#30363d' : '#d0d7de';
  const needleColor = isDark ? '#e6edf3' : '#1f2328';
  const textColor   = isDark ? '#7d8590' : '#636c76';

  function el(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Track arc (gray)
  svg.appendChild(el('path', {
    d: arcPath(CX, CY, R, START_DEG, END_DEG),
    fill: 'none',
    stroke: trackColor,
    'stroke-width': 8,
    'stroke-linecap': 'round',
  }));

  // Colored fill arc
  if (pct !== null && pct !== undefined) {
    const fillDeg = pctToDeg(pct);
    const color = pct >= 99.9 ? '#3fb950' : pct >= 99 ? '#388bfd' : pct >= 95 ? '#d29922' : '#f85149';
    svg.appendChild(el('path', {
      d: arcPath(CX, CY, R, START_DEG, fillDeg),
      fill: 'none',
      stroke: color,
      'stroke-width': 8,
      'stroke-linecap': 'round',
    }));
  }

  // Tick marks + labels
  for (const tick of TICKS) {
    const inner = polarToXY(CX, CY, R - 14, tick.deg);
    const outer = polarToXY(CX, CY, R - 6, tick.deg);
    svg.appendChild(el('line', {
      x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y,
      stroke: trackColor, 'stroke-width': 1.5,
    }));
    const lpos = polarToXY(CX, CY, R - 26, tick.deg);
    svg.appendChild(el('text', {
      x: lpos.x, y: lpos.y,
      fill: textColor,
      'font-size': 8,
      'font-family': 'monospace',
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
    }, tick.label));
  }

  // Needle
  const needleDeg = pctToDeg(pct);
  const needleTip = polarToXY(CX, CY, R - 10, needleDeg);
  const needleBase1 = polarToXY(CX, CY, 8, needleDeg + 90);
  const needleBase2 = polarToXY(CX, CY, 8, needleDeg - 90);
  svg.appendChild(el('polygon', {
    points: `${needleTip.x},${needleTip.y} ${needleBase1.x},${needleBase1.y} ${needleBase2.x},${needleBase2.y}`,
    fill: needleColor,
    opacity: 0.85,
  }));
  svg.appendChild(el('circle', { cx: CX, cy: CY, r: 5, fill: needleColor }));

  // Center label
  const labelEl = document.getElementById('nines-gauge-label');
  if (pct === null || pct === undefined) {
    labelEl.textContent = '—';
  } else if (pct >= 100) {
    labelEl.textContent = '∞ nines';
  } else {
    const nines = -Math.log10(1 - pct / 100);
    labelEl.textContent = nines >= 5 ? '5+ nines' : `${nines.toFixed(1)} nines`;
  }
}

export function renderNinesTable(data) {
  const tbody = document.getElementById('nines-tbody');
  tbody.innerHTML = '';

  const periodLabels = { '1h': '1 hour', '24h': '24 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days', 'all': 'All time' };

  for (const [key, val] of Object.entries(data)) {
    const pct = val.pct;
    const label = val.label;
    const ninesNum = val.nines !== null && val.nines !== undefined ? Math.min(val.nines, 99) : 0;
    const badgeClass = ninesNum >= 5 ? 'n5' : ninesNum >= 4 ? 'n4' : ninesNum >= 3 ? 'n3' : ninesNum >= 2 ? 'n2' : ninesNum >= 1 ? 'n1' : 'n0';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${periodLabels[key] ?? key}</td>
      <td>${pct !== null ? pct.toFixed(3) + '%' : '—'}</td>
      <td><span class="nines-badge ${badgeClass}">${label}</span></td>
      <td>${val.downtime_readable ?? '—'}</td>
    `;
    tbody.appendChild(tr);
  }
}
