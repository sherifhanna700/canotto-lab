// Shared view pieces.

import { h, numberField, selectField, pill } from '../lib/ui.js?v=eb765592';
import { toDisplay, fromDisplay, deltaToDisplay, deltaFromDisplay, round } from '../model/units.js?v=eb765592';
import { SCORE_KEYS, overallScore } from '../model/recipes.js?v=eb765592';

/** A temperature input that stores °C but shows whatever unit is selected. */
export function tempField({ label, valueC, unit, onChange, hint, step = 1, min, max, allowEmpty = false }) {
  const shown = valueC === null || valueC === undefined ? '' : toDisplay(valueC, unit);
  return numberField({
    label,
    allowEmpty,
    // Oven temperatures do not need a decimal; dough temperatures do.
    value: shown === '' ? '' : round(shown, Math.abs(shown) >= 100 ? 0 : 1),
    step,
    min: min === undefined ? undefined : round(toDisplay(min, unit), 0),
    max: max === undefined ? undefined : round(toDisplay(max, unit), 0),
    suffix: `°${unit}`,
    hint,
    onInput: (v) => onChange(v === null ? null : fromDisplay(v, unit)),
  });
}

/**
 * A temperature DIFFERENCE, such as a friction allowance.
 * A difference scales between units, it does not take the 32 degree offset,
 * so 9 °C of friction is 16 °F of friction, not 48 °F.
 */
export function tempDeltaField({ label, valueC, unit, onChange, hint, step = 1, allowEmpty = false }) {
  const shown = valueC === null || valueC === undefined ? '' : deltaToDisplay(valueC, unit);
  return numberField({
    label,
    allowEmpty,
    value: shown === '' ? '' : round(shown, 1),
    step,
    suffix: `°${unit}`,
    hint,
    onInput: (v) => onChange(v === null ? null : deltaFromDisplay(v, unit)),
  });
}

export function stars(value, max = 5) {
  if (!Number.isFinite(value)) return h('span', { class: 'stars' }, '—');
  const full = Math.round(value);
  return h('span', { class: 'stars', title: `${value} of ${max}` }, '★'.repeat(full) + '☆'.repeat(Math.max(0, max - full)));
}

export function scoreInputs(scores, onChange) {
  return h(
    'div',
    { class: 'score-row' },
    ...SCORE_KEYS.map((k) =>
      selectField({
        label: k.label,
        value: scores?.[k.key] ?? '',
        hint: k.hint,
        options: [{ value: '', label: 'Not scored' }, ...[5, 4, 3, 2, 1].map((n) => ({ value: n, label: `${n}` }))],
        onChange: (v) => onChange(k.key, v === '' ? null : Number(v)),
      })
    )
  );
}

export function ratingBadge(rating) {
  if (!rating || !rating.runs) return pill('No bakes yet', 'neutral');
  if (rating.average === null) return pill(`${rating.runs} bake${rating.runs > 1 ? 's' : ''}, unscored`, 'neutral');
  const tone = rating.average >= 4 ? 'good' : rating.average >= 3 ? 'accent' : 'warn';
  return pill(`${rating.average.toFixed(1)} / 5 over ${rating.runs} bake${rating.runs > 1 ? 's' : ''}`, tone);
}

export function bakeScore(bake) {
  return overallScore(bake?.scores);
}

export function sectionNote(tone, text) {
  return h('p', { class: `note ${tone}` }, text);
}
