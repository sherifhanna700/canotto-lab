// Suggestions for a biga canotto dough.
//
// Two questions, answered by two different things.
//
//   How long?        Set by maturation. A flour's W value is a budget of enzyme
//                    work before the gluten gives out, so the durations are
//                    solved to spend most of that budget and no more, at the
//                    baker's own fridge temperature. The same 66 hours means
//                    very different things at 34 °F and at 43 °F.
//
//   How much yeast?  Set by fermentation, scaled from a dough that came out
//                    right. Yeast quantity and yeast work trade off inversely,
//                    so a reference bake is all that is needed and no invented
//                    constant is involved.
//
// The phase proportions come from the house protocol, so a stronger flour
// stretches that schedule and a weaker one shortens it.

import { maturationUnits, fermentUnits, maturationRateAt, yeastForFU, DEFAULT_MODEL } from './ferment.js?v=ac46926e';
import { maturationCeilingForW, hydrationRangeForW, findFlour } from './flours.js?v=ac46926e';
import { DEFAULT_SCHEDULE } from './protocol.js?v=ac46926e';

/** Share of total maturation time each phase takes, from the house protocol. */
const TIME_SHARES = { bigaRest: 0.043, bigaCold: 0.192, coldProof: 0.72, temper: 0.045 };

/** Canotto runs wetter than the conservative published hydration guide. */
const CANOTTO_HYDRATION_SHIFT = 2;

/** Grades that shift how much water the blend will take, in points. */
const ABSORPTION = { Integrale: 4, Whole: 4, Semola: -1.5 };

/** Aim to spend most of a flour's maturation budget, leaving a margin. */
export const MATURATION_TARGET = 0.9;

/** The band inside which a cold proof is neither short nor overlong. */
export const MATURATION_WINDOW = { low: 0.6, high: 1.0 };

/**
 * The dough the app scales yeast from until the baker has logged one of their
 * own. These are the house protocol's own figures, not a fitted constant.
 */
export const HOUSE_REFERENCE = { label: 'the house protocol', yeastPct: 0.1, fu: 17.2 };

function absorptionShift(flours) {
  const list = (flours || []).filter((e) => Number(e.pct) > 0);
  const total = list.reduce((s, e) => s + Number(e.pct), 0) || 1;
  let shift = 0;
  for (const e of list) {
    const src = e.id ? findFlour(e.id) : null;
    const grade = e.grade || src?.grade;
    shift += (ABSORPTION[grade] ?? 0) * (Number(e.pct) / total);
  }
  return shift;
}

export function strengthBand(w) {
  if (!Number.isFinite(w)) return { key: 'unknown', label: 'Unknown strength', blurb: '' };
  if (w < 260) return { key: 'weak', label: 'Soft for a biga', blurb: 'Keep the maturation short, or blend in something stronger.' };
  if (w < 300) return { key: 'strong', label: 'Strong', blurb: 'Comfortable to about 48 units of maturation.' };
  if (w < 340) return { key: 'very-strong', label: 'Very strong', blurb: 'Built for biga and a long cold proof.' };
  return { key: 'extra-strong', label: 'Extra strong', blurb: 'Takes more maturation than most schedules will give it.' };
}

/** Bench work is a handling requirement, not a lever. Its length is fixed. */
function benchHours() {
  return (
    DEFAULT_SCHEDULE.finalMixMin +
    DEFAULT_SCHEDULE.benchRest1Min +
    DEFAULT_SCHEDULE.benchRest2Min +
    5 +
    DEFAULT_SCHEDULE.oilRestMin +
    DEFAULT_SCHEDULE.ballingMin
  ) / 60;
}

function tempsFrom(opts) {
  return {
    roomC: opts.roomTempC ?? DEFAULT_SCHEDULE.bigaRoomTempC,
    fridgeC: opts.fridgeTempC ?? DEFAULT_SCHEDULE.fridgeTempC,
    benchC: opts.benchTempC ?? DEFAULT_SCHEDULE.benchTempC,
  };
}

/** Lay the house protocol's shape over a given total, at given temperatures. */
function stagesFor(totalHours, temps) {
  const bench = benchHours();
  const spread = Math.max(2, totalHours - bench);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const bigaRestHours = clamp(spread * TIME_SHARES.bigaRest, 1.5, 8);
  const bigaColdHours = clamp(spread * TIME_SHARES.bigaCold, 4, 36);
  const temperHours = clamp(spread * TIME_SHARES.temper, 1.5, 8);
  const coldProofHours = clamp(spread - bigaRestHours - bigaColdHours - temperHours, 2, 240);
  return {
    hours: { bigaRestHours, bigaColdHours, coldProofHours, temperHours },
    stages: [
      { name: 'Biga ambient rest', hours: bigaRestHours, tempC: temps.roomC },
      { name: 'Biga cold hold', hours: bigaColdHours, tempC: temps.fridgeC },
      { name: 'Mix & bench', hours: bench, tempC: temps.benchC },
      { name: 'Cold proof', hours: coldProofHours, tempC: temps.fridgeC },
      { name: 'Counter temper', hours: temperHours, tempC: temps.roomC },
    ],
  };
}

/**
 * Total hours that spend a given share of the flour's maturation budget.
 *
 * Solved rather than assumed. A colder fridge needs more hours to reach the
 * same maturation, which is the answer a pizzaiolo actually wants from their
 * own kitchen rather than from a recipe written in someone else's.
 */
export function hoursForMaturation(blend, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const ceiling = maturationCeilingForW(blend?.w);
  if (!ceiling) return null;
  const target = ceiling * (opts.fraction ?? MATURATION_TARGET);
  const temps = tempsFrom(opts);

  // Maturation rises with total time, so bisect for the total that reaches it.
  let lo = benchHours() + 2;
  let hi = 600;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (maturationUnits(stagesFor(mid, temps).stages, model) < target) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}

/**
 * How long the cold proof itself should run, for this flour at this fridge
 * temperature, holding the rest of the schedule as it stands.
 *
 * This is the question a pizzaiolo asks out loud: my flour is this, my fridge
 * is this, how long do the balls sit? It is answered by working out how much
 * maturation the other phases already spend, and how many hours in the cold it
 * takes to spend the rest of the budget.
 */
export function coldProofWindow({ blend, schedule, model = DEFAULT_MODEL }) {
  const ceiling = maturationCeilingForW(blend?.w);
  if (!ceiling || !schedule) return null;

  const S = { ...DEFAULT_SCHEDULE, ...schedule };
  const bench = benchHours();
  const others = [
    { hours: S.bigaRestHours, tempC: S.bigaRoomTempC },
    { hours: S.bigaColdHours, tempC: S.bigaFridgeTempC },
    { hours: bench, tempC: S.benchTempC },
    { hours: S.temperHours, tempC: S.roomTempC },
  ];
  const spentElsewhere = maturationUnits(others, model);
  const perHour = maturationRateAt(S.fridgeTempC, model);
  if (!(perHour > 0)) return null;

  const hoursFor = (fraction) => Math.max(0, (ceiling * fraction - spentElsewhere) / perHour);

  // When the biga and the bench have already spent most of what the flour can
  // take, the cold proof is not really the problem. A 24-hour biga costs the
  // same maturation whatever flour it is made from, so on a weaker flour it
  // can leave almost nothing for the fridge. Say that, rather than reporting a
  // window starting at zero as though it were a normal recommendation.
  const crowded = spentElsewhere >= ceiling * MATURATION_WINDOW.low;

  return {
    ceiling,
    fridgeTempC: S.fridgeTempC,
    spentElsewhere,
    perHour,
    crowded,
    headroom: Math.max(0, ceiling - spentElsewhere),
    low: hoursFor(MATURATION_WINDOW.low),
    ideal: hoursFor(MATURATION_TARGET),
    high: hoursFor(MATURATION_WINDOW.high),
    actual: S.coldProofHours,
  };
}

/** Is the cold proof too short, about right, or too long? */
export function coldProofVerdict(window) {
  if (!window) return { key: 'unknown', tone: 'neutral', label: 'No strength figure for this flour' };
  const { actual, low, high } = window;
  if (actual < low * 0.75) return { key: 'far-short', tone: 'bad', label: 'Much too short' };
  if (actual < low) return { key: 'short', tone: 'warn', label: 'Short' };
  if (actual > high * 1.25) return { key: 'far-long', tone: 'bad', label: 'Much too long' };
  if (actual > high) return { key: 'long', tone: 'warn', label: 'Long' };
  return { key: 'on', tone: 'good', label: 'About right' };
}

/** The published maturation window for a blend, as hours at 20 °C. */
export function defaultLeadHours(blend) {
  const f = blend?.ferment;
  if (!f) return 48;
  return Math.round((f[0] + f[1]) / 2);
}

/**
 * A full proposal for a blend at a baker's temperatures.
 * `reference` is a dough that came out right: {label, yeastPct, fu}.
 */
export function suggestPlan(blend, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const w = blend?.w;
  const temps = tempsFrom(opts);

  const solvedHours = hoursForMaturation(blend, { ...opts, model });
  const totalHours = Number.isFinite(opts.totalHours) ? opts.totalHours : (solvedHours ?? 72);
  const laid = stagesFor(totalHours, temps);

  const fu = fermentUnits(laid.stages, model);
  const mu = maturationUnits(laid.stages, model);
  const ceiling = maturationCeilingForW(w);
  const reference = opts.reference || HOUSE_REFERENCE;
  const idyPct = yeastForFU(fu, { refYeastPct: reference.yeastPct, refFU: reference.fu });

  const range = hydrationRangeForW(w, CANOTTO_HYDRATION_SHIFT);
  const shift = absorptionShift(opts.flours);
  const hydration = range
    ? {
        low: Math.round(range.low + shift),
        recommended: Math.round((range.low + range.high) / 2 + shift),
        high: Math.round(range.high + shift),
        band: range.band,
      }
    : null;

  return {
    band: strengthBand(w),
    totalHours,
    solvedHours,
    fu,
    mu,
    maturationCeiling: ceiling,
    maturationLoad: ceiling ? mu / ceiling : null,
    idyPct,
    reference,
    hydration,
    stages: laid.stages,
    schedule: {
      bigaRestHours: round1(laid.hours.bigaRestHours),
      bigaColdHours: round1(laid.hours.bigaColdHours),
      coldProofHours: round1(laid.hours.coldProofHours),
      temperHours: round1(laid.hours.temperHours),
      bigaRoomTempC: temps.roomC,
      bigaFridgeTempC: temps.fridgeC,
      fridgeTempC: temps.fridgeC,
      roomTempC: temps.roomC,
      benchTempC: temps.benchC,
    },
    recipePatch: {
      hydrationPct: hydration ? hydration.recommended : 70,
      baseYeastPct: Number.isFinite(idyPct) ? Math.round(idyPct * 1000) / 1000 : 0.1,
    },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Notes on a schedule the baker has already built. */
export function reviewPlan({ blend, stages, schedule, idyPct, reference = HOUSE_REFERENCE, model = DEFAULT_MODEL }) {
  const notes = [];
  const mu = maturationUnits(stages, model);
  const fu = fermentUnits(stages, model);
  const ceiling = maturationCeilingForW(blend?.w);

  if (Number.isFinite(ceiling)) {
    const load = mu / ceiling;
    if (load > 1.15) {
      notes.push({ key: 'maturation', tone: 'bad', text: `This asks ${mu.toFixed(0)} units of maturation from a flour good for about ${ceiling}. The enzymes will have gone too far: expect a slack dough that tears when you open it.` });
    } else if (load > 0.98) {
      notes.push({ key: 'maturation', tone: 'warn', text: `Maturation is at the top of what W ${blend.w} can take. It will work, with no margin if the fridge runs warm.` });
    } else if (load < 0.5) {
      notes.push({ key: 'maturation', tone: 'warn', text: 'This flour can take about twice this much maturation. A longer cold proof would buy flavour and extensibility you are leaving behind.' });
    } else {
      notes.push({ key: 'maturation', tone: 'good', text: `Maturation is at ${(load * 100).toFixed(0)}% of what this blend can take, which is a comfortable place to be.` });
    }
  }

  const suggested = yeastForFU(fu, { refYeastPct: reference.yeastPct, refFU: reference.fu });
  if (Number.isFinite(suggested) && Number.isFinite(idyPct) && idyPct > 0) {
    const ratio = idyPct / suggested;
    if (ratio > 1.25) notes.push({ key: 'yeast', tone: 'warn', text: `Against ${reference.label}, this carries ${(ratio * 100 - 100).toFixed(0)}% more yeast than the timing needs. Nearer ${suggested.toFixed(3)}%.` });
    else if (ratio < 0.75) notes.push({ key: 'yeast', tone: 'warn', text: `Against ${reference.label}, this carries ${(100 - ratio * 100).toFixed(0)}% less yeast than the timing needs. Nearer ${suggested.toFixed(3)}%.` });
  }

  if (Number.isFinite(blend?.w) && blend.w < 260) {
    notes.push({ key: 'soft-flour', tone: 'warn', text: `W ${blend.w} is soft for a biga. Blend in a stronger flour, or keep the maturation short.` });
  }

  return { fu, mu, ceiling, window: coldProofWindow({ blend, schedule, model }), notes };
}
