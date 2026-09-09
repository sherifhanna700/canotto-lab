// Protocol: the schedule solved backwards from your launch time, and the
// 19 steps with the measurements you take as you go.

import { h, card, numberField, chip, pill, stat, toast, icon, confirmDialog, clockAt, fmtClock, fmtDay, fmtDateTime } from '../lib/ui.js?v=877314ec';
import { update, editCurrent, EMPTY_ACTUALS, EMPTY_SCORES } from '../lib/store.js?v=877314ec';
import { PHASES, STEPS, activeSteps, solveSchedule, scheduleStages } from '../model/protocol.js?v=877314ec';
import { fermentUnits, maturationUnits } from '../model/ferment.js?v=877314ec';
import { convertYeast } from '../model/dough.js?v=877314ec';
import { fmtDuration, fmtTemp, round, toDisplay, fromDisplay } from '../model/units.js?v=877314ec';
import { timelineChart, SERIES_COLORS } from '../lib/charts.js?v=877314ec';
import { tempField, } from './common.js?v=877314ec';
import { actualStages, projectedStages, drifts, projectedLaunch, sayDrift, hasTimings, TIMED_STEPS } from '../model/timeline.js?v=877314ec';

const METRIC_DEFS = {
  ambientTempC: { label: 'Ambient temperature', kind: 'temp', hint: 'Where the dough is sitting right now' },
  bigaWaterTempC: { label: 'Biga water temperature', kind: 'temp', target: [14, 16] },
  fdtC: { label: 'Final dough temperature', kind: 'temp', target: [22.8, 23.9] },
  fridgeTempC: { label: 'Measured fridge temperature', kind: 'temp' },
  coldHoldHours: { label: 'Actual cold hold', kind: 'hours' },
  coreTempC: { label: 'Ball core temperature', kind: 'temp', target: [17.2, 18.9] },
  deckTempC: { label: 'Floor temperature', kind: 'temp', target: [443, 460] },
  domeTempC: { label: 'Dome temperature', kind: 'temp', target: [482, 499] },
  bakeSec: { label: 'Bake time', kind: 'seconds' },
  canotto: { label: 'Canotto height', kind: 'score' },
  honeycomb: { label: 'Honeycomb', kind: 'score' },
  blistering: { label: 'Blistering', kind: 'score' },
};

export default function renderProtocol(ctx) {
  // Everything about real times is worked out once, here, so a step and the
  // summary above it can never disagree about what happened.
  const doneAt = ctx.s.current.doneAt || {};
  const tctx = {
    ...ctx,
    doneAt,
    drift: drifts({ doneAt, at: ctx.sched.at, launchISO: ctx.s.current.launchISO }),
  };
  return [
    scheduleCard(tctx),
    hasTimings(doneAt) ? actualCard(tctx) : null,
    ...PHASES.map((p) => phaseCard(tctx, p)),
    footerCard(tctx),
  ].filter(Boolean);
}

/* ------------------------- what actually happened ------------------------ */

function actualCard(ctx) {
  const { s, u, S, sched, doneAt } = ctx;
  const planned = scheduleStages(S);
  const stages = actualStages({ doneAt, schedule: S, planned });
  const proj = projectedLaunch({ doneAt, at: sched.at, launchISO: s.current.launchISO });

  // Compare like with like: real times where they exist, the protocol's own
  // times for everything still to come. Summing only what has elapsed would
  // make every bake in progress look under-fermented.
  const ahead = projectedStages({ doneAt, schedule: S, planned });
  const actualFU = fermentUnits(ahead, ctx.model);
  const actualMU = maturationUnits(ahead, ctx.model);
  const planFU = fermentUnits(planned, ctx.model);
  const planMU = maturationUnits(planned, ctx.model);
  const running = stages.find((x) => x.state === 'running');

  return card(
    'Where you actually are',
    'Measured from the times you checked the steps off. Phases still to come are counted at the length the protocol asks for.',

    h(
      'div',
      { class: 'stats' },
      running
        ? stat(running.name, fmtDuration(running.hours), `so far, of ${fmtDuration(planned[stages.indexOf(running)].hours)} planned`)
        : stat('Phases timed', String(stages.filter((x) => x.state === 'done').length), `of ${stages.length}`),
      stat('Maturation', `${actualMU.toFixed(0)} MU`, `heading for, against a plan of ${planMU.toFixed(0)}`),
      stat('Fermentation', `${actualFU.toFixed(1)} FU`, `heading for, against a plan of ${planFU.toFixed(1)}`)
    ),

    proj && Math.abs(proj.slipMs) >= 300000
      ? h(
          'div',
          {},
          h('p', { class: `note ${Math.abs(proj.slipMs) > 3600000 ? 'warn' : 'neutral'}` },
            `You are running ${sayDrift(proj.slipMs)}. Keep every remaining phase as long as the protocol says and the first pizza goes in at ${fmtDateTime(new Date(proj.launchMs))}, instead of ${fmtDateTime(new Date(proj.plannedMs))}. Hold the launch where it is and the time comes out of whatever phase is running now.`),
          h('div', { class: 'row tight' },
            h('button', { class: 'btn tonal small', onClick: () => { setLaunch(toLocalInput(proj.launchMs)); toast(`Launch moved ${sayDrift(proj.slipMs)}`); } }, icon('schedule'), 'Move the launch to match'))
        )
      : h('p', { class: 'note good' }, 'You are on the protocol\u2019s clock. Nothing needs moving.'),

    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Phase'), h('th', { class: 'num' }, 'Planned'), h('th', { class: 'num' }, 'Actual'), h('th', { class: 'num' }, 'Difference'))),
        h('tbody', {}, ...stages.map((x, i) => {
          // A phase still running is not early, it is unfinished. Only an
          // overrun is worth reporting before it ends.
          const gap = (x.hours - planned[i].hours) * 3600000;
          const diff = x.state === 'done' ? gap : (x.state === 'running' && gap > 0 ? gap : null);
          return h(
            'tr',
            { class: x.state === 'running' ? 'row-live' : null },
            h('td', {}, x.name, x.state === 'running' ? h('span', { class: 'hint' }, ' \u00b7 running now') : null),
            h('td', { class: 'num' }, fmtDuration(planned[i].hours)),
            h('td', { class: 'num' }, x.state === 'planned' ? '\u2014' : fmtDuration(x.hours)),
            h('td', { class: `num${diff !== null && Math.abs(diff) > 1800000 ? ' warn' : ''}` }, diff === null ? (x.state === 'running' ? 'in progress' : '\u2014') : sayDrift(diff))
          );
        }))
      )
    ),
    h('p', { class: 'hint', style: { fontSize: '.72rem' } }, 'A phase counts as timed once both the step that starts it and the step that ends it are checked. Correct a time on the step itself if you ticked it late.')
  );
}

/** A local datetime string the launch field understands. */
function toLocalInput(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

/* -------------------------------- schedule ------------------------------ */

function launchDate(ctx) {
  const d = new Date(ctx.s.current.launchISO);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

const setLaunch = (value) => {
  if (!value) return;
  update((st) => {
    st.current.launchISO = value;
  });
};

function scheduleCard(ctx) {
  const { s, u, S, sched } = ctx;
  const launch = launchDate(ctx);
  const stages = scheduleStages(S);
  const fu = fermentUnits(stages, ctx.model);
  const mu = maturationUnits(stages, ctx.model);
  const m = sched.marks;

  const segs = [
    { key: 'bigaRest', label: 'Biga rest', start: m.bigaRestStart, end: m.bigaColdStart },
    { key: 'bigaCold', label: 'Biga cold', start: m.bigaColdStart, end: m.finalMixStart },
    { key: 'bench', label: 'Mix & bench', start: m.finalMixStart, end: m.coldProofStart },
    { key: 'proof', label: 'Cold proof', start: m.coldProofStart, end: m.temperStart },
    { key: 'temper', label: 'Temper', start: m.temperStart, end: 0 },
  ]
    .filter((x) => x.end > x.start)
    .map((x, i) => ({
      start: x.start,
      end: x.end,
      short: x.label,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      tick: fmtDay(clockAt(launch, x.start)) + ' ' + fmtClock(clockAt(launch, x.start)),
      startLabel: fmtDateTime(clockAt(launch, m.bigaStart)),
      endLabel: `launch ${fmtDateTime(launch)}`,
    }));

  return card(
    'Schedule',
    'Set when you want the first pizza on the deck. Everything else solves backwards from there.',
    h(
      'div',
      { class: 'row' },
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Launch the first pizza'),
        h('span', { class: 'field-input' }, h('input', {
          type: 'datetime-local',
          value: s.current.launchISO,
          dataset: { k: 'Launch the first pizza' },
          // Both events, deliberately. Typing a date fires input, but a mobile
          // date picker commits with change and may never fire input at all,
          // which left the whole schedule sitting on the old launch time.
          onInput: (e) => setLaunch(e.target.value),
          onChange: (e) => setLaunch(e.target.value),
        }))
      ),
      numberField({ label: 'Bake time', value: S.bakeSec, min: 20, max: 600, step: 5, suffix: 'sec', onInput: (v) => editCurrent((c) => { c.schedule.bakeSec = v; }) })
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Start mixing', fmtDateTime(clockAt(launch, m.bigaStart)), 'the biga goes together here'),
      stat('Total lead time', fmtDuration(sched.totalMin / 60), 'first mix to launch'),
      stat('Fermentation', `${fu.toFixed(1)} FU`, 'yeast work'),
      stat('Maturation', `${mu.toFixed(0)} MU`, 'enzyme work'),
      stat('Balls', `${ctx.c.freshBalls} fresh${ctx.c.recipe.frozenBalls ? ` · ${ctx.c.recipe.frozenBalls} frozen` : ''}`, `${ctx.c.recipe.ballWeight} g each`)
    ),
    segs.length ? timelineChart({ segments: segs }) : null
  );
}

/* --------------------------------- phases ------------------------------- */

function phaseCard(ctx, phase) {
  const { s, c } = ctx;
  const steps = STEPS.filter((st) => st.phase === phase.n);
  const active = activeSteps({ c });
  const launch = launchDate(ctx);
  const inPhase = steps.filter((st) => active.some((a) => a.id === st.id));
  const done = inPhase.filter((st) => s.current.done.includes(st.id)).length;

  return h(
    'section',
    { class: 'phase' },
    h(
      'header',
      { class: 'phase-head' },
      h('span', { class: 'msym' }, phase.icon),
      h('div', { style: { flex: 1, minWidth: 0 } }, h('h3', {}, `Phase ${phase.n}: ${phase.title}`), h('p', {}, phase.sub)),
      pill(`${done}/${inPhase.length}`, done === inPhase.length && inPhase.length ? 'good' : 'neutral')
    ),
    h('div', { class: 'phase-steps' }, ...steps.map((st) => stepNode(ctx, st, launch)))
  );
}

function stepNode(ctx, step, launch) {
  const { s, c, S, u, sched } = ctx;
  const tctx = { c, S, u, E: ctx.E };
  const skipped = step.skipWhen && step.skipWhen({ c });
  const isDone = s.current.done.includes(step.id);
  const at = sched.at[step.id];
  const when = clockAt(launch, at);

  const toggle = () => {
    if (skipped) return;
    update((st) => {
      const set = new Set(st.current.done);
      const at = { ...(st.current.doneAt || {}) };
      if (set.has(step.id)) {
        set.delete(step.id);
        delete at[step.id];
      } else {
        set.add(step.id);
        // The moment it was ticked, which is the only honest record of when
        // it happened. Editable below, because people tick things late.
        if (TIMED_STEPS.includes(step.id)) at[step.id] = Date.now();
      }
      st.current.done = [...set];
      st.current.doneAt = at;
    });
  };

  const stampedAt = s.current.doneAt?.[step.id];
  const off = ctx.drift?.[step.id];

  const metrics = (step.metrics || []).filter((k) => METRIC_DEFS[k]);

  return h(
    'article',
    { class: `step${isDone ? ' done' : ''}`, style: skipped ? { opacity: '.55' } : null },
    h('div', { class: 'step-check', onClick: (e) => { e.stopPropagation(); toggle(); }, role: 'checkbox', 'aria-checked': String(isDone) }, h('span', { class: 'msym' }, 'check')),
    h(
      'div',
      { class: 'step-main' },
      h('div', { class: 'step-title', onClick: toggle }, `${step.n}. ${step.title(tctx)}`),
      h(
        'div',
        { class: 'step-meta' },
        h('span', { class: 'step-time' }, `${fmtDay(when)} ${fmtClock(when)}`),
        pill(step.badge(tctx), skipped ? 'neutral' : 'neutral'),
        // What really happened, next to what was asked for.
        Number.isFinite(stampedAt)
          ? pill(`done ${fmtClock(new Date(stampedAt))}${Number.isFinite(off) && Math.abs(off) >= 300000 ? ` \u00b7 ${sayDrift(off)}` : ''}`,
              !Number.isFinite(off) || Math.abs(off) < 1800000 ? 'good' : 'warn')
          : null
      ),
      h('p', { class: 'step-body', html: step.body(tctx), onClick: toggle }),
      Number.isFinite(stampedAt) ? stampEditor(step, stampedAt) : null,
      metrics.length && !skipped ? h('div', { class: 'step-metrics' }, ...metrics.map((k) => metricField(ctx, k))) : null
    )
  );
}

/**
 * Ticking a box late is the normal case, not the exception, so the recorded
 * time has to be correctable. A datetime-local input is the one control that
 * a phone offers a decent picker for.
 */
function stampEditor(step, stampedAt) {
  const local = (ms) => {
    const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };
  return h(
    'label',
    { class: 'field stamp-edit' },
    h('span', { class: 'field-label' }, 'Actually done at'),
    h('span', { class: 'field-input' }, h('input', {
      type: 'datetime-local',
      value: local(stampedAt),
      dataset: { k: `stamp-${step.id}` },
      onChange: (e) => {
        const ms = Date.parse(e.target.value);
        if (!Number.isFinite(ms)) return;
        update((st) => { st.current.doneAt = { ...(st.current.doneAt || {}), [step.id]: ms }; });
      },
    }))
  );
}

function metricField(ctx, key) {
  const { s, u } = ctx;
  const def = METRIC_DEFS[key];
  const isScore = def.kind === 'score';
  const val = isScore ? s.current.scores[key] : s.current.actuals[key];

  const setVal = (v) =>
    update((st) => {
      if (isScore) st.current.scores[key] = v;
      else st.current.actuals[key] = v;
    });

  if (def.kind === 'temp') {
    const hint = def.target ? `target ${fmtTemp(def.target[0], u)} to ${fmtTemp(def.target[1], u)}` : def.hint;
    const node = tempField({ allowEmpty: true, label: def.label, valueC: val, unit: u, step: 1, hint, onChange: setVal });
    if (def.target && Number.isFinite(val)) {
      /*
       * Judge against the numbers on screen, not the ones underneath.
       *
       * Targets are stored in Celsius. 16 °C prints as 61 °F but is really
       * 60.8, so entering the 61 the app itself asked for came back as above
       * target. Rounding the bounds the same way they are displayed means the
       * label and the verdict agree.
       */
      const lo = Math.round(toDisplay(def.target[0], u));
      const hi = Math.round(toDisplay(def.target[1], u));
      const shown = Math.round(toDisplay(val, u));
      const ok = shown >= lo && shown <= hi;
      node.appendChild(h('span', {}, pill(ok ? 'On target' : shown < lo ? 'Below target' : 'Above target', ok ? 'good' : 'warn')));
    }
    return node;
  }
  if (def.kind === 'score') {
    return h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, def.label),
      h(
        'span',
        { class: 'field-input' },
        h(
          'select',
          { onChange: (e) => setVal(e.target.value === '' ? null : Number(e.target.value)) },
          h('option', { value: '', selected: val === null || val === undefined }, 'Not scored'),
          ...[5, 4, 3, 2, 1].map((n) => h('option', { value: n, selected: Number(val) === n }, String(n)))
        )
      )
    );
  }
  return numberField({
    label: def.label,
    value: val ?? '',
    step: def.kind === 'hours' ? 0.5 : 1,
    suffix: def.kind === 'hours' ? 'h' : 'sec',
    onInput: setVal,
  });
}

/* -------------------------------- footer -------------------------------- */

function footerCard(ctx) {
  const { s } = ctx;
  return card(
    'Session',
    'Progress and measurements live here until you file the bake.',
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Notes for this bake'),
      h('span', { class: 'field-input' }, h('textarea', { rows: 3, placeholder: 'What you changed, what you noticed…', onInput: (e) => update((st) => { st.current.notes = e.target.value; }) }, s.current.notes || ''))
    ),
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn ghost', onClick: () => confirmDialog('Clear the checkmarks and measurements for this session? The recipe is untouched.', () => update((st) => { st.current.done = []; st.current.actuals = { ...EMPTY_ACTUALS }; st.current.scores = { ...EMPTY_SCORES }; st.current.notes = ''; }), 'Reset') }, icon('restart_alt'), 'Reset session')
    )
  );
}
