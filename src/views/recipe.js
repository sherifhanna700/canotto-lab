// Recipe: which dough you are making, and all its numbers in one place.

import { h, card, numberField, selectField, sliderField, textField, pill, stat, toast, icon, confirmDialog } from '../lib/ui.js';
import { update, addRecipe, deleteRecipe, activateRecipe, saveCurrentToRecipe } from '../lib/store.js';
import { ingredientRows, YEAST_LABEL, effectiveYeastPct, convertYeast, stageFlourLabel } from '../model/dough.js';
import { floursByCountry, hydrationRangeForW } from '../model/flours.js';
import { scheduleStages } from '../model/protocol.js';
import { fermentUnits, stageBreakdown, yeastForFU, ripeness, ripenessVerdict, waterTempFor } from '../model/ferment.js';
import { suggestPlan, reviewPlan } from '../model/advisor.js';
import { recipeFromBlend, deriveRecipe, recipeRating } from '../model/recipes.js';
import { fmtGrams, fmtTemp, fmtTempDelta, fmtDuration, round } from '../model/units.js';
import { recipeLink, copyText } from '../lib/share.js';
import { findMixer, mixerLabel } from '../model/equipment.js';
import { tempField, tempDeltaField, ratingBadge, stars } from './common.js';

const setRecipe = (patch) => update((s) => Object.assign(s.current.recipe, patch));
const setSchedule = (patch) => update((s) => Object.assign(s.current.schedule, patch));

export default function renderRecipe(ctx) {
  return [pickerCard(ctx), flourCard(ctx), doughCard(ctx), timingCard(ctx), weighCard(ctx)];
}

/* -------------------------------- picker -------------------------------- */

function pickerCard(ctx) {
  const { s } = ctx;
  const active = s.recipes.find((r) => r.id === s.current.recipeId) || s.recipes[0];
  const rating = active ? recipeRating(active.id, s.bakes) : null;

  return card(
    'Recipe',
    'Everything below belongs to this one. Save it, or duplicate it before you change things.',
    h(
      'div',
      { class: 'row' },
      selectField({
        label: 'Working on',
        value: s.current.recipeId,
        options: s.recipes.map((r) => ({ value: r.id, label: r.name })),
        onChange: (v) => { activateRecipe(v); toast('Loaded'); },
      }),
      textField({ label: 'Name', value: s.current.title, onInput: (v) => update((st) => { st.current.title = v; }) })
    ),
    rating ? h('div', { class: 'row tight' }, ratingBadge(rating), rating.average ? stars(rating.average) : null) : null,
    h(
      'div',
      { class: 'item-actions' },
      h('button', { class: 'btn small', onClick: () => { saveCurrentToRecipe(); toast('Saved'); } }, icon('save'), 'Save changes'),
      h('button', { class: 'btn ghost small', onClick: () => duplicate(ctx, active) }, icon('content_copy'), 'Duplicate'),
      h('button', { class: 'btn ghost small', onClick: () => newFromFlour(ctx) }, icon('add'), 'New from this flour'),
      active ? h('button', { class: 'btn ghost small', onClick: async () => { const ok = await copyText(recipeLink(active)); toast(ok ? 'Link copied' : 'Could not copy'); } }, icon('link'), 'Share link') : null,
      active && active.origin !== 'house' && s.recipes.length > 1
        ? h('button', { class: 'btn ghost small', onClick: () => confirmDialog(`Delete ${active.name}? Bakes logged against it are kept.`, () => { deleteRecipe(active.id); toast('Deleted'); }, 'Delete') }, icon('delete'), 'Delete')
        : null
    )
  );
}

function duplicate(ctx, active) {
  if (!active) return;
  const copy = deriveRecipe(active, { name: `${ctx.s.current.title} v2` });
  copy.recipe = JSON.parse(JSON.stringify(ctx.s.current.recipe));
  copy.schedule = JSON.parse(JSON.stringify(ctx.s.current.schedule));
  addRecipe(copy);
  activateRecipe(copy.id);
  toast('Duplicated. Change what you like.');
}

function newFromFlour(ctx) {
  const r = recipeFromBlend(ctx.s.current.recipe.flours, {
    balls: ctx.s.current.recipe.balls,
    ballWeight: ctx.s.current.recipe.ballWeight,
    roomTempC: ctx.S.roomTempC,
    fridgeTempC: ctx.S.fridgeTempC,
    model: ctx.model,
    origin: 'user',
  });
  addRecipe(r);
  activateRecipe(r.id);
  toast('Built from the published figures for this flour');
}

/* -------------------------------- flour --------------------------------- */

function flourCard(ctx) {
  const { s, c, S } = ctx;
  const flours = s.current.recipe.flours;
  const blend = c.blend;
  const groups = floursByCountry().map((g) => ({
    label: g.label,
    options: g.list.map((f) => ({ value: f.id, label: `${f.brand} ${f.name}${f.w ? ` · W ${f.w}` : ''}` })),
  }));

  const plan = suggestPlan(blend, { flours, roomTempC: S.roomTempC, fridgeTempC: S.fridgeTempC, model: ctx.model });

  const rows = flours.map((entry, i) =>
    h(
      'div',
      { class: 'row tight', style: { alignItems: 'flex-end' } },
      h('div', { style: { flex: '1 1 200px' } }, selectField({
        label: i === 0 ? 'Flour' : `Flour ${i + 1}`,
        value: entry.id,
        groups,
        onChange: (v) => update((st) => { st.current.recipe.flours[i].id = v; }),
      })),
      h('div', { style: { flex: '0 0 88px' } }, numberField({
        label: 'Share', value: entry.pct, min: 0, max: 100, suffix: '%',
        onInput: (v) => update((st) => { st.current.recipe.flours[i].pct = v ?? 0; }),
      })),
      flours.length > 1
        ? h('div', { style: { flex: '0 0 auto' } },
            h('button', { class: 'btn ghost small', title: 'Remove', onClick: () => update((st) => { st.current.recipe.flours.splice(i, 1); }) }, icon('close')))
        : null
    )
  );

  return card(
    'Flour',
    'Strength sets what the dough can carry. Blend as many as you like.',
    ...rows,
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn ghost small', onClick: () => update((st) => { st.current.recipe.flours.push({ id: 'caputo-semola', pct: 10, stage: 'blend' }); }) }, icon('add'), 'Blend in another'),
      !blend.valid ? pill(`Shares total ${blend.total}%`, 'warn') : null
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Strength', blend.w ? `W ${blend.w}` : '—', blend.estimated ? 'estimated from protein' : 'published'),
      stat('Maturation window', blend.ferment ? `${blend.ferment[0]}–${blend.ferment[1]} h` : '—', blend.fermentSourced ? 'published' : 'from the W band'),
      stat('Suggested hydration', plan.hydration ? `${plan.hydration.recommended}%` : '—', plan.hydration ? `${plan.hydration.low} to ${plan.hydration.high}%` : ''),
      stat('Suggested yeast', `${plan.idyPct.toFixed(3)}%`, `for ${Math.round(plan.totalHours)} h`)
    ),
    h('p', { class: 'note neutral' }, `${plan.band.label}. ${plan.band.blurb}${blend.estimated ? ' W is estimated from protein, not published.' : ''}`),
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn tonal small', onClick: () => { update((st) => { Object.assign(st.current.recipe, plan.recipePatch); Object.assign(st.current.schedule, plan.schedule); }); toast('Applied'); } }, icon('auto_awesome'), 'Use these suggestions')
    )
  );
}

/* -------------------------------- dough --------------------------------- */

function doughCard(ctx) {
  const { s, c } = ctx;
  const r = s.current.recipe;
  const range = hydrationRangeForW(c.blend.w, 2);

  return card(
    'Dough',
    "Baker's percentages against total flour.",
    h(
      'div',
      { class: 'row' },
      numberField({ label: 'Dough balls', value: r.balls, min: 1, max: 60, onInput: (v) => setRecipe({ balls: v ?? 1, frozenBalls: Math.min(r.frozenBalls, v ?? 1) }) }),
      numberField({ label: 'Ball weight', value: r.ballWeight, min: 100, max: 500, step: 5, suffix: 'g', onInput: (v) => setRecipe({ ballWeight: v ?? 250 }) }),
      numberField({ label: 'For the freezer', value: r.frozenBalls, min: 0, max: r.balls, onInput: (v) => setRecipe({ frozenBalls: Math.min(v ?? 0, r.balls) }) })
    ),
    sliderField({ label: 'Hydration', value: r.hydrationPct, min: 55, max: 85, step: 0.5, format: (v) => `${v}%`, onInput: (v) => setRecipe({ hydrationPct: v }) }),
    range ? h('p', { class: 'hint', style: { fontSize: '.72rem', marginTop: '-6px' } }, `Guide for this flour is ${range.low} to ${range.high}%.`) : null,
    h(
      'div',
      { class: 'row' },
      numberField({ label: 'Salt', value: r.saltPct, min: 0, max: 5, step: 0.1, suffix: '%', onInput: (v) => setRecipe({ saltPct: v ?? 0 }) }),
      numberField({ label: 'Olive oil', value: r.oilPct, min: 0, max: 5, step: 0.1, suffix: '%', onInput: (v) => setRecipe({ oilPct: v ?? 0 }) }),
      numberField({ label: 'Biga flour', value: r.prefermentFlourPct, min: 10, max: 100, step: 5, suffix: '%', hint: 'Share of total flour in the biga', onInput: (v) => setRecipe({ prefermentFlourPct: v ?? 100 }) }),
      numberField({ label: 'Biga hydration', value: r.prefermentHydrationPct, min: 35, max: 60, step: 1, suffix: '%', hint: 'Traditionally 44 to 45%', onInput: (v) => setRecipe({ prefermentHydrationPct: v ?? 45 }) })
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
    ...c.warnings.map((w) => h('p', { class: 'note warn' }, w))
  );
}

/* ------------------------------ time and temp --------------------------- */

function timingCard(ctx) {
  const { s, u, S, c } = ctx;
  const stages = scheduleStages(S);
  const fu = fermentUnits(stages, ctx.model);
  const idy = convertYeast(s.current.recipe.baseYeastPct, s.current.recipe.yeastType, 'idy');
  const ratio = ripeness(stages, idy, ctx.model);
  const verdict = ripenessVerdict(ratio);
  const need = yeastForFU(fu, ctx.model);
  const review = reviewPlan({ blend: c.blend, stages, idyPct: idy, model: ctx.model });

  return card(
    'Time and temperature',
    'Each phase is reduced to fermentation units, so two schedules can be compared directly.',
    h(
      'div',
      { class: 'row' },
      tempField({ label: 'Cold ferment temperature', valueC: S.fridgeTempC, unit: u, step: 1, hint: 'Your fridge. The biggest lever on timing.', onChange: (v) => setSchedule({ fridgeTempC: v, bigaFridgeTempC: v }) }),
      tempField({ label: 'Room temperature', valueC: S.roomTempC, unit: u, step: 1, onChange: (v) => setSchedule({ roomTempC: v, bigaRoomTempC: v }) })
    ),
    h(
      'div',
      { class: 'row' },
      numberField({ label: 'Biga ambient rest', value: S.bigaRestHours, min: 0, max: 24, step: 0.25, suffix: 'h', onInput: (v) => setSchedule({ bigaRestHours: v ?? 0 }) }),
      numberField({ label: 'Biga cold hold', value: S.bigaColdHours, min: 0, max: 48, step: 1, suffix: 'h', onInput: (v) => setSchedule({ bigaColdHours: v ?? 0 }) }),
      numberField({ label: 'Cold proof', value: S.coldProofHours, min: 1, max: 168, step: 1, suffix: 'h', onInput: (v) => setSchedule({ coldProofHours: v ?? 1 }) }),
      numberField({ label: 'Counter temper', value: S.temperHours, min: 0, max: 12, step: 0.25, suffix: 'h', onInput: (v) => setSchedule({ temperHours: v ?? 0 }) })
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Fermentation load', `${fu.toFixed(1)} FU`, `ceiling ${c.fuCeiling ?? '—'} FU`),
      stat('Ripeness', Number.isFinite(ratio) ? `${(ratio * 100).toFixed(0)}%` : '—', verdict.label),
      stat('Total lead time', fmtDuration((ctx.sched.totalMin || 0) / 60), 'first mix to launch')
    ),
    h('p', { class: `note ${verdict.tone}` }, verdictText(verdict, ratio, need, s.current.recipe)),
    ...review.notes.filter((n) => n.tone !== 'good').map((n) => h('p', { class: `note ${n.tone}` }, n.text)),
    Number.isFinite(need)
      ? h('div', { class: 'row tight' }, h('button', { class: 'btn tonal small', onClick: () => { setRecipe({ baseYeastPct: round(convertYeast(need, 'idy', s.current.recipe.yeastType), 3) }); toast('Yeast matched to the schedule'); } }, icon('auto_fix_high'), 'Match yeast to this schedule'))
      : null,
    h(
      'details',
      { class: 'foldout' },
      h('summary', {}, 'Phase by phase'),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Phase'), h('th', { class: 'num' }, 'Hours'), h('th', { class: 'num' }, 'Temp'), h('th', { class: 'num' }, 'Rate'), h('th', { class: 'num' }, 'FU'))),
          h('tbody', {}, ...stageBreakdown(stages, ctx.model).map((b) =>
            h('tr', {}, h('td', {}, b.name), h('td', { class: 'num' }, fmtDuration(b.hours)), h('td', { class: 'num' }, fmtTemp(b.tempC, u)), h('td', { class: 'num' }, `${(b.rate * 100).toFixed(0)}%`), h('td', { class: 'num' }, b.fu.toFixed(1)))
          ))
        )
      )
    ),
    waterFoldout(ctx)
  );
}

function verdictText(verdict, ratio, need, r) {
  if (!Number.isFinite(ratio)) return 'Set an inoculation to see whether this schedule lands ripe.';
  const at = `${effectiveYeastPct(r).toFixed(3)}% ${YEAST_LABEL[r.yeastType].toLowerCase()}`;
  if (verdict.key === 'on') return `At ${at} this schedule lands in the window. The dough should be at peak when it hits the deck.`;
  if (ratio > 1) return `At ${at} the dough will be about ${((ratio - 1) * 100).toFixed(0)}% past peak by launch. Cut the cold proof, drop the fridge temperature, or come down to about ${need.toFixed(3)}% yeast.`;
  return `At ${at} the dough reaches only ${(ratio * 100).toFixed(0)}% of ripeness by launch. Extend the cold proof, or go up to about ${need.toFixed(3)}% yeast.`;
}

function waterFoldout(ctx) {
  const { s, u, S, E } = ctx;
  const w = s.current.water || {};
  const mixer = findMixer(E.mixerId);
  const flourTempC = w.flourTempC ?? S.roomTempC;
  const frictionC = w.frictionC ?? mixer.frictionC;
  const target = waterTempFor({ ddtC: S.ddtC, flourTempC, roomTempC: S.roomTempC, frictionC, prefermentTempC: S.fridgeTempC });

  return h(
    'details',
    { class: 'foldout' },
    h('summary', {}, 'Mix water temperature'),
    h(
      'div',
      { class: 'row' },
      tempField({ label: 'Target dough temperature', valueC: S.ddtC, unit: u, step: 0.5, onChange: (v) => setSchedule({ ddtC: v }) }),
      tempField({ label: 'Flour temperature', valueC: flourTempC, unit: u, onChange: (v) => update((st) => { st.current.water = { ...st.current.water, flourTempC: v }; }) }),
      tempDeltaField({ label: 'Friction allowance', valueC: frictionC, unit: u, step: 1, hint: `${mixerLabel(E)} default is ${fmtTempDelta(mixer.frictionC, u)}`, onChange: (v) => update((st) => { st.current.water = { ...st.current.water, frictionC: v }; }) })
    ),
    h('p', { class: 'note neutral' }, `Use water at ${fmtTemp(target, u, 1)} to land the dough at ${fmtTemp(S.ddtC, u)}. Stop mixing at ${fmtTemp(S.ddtC + 1.7, u)}.`)
  );
}

/* ------------------------------- what to weigh -------------------------- */

function weighCard(ctx) {
  const { c } = ctx;
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
        h('thead', {}, h('tr', {}, h('th', {}, 'Ingredient'), h('th', { class: 'num' }, '%'), h('th', { class: 'num' }, 'Total'), pref.active ? h('th', { class: 'num' }, 'Biga') : null, pref.active ? h('th', { class: 'num' }, 'Final mix') : null)),
        h('tbody', {}, ...rows.map((row) =>
          h(
            'tr',
            {},
            h('td', {}, row.label),
            h('td', { class: 'num' }, `${round(row.pct, 3)}%`),
            h('td', { class: 'num' }, fmtGrams(row.grams)),
            pref.active ? h('td', { class: 'num' }, fmtGrams(stagePart(c, row.key, 'pref'))) : null,
            pref.active ? h('td', { class: 'num' }, fmtGrams(stagePart(c, row.key, 'final'))) : null
          )
        ))
      )
    ),
    pref.active
      ? h(
          'div',
          { class: 'stats' },
          stat('Biga', fmtGrams(pref.mass), `${pref.flourPct}% of flour at ${pref.hydrationPct}%`),
          stat('Bassinage', fmtGrams(c.finalMix.bassinage), `${c.finalMix.doses} doses of ${fmtGrams(c.finalMix.doseSize)}`),
          stat('Salt wash', fmtGrams(c.finalMix.saltWash), 'held back for the salt')
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
