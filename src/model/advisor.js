// Flour-aware planner.
//
// A flour's W value is a fermentation budget. A W 250 flour cannot hold a
// 72-hour schedule, and a W 380 flour is wasted on an 8-hour one. This module
// turns a blend into a concrete proposal: hydration, which phases to run, how
// long each one lasts at the temperatures you actually have, and the
// inoculation that lands the dough ripe at the end.
//
// The FU split between phases is taken from the Contemporary Canotto reference
// bake, so a strong flour scales that protocol up and a weak one scales it down
// instead of inventing a different shape of schedule.

import { rateAt, yeastForFU, DEFAULT_MODEL } from './ferment.js';
import { fuCeilingForW, hydrationRangeForW, findFlour } from './flours.js';
import { DEFAULT_SCHEDULE } from './protocol.js';

/**
 * Share of total maturation TIME each phase takes, by method.
 * The biga figures are the proportions of the Contemporary Canotto reference
 * bake, so a flour rated for a longer window stretches that protocol rather
 * than becoming a different one.
 */
/** Hydration offsets by finished style, in points of baker's percentage. */
export const STYLES = [
  { id: 'canotto', label: 'Contemporary canotto', shift: 2, blurb: 'Tall hollow rim, 60 to 90 second bake.' },
  { id: 'napoletana', label: 'Classic Napoletana', shift: 0, blurb: 'Traditional STG proportions, soft rim.' },
  { id: 'ny', label: 'New York', shift: -6, blurb: 'Foldable slice, deck oven, oil and sugar in the dough.' },
  { id: 'teglia', label: 'Teglia / pan', shift: 9, blurb: 'Very high hydration, baked in a tray.' },
  { id: 'tonda', label: 'Roman tonda', shift: -8, blurb: 'Thin and crisp, low hydration, oil in the dough.' },
];

export function styleShift(id) {
  return STYLES.find((s) => s.id === id)?.shift ?? 0;
}

/** Grades that shift how much water the blend will take, in points. */
const ABSORPTION = { Integrale: 4, Whole: 4, Rye: 3, Semola: -1.5 };

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

const TIME_SHARES = {
  biga: { bigaRest: 0.043, bigaCold: 0.192, coldProof: 0.72, temper: 0.045 },
  poolish: { bigaRest: 0.09, bigaCold: 0.05, coldProof: 0.815, temper: 0.045 },
  direct: { bigaRest: 0, bigaCold: 0, coldProof: 0.95, temper: 0.05 },
};

/** Preferment shape by method. Biga hydration 44 to 45% is the published norm. */
const PREFERMENT = {
  biga: { flourPct: 100, hydrationPct: 45, yeastShare: 1 },
  poolish: { flourPct: 35, hydrationPct: 100, yeastShare: 1 },
  direct: { flourPct: 0, hydrationPct: 0, yeastShare: 0 },
};

/** Which method a blend can actually support. */
export function suggestMethod(w) {
  if (!Number.isFinite(w)) return 'direct';
  if (w >= 285) return 'biga';
  if (w >= 240) return 'poolish';
  return 'direct';
}

export function strengthBand(w) {
  if (!Number.isFinite(w)) return { key: 'unknown', label: 'Unknown strength' };
  if (w < 220) return { key: 'weak', label: 'Weak', blurb: 'Same-day or overnight doughs only.' };
  if (w < 260) return { key: 'medium', label: 'Medium', blurb: 'Comfortable to about 24 to 36 hours.' };
  if (w < 300) return { key: 'strong', label: 'Strong', blurb: 'Handles 48 hours and a preferment.' };
  if (w < 340) return { key: 'very-strong', label: 'Very strong', blurb: 'Built for biga and 60 to 72 hours.' };
  return { key: 'extra-strong', label: 'Extra strong', blurb: 'Blend it down, or run 72 hours plus.' };
}

/** Middle of the published maturation window for a blend. */
export function defaultLeadHours(blend) {
  const f = blend?.ferment;
  if (!f) return 48;
  return Math.round((f[0] + f[1]) / 2);
}

/**
 * Propose a full plan for a blend.
 *
 * The published maturation window sets how long the dough matures. The
 * fermentation model then sets the inoculation that lands it ripe at the end of
 * that window, at the temperatures this baker actually has.
 */
export function suggestPlan(blend, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const w = blend?.w;
  const method = opts.method || suggestMethod(w);
  const roomC = opts.roomTempC ?? DEFAULT_SCHEDULE.bigaRoomTempC;
  const fridgeC = opts.fridgeTempC ?? DEFAULT_SCHEDULE.fridgeTempC;
  const benchTempC = opts.benchTempC ?? DEFAULT_SCHEDULE.benchTempC;

  const window = blend?.ferment || null;
  const totalHours = Number.isFinite(opts.totalHours) ? opts.totalHours : defaultLeadHours(blend);

  const benchMin =
    DEFAULT_SCHEDULE.finalMixMin +
    DEFAULT_SCHEDULE.benchRest1Min +
    DEFAULT_SCHEDULE.benchRest2Min +
    5 +
    DEFAULT_SCHEDULE.oilRestMin +
    DEFAULT_SCHEDULE.ballingMin;
  const benchHours = benchMin / 60;

  const share = TIME_SHARES[method];
  const spread = Math.max(2, totalHours - benchHours);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const bigaRestHours = share.bigaRest ? clamp(spread * share.bigaRest, 1.5, 8) : 0;
  const bigaColdHours = share.bigaCold ? clamp(spread * share.bigaCold, 4, 36) : 0;
  const temperHours = clamp(spread * share.temper, 1.5, 8);
  const coldProofHours = clamp(spread - bigaRestHours - bigaColdHours - temperHours, 2, 168);

  const stages = [
    { name: 'Biga ambient rest', hours: bigaRestHours, tempC: roomC },
    { name: 'Biga cold hold', hours: bigaColdHours, tempC: fridgeC },
    { name: 'Mix & bench', hours: benchHours, tempC: benchTempC },
    { name: 'Cold proof', hours: coldProofHours, tempC: fridgeC },
    { name: 'Counter temper', hours: temperHours, tempC: roomC },
  ].filter((s) => s.hours > 0);

  const actualFU = stages.reduce((sum, s) => sum + s.hours * rateAt(s.tempC, model), 0);
  const ceiling = fuCeilingForW(w);
  const idyPct = yeastForFU(actualFU, model);

  const range = hydrationRangeForW(w, styleShift(opts.style || 'canotto'));
  const shift = absorptionShift(opts.flours);
  const hydration = range
    ? {
        low: Math.round(range.low + shift),
        recommended: Math.round((range.low + range.high) / 2 + shift),
        high: Math.round(range.high + shift),
        band: range.band,
      }
    : null;

  const band = strengthBand(w);
  const rationale = [];
  if (window) {
    rationale.push(
      blend.fermentSourced
        ? `Published maturation window for this blend is ${window[0]} to ${window[1]} hours. This plan runs ${Math.round(totalHours)}.`
        : `No published window for this blend, so the ${blend.band?.label || 'W band'} guide is used: ${window[0]} to ${window[1]} hours.`
    );
  }
  if (Number.isFinite(w)) {
    rationale.push(`W ${w} is ${band.label.toLowerCase()}. ${band.blurb}${blend?.estimated ? ' W is estimated from protein, not published.' : ''}`);
  }
  rationale.push(
    method === 'direct'
      ? 'Below about W 240 a preferment adds risk without adding much, so this plan mixes direct.'
      : method === 'biga'
        ? 'A stiff biga at 45% hydration builds flavour and extensibility without spending the gluten this flour has.'
        : 'A poolish suits this strength better than a stiff biga, and still buys flavour over a direct mix.'
  );
  if (hydration) rationale.push(`Hydration comes from the ${hydration.band} guide, moved for the chosen style.`);
  if (shift > 0.5) rationale.push(`Whole grain in the blend drinks more water, so the target is up ${shift.toFixed(1)} points.`);
  if (shift < -0.5) rationale.push(`Durum in the blend absorbs less, so the target is down ${Math.abs(shift).toFixed(1)} points.`);
  rationale.push(
    `At ${fridgeC.toFixed(0)} °C the dough ferments at ${(rateAt(fridgeC, model) * 100).toFixed(0)}% of its room-temperature rate, which is why the cold proof carries most of the clock.`
  );

  const pf = PREFERMENT[method];
  return {
    method,
    band,
    window,
    totalHours,
    ceilingFU: ceiling,
    actualFU,
    idyPct,
    hydration,
    stages,
    rationale,
    schedule: {
      bigaRestHours: round1(bigaRestHours),
      bigaColdHours: round1(bigaColdHours),
      coldProofHours: round1(coldProofHours),
      temperHours: round1(temperHours),
      bigaRoomTempC: roomC,
      bigaFridgeTempC: fridgeC,
      fridgeTempC: fridgeC,
      roomTempC: roomC,
      benchTempC,
    },
    recipePatch: {
      method,
      hydrationPct: hydration ? hydration.recommended : 70,
      prefermentFlourPct: pf.flourPct,
      prefermentHydrationPct: pf.hydrationPct,
      prefermentYeastShare: pf.yeastShare,
      baseYeastPct: Number.isFinite(idyPct) ? Math.round(idyPct * 1000) / 1000 : 0.1,
    },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Check a schedule the baker has already built against what the flour can take.
 * Returns notes rather than blocking anything.
 */
export function reviewPlan({ blend, stages, idyPct, method = 'biga', model = DEFAULT_MODEL }) {
  const notes = [];
  const ceiling = fuCeilingForW(blend?.w);
  const fu = (stages || []).reduce((s, st) => s + st.hours * rateAt(st.tempC, model), 0);
  if (Number.isFinite(ceiling)) {
    const load = fu / ceiling;
    if (load > 1.15) {
      notes.push({
        tone: 'bad',
        text: `This schedule asks for ${fu.toFixed(0)} fermentation units from a flour good for about ${ceiling.toFixed(0)}. Expect a slack, tearing dough. Shorten the cold proof or blend in a stronger flour.`,
      });
    } else if (load > 0.98) {
      notes.push({ tone: 'warn', text: `You are at the top of what W ${blend.w} can carry. It will work, but there is no margin if the fridge runs warm.` });
    } else if (load < 0.5) {
      notes.push({ tone: 'warn', text: `This flour can carry roughly twice this schedule. A longer cold proof would buy flavour you are currently leaving on the table.` });
    } else {
      notes.push({ tone: 'good', text: `Fermentation load sits at ${(load * 100).toFixed(0)}% of what this blend can carry. That is a comfortable place to be.` });
    }
  }
  const suggested = yeastForFU(fu, model);
  if (Number.isFinite(suggested) && Number.isFinite(idyPct) && idyPct > 0) {
    const ratio = idyPct / suggested;
    if (ratio > 1.25) notes.push({ tone: 'warn', text: `Inoculation is ${(ratio * 100 - 100).toFixed(0)}% above what this timing needs. Try ${suggested.toFixed(3)}% instead.` });
    else if (ratio < 0.75) notes.push({ tone: 'warn', text: `Inoculation is ${(100 - ratio * 100).toFixed(0)}% below what this timing needs. Try ${suggested.toFixed(3)}%.` });
  }
  if (method !== 'direct' && Number.isFinite(blend?.w) && blend.w < 240) {
    notes.push({ tone: 'warn', text: `W ${blend.w} is on the soft side for a preferment. A direct dough is the safer call.` });
  }
  return { fu, ceiling, notes };
}
