// Log: every bake, and what the differences between them add up to.

import { h, card, pill, chip, selectField, numberField, toast, icon, confirmDialog } from '../lib/ui.js?v=fb9656d1';
import { update, updateBake, deleteBake, download, exportBakesJSON } from '../lib/store.js?v=fb9656d1';
import { computeRecipe } from '../model/dough.js?v=fb9656d1';
import { scheduleStages } from '../model/protocol.js?v=fb9656d1';
import { fermentUnits } from '../model/ferment.js?v=fb9656d1';
import { overallScore, SCORE_KEYS } from '../model/recipes.js?v=fb9656d1';
import { FACTORS, OUTCOMES, derive, findFactor, findOutcome, factorValue, factorLabel } from '../model/metrics.js?v=fb9656d1';
import { scatterChart, barChart, linearFit } from '../lib/charts.js?v=fb9656d1';
import { fmtTemp, fmtDuration, round } from '../model/units.js?v=fb9656d1';
import { diagnose, DIAGNOSTICS } from '../model/diagnostics.js?v=fb9656d1';
import { stars, scoreInputs, tempField } from './common.js?v=fb9656d1';
import { bakeCSV } from '../lib/csv.js?v=fb9656d1';
import { actualStages, projectedStages, hasTimings, sayDrift, PHASE_BOUNDS } from '../model/timeline.js?v=fb9656d1';
import { STEPS } from '../model/protocol.js?v=fb9656d1';
import * as photos from '../lib/photos.js?v=fb9656d1';
import { fmtClock, fmtDay } from '../lib/ui.js?v=fb9656d1';

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
        photoCount(b.id) ? pill(`${photoCount(b.id)} photo${photoCount(b.id) === 1 ? '' : 's'}`, 'neutral') : null
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
        await photos.removePhotosFor(b.id).catch(() => {});
        forgetPhotos(b.id);
        deleteBake(b.id);
        toast('Deleted');
      }, 'Delete') }, icon('delete'), 'Delete')
    ),
    open ? editor(ctx, b) : null
  );
}

/* --------------------------------- photos -------------------------------- */

/*
 * Photographs are read out of IndexedDB, which is asynchronous, while the
 * screen is drawn synchronously. Rather than make every render wait, each
 * bake's list is fetched once and kept here; the fetch ends by asking for a
 * redraw, so the pictures appear a moment after the card opens.
 */
const photoCache = new Map();
const photoLoading = new Set();

function photosFor(bakeId) {
  if (photoCache.has(bakeId)) return photoCache.get(bakeId);
  if (!photoLoading.has(bakeId)) {
    photoLoading.add(bakeId);
    photos
      .listPhotos(bakeId)
      .then(async (rows) => {
        for (const row of rows) row.url = await photos.photoUrl(row.id);
        photoCache.set(bakeId, rows);
      })
      .catch(() => photoCache.set(bakeId, []))
      .finally(() => {
        photoLoading.delete(bakeId);
        update(() => {});
      });
  }
  return null;
}

const forgetPhotos = (bakeId) => photoCache.delete(bakeId);

/**
 * How many photographs a bake has, for the card that is not open.
 *
 * Counted from the list already fetched, so a closed card shows nothing until
 * something has asked for that bake's photographs. It is a pill, not a fact
 * anyone is waiting on, and fetching for every bake on the screen to fill it
 * in would be a great deal of work for a small number.
 */
const photoCount = (bakeId) => (photoCache.get(bakeId) || []).length;

function lightbox(url) {
  const dlg = h(
    'div',
    { class: 'modal-backdrop lightbox', onClick: () => dlg.remove() },
    h('img', { src: url, alt: 'Bake photograph' })
  );
  document.body.appendChild(dlg);
}

function photoStrip(ctx, b) {
  if (!photos.isSupported()) {
    return h('p', { class: 'note neutral' }, 'This browser has nowhere to keep photographs.');
  }
  const rows = photosFor(b.id);

  const pick = () => {
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const files = [...(input.files || [])];
      if (!files.length) return;
      try {
        for (const file of files) {
          // eslint-disable-next-line no-await-in-loop
          await photos.addPhoto(b.id, file);
        }
        forgetPhotos(b.id);
        toast(files.length === 1 ? 'Photo added' : `${files.length} photos added`);
      } catch (e) {
        toast(e.message || 'That image could not be added');
      }
      update(() => {});
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  };

  return h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label' }, 'Photographs'),
    rows === null
      ? h('p', { class: 'hint' }, 'Looking\u2026')
      : rows.length
        ? h('div', { class: 'photo-grid' }, ...rows.map((row) =>
            h(
              'figure',
              { class: 'photo' },
              h('img', {
                src: row.url,
                alt: `Photograph taken ${new Date(row.addedAt).toLocaleString()}`,
                loading: 'lazy',
                onClick: () => lightbox(row.url),
              }),
              h('button', {
                class: 'photo-remove',
                title: 'Remove this photograph',
                'aria-label': 'Remove this photograph',
                onClick: (e) => {
                  e.stopPropagation();
                  confirmDialog('Remove this photograph? It is only on this device, so it cannot be recovered.', async () => {
                    await photos.removePhoto(row.id);
                    forgetPhotos(b.id);
                    toast('Removed');
                    update(() => {});
                  }, 'Remove');
                },
              }, h('span', { class: 'msym' }, 'close'))
            )
          ))
        : h('p', { class: 'hint' }, 'None yet.'),
    h('div', { class: 'row tight' }, h('button', { class: 'btn ghost small', onClick: pick }, icon('add'), rows && rows.length ? 'Add more' : 'Add photographs')),
    h('p', { class: 'hint', style: { fontSize: '.72rem' } }, 'Photographs stay in this browser. They are not in the JSON export and they do not sync to a Google account, because a file small enough to sync quickly is a file with no photographs in it.')
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
  const ticked = Object.entries(b.doneAt || {})
    .filter(([, at]) => Number.isFinite(at))
    .sort((x, y) => x[1] - y[1]);

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
    h(
      'details',
      { class: 'foldout' },
      h('summary', {}, `Every step, as it happened (${ticked.length})`),
      h('ul', { class: 'step-log' }, ...ticked.map(([id, at]) => {
        const step = byId.get(id);
        const when = new Date(at);
        return h('li', {}, h('span', { class: 'step-log-when' }, `${fmtDay(when)} ${fmtClock(when)}`), h('span', {}, step ? step.title({ c: computeRecipe(b.recipe), S: b.schedule, u: ctx.u, E: b.equipment }) : id));
      }))
    )
  );
}

function editor(ctx, b) {
  const { u } = ctx;
  const setScore = (k, v) => updateBake(b.id, { scores: { ...b.scores, [k]: v } });
  const setActual = (k) => (v) => updateBake(b.id, { actuals: { ...b.actuals, [k]: v } });

  return h(
    'div',
    { style: { display: 'grid', gap: '12px', marginTop: '6px' } },
    photoStrip(ctx, b),
    howItRan(ctx, b),
    scoreInputs(b.scores, setScore),
    h(
      'div',
      { class: 'row' },
      tempField({ allowEmpty: true, label: 'Ambient', valueC: b.actuals?.ambientTempC, unit: u, onChange: setActual('ambientTempC') }),
      tempField({ allowEmpty: true, label: 'Floor', valueC: b.actuals?.deckTempC, unit: u, step: 5, onChange: setActual('deckTempC') }),
      tempField({ allowEmpty: true, label: 'Ball core', valueC: b.actuals?.coreTempC, unit: u, onChange: setActual('coreTempC') }),
      numberField({ allowEmpty: true, label: 'Bake time', value: b.actuals?.bakeSec ?? '', suffix: 'sec', onInput: setActual('bakeSec') })
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
