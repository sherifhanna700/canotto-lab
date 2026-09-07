// Dough: the flour blend, the ratios it implies, and the fermentation the
// schedule actually delivers. This is where a permutation gets designed.

import { h, card, numberField, selectField, sliderField, textField, chip, pill, stat, toast, icon } from '../lib/ui.js';
import { update, saveCurrentToRecipe } from '../lib/store.js';
import { computeRecipe, ingredientRows, YEAST_LABEL, effectiveYeastPct, convertYeast, stageFlourLabel } from '../model/dough.js';
import { FLOURS, floursByCountry, findFlour, blendStats, blendLabel, hydrationRangeForW, SOURCES } from '../model/flours.js';
import { scheduleStages, DEFAULT_SCHEDULE } from '../model/protocol.js';
import { fermentUnits, stageBreakdown, rateAt, yeastForFU, fuForYeast, ripeness, ripenessVerdict, waterTempFor, yeastCurve } from '../model/ferment.js';
import { suggestPlan, reviewPlan, STYLES, defaultLeadHours } from '../model/advisor.js';
import { fmtGrams, fmtTemp, fmtTempDelta, fmtDuration, toDisplay, round } from '../model/units.js';
import { lineChart, timelineChart } from '../lib/charts.js';
import { tempField, tempDeltaField } from './common.js';
import { findMixer, mixerLabel } from '../model/equipment.js';

const setRecipe = (patch) => update((s) => Object.assign(s.current.recipe, patch));
const setSchedule = (patch) => update((s) => Object.assign(s.current.schedule, patch));

export default function renderDough(ctx) {
  const { s, u, c, S } = ctx;
  const r = s.current.recipe;
  const stages = scheduleStages(S);
  const fu = fermentUnits(stages, ctx.model);

  return [
    flourCard(ctx),
    coldChainCard(ctx, stages, fu),
    ratiosCard(ctx),
    outputCard(ctx),
    advisorCard(ctx),
    waterTempCard(ctx),
  ];
}

/* ------------------------------ flour blend ----------------------------- */

function flourCard(ctx) {
  const { s, c, u } = ctx;
  const flours = s.current.recipe.flours;
  const blend = c.blend;
  const groups = floursByCountry().map((g) => ({ label: g.label, options: g.list.map((f) => ({ value: f.id, label: `${f.brand} ${f.name}${f.w ? ` · W ${f.w}` : ''}` })) }));

  const rows = flours.map((entry, i) =>
    h(
      'div',
      { class: 'row tight', style: { alignItems: 'flex-end' } },
      h('div', { style: { flex: '1 1 220px' } }, selectField({
        label: i === 0 ? 'Flour' : `Flour ${i + 1}`,
        value: entry.id,
        groups,
        onChange: (v) => update((st) => { st.current.recipe.flours[i] = { ...st.current.recipe.flours[i], id: v }; }),
      })),
      h('div', { style: { flex: '0 0 96px' } }, numberField({
        label: 'Share',
        value: entry.pct,
        min: 0,
        max: 100,
        step: 1,
        suffix: '%',
        onInput: (v) => update((st) => { st.current.recipe.flours[i].pct = v ?? 0; }),
      })),
      h('div', { style: { flex: '0 0 128px' } }, selectField({
        label: 'Goes into',
        value: entry.stage || 'blend',
        options: [
          { value: 'blend', label: 'Split evenly' },
          { value: 'biga', label: 'Preferment' },
          { value: 'final', label: 'Final mix' },
        ],
        onChange: (v) => update((st) => { st.current.recipe.flours[i].stage = v; }),
      })),
      flours.length > 1
        ? h('button', { class: 'btn ghost small', title: 'Remove this flour', onClick: () => update((st) => { st.current.recipe.flours.splice(i, 1); }) }, icon('close'))
        : null
    )
  );

  const src = blend.w && findFlour(flours[0]?.id);
  const window = blend.ferment;

  return card(
    'Flour blend',
    'Strength sets what the dough can carry. Mix as many flours as you like.',
    ...rows,
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn ghost small', onClick: () => update((st) => { st.current.recipe.flours.push({ id: 'caputo-semola', pct: 10, stage: 'blend' }); }) }, icon('add'), 'Add a flour'),
      !blend.valid ? pill(`Shares total ${blend.total}%`, 'warn') : null
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Strength', blend.w ? `W ${blend.w}` : '—', blend.estimated ? 'estimated from protein' : 'published'),
      stat('Protein', blend.protein ? `${blend.protein}%` : '—', blend.band?.label || ''),
      stat('Maturation window', window ? `${window[0]}–${window[1]} h` : '—', blend.fermentSourced ? 'published for this flour' : 'from the W band'),
      stat('Fermentation ceiling', c.fuCeiling ? `${c.fuCeiling} FU` : '—', 'before gluten degrades')
    ),
    blend.estimated
      ? h('p', { class: 'note warn' }, 'At least one flour in this blend has no published W value, so it is estimated from protein content. Treat the strength figure as a guide.')
      : null,
    findFlour(flours[0]?.id)?.notes ? h('p', { class: 'note neutral' }, findFlour(flours[0].id).notes) : null
  );
}

/* --------------------------- cold chain / timing ------------------------ */

function coldChainCard(ctx, stages, fu) {
  const { s, u, S, c } = ctx;
  const model = ctx.model;
  const idy = convertYeast(s.current.recipe.baseYeastPct, s.current.recipe.yeastType, 'idy');
  const ratio = ripeness(stages, idy, model);
  const verdict = ripenessVerdict(ratio);
  const need = yeastForFU(fu, model);
  const breakdown = stageBreakdown(stages, model);

  const stageRows = h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Phase'), h('th', { class: 'num' }, 'Hours'), h('th', { class: 'num' }, 'Temp'), h('th', { class: 'num' }, 'Rate'), h('th', { class: 'num' }, 'FU'), h('th', { class: 'num' }, 'Share'))),
      h(
        'tbody',
        {},
        ...breakdown.map((b) =>
          h(
            'tr',
            {},
            h('td', {}, b.name),
            h('td', { class: 'num' }, fmtDuration(b.hours)),
            h('td', { class: 'num' }, fmtTemp(b.tempC, u)),
            h('td', { class: 'num' }, `${(b.rate * 100).toFixed(0)}%`),
            h('td', { class: 'num' }, b.fu.toFixed(1)),
            h('td', { class: 'num' }, `${((b.fu / fu) * 100).toFixed(0)}%`)
          )
        )
      )
    )
  );

  const curve = yeastCurve(S.fridgeTempC, 12, 120, 30, model);

  return card(
    'Fermentation: time and temperature',
    'Every phase is reduced to fermentation units, so two different schedules can be compared directly.',
    h(
      'div',
      { class: 'row' },
      tempField({ label: 'Cold ferment temperature', valueC: S.fridgeTempC, unit: u, step: 1, hint: 'Your fridge. This is the single biggest lever on timing.', onChange: (v) => setSchedule({ fridgeTempC: v, bigaFridgeTempC: v }) }),
      tempField({ label: 'Room temperature', valueC: S.roomTempC, unit: u, step: 1, hint: 'Used for the biga rest and the counter temper.', onChange: (v) => setSchedule({ roomTempC: v, bigaRoomTempC: v }) }),
      tempField({ label: 'Bench temperature', valueC: S.benchTempC, unit: u, step: 1, onChange: (v) => setSchedule({ benchTempC: v }) })
    ),
    h(
      'div',
      { class: 'row' },
      numberField({ label: 'Cold proof', value: S.coldProofHours, min: 1, max: 168, step: 1, suffix: 'h', onInput: (v) => setSchedule({ coldProofHours: v ?? 1 }) }),
      numberField({ label: 'Biga ambient rest', value: S.bigaRestHours, min: 0, max: 24, step: 0.25, suffix: 'h', onInput: (v) => setSchedule({ bigaRestHours: v ?? 0 }) }),
      numberField({ label: 'Biga cold hold', value: S.bigaColdHours, min: 0, max: 48, step: 1, suffix: 'h', onInput: (v) => setSchedule({ bigaColdHours: v ?? 0 }) }),
      numberField({ label: 'Counter temper', value: S.temperHours, min: 0, max: 12, step: 0.25, suffix: 'h', onInput: (v) => setSchedule({ temperHours: v ?? 0 }) })
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Fermentation load', `${fu.toFixed(1)} FU`, `ceiling ${c.fuCeiling ?? '—'} FU`),
      stat('Ripeness', Number.isFinite(ratio) ? `${(ratio * 100).toFixed(0)}%` : '—', verdict.label),
      stat('Yeast this needs', Number.isFinite(need) ? `${need.toFixed(3)}%` : '—', 'instant dry, of total flour'),
      stat('Total lead time', fmtDuration((ctx.sched.totalMin || 0) / 60), 'first mix to launch')
    ),
    h('p', { class: `note ${verdict.tone}` }, verdictText(verdict, ratio, need, s.current.recipe)),
    Number.isFinite(need)
      ? h('div', { class: 'row tight' }, h('button', { class: 'btn tonal small', onClick: () => { setRecipe({ baseYeastPct: round(convertYeast(need, 'idy', s.current.recipe.yeastType), 3) }); toast('Inoculation matched to the schedule'); } }, icon('auto_fix_high'), 'Match yeast to this schedule'))
      : null,
    stageRows,
    h('h3', { style: { fontSize: '.85rem', marginTop: '4px' } }, `Yeast needed against cold proof length at ${fmtTemp(S.fridgeTempC, u)}`),
    lineChart({
      series: [{ points: curve }],
      xLabel: 'Cold proof hours',
      yLabel: 'IDY %',
      markers: [{ x: S.coldProofHours, label: 'now' }],
      height: 220,
    })
  );
}

function verdictText(verdict, ratio, need, r) {
  if (!Number.isFinite(ratio)) return 'Set an inoculation to see whether this schedule lands ripe.';
  const at = `${effectiveYeastPct(r).toFixed(3)}% ${YEAST_LABEL[r.yeastType].toLowerCase()}`;
  if (verdict.key === 'on') return `At ${at} this schedule lands in the window. The dough should be at peak when it hits the deck.`;
  if (ratio > 1) return `At ${at} the dough will be roughly ${((ratio - 1) * 100).toFixed(0)}% past peak by launch. Either cut the cold proof, drop the fridge temperature, or come down to about ${need.toFixed(3)}% yeast.`;
  return `At ${at} the dough reaches only ${(ratio * 100).toFixed(0)}% of ripeness by launch. Extend the cold proof, warm the temper, or go up to about ${need.toFixed(3)}% yeast.`;
}

/* -------------------------------- ratios -------------------------------- */

function ratiosCard(ctx) {
  const { s, u, c } = ctx;
  const r = s.current.recipe;
  const range = hydrationRangeForW(c.blend.w, 0);

  return card(
    'Ratios and batch',
    "Baker's percentages against total flour.",
    h(
      'div',
      { class: 'row' },
      numberField({ label: 'Dough balls', value: r.balls, min: 1, max: 60, onInput: (v) => setRecipe({ balls: v ?? 1, frozenBalls: Math.min(r.frozenBalls, v ?? 1) }) }),
      numberField({ label: 'Ball weight', value: r.ballWeight, min: 100, max: 500, step: 5, suffix: 'g', onInput: (v) => setRecipe({ ballWeight: v ?? 250 }) }),
      numberField({ label: 'For the freezer', value: r.frozenBalls, min: 0, max: r.balls, hint: 'Raises inoculation to cover freeze mortality', onInput: (v) => setRecipe({ frozenBalls: Math.min(v ?? 0, r.balls) }) }),
      numberField({ label: 'Waste allowance', value: r.wastePct, min: 0, max: 15, step: 0.5, suffix: '%', onInput: (v) => setRecipe({ wastePct: v ?? 0 }) })
    ),
    sliderField({
      label: 'Hydration',
      value: r.hydrationPct,
      min: 50,
      max: 90,
      step: 0.5,
      format: (v) => `${v}%`,
      onInput: (v) => setRecipe({ hydrationPct: v }),
    }),
    range ? h('p', { class: 'hint', style: { fontSize: '.72rem', marginTop: '-6px' } }, `Published guide for the ${range.band} band is ${range.low} to ${range.high}% before any style adjustment.`) : null,
    h(
      'div',
      { class: 'row' },
      numberField({ label: 'Salt', value: r.saltPct, min: 0, max: 5, step: 0.1, suffix: '%', onInput: (v) => setRecipe({ saltPct: v ?? 0 }) }),
      numberField({ label: 'Olive oil', value: r.oilPct, min: 0, max: 8, step: 0.1, suffix: '%', onInput: (v) => setRecipe({ oilPct: v ?? 0 }) }),
      numberField({ label: 'Sugar', value: r.sugarPct, min: 0, max: 8, step: 0.1, suffix: '%', onInput: (v) => setRecipe({ sugarPct: v ?? 0 }) }),
      numberField({ label: 'Diastatic malt', value: r.maltPct, min: 0, max: 3, step: 0.1, suffix: '%', onInput: (v) => setRecipe({ maltPct: v ?? 0 }) })
    ),
    h(
      'div',
      { class: 'row' },
      selectField({
        label: 'Yeast',
        value: r.yeastType,
        options: Object.entries(YEAST_LABEL).map(([k, v]) => ({ value: k, label: v })),
        onChange: (v) => setRecipe({ yeastType: v, baseYeastPct: round(convertYeast(r.baseYeastPct, r.yeastType, v), 3) }),
      }),
      numberField({ label: 'Inoculation', value: r.baseYeastPct, min: 0, max: 3, step: 0.005, suffix: '%', onInput: (v) => setRecipe({ baseYeastPct: v ?? 0 }) }),
      numberField({ label: 'Freeze buffer', value: r.freezeBufferPct, min: 0, max: 0.2, step: 0.005, suffix: '%', hint: 'Added only when balls go to the freezer', onInput: (v) => setRecipe({ freezeBufferPct: v ?? 0 }) })
    ),
    h(
      'div',
      { class: 'row' },
      selectField({
        label: 'Method',
        value: r.method,
        options: [
          { value: 'biga', label: 'Biga' },
          { value: 'poolish', label: 'Poolish' },
          { value: 'direct', label: 'Direct' },
        ],
        onChange: (v) => setRecipe({
          method: v,
          prefermentFlourPct: v === 'biga' ? 100 : v === 'poolish' ? 35 : 0,
          prefermentHydrationPct: v === 'biga' ? 45 : v === 'poolish' ? 100 : 0,
          prefermentYeastShare: v === 'direct' ? 0 : 1,
        }),
      }),
      numberField({ label: 'Preferment flour', value: r.prefermentFlourPct, min: 0, max: 100, step: 5, suffix: '%', onInput: (v) => setRecipe({ prefermentFlourPct: v ?? 0 }) }),
      numberField({ label: 'Preferment hydration', value: r.prefermentHydrationPct, min: 0, max: 120, step: 1, suffix: '%', hint: 'Biga is traditionally 44 to 45%', onInput: (v) => setRecipe({ prefermentHydrationPct: v ?? 0 }) }),
      numberField({ label: 'Bassinage doses', value: r.bassinageDoses, min: 1, max: 8, onInput: (v) => setRecipe({ bassinageDoses: v ?? 1 }) })
    ),
    ...c.warnings.map((w) => h('p', { class: 'note warn' }, w))
  );
}

/* ------------------------------- ingredients ---------------------------- */

function outputCard(ctx) {
  const { c, u, s } = ctx;
  const rows = ingredientRows(c);
  const pref = c.preferment;

  return card(
    'What to weigh',
    `${c.recipe.balls} balls of ${c.recipe.ballWeight} g, ${fmtGrams(c.totalDough)} of dough`,
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Ingredient'), h('th', { class: 'num' }, "Baker's %"), h('th', { class: 'num' }, 'Total'), pref.active ? h('th', { class: 'num' }, 'Preferment') : null, pref.active ? h('th', { class: 'num' }, 'Final mix') : null)),
        h(
          'tbody',
          {},
          ...rows.map((row) =>
            h(
              'tr',
              {},
              h('td', {}, row.label),
              h('td', { class: 'num' }, `${round(row.pct, 3)}%`),
              h('td', { class: 'num' }, fmtGrams(row.grams)),
              pref.active ? h('td', { class: 'num' }, fmtGrams(stagePart(c, row.key, 'pref'))) : null,
              pref.active ? h('td', { class: 'num' }, fmtGrams(stagePart(c, row.key, 'final'))) : null
            )
          )
        )
      )
    ),
    pref.active
      ? h(
          'div',
          { class: 'stats' },
          stat('Preferment', fmtGrams(pref.mass), `${pref.flourPct}% of flour at ${pref.hydrationPct}%`),
          stat('Bassinage', fmtGrams(c.finalMix.bassinage), `${c.finalMix.doses} doses of ${fmtGrams(c.finalMix.doseSize)}`),
          stat('Salt wash', fmtGrams(c.finalMix.saltWash), 'held back for the salt'),
          stat('Preferment flour', stageFlourLabel(c, 'biga'), '')
        )
      : null
  );
}

function stagePart(c, key, which) {
  const pref = c.preferment;
  if (key === 'flour') return which === 'pref' ? pref.flour : c.finalMix.flour;
  if (key === 'water') return which === 'pref' ? pref.water : c.finalMix.water;
  if (key === 'yeast') return which === 'pref' ? pref.yeast : c.finalMix.yeast;
  return which === 'pref' ? 0 : c[key];
}

/* -------------------------------- advisor ------------------------------- */

function advisorCard(ctx) {
  const { s, u, c, S } = ctx;
  const r = s.current.recipe;
  const style = s.current.style || 'canotto';
  const lead = Math.round((ctx.sched.totalMin || 0) / 60);
  const plan = suggestPlan(c.blend, {
    flours: r.flours,
    style,
    method: r.method,
    roomTempC: S.roomTempC,
    fridgeTempC: S.fridgeTempC,
    benchTempC: S.benchTempC,
    model: ctx.model,
  });
  const review = reviewPlan({ blend: c.blend, stages: scheduleStages(S), idyPct: convertYeast(r.baseYeastPct, r.yeastType, 'idy'), method: r.method, model: ctx.model });

  return card(
    'What this flour suggests',
    'Derived from the published strength and maturation window for the blend, at your temperatures.',
    h(
      'div',
      { class: 'chip-row' },
      ...STYLES.map((st) => chip(st.label, st.id === style, () => update((x) => { x.current.style = st.id; })))
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Method', plan.method, plan.band.label),
      stat('Hydration', plan.hydration ? `${plan.hydration.recommended}%` : '—', plan.hydration ? `${plan.hydration.low} to ${plan.hydration.high}%` : ''),
      stat('Maturation', `${Math.round(plan.totalHours)} h`, plan.window ? `window ${plan.window[0]} to ${plan.window[1]} h` : ''),
      stat('Inoculation', `${plan.idyPct.toFixed(3)}%`, 'instant dry')
    ),
    h('ul', { class: 'src-list' }, ...plan.rationale.map((t) => h('li', {}, t))),
    ...review.notes.map((n) => h('p', { class: `note ${n.tone}` }, n.text)),
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn', onClick: () => applyPlan(plan) }, icon('auto_awesome'), 'Apply this plan'),
      h('button', { class: 'btn ghost', onClick: () => { saveCurrentToRecipe(); toast('Saved onto the current recipe'); } }, icon('save'), 'Save to recipe')
    )
  );
}

function applyPlan(plan) {
  update((s) => {
    Object.assign(s.current.recipe, plan.recipePatch);
    Object.assign(s.current.schedule, plan.schedule);
  });
  toast('Plan applied to the current dough');
}

/* --------------------------- water temperature -------------------------- */

function waterTempCard(ctx) {
  const { s, u, S, E } = ctx;
  const w = s.current.water || {};
  const mixer = findMixer(E.mixerId);
  const flourTempC = w.flourTempC ?? S.roomTempC;
  const frictionC = w.frictionC ?? mixer.frictionC;
  const prefTempC = s.current.recipe.method === 'direct' ? null : (w.prefermentTempC ?? S.fridgeTempC);
  const target = waterTempFor({ ddtC: S.ddtC, flourTempC, roomTempC: S.roomTempC, frictionC, prefermentTempC: prefTempC });

  return card(
    'Mix water temperature',
    'Hit the target dough temperature instead of guessing at it. Friction is mostly down to the mixer.',
    h(
      'div',
      { class: 'row' },
      h('div', { style: { flex: '1 1 100%' } }, h('p', { class: 'note neutral' }, `Mixing with ${mixerLabel(E)}, which adds about ${fmtTempDelta(mixer.frictionC, u)} of friction. Change it on the Setup screen.`))
    ),
    h(
      'div',
      { class: 'row' },
      tempField({ label: 'Target dough temperature', valueC: S.ddtC, unit: u, step: 0.5, onChange: (v) => setSchedule({ ddtC: v }) }),
      tempField({ label: 'Flour temperature', valueC: flourTempC, unit: u, onChange: (v) => update((st) => { st.current.water = { ...st.current.water, flourTempC: v }; }) }),
      tempDeltaField({ label: 'Friction allowance', valueC: frictionC, unit: u, step: 1, hint: `${mixer.label} default is ${fmtTempDelta(mixer.frictionC, u)}`, onChange: (v) => update((st) => { st.current.water = { ...st.current.water, frictionC: v }; }) }),
      prefTempC !== null ? tempField({ label: 'Preferment temperature', valueC: prefTempC, unit: u, onChange: (v) => update((st) => { st.current.water = { ...st.current.water, prefermentTempC: v }; }) }) : null
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Use water at', fmtTemp(target, u, 1), prefTempC === null ? 'three-factor' : 'four-factor'),
      stat('Hard stop', fmtTemp(S.ddtC + 1.7, u), 'stop mixing at this dough temperature')
    ),
    target < 0 ? h('p', { class: 'note warn' }, 'The calculation asks for water below freezing. Chill the flour, use ice as part of the water weight, or accept a warmer dough.') : null
  );
}
