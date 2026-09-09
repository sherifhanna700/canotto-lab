// The 19-step Contemporary Canotto protocol, rebuilt as data.
//
// Two things changed versus the original static page:
//   1. Every quantity in the step text is computed from the live recipe, so the
//      checklist and the calculator can never disagree.
//   2. Every duration is a parameter. The schedule solves backwards from the
//      moment you want the first pizza to hit the deck, which is what makes
//      "same recipe, different timing" an experiment you can actually run.

import { fmtGrams, fmtTemp, fmtDuration } from './units.js?v=57af795c';
import { stageFlourLabel } from './dough.js?v=57af795c';
import { mixerPhrasing, mixerLabel } from './equipment.js?v=57af795c';

/**
 * Room temperature defaults to 21.1 °C, which is exactly 70 °F.
 * Average daytime thermostat settings in US homes are 70.1 °F in winter and
 * 72.1 °F in summer, so 70 sits at the low end of the normal band, which suits
 * a kitchen counter: it usually reads a little below the thermostat.
 */
export const DEFAULT_SCHEDULE = {
  bigaMixMin: 10,
  bigaRestHours: 3.75,
  bigaRoomTempC: 21.1,
  bigaColdHours: 17,
  bigaFridgeTempC: 2.8,
  finalMixMin: 30,
  benchRest1Min: 20,
  benchRest2Min: 20,
  oilRestMin: 30,
  ballingMin: 15,
  benchTempC: 21.1,
  coldProofHours: 66,
  fridgeTempC: 2.8,
  temperHours: 4,
  roomTempC: 21.1,
  preheatMin: 45,
  stretchMin: 2,
  bakeSec: 75,
  deckTempC: 452,
  domeTempC: 490,
  ddtC: 23.3,
  freezeFlashMin: 120,
  thawFridgeHours: 48,
  frozenTemperHours: 5.5,
};

export const PHASES = [
  { n: 1, icon: 'science', title: 'Biga Build & Cold Maturation', sub: 'Coarse cluster mix, ambient awakening, then a long cold hold' },
  { n: 2, icon: 'cyclone', title: 'Final Mix & Staged Bassinage', sub: 'Ice-water dosing, salt wash-in, and a hard stop on dough temperature' },
  { n: 3, icon: 'opacity', title: 'Bench Handling & the Capuano Oil Veil', sub: 'Coil folds, a topical oil barrier, and dry-seam balling' },
  { n: 4, icon: 'ac_unit', title: 'Segregation, Cold Proof & Flash Freeze', sub: 'The long fridge proof, and the freezer track for the rest of the batch' },
  { n: 5, icon: 'local_fire_department', title: 'Bake Day & Heat Modulation', sub: 'Temper to core temperature, gas migration press, and the bake itself' },
];

/**
 * Offsets in minutes relative to launch (t = 0). Everything before the bake is
 * negative. Solving backwards means changing the cold proof moves the mix, not
 * the dinner.
 */
export function solveSchedule(s = DEFAULT_SCHEDULE) {
  const S = { ...DEFAULT_SCHEDULE, ...s };
  const launch = 0;
  const stretch = launch - S.stretchMin;
  const preheat = launch - S.preheatMin;
  const temperStart = launch - S.temperHours * 60;
  const coldProofStart = temperStart - S.coldProofHours * 60;
  const ballingStart = coldProofStart - S.ballingMin;
  const oilVeil = ballingStart - S.oilRestMin;
  const fold2 = oilVeil - S.benchRest2Min - 5;
  const fold1 = fold2 - S.benchRest1Min;
  const benchStart = fold1;
  const finalMixStart = benchStart - S.finalMixMin;
  const bigaColdStart = finalMixStart - S.bigaColdHours * 60;
  const bigaRestStart = bigaColdStart - S.bigaRestHours * 60;
  const bigaStart = bigaRestStart - S.bigaMixMin;

  const mixFrac = (f) => finalMixStart + S.finalMixMin * f;

  return {
    params: S,
    totalMin: launch - bigaStart,
    at: {
      'p1-1': bigaStart,
      'p1-2': bigaStart + S.bigaMixMin * 0.5,
      'p1-3': bigaRestStart,
      'p1-4': bigaColdStart,
      'p2-1': mixFrac(0),
      'p2-2': mixFrac(0.1),
      'p2-3': mixFrac(0.27),
      'p2-4': mixFrac(0.4),
      'p3-1': fold1,
      'p3-2': fold2,
      'p3-3': oilVeil,
      'p3-4': ballingStart,
      'p4-1': coldProofStart,
      'p4-2': coldProofStart,
      'p4-3': launch - (S.thawFridgeHours + S.frozenTemperHours) * 60,
      'p5-1': temperStart,
      'p5-2': preheat,
      'p5-3': stretch,
      'p5-4': launch,
    },
    marks: { bigaStart, bigaRestStart, bigaColdStart, finalMixStart, benchStart, coldProofStart, temperStart, preheat, launch },
  };
}

/** The fermentation stages implied by a schedule, for the FU model. */
export function scheduleStages(s = DEFAULT_SCHEDULE) {
  const S = { ...DEFAULT_SCHEDULE, ...s };
  const benchHours = (S.finalMixMin + S.benchRest1Min + S.benchRest2Min + 5 + S.oilRestMin + S.ballingMin) / 60;
  return [
    { name: 'Biga ambient rest', hours: S.bigaRestHours, tempC: S.bigaRoomTempC },
    { name: 'Biga cold hold', hours: S.bigaColdHours, tempC: S.bigaFridgeTempC },
    { name: 'Mix & bench', hours: benchHours, tempC: S.benchTempC },
    { name: 'Cold proof', hours: S.coldProofHours, tempC: S.fridgeTempC },
    { name: 'Counter temper', hours: S.temperHours, tempC: S.roomTempC },
  ];
}

/* ---------------------------------------------------------------------- */

const b = (x) => `<strong>${x}</strong>`;

/**
 * The steps. `body` receives {c, S, u} where c is the computed recipe,
 * S the schedule parameters and u the temperature unit.
 */
export const STEPS = [
  {
    id: 'p1-1', phase: 1, n: 1,
    title: () => 'Dissolve yeast and load the bowl',
    badge: () => '3 min',
    body: ({ c, S, u, E }) =>
      `Dissolve ${b(fmtGrams(c.weigh.yeast.biga))} ${c.yeastLabel.toLowerCase()} yeast in ${b(fmtGrams(c.weigh.water.biga))} of cool water at ${b(fmtTemp(S.bigaWaterTempTarget ?? 15, u))}. Pour it over ${b(fmtGrams(c.weigh.flour.biga))} of ${stageFlourLabel(c, 'biga')} in the ${mixerPhrasing(E).bowl}. ` +
      (c.recipe.frozenBalls > 0
        ? `Inoculation is buffered to ${b(`${c.yeastPct.toFixed(3)}%`)} to cover yeast mortality in the ${c.recipe.frozenBalls} balls headed for the freezer.`
        : `Standard ${b(`${c.yeastPct.toFixed(3)}%`)} inoculation, no freeze buffer needed for an all-fresh batch.`),
    metrics: ['bigaWaterTempC'],
  },
  {
    id: 'p1-2', phase: 1, n: 2,
    title: ({ E }) => `Coarse cluster mix, ${mixerPhrasing(E).lowSpeed}, 90 to 120 seconds`,
    badge: () => 'CRITICAL',
    body: ({ E }) =>
      `Mix ${mixerPhrasing(E).lowSpeed} for ${b('90 to 120 seconds maximum')}. Stop the moment the loose flour is absorbed. The biga must look like damp walnut-sized rubble and ${b('must never ball up')}.`,
  },
  {
    id: 'p1-3', phase: 1, n: 3,
    title: () => 'Ambient yeast awakening rest',
    badge: ({ S }) => fmtDuration(S.bigaRestHours),
    body: ({ S, u }) =>
      `Transfer loosely to an oiled tub. Do not pack it down. Rest at ${b(fmtTemp(S.bigaRoomTempC, u))} for ${b(fmtDuration(S.bigaRestHours))} until the clusters swell by roughly a third and smell sweet and yeasty.`,
  },
  {
    id: 'p1-4', phase: 1, n: 4,
    title: ({ S, u }) => `Cold ferment at ${fmtTemp(S.bigaFridgeTempC, u)}`,
    badge: ({ S }) => fmtDuration(S.bigaColdHours),
    body: ({ S, u }) =>
      `Move the tub to the ${b(fmtTemp(S.bigaFridgeTempC, u))} fridge for ${b(fmtDuration(S.bigaColdHours))}. Cold preserves the strong gluten matrix while enzymes keep generating sugar, without the acetic edge a warm hold would build.`,
  },

  {
    id: 'p2-1', phase: 2, n: 1,
    title: () => 'Tear the biga and run it dry',
    badge: () => '60 sec',
    body: ({ c, E }) => {
      const held = (c.flourRows || []).filter((r) => r.final > 0.5);
      const extra = held.length
        ? ` Add the held-back flour now: ${held.map((r) => `${b(fmtGrams(Math.round(r.final)))} ${r.label}`).join(', ')}.`
        : '';
      return `Tear the chilled biga into 8 to 10 cold chunks straight into the ${mixerPhrasing(E).bowl}. Run it dry ${mixerPhrasing(E).lowSpeed} for ${b('60 seconds with no water')} to break the chunks down.${extra}`;
    },
  },
  {
    id: 'p2-2', phase: 2, n: 2,
    title: ({ c }) => `Staged bassinage, ${fmtGrams(c.weigh.water.bassinage)} ice water`,
    badge: ({ c }) => `${c.weigh.water.doses.length} doses`,
    body: ({ c }) => {
      const doses = c.weigh.water.doses;
      const equal = doses.every((x) => x === doses[0]);
      const how = equal ? `${b(`${doses.length} additions`)} of ${doses[0]} g each` : `additions of ${b(doses.join(', '))} g`;
      return `Move up a speed. Drizzle ${b(fmtGrams(c.weigh.water.bassinage))} of ice-cold water down the bowl wall in ${how}. Let the dough absorb each dose and re-grip the spiral before the next one goes in.`;
    },
  },
  {
    id: 'p2-3', phase: 2, n: 3,
    title: ({ c }) => `Salt (${fmtGrams(c.weigh.salt)}) and the final wash-in`,
    badge: () => '2 min',
    body: ({ c, E }) =>
      `When ${mixerPhrasing(E).clears}, sprinkle in ${b(fmtGrams(c.weigh.salt))} of fine sea salt. Immediately drizzle the remaining ${b(fmtGrams(c.weigh.water.saltWash))} of ice water over the salt to wash it into the interface.`,
  },
  {
    id: 'p2-4', phase: 2, n: 4,
    title: () => 'Windowpane and the temperature hard stop',
    badge: ({ S, u }) => `STOP: ${fmtTemp(S.ddtC + 1.7, u)}`,
    body: ({ S, u, E }) =>
      `Mix ${mixerPhrasing(E).highSpeed} for 3 to 5 minutes until the dough is smooth and windowpanes. Target final dough temperature ${b(fmtTemp(S.ddtC, u))}. If it reaches ${b(fmtTemp(S.ddtC + 1.7, u))}, stop mixing immediately to protect the enzymes.`,
    metrics: ['fdtC'],
  },

  {
    id: 'p3-1', phase: 3, n: 1,
    title: ({ S }) => `Rest ${S.benchRest1Min} min, then coil fold #1`,
    badge: ({ S }) => `${S.benchRest1Min} min`,
    body: ({ S }) => `Rest the bulk ${b(`${S.benchRest1Min} minutes`)}. With wet hands, lift from the centre, let the ends curl underneath, rotate 90° and repeat once.`,
  },
  {
    id: 'p3-2', phase: 3, n: 2,
    title: ({ S }) => `Rest ${S.benchRest2Min} min, then coil fold #2`,
    badge: ({ S }) => `${S.benchRest2Min} min`,
    body: () => `Perform the second coil fold. The dough should now stand tall with visible surface tension.`,
  },
  {
    id: 'p3-3', phase: 3, n: 3,
    title: () => "Apply the Capuano oil veil (un velo d'olio)",
    badge: ({ S }) => `${S.oilRestMin} min rest`,
    body: ({ c, S }) =>
      `Turn the bulk onto the counter into a smooth dome. Drizzle ${b(fmtGrams(c.weigh.oil))} of extra virgin olive oil across the top and smooth it into a micro-thin, glossy film. Invert the tub over the dough and rest ${b(`${S.oilRestMin} minutes`)} undisturbed. ${b('Do not laminate.')}`,
  },
  {
    id: 'p3-4', phase: 3, n: 4,
    title: ({ c }) => `Ball on a dry counter (${c.recipe.balls} × ${c.recipe.ballWeight} g)`,
    badge: ({ c }) => `${c.recipe.balls} × ${c.recipe.ballWeight} g`,
    body: ({ c }) =>
      `Cut into ${b(`${c.recipe.balls} portions of ${c.recipe.ballWeight} g`)}. ${b('Keep the counter dry.')} Drag and cup each ball so friction pulls the oiled skin taut while the un-oiled bottom seam seals airtight. ` +
      (c.recipe.frozenBalls > 0
        ? `${c.freshBalls} will cold proof fresh, ${c.recipe.frozenBalls} go to the freezer.`
        : `All ${c.recipe.balls} will cold proof fresh.`),
  },

  {
    id: 'p4-1', phase: 4, n: 1,
    title: ({ c, S, u }) => `Fresh batch: ${c.freshBalls} balls into the ${fmtTemp(S.fridgeTempC, u)} fridge`,
    badge: ({ S }) => fmtDuration(S.coldProofHours),
    body: ({ c, S, u }) =>
      `Place the ${b(`${c.freshBalls} fresh balls`)} in airtight proofing boxes, spaced about 3 inches apart. The oil veil holds moisture without crusting. Hold undisturbed at ${b(fmtTemp(S.fridgeTempC, u))} for ${b(fmtDuration(S.coldProofHours))}.`,
    metrics: ['fridgeTempC', 'coldHoldHours'],
  },
  {
    id: 'p4-2', phase: 4, n: 2,
    title: ({ c }) => (c.recipe.frozenBalls > 0 ? `Frozen batch: raw flash freeze (${c.recipe.frozenBalls} balls)` : 'Raw flash freeze (not in use)'),
    badge: ({ c, S }) => (c.recipe.frozenBalls > 0 ? `${Math.round(S.freezeFlashMin)} min` : 'SKIPPED'),
    skipWhen: ({ c }) => c.recipe.frozenBalls === 0,
    body: ({ c, S }) =>
      c.recipe.frozenBalls === 0
        ? `Not applicable. Every ball in this batch is baking fresh, so nothing goes into the freezer.`
        : `Place the remaining ${b(`${c.recipe.frozenBalls} balls`)} on a parchment-lined sheet pan, ${b(`uncovered for ${S.freezeFlashMin} minutes`)}, until crust-frozen. Wrap individually (the oil veil stops them sticking), bag, and deep freeze.`,
  },
  {
    id: 'p4-3', phase: 4, n: 3,
    title: ({ c }) => (c.recipe.frozenBalls > 0 ? 'Frozen protocol: thaw and extended temper' : 'Frozen protocol (not in use)'),
    badge: ({ c, S }) => (c.recipe.frozenBalls > 0 ? `${S.thawFridgeHours} h thaw` : 'SKIPPED'),
    skipWhen: ({ c }) => c.recipe.frozenBalls === 0,
    body: ({ c, S, u }) =>
      c.recipe.frozenBalls === 0
        ? `Not applicable. No balls are in the freezer, so the thaw track is inactive.`
        : `Weeks later: move the frozen balls to the ${fmtTemp(S.fridgeTempC, u)} fridge ${b(fmtDuration(S.thawFridgeHours + S.frozenTemperHours))} before launch for a ${b(`${S.thawFridgeHours} h slow defrost`)}. Pull them to room temperature ${b(fmtDuration(S.frozenTemperHours))} before launch.`,
  },

  {
    id: 'p5-1', phase: 5, n: 1,
    title: () => 'Temper the balls at room temperature',
    badge: ({ S }) => fmtDuration(S.temperHours),
    body: ({ S, u }) =>
      `Pull the box from the fridge ${b(fmtDuration(S.temperHours))} before launch and keep it covered. Target internal core temperature ${b(`${fmtTemp(17.2, u)} to ${fmtTemp(18.9, u)}`)}. A poked ball should spring back slowly.`,
    metrics: ['coreTempC'],
  },
  {
    id: 'p5-2', phase: 5, n: 2,
    title: () => 'Fire the oven and heat-soak the floor',
    badge: ({ S }) => `${S.preheatMin} min soak`,
    body: ({ S, u }) =>
      `Preheat on full. Target floor temperature ${b(fmtTemp(S.deckTempC, u))} in the centre of the deck, dome ${b(fmtTemp(S.domeTempC, u))}. A cold floor is the single most common cause of a pale, sluggish bake.`,
    metrics: ['deckTempC', 'domeTempC'],
  },
  {
    id: 'p5-3', phase: 5, n: 3,
    title: () => 'Gas migration finger press and knuckle stretch',
    badge: () => '1 min',
    body: () =>
      `Dredge the ball in semola rimacinata. Press with the flat pads of three middle fingers from the centre outwards. ${b('Never touch the outer 2 to 2.5 cm rim.')} You are pushing trapped gas into the border. Knuckle stretch the centre to roughly 11 to 12 inches.`,
  },
  {
    id: 'p5-4', phase: 5, n: 4,
    title: ({ S }) => `Modulated bake (${S.bakeSec} sec)`,
    badge: ({ S }) => `${S.bakeSec} sec`,
    body: ({ S }) =>
      `Turn the heat down 30 seconds before launch. Land away from the burner and leave it untouched while the base sets. Rotate 180°, go to full heat, then quarter-turn every 10 to 15 seconds for blistering. Target ${b(`${S.bakeSec} seconds`)}.`,
    metrics: ['bakeSec', 'canotto', 'honeycomb', 'blistering'],
  },
];

export const STEP_IDS = STEPS.map((s) => s.id);

export function stepsForPhase(n) {
  return STEPS.filter((s) => s.phase === n);
}

/** Steps that actually apply, given the current recipe (frozen track can drop out). */
export function activeSteps(ctx) {
  return STEPS.filter((s) => !(s.skipWhen && s.skipWhen(ctx)));
}
