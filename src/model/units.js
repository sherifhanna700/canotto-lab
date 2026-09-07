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

export function fmtDuration(hours) {
  if (!Number.isFinite(hours)) return '—';
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} m`;
}
