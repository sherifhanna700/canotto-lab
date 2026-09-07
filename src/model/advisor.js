// Suggestions for a biga canotto dough.
//
// A flour's W value is a fermentation budget. A W 250 flour cannot hold a
// 72-hour biga schedule, and a W 380 flour is wasted on a short one. This
// module turns a blend into a proposal: hydration, phase times at the
// temperatures you actually have, and the inoculation that lands the dough
// ripe at the end.
//
// The phase proportions come from the house protocol, so a stronger flour
// stretches that schedule and a weaker one shortens it.

import { rateAt, yeastForFU, DEFAULT_MODEL } from './ferment.js?v=073bb50c';
import { fuCeilingForW, hydrationRangeForW, findFlour } from './flours.js?v=073bb50c';
import { DEFAULT_SCHEDULE } from './protocol.js?v=073bb50c';

/** Share of total maturation time each phase takes, from the house protocol. */
const TIME_SHARES = { bigaRest: 0.043, bigaCold: 0.192, coldProof: 0.72, temper: 0.045 };

/** Canotto runs wetter than the conservative published hydration guide. */
const CANOTTO_HYDRATION_SHIFT = 2;

/** Grades that shift how much water the blend will take, in points. */
const ABSORPTION = { Integrale: 4, Whole: 4, Semola: -1.5 };

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
  if (w < 260) return { key: 'weak', label: 'Soft for a biga', blurb: 'Keep the schedule short, or blend in something stronger.' };
  if (w < 300) return { key: 'strong', label: 'Strong', blurb: 'Comfortable to about 48 hours.' };
  if (w < 340) return { key: 'very-strong', label: 'Very strong', blurb: 'Built for biga and 60 to 72 hours.' };
  return { key: 'extra-strong', label: 'Extra strong', blurb: 'Happy past 72 hours, or blend it down.' };
}

/** Middle of the published maturation window for a blend. */
export function defaultLeadHours(blend) {
  const f = blend?.ferment;
  if (!f) return 48;
  return Math.round((f[0] + f[1]) / 2);
}

/**
 * Propose a schedule for a blend.
 * The published maturation window sets how long the dough matures; the
 * fermentation model sets the inoculation that lands it ripe at the end.
 */
export function suggestPlan(blend, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const w = blend?.w;
  const roomC = opts.roomTempC ?? DEFAULT_SCHEDULE.bigaRoomTempC;
  const fridgeC = opts.fridgeTempC ?? DEFAULT_SCHEDULE.fridgeTempC;
  const benchTempC = opts.benchTempC ?? DEFAULT_SCHEDULE.benchTempC;
  const totalHours = Number.isFinite(opts.totalHours) ? opts.totalHours : defaultLeadHours(blend);

  const benchHours =
    (DEFAULT_SCHEDULE.finalMixMin +
      DEFAULT_SCHEDULE.benchRest1Min +
      DEFAULT_SCHEDULE.benchRest2Min +
      5 +
      DEFAULT_SCHEDULE.oilRestMin +
      DEFAULT_SCHEDULE.ballingMin) /
    60;

  const spread = Math.max(2, totalHours - benchHours);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const bigaRestHours = clamp(spread * TIME_SHARES.bigaRest, 1.5, 8);
  const bigaColdHours = clamp(spread * TIME_SHARES.bigaCold, 4, 36);
  const temperHours = clamp(spread * TIME_SHARES.temper, 1.5, 8);
  const coldProofHours = clamp(spread - bigaRestHours - bigaColdHours - temperHours, 2, 168);

  const stages = [
    { name: 'Biga ambient rest', hours: bigaRestHours, tempC: roomC },
    { name: 'Biga cold hold', hours: bigaColdHours, tempC: fridgeC },
    { name: 'Mix & bench', hours: benchHours, tempC: benchTempC },
    { name: 'Cold proof', hours: coldProofHours, tempC: fridgeC },
    { name: 'Counter temper', hours: temperHours, tempC: roomC },
  ];

  const actualFU = stages.reduce((sum, s) => sum + s.hours * rateAt(s.tempC, model), 0);
  const idyPct = yeastForFU(actualFU, model);

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
    window: blend?.ferment || null,
    totalHours,
    ceilingFU: fuCeilingForW(w),
    actualFU,
    idyPct,
    hydration,
    stages,
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
      hydrationPct: hydration ? hydration.recommended : 70,
      baseYeastPct: Number.isFinite(idyPct) ? Math.round(idyPct * 1000) / 1000 : 0.1,
    },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/** Check a schedule against what the flour can carry. Notes, not blockers. */
export function reviewPlan({ blend, stages, idyPct, model = DEFAULT_MODEL }) {
  const notes = [];
  const ceiling = fuCeilingForW(blend?.w);
  const fu = (stages || []).reduce((s, st) => s + st.hours * rateAt(st.tempC, model), 0);

  if (Number.isFinite(ceiling)) {
    const load = fu / ceiling;
    if (load > 1.15) {
      notes.push({ tone: 'bad', text: `This schedule asks for ${fu.toFixed(0)} fermentation units from a flour good for about ${ceiling.toFixed(0)}. Expect a slack, tearing dough. Shorten the cold proof or blend in a stronger flour.` });
    } else if (load > 0.98) {
      notes.push({ tone: 'warn', text: `You are at the top of what W ${blend.w} can carry. It will work, but there is no margin if the fridge runs warm.` });
    } else if (load < 0.5) {
      notes.push({ tone: 'warn', text: 'This flour could carry roughly twice this schedule. A longer cold proof would buy flavour.' });
    } else {
      notes.push({ tone: 'good', text: `Fermentation load is ${(load * 100).toFixed(0)}% of what this blend can carry. That is a comfortable place to be.` });
    }
  }

  const suggested = yeastForFU(fu, model);
  if (Number.isFinite(suggested) && Number.isFinite(idyPct) && idyPct > 0) {
    const ratio = idyPct / suggested;
    if (ratio > 1.25) notes.push({ tone: 'warn', text: `Inoculation is ${(ratio * 100 - 100).toFixed(0)}% above what this timing needs. Try ${suggested.toFixed(3)}%.` });
    else if (ratio < 0.75) notes.push({ tone: 'warn', text: `Inoculation is ${(100 - ratio * 100).toFixed(0)}% below what this timing needs. Try ${suggested.toFixed(3)}%.` });
  }

  if (Number.isFinite(blend?.w) && blend.w < 260) {
    notes.push({ tone: 'warn', text: `W ${blend.w} is soft for a biga. Blend in a stronger flour, or keep the maturation short.` });
  }
  return { fu, ceiling, notes };
}
