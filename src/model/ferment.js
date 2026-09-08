// Fermentation and maturation.
//
// Two processes run in a dough at once and they answer to cold differently.
//
//   Fermentation is the yeast: carbon dioxide, rise, and being "proofed".
//   Maturation is the flour's own enzymes: amylase freeing sugar, protease
//   shortening gluten. It is what makes a dough extensible and flavoured.
//
// Yeast falls to roughly a tenth of its room-temperature rate at 4 °C while
// enzymes keep 40 to 50% of theirs. That gap is the whole reason cold proofing
// works: it does not slow a dough down evenly, it slows the yeast far more than
// the enzymes, so a long cold hold buys maturation without gassing the dough
// out. A single number cannot describe that, so this module keeps two.
//
// Both curves are anchored to published figures rather than to constants
// chosen to make a favourite recipe come out right:
//
//   Yeast    doubles per 10 °C in the warm range, and sits at about 10% of its
//            room-temperature rate at 4 °C.
//   Enzymes  retain 40 to 50% at 4 °C, which is a far flatter curve.
//
// One unit of either is one hour at 20 °C. See the app's sources for both.

export const REFERENCE_TEMP_C = 20;

export const DEFAULT_MODEL = {
  refTempC: REFERENCE_TEMP_C,

  // Yeast. q10Warm is the textbook doubling; q10Cold is what it takes to land
  // on the published 10% at 4 °C, given that doubling above the break.
  q10Warm: 2,
  q10Cold: 5.92,
  coldBreakC: 15,
  optimumC: 35,
  heatRolloff: 9,

  // Enzymes. Flat enough to hold 45% at 4 °C, the middle of the published band.
  q10Enzyme: 1.65,
};

/** Yeast activity, 1.0 at the reference temperature. */
export function rateAt(tempC, m = DEFAULT_MODEL) {
  if (!Number.isFinite(tempC)) return 0;
  let r;
  if (tempC >= m.coldBreakC) {
    r = m.q10Warm ** ((tempC - m.refTempC) / 10);
  } else {
    const atBreak = m.q10Warm ** ((m.coldBreakC - m.refTempC) / 10);
    r = atBreak * m.q10Cold ** ((tempC - m.coldBreakC) / 10);
  }
  if (tempC > m.optimumC) r *= Math.exp(-(((tempC - m.optimumC) / m.heatRolloff) ** 2));
  if (tempC <= -1) r *= 0.02;
  return Math.max(0, r);
}

/** Enzyme activity, 1.0 at the reference temperature. Far flatter than yeast. */
export function maturationRateAt(tempC, m = DEFAULT_MODEL) {
  if (!Number.isFinite(tempC)) return 0;
  const r = m.q10Enzyme ** ((tempC - m.refTempC) / 10);
  if (tempC <= -1) return r * 0.05;
  return Math.max(0, r);
}

/** Yeast work delivered by a list of {hours, tempC} stages. */
export function fermentUnits(stages, m = DEFAULT_MODEL) {
  return (stages || []).reduce((sum, s) => sum + (Number(s.hours) || 0) * rateAt(Number(s.tempC), m), 0);
}

/** Enzyme work delivered by the same stages. */
export function maturationUnits(stages, m = DEFAULT_MODEL) {
  return (stages || []).reduce((sum, s) => sum + (Number(s.hours) || 0) * maturationRateAt(Number(s.tempC), m), 0);
}

/** Per-stage contribution of both, plus running totals, for the phase table. */
export function stageBreakdown(stages, m = DEFAULT_MODEL) {
  let ferment = 0;
  let mature = 0;
  return (stages || []).map((s) => {
    const hours = Number(s.hours) || 0;
    const fu = hours * rateAt(Number(s.tempC), m);
    const mu = hours * maturationRateAt(Number(s.tempC), m);
    ferment += fu;
    mature += mu;
    return { ...s, rate: rateAt(Number(s.tempC), m), matRate: maturationRateAt(Number(s.tempC), m), fu, mu, cumulative: ferment, cumulativeMu: mature };
  });
}

/**
 * Inoculation for a schedule, scaled from a bake that came out right.
 *
 * Yeast quantity and yeast work trade off close to inversely, so if a known
 * good bake used `refYeastPct` across `refFU`, the same dough over `fu` wants
 * that product divided back out. No absolute constant is involved, and the
 * reference is a real dough rather than a number chosen to flatter one.
 */
export function yeastForFU(fu, { refYeastPct, refFU }) {
  if (!(fu > 0) || !(refYeastPct > 0) || !(refFU > 0)) return NaN;
  return (refYeastPct * refFU) / fu;
}

/** How this schedule's yeast work compares with the reference bake's. */
export function fermentRatio(fu, refFU) {
  if (!(refFU > 0) || !(fu > 0)) return NaN;
  return fu / refFU;
}

/**
 * Specific heat, kJ per kg per K. Water carries more than twice the heat of
 * flour for the same mass, which is why a plain mass average is not enough.
 * Water is exact; flour is the usual figure for dry wheat flour.
 */
export const SPECIFIC_HEAT = { water: 4.18, flour: 1.8, other: 2.0 };

/**
 * Where the dough finishes, by heat balance over the real masses.
 *
 * This predicts rather than prescribes, and the distinction matters. The
 * rule-of-thumb DDT formulas answer "how warm should the water be to reach a
 * target", which is the wrong question for a cold-biga dough: the biga is most
 * of the mass, it comes out of the fridge deliberately, and the water is there
 * to keep the mix cold while the gluten develops, not to warm it up. The
 * target is a ceiling to stay under, and the only thing pushing towards it is
 * the mixer.
 *
 * Friction is the uncertain term, so it is measurable: see frictionFrom below.
 */
export function doughTempFrom({ weigh, prefermentTempC, flourTempC, waterTempC, frictionC }) {
  const { water: cw, flour: cf, other: co } = SPECIFIC_HEAT;
  const parts = [
    [weigh.flour.biga * cf, prefermentTempC],
    [weigh.water.biga * cw, prefermentTempC],
    [weigh.flour.final * cf, flourTempC],
    [(weigh.salt + weigh.oil) * co, flourTempC],
    [weigh.water.final * cw, waterTempC],
  ];
  const capacity = parts.reduce((sum, [c]) => sum + c, 0);
  if (!capacity) return NaN;
  const heat = parts.reduce((sum, [c, t]) => sum + c * t, 0);
  return heat / capacity + frictionC;
}

/**
 * What your mixer actually adds, from one measured final dough temperature.
 *
 * Published friction factors span 8 to 16 °C for a stand mixer, which is a
 * range too wide to predict anything useful with. Measuring the dough once
 * replaces every guess in this calculation with the baker's own kit.
 */
export function frictionFrom({ weigh, prefermentTempC, flourTempC, waterTempC, measuredDoughC }) {
  const withoutFriction = doughTempFrom({ weigh, prefermentTempC, flourTempC, waterTempC, frictionC: 0 });
  if (!Number.isFinite(withoutFriction)) return NaN;
  return measuredDoughC - withoutFriction;
}

/** How the finishing temperature reads against the target and the hard stop. */
export function doughTempVerdict(landsAtC, targetC, stopC) {
  if (!Number.isFinite(landsAtC)) return { key: 'unknown', tone: 'neutral', label: 'Not enough to say' };
  if (landsAtC >= stopC) return { key: 'over', tone: 'bad', label: 'Past the hard stop' };
  if (landsAtC > targetC + 1) return { key: 'warm', tone: 'warn', label: 'Warmer than the target' };
  if (landsAtC < targetC - 4) return { key: 'cold', tone: 'warn', label: 'Colder than the target' };
  return { key: 'on', tone: 'good', label: 'In the window' };
}

/**
 * The three- and four-factor rule, kept only so a baker can compare against
 * what their recipe book says. It is not used for advice: it treats every
 * component as equal mass and equal heat capacity, which is wrong whenever a
 * preferment dominates the dough.
 */
export function waterTempFor({ ddtC, flourTempC, roomTempC, frictionC = 9, prefermentTempC = null }) {
  const factors = prefermentTempC === null ? 3 : 4;
  const others = flourTempC + roomTempC + frictionC + (prefermentTempC === null ? 0 : prefermentTempC);
  return ddtC * factors - others;
}

