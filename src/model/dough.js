// Baker's percentage engine. Everything downstream (protocol text, schedule,
// bake log snapshots) reads the object this returns, so the numbers in the
// checklist and the numbers in the calculator can never drift apart.

import { blendStats, blendLabel, flourName, maturationCeilingForW, hydrationRangeForW } from './flours.js?v=57af795c';
import { reconcile, splitDoses } from './units.js?v=57af795c';

/** Relative potency, referenced to instant dry yeast. */
export const YEAST_FACTOR = { idy: 1, ady: 1.25, fresh: 3 };
export const YEAST_LABEL = { idy: 'Instant dry', ady: 'Active dry', fresh: 'Fresh / cake' };

export const METHODS = {
  biga: { label: 'Biga', prefermentFlourPct: 100, prefermentHydrationPct: 45, yeastShare: 1 },
  poolish: { label: 'Poolish', prefermentFlourPct: 35, prefermentHydrationPct: 100, yeastShare: 1 },
  direct: { label: 'Direct', prefermentFlourPct: 0, prefermentHydrationPct: 0, yeastShare: 0 },
};

export const DEFAULT_RECIPE = {
  method: 'biga',
  balls: 8,
  frozenBalls: 4,
  ballWeight: 275,
  wastePct: 0,
  hydrationPct: 70,
  saltPct: 2.8,
  oilPct: 0.9,
  sugarPct: 0,
  maltPct: 0,
  yeastType: 'idy',
  baseYeastPct: 0.1,
  // Freezing kills a slice of the yeast population, so the original protocol
  // inoculates higher whenever any ball is destined for the freezer.
  freezeBufferPct: 0.03,
  prefermentFlourPct: 100,
  prefermentHydrationPct: 45,
  prefermentYeastShare: 1,
  // Share of the post-preferment water held back to wash the salt in.
  saltWashShare: 0.375,
  bassinageDoses: 3,
  // A blend. One entry at 100% is just a single flour.
  // `stage` steers where a flour lands: 'blend' splits it proportionally
  // between preferment and final mix, 'biga' sends it to the preferment
  // first, 'final' holds it back for the refresh.
  flours: [{ id: 'caputo-cuoco', pct: 100, stage: 'blend' }],
};

/** Inoculation actually used, including the freeze buffer when it applies. */
export function effectiveYeastPct(r) {
  const buffer = r.frozenBalls > 0 ? r.freezeBufferPct || 0 : 0;
  return (r.baseYeastPct || 0) + buffer;
}

/**
 * Split each flour in the blend between the preferment and the final mix.
 * Flours tagged 'biga' fill the preferment first, 'final' flours are held back,
 * and whatever is left is taken proportionally from the 'blend' flours.
 */
export function allocateFlours(entries, totalFlour, prefermentFlour) {
  const list = (entries || []).filter((e) => Number(e.pct) > 0);
  const totalPct = list.reduce((s, e) => s + Number(e.pct), 0) || 1;
  const rows = list.map((e) => ({
    ...e,
    label: flourName(e),
    pct: (Number(e.pct) / totalPct) * 100,
    grams: (totalFlour * Number(e.pct)) / totalPct,
    biga: 0,
    final: 0,
  }));

  let need = Math.max(0, Math.min(prefermentFlour, totalFlour));

  // 1. Dedicated biga flours.
  for (const r of rows) {
    if (r.stage !== 'biga' || need <= 0) continue;
    const take = Math.min(r.grams, need);
    r.biga += take;
    need -= take;
  }
  // 2. Proportionally from the unassigned flours.
  const pool = rows.filter((r) => r.stage !== 'biga' && r.stage !== 'final');
  const poolGrams = pool.reduce((s, r) => s + (r.grams - r.biga), 0);
  if (need > 0 && poolGrams > 0) {
    const share = Math.min(1, need / poolGrams);
    for (const r of pool) {
      const take = (r.grams - r.biga) * share;
      r.biga += take;
      need -= take;
    }
  }
  // 3. Last resort: pull from the held-back flours rather than short the biga.
  if (need > 0.5) {
    for (const r of rows) {
      if (need <= 0) break;
      const take = Math.min(r.grams - r.biga, need);
      r.biga += take;
      need -= take;
    }
  }

  for (const r of rows) r.final = Math.max(0, r.grams - r.biga);
  return rows;
}

/**
 * Resolve a recipe into grams.
 * All percentages are baker's percentages against TOTAL flour.
 */
export function computeRecipe(input) {
  const r = { ...DEFAULT_RECIPE, ...input };
  const yeastPct = effectiveYeastPct(r);

  const targetDough = r.balls * r.ballWeight;
  const totalDough = targetDough * (1 + (r.wastePct || 0) / 100);

  const pctSum =
    100 + r.hydrationPct + r.saltPct + (r.oilPct || 0) + (r.sugarPct || 0) + (r.maltPct || 0) + yeastPct;

  const flour = (totalDough * 100) / pctSum;
  const pct = (p) => (flour * p) / 100;

  const water = pct(r.hydrationPct);
  const salt = pct(r.saltPct);
  const oil = pct(r.oilPct || 0);
  const sugar = pct(r.sugarPct || 0);
  const malt = pct(r.maltPct || 0);
  const yeast = pct(yeastPct);

  const flours = r.flours && r.flours.length ? r.flours : DEFAULT_RECIPE.flours;
  const blend = blendStats(flours);
  const prefFlour = pct(r.prefermentFlourPct || 0);
  const prefWater = (prefFlour * (r.prefermentHydrationPct || 0)) / 100;
  const prefYeast = yeast * (r.prefermentYeastShare ?? 0);

  const finalFlour = flour - prefFlour;
  const finalWater = water - prefWater;
  const finalYeast = yeast - prefYeast;

  // The held-back water rides in with the salt; the rest goes in as bassinage.
  const saltWash = finalWater * (r.saltWashShare ?? 0);
  const bassinage = finalWater - saltWash;

  const warnings = [];
  if (finalWater < -0.5) {
    warnings.push(
      `The preferment alone needs ${Math.round(prefWater)} g of water, more than the ${Math.round(water)} g the recipe has. Lower the preferment hydration or raise total hydration.`
    );
  }
  if (finalFlour < -0.5) {
    warnings.push('Preferment flour exceeds total flour. Cap the preferment at 100%.');
  }
  if (r.hydrationPct > 85) warnings.push('Above 85% hydration this dough is very hard to ball by hand.');
  if (r.frozenBalls > r.balls) warnings.push('More frozen balls than total balls.');
  if (!blend.valid) warnings.push(`Flour blend adds up to ${blend.total}%, not 100%.`);
  const hydRange = hydrationRangeForW(blend.w);
  if (hydRange && r.hydrationPct > hydRange.high + 4) {
    warnings.push(`At W ${blend.w} this blend is being pushed past its usual ceiling of about ${hydRange.high}% hydration.`);
  }

  // Weighable figures: every part is rounded so it sums to its whole, because
  // a table whose columns do not add up is not something you can follow at a
  // scale.
  const [flourBiga, flourFinal] = reconcile(flour, [prefFlour, Math.max(0, finalFlour)]);
  const [waterBiga, waterFinal] = reconcile(water, [prefWater, Math.max(0, finalWater)]);
  const [washG, bassinageG] = reconcile(waterFinal, [Math.max(0, saltWash), Math.max(0, bassinage)]);
  const [yeastBiga, yeastFinal] = reconcile(yeast, [prefYeast, Math.max(0, finalYeast)], 1);
  const doses = splitDoses(bassinageG, r.bassinageDoses);

  const weigh = {
    flour: { total: flourBiga + flourFinal, biga: flourBiga, final: flourFinal },
    water: {
      total: waterBiga + waterFinal,
      biga: waterBiga,
      final: waterFinal,
      bassinage: bassinageG,
      saltWash: washG,
      doses,
    },
    salt: round1(salt),
    oil: round1(oil),
    sugar: round1(sugar),
    malt: round1(malt),
    yeast: { total: round1(yeastBiga + yeastFinal), biga: yeastBiga, final: yeastFinal },
    bigaMass: flourBiga + waterBiga + yeastBiga,
  };

  return {
    recipe: r,
    weigh,
    blend,
    flourLabel: blendLabel(flours),
    flourRows: allocateFlours(flours, flour, prefFlour),
    maturationCeiling: maturationCeilingForW(blend.w),
    hydrationRange: hydRange,
    yeastPct,
    yeastLabel: YEAST_LABEL[r.yeastType],
    totalDough,
    targetDough,
    perBall: r.ballWeight,
    freshBalls: Math.max(0, r.balls - r.frozenBalls),
    flour,
    water,
    salt,
    oil,
    sugar,
    malt,
    yeast,
    preferment: {
      active: (r.prefermentFlourPct || 0) > 0,
      flour: prefFlour,
      water: prefWater,
      yeast: prefYeast,
      mass: prefFlour + prefWater + prefYeast,
      hydrationPct: r.prefermentHydrationPct,
      flourPct: r.prefermentFlourPct,
    },
    finalMix: {
      flour: finalFlour,
      water: finalWater,
      yeast: finalYeast,
      bassinage,
      saltWash,
      doseSize: bassinage / Math.max(1, r.bassinageDoses),
      doses: r.bassinageDoses,
    },
    warnings,
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Human label for the flours that actually go into one stage. */
export function stageFlourLabel(c, stage) {
  const rows = (c.flourRows || []).filter((r) => r[stage] > 0.5);
  if (!rows.length) return c.flourLabel;
  if (rows.length === 1) return rows[0].label;
  const total = rows.reduce((s, r) => s + r[stage], 0);
  return rows.map((r) => `${Math.round((r[stage] / total) * 100)}% ${r.label}`).join(' + ');
}

/** Convert an inoculation expressed in one yeast type into another. */
export function convertYeast(pct, from, to) {
  return (pct * YEAST_FACTOR[to]) / YEAST_FACTOR[from];
}

/**
 * Rows for the ingredient table, in weighable grams.
 * `biga` and `final` always add up to `grams`.
 */
export function ingredientRows(c) {
  const r = c.recipe;
  const w = c.weigh;
  const rows = [
    { key: 'flour', label: `Flour (${c.flourLabel})`, grams: w.flour.total, biga: w.flour.biga, final: w.flour.final, pct: 100 },
    { key: 'water', label: 'Water (total)', grams: w.water.total, biga: w.water.biga, final: w.water.final, pct: r.hydrationPct },
    { key: 'salt', label: 'Fine sea salt', grams: w.salt, biga: 0, final: w.salt, pct: r.saltPct },
  ];
  if (w.oil > 0) rows.push({ key: 'oil', label: 'Olive oil', grams: w.oil, biga: 0, final: w.oil, pct: r.oilPct });
  if (w.sugar > 0) rows.push({ key: 'sugar', label: 'Sugar', grams: w.sugar, biga: 0, final: w.sugar, pct: r.sugarPct });
  if (w.malt > 0) rows.push({ key: 'malt', label: 'Diastatic malt', grams: w.malt, biga: 0, final: w.malt, pct: r.maltPct });
  rows.push({ key: 'yeast', label: `${c.yeastLabel} yeast`, grams: w.yeast.total, biga: w.yeast.biga, final: w.yeast.final, pct: c.yeastPct });
  return rows;
}
