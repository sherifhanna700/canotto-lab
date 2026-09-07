// Temperature + mass helpers. The app stores every temperature in °C internally
// and converts at the edges, so a user can flip units without touching the data.

export const cToF = (c) => (c * 9) / 5 + 32;
export const fToC = (f) => ((f - 32) * 5) / 9;

/** Convert a stored °C value into the user's display unit. */
export function toDisplay(c, unit) {
  return unit === 'F' ? cToF(c) : c;
}

/** Convert a user-entered value in their display unit back to °C. */
export function fromDisplay(v, unit) {
  return unit === 'F' ? fToC(v) : v;
}

export function fmtTemp(c, unit, digits = 0) {
  if (c === null || c === undefined || Number.isNaN(c)) return '—';
  return `${toDisplay(c, unit).toFixed(digits)} °${unit}`;
}

/** A temperature *difference* scales, it does not take the freezing offset. */
export const deltaToDisplay = (dc, unit) => (unit === 'F' ? (dc * 9) / 5 : dc);
export const deltaFromDisplay = (d, unit) => (unit === 'F' ? (d * 5) / 9 : d);

export function fmtTempDelta(dc, unit, digits = 0) {
  if (!Number.isFinite(dc)) return '—';
  return `${deltaToDisplay(dc, unit).toFixed(digits)} °${unit}`;
}

export function round(n, digits = 0) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function fmtGrams(g) {
  if (!Number.isFinite(g)) return '—';
  return g >= 100 ? `${Math.round(g)} g` : `${round(g, 1)} g`;
}

/**
 * Round parts so that, as displayed, they add up to the displayed whole.
 *
 * Rounding each figure on its own breaks the arithmetic on screen: 197.75 and
 * 118.65 grams of water show as 198 and 119, which sum to 317 against a stated
 * 316. A baker with a scale is right to call that wrong. This distributes the
 * rounding by largest remainder so the numbers reconcile.
 */
export function reconcile(totalRaw, partsRaw, digits = 0) {
  const f = 10 ** digits;
  const total = Math.round(totalRaw * f);
  const sum = partsRaw.reduce((a, b) => a + b, 0);
  if (!sum) return partsRaw.map(() => 0);

  const scaled = partsRaw.map((p) => (p / sum) * total);
  const out = scaled.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);

  const byRemainder = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; left > 0; k += 1, left -= 1) out[byRemainder[k % byRemainder.length].i] += 1;

  return out.map((v) => v / f);
}

/** Split a total into n equal-as-possible whole-gram doses. */
export function splitDoses(totalRaw, n, digits = 0) {
  return reconcile(totalRaw, new Array(Math.max(1, n)).fill(1), digits);
}

export function fmtDuration(hours) {
  if (!Number.isFinite(hours)) return '—';
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} m`;
}
