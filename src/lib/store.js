// Local-first persistence.
//
// Everything lives in localStorage behind this one module. Nothing else in the
// app touches storage directly, so swapping in a cloud backend later means
// reimplementing `load` and `save`, not rewriting the views.

import { DEFAULT_RECIPE } from '../model/dough.js?v=181f24c3';
import { DEFAULT_SCHEDULE } from '../model/protocol.js?v=181f24c3';
import { DEFAULT_MODEL } from '../model/ferment.js?v=181f24c3';
import { starterRecipes, houseRecipe } from '../model/recipes.js?v=181f24c3';
import { DEFAULT_EQUIPMENT } from '../model/equipment.js?v=181f24c3';

const KEY = 'canotto-lab/v1';
const LEGACY = { steps: 'canotto_master_steps', frozen: 'canotto_frozen_count', metrics: 'canotto_step_metrics' };

export const EMPTY_ACTUALS = {
  ambientTempC: null,
  humidityPct: null,
  bigaWaterTempC: null,
  fdtC: null,
  fridgeTempC: null,
  coldHoldHours: null,
  coreTempC: null,
  deckTempC: null,
  domeTempC: null,
  bakeSec: null,
};

export const EMPTY_SCORES = { canotto: null, honeycomb: null, blistering: null, flavour: null, base: null };

export function defaultState() {
  return {
    version: 1,
    settings: { unit: 'F', model: { ...DEFAULT_MODEL }, autoCalibrate: true },
    recipes: starterRecipes(),
    current: {
      recipeId: 'house-canotto',
      title: 'Contemporary Canotto',
      equipment: { ...DEFAULT_EQUIPMENT },
      recipe: { ...DEFAULT_RECIPE },
      schedule: { ...DEFAULT_SCHEDULE },
      launchISO: nextFridayEvening(),
      done: [],
      actuals: { ...EMPTY_ACTUALS },
      scores: { ...EMPTY_SCORES },
      notes: '',
    },
    bakes: [],
    experiments: [],
  };
}

function nextFridayEvening() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(17);
  const delta = (5 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return toLocalISO(d);
}

/** datetime-local wants a local-time string, not a UTC one. */
export function toLocalISO(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let cache = null;

export function load() {
  if (cache) return cache;
  let parsed = null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) parsed = JSON.parse(raw);
  } catch (e) {
    console.warn('Could not read saved data, starting fresh.', e);
  }
  const base = defaultState();
  cache = parsed ? mergeState(base, parsed) : migrateLegacy(base);

  const fixed = repairValues(cache.current);
  if (fixed.length) {
    console.warn('Canotto Lab: repaired impossible values in the current session:', fixed.join(', '));
    save();
  }
  return cache;
}

/** Deep-merge saved data over the defaults so new fields appear on old saves. */
function mergeState(base, saved) {
  return {
    ...base,
    ...saved,
    settings: { ...base.settings, ...saved.settings, model: { ...base.settings.model, ...(saved.settings?.model || {}) } },
    current: {
      ...base.current,
      ...saved.current,
      recipe: { ...base.current.recipe, ...(saved.current?.recipe || {}) },
      schedule: { ...base.current.schedule, ...(saved.current?.schedule || {}) },
      equipment: { ...DEFAULT_EQUIPMENT, ...(saved.current?.equipment || {}) },
      actuals: { ...EMPTY_ACTUALS, ...(saved.current?.actuals || {}) },
      scores: { ...EMPTY_SCORES, ...(saved.current?.scores || {}) },
      done: Array.isArray(saved.current?.done) ? saved.current.done : [],
    },
    recipes: reconcileRecipes(saved, base),
    bakes: Array.isArray(saved.bakes) ? saved.bakes : [],
    experiments: Array.isArray(saved.experiments) ? saved.experiments : [],
  };
}

/**
 * Ranges a real kitchen can hold. Anything outside these was not typed on
 * purpose.
 *
 * An earlier bug rebuilt the screen on every keystroke, which threw away every
 * character after the first, so typing 68 stored 6. That is fixed, but the
 * impossible values it wrote are still sitting in people's saved data, and
 * defaults only apply to a fresh install. These are repaired on load.
 */
const PLAUSIBLE_SCHEDULE = {
  fridgeTempC: [-4, 15],
  bigaFridgeTempC: [-4, 15],
  roomTempC: [8, 38],
  bigaRoomTempC: [8, 38],
  benchTempC: [8, 38],
  ddtC: [12, 34],
  deckTempC: [120, 600],
  domeTempC: [120, 700],
  bigaRestHours: [0, 36],
  bigaColdHours: [0, 72],
  coldProofHours: [0.5, 240],
  temperHours: [0, 16],
  preheatMin: [5, 300],
  bakeSec: [10, 1200],
  freezeFlashMin: [10, 600],
  thawFridgeHours: [0, 120],
  frozenTemperHours: [0, 24],
};

const PLAUSIBLE_RECIPE = {
  hydrationPct: [40, 100],
  saltPct: [0, 8],
  oilPct: [0, 12],
  sugarPct: [0, 15],
  maltPct: [0, 5],
  baseYeastPct: [0, 5],
  freezeBufferPct: [0, 1],
  prefermentFlourPct: [0, 100],
  prefermentHydrationPct: [20, 130],
  balls: [1, 200],
  ballWeight: [50, 2000],
  wastePct: [0, 50],
};

function repairInto(obj, ranges, defaults) {
  const fixed = [];
  if (!obj) return fixed;
  for (const [key, [lo, hi]] of Object.entries(ranges)) {
    const v = Number(obj[key]);
    if (!Number.isFinite(v) || v < lo || v > hi) {
      fixed.push(`${key}=${obj[key]}`);
      obj[key] = defaults[key];
    }
  }
  return fixed;
}

/** Repair a saved recipe or session in place, and say what was corrected. */
export function repairValues(holder) {
  const fixed = [
    ...repairInto(holder.schedule, PLAUSIBLE_SCHEDULE, DEFAULT_SCHEDULE),
    ...repairInto(holder.recipe, PLAUSIBLE_RECIPE, DEFAULT_RECIPE),
  ];
  return fixed;
}

/**
 * Only the house protocol ships as a preset. Earlier builds shipped several,
 * and they survive in saved data, so they are cleared out here. A starter the
 * baker actually used is kept and becomes theirs rather than being deleted.
 */
function reconcileRecipes(saved, base) {
  const house = base.recipes.find((r) => r.origin === 'house');
  const list = Array.isArray(saved.recipes) ? saved.recipes : [];
  if (!list.length) return base.recipes;

  const usedIds = new Set((saved.bakes || []).map((b) => b.recipeId).filter(Boolean));
  const kept = list
    .filter((r) => r && r.id && (r.origin !== 'starter' || usedIds.has(r.id)))
    .map((r) => {
      const n = normaliseRecipe(r.origin === 'starter' ? { ...r, origin: 'user' } : r);
      const fixed = repairValues(n);
      if (fixed.length) console.warn(`Canotto Lab: repaired impossible values in "${n.name}":`, fixed.join(', '));
      return n;
    });

  if (!kept.some((r) => r.origin === 'house')) kept.push(house);
  return kept;
}

/**
 * Fill in anything a recipe is missing.
 * Recipes now arrive from downloaded JSON, share links and older versions of
 * the app, so a missing field must not be able to take a screen down.
 */
export function normaliseRecipe(r) {
  return {
    origin: 'user',
    name: 'Untitled recipe',
    createdAt: new Date().toISOString(),
    notes: '',
    plan: null,
    ...r,
    recipe: { ...DEFAULT_RECIPE, ...(r.recipe || {}) },
    schedule: { ...DEFAULT_SCHEDULE, ...(r.schedule || {}) },
  };
}

/** Pull across anything the original single-page protocol saved. */
function migrateLegacy(base) {
  try {
    const steps = JSON.parse(localStorage.getItem(LEGACY.steps) || 'null');
    if (Array.isArray(steps)) base.current.done = steps;
    const frozen = parseInt(localStorage.getItem(LEGACY.frozen) || '', 10);
    if (Number.isFinite(frozen)) base.current.recipe.frozenBalls = frozen;
    const m = JSON.parse(localStorage.getItem(LEGACY.metrics) || 'null');
    if (m) {
      const f = (v) => (v === undefined || v === null || v === '' ? null : ((Number(v) - 32) * 5) / 9);
      const n = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
      base.current.actuals = {
        ...base.current.actuals,
        bigaWaterTempC: f(m.bigaWaterTemp),
        fdtC: f(m.fdt),
        fridgeTempC: f(m.fridgeTemp),
        coldHoldHours: n(m.proofHrs),
        coreTempC: f(m.coreTemp),
        deckTempC: f(m.deckTemp),
        domeTempC: f(m.domeTemp),
        bakeSec: n(m.bakeSec),
      };
      if (m.notes) base.current.notes = m.notes;
    }
  } catch (e) {
    console.warn('Legacy import skipped.', e);
  }
  return base;
}

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('Save failed, storage may be full.', e);
    return false;
  }
  return true;
}

/** Mutate state through here so views re-render and the write is persisted. */
export function update(fn) {
  const s = load();
  fn(s);
  save();
  listeners.forEach((l) => l(s));
  return s;
}

export function replaceState(next) {
  cache = mergeState(defaultState(), next);
  save();
  listeners.forEach((l) => l(cache));
  return cache;
}

export function resetAll() {
  cache = defaultState();
  save();
  listeners.forEach((l) => l(cache));
  return cache;
}

/* -------------------------------- recipes ------------------------------- */

const now = () => new Date().toISOString();

export function addRecipe(recipe) {
  const safe = { ...normaliseRecipe(recipe), updatedAt: now() };
  update((s) => {
    s.recipes.unshift(safe);
  });
  return safe;
}

export function updateRecipe(id, patch) {
  return update((s) => {
    const i = s.recipes.findIndex((r) => r.id === id);
    if (i >= 0) s.recipes[i] = { ...s.recipes[i], ...patch, updatedAt: now() };
  });
}

export function deleteRecipe(id) {
  return update((s) => {
    s.recipes = s.recipes.filter((r) => r.id !== id);
    if (!s.recipes.length) s.recipes = [houseRecipe()];
    if (s.current.recipeId === id) loadRecipeInto(s, s.recipes[0]);
  });
}

export function findRecipe(s, id) {
  return s.recipes.find((r) => r.id === id) || null;
}

/** Make a recipe the one the protocol, calculator and bake screens work on. */
export function loadRecipeInto(s, recipe) {
  s.current.recipeId = recipe.id;
  s.current.title = recipe.name;
  s.current.recipe = JSON.parse(JSON.stringify(recipe.recipe));
  s.current.schedule = JSON.parse(JSON.stringify(recipe.schedule));
  // The maturation slider belongs to the recipe, not to the session.
  s.current.leadHours = recipe.plan?.totalHours ?? null;
  s.current.done = [];
  s.current.actuals = { ...EMPTY_ACTUALS };
  s.current.scores = { ...EMPTY_SCORES };
  s.current.notes = '';
  return s;
}

export function activateRecipe(id) {
  return update((s) => {
    const r = findRecipe(s, id);
    if (r) loadRecipeInto(s, r);
  });
}

/**
 * Change the dough you are working on. The edit is mirrored onto the saved
 * recipe immediately, so there is no separate save step and no way for the
 * name in the list to drift from the name in the field.
 */
export function editCurrent(fn) {
  return update((s) => {
    fn(s.current);
    const i = s.recipes.findIndex((r) => r.id === s.current.recipeId);
    if (i < 0) return;
    s.recipes[i] = {
      ...s.recipes[i],
      name: s.current.title,
      recipe: JSON.parse(JSON.stringify(s.current.recipe)),
      schedule: JSON.parse(JSON.stringify(s.current.schedule)),
      updatedAt: new Date().toISOString(),
    };
  });
}

/** Put the house protocol back exactly as shipped. */
export function restoreHouseRecipe() {
  const fresh = houseRecipe();
  return update((s) => {
    const i = s.recipes.findIndex((r) => r.id === fresh.id);
    if (i >= 0) s.recipes[i] = fresh;
    else s.recipes.unshift(fresh);
    loadRecipeInto(s, fresh);
  });
}

/* ------------------------------ bake records ---------------------------- */

export function newId() {
  return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Freeze the current session into an immutable bake record. */
export function snapshotBake(s, extra = {}) {
  const c = s.current;
  return {
    id: newId(),
    createdAt: new Date().toISOString(),
    bakedAt: c.launchISO,
    recipeId: c.recipeId || null,
    equipment: { ...c.equipment },
    recipeName: c.title || 'Untitled bake',
    title: c.title || 'Untitled bake',
    tags: [],
    planned: false,
    recipe: JSON.parse(JSON.stringify(c.recipe)),
    schedule: JSON.parse(JSON.stringify(c.schedule)),
    actuals: { ...c.actuals },
    scores: { ...c.scores },
    issues: [],
    notes: c.notes || '',
    photo: null,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

export function addBake(bake) {
  return update((s) => {
    s.bakes.unshift({ ...bake, updatedAt: now() });
  });
}

export function updateBake(id, patch) {
  return update((s) => {
    const i = s.bakes.findIndex((b) => b.id === id);
    if (i >= 0) s.bakes[i] = { ...s.bakes[i], ...patch, updatedAt: now() };
  });
}

/** Replace the synced collections with what came back from the cloud merge. */
export function applySync({ recipes, bakes }) {
  return update((s) => {
    if (Array.isArray(recipes) && recipes.length) s.recipes = recipes;
    if (Array.isArray(bakes)) s.bakes = bakes;
  });
}

export function deleteBake(id) {
  return update((s) => {
    s.bakes = s.bakes.filter((b) => b.id !== id);
  });
}

/* ------------------------------ import/export --------------------------- */

/**
 * Exports are self-describing. Every file names the schema it follows, so
 * somebody handed one of these can read it without asking what it is.
 * Schemas live at https://sherifhanna700.github.io/canotto-lab/schema/
 */
export const SCHEMA_BASE = 'https://sherifhanna700.github.io/canotto-lab/schema';

function envelope(schemaFile, body) {
  return JSON.stringify(
    {
      $schema: `${SCHEMA_BASE}/${schemaFile}`,
      app: 'Canotto Lab',
      exportedAt: new Date().toISOString(),
      ...body,
    },
    null,
    2
  );
}

/** Everything: recipes, bakes and settings. */
export function exportJSON() {
  const s = load();
  return envelope('export.schema.json', { version: s.version, recipes: s.recipes, bakes: s.bakes, settings: s.settings });
}

/** The recipe library on its own. */
export function exportRecipesJSON() {
  return envelope('recipes.schema.json', { recipes: load().recipes });
}

/** The bake log on its own. */
export function exportBakesJSON({ includePlanned = false } = {}) {
  const bakes = load().bakes.filter((b) => includePlanned || !b.planned);
  return envelope('log.schema.json', { bakes });
}

/** One recipe, for sharing as a file. */
export function exportRecipeJSON(recipe) {
  return JSON.stringify({ $schema: `${SCHEMA_BASE}/recipe.schema.json`, ...recipe }, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('That file does not look like Canotto Lab data.');
  return replaceState(parsed);
}

/** Merge bakes from another export without touching the current session. */
export function mergeBakes(text) {
  const parsed = JSON.parse(text);
  const incoming = Array.isArray(parsed) ? parsed : parsed.bakes;
  if (!Array.isArray(incoming)) throw new Error('No bakes found in that file.');
  let added = 0;
  update((s) => {
    const have = new Set(s.bakes.map((b) => b.id));
    for (const b of incoming) {
      if (!b || have.has(b.id)) continue;
      s.bakes.push(b);
      added += 1;
    }
    s.bakes.sort((a, b) => String(b.bakedAt || '').localeCompare(String(a.bakedAt || '')));
  });
  return added;
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
