// The variables a bake can be compared on.
//
// Compare and Lab both work off this list, so adding a field here makes it
// available as an axis, a grouping and a correlation candidate everywhere.

import { computeRecipe } from './dough.js?v=073bb50c';
import { scheduleStages } from './protocol.js?v=073bb50c';
import { fermentUnits, ripeness } from './ferment.js?v=073bb50c';
import { convertYeast } from './dough.js?v=073bb50c';
import { overallScore, SCORE_KEYS } from './recipes.js?v=073bb50c';
import { toDisplay } from './units.js?v=073bb50c';
import { ovenLabel, mixerLabel } from './equipment.js?v=073bb50c';

/** Inputs: things you chose. */
export const FACTORS = [
  { key: 'hydrationPct', label: 'Hydration', unit: '%', get: (b) => b.recipe.hydrationPct },
  { key: 'fermentationUnits', label: 'Fermentation load', unit: 'FU', get: (b, d) => d.fu },
  { key: 'coldProofHours', label: 'Cold proof', unit: 'h', get: (b) => b.schedule.coldProofHours },
  { key: 'fridgeTempC', label: 'Cold ferment temperature', unit: '°', temp: true, get: (b) => b.actuals?.fridgeTempC ?? b.schedule.fridgeTempC },
  { key: 'yeastPct', label: 'Inoculation', unit: '%', get: (b, d) => d.c.yeastPct },
  { key: 'ripeness', label: 'Ripeness', unit: '×', get: (b, d) => d.ripeness },
  { key: 'flourW', label: 'Flour strength', unit: 'W', get: (b, d) => d.c.blend.w },
  { key: 'flourProtein', label: 'Flour protein', unit: '%', get: (b, d) => d.c.blend.protein },
  { key: 'prefermentFlourPct', label: 'Preferment share of flour', unit: '%', get: (b) => b.recipe.prefermentFlourPct },
  { key: 'prefermentHydrationPct', label: 'Preferment hydration', unit: '%', get: (b) => b.recipe.prefermentHydrationPct },
  { key: 'saltPct', label: 'Salt', unit: '%', get: (b) => b.recipe.saltPct },
  { key: 'oilPct', label: 'Olive oil', unit: '%', get: (b) => b.recipe.oilPct },
  { key: 'ballWeight', label: 'Ball weight', unit: 'g', get: (b) => b.recipe.ballWeight },
  { key: 'bigaColdHours', label: 'Biga cold hold', unit: 'h', get: (b) => b.schedule.bigaColdHours },
  { key: 'temperHours', label: 'Counter temper', unit: 'h', get: (b) => b.schedule.temperHours },
  { key: 'deckTempC', label: 'Floor temperature', unit: '°', temp: true, get: (b) => b.actuals?.deckTempC ?? b.schedule.deckTempC },
  { key: 'domeTempC', label: 'Dome temperature', unit: '°', temp: true, get: (b) => b.actuals?.domeTempC ?? b.schedule.domeTempC },
  { key: 'bakeSec', label: 'Bake time', unit: 's', get: (b) => b.actuals?.bakeSec ?? b.schedule.bakeSec },
  { key: 'coreTempC', label: 'Ball core at launch', unit: '°', temp: true, get: (b) => b.actuals?.coreTempC },
  { key: 'fdtC', label: 'Final dough temperature', unit: '°', temp: true, get: (b) => b.actuals?.fdtC },
  { key: 'ambientTempC', label: 'Ambient temperature', unit: '°', temp: true, get: (b) => b.actuals?.ambientTempC },
  { key: 'humidityPct', label: 'Humidity', unit: '%', get: (b) => b.actuals?.humidityPct },
];

/** Outputs: things you judged. */
export const OUTCOMES = [
  { key: 'overall', label: 'Overall score', unit: '/5', get: (b) => overallScore(b.scores) },
  ...SCORE_KEYS.map((k) => ({ key: k.key, label: k.label, unit: '/5', get: (b) => numOrNull(b.scores?.[k.key]) })),
];

/** Categorical splits. */
export const GROUPS = [
  { key: 'none', label: 'No grouping', get: () => 'All bakes' },
  { key: 'flour', label: 'Flour blend', get: (b, d) => d.c.flourLabel },
  { key: 'method', label: 'Method', get: (b) => b.recipe.method },
  { key: 'recipe', label: 'Recipe', get: (b) => b.recipeName || b.title || 'Untitled' },
  { key: 'oven', label: 'Oven', get: (b) => ovenLabel(b.equipment) },
  { key: 'mixer', label: 'Mixer', get: (b) => mixerLabel(b.equipment) },
  { key: 'yeastType', label: 'Yeast type', get: (b) => b.recipe.yeastType },
];

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Derived values every accessor above may rely on. */
export function derive(bake, model) {
  const c = computeRecipe(bake.recipe);
  const stages = scheduleStages(bake.schedule);
  const fu = fermentUnits(stages, model);
  const idy = convertYeast(bake.recipe.baseYeastPct, bake.recipe.yeastType, 'idy');
  return { c, stages, fu, ripeness: ripeness(stages, idy, model) };
}

export function findFactor(key) {
  return FACTORS.find((f) => f.key === key) || FACTORS[0];
}
export function findOutcome(key) {
  return OUTCOMES.find((f) => f.key === key) || OUTCOMES[0];
}
export function findGroup(key) {
  return GROUPS.find((f) => f.key === key) || GROUPS[0];
}

/** Value of a factor in the user's display unit. */
export function factorValue(factor, bake, d, unit) {
  const raw = factor.get(bake, d);
  if (!Number.isFinite(raw)) return null;
  return factor.temp ? toDisplay(raw, unit) : raw;
}

export function factorLabel(factor, unit) {
  return factor.temp ? `${factor.label} (°${unit})` : factor.unit ? `${factor.label} (${factor.unit})` : factor.label;
}
