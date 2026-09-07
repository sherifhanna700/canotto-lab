// Fermentation model.
//
// The point of this module is to make two different schedules comparable.
// "18 h at 18 °C" and "66 h at 3 °C" are not the same amount of fermentation,
// so the app reduces any schedule to a single number: Fermentation Units (FU).
//
//   1 FU = one hour at the reference temperature (20 °C).
//
// Rate follows a Q10 law: every 10 °C roughly multiplies activity by Q10.
// Yeast does not follow one Q10 across the whole range, so the model uses a
// steeper coefficient in the cold zone (a fridge slows dough far more than a
// single Q10 predicts) and rolls activity off again above the optimum.
//
// The constants are exposed and user-calibratable on purpose. They are a
// starting point, not physics. Log bakes, then tune K until the model's
// "ready" call matches the dough you actually pulled out of the fridge.

export const DEFAULT_MODEL = {
  refTempC: 20,
  q10Warm: 2.2, // 15 °C and above
  q10Cold: 3.2, // below 15 °C, where activity falls off faster
  coldBreakC: 15,
  optimumC: 35, // past this, heat stress cuts activity
  heatRolloff: 9,
  // K ties inoculation to ripeness: yeast% x FU is roughly constant.
  // Anchored to the Contemporary Canotto reference bake, which ripens on
  // 0.10% IDY across 24.2 FU, so K = 2.42. Recalibrate from your own log.
  k: 2.42,
};

/** Relative fermentation rate at a temperature, 1.0 at the reference temp. */
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
  // Below freezing the dough is parked, not fermenting.
  if (tempC <= -1) r *= 0.02;
  return Math.max(0, r);
}

/** Total fermentation delivered by a list of {hours, tempC} stages. */
export function fermentUnits(stages, m = DEFAULT_MODEL) {
  return (stages || []).reduce((sum, s) => {
    const h = Number(s.hours) || 0;
    return sum + h * rateAt(Number(s.tempC), m);
  }, 0);
}

/** Per-stage FU plus the running total, for the contribution chart. */
export function stageBreakdown(stages, m = DEFAULT_MODEL) {
  let running = 0;
  return (stages || []).map((s) => {
    const fu = (Number(s.hours) || 0) * rateAt(Number(s.tempC), m);
    running += fu;
    return { ...s, rate: rateAt(Number(s.tempC), m), fu, cumulative: running };
  });
}

/** Inoculation (as IDY %) that ripens a dough in the given FU. */
export function yeastForFU(fu, m = DEFAULT_MODEL) {
  if (!fu || fu <= 0) return NaN;
  return m.k / fu;
}

/** The inverse: FU a given IDY inoculation is aiming at. */
export function fuForYeast(idyPct, m = DEFAULT_MODEL) {
  if (!idyPct || idyPct <= 0) return NaN;
  return m.k / idyPct;
}

/** Hours at one temperature to reach a target FU. */
export function hoursToFU(targetFU, tempC, m = DEFAULT_MODEL) {
  const r = rateAt(tempC, m);
  if (r <= 0) return Infinity;
  return targetFU / r;
}

/**
 * How ripe a schedule is against the inoculation it carries.
 * 1.0 means the model thinks the dough peaks exactly at the end of the schedule.
 */
export function ripeness(stages, idyPct, m = DEFAULT_MODEL) {
  const fu = fermentUnits(stages, m);
  const target = fuForYeast(idyPct, m);
  if (!Number.isFinite(target) || target <= 0) return NaN;
  return fu / target;
}

export function ripenessVerdict(ratio) {
  if (!Number.isFinite(ratio)) return { key: 'unknown', label: 'Not enough data', tone: 'neutral' };
  if (ratio < 0.55) return { key: 'very-under', label: 'Well under-fermented', tone: 'bad' };
  if (ratio < 0.85) return { key: 'under', label: 'Under-fermented', tone: 'warn' };
  if (ratio <= 1.2) return { key: 'on', label: 'In the window', tone: 'good' };
  if (ratio <= 1.7) return { key: 'over', label: 'Over-fermented', tone: 'warn' };
  return { key: 'very-over', label: 'Well over-fermented', tone: 'bad' };
}

/**
 * Desired dough temperature solver.
 * Three-factor for a direct dough, four-factor when a preferment goes in cold.
 */
export function waterTempFor({ ddtC, flourTempC, roomTempC, frictionC = 9, prefermentTempC = null }) {
  const factors = prefermentTempC === null ? 3 : 4;
  const others = flourTempC + roomTempC + frictionC + (prefermentTempC === null ? 0 : prefermentTempC);
  return ddtC * factors - others;
}

/** A curve of required IDY % across a span of hours at one temperature. */
export function yeastCurve(tempC, fromH, toH, steps = 24, m = DEFAULT_MODEL) {
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const hours = fromH + ((toH - fromH) * i) / steps;
    const fu = hours * rateAt(tempC, m);
    out.push({ x: hours, y: yeastForFU(fu, m) });
  }
  return out;
}

/**
 * Fit K from bakes the baker graded as correctly proofed.
 * Each sample is {fu, idyPct}. K is the median of fu x idyPct.
 */
export function calibrateK(samples) {
  const ks = (samples || [])
    .map((s) => s.fu * s.idyPct)
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  if (!ks.length) return null;
  const mid = Math.floor(ks.length / 2);
  return ks.length % 2 ? ks[mid] : (ks[mid - 1] + ks[mid]) / 2;
}
