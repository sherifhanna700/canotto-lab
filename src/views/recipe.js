// Recipe: which dough you are making, and all its numbers in one place.
//
// Only the house protocol ships as a preset. Everything else is built from
// scratch by picking a flour, or duplicated from something that already exists.
// Edits save straight onto the selected recipe, so there is no save step and
// the name in the list is always the name in the field.

import { h, card, numberField, selectField, sliderField, textField, pill, stat, toast, icon, confirmDialog } from '../lib/ui.js?v=b05e27a1';
import { update, editCurrent, addRecipe, deleteRecipe, activateRecipe, restoreHouseRecipe, download } from '../lib/store.js?v=b05e27a1';
import { ingredientRows, YEAST_LABEL, effectiveYeastPct, convertYeast, computeRecipe } from '../model/dough.js?v=b05e27a1';
import { floursByCountry, blendStats, blendLabel, hydrationRangeForW } from '../model/flours.js?v=b05e27a1';
import { scheduleStages, solveSchedule } from '../model/protocol.js?v=b05e27a1';
import { fermentUnits, stageBreakdown, yeastForFU, ripeness, ripenessVerdict, waterTempFor } from '../model/ferment.js?v=b05e27a1';
import { suggestPlan, reviewPlan, defaultLeadHours } from '../model/advisor.js?v=b05e27a1';
import { recipeFromBlend, deriveRecipe, recipeRating } from '../model/recipes.js?v=b05e27a1';
import { fmtGrams, fmtTemp, fmtTempDelta, fmtDuration, round } from '../model/units.js?v=b05e27a1';
import { recipeLink, copyText } from '../lib/share.js?v=b05e27a1';
import { findMixer, mixerLabel } from '../model/equipment.js?v=b05e27a1';
import { tempField, tempDeltaField, ratingBadge, stars } from './common.js?v=b05e27a1';
import { go } from '../app.js?v=b05e27a1';

const setRecipe = (patch) => editCurrent((c) => Object.assign(c.recipe, patch));
const setSchedule = (patch) => editCurrent((c) => Object.assign(c.schedule, patch));

export default function renderRecipe(ctx) {
  if (ctx.s.ui?.creating) return [createCard(ctx)];
  return [managerCard(ctx), inputsCard(ctx), doughCard(ctx), timingCard(ctx), weighCard(ctx)];
}

/** Maturation a schedule currently spans, so the slider has a starting value. */
function leadHoursOf(S) {
  const benchHours = (S.finalMixMin + S.benchRest1Min + S.benchRest2Min + 5 + S.oilRestMin + S.ballingMin) / 60;
  return Math.round(S.bigaRestHours + S.bigaColdHours + benchHours + S.coldProofHours + S.temperHours);
}

function recipeFileName(r) {
  return `${(r.name || 'recipe').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.json`;
}

const flourGroups = () =>
  floursByCountry().map((g) => ({
    label: g.label,
    options: g.list.map((f) => ({ value: f.id, label: `${f.brand} ${f.name}${f.w ? ` · W ${f.w}` : ''}` })),
  }));

/* ------------------------------ new recipe ------------------------------ */

function blank(s) {
  return {
    name: '',
    flours: [{ id: 'caputo-cuoco', pct: 100, stage: 'blend' }],
    balls: s.current.recipe.balls,
    ballWeight: s.current.recipe.ballWeight,
    frozenBalls: 0,
    fridgeTempC: s.current.schedule.fridgeTempC,
    roomTempC: s.current.schedule.roomTempC,
    totalHours: null,
  };
}

function draft(s) {
  if (!s.ui) s.ui = {};
  if (!s.ui.draft) s.ui.draft = blank(s);
  return s.ui.draft;
}

function createCard(ctx) {
  const { s, u } = ctx;
  const d = draft(s);
  const blend = blendStats(d.flours);
  const lead = d.totalHours ?? defaultLeadHours(blend);
  const plan = suggestPlan(blend, {
    flours: d.flours,
    totalHours: lead,
    roomTempC: d.roomTempC,
    fridgeTempC: d.fridgeTempC,
    model: ctx.model,
  });
  const window = blend.ferment || [12, 96];
  const setDraft = (patch) => update((st) => Object.assign(draft(st), patch));

  const flourRows = d.flours.map((entry, i) =>
    h(
      'div',
      { class: 'row tight', style: { alignItems: 'flex-end' } },
      h('div', { style: { flex: '1 1 200px' } }, selectField({
        label: i === 0 ? 'Flour' : `Flour ${i + 1}`,
        value: entry.id,
        groups: flourGroups(),
        onChange: (v) => update((st) => { draft(st).flours[i].id = v; }),
      })),
      h('div', { style: { flex: '0 0 88px' } }, numberField({
        label: 'Share', value: entry.pct, min: 0, max: 100, suffix: '%',
        onInput: (v) => update((st) => { draft(st).flours[i].pct = v ?? 0; }),
      })),
      d.flours.length > 1
        ? h('div', { style: { flex: '0 0 auto' } }, h('button', { class: 'btn ghost small', onClick: () => update((st) => { draft(st).flours.splice(i, 1); }) }, icon('close')))
        : null
    )
  );

  return card(
    'New recipe',
    'Tell it what you have. It works out the ratios, the timings and the protocol.',

    h('h3', { style: { fontSize: '.86rem' } }, '1. Name it'),
    textField({ label: 'Recipe name', value: d.name, placeholder: `${blendLabel(d.flours)}, ${Math.round(lead)} hour`, onInput: (v) => setDraft({ name: v }) }),

    h('h3', { style: { fontSize: '.86rem', marginTop: '4px' } }, '2. Pick the flour'),
    ...flourRows,
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn ghost small', onClick: () => update((st) => { draft(st).flours.push({ id: 'caputo-semola', pct: 10, stage: 'blend' }); }) }, icon('add'), 'Blend in another'),
      !blend.valid ? pill(`Shares total ${blend.total}%`, 'warn') : null
    ),

    h('h3', { style: { fontSize: '.86rem', marginTop: '4px' } }, '3. How much dough'),
    h(
      'div',
      { class: 'row' },
      numberField({ label: 'Dough balls', value: d.balls, min: 1, max: 60, onInput: (v) => setDraft({ balls: v ?? 1 }) }),
      numberField({ label: 'Ball weight', value: d.ballWeight, min: 100, max: 500, step: 5, suffix: 'g', onInput: (v) => setDraft({ ballWeight: v ?? 250 }) }),
      numberField({ label: 'For the freezer', value: d.frozenBalls, min: 0, max: d.balls, onInput: (v) => setDraft({ frozenBalls: Math.min(v ?? 0, d.balls) }) })
    ),

    h('h3', { style: { fontSize: '.86rem', marginTop: '4px' } }, '4. Your temperatures'),
    h(
      'div',
      { class: 'row' },
      tempField({ label: 'Cold ferment', valueC: d.fridgeTempC, unit: u, step: 1, hint: 'Whatever your fridge holds', onChange: (v) => setDraft({ fridgeTempC: v }) }),
      tempField({ label: 'Room temperature', valueC: d.roomTempC, unit: u, step: 1, hint: 'Where the biga rests and the balls temper', onChange: (v) => setDraft({ roomTempC: v }) })
    ),

    h('h3', { style: { fontSize: '.86rem', marginTop: '4px' } }, '5. How long'),
    sliderField({
      label: 'Total maturation',
      value: lead,
      min: Math.max(2, window[0]),
      max: Math.max(window[1], window[0] + 12),
      step: 1,
      format: (v) => `${v} h`,
      onInput: (v) => setDraft({ totalHours: v }),
    }),
    h('p', { class: 'hint', style: { fontSize: '.72rem', marginTop: '-6px' } }, blend.fermentSourced ? `Published window for this flour is ${window[0]} to ${window[1]} hours.` : `No published window, so the ${blend.band?.label || 'W band'} guide applies: ${window[0]} to ${window[1]} hours.`),

    h('h3', { style: { fontSize: '.86rem', marginTop: '4px' } }, 'What that gives you'),
    h(
      'div',
      { class: 'stats' },
      stat('Strength', blend.w ? `W ${blend.w}` : '—', blend.estimated ? 'estimated' : 'published'),
      stat('Hydration', `${plan.hydration.recommended}%`, `${plan.hydration.low} to ${plan.hydration.high}%`),
      stat('Inoculation', `${plan.idyPct.toFixed(3)}%`, 'instant dry'),
      stat('Biga', '45% hydration', 'all the flour')
    ),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Phase'), h('th', { class: 'num' }, 'Hours'), h('th', { class: 'num' }, 'Temperature'))),
        h('tbody', {}, ...plan.stages.map((st) => h('tr', {}, h('td', {}, st.name), h('td', { class: 'num' }, fmtDuration(st.hours)), h('td', { class: 'num' }, fmtTemp(st.tempC, u)))))
      )
    ),
    h('p', { class: 'note neutral' }, 'These phases become the 19-step protocol, with clock times solved backwards from when you want the first pizza on the deck. Every number stays editable afterwards.'),

    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn', onClick: () => create(ctx, d, lead) }, icon('check'), 'Create recipe'),
      h('button', { class: 'btn ghost', onClick: () => update((st) => { st.ui.creating = false; st.ui.draft = null; }) }, 'Cancel')
    )
  );
}

function create(ctx, d, lead) {
  const blend = blendStats(d.flours);
  if (!blend.valid) {
    toast('Flour shares need to add up to 100%');
    return;
  }
  const recipe = recipeFromBlend(d.flours, {
    name: d.name.trim() || undefined,
    totalHours: lead,
    balls: d.balls,
    ballWeight: d.ballWeight,
    frozenBalls: d.frozenBalls,
    roomTempC: d.roomTempC,
    fridgeTempC: d.fridgeTempC,
    model: ctx.model,
    origin: 'user',
  });
  addRecipe(recipe);
  activateRecipe(recipe.id);
  update((st) => { st.ui.creating = false; st.ui.draft = null; });
  toast(`${recipe.name} created. The protocol is built from it.`);
}

/* ------------------------------- manager -------------------------------- */

function managerCard(ctx) {
  const { s, u } = ctx;

  return card(
    'Your recipes',
    `${s.recipes.length} stored in this browser. Only the house protocol ships with the app.`,
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn small', onClick: () => update((st) => { st.ui = { ...st.ui, creating: true, draft: null }; }) }, icon('add'), 'New recipe'),
      h('button', { class: 'btn ghost small', onClick: () => download('canotto-recipes.json', JSON.stringify({ recipes: s.recipes }, null, 2)) }, icon('download'), 'Download all')
    ),
    h('div', { class: 'list' }, ...s.recipes.map((r) => recipeRow(ctx, r)))
  );
}

function recipeRow(ctx, r) {
  const { s, u } = ctx;
  const isActive = r.id === s.current.recipeId;
  const isHouse = r.origin === 'house';
  const rating = recipeRating(r.id, s.bakes);
  const c = computeRecipe(r.recipe);

  return h(
    'div',
    { class: `item${isActive ? ' active' : ''}` },
    h(
      'div',
      { class: 'item-head' },
      h(
        'div',
        {},
        h('div', { class: 'item-title' }, r.name),
        h('div', { class: 'item-sub' }, `${c.flourLabel}${c.blend.w ? ` · W ${c.blend.w}` : ''}`)
      ),
      h('div', { style: { textAlign: 'right' } }, isActive ? pill('Loaded', 'accent') : ratingBadge(rating), rating.average ? h('div', {}, stars(rating.average)) : null)
    ),
    h('div', { class: 'item-sub' }, `${r.recipe.hydrationPct}% hydration · ${r.recipe.baseYeastPct}% ${r.recipe.yeastType.toUpperCase()} · ${fmtDuration(r.schedule.coldProofHours)} cold proof at ${fmtTemp(r.schedule.fridgeTempC, u)} · ${r.recipe.balls} × ${r.recipe.ballWeight} g`),
    isHouse ? h('div', {}, pill('House protocol', 'neutral')) : null,
    h(
      'div',
      { class: 'item-actions' },
      isActive
        ? h('button', { class: 'btn ghost small', onClick: () => go('protocol') }, icon('checklist'), 'Open protocol')
        : h('button', { class: 'btn small', onClick: () => { activateRecipe(r.id); toast(`${r.name} loaded`); } }, icon('play_arrow'), 'Load'),
      h('button', { class: 'btn ghost small', onClick: () => duplicate(ctx, r) }, icon('content_copy'), 'Duplicate'),
      h('button', { class: 'btn ghost small', onClick: () => download(recipeFileName(r), JSON.stringify(r, null, 2)) }, icon('download'), 'JSON'),
      h('button', { class: 'btn ghost small', onClick: async () => { const ok = await copyText(recipeLink(r)); toast(ok ? 'Link copied' : 'Could not copy'); } }, icon('link'), 'Share'),
      isHouse
        ? h('button', { class: 'btn ghost small', onClick: () => confirmDialog('Put the house protocol back exactly as shipped? Your edits to it are lost.', () => { restoreHouseRecipe(); toast('Restored'); }, 'Restore') }, icon('restart_alt'), 'Restore')
        : h('button', { class: 'btn ghost small', onClick: () => confirmDialog(`Delete ${r.name}? Bakes logged against it are kept.`, () => { deleteRecipe(r.id); toast('Deleted'); }, 'Delete') }, icon('delete'), 'Delete')
    )
  );
}

function duplicate(ctx, source) {
  const base = source || ctx.s.recipes.find((r) => r.id === ctx.s.current.recipeId);
  if (!base) return;
  const isActive = base.id === ctx.s.current.recipeId;
  const copy = deriveRecipe(base, { name: `${base.name} v2` });
  if (isActive) {
    // Carry across edits that have not been reflected back yet.
    copy.recipe = JSON.parse(JSON.stringify(ctx.s.current.recipe));
    copy.schedule = JSON.parse(JSON.stringify(ctx.s.current.schedule));
  }
  addRecipe(copy);
  activateRecipe(copy.id);
  toast('Duplicated and loaded. Change what you like.');
}

/* -------------------------------- inputs -------------------------------- */

function inputsCard(ctx) {
  const { s, u, S, c } = ctx;
  const r = s.current.recipe;
  const blend = c.blend;
  const lead = s.current.leadHours ?? leadHoursOf(S);
  const plan = suggestPlan(blend, {
    flours: r.flours,
    totalHours: lead,
    roomTempC: S.roomTempC,
    fridgeTempC: S.fridgeTempC,
    model: ctx.model,
  });
  const window = blend.ferment || [12, 96];

  // Tolerances are what a baker would notice, not what a float comparison
  // finds. Half a point of hydration or half an hour of proof is noise.
  const differences = [
    differs(r.hydrationPct, plan.hydration.recommended, 0.5) ? 'hydration' : null,
    differs(r.baseYeastPct, plan.idyPct, 0.005) ? 'yeast' : null,
    differs(S.coldProofHours, plan.schedule.coldProofHours, 0.5) ? 'cold proof' : null,
    differs(S.bigaColdHours, plan.schedule.bigaColdHours, 0.5) ? 'biga cold hold' : null,
    differs(S.bigaRestHours, plan.schedule.bigaRestHours, 0.5) ? 'biga rest' : null,
    differs(S.temperHours, plan.schedule.temperHours, 0.5) ? 'temper' : null,
  ].filter(Boolean);

  const flourRows = r.flours.map((entry, i) =>
    h(
      'div',
      { class: 'row tight', style: { alignItems: 'flex-end' } },
      h('div', { style: { flex: '1 1 200px' } }, selectField({
        label: i === 0 ? 'Flour' : `Flour ${i + 1}`,
        value: entry.id,
        groups: flourGroups(),
        onChange: (v) => editCurrent((cc) => { cc.recipe.flours[i].id = v; }),
      })),
      h('div', { style: { flex: '0 0 88px' } }, numberField({
        label: 'Share', value: entry.pct, min: 0, max: 100, suffix: '%',
        onInput: (v) => editCurrent((cc) => { cc.recipe.flours[i].pct = v ?? 0; }),
      })),
      r.flours.length > 1
        ? h('div', { style: { flex: '0 0 auto' } }, h('button', { class: 'btn ghost small', onClick: () => editCurrent((cc) => { cc.recipe.flours.splice(i, 1); }) }, icon('close')))
        : null
    )
  );

  return card(
    'Inputs',
    'What you have and what you want. Everything below this card is worked out from these.',
    textField({ label: 'Recipe name', value: s.current.title, onInput: (v) => editCurrent((cc) => { cc.title = v; }) }),
    ...flourRows,
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn ghost small', onClick: () => editCurrent((cc) => { cc.recipe.flours.push({ id: 'caputo-semola', pct: 10, stage: 'blend' }); }) }, icon('add'), 'Blend in another'),
      !blend.valid ? pill(`Shares total ${blend.total}%`, 'warn') : null
    ),
    h(
      'div',
      { class: 'row' },
      numberField({ label: 'Dough balls', value: r.balls, min: 1, max: 60, onInput: (v) => setRecipe({ balls: v ?? 1, frozenBalls: Math.min(r.frozenBalls, v ?? 1) }) }),
      numberField({ label: 'Ball weight', value: r.ballWeight, min: 100, max: 500, step: 5, suffix: 'g', onInput: (v) => setRecipe({ ballWeight: v ?? 250 }) }),
      numberField({ label: 'For the freezer', value: r.frozenBalls, min: 0, max: r.balls, onInput: (v) => setRecipe({ frozenBalls: Math.min(v ?? 0, r.balls) }) })
    ),
    h(
      'div',
      { class: 'row' },
      tempField({ label: 'Cold ferment temperature', valueC: S.fridgeTempC, unit: u, step: 1, hint: 'Whatever your fridge holds', onChange: (v) => setSchedule({ fridgeTempC: v, bigaFridgeTempC: v }) }),
      tempField({ label: 'Room temperature', valueC: S.roomTempC, unit: u, step: 1, hint: 'Where the biga rests and the balls temper', onChange: (v) => setSchedule({ roomTempC: v, bigaRoomTempC: v }) })
    ),
    sliderField({
      label: 'Total maturation',
      value: lead,
      min: Math.max(2, window[0]),
      max: Math.max(window[1], window[0] + 12),
      step: 1,
      format: (v) => `${v} h`,
      onInput: (v) => update((st) => { st.current.leadHours = v; }),
    }),
    h('p', { class: 'hint', style: { fontSize: '.72rem', marginTop: '-6px' } }, blend.fermentSourced ? `Published window for this flour is ${window[0]} to ${window[1]} hours.` : `No published window, so the ${blend.band?.label || 'W band'} guide applies: ${window[0]} to ${window[1]} hours.`),
    h('h3', { style: { fontSize: '.86rem', marginTop: '4px' } }, 'Suggested'),

    h(
      'div',
      { class: 'stats' },
      stat('Strength', blend.w ? `W ${blend.w}` : '—', blend.estimated ? 'estimated from protein' : 'published'),
      stat('Hydration', `${plan.hydration.recommended}%`, compare(r.hydrationPct, plan.hydration.recommended, 0.5, (v) => `${v}%`, `${plan.hydration.low} to ${plan.hydration.high}%`)),
      stat('Yeast', `${plan.idyPct.toFixed(3)}%`, compare(r.baseYeastPct, plan.idyPct, 0.005, (v) => `${v}%`, 'instant dry')),
      stat('Cold proof', fmtDuration(plan.schedule.coldProofHours), compare(S.coldProofHours, plan.schedule.coldProofHours, 0.5, fmtDuration, `at ${fmtTemp(S.fridgeTempC, u)}`))
    ),
    h('p', { class: 'note neutral' }, `${plan.band.label}. ${plan.band.blurb}${blend.estimated ? ' W is estimated from protein, not published.' : ''}`),
    h('p', { class: 'note neutral' }, differences.length
      ? `The recipe currently differs on ${listOf(differences)}. Recompute to take the suggestions, or leave it as it is.`
      : 'The recipe already matches these suggestions.'),
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn', disabled: !differences.length, onClick: () => { editCurrent((cc) => { Object.assign(cc.recipe, plan.recipePatch); Object.assign(cc.schedule, plan.schedule); }); toast('Recomputed. The protocol follows these numbers.'); } }, icon('auto_awesome'), 'Recompute from these inputs'),
      h('button', { class: 'btn ghost', onClick: () => go('protocol') }, icon('checklist'), 'See the protocol')
    )
  );
}

/** Only count a gap the baker would actually notice. */
function differs(current, suggested, tolerance) {
  return Math.abs(Number(current) - Number(suggested)) > tolerance;
}

/** Sub-line for a suggested value: what the recipe holds now, if it differs. */
function compare(current, suggested, tolerance, format, fallback) {
  return differs(current, suggested, tolerance) ? `now ${format(current)}` : fallback;
}

function listOf(items) {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/* -------------------------------- dough --------------------------------- */

function doughCard(ctx) {
  const { s, c } = ctx;
  const r = s.current.recipe;
  const range = hydrationRangeForW(c.blend.w, 2);

  return card(
    'Ratios',
    "Baker's percentages against total flour. Recomputing overwrites these; edit them afterwards to override.",
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
    'Phases',
    `Each phase reduces to fermentation units at your temperatures, so two schedules can be compared directly. Cold phases run at ${fmtTemp(S.fridgeTempC, u)}.`,
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
            pref.active ? h('td', { class: 'num' }, fmtGrams(row.biga)) : null,
            pref.active ? h('td', { class: 'num' }, fmtGrams(row.final)) : null
          )
        ))
      )
    ),
    pref.active
      ? h(
          'div',
          { class: 'stats' },
          stat('Biga', fmtGrams(c.weigh.bigaMass), `${pref.flourPct}% of flour at ${pref.hydrationPct}%`),
          stat('Bassinage', fmtGrams(c.weigh.water.bassinage), doseLabel(c)),
          stat('Salt wash', fmtGrams(c.weigh.water.saltWash), 'held back for the salt')
        )
      : null
  );
}

/** Doses are whole grams that add up, so say so exactly. */
function doseLabel(c) {
  const doses = c.weigh.water.doses;
  const equal = doses.every((d) => d === doses[0]);
  return equal ? `${doses.length} doses of ${doses[0]} g` : `doses of ${doses.join(', ')} g`;
}
