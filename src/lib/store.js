// Local-first persistence.
//
// Everything lives in localStorage behind this one module. Nothing else in the
// app touches storage directly, so swapping in a cloud backend later means
// reimplementing `load` and `save`, not rewriting the views.

import { DEFAULT_RECIPE } from '../model/dough.js?v=2313eb03';
import { DEFAULT_SCHEDULE, orderStamps } from '../model/protocol.js?v=2313eb03';
import { DEFAULT_MODEL } from '../model/ferment.js?v=2313eb03';
import { starterRecipes, houseRecipe } from '../model/recipes.js?v=2313eb03';
import { DEFAULT_EQUIPMENT } from '../model/equipment.js?v=2313eb03';

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
  const recipes = starterRecipes();
  const house = recipes.find((r) => r.origin === 'house');
  return {
    version: 1,
    settings: { unit: 'F', model: { ...DEFAULT_MODEL }, autoCalibrate: true },
    recipes,
    current: {
      /*
       * The session's own id, which the bake keeps when it is filed.
       *
       * Photographs are attached to a bake by id, and they are taken during
       * the bake rather than after it, so the session needs an id from the
       * start. Filing hands this one to the record and mints a fresh one, so a
       * picture taken at the bench is already on the right bake and nothing is
       * re-attached. A session loaded from storage keeps the id it was saved
       * with; only a session that has never had one gets a new one.
       */
      id: newId(),
      // Taken from the shipped recipe rather than restated. Stating it twice
      // meant the draft and the recipe disagreed from the first load, so the
      // app believed there were unsaved changes before anything was touched.
      recipeId: house.id,
      title: house.name,
      equipment: { ...DEFAULT_EQUIPMENT },
      recipe: JSON.parse(JSON.stringify(house.recipe)),
      schedule: JSON.parse(JSON.stringify(house.schedule)),
      launchISO: nextFridayEvening(),
      done: [],
      // Wall clock, one entry per checked step. Absolute instants, never gaps:
      // a gap cannot be corrected without silently moving everything after it.
      doneAt: {},
      actuals: { ...EMPTY_ACTUALS },
      scores: { ...EMPTY_SCORES },
      notes: '',
    },
    bakes: [],

    /*
     * What photographs exist, and which bake each belongs to. Metadata only:
     * the bytes are in IndexedDB under the same id, and each one is its own
     * file in Drive. Keeping the description here means it travels in the same
     * document as everything else and merges the same way.
     */
    photos: [],
    /*
     * Photographs deliberately deleted. Without this a delete would not stick:
     * the other device still lists the photograph, the merge is a union, and it
     * would arrive back on the next sync along with its bytes.
     */
    photosRemoved: [],
    /*
     * Records deliberately deleted, so a sync does not hand them back.
     *
     * A merge keeps both sides, which is right for an edit made in two places
     * and wrong for a deletion: with no record of it, the other device simply
     * returns what was thrown away. Photographs needed this first, and having
     * it only there made deleting a bake incoherent, since its pictures went
     * permanently while the bake itself came back without them.
     */
    bakesRemoved: [],
    recipesRemoved: [],
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

/*
 * Keys left behind by the usage count, which no longer exists.
 *
 * Removing a feature does not remove what it wrote to someone's browser. A
 * person who once turned counting off would carry that flag for good, and the
 * privacy page's list of what is stored would be wrong for exactly the people
 * who cared enough to switch it off. So they are cleared on load, once.
 */
const ORPHANED_KEYS = ['canotto-lab/device', 'canotto-lab/counted-on', 'canotto-lab/no-count'];

export function forgetRemovedFeatures() {
  try {
    for (const key of ORPHANED_KEYS) localStorage.removeItem(key);
  } catch {
    // A browser refusing storage has nothing to clear.
  }
}

// Once, when the module loads, rather than inside load(), which returns early
// from a cache and would skip it for the whole of a session.
forgetRemovedFeatures();

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

  // If the shipped protocol was rescued, stay on the baker's own copy of it
  // rather than silently switching them to the restored reference.
  if (rescuedId) {
    const mine = cache.recipes.find((r) => r.id === rescuedId);
    if (mine) loadRecipeInto(cache, mine);
    rescuedId = null;
    save();
  }

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
      id: saved.current?.id || base.current.id,
      recipe: { ...base.current.recipe, ...(saved.current?.recipe || {}) },
      schedule: { ...base.current.schedule, ...(saved.current?.schedule || {}) },
      equipment: { ...DEFAULT_EQUIPMENT, ...(saved.current?.equipment || {}) },
      actuals: { ...EMPTY_ACTUALS, ...(saved.current?.actuals || {}) },
      scores: { ...EMPTY_SCORES, ...(saved.current?.scores || {}) },
      done: Array.isArray(saved.current?.done) ? saved.current.done : [],
      doneAt: sanitiseDoneAt(saved.current?.doneAt),
    },
    recipes: reconcileRecipes(saved, base),
    bakes: Array.isArray(saved.bakes) ? saved.bakes : [],
    photos: Array.isArray(saved.photos) ? saved.photos : [],
    photosRemoved: Array.isArray(saved.photosRemoved) ? saved.photosRemoved : [],
    bakesRemoved: Array.isArray(saved.bakesRemoved) ? saved.bakesRemoved : [],
    recipesRemoved: Array.isArray(saved.recipesRemoved) ? saved.recipesRemoved : [],
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
  return splitEditedHouse(kept, house);
}

/**
 * Rescue a house protocol that was edited in place.
 *
 * An earlier version let edits land directly on the shipped protocol, so a
 * baker who renamed it and changed its numbers ended up with no reference left
 * and no copy of their own either, just one recipe wearing the wrong label.
 * Their work is kept, as a recipe of their own, and the reference is put back.
 */
let rescuedId = null;

function splitEditedHouse(recipes, pristine) {
  const i = recipes.findIndex((r) => r.origin === 'house');
  if (i < 0) return recipes;
  const theirs = recipes[i];
  const same =
    theirs.name === pristine.name &&
    JSON.stringify(theirs.recipe) === JSON.stringify(pristine.recipe) &&
    JSON.stringify(theirs.schedule) === JSON.stringify(pristine.schedule);
  if (same) return recipes;

  const rescued = {
    ...theirs,
    id: `${theirs.id}-yours`,
    name: theirs.name === pristine.name ? `${theirs.name.replace(' (house)', '')} (my version)` : theirs.name,
    origin: 'user',
    derivedFrom: pristine.id,
    updatedAt: new Date().toISOString(),
  };
  console.warn(`Canotto Lab: the shipped protocol had been edited. Your changes are kept as "${rescued.name}" and the reference is restored.`);

  rescuedId = rescued.id;
  const out = [...recipes];
  out[i] = pristine;
  out.unshift(rescued);
  return out;
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
/**
 * A fingerprint of the working session, used to notice that it changed.
 *
 * The stamp itself is left out, or every save would look like a change and
 * the session would appear newer than it is on every device that opened it.
 */
const sessionShape = (current) => {
  const { updatedAt, ...rest } = current || {};
  return JSON.stringify(rest);
};

export function update(fn, { stamp = true } = {}) {
  const s = load();
  const before = sessionShape(s.current);
  const modelBefore = JSON.stringify(s.settings?.model || null);
  fn(s);
  /*
   * Stamp the fermentation model when it changes.
   *
   * It is edited from half a dozen controls on the setup screen, so stamping
   * here rather than at each of them means it cannot be forgotten at one. Sync
   * needs the stamp: the constants are the arithmetic the whole app runs on,
   * and two devices holding different ones compute different plans from the
   * same recipe, so they have to agree and something has to say which is the
   * later word.
   */
  if (stamp && s.settings && JSON.stringify(s.settings.model || null) !== modelBefore) {
    s.settings.modelUpdatedAt = now();
  }
  /*
   * Stamp the working session when it actually changes.
   *
   * Sync needs to know which device's half-finished bake is the later one, and
   * the only honest answer is the one that was touched last. Doing it here
   * rather than at each of the several dozen places that edit a schedule, tick
   * a step or record a temperature means it cannot be forgotten at one of
   * them. A fresh session has no stamp at all, so it always loses to a real
   * one: opening the app on a new device must not overwrite a bake in progress
   * with an empty one.
   */
  if (stamp && s.current && sessionShape(s.current) !== before) s.current.updatedAt = now();
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
    s.recipesRemoved = (s.recipesRemoved || []).filter((id) => id !== safe.id);
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
    s.recipesRemoved = [...new Set([...(s.recipesRemoved || []), id])];
    if (!s.recipes.length) s.recipes = [houseRecipe()];
    if (s.current.recipeId === id) loadRecipeInto(s, s.recipes[0]);
  });
}

export function findRecipe(s, id) {
  return s.recipes.find((r) => r.id === id) || null;
}

/** Make a recipe the one the protocol, calculator and bake screens work on. */
/**
 * Recorded times come back from storage as whatever was there. Anything that
 * is not a plausible instant is dropped rather than trusted: a bad timestamp
 * would silently misreport a phase duration, which is worse than none.
 */
export function sanitiseDoneAt(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  const floor = Date.parse('2020-01-01T00:00:00Z');
  for (const [id, v] of Object.entries(raw)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > floor) out[id] = n;
  }
  /*
   * And in the order the steps happen in. The app cannot write a time that
   * runs backwards, but a session synced from a device on an older version,
   * or a hand-edited export, can arrive holding one, and a phase of negative
   * length is wrong everywhere it is then used.
   */
  return orderStamps(out);
}

export function loadRecipeInto(s, recipe) {
  s.current.recipeId = recipe.id;
  s.current.title = recipe.name;
  s.current.recipe = JSON.parse(JSON.stringify(recipe.recipe));
  s.current.schedule = JSON.parse(JSON.stringify(recipe.schedule));
  // The maturation slider belongs to the recipe, not to the session.
  s.current.leadHours = recipe.plan?.totalHours ?? null;
  s.current.done = [];
  s.current.doneAt = {};
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

/** A copy of a recipe, taking whatever the working draft currently holds. */
function forkOf(source, current, name) {
  return {
    ...JSON.parse(JSON.stringify(source)),
    id: newId('r'),
    name,
    origin: 'user',
    derivedFrom: source.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    recipe: JSON.parse(JSON.stringify(current.recipe)),
    schedule: JSON.parse(JSON.stringify(current.schedule)),
  };
}

/**
 * Change the working draft.
 *
 * Edits land here and nowhere else. The stored recipe is not touched until the
 * draft is saved, which is what makes it safe to open a recipe, try something,
 * and walk away without having changed it.
 */
export function editCurrent(fn) {
  return update((s) => {
    fn(s.current);
  });
}

/** Fields of the draft that belong to the recipe rather than to the session. */
function draftOf(holder) {
  return JSON.stringify({
    name: holder.title ?? holder.name,
    recipe: holder.recipe,
    schedule: holder.schedule,
  });
}

/** Does the draft differ from the recipe it was opened from? */
export function isDirty(s = load()) {
  const saved = s.recipes.find((r) => r.id === s.current.recipeId);
  if (!saved) return false;
  return draftOf(s.current) !== draftOf(saved);
}

/**
 * Write the draft onto its recipe.
 *
 * The shipped protocol cannot be written over: it is the reference every other
 * schedule is measured against. Saving on top of it produces a copy instead,
 * and the copy becomes the one being worked on.
 */
export function saveCurrent() {
  let result = { saved: false, forked: false, name: '' };
  update((s) => {
    const i = s.recipes.findIndex((r) => r.id === s.current.recipeId);
    if (i < 0) return;
    const target = s.recipes[i];

    if (target.origin === 'house') {
      const name = s.current.title === target.name
        ? target.name.replace('(house)', '(my version)')
        : s.current.title;
      const fork = forkOf(target, s.current, name);
      s.recipes.unshift(fork);
      s.current.recipeId = fork.id;
      s.current.title = fork.name;
      result = { saved: true, forked: true, name: fork.name };
      return;
    }

    s.recipes[i] = {
      ...target,
      name: s.current.title,
      recipe: JSON.parse(JSON.stringify(s.current.recipe)),
      schedule: JSON.parse(JSON.stringify(s.current.schedule)),
      updatedAt: new Date().toISOString(),
    };
    result = { saved: true, forked: false, name: s.current.title };
  });
  return result;
}

/** Throw the draft away and go back to what is stored. */
export function discardCurrent() {
  return update((s) => {
    const saved = s.recipes.find((r) => r.id === s.current.recipeId);
    if (saved) loadRecipeInto(s, saved);
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

/**
 * A fresh id, prefixed by what it names.
 *
 * The prefix was always passed and never used, so recipes have been carrying
 * ids that announce themselves as bakes. Ids are opaque to the app, but they
 * are not opaque to somebody reading a shared file and working out what a
 * recipeId points at. Ids already issued keep whatever they were given.
 */
export function newId(prefix = 'b') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Freeze the current session into an immutable bake record. */
export function snapshotBake(s, extra = {}) {
  const c = s.current;
  return {
    // The session's id, so its photographs are already on this bake.
    id: c.id || newId(),
    createdAt: new Date().toISOString(),
    bakedAt: c.launchISO,
    recipeId: c.recipeId || null,
    equipment: { ...c.equipment },
    recipeName: c.title || 'Untitled bake',
    title: c.title || 'Untitled bake',
    planned: false,
    recipe: JSON.parse(JSON.stringify(c.recipe)),
    schedule: JSON.parse(JSON.stringify(c.schedule)),
    // The wall clock times the steps were ticked at. What the schedule asked
    // for is already above; this is what the dough actually got.
    doneAt: { ...(c.doneAt || {}) },
    actuals: { ...c.actuals },
    scores: { ...c.scores },
    issues: [],
    notes: c.notes || '',
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

/**
 * Clear the session and give it a fresh id.
 *
 * Called after filing, where the old id has just gone to the bake record and
 * its photographs with it, and on a deliberate reset, where the caller deletes
 * the photographs first. Either way the new session starts with no pictures of
 * its own, because nothing points at the new id yet.
 */
export function startNewSession() {
  return update((s) => {
    s.current.id = newId();
    s.current.done = [];
    s.current.doneAt = {};
    s.current.actuals = { ...EMPTY_ACTUALS };
    s.current.scores = { ...EMPTY_SCORES };
    s.current.notes = '';
  });
}

export function addBake(bake) {
  return update((s) => {
    s.bakes.unshift({ ...bake, updatedAt: now() });
    // Filing under an id that was once deleted is not a deletion any more.
    s.bakesRemoved = (s.bakesRemoved || []).filter((id) => id !== bake.id);
  });
}

export function updateBake(id, patch) {
  return update((s) => {
    const i = s.bakes.findIndex((b) => b.id === id);
    if (i >= 0) s.bakes[i] = { ...s.bakes[i], ...patch, updatedAt: now() };
  });
}

/** Replace the synced collections with what came back from a merge. */
export function applySync({ recipes, bakes, current, photos, photosRemoved, bakesRemoved, recipesRemoved, settings }) {
  return update((s) => {
    if (Array.isArray(recipes) && recipes.length) s.recipes = recipes;
    if (Array.isArray(bakes)) s.bakes = bakes;
    if (Array.isArray(photos)) s.photos = photos;
    if (Array.isArray(photosRemoved)) s.photosRemoved = photosRemoved;
    if (Array.isArray(bakesRemoved)) s.bakesRemoved = bakesRemoved;
    if (Array.isArray(recipesRemoved)) s.recipesRemoved = recipesRemoved;
    /*
     * The fermentation model travels; the display unit does not.
     *
     * They sat together in settings and neither was applied, so two devices
     * could hold different Q10 constants and compute different plans from the
     * same recipe, with nothing to say which was right. The constants are the
     * arithmetic and have to agree. Whether a phone shows Celsius is that
     * phone's business, and pushing it across would fight the baker.
     */
    if (settings?.model) s.settings = { ...s.settings, model: { ...s.settings.model, ...settings.model } };
    if (current) {
      /*
       * A session replaced by another device's brings its photographs across.
       *
       * Pictures are attached by id, so if that device's session wins, the
       * ones taken here point at a session that no longer exists: not deleted,
       * but not reachable from any screen either. Both sessions are the same
       * bake in progress, so the pictures move to the one that survived. An
       * extra picture on the right bake can be removed; one that is merely
       * invisible cannot.
       */
      const mine = s.current?.id;
      if (mine && current.id && mine !== current.id) {
        s.photos = (s.photos || []).map((p) => (p.bakeId === mine ? { ...p, bakeId: current.id } : p));
      }
      // Already decided by the merge; this only writes the winner down. Passed
      // through mergeState so a session from an older version still lands with
      // every field the app expects.
      s.current = mergeState(defaultState(), { current }).current;
    }
  }, {
    /*
     * Writing down the result of a sync is not the baker touching anything, so
     * it must not restamp the session. Restamping would give this device a
     * time later than the copy just written to Drive, so the two would
     * disagree the moment they were made to agree, and a session pulled from
     * another device would come back looking like this one's own work.
     */
    stamp: false,
  });
}

/* -------------------------------- photos --------------------------------- */

export const photosForBake = (s, bakeId) =>
  (s.photos || []).filter((p) => p.bakeId === bakeId).sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));

export function addPhotoRecord(record) {
  return update((s) => {
    s.photos = [...(s.photos || []).filter((p) => p.id !== record.id), record];
    // Adding back something previously deleted should not stay deleted.
    s.photosRemoved = (s.photosRemoved || []).filter((id) => id !== record.id);
  });
}

export function removePhotoRecord(id) {
  return update((s) => {
    s.photos = (s.photos || []).filter((p) => p.id !== id);
    s.photosRemoved = [...new Set([...(s.photosRemoved || []), id])];
  });
}

export function removePhotoRecordsFor(bakeId) {
  const ids = photosForBake(load(), bakeId).map((p) => p.id);
  update((s) => {
    s.photos = (s.photos || []).filter((p) => p.bakeId !== bakeId);
    s.photosRemoved = [...new Set([...(s.photosRemoved || []), ...ids])];
  });
  return ids;
}

export function deleteBake(id) {
  return update((s) => {
    s.bakes = s.bakes.filter((b) => b.id !== id);
    s.bakesRemoved = [...new Set([...(s.bakesRemoved || []), id])];
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
  return exportStateJSON(load());
}

/**
 * The same document, built from a state that is not the stored one. Sync needs
 * this: what goes to Drive is the merge of both sides, which does not exist in
 * storage until it comes back and is applied.
 */
/*
 * Keys that belong to this screen rather than to the data: which bake is open,
 * which fault category is showing. They are not the baker's and do not travel.
 */
const LOCAL_ONLY = new Set(['ui']);

export function exportStateJSON(state) {
  /*
   * Anything this version does not recognise is carried through rather than
   * dropped. The schema allows a document to hold more than it describes, so a
   * file written by a later version must survive being opened, synced and
   * written back by this one, or the older device silently strips the newer
   * one's work on the way past.
   */
  const known = new Set(['version', 'recipes', 'bakes', 'settings', 'photos', 'photosRemoved',
    'bakesRemoved', 'recipesRemoved', 'current']);
  const passthrough = {};
  for (const [k, v] of Object.entries(state || {})) {
    if (!known.has(k) && !LOCAL_ONLY.has(k)) passthrough[k] = v;
  }

  return envelope('export.schema.json', {
    ...passthrough,
    version: state.version,
    recipes: state.recipes,
    bakes: state.bakes,
    settings: state.settings,
    // What pictures exist and what they belong to. The pictures themselves are
    // separate files alongside this one, named by these ids.
    photos: state.photos || [],
    photosRemoved: state.photosRemoved || [],
    // Deliberate deletions, so the other device does not return them.
    bakesRemoved: state.bakesRemoved || [],
    recipesRemoved: state.recipesRemoved || [],
    // The bake in progress: which recipe is loaded, what is ticked, and when
    // each step really happened. Without it, syncing mid-bake carries the
    // recipe but not the evening.
    current: state.current,
  });
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

/** What kind of Canotto Lab file this is, judged by what is in it. */
export function kindOf(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const named = String(parsed.$schema || '').split('/').pop();
  if (named === 'export.schema.json') return 'backup';
  if (named === 'recipes.schema.json') return 'recipes';
  if (named === 'log.schema.json') return 'log';
  if (named === 'recipe.schema.json') return 'recipe';
  if (named === 'bake.schema.json') return 'bake';
  /*
   * Judged by shape when the header is missing or wrong, because a file that
   * has been through somebody's editor should still open. A backup is the one
   * that must not be guessed at, since opening it is the destructive case.
   */
  if (Array.isArray(parsed.recipes) && Array.isArray(parsed.bakes)) return 'backup';
  if (Array.isArray(parsed.recipes)) return 'recipes';
  if (Array.isArray(parsed.bakes)) return 'log';
  if (parsed.scores || parsed.doneAt || parsed.bakedAt) return 'bake';
  if (parsed.recipe && parsed.schedule) return 'recipe';
  return null;
}

/**
 * Open a file somebody shared, without throwing away what is already here.
 *
 * Recipes are meant to travel: craft one, send it, have it followed, edited
 * and sent back. That only works if opening one adds it to the library rather
 * than replacing the library with it, which is what the only way in used to
 * do. A full backup still replaces everything, because that is what a backup
 * is for, but it is the one kind that says so first.
 *
 * A shared copy of something already here is added alongside rather than over
 * the top: two people's versions of the same recipe are two recipes, and which
 * is right is not this function's to decide.
 */
export function openShared(text) {
  const parsed = JSON.parse(text);
  const kind = kindOf(parsed);
  if (!kind) throw new Error('That file does not look like Canotto Lab data.');
  if (kind === 'backup') return { kind, needsConfirm: true };

  const taken = [];
  if (kind === 'recipe' || kind === 'recipes') {
    const incoming = kind === 'recipe' ? [parsed] : parsed.recipes;
    for (const r of incoming || []) {
      if (!r || typeof r !== 'object') continue;
      const clash = load().recipes.some((mine) => mine.id === r.id);
      const copy = normaliseRecipe(clash
        ? { ...r, id: newId('r'), derivedFrom: r.id, name: `${r.name || 'Recipe'} (shared)` }
        : { ...r, id: r.id || newId('r') });
      addRecipe(copy);
      taken.push(copy.name);
    }
    return { kind, added: taken.length, names: taken };
  }

  const incoming = kind === 'bake' ? [parsed] : parsed.bakes;
  let added = 0;
  update((s) => {
    const have = new Set(s.bakes.map((b) => b.id));
    for (const b of incoming || []) {
      if (!b || typeof b !== 'object') continue;
      // A shared run keeps its own identity unless it collides with one here.
      const bake = have.has(b.id) ? { ...b, id: newId(), derivedFrom: b.id } : b;
      if (!bake.id) continue;
      s.bakes.push(bake);
      have.add(bake.id);
      added += 1;
    }
    s.bakes.sort((a, b) => String(b.bakedAt || '').localeCompare(String(a.bakedAt || '')));
  });
  return { kind, added };
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
