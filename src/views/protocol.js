// Protocol: the schedule solved backwards from your launch time, and the
// 19 steps with the measurements you take as you go.

import { h, card, numberField, chip, pill, stat, toast, icon, confirmDialog, clockAt, fmtClock, fmtDay, fmtDateTime } from '../lib/ui.js?v=f38a4426';
import { update, EMPTY_ACTUALS, EMPTY_SCORES } from '../lib/store.js?v=f38a4426';
import { PHASES, STEPS, activeSteps, solveSchedule, scheduleStages } from '../model/protocol.js?v=f38a4426';
import { fermentUnits, ripeness, ripenessVerdict } from '../model/ferment.js?v=f38a4426';
import { convertYeast } from '../model/dough.js?v=f38a4426';
import { fmtDuration, fmtTemp, round, toDisplay, fromDisplay } from '../model/units.js?v=f38a4426';
import { timelineChart, SERIES_COLORS } from '../lib/charts.js?v=f38a4426';
import { tempField } from './common.js?v=f38a4426';

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
  return [scheduleCard(ctx), ...PHASES.map((p) => phaseCard(ctx, p)), footerCard(ctx)];
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
  const idy = convertYeast(s.current.recipe.baseYeastPct, s.current.recipe.yeastType, 'idy');
  const verdict = ripenessVerdict(ripeness(stages, idy, ctx.model));
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
      numberField({ label: 'Bake time', value: S.bakeSec, min: 20, max: 600, step: 5, suffix: 'sec', onInput: (v) => update((st) => { st.current.schedule.bakeSec = v; }) })
    ),
    h(
      'div',
      { class: 'stats' },
      stat('Start mixing', fmtDateTime(clockAt(launch, m.bigaStart)), 'the biga goes together here'),
      stat('Total lead time', fmtDuration(sched.totalMin / 60), 'first mix to launch'),
      stat('Fermentation', `${fu.toFixed(1)} FU`, verdict.label),
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
      set.has(step.id) ? set.delete(step.id) : set.add(step.id);
      st.current.done = [...set];
    });
  };

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
        pill(step.badge(tctx), skipped ? 'neutral' : 'neutral')
      ),
      h('p', { class: 'step-body', html: step.body(tctx), onClick: toggle }),
      metrics.length && !skipped ? h('div', { class: 'step-metrics' }, ...metrics.map((k) => metricField(ctx, k))) : null
    )
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
      const ok = val >= def.target[0] && val <= def.target[1];
      node.appendChild(h('span', {}, pill(ok ? 'On target' : val < def.target[0] ? 'Below target' : 'Above target', ok ? 'good' : 'warn')));
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
