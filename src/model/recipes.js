// Named recipes.
//
// A Recipe is a saved definition: flours, ratios and schedule for one biga
// canotto dough. A Bake is one run of it, with what actually happened and how
// it scored. Pick a flour, take the suggested defaults, name it, and it
// becomes yours to edit and to score.

import { DEFAULT_RECIPE } from './dough.js?v=8a97ff6a';
import { DEFAULT_SCHEDULE } from './protocol.js?v=8a97ff6a';
import { blendStats, blendLabel } from './flours.js?v=8a97ff6a';
import { suggestPlan, defaultLeadHours } from './advisor.js?v=8a97ff6a';

export const SCORE_KEYS = [
  { key: 'canotto', label: 'Canotto height', hint: '1 flat, 5 massive' },
  { key: 'honeycomb', label: 'Honeycomb', hint: '1 gummy, 5 pure open web' },
  { key: 'blistering', label: 'Blistering', hint: '1 scorched or pale, 5 micro leopard' },
  { key: 'flavour', label: 'Flavour', hint: '1 flat, 5 complex' },
  { key: 'base', label: 'Base crispness', hint: '1 soggy, 5 crisp and dry' },
];

/** Mean of whatever sub-scores were filled in, on the same 1 to 5 scale. */
export function overallScore(scores) {
  const vals = SCORE_KEYS.map((k) => Number(scores?.[k.key])).filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
}

export function newId(prefix = 'r') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Build a complete, ready-to-bake recipe from a flour blend.
 * Everything the advisor proposes is applied, so the result is a real recipe
 * rather than a template with holes in it.
 */
export function recipeFromBlend(flours, opts = {}) {
  const blend = blendStats(flours);
  const totalHours = Number.isFinite(opts.totalHours) ? opts.totalHours : defaultLeadHours(blend);
  const plan = suggestPlan(blend, { ...opts, flours, totalHours });

  return {
    id: newId(),
    name: opts.name || `${blendLabel(flours)}, ${Math.round(totalHours)} hour`,
    // Anything generated from a flour belongs to the baker. Only the shipped
    // protocol is 'house'.
    origin: opts.origin || 'user',
    derivedFrom: opts.derivedFrom || null,
    createdAt: new Date().toISOString(),
    notes: opts.notes || '',
    recipe: {
      ...DEFAULT_RECIPE,
      ...plan.recipePatch,
      flours: JSON.parse(JSON.stringify(flours)),
      balls: opts.balls ?? DEFAULT_RECIPE.balls,
      ballWeight: opts.ballWeight ?? DEFAULT_RECIPE.ballWeight,
      frozenBalls: opts.frozenBalls ?? 0,
    },
    schedule: { ...DEFAULT_SCHEDULE, ...plan.schedule, bakeSec: opts.bakeSec ?? DEFAULT_SCHEDULE.bakeSec },
    plan: {
      totalHours,
      window: plan.window,
      idyPct: plan.idyPct,
      hydration: plan.hydration,
      w: blend.w,
      sourced: blend.sourced,
    },
  };
}

/** Copy a recipe under a new name, keeping a link back to the original. */
export function deriveRecipe(base, patch = {}) {
  const copy = JSON.parse(JSON.stringify(base));
  return {
    ...copy,
    id: newId(),
    name: patch.name || `${base.name} (copy)`,
    origin: 'user',
    derivedFrom: base.id,
    createdAt: new Date().toISOString(),
    recipe: { ...copy.recipe, ...(patch.recipe || {}) },
    schedule: { ...copy.schedule, ...(patch.schedule || {}) },
    notes: patch.notes ?? copy.notes,
  };
}

/**
 * The house recipe: the Contemporary Canotto protocol exactly as written,
 * biga at 45% hydration, 70% total, 66 h cold proof, Caputo Cuoco.
 */
export function houseRecipe() {
  return {
    id: 'house-canotto',
    name: 'Contemporary Canotto (house)',
    origin: 'house',
    derivedFrom: null,
    createdAt: new Date().toISOString(),
    notes: 'The original protocol. Biga at 45%, 70% total hydration, 66 hour cold proof, flame-modulated bake.',
    recipe: { ...DEFAULT_RECIPE },
    schedule: { ...DEFAULT_SCHEDULE },
    plan: null,
  };
}

/**
 * One preset, and one only: the house protocol. Everything else is either
 * built from scratch by picking a flour, or duplicated from something that
 * already exists.
 */
export function starterRecipes() {
  return [houseRecipe()];
}

/* ------------------------------- scoring -------------------------------- */

/** Roll a recipe's bakes into one rating. */
export function recipeRating(recipeId, bakes) {
  const runs = (bakes || []).filter((b) => b.recipeId === recipeId && !b.planned);
  const scored = runs.map((b) => overallScore(b.scores)).filter((v) => Number.isFinite(v));
  const perKey = {};
  for (const k of SCORE_KEYS) {
    const vals = runs.map((b) => Number(b.scores?.[k.key])).filter((v) => Number.isFinite(v) && v > 0);
    perKey[k.key] = vals.length ? Math.round((vals.reduce((a, c) => a + c, 0) / vals.length) * 100) / 100 : null;
  }
  return {
    runs: runs.length,
    scored: scored.length,
    average: scored.length ? Math.round((scored.reduce((a, c) => a + c, 0) / scored.length) * 100) / 100 : null,
    best: scored.length ? Math.max(...scored) : null,
    perKey,
    lastBaked: runs.map((b) => b.bakedAt).sort().pop() || null,
  };
}

/** Rank recipes by mean score, used for the leaderboard. */
export function rankRecipes(recipes, bakes) {
  return recipes
    .map((r) => ({ recipe: r, rating: recipeRating(r.id, bakes) }))
    .sort((a, b) => (b.rating.average ?? -1) - (a.rating.average ?? -1));
}
