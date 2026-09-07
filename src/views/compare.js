// Compare: which permutation actually produced a better pizza.

import { h, card, selectField, chip, stat, pill, icon, toast } from '../lib/ui.js';
import { update } from '../lib/store.js';
import { FACTORS, OUTCOMES, GROUPS, derive, findFactor, findOutcome, findGroup, factorValue, factorLabel } from '../model/metrics.js';
import { scatterChart, barChart, linearFit, radarChart, SERIES_COLORS } from '../lib/charts.js';
import { SCORE_KEYS, overallScore } from '../model/recipes.js';
import { round } from '../model/units.js';
import { stars } from './common.js';

export default function renderCompare(ctx) {
  const { s } = ctx;
  const bakes = s.bakes.filter((b) => !b.planned);

  if (bakes.length < 2) {
    return [
      card(
        'Compare',
        'Two scored bakes are enough to start.',
        h('div', { class: 'empty' }, h('span', { class: 'msym' }, 'insights'), h('p', {}, `You have ${bakes.length} bake${bakes.length === 1 ? '' : 's'} filed. Log another with one variable changed and this screen will start telling you which way it moved.`))
      ),
    ];
  }

  const rows = bakes.map((b) => ({ b, d: derive(b, ctx.model) }));
  return [driversCard(ctx, rows), scatterCard(ctx, rows), groupCard(ctx, rows), tableCard(ctx, rows), profileCard(ctx, rows)];
}

function ui(s) {
  if (!s.ui) s.ui = {};
  if (!s.ui.compare) s.ui.compare = { x: 'fermentationUnits', y: 'overall', group: 'none' };
  return s.ui.compare;
}

/* -------------------------- what moves the needle ----------------------- */

function driversCard(ctx, rows) {
  const { s, u } = ctx;
  const cfg = ui(s);
  const outcome = findOutcome(cfg.y);

  const drivers = FACTORS.map((f) => {
    const pts = rows
      .map(({ b, d }) => ({ x: factorValue(f, b, d, u), y: outcome.get(b, d) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const fit = linearFit(pts);
    return { factor: f, fit, n: pts.length };
  })
    .filter((x) => x.fit && x.n >= 3)
    .sort((a, b) => Math.abs(b.fit.r) - Math.abs(a.fit.r))
    .slice(0, 10);

  const items = drivers.map((d) => ({ label: d.factor.label, value: round(d.fit.r, 2), color: d.fit.r >= 0 ? 'var(--c2)' : 'var(--c1)' }));

  return card(
    'What moves the needle',
    `How each variable tracks with ${outcome.label.toLowerCase()}, across ${rows.length} bakes. Correlation runs from −1 to +1.`,
    selectField({
      label: 'Outcome',
      value: cfg.y,
      options: OUTCOMES.map((o) => ({ value: o.key, label: o.label })),
      onChange: (v) => update((st) => { ui(st).y = v; }),
    }),
    items.length
      ? barChart({ items, valueLabel: '' })
      : h('p', { class: 'note neutral' }, 'Not enough variation yet. Correlation needs at least three bakes where both the variable and the score are recorded.'),
    drivers.length
      ? h('p', { class: 'note neutral' }, `Strongest so far: ${drivers[0].factor.label}, ${drivers[0].fit.r >= 0 ? 'higher' : 'lower'} tends to score better across ${drivers[0].n} bakes. Correlation is not proof; change one thing at a time to confirm it.`)
      : null
  );
}

/* -------------------------------- scatter ------------------------------- */

function scatterCard(ctx, rows) {
  const { s, u } = ctx;
  const cfg = ui(s);
  const fx = findFactor(cfg.x);
  const fy = findOutcome(cfg.y);
  const grp = findGroup(cfg.group);

  const keys = [...new Set(rows.map(({ b, d }) => grp.get(b, d)))];
  const points = rows
    .map(({ b, d }) => ({
      x: factorValue(fx, b, d, u),
      y: fy.get(b, d),
      label: b.title || b.recipeName,
      group: keys.indexOf(grp.get(b, d)),
      id: b.id,
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

  const fit = linearFit(points);

  return card(
    'Plot any two',
    'Each dot is one bake. Hover for the detail.',
    h(
      'div',
      { class: 'row' },
      selectField({ label: 'Horizontal', value: cfg.x, options: FACTORS.map((f) => ({ value: f.key, label: f.label })), onChange: (v) => update((st) => { ui(st).x = v; }) }),
      selectField({ label: 'Vertical', value: cfg.y, options: OUTCOMES.map((f) => ({ value: f.key, label: f.label })), onChange: (v) => update((st) => { ui(st).y = v; }) }),
      selectField({ label: 'Colour by', value: cfg.group, options: GROUPS.map((f) => ({ value: f.key, label: f.label })), onChange: (v) => update((st) => { ui(st).group = v; }) })
    ),
    scatterChart({ points, xLabel: factorLabel(fx, u), yLabel: fy.label, height: 320 }),
    fit
      ? h('p', { class: 'note neutral' }, `Across ${fit.n} bakes, correlation is ${fit.r.toFixed(2)}. Each extra ${fx.unit === '°' ? `degree` : fx.unit || 'unit'} of ${fx.label.toLowerCase()} goes with ${fit.slope >= 0 ? '+' : ''}${fit.slope.toFixed(3)} on ${fy.label.toLowerCase()}.`)
      : h('p', { class: 'note neutral' }, 'Three or more bakes with both values recorded are needed for a trend line.'),
    keys.length > 1 && cfg.group !== 'none'
      ? h('div', { class: 'chip-row' }, ...keys.map((k, i) => h('span', { class: 'pill', style: { background: SERIES_COLORS[i % SERIES_COLORS.length], color: '#fff' } }, String(k))))
      : null
  );
}

/* -------------------------------- grouping ------------------------------ */

function groupCard(ctx, rows) {
  const { s, u } = ctx;
  const cfg = ui(s);
  const grp = findGroup(cfg.group === 'none' ? 'recipe' : cfg.group);
  const outcome = findOutcome(cfg.y);

  const map = new Map();
  for (const { b, d } of rows) {
    const k = grp.get(b, d);
    const v = outcome.get(b, d);
    if (!Number.isFinite(v)) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(v);
  }
  const items = [...map.entries()]
    .map(([label, vals]) => ({ label: `${label} (${vals.length})`, value: round(vals.reduce((a, c) => a + c, 0) / vals.length, 2) }))
    .sort((a, b) => b.value - a.value);

  return card(
    `Average ${outcome.label.toLowerCase()} by ${grp.label.toLowerCase()}`,
    'The leaderboard. Counts in brackets, because one lucky bake is not evidence.',
    items.length ? barChart({ items, valueLabel: '' }) : h('p', { class: 'note neutral' }, 'No scored bakes in these groups yet.')
  );
}

/* --------------------------------- table -------------------------------- */

function tableCard(ctx, rows) {
  const { s, u } = ctx;
  const cfg = ui(s);
  const fx = findFactor(cfg.x);
  const sorted = [...rows].sort((a, b) => (overallScore(b.b.scores) ?? -1) - (overallScore(a.b.scores) ?? -1));

  return card(
    'Every bake, side by side',
    'Sorted best first.',
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, 'Bake'),
            h('th', {}, 'Flour'),
            h('th', { class: 'num' }, 'Hyd'),
            h('th', { class: 'num' }, 'FU'),
            h('th', { class: 'num' }, 'Proof'),
            h('th', { class: 'num' }, `Fridge °${u}`),
            h('th', { class: 'num' }, factorLabel(fx, u)),
            ...SCORE_KEYS.map((k) => h('th', { class: 'num' }, k.label.split(' ')[0])),
            h('th', { class: 'num' }, 'Overall')
          )
        ),
        h(
          'tbody',
          {},
          ...sorted.map(({ b, d }) =>
            h(
              'tr',
              {},
              h('td', {}, b.title || b.recipeName || 'Bake'),
              h('td', {}, d.c.flourLabel),
              h('td', { class: 'num' }, `${b.recipe.hydrationPct}%`),
              h('td', { class: 'num' }, d.fu.toFixed(1)),
              h('td', { class: 'num' }, `${b.schedule.coldProofHours} h`),
              h('td', { class: 'num' }, round(factorValue({ ...findFactor('fridgeTempC') }, b, d, u), 1)),
              h('td', { class: 'num' }, fmtOr(factorValue(fx, b, d, u))),
              ...SCORE_KEYS.map((k) => h('td', { class: 'num' }, b.scores?.[k.key] ?? '—')),
              h('td', { class: 'num' }, overallScore(b.scores)?.toFixed(1) ?? '—')
            )
          )
        )
      )
    )
  );
}

function fmtOr(v) {
  return Number.isFinite(v) ? round(v, 2) : '—';
}

/* -------------------------------- profile ------------------------------- */

function profileCard(ctx, rows) {
  const scored = rows.filter(({ b }) => overallScore(b.scores) !== null);
  if (scored.length < 2) return card('Profile', 'Score two bakes to see their shapes compared.', h('p', { class: 'note neutral' }, 'Not enough scored bakes yet.'));

  const best = [...scored].sort((a, b) => overallScore(b.b.scores) - overallScore(a.b.scores)).slice(0, 3);
  const axes = SCORE_KEYS.map((k) => ({ label: k.label.split(' ')[0], max: 5 }));

  return card(
    'Shape of your best bakes',
    'Where the top three differ from each other.',
    radarChart({
      axes,
      series: best.map(({ b }) => ({ values: SCORE_KEYS.map((k) => Number(b.scores?.[k.key]) || 0) })),
      size: 320,
    }),
    h(
      'div',
      { class: 'chip-row' },
      ...best.map(({ b }, i) => h('span', { class: 'pill', style: { background: SERIES_COLORS[i % SERIES_COLORS.length], color: '#fff' } }, `${b.title || b.recipeName} · ${overallScore(b.scores).toFixed(1)}`))
    )
  );
}
