// The controls a bake is recorded with: a measurement, and the time a step was
// really done at.
//
// Shared, because a bake is recorded once but corrected twice. The run writes
// through them while it happens; the log writes through the same ones when you
// go back and fix a stamp you ticked an hour late. Hand-rolling a second set
// for the log is how the app came to hold four of its ten measurements under
// different labels, and the same bake in two places.
//
// Neither knows where the value lives. Each takes what to show and what to do
// when it changes, so the run passes the session and the log passes a filed
// bake, and the rules travel with the control rather than the caller.

import { h, numberField, pill, toast, fmtClock, fmtDay } from '../lib/ui.js?v=bbceb21b';
import { tempField } from './common.js?v=bbceb21b';
import { fmtTemp, toDisplay } from '../model/units.js?v=bbceb21b';
import { stampBounds, clampStamp } from '../model/protocol.js?v=bbceb21b';

export const METRIC_DEFS = {
  ambientTempC: { label: 'Ambient temperature', kind: 'temp', hint: 'Air where you are cooking' },
  humidityPct: { label: 'Humidity', kind: 'percent' },
  bigaWaterTempC: { label: 'Biga water temperature', kind: 'temp', target: [14, 16] },
  fdtC: { label: 'Final dough temperature', kind: 'temp', target: [22.8, 23.9] },
  fridgeTempC: { label: 'Measured fridge temperature', kind: 'temp' },
  coldHoldHours: { label: 'Actual cold hold', kind: 'hours' },
  coreTempC: { label: 'Ball core temperature', kind: 'temp', target: [17.2, 18.9] },
  deckTempC: { label: 'Floor temperature', kind: 'temp', target: [443, 460] },
  domeTempC: { label: 'Dome temperature', kind: 'temp', target: [482, 499] },
  bakeSec: { label: 'Bake time', kind: 'seconds' },
};

/** Every measurement a bake records, in the order the run takes them. */
export const METRIC_KEYS = Object.keys(METRIC_DEFS);

/**
 * One measurement, judged against its target where it has one.
 *
 * Measurements only. Judging the bake is the closing act of the run and
 * belongs in one place, not spread over the step that happened to be last.
 */
export function metricField({ key, value, unit, onChange }) {
  const def = METRIC_DEFS[key];
  if (!def) return null;

  if (def.kind === 'temp') {
    const hint = def.target ? `target ${fmtTemp(def.target[0], unit)} to ${fmtTemp(def.target[1], unit)}` : def.hint;
    const node = tempField({ allowEmpty: true, label: def.label, valueC: value, unit, step: 1, hint, onChange });
    if (def.target && Number.isFinite(value)) {
      /*
       * Judge against the numbers on screen, not the ones underneath.
       *
       * Targets are stored in Celsius. 16 °C prints as 61 °F but is really
       * 60.8, so entering the 61 the app itself asked for came back as above
       * target. Rounding the bounds the same way they are displayed means the
       * label and the verdict agree.
       */
      const lo = Math.round(toDisplay(def.target[0], unit));
      const hi = Math.round(toDisplay(def.target[1], unit));
      const shown = Math.round(toDisplay(value, unit));
      const ok = shown >= lo && shown <= hi;
      node.appendChild(h('span', {}, pill(ok ? 'On target' : shown < lo ? 'Below target' : 'Above target', ok ? 'good' : 'warn')));
    }
    return node;
  }
  if (def.kind === 'percent') {
    return numberField({ label: def.label, value: value ?? '', min: 0, max: 100, suffix: '%', onInput: onChange });
  }
  return numberField({
    label: def.label,
    value: value ?? '',
    step: def.kind === 'hours' ? 0.5 : 1,
    suffix: def.kind === 'hours' ? 'h' : 'sec',
    onInput: onChange,
  });
}

const local = (ms) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};
const said = (ms) => `${fmtDay(new Date(ms))} ${fmtClock(new Date(ms))}`;

/**
 * The time a step was really done at, held to the order the steps happen in.
 *
 * Ticking a box late is the normal case, not the exception, so the recorded
 * time has to be correctable, on a run in progress and on one filed months
 * ago. A datetime-local input is the one control a phone offers a decent
 * picker for.
 *
 * `onChange` is given a time already inside the window, so no caller can write
 * one that runs backwards by forgetting to check.
 */
export function stampField({ stepId, at, doneAt, onChange, name }) {
  /*
   * The picker is given the window as well as the value, so on a phone the
   * times that would run backwards are not offered in the first place. The
   * check below is still needed: min and max are advisory on a typed date and
   * absent altogether on some keyboards.
   */
  const bounds = stampBounds(stepId, doneAt);

  return h(
    'label',
    { class: 'field stamp-edit' },
    h('span', { class: 'field-label' }, name || 'Actually done at'),
    h('span', { class: 'field-input' }, h('input', {
      type: 'datetime-local',
      value: local(at),
      min: Number.isFinite(bounds.min) ? local(bounds.min) : null,
      max: Number.isFinite(bounds.max) ? local(bounds.max) : null,
      dataset: { k: `stamp-${stepId}` },
      onChange: (e) => {
        const ms = Date.parse(e.target.value);
        if (!Number.isFinite(ms)) return;
        const kept = clampStamp(ms, bounds);
        if (kept !== ms) {
          toast(ms < kept
            ? `Held at ${said(kept)}: a step cannot be done before the one before it.`
            : `Held at ${said(kept)}: a step cannot be done after the one after it.`);
        }
        onChange(kept);
      },
    })),
    Number.isFinite(bounds.min) || Number.isFinite(bounds.max)
      ? h('span', { class: 'hint' }, Number.isFinite(bounds.min) && Number.isFinite(bounds.max)
          ? `Between ${said(bounds.min)} and ${said(bounds.max)}, the steps either side.`
          : Number.isFinite(bounds.min)
            ? `No earlier than ${said(bounds.min)}, the step before it.`
            : `No later than ${said(bounds.max)}, the step after it.`)
      : null
  );
}
