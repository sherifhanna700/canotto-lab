// Recipe: which dough you are making, and all its numbers in one place.
//
// Only the house protocol ships as a preset. Everything else is built from
// scratch by picking a flour, or duplicated from something that already exists.
// Edits save straight onto the selected recipe, so there is no save step and
// the name in the list is always the name in the field.

import { h, card, numberField, selectField, sliderField, textField, pill, stat, toast, icon, confirmDialog } from '../lib/ui.js?v=82c337ea';
import { update, editCurrent, addRecipe, deleteRecipe, activateRecipe, restoreHouseRecipe, download, exportRecipesJSON, exportRecipeJSON } from '../lib/store.js?v=82c337ea';
import { ingredientRows, YEAST_LABEL, effectiveYeastPct, convertYeast, computeRecipe } from '../model/dough.js?v=82c337ea';
import { floursByCountry, blendStats, blendLabel, hydrationRangeForW } from '../model/flours.js?v=82c337ea';
import { scheduleStages, solveSchedule } from '../model/protocol.js?v=82c337ea';
import { fermentUnits, maturationUnits, stageBreakdown, yeastForFU, doughTempFrom, doughTempVerdict, frictionFrom } from '../model/ferment.js?v=82c337ea';
import { suggestPlan, reviewPlan, defaultLeadHours, coldProofWindow, coldProofVerdict, hoursForMaturation, HOUSE_REFERENCE } from '../model/advisor.js?v=82c337ea';
import { recipeFromBlend, deriveRecipe, recipeRating, overallScore } from '../model/recipes.js?v=82c337ea';
import { fmtGrams, fmtTemp, fmtTempDelta, fmtDuration, round } from '../model/units.js?v=82c337ea';
import { recipeLink, copyText } from '../lib/share.js?v=82c337ea';
import { findMixer, mixerLabel } from '../model/equipment.js?v=82c337ea';
import { tempField, tempDeltaField, ratingBadge, stars, } from './common.js?v=82c337ea';
import { go } from '../app.js?v=82c337ea';

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
        onInput: (v) => update((st) => { draft(st).flours[i].pct = v; }),
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
      numberField({ label: 'Dough balls', value: d.balls, min: 1, max: 60, onInput: (v) => setDraft({ balls: v }) }),
      numberField({ label: 'Ball weight', value: d.ballWeight, min: 100, max: 500, step: 5, suffix: 'g', onInput: (v) => setDraft({ ballWeight: v }) }),
      numberField({ label: 'For the freezer', value: d.frozenBalls, min: 0, max: d.balls, onInput: (v) => setDraft({ frozenBalls: Math.min(v, d.balls) }) })
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
      h('button', { class: 'btn ghost small', onClick: () => download('canotto-recipes.json', exportRecipesJSON()) }, icon('download'), 'Download all')
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
      h('button', { class: 'btn ghost small', onClick: () => download(recipeFileName(r), exportRecipeJSON(r)) }, icon('download'), 'JSON'),
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

  /*
   * Two different questions, and conflating them was a bug.
   *
   * "Would recompute change anything" decides whether the button is live, and
   * it has to be exact. Changing the fridge by a degree moves the suggested
   * yeast by about 3%, which a fixed tolerance of 0.005 against a value near
   * 0.1 swallowed entirely, so the button sat dead while the inputs moved.
   *
   * "Is the difference worth naming" decides what the note says, and that one
   * wants a human tolerance so the shipped recipe is not accused of differing
   * on six things that round to the same numbers.
   */
  const wouldWrite = {
    hydrationPct: [r.hydrationPct, plan.hydration.recommended],
    baseYeastPct: [r.baseYeastPct, round(plan.idyPct, 3)],
    bigaRestHours: [S.bigaRestHours, plan.schedule.bigaRestHours],
    bigaColdHours: [S.bigaColdHours, plan.schedule.bigaColdHours],
    coldProofHours: [S.coldProofHours, plan.schedule.coldProofHours],
    temperHours: [S.temperHours, plan.schedule.temperHours],
  };
  const changes = Object.values(wouldWrite).filter(([now, next]) => Math.abs(Number(now) - Number(next)) > 1e-9);

  // Yeast is compared proportionally: 0.003 is noise on 3% but not on 0.1%.
  const yeastTolerance = Math.max(0.001, plan.idyPct * 0.02);
  const differences = [
    differs(r.hydrationPct, plan.hydration.recommended, 0.5) ? 'hydration' : null,
    differs(r.baseYeastPct, plan.idyPct, yeastTolerance) ? 'yeast' : null,
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
        onInput: (v) => editCurrent((cc) => { cc.recipe.flours[i].pct = v; }),
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
      numberField({ label: 'Dough balls', value: r.balls, min: 1, max: 60, onInput: (v) => setRecipe({ balls: v, frozenBalls: Math.min(r.frozenBalls, v) }) }),
      numberField({ label: 'Ball weight', value: r.ballWeight, min: 100, max: 500, step: 5, suffix: 'g', onInput: (v) => setRecipe({ ballWeight: v }) }),
      numberField({ label: 'For the freezer', value: r.frozenBalls, min: 0, max: r.balls, onInput: (v) => setRecipe({ frozenBalls: Math.min(v, r.balls) }) })
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
      stat('Yeast', `${plan.idyPct.toFixed(3)}%`, compare(r.baseYeastPct, plan.idyPct, yeastTolerance, (v) => `${v}%`, 'instant dry')),
      stat('Cold proof', fmtDuration(plan.schedule.coldProofHours), compare(S.coldProofHours, plan.schedule.coldProofHours, 0.5, fmtDuration, `at ${fmtTemp(S.fridgeTempC, u)}`))
    ),
    h('p', { class: 'note neutral' }, `${plan.band.label}. ${plan.band.blurb}${blend.estimated ? ' W is estimated from protein, not published.' : ''}`),
    h('p', { class: 'note neutral' }, noteFor(changes, differences)),
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn', disabled: !changes.length, onClick: () => { editCurrent((cc) => { Object.assign(cc.recipe, plan.recipePatch); Object.assign(cc.schedule, plan.schedule); }); toast('Recomputed. The protocol follows these numbers.'); } }, icon('auto_awesome'), 'Recompute from these inputs'),
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

function noteFor(changes, differences) {
  if (!changes.length) return 'The recipe already matches these suggestions.';
  if (!differences.length) return 'Recomputing would fine-tune the timings and the inoculation. The differences are small.';
  return `The recipe currently differs on ${listOf(differences)}. Recompute to take the suggestions, or leave it as it is.`;
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
      numberField({ label: 'Salt', value: r.saltPct, min: 0, max: 5, step: 0.1, suffix: '%', onInput: (v) => setRecipe({ saltPct: v }) }),
      numberField({ label: 'Olive oil', value: r.oilPct, min: 0, max: 5, step: 0.1, suffix: '%', onInput: (v) => setRecipe({ oilPct: v }) }),
      numberField({ label: 'Biga flour', value: r.prefermentFlourPct, min: 10, max: 100, step: 5, suffix: '%', hint: 'Share of total flour in the biga', onInput: (v) => setRecipe({ prefermentFlourPct: v }) }),
      numberField({ label: 'Biga hydration', value: r.prefermentHydrationPct, min: 35, max: 60, step: 1, suffix: '%', hint: 'Traditionally 44 to 45%', onInput: (v) => setRecipe({ prefermentHydrationPct: v }) })
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
      numberField({ label: 'Inoculation', value: r.baseYeastPct, min: 0, max: 3, step: 0.005, suffix: '%', onInput: (v) => setRecipe({ baseYeastPct: v }) }),
      numberField({ label: 'Freeze buffer', value: r.freezeBufferPct, min: 0, max: 0.2, step: 0.005, suffix: '%', hint: 'Added only when balls go to the freezer', onInput: (v) => setRecipe({ freezeBufferPct: v }) })
    ),
    ...c.warnings.map((w) => h('p', { class: 'note warn' }, w))
  );
}

/* ------------------------------ time and temp --------------------------- */

/** The bake this app scales yeast from: the baker's own best, or the house. */
function referenceFor(s) {
  const scored = s.bakes
    .filter((b) => !b.planned && overallScore(b.scores) !== null && Number(b.recipe?.baseYeastPct) > 0)
    .sort((a, b) => overallScore(b.scores) - overallScore(a.scores))[0];
  if (!scored) return HOUSE_REFERENCE;
  const fu = fermentUnits(scheduleStages(scored.schedule));
  const idy = convertYeast(scored.recipe.baseYeastPct, scored.recipe.yeastType, 'idy');
  if (!(fu > 0) || !(idy > 0)) return HOUSE_REFERENCE;
  return { label: `your best bake, ${scored.title || scored.recipeName}`, yeastPct: idy, fu };
}

function timingCard(ctx) {
  const { s, u, S, c } = ctx;
  const stages = scheduleStages(S);
  const fu = fermentUnits(stages, ctx.model);
  const mu = maturationUnits(stages, ctx.model);
  const idy = convertYeast(s.current.recipe.baseYeastPct, s.current.recipe.yeastType, 'idy');
  const reference = referenceFor(s);
  const review = reviewPlan({ blend: c.blend, stages, schedule: S, idyPct: idy, reference, model: ctx.model });
  const window = review.window;
  const verdict = coldProofVerdict(window);
  const need = yeastForFU(fu, { refYeastPct: reference.yeastPct, refFU: reference.fu });

  return card(
    'Phases',
    `How long each phase runs, and what that adds up to at your temperatures. Cold phases run at ${fmtTemp(S.fridgeTempC, u)}.`,
    h(
      'div',
      { class: 'row' },
      numberField({ label: 'Biga ambient rest', value: S.bigaRestHours, min: 0, max: 24, step: 0.25, suffix: 'h', onInput: (v) => setSchedule({ bigaRestHours: v }) }),
      numberField({ label: 'Biga cold hold', value: S.bigaColdHours, min: 0, max: 48, step: 1, suffix: 'h', onInput: (v) => setSchedule({ bigaColdHours: v }) }),
      numberField({
        label: 'Cold proof',
        value: S.coldProofHours,
        min: 1,
        max: 240,
        step: 1,
        suffix: 'h',
        // The one field with a right answer, so it carries its own target.
        hint: proofTarget(review.window),
        hintTone: review.window ? coldProofVerdict(review.window).tone : undefined,
        onInput: (v) => setSchedule({ coldProofHours: v }),
      }),
      numberField({ label: 'Counter temper', value: S.temperHours, min: 0, max: 12, step: 0.25, suffix: 'h', onInput: (v) => setSchedule({ temperHours: v }) })
    ),

    h(
      'div',
      { class: 'stats' },
      stat('Maturation', `${mu.toFixed(0)} MU`, window ? `of about ${window.ceiling} this flour can take` : 'no strength figure for this flour'),
      stat('Fermentation', `${fu.toFixed(1)} FU`, 'yeast work')
    ),

    window
      ? h(
          'div',
          {},
          h('p', { class: `note ${verdict.tone}` }, coldProofWords(verdict, window, c, u)),
          verdict.key !== 'on'
            ? h('div', { class: 'row tight' }, h('button', { class: 'btn tonal small', onClick: () => { setSchedule({ coldProofHours: Math.round(window.ideal) }); toast(`Cold proof set to ${Math.round(window.ideal)} hours`); } }, icon('schedule'), `Set it to ${Math.round(window.ideal)} h`))
            : null
        )
      : null,

    // The maturation and yeast notes are both said better above, in the
    // verdict banner and the yeast paragraph. Only what neither covers is left.
    ...review.notes.filter((n) => n.key !== 'yeast' && !(window && n.key === 'maturation')).map((n) => h('p', { class: `note ${n.tone}` }, n.text)),

    Number.isFinite(need)
      ? h(
          'div',
          {},
          // One threshold for the sentence and the button, so the app never
          // says the yeast is fine while offering to change it.
          h('p', { class: `note ${yeastIsOff(idy, need) ? 'warn' : 'neutral'}` }, `At ${idy.toFixed(3)}% instant dry before any freeze buffer, this schedule carries ${describeYeast(idy, need)}. Scaled from ${reference.label}, which used ${reference.yeastPct.toFixed(3)}% across ${reference.fu.toFixed(1)} FU.`),
          yeastIsOff(idy, need)
            ? h('div', { class: 'row tight' }, h('button', { class: 'btn tonal small', onClick: () => { setRecipe({ baseYeastPct: round(convertYeast(need, 'idy', s.current.recipe.yeastType), 3) }); toast('Yeast scaled to this schedule'); } }, icon('auto_fix_high'), `Scale yeast to ${need.toFixed(3)}%`))
            : null
        )
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
          h('thead', {}, h('tr', {}, h('th', {}, 'Phase'), h('th', { class: 'num' }, 'Hours'), h('th', { class: 'num' }, 'Temp'), h('th', { class: 'num' }, 'Yeast'), h('th', { class: 'num' }, 'FU'), h('th', { class: 'num' }, 'MU'))),
          h('tbody', {}, ...stageBreakdown(stages, ctx.model).map((b) =>
            h('tr', {}, h('td', {}, b.name), h('td', { class: 'num' }, fmtDuration(b.hours)), h('td', { class: 'num' }, fmtTemp(b.tempC, u)), h('td', { class: 'num' }, `${(b.rate * 100).toFixed(0)}%`), h('td', { class: 'num' }, b.fu.toFixed(1)), h('td', { class: 'num' }, b.mu.toFixed(1)))
          ))
        )
      ),
      h('p', { class: 'hint', style: { fontSize: '.72rem' } }, 'Two clocks run at once. Yeast makes the gas and nearly stops in the cold. The flour\u2019s own enzymes soften the gluten and free sugar, and they keep going at fridge temperature, which is what a cold proof is for and what eventually wears the dough out.')
    ),
    waterFoldout(ctx)
  );
}

/**
 * What the Cold proof field is aiming at, said on the field itself. The
 * fridge temperature is already in the card's own description, so it is left
 * out here to keep this to one line on a phone.
 */
function proofTarget(w) {
  if (!w) return 'No strength figure for this flour, so no target';
  const range = w.crowded ? `up to ${Math.round(w.high)} h` : `${Math.round(w.low)}\u2013${Math.round(w.high)} h`;
  return `${coldProofVerdict(w).label} \u00b7 wants ${range}`;
}

/** Far enough from the scaled figure to be worth saying and worth a button. */
function yeastIsOff(have, need) {
  const ratio = have / need;
  return ratio > 1.25 || ratio < 0.8;
}

function describeYeast(have, need) {
  const ratio = have / need;
  if (ratio > 1.25) return `${(ratio * 100 - 100).toFixed(0)}% more yeast than the timing needs`;
  if (ratio < 0.8) return `${(100 - ratio * 100).toFixed(0)}% less yeast than the timing needs`;
  return 'about the right amount of yeast for the timing';
}

function coldProofWords(verdict, w, c, u) {
  const flour = c.flourLabel;
  const at = fmtTemp(w.fridgeTempC, u);
  const range = w.crowded ? `up to ${Math.round(w.high)} hours` : `${Math.round(w.low)} to ${Math.round(w.high)} hours`;
  if (w.crowded && verdict.key.endsWith('long')) {
    return `The biga and the bench already use ${w.spentElsewhere.toFixed(0)} of the ${w.ceiling} maturation units ${flour} can take, which leaves about ${Math.round(w.high)} hours for the fridge at ${at}. This flour is not strong enough to carry a biga this long and a cold proof of ${fmtDuration(w.actual)} as well. Shorten the biga cold hold, or use a stronger flour.`;
  }
  switch (verdict.key) {
    case 'far-long':
    case 'long':
      return `At ${at}, ${flour} wants ${range} in the cold. Yours is ${fmtDuration(w.actual)}, which is longer than the gluten will take. Protease keeps working in the fridge, so the dough will be slack and tear when you open it. Shorten it, or run the fridge colder.`;
    case 'far-short':
    case 'short':
      return `At ${at}, ${flour} wants ${range} in the cold. Yours is ${fmtDuration(w.actual)}, which is short of what this flour can take. The dough will be stiffer to open and plainer to taste. There is room to go longer.`;
    default:
      return `At ${at}, ${flour} wants ${range} in the cold and yours is ${fmtDuration(w.actual)}. A warmer fridge would shorten that window, a colder one would stretch it.`;
  }
}

function waterFoldout(ctx) {
  const { s, u, S, E, c } = ctx;
  const w = s.current.water || {};
  const mixer = findMixer(E.mixerId);
  const flourTempC = w.flourTempC ?? S.roomTempC;
  const frictionC = w.frictionC ?? mixer.frictionC;
  const waterTempC = w.mixWaterTempC ?? 1;

  const landsAtC = doughTempFrom({
    weigh: c.weigh,
    prefermentTempC: S.fridgeTempC,
    flourTempC,
    waterTempC,
    frictionC,
  });
  const stopC = S.ddtC + 1.7;
  const verdict = doughTempVerdict(landsAtC, S.ddtC, stopC);

  // A dough already measured is worth more than any published friction figure.
  const measured = [...s.bakes]
    .filter((b) => !b.planned && Number.isFinite(b.actuals?.fdtC))
    .sort((a, b) => String(b.bakedAt).localeCompare(String(a.bakedAt)))[0];
  const measuredFriction = measured
    ? frictionFrom({
        weigh: computeRecipe(measured.recipe).weigh,
        prefermentTempC: measured.schedule.fridgeTempC,
        flourTempC: measured.actuals.bigaWaterTempC ?? measured.schedule.roomTempC,
        waterTempC,
        measuredDoughC: measured.actuals.fdtC,
      })
    : null;

  return h(
    'details',
    { class: 'foldout' },
    h('summary', {}, 'Mix water and where the dough lands'),
    h(
      'div',
      { class: 'row' },
      tempField({ label: 'Mix water', valueC: waterTempC, unit: u, step: 1, hint: 'Ice water keeps the mix cold while the gluten builds', onChange: (v) => update((st) => { st.current.water = { ...st.current.water, mixWaterTempC: v }; }) }),
      tempField({ label: 'Flour temperature', valueC: flourTempC, unit: u, onChange: (v) => update((st) => { st.current.water = { ...st.current.water, flourTempC: v }; }) }),
      tempDeltaField({ label: 'Friction allowance', valueC: frictionC, unit: u, step: 1, hint: `${mixerLabel(E)} starts at ${fmtTempDelta(mixer.frictionC, u)}`, onChange: (v) => update((st) => { st.current.water = { ...st.current.water, frictionC: v }; }) })
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Dough lands at', fmtTemp(landsAtC, u, 1), verdict.label),
      stat('Target', fmtTemp(S.ddtC, u), 'a ceiling, not something to reach for'),
      stat('Hard stop', fmtTemp(stopC, u), 'stop mixing here whatever the clock says')
    ),
    h('p', { class: `note ${verdict.tone}` }, verdictWords(verdict, landsAtC, S, u, c)),
    measuredFriction !== null && Number.isFinite(measuredFriction)
      ? h(
          'div',
          {},
          h(
            'p',
            { class: 'note neutral' },
            `Your last logged bake finished at ${fmtTemp(measured.actuals.fdtC, u, 1)}. Worked back, your mixer added ${fmtTempDelta(measuredFriction, u)}.` +
              (measuredFriction > 16
                ? ' That is above the 8 to 16 °C usually published for a mixer, so either yours works the dough unusually hard, or the biga had warmed before it went in. Either way your own figure beats the published one.'
                : measuredFriction < 1
                  ? ' That is lower than published figures for any mixer, which usually means the dough was measured some time after mixing stopped.'
                  : '')
          ),
          h('button', { class: 'btn tonal small', onClick: () => { update((st) => { st.current.water = { ...st.current.water, frictionC: measuredFriction }; }); toast('Friction taken from your own dough'); } }, icon('tune'), 'Use my measured friction')
        )
      : h('p', { class: 'note neutral' }, 'Record the final dough temperature on the Protocol screen once, and this stops relying on a published figure and starts using your own mixer.'),
    h(
      'p',
      { class: 'hint', style: { fontSize: '.72rem' } },
      `Heat balance over the whole mix: ${fmtGrams(c.weigh.bigaMass)} of biga at ${fmtTemp(S.fridgeTempC, u)}, ${fmtGrams(c.weigh.water.final)} of water, and whatever the mixer adds. Not the three-factor rule, which treats every component as the same mass and the same heat, and is wrong whenever the preferment dominates the dough.`
    )
  );
}

function verdictWords(verdict, landsAtC, S, u, c) {
  const cold = `The biga is ${fmtGrams(c.weigh.bigaMass)} of ${fmtGrams(c.totalDough)} and it comes out of the fridge, so it sets the starting temperature and the mixer is the only thing that raises it.`;
  switch (verdict.key) {
    case 'over':
      return `This finishes at ${fmtTemp(landsAtC, u, 1)}, past the stop. Colder water, or a shorter mix. ${cold}`;
    case 'warm':
      return `This finishes at ${fmtTemp(landsAtC, u, 1)}, above the target but under the stop. Colder water will bring it down. ${cold}`;
    case 'cold':
      return `This finishes at ${fmtTemp(landsAtC, u, 1)}, well under the target. That is normal for a fridge-cold biga and is not a fault: a cold finish protects the gluten, and the cold proof does the fermenting. Warmer water would raise it, at the cost of the thing the cold biga was for. ${cold}`;
    default:
      return `This finishes at ${fmtTemp(landsAtC, u, 1)}, inside the window and under the stop. ${cold}`;
  }
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
