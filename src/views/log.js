// Log: every bake, and what the differences between them add up to.

import { h, card, pill, chip, selectField, textField, toast, icon, confirmDialog } from '../lib/ui.js?v=2313eb03';
import { update, updateBake, deleteBake, download, exportBakesJSON } from '../lib/store.js?v=2313eb03';
import { computeRecipe } from '../model/dough.js?v=2313eb03';
import { scheduleStages } from '../model/protocol.js?v=2313eb03';
import { fermentUnits } from '../model/ferment.js?v=2313eb03';
import { overallScore } from '../model/recipes.js?v=2313eb03';
import { FACTORS, OUTCOMES, derive, findFactor, findOutcome, factorValue, factorLabel } from '../model/metrics.js?v=2313eb03';
import { scatterChart, barChart, linearFit } from '../lib/charts.js?v=2313eb03';
import { fmtTemp, fmtDuration, round } from '../model/units.js?v=2313eb03';
import { diagnose, DIAGNOSTICS } from '../model/diagnostics.js?v=2313eb03';
import { stars, scoreInputs } from './common.js?v=2313eb03';
import { bakeCSV } from '../lib/csv.js?v=2313eb03';
import { actualStages, hasTimings, sayDrift } from '../model/timeline.js?v=2313eb03';
import { STEPS, STEP_IDS, orderStamps } from '../model/protocol.js?v=2313eb03';
import { photoStrip, photoCount, dropPhotosFor } from './photos-ui.js?v=2313eb03';
import { metricField, METRIC_KEYS, stampField } from './record-ui.js?v=2313eb03';

export default function renderLog(ctx) {
  const { s } = ctx;
  const bakes = [...s.bakes].sort((a, b) => String(b.bakedAt || '').localeCompare(String(a.bakedAt || '')));

  if (!bakes.length) {
    return [
      card(
        'Bake log',
        'Nothing filed yet.',
        h('div', { class: 'empty' }, h('span', { class: 'msym' }, 'history_edu'), h('p', {}, 'Work the protocol, score the bake, and it lands here. Once two bakes differ in one thing, this screen starts telling you which way it moved.'))
      ),
    ];
  }

  const rows = bakes.filter((b) => overallScore(b.scores) !== null).map((b) => ({ b, d: derive(b, ctx.model) }));
  return [
    rows.length >= 3 ? comparisonCard(ctx, rows) : null,
    card(
      `${bakes.length} bake${bakes.length > 1 ? 's' : ''}`,
      'Newest first.',
      h(
        'div',
        { class: 'row tight' },
        h('button', { class: 'btn ghost small', onClick: () => download('canotto-log.json', exportBakesJSON()) }, icon('download'), 'Export JSON'),
        h('button', { class: 'btn ghost small', onClick: () => download('canotto-log.csv', bakeCSV(s), 'text/csv') }, icon('download'), 'Export CSV')
      ),
      h('p', { class: 'note neutral' }, 'The JSON follows a published schema, so anything else can read it. The CSV has the derived figures worked out already, for a spreadsheet.')
    ),
    ...bakes.map((b) => bakeCard(ctx, b)),
  ].filter(Boolean);
}

/* ------------------------------ comparison ------------------------------ */

function ui(s) {
  if (!s.ui) s.ui = {};
  if (!s.ui.compare) s.ui.compare = { x: 'fermentationUnits', y: 'overall' };
  return s.ui.compare;
}

function comparisonCard(ctx, rows) {
  const { s, u } = ctx;
  const cfg = ui(s);
  const fx = findFactor(cfg.x);
  const fy = findOutcome(cfg.y);

  const drivers = FACTORS.map((f) => {
    const pts = rows
      .map(({ b, d }) => ({ x: factorValue(f, b, d, u), y: fy.get(b, d) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    return { factor: f, fit: linearFit(pts), n: pts.length };
  })
    .filter((x) => x.fit && x.n >= 3 && Math.abs(x.fit.r) > 0.01)
    .sort((a, b) => Math.abs(b.fit.r) - Math.abs(a.fit.r))
    .slice(0, 7);

  const points = rows
    .map(({ b, d }) => ({ x: factorValue(fx, b, d, u), y: fy.get(b, d), label: b.title }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const fit = linearFit(points);

  return card(
    'What worked',
    `Across ${rows.length} scored bakes.`,
    selectField({
      label: 'Judging by',
      value: cfg.y,
      options: OUTCOMES.map((o) => ({ value: o.key, label: o.label })),
      onChange: (v) => update((st) => { ui(st).y = v; }),
    }),
    drivers.length
      ? h(
          'div',
          {},
          h('p', { class: 'hint', style: { fontSize: '.74rem' } }, 'How each thing you changed tracks with the score, from −1 to +1.'),
          barChart({ items: drivers.map((d) => ({ label: d.factor.label, value: round(d.fit.r, 2), color: d.fit.r >= 0 ? 'var(--c2)' : 'var(--c1)' })) }),
          h('p', { class: 'note neutral' }, `Strongest so far: ${drivers[0].factor.label.toLowerCase()}, where ${drivers[0].fit.r >= 0 ? 'higher' : 'lower'} tends to score better. Correlation is not proof. Change one thing at a time to confirm it.`)
        )
      : h('p', { class: 'note neutral' }, 'Not enough variation yet. Bake the same recipe with one thing changed and the pattern will start to show.'),
    h(
      'details',
      { class: 'foldout' },
      h('summary', {}, 'Plot any two'),
      selectField({ label: 'Against', value: cfg.x, options: FACTORS.map((f) => ({ value: f.key, label: f.label })), onChange: (v) => update((st) => { ui(st).x = v; }) }),
      scatterChart({ points, xLabel: factorLabel(fx, u), yLabel: fy.label, height: 280 }),
      fit ? h('p', { class: 'note neutral' }, `Correlation ${fit.r.toFixed(2)} across ${fit.n} bakes.`) : null
    )
  );
}

/* --------------------------------- bakes -------------------------------- */

function bakeCard(ctx, b) {
  const { u, s } = ctx;
  const c = computeRecipe(b.recipe);
  const fu = fermentUnits(scheduleStages(b.schedule), ctx.model);
  const score = overallScore(b.scores);
  const open = s.ui?.openBake === b.id;
  const hits = diagnose(b);

  return card(
    b.title || b.recipeName || 'Bake',
    `${new Date(b.bakedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${c.flourLabel}`,
    h(
      'div',
      { class: 'spread' },
      h(
        'div',
        { class: 'chip-row' },
        pill(`${b.recipe.hydrationPct}% hydration`, 'neutral'),
        pill(`${fmtDuration(b.schedule.coldProofHours)} at ${fmtTemp(b.schedule.fridgeTempC, u)}`, 'neutral'),
        pill(`${fu.toFixed(1)} FU`, 'neutral'),
        pill(`${b.recipe.baseYeastPct}% ${b.recipe.yeastType.toUpperCase()}`, 'neutral'),
        Number.isFinite(b.actuals?.ambientTempC) ? pill(`ambient ${fmtTemp(b.actuals.ambientTempC, u)}`, 'neutral') : null,
        hasTimings(b.doneAt) ? pill('timed', 'good') : null,
        photoCount(ctx, b.id) ? pill(`${photoCount(ctx, b.id)} photo${photoCount(ctx, b.id) === 1 ? '' : 's'}`, 'neutral') : null
      ),
      h('div', {}, h('span', { class: 'rating' }, score === null ? 'Unscored' : `${score.toFixed(1)} / 5`), ' ', stars(score))
    ),
    b.notes ? h('p', { class: 'note neutral' }, b.notes) : null,
    hits.length ? h('p', { class: 'note warn' }, `Likely: ${hits.map((d) => d.title).join('; ')}`) : null,
    h(
      'div',
      { class: 'item-actions' },
      h('button', { class: 'btn ghost small', onClick: () => update((st) => { st.ui = { ...st.ui, openBake: open ? null : b.id }; }) }, icon(open ? 'expand_less' : 'expand_more'), open ? 'Close' : 'Open the run'),
      h('button', { class: 'btn ghost small', onClick: () => confirmDialog('Delete this bake? Its photographs go with it.', async () => {
        // Otherwise the pictures outlive the record and nothing can reach them.
        await dropPhotosFor(b.id);
        deleteBake(b.id);
        toast('Deleted');
      }, 'Delete') }, icon('delete'), 'Delete')
    ),
    open ? editor(ctx, b) : null
  );
}

/* ------------------------------ how it ran ------------------------------- */

/**
 * What the bake actually did, as against what was planned.
 *
 * A score on its own says a bake was good. This says which one it was: the
 * hours each phase really ran, and the clock time each step was ticked off.
 */
function howItRan(ctx, b) {
  if (!hasTimings(b.doneAt)) {
    return h('p', { class: 'note neutral' }, 'No times were recorded for this bake, so it is judged on the schedule as written.');
  }
  const planned = scheduleStages(b.schedule);
  const stages = actualStages({ doneAt: b.doneAt, schedule: b.schedule, planned });
  const byId = new Map(STEPS.map((st) => [st.id, st]));
  const ticked = Object.entries(b.doneAt || {}).filter(([, at]) => Number.isFinite(at));
  // In the order the steps happen rather than the order the clock saw them,
  // so the window each correction is held to reads down the list.
  const ordered = STEP_IDS.filter((id) => Number.isFinite(b.doneAt?.[id])).map((id) => [id, b.doneAt[id]]);

  return h(
    'div',
    { style: { display: 'grid', gap: '10px' } },
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Phase'), h('th', { class: 'num' }, 'Planned'), h('th', { class: 'num' }, 'Actual'), h('th', { class: 'num' }, 'Diff'))),
        h('tbody', {}, ...stages.map((x, i) => {
          const diff = x.state === 'done' ? (x.hours - planned[i].hours) * 3600000 : null;
          return h(
            'tr',
            {},
            h('td', {}, x.name),
            h('td', { class: 'num' }, fmtDuration(planned[i].hours)),
            h('td', { class: 'num' }, x.state === 'done' ? fmtDuration(x.hours) : '\u2014'),
            h('td', { class: `num${diff !== null && Math.abs(diff) > 1800000 ? ' warn' : ''}` }, diff === null ? '\u2014' : sayDrift(diff))
          );
        }))
      )
    ),
    /*
     * And correctable, months later. A time ticked off an hour after the thing
     * happened is the normal case, and noticing is often what filing the bake
     * and looking at the table prompts. The same control the run uses, so a
     * correction here is held to the same order.
     */
    h(
      'details',
      { class: 'foldout' },
      h('summary', {}, `Every step, as it happened (${ticked.length})`),
      h('div', { class: 'step-log-edit' }, ...ordered.map(([id, at]) => {
        const step = byId.get(id);
        return stampField({
          stepId: id,
          at,
          doneAt: b.doneAt || {},
          name: step ? step.title({ c: computeRecipe(b.recipe), S: b.schedule, u: ctx.u, E: b.equipment }) : id,
          onChange: (ms) => updateBake(b.id, { doneAt: orderStamps({ ...(b.doneAt || {}), [id]: ms }) }),
        });
      }))
    )
  );
}

/**
 * A filed bake, open for correction.
 *
 * Everything the run recorded can be put right here, through the same controls
 * the run used: the times each step was ticked at, every measurement, the
 * marks, the notes, the faults and the photographs. This used to offer four of
 * the ten measurements under shortened labels of its own and no way at all to
 * fix a time, so the answer to noticing a mistake after filing was to live
 * with it.
 *
 * A bake is a record of what happened, so nothing here changes the plan it was
 * baked to: the recipe and the schedule are what they were on the day.
 */
function editor(ctx, b) {
  const { u } = ctx;
  const setScore = (k, v) => updateBake(b.id, { scores: { ...b.scores, [k]: v } });
  const setActual = (k) => (v) => updateBake(b.id, { actuals: { ...b.actuals, [k]: v } });

  return h(
    'div',
    { style: { display: 'grid', gap: '12px', marginTop: '6px' } },
    textField({ label: 'What this bake is called', value: b.title || b.recipeName || '', placeholder: 'Untitled bake', onInput: (v) => updateBake(b.id, { title: v }) }),
    photoStrip(ctx, b.id),
    howItRan(ctx, b),
    scoreInputs(b.scores, setScore),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'What you measured'),
      h('div', { class: 'row' }, ...METRIC_KEYS.map((k) => metricField({
        key: k,
        value: b.actuals?.[k],
        unit: u,
        onChange: setActual(k),
      })))
    ),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Notes'),
      h('span', { class: 'field-input' }, h('textarea', { rows: 3, onInput: (e) => updateBake(b.id, { notes: e.target.value }) }, b.notes || ''))
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Faults seen'),
      h('div', { class: 'chip-row' }, ...DIAGNOSTICS.map((d) =>
        chip(d.title, (b.issues || []).includes(d.id), () => {
          const set = new Set(b.issues || []);
          set.has(d.id) ? set.delete(d.id) : set.add(d.id);
          updateBake(b.id, { issues: [...set] });
        })
      ))
    )
  );
}
