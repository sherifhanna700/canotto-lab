// Dependency-free SVG charts.
//
// Every chart returns an <svg> element sized by viewBox, so it scales with its
// container and inherits colours from CSS custom properties. That keeps the app
// working offline and keeps the charts legible when the palette changes.

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    el.setAttribute(k, v);
  }
  for (const c of children.flat(3)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const SERIES_COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** Least-squares fit plus Pearson r, used for the trend line and the callout. */
export function linearFit(points) {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: sxy / Math.sqrt(sxx * syy), n };
}

export function scatterChart({ points, xLabel, yLabel, height = 300, trend = true, onPick }) {
  const W = 640;
  const H = height;
  const pad = { l: 54, r: 18, t: 16, b: 44 };
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `${yLabel} against ${xLabel}` });
  if (!valid.length) {
    root.appendChild(svg('text', { x: W / 2, y: H / 2, class: 'chart-empty', 'text-anchor': 'middle' }, 'Not enough data yet'));
    return root;
  }

  const xs = valid.map((p) => p.x);
  const ys = valid.map((p) => p.y);
  const xt = niceTicks(Math.min(...xs), Math.max(...xs));
  const yt = niceTicks(Math.min(...ys), Math.max(...ys));
  const x0 = xt[0];
  const x1 = xt[xt.length - 1];
  const y0 = yt[0];
  const y1 = yt[yt.length - 1];
  const sx = (v) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v) => H - pad.b - ((v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);

  for (const t of yt) {
    root.appendChild(svg('line', { x1: pad.l, x2: W - pad.r, y1: sy(t), y2: sy(t), class: 'grid' }));
    root.appendChild(svg('text', { x: pad.l - 8, y: sy(t) + 4, class: 'tick', 'text-anchor': 'end' }, fmtTick(t)));
  }
  for (const t of xt) {
    root.appendChild(svg('text', { x: sx(t), y: H - pad.b + 18, class: 'tick', 'text-anchor': 'middle' }, fmtTick(t)));
  }
  root.appendChild(svg('text', { x: (pad.l + W - pad.r) / 2, y: H - 6, class: 'axis-label', 'text-anchor': 'middle' }, xLabel));
  root.appendChild(svg('text', { x: 14, y: (pad.t + H - pad.b) / 2, class: 'axis-label', 'text-anchor': 'middle', transform: `rotate(-90 14 ${(pad.t + H - pad.b) / 2})` }, yLabel));

  const fit = trend ? linearFit(valid) : null;
  if (fit) {
    root.appendChild(
      svg('line', {
        x1: sx(x0),
        y1: sy(fit.slope * x0 + fit.intercept),
        x2: sx(x1),
        y2: sy(fit.slope * x1 + fit.intercept),
        class: 'trend',
      })
    );
  }

  for (const p of valid) {
    const dot = svg('circle', {
      cx: sx(p.x),
      cy: sy(p.y),
      r: 6,
      class: `dot${p.highlight ? ' hi' : ''}`,
      fill: p.color || SERIES_COLORS[(p.group ?? 0) % SERIES_COLORS.length],
      tabindex: onPick ? '0' : null,
    });
    dot.appendChild(svg('title', {}, `${p.label || ''}\n${xLabel}: ${fmtTick(p.x)}\n${yLabel}: ${fmtTick(p.y)}`));
    if (onPick) {
      dot.addEventListener('click', () => onPick(p));
      dot.addEventListener('keydown', (e) => e.key === 'Enter' && onPick(p));
    }
    root.appendChild(dot);
  }
  root.dataset.r = fit ? fit.r.toFixed(2) : '';
  return root;
}

export function barChart({ items, height = 260, valueLabel = '', horizontal = true }) {
  const W = 640;
  const rows = items.filter((i) => Number.isFinite(i.value));
  const H = horizontal ? Math.max(height, rows.length * 34 + 40) : height;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' });
  if (!rows.length) {
    root.appendChild(svg('text', { x: W / 2, y: H / 2, class: 'chart-empty', 'text-anchor': 'middle' }, 'Nothing to compare yet'));
    return root;
  }
  const pad = { l: 150, r: 60, t: 12, b: 24 };
  const max = Math.max(...rows.map((r) => r.value), 0);
  const min = Math.min(...rows.map((r) => r.value), 0);
  const span = max - min || 1;
  const zero = pad.l + ((0 - min) / span) * (W - pad.l - pad.r);
  const bw = (W - pad.l - pad.r) / span;
  const rowH = (H - pad.t - pad.b) / rows.length;

  rows.forEach((r, i) => {
    const y = pad.t + i * rowH + 4;
    const bh = Math.max(6, rowH - 12);
    const x = r.value >= 0 ? zero : zero + r.value * bw;
    root.appendChild(
      svg('rect', { x, y, width: Math.max(2, Math.abs(r.value) * bw), height: bh, rx: 5, fill: r.color || SERIES_COLORS[i % SERIES_COLORS.length], class: 'bar' })
    );
    root.appendChild(svg('text', { x: pad.l - 10, y: y + bh / 2 + 4, class: 'tick', 'text-anchor': 'end' }, truncate(r.label, 22)));

    // Value labels sit outside the bar, unless that would run them into the
    // category gutter, in which case they move inside.
    const barEnd = r.value >= 0 ? x + Math.abs(r.value) * bw : x;
    let lx = barEnd + (r.value >= 0 ? 8 : -8);
    let anchor = r.value >= 0 ? 'start' : 'end';
    if (r.value < 0 && lx < pad.l + 34) {
      lx = barEnd + 8;
      anchor = 'start';
    }
    root.appendChild(svg('text', { x: lx, y: y + bh / 2 + 4, class: 'tick strong', 'text-anchor': anchor }, `${fmtTick(r.value)}${valueLabel}`));
  });
  if (min < 0) root.appendChild(svg('line', { x1: zero, x2: zero, y1: pad.t, y2: H - pad.b, class: 'grid strong' }));
  return root;
}

export function radarChart({ axes, series, size = 300 }) {
  const R = size / 2 - 44;
  const cx = size / 2;
  const cy = size / 2;
  const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, class: 'chart radar' });
  const n = axes.length;
  if (!n) return root;
  const pt = (i, v) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
  };
  for (let ring = 1; ring <= 5; ring += 1) {
    const d = axes.map((_, i) => pt(i, ring / 5).join(',')).join(' ');
    root.appendChild(svg('polygon', { points: d, class: 'radar-ring' }));
  }
  axes.forEach((a, i) => {
    const [x, y] = pt(i, 1.16);
    root.appendChild(svg('text', { x, y, class: 'tick', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, a.label));
  });
  series.forEach((s, si) => {
    const pts = axes.map((a, i) => pt(i, clamp01((s.values[i] ?? 0) / (a.max || 5))).join(',')).join(' ');
    root.appendChild(svg('polygon', { points: pts, class: 'radar-shape', fill: s.color || SERIES_COLORS[si % SERIES_COLORS.length], 'fill-opacity': 0.22, stroke: s.color || SERIES_COLORS[si % SERIES_COLORS.length] }));
  });
  return root;
}

export function lineChart({ series, xLabel, yLabel, height = 260, markers = [] }) {
  const W = 640;
  const H = height;
  const pad = { l: 54, r: 18, t: 16, b: 42 };
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' });
  const all = series.flatMap((s) => s.points).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!all.length) return root;
  const xt = niceTicks(Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x)));
  const yt = niceTicks(Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y)));
  const [x0, x1] = [xt[0], xt[xt.length - 1]];
  const [y0, y1] = [yt[0], yt[yt.length - 1]];
  const sx = (v) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v) => H - pad.b - ((v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);

  for (const t of yt) {
    root.appendChild(svg('line', { x1: pad.l, x2: W - pad.r, y1: sy(t), y2: sy(t), class: 'grid' }));
    root.appendChild(svg('text', { x: pad.l - 8, y: sy(t) + 4, class: 'tick', 'text-anchor': 'end' }, fmtTick(t)));
  }
  for (const t of xt) root.appendChild(svg('text', { x: sx(t), y: H - pad.b + 18, class: 'tick', 'text-anchor': 'middle' }, fmtTick(t)));
  root.appendChild(svg('text', { x: (pad.l + W - pad.r) / 2, y: H - 6, class: 'axis-label', 'text-anchor': 'middle' }, xLabel));
  root.appendChild(svg('text', { x: 14, y: H / 2, class: 'axis-label', 'text-anchor': 'middle', transform: `rotate(-90 14 ${H / 2})` }, yLabel));

  series.forEach((s, i) => {
    const d = s.points.map((p, j) => `${j ? 'L' : 'M'}${sx(p.x)},${sy(p.y)}`).join(' ');
    root.appendChild(svg('path', { d, class: 'line', stroke: s.color || SERIES_COLORS[i % SERIES_COLORS.length] }));
  });
  for (const m of markers) {
    if (!Number.isFinite(m.x)) continue;
    root.appendChild(svg('line', { x1: sx(m.x), x2: sx(m.x), y1: pad.t, y2: H - pad.b, class: 'marker' }));
    // Along the bottom, out of the way of the legend that sits at the top.
    root.appendChild(svg('text', { x: sx(m.x) + 5, y: H - pad.b - 6, class: 'tick strong' }, m.label));
  }

  // A legend only earns its space when there is more than one line to tell apart.
  const named = series.filter((s) => s.label);
  if (named.length > 1) {
    let lx = pad.l + 6;
    named.forEach((s) => {
      const i = series.indexOf(s);
      root.appendChild(svg('line', { x1: lx, x2: lx + 16, y1: pad.t + 4, y2: pad.t + 4, class: 'line', stroke: s.color || SERIES_COLORS[i % SERIES_COLORS.length] }));
      root.appendChild(svg('text', { x: lx + 21, y: pad.t + 8, class: 'tick' }, s.label));
      lx += 34 + s.label.length * 6.4;
    });
  }
  return root;
}

/** Horizontal timeline of the schedule, one lane per phase. */
export function timelineChart({ segments, height = 130 }) {
  const W = 640;
  const H = height;
  const pad = { l: 10, r: 10, t: 26, b: 30 };
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart timeline' });
  const t0 = Math.min(...segments.map((s) => s.start));
  const t1 = Math.max(...segments.map((s) => s.end));
  const sx = (v) => pad.l + ((v - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
  // Only label a segment that has room for it. Short phases sit next to each
  // other, and their start times were overlapping into unreadable mush.
  const MIN_TICK_GAP = 78;
  let lastTickEnd = -Infinity;

  segments.forEach((s, i) => {
    const x = sx(s.start);
    const w = Math.max(3, sx(s.end) - x);
    root.appendChild(svg('rect', { x, y: pad.t, width: w, height: 34, rx: 6, fill: s.color || SERIES_COLORS[i % SERIES_COLORS.length], class: 'seg' }));
    if (w > 60) root.appendChild(svg('text', { x: x + w / 2, y: pad.t + 22, class: 'seg-label', 'text-anchor': 'middle' }, s.short));
    if (s.tick && x >= lastTickEnd) {
      root.appendChild(svg('text', { x: x + 1, y: pad.t + 52, class: 'tick tiny' }, s.tick));
      lastTickEnd = x + MIN_TICK_GAP;
    }
  });
  root.appendChild(svg('text', { x: pad.l, y: 16, class: 'tick tiny' }, segments[0]?.startLabel || ''));
  root.appendChild(svg('text', { x: W - pad.r, y: 16, class: 'tick tiny', 'text-anchor': 'end' }, segments[segments.length - 1]?.endLabel || ''));
  return root;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function fmtTick(v) {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a >= 1000) return `${Math.round(v / 100) / 10}k`;
  if (a >= 10) return String(Math.round(v));
  if (a >= 1) return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 1000) / 1000);
}

function truncate(s, n) {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
