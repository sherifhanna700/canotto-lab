// CSV export. One row per bake, with the derived numbers already worked out so
// the file is useful in a spreadsheet without redoing the maths.

import { computeRecipe } from '../model/dough.js?v=eb765592';
import { scheduleStages } from '../model/protocol.js?v=eb765592';
import { fermentUnits } from '../model/ferment.js?v=eb765592';
import { overallScore, SCORE_KEYS } from '../model/recipes.js?v=eb765592';
import { cToF } from '../model/units.js?v=eb765592';
import { ovenLabel, mixerLabel } from '../model/equipment.js?v=eb765592';

const COLUMNS = [
  ['id', (b) => b.id],
  ['baked_at', (b) => b.bakedAt],
  ['title', (b) => b.title || b.recipeName || ''],
  ['recipe_id', (b) => b.recipeId || ''],
  ['flours', (b, c) => c.flourLabel],
  ['flour_w', (b, c) => c.blend.w ?? ''],
  ['flour_protein', (b, c) => c.blend.protein ?? ''],
  ['oven', (b) => ovenLabel(b.equipment)],
  ['mixer', (b) => mixerLabel(b.equipment)],
  ['method', (b) => b.recipe.method],
  ['hydration_pct', (b) => b.recipe.hydrationPct],
  ['salt_pct', (b) => b.recipe.saltPct],
  ['oil_pct', (b) => b.recipe.oilPct],
  ['yeast_type', (b) => b.recipe.yeastType],
  ['yeast_pct', (b, c) => c.yeastPct],
  ['balls', (b) => b.recipe.balls],
  ['ball_weight_g', (b) => b.recipe.ballWeight],
  ['preferment_flour_pct', (b) => b.recipe.prefermentFlourPct],
  ['preferment_hydration_pct', (b) => b.recipe.prefermentHydrationPct],
  ['cold_proof_h', (b) => b.schedule.coldProofHours],
  ['fridge_c', (b) => round(b.schedule.fridgeTempC)],
  ['fridge_f', (b) => round(cToF(b.schedule.fridgeTempC))],
  ['biga_rest_h', (b) => b.schedule.bigaRestHours],
  ['biga_cold_h', (b) => b.schedule.bigaColdHours],
  ['temper_h', (b) => b.schedule.temperHours],
  ['fermentation_units', (b, c, fu) => round(fu, 2)],
  ['ambient_c', (b) => round(b.actuals?.ambientTempC)],
  ['humidity_pct', (b) => b.actuals?.humidityPct ?? ''],
  ['deck_c', (b) => round(b.actuals?.deckTempC ?? b.schedule.deckTempC)],
  ['dome_c', (b) => round(b.actuals?.domeTempC ?? b.schedule.domeTempC)],
  ['core_c', (b) => round(b.actuals?.coreTempC)],
  ['fdt_c', (b) => round(b.actuals?.fdtC)],
  ['bake_sec', (b) => b.actuals?.bakeSec ?? b.schedule.bakeSec],
  ...SCORE_KEYS.map((k) => [`score_${k.key}`, (b) => b.scores?.[k.key] ?? '']),
  ['score_overall', (b) => overallScore(b.scores) ?? ''],
  ['issues', (b) => (b.issues || []).join(' ')],
  ['notes', (b) => b.notes || ''],
];

function round(v, d = 1) {
  if (!Number.isFinite(v)) return '';
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function esc(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function bakeCSV(state) {
  const lines = [COLUMNS.map((c) => c[0]).join(',')];
  for (const b of state.bakes) {
    const c = computeRecipe(b.recipe);
    const fu = fermentUnits(scheduleStages(b.schedule), state.settings.model);
    lines.push(COLUMNS.map(([, fn]) => esc(fn(b, c, fu))).join(','));
  }
  return lines.join('\n');
}
