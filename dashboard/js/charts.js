let hourlyChart = null;
let dailyChart = null;
let sparklineChart = null;

const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
const textMuted = () => isDark() ? '#7d8590' : '#636c76';
const gridColor = () => isDark() ? '#21262d' : '#f0f2f5';

function uptimePctToColor(pct, alpha = 1) {
  if (pct === null || pct === undefined) return `rgba(125,133,144,${alpha})`;
  if (pct >= 99.9) return `rgba(63,185,80,${alpha})`;
  if (pct >= 99)   return `rgba(56,139,253,${alpha})`;
  if (pct >= 95)   return `rgba(210,153,34,${alpha})`;
  return `rgba(248,81,73,${alpha})`;
}

export function initHourlyChart() {
  const ctx = document.getElementById('hourly-chart').getContext('2d');
  const labels = Array.from({ length: 24 }, (_, i) => {
    const h = i % 12 || 12;
    return `${h}${i < 12 ? 'am' : 'pm'}`;
  });

  hourlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Uptime %',
        data: new Array(24).fill(null),
        backgroundColor: new Array(24).fill(gridColor()),
        borderRadius: 3,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw;
              return v === null ? 'No data' : `${v.toFixed(1)}% uptime`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: gridColor() },
          ticks: { color: textMuted(), font: { size: 10, family: 'monospace' }, maxRotation: 0 },
          border: { color: gridColor() },
        },
        y: {
          min: 0, max: 100,
          grid: { color: gridColor() },
          ticks: {
            color: textMuted(),
            font: { size: 10, family: 'monospace' },
            callback: (v) => `${v}%`,
            stepSize: 25,
          },
          border: { color: gridColor() },
        },
      },
    },
  });
}

export function updateHourlyChart(hours) {
  if (!hourlyChart) return;
  const data = new Array(24).fill(null);
  const colors = new Array(24).fill(gridColor());

  for (const row of hours) {
    const h = row.hour;
    if (h < 0 || h > 23) continue;
    const pct = row.total > 0 ? (row.up_count / row.total) * 100 : null;
    data[h] = pct;
    colors[h] = uptimePctToColor(pct, 0.85);
  }

  hourlyChart.data.datasets[0].data = data;
  hourlyChart.data.datasets[0].backgroundColor = colors;
  hourlyChart.update('none');
}

export function initDailyChart() {
  const ctx = document.getElementById('daily-chart').getContext('2d');

  dailyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Uptime %',
        data: [],
        backgroundColor: [],
        borderRadius: 3,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.raw;
              return v === null ? 'No data' : `${v.toFixed(2)}% uptime`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: gridColor() },
          ticks: {
            color: textMuted(),
            font: { size: 10, family: 'monospace' },
            maxRotation: 45,
            autoSkip: true,
            maxTicksLimit: 10,
          },
          border: { color: gridColor() },
        },
        y: {
          min: 0, max: 100,
          grid: { color: gridColor() },
          ticks: {
            color: textMuted(),
            font: { size: 10, family: 'monospace' },
            callback: (v) => `${v}%`,
            stepSize: 25,
          },
          border: { color: gridColor() },
        },
      },
    },
  });
}

export function updateDailyChart(rollups) {
  if (!dailyChart) return;
  const sorted = [...rollups].sort((a, b) => a.date_key.localeCompare(b.date_key));

  const labels = sorted.map((r) => {
    const [, m, d] = r.date_key.split('-');
    return `${parseInt(m)}/${parseInt(d)}`;
  });
  const data = sorted.map((r) => {
    if (!r.total_checks) return null;
    return (r.up_checks / r.total_checks) * 100;
  });
  const colors = data.map(uptimePctToColor);

  dailyChart.data.labels = labels;
  dailyChart.data.datasets[0].data = data;
  dailyChart.data.datasets[0].backgroundColor = colors;
  dailyChart.update('none');
}

export function initSparkline() {
  const ctx = document.getElementById('sparkline').getContext('2d');

  sparklineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        data: [],
        borderColor: 'rgba(56,139,253,0.8)',
        backgroundColor: 'rgba(56,139,253,0.1)',
        borderWidth: 1.5,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: false,
      animation: { duration: 200 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: { display: false, min: 0 },
      },
    },
  });
}

export function pushSparklinePoint(latency_ms) {
  if (!sparklineChart || latency_ms === null || latency_ms === undefined) return;
  const ds = sparklineChart.data;
  ds.labels.push('');
  ds.datasets[0].data.push(latency_ms);
  if (ds.datasets[0].data.length > 60) {
    ds.labels.shift();
    ds.datasets[0].data.shift();
  }
  sparklineChart.update('none');
}

export function setSparklineData(points) {
  if (!sparklineChart) return;
  sparklineChart.data.labels = points.map(() => '');
  sparklineChart.data.datasets[0].data = points.map((p) => p.latency_ms);
  sparklineChart.update('none');
}
