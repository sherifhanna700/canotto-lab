// Recipe library: the shipped starters, anything you build from a flour blend,
// and how each one has actually scored.

import { h, card, numberField, selectField, sliderField, chip, pill, stat, toast, icon, confirmDialog, textField } from '../lib/ui.js';
import { load, update, addRecipe, updateRecipe, deleteRecipe, activateRecipe, findRecipe } from '../lib/store.js';
import { recipeFromBlend, deriveRecipe, recipeRating, rankRecipes, SCORE_KEYS } from '../model/recipes.js';
import { blendStats, blendLabel, floursByCountry, findFlour } from '../model/flours.js';
import { STYLES, suggestPlan, defaultLeadHours } from '../model/advisor.js';
import { computeRecipe } from '../model/dough.js';
import { fmtDuration, fmtTemp, toDisplay, round } from '../model/units.js';
import { recipeLink, copyText } from '../lib/share.js';
import { ratingBadge, stars, tempField } from './common.js';
import { go } from '../app.js';

export default function renderRecipes(ctx) {
  return [builderCard(ctx), libraryCard(ctx)];
}

/* -------------------------------- builder ------------------------------- */

function draft(s) {
  if (!s.ui) s.ui = {};
  if (!s.ui.builder) {
    s.ui.builder = {
      flours: [{ id: 'caputo-cuoco', pct: 100, stage: 'blend' }],
      style: 'canotto',
      totalHours: null,
      name: '',
      balls: s.current.recipe.balls,
      ballWeight: s.current.recipe.ballWeight,
    };
  }
  return s.ui.builder;
}

function builderCard(ctx) {
  const { s, u, S } = ctx;
  const d = draft(s);
  const blend = blendStats(d.flours);
  const lead = d.totalHours ?? defaultLeadHours(blend);
  const plan = suggestPlan(blend, {
    flours: d.flours,
    style: d.style,
    totalHours: lead,
    roomTempC: S.roomTempC,
    fridgeTempC: S.fridgeTempC,
    model: ctx.model,
  });

  const groups = floursByCountry().map((g) => ({ label: g.label, options: g.list.map((f) => ({ value: f.id, label: `${f.brand} ${f.name}${f.w ? ` · W ${f.w}` : ''}` })) }));
  const setDraft = (patch) => update((st) => Object.assign(draft(st), patch));

  const flourRows = d.flours.map((entry, i) =>
    h(
      'div',
      { class: 'row tight', style: { alignItems: 'flex-end' } },
      h('div', { style: { flex: '1 1 220px' } }, selectField({
        label: i === 0 ? 'Flour' : `Flour ${i + 1}`,
        value: entry.id,
        groups,
        onChange: (v) => update((st) => { draft(st).flours[i].id = v; }),
      })),
      h('div', { style: { flex: '0 0 92px' } }, numberField({
        label: 'Share', value: entry.pct, min: 0, max: 100, suffix: '%',
        onInput: (v) => update((st) => { draft(st).flours[i].pct = v ?? 0; }),
      })),
      d.flours.length > 1
        ? h('button', { class: 'btn ghost small', onClick: () => update((st) => { draft(st).flours.splice(i, 1); }) }, icon('close'))
        : null
    )
  );

  const window = blend.ferment || [12, 96];

  return card(
    'Build a recipe from a flour',
    'Pick the flour, pick the style. The defaults come from the published strength and maturation window for that blend.',
    ...flourRows,
    h('div', { class: 'row tight' }, h('button', { class: 'btn ghost small', onClick: () => update((st) => { draft(st).flours.push({ id: 'caputo-semola', pct: 10, stage: 'blend' }); }) }, icon('add'), 'Blend in another flour')),
    h('div', { class: 'chip-row' }, ...STYLES.map((st) => chip(st.label, st.id === d.style, () => setDraft({ style: st.id })))),
    sliderField({
      label: 'Maturation',
      value: lead,
      min: Math.max(2, window[0]),
      max: Math.max(window[1], window[0] + 12),
      step: 1,
      format: (v) => `${v} h`,
      onInput: (v) => setDraft({ totalHours: v }),
    }),
    h('p', { class: 'hint', style: { fontSize: '.72rem', marginTop: '-6px' } }, blend.fermentSourced ? `Published window for this blend is ${window[0]} to ${window[1]} hours.` : `No published window, so the ${blend.band?.label || 'W band'} guide applies: ${window[0]} to ${window[1]} hours.`),
    h(
      'div',
      { class: 'row' },
      numberField({ label: 'Dough balls', value: d.balls, min: 1, max: 60, onInput: (v) => setDraft({ balls: v ?? 1 }) }),
      numberField({ label: 'Ball weight', value: d.ballWeight, min: 100, max: 500, step: 5, suffix: 'g', onInput: (v) => setDraft({ ballWeight: v ?? 250 }) })
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Strength', blend.w ? `W ${blend.w}` : '—', blend.estimated ? 'estimated' : 'published'),
      stat('Method', plan.method, plan.band.label),
      stat('Hydration', `${plan.hydration.recommended}%`, `${plan.hydration.low} to ${plan.hydration.high}%`),
      stat('Inoculation', `${plan.idyPct.toFixed(3)}%`, 'instant dry')
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
    h('details', { class: 'foldout' }, h('summary', {}, 'Why these numbers'), h('ul', { class: 'src-list' }, ...plan.rationale.map((t) => h('li', {}, t)))),
    h(
      'div',
      { class: 'row' },
      textField({ label: 'Name it', value: d.name, placeholder: `${blendLabel(d.flours)} ${d.style}`, onInput: (v) => setDraft({ name: v }) })
    ),
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn', onClick: () => saveDraft(ctx, d, lead) }, icon('bookmark_add'), 'Save this recipe'),
      h('button', { class: 'btn ghost', onClick: () => saveDraft(ctx, d, lead, true) }, icon('play_arrow'), 'Save and start baking it')
    )
  );
}

function saveDraft(ctx, d, lead, activate = false) {
  const blend = blendStats(d.flours);
  if (!blend.valid) {
    toast('Flour shares need to add up to 100%');
    return;
  }
  const recipe = recipeFromBlend(d.flours, {
    style: d.style,
    totalHours: lead,
    name: d.name || undefined,
    balls: d.balls,
    ballWeight: d.ballWeight,
    origin: 'user',
    roomTempC: ctx.S.roomTempC,
    fridgeTempC: ctx.S.fridgeTempC,
    model: ctx.model,
  });
  addRecipe(recipe);
  if (activate) {
    activateRecipe(recipe.id);
    toast(`${recipe.name} is now the active recipe`);
    go('protocol');
  } else {
    toast(`Saved ${recipe.name}`);
  }
}

/* -------------------------------- library ------------------------------- */

function libraryCard(ctx) {
  const { s, u } = ctx;
  const ranked = rankRecipes(s.recipes, s.bakes);

  return card(
    'Your recipes',
    `${s.recipes.length} saved. Ranked by how they have actually scored.`,
    h(
      'div',
      { class: 'list' },
      ...ranked.map(({ recipe, rating }) => recipeItem(ctx, recipe, rating))
    )
  );
}

function recipeItem(ctx, recipe, rating) {
  const { s, u } = ctx;
  const isActive = s.current.recipeId === recipe.id;
  const c = computeRecipe(recipe.recipe);
  const sched = recipe.schedule;

  return h(
    'div',
    { class: `item${isActive ? ' active' : ''}` },
    h(
      'div',
      { class: 'item-head' },
      h(
        'div',
        {},
        h('div', { class: 'item-title' }, recipe.name),
        h('div', { class: 'item-sub' }, `${c.flourLabel}${c.blend.w ? ` · W ${c.blend.w}` : ''}`)
      ),
      h('div', { style: { textAlign: 'right' } }, ratingBadge(rating), rating.average ? h('div', {}, stars(rating.average)) : null)
    ),
    h(
      'div',
      { class: 'item-sub' },
      `${recipe.recipe.hydrationPct}% hydration · ${recipe.recipe.method} · ${recipe.recipe.baseYeastPct}% ${recipe.recipe.yeastType.toUpperCase()} · ${fmtDuration(sched.coldProofHours)} cold proof at ${fmtTemp(sched.fridgeTempC, u)} · ${recipe.recipe.balls} × ${recipe.recipe.ballWeight} g`
    ),
    recipe.origin === 'house' ? h('div', {}, pill('House protocol', 'accent')) : recipe.origin === 'starter' ? h('div', {}, pill('Starter', 'neutral')) : null,
    h(
      'div',
      { class: 'item-actions' },
      isActive
        ? h('button', { class: 'btn small', onClick: () => go('protocol') }, icon('checklist'), 'Open protocol')
        : h('button', { class: 'btn small', onClick: () => { activateRecipe(recipe.id); toast(`${recipe.name} loaded`); } }, icon('play_arrow'), 'Make this one'),
      h('button', { class: 'btn ghost small', onClick: () => { const copy = deriveRecipe(recipe, { name: `${recipe.name} v2` }); addRecipe(copy); toast('Copied, ready to tweak'); } }, icon('content_copy'), 'Duplicate'),
      h('button', { class: 'btn ghost small', onClick: () => renameRecipe(recipe) }, icon('edit'), 'Rename'),
      h('button', { class: 'btn ghost small', onClick: async () => { const ok = await copyText(recipeLink(recipe)); toast(ok ? 'Share link copied' : 'Could not copy the link'); } }, icon('link'), 'Share link'),
      recipe.origin === 'house'
        ? null
        : h('button', { class: 'btn ghost small', onClick: () => confirmDialog(`Delete ${recipe.name}? Bakes logged against it are kept.`, () => { deleteRecipe(recipe.id); toast('Recipe deleted'); }, 'Delete') }, icon('delete'), 'Delete')
    ),
    rating.runs
      ? h(
          'div',
          { class: 'item-sub' },
          SCORE_KEYS.filter((k) => rating.perKey[k.key] !== null)
            .map((k) => `${k.label} ${rating.perKey[k.key]}`)
            .join(' · ')
        )
      : null
  );
}

function renameRecipe(recipe) {
  const name = prompt('Recipe name', recipe.name);
  if (name && name.trim()) {
    updateRecipe(recipe.id, { name: name.trim() });
    update((s) => {
      if (s.current.recipeId === recipe.id) s.current.title = name.trim();
    });
  }
}
