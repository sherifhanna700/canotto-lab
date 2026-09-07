// Lab: design a set of bakes that differ in exactly the ways you want, so the
// Compare screen has something clean to work with.

import { h, card, selectField, numberField, textField, chip, pill, stat, toast, icon, confirmDialog } from '../lib/ui.js';
import { update, addBake, snapshotBake, newId, deleteBake } from '../lib/store.js';
import { computeRecipe } from '../model/dough.js';
import { scheduleStages, DEFAULT_SCHEDULE } from '../model/protocol.js';
import { fermentUnits, yeastForFU } from '../model/ferment.js';
import { convertYeast } from '../model/dough.js';
import { fmtDuration, fmtTemp, toDisplay, fromDisplay, round } from '../model/units.js';
import { go } from '../app.js';

/** Variables an experiment can sweep, and where they live on a bake. */
const VARIABLES = [
  { key: 'hydrationPct', label: 'Hydration', unit: '%', on: 'recipe', step: 2, defaults: [68, 70, 72] },
  { key: 'coldProofHours', label: 'Cold proof hours', unit: 'h', on: 'schedule', step: 12, defaults: [24, 48, 72] },
  { key: 'fridgeTempC', label: 'Cold ferment temperature', unit: '°', on: 'schedule', temp: true, defaults: [1, 2.8, 5] },
  { key: 'baseYeastPct', label: 'Inoculation', unit: '%', on: 'recipe', step: 0.02, defaults: [0.08, 0.1, 0.12] },
  { key: 'prefermentHydrationPct', label: 'Preferment hydration', unit: '%', on: 'recipe', step: 5, defaults: [45, 50, 55] },
  { key: 'prefermentFlourPct', label: 'Preferment share of flour', unit: '%', on: 'recipe', step: 10, defaults: [50, 75, 100] },
  { key: 'saltPct', label: 'Salt', unit: '%', on: 'recipe', step: 0.2, defaults: [2.4, 2.8, 3.2] },
  { key: 'oilPct', label: 'Olive oil', unit: '%', on: 'recipe', step: 0.3, defaults: [0, 0.9, 1.8] },
  { key: 'temperHours', label: 'Counter temper', unit: 'h', on: 'schedule', step: 1, defaults: [2, 4, 6] },
  { key: 'bigaColdHours', label: 'Biga cold hold', unit: 'h', on: 'schedule', step: 4, defaults: [8, 17, 24] },
  { key: 'deckTempC', label: 'Floor temperature', unit: '°', on: 'schedule', temp: true, defaults: [430, 452, 470] },
  { key: 'bakeSec', label: 'Bake time', unit: 's', on: 'schedule', step: 10, defaults: [60, 75, 90] },
  { key: 'ballWeight', label: 'Ball weight', unit: 'g', on: 'recipe', step: 15, defaults: [250, 275, 300] },
];

function ui(s) {
  if (!s.ui) s.ui = {};
  if (!s.ui.lab) s.ui.lab = { a: 'hydrationPct', b: 'none', levelsA: null, levelsB: null, name: '' };
  return s.ui.lab;
}

const findVar = (k) => VARIABLES.find((v) => v.key === k) || null;

export default function renderLab(ctx) {
  return [designCard(ctx), plannedCard(ctx)];
}

function levelsFor(cfg, which, ctx) {
  const v = findVar(cfg[which]);
  if (!v) return [];
  const stored = cfg[which === 'a' ? 'levelsA' : 'levelsB'];
  if (Array.isArray(stored) && stored.length) return stored;
  return v.defaults;
}

function designCard(ctx) {
  const { s, u } = ctx;
  const cfg = ui(s);
  const varA = findVar(cfg.a);
  const varB = findVar(cfg.b);
  const levelsA = levelsFor(cfg, 'a', ctx);
  const levelsB = varB ? levelsFor(cfg, 'b', ctx) : [null];
  const combos = levelsA.length * levelsB.length;

  const opts = [{ value: 'none', label: 'Nothing' }, ...VARIABLES.map((v) => ({ value: v.key, label: v.label }))];

  return card(
    'Design an experiment',
    'Pick one or two variables and the values you want to try. Everything else is held at the current recipe.',
    h(
      'div',
      { class: 'row' },
      selectField({ label: 'Vary this', value: cfg.a, options: opts.slice(1), onChange: (v) => update((st) => { const c = ui(st); c.a = v; c.levelsA = null; }) }),
      selectField({ label: 'And this', value: cfg.b, options: opts, onChange: (v) => update((st) => { const c = ui(st); c.b = v; c.levelsB = null; }) })
    ),
    levelEditor(ctx, varA, levelsA, 'levelsA'),
    varB ? levelEditor(ctx, varB, levelsB, 'levelsB') : null,
    h(
      'div',
      { class: 'stats' },
      stat('Bakes to run', String(combos), varB ? `${levelsA.length} × ${levelsB.length} grid` : `${levelsA.length} levels`),
      stat('Dough balls needed', String(combos * s.current.recipe.balls), `${s.current.recipe.balls} per bake`),
      stat('Held constant', `${s.current.title}`, 'the current recipe')
    ),
    combos > 12 ? h('p', { class: 'note warn' }, `${combos} bakes is a lot of dough. Two variables at three levels each is usually enough to see a direction.`) : null,
    h('p', { class: 'note neutral' }, 'Each combination is filed as a planned bake. Bake them, score them, and the Compare screen reads the grid straight off.'),
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn', onClick: () => generate(ctx, varA, levelsA, varB, levelsB) }, icon('science'), `Create ${combos} planned bakes`)
    )
  );
}

function levelEditor(ctx, variable, levels, storeKey) {
  const { u } = ctx;
  if (!variable) return null;
  const disp = (v) => (variable.temp ? round(toDisplay(v, u), 1) : v);
  const store = (v) => (variable.temp ? fromDisplay(v, u) : v);

  return h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label' }, `${variable.label} values${variable.temp ? ` (°${u})` : variable.unit ? ` (${variable.unit})` : ''}`),
    h(
      'div',
      { class: 'row tight' },
      ...levels.map((lv, i) =>
        h('div', { style: { flex: '0 0 96px' } }, numberField({
          label: `#${i + 1}`,
          value: disp(lv),
          step: variable.step || 1,
          onInput: (v) => update((st) => {
            const c = ui(st);
            const cur = [...(c[storeKey] && c[storeKey].length ? c[storeKey] : levels)];
            cur[i] = v === null ? cur[i] : store(v);
            c[storeKey] = cur;
          }),
        }))
      ),
      h('button', { class: 'btn ghost small', onClick: () => update((st) => { const c = ui(st); const cur = [...(c[storeKey]?.length ? c[storeKey] : levels)]; cur.push(cur[cur.length - 1]); c[storeKey] = cur; }) }, icon('add')),
      levels.length > 2 ? h('button', { class: 'btn ghost small', onClick: () => update((st) => { const c = ui(st); const cur = [...(c[storeKey]?.length ? c[storeKey] : levels)]; cur.pop(); c[storeKey] = cur; }) }, icon('remove')) : null
    )
  );
}

function generate(ctx, varA, levelsA, varB, levelsB) {
  const { s } = ctx;
  const runId = newId('x');
  let n = 0;
  update((st) => {
    for (const a of levelsA) {
      for (const b of levelsB) {
        const bake = snapshotBake(st, { planned: true, experimentId: runId });
        applyLevel(bake, varA, a);
        if (varB && b !== null) applyLevel(bake, varB, b);
        bake.id = newId();
        bake.title = `${st.current.title} · ${labelFor(varA, a, ctx)}${varB ? ` · ${labelFor(varB, b, ctx)}` : ''}`;
        bake.scores = {};
        bake.actuals = { ...bake.actuals };
        // Re-solve the inoculation so timing changes stay comparable.
        st.bakes.unshift(bake);
        n += 1;
      }
    }
  });
  toast(`${n} planned bakes created`);
  go('log');
}

function applyLevel(bake, variable, value) {
  if (!variable) return;
  const target = variable.on === 'recipe' ? bake.recipe : bake.schedule;
  target[variable.key] = value;
  if (variable.key === 'fridgeTempC') bake.schedule.bigaFridgeTempC = value;
}

function labelFor(variable, value, ctx) {
  if (!variable) return '';
  if (variable.temp) return `${round(toDisplay(value, ctx.u), 0)}°${ctx.u} ${variable.label.toLowerCase()}`;
  return `${value}${variable.unit || ''} ${variable.label.toLowerCase()}`;
}

/* ------------------------------ planned list ---------------------------- */

function plannedCard(ctx) {
  const { s, u } = ctx;
  const planned = s.bakes.filter((b) => b.planned);
  if (!planned.length) {
    return card('Planned bakes', 'None queued.', h('div', { class: 'empty' }, h('span', { class: 'msym' }, 'science'), h('p', {}, 'Nothing planned. Design an experiment above and the grid appears here.')));
  }

  const groups = new Map();
  for (const b of planned) {
    const k = b.experimentId || 'ungrouped';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(b);
  }

  return card(
    'Planned bakes',
    `${planned.length} queued. Load one to bake it, and it stops being a plan.`,
    ...[...groups.entries()].map(([k, list]) =>
      h(
        'div',
        { class: 'list' },
        h('div', { class: 'spread' }, h('strong', { style: { fontSize: '.82rem' } }, `Experiment ${k.slice(1, 7)}`), h('button', { class: 'btn ghost small', onClick: () => confirmDialog(`Delete all ${list.length} planned bakes in this experiment?`, () => { list.forEach((b) => deleteBake(b.id)); toast('Experiment cleared'); }, 'Delete') }, icon('delete'), 'Clear')),
        ...list.map((b) =>
          h(
            'div',
            { class: 'item' },
            h('div', { class: 'item-head' }, h('div', { class: 'item-title' }, b.title), pill('Planned', 'accent')),
            h('div', { class: 'item-sub' }, `${b.recipe.hydrationPct}% hydration · ${fmtDuration(b.schedule.coldProofHours)} at ${fmtTemp(b.schedule.fridgeTempC, u)} · ${b.recipe.baseYeastPct}% yeast · ${b.schedule.bakeSec}s bake`),
            h(
              'div',
              { class: 'item-actions' },
              h('button', { class: 'btn small', onClick: () => loadPlanned(b) }, icon('play_arrow'), 'Bake this one'),
              h('button', { class: 'btn ghost small', onClick: () => { deleteBake(b.id); toast('Removed'); } }, icon('delete'), 'Remove')
            )
          )
        )
      )
    )
  );
}

function loadPlanned(b) {
  update((s) => {
    s.current.recipe = JSON.parse(JSON.stringify(b.recipe));
    s.current.schedule = JSON.parse(JSON.stringify(b.schedule));
    s.current.title = b.title;
    s.current.done = [];
    s.current.notes = '';
  });
  toast('Loaded. Work the protocol, then file it from the Bake screen.');
  go('protocol');
}
