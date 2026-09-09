// Protocol: the schedule solved backwards from your launch time, and the
// 19 steps with the measurements you take as you go.

import { h, card, numberField, selectField, chip, pill, stat, toast, icon, confirmDialog, clockAt, fmtClock, fmtDay, fmtDateTime } from '../lib/ui.js?v=ab7e5c7c';
import { update, editCurrent, EMPTY_ACTUALS, EMPTY_SCORES } from '../lib/store.js?v=ab7e5c7c';
import { PHASES, STEPS, activeSteps, solveSchedule, scheduleStages } from '../model/protocol.js?v=ab7e5c7c';
import { fermentUnits, maturationUnits } from '../model/ferment.js?v=ab7e5c7c';
import { convertYeast } from '../model/dough.js?v=ab7e5c7c';
import { fmtDuration, fmtTemp, round, toDisplay, fromDisplay } from '../model/units.js?v=ab7e5c7c';
import { timelineChart, SERIES_COLORS } from '../lib/charts.js?v=ab7e5c7c';
import { tempField, } from './common.js?v=ab7e5c7c';
import { MATURATION_TARGET, MATURATION_WINDOW } from '../model/advisor.js?v=ab7e5c7c';
import { actualStages, projectedStages, drifts, projectedLaunch, sayDrift, hasTimings, PHASE_BOUNDS, trimmablePhases, trimStage, trimForMaturation } from '../model/timeline.js?v=ab7e5c7c';

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
  const { s, u, S, c, sched, doneAt } = ctx;
  const planned = scheduleStages(S);
  const stages = actualStages({ doneAt, schedule: S, planned });
  const proj = projectedLaunch({ doneAt, at: sched.at, launchISO: s.current.launchISO });

  // Compare like with like: real times where they exist, the protocol's own
  // times for everything still to come. Summing only what has elapsed would
  // make every bake in progress look under-fermented.
  const ahead = projectedStages({ doneAt, schedule: S, planned });
  const headingMU = maturationUnits(ahead, ctx.model);
  const headingFU = fermentUnits(ahead, ctx.model);
  const planMU = maturationUnits(planned, ctx.model);
  const planFU = fermentUnits(planned, ctx.model);
  const ceiling = c.maturationCeiling;

  /*
   * The flour's budget is the anchor, not the plan.
   *
   * Comparing against the plan is circular once the baker starts trimming a
   * phase to catch up: the plan is the live schedule, so cutting an hour moves
   * the target down by the same hour and the app would never say the dough was
   * back on course. How much enzyme work the gluten can absorb does not move.
   */
  const load = ceiling ? headingMU / ceiling : null;
  const budget = maturationVerdict(load);
  const overBudget = load !== null && load > MATURATION_WINDOW.high;

  const slipH = proj ? proj.slipMs / 3600000 : 0;
  const behind = proj && proj.slipMs >= 300000;
  const early = proj && proj.slipMs <= -300000;

  /*
   * Only phases with a single duration knob can be trimmed. Mix and bench is
   * the sum of half a dozen bench timings, so there is no one number to take
   * the time out of.
   */
  const options = trimmablePhases(ahead).filter((x) => PHASE_BOUNDS[x.index].plan);
  const chosen = options.find((x) => x.index === s.ui?.trimIndex)
    || options.find((x) => x.name === 'Cold proof')
    || options[0];

  const afterCut = chosen && behind ? trimStage(ahead, chosen.index, slipH) : null;
  const cutMU = afterCut ? maturationUnits(afterCut, ctx.model) : null;
  // Bringing an over-budget dough back to the comfortable middle of the band,
  // which is a fixed property of the flour rather than of the current plan.
  const toBudget = chosen && overBudget
    ? trimForMaturation({ stages: ahead, index: chosen.index, targetMU: ceiling * MATURATION_TARGET, model: ctx.model })
    : null;

  const applyCut = (hours, message) => {
    const key = PHASE_BOUNDS[chosen.index].plan;
    editCurrent((cur) => { cur.schedule[key] = round(Math.max(0, cur.schedule[key] - hours), 2); });
    toast(message);
  };

  const phasePicker = () => selectField({
    label: 'Take the time out of',
    value: String(chosen.index),
    options: options.map((o) => ({ value: String(o.index), label: `${o.name} (${fmtDuration(o.hours)})` })),
    onChange: (v) => update((st) => { st.ui = { ...st.ui, trimIndex: Number(v) }; }),
  });

  return card(
    'Where you actually are',
    'Measured from the times you checked the steps off. Phases still to come are counted at the length the protocol asks for.',

    h(
      'div',
      { class: 'stats' },
      stat('Maturation', `${headingMU.toFixed(0)} MU`, ceiling ? `heading for, of about ${ceiling} this flour takes` : `heading for, plan said ${planMU.toFixed(0)}`),
      stat('Fermentation', `${headingFU.toFixed(1)} FU`, `heading for, plan said ${planFU.toFixed(1)}`)
    ),

    budget ? h('p', { class: `note ${budget.tone}` }, budget.text(headingMU, ceiling)) : null,

    behind
      ? h(
          'div',
          { class: 'stack' },
          h('p', { class: 'note neutral' },
            `You are running ${sayDrift(proj.slipMs)}. You can move dinner or take the time out of a later phase, and the two are not the same for the dough.`),
          chosen
            ? h(
                'div',
                { class: 'stack' },
                phasePicker(),
                choice(
                  `Move the launch to ${fmtDateTime(new Date(proj.launchMs))}`,
                  `Every phase keeps its planned length, so the dough still lands on ${headingMU.toFixed(0)} MU. The time already lost stays lost.`,
                  'schedule', 'Move the launch',
                  () => { setLaunch(toLocalInput(proj.launchMs)); toast(`Launch moved ${sayDrift(proj.slipMs)}`); }
                ),
                choice(
                  `Hold ${fmtDateTime(new Date(proj.plannedMs))} and cut ${fmtDuration(slipH)} from the ${chosen.name.toLowerCase()}`,
                  `Dinner is on time. ${fmtDuration(slipH)} at ${fmtTemp(chosen.tempC, u)} sheds ${(headingMU - cutMU).toFixed(1)} MU, so the dough lands on ${cutMU.toFixed(0)}.`,
                  'content_cut', `Cut ${fmtDuration(slipH)}`,
                  () => applyCut(slipH, `Cut ${fmtDuration(slipH)} from the ${chosen.name.toLowerCase()}`)
                )
              )
            : h('p', { class: 'note neutral' }, 'Nothing downstream is long enough to take the time out of, so the launch has to move.')
        )
      : early
        ? h(
            'div',
            { class: 'stack' },
            h('p', { class: 'note neutral' }, `You are running ${sayDrift(proj.slipMs)}. The first pizza can go in at ${fmtDateTime(new Date(proj.launchMs))}, or hold the launch and the spare time lands in whichever phase is running.`),
            choice(
              `Move the launch to ${fmtDateTime(new Date(proj.launchMs))}`,
              'Keeps every remaining phase the length the protocol asks for.',
              'schedule', 'Move the launch',
              () => { setLaunch(toLocalInput(proj.launchMs)); toast(`Launch moved ${sayDrift(proj.slipMs)}`); }
            )
          )
        : h('p', { class: 'note good' }, 'You are on the protocol\u2019s clock. Nothing needs moving.'),

    toBudget?.feasible && chosen
      ? h(
          'div',
          { class: 'stack' },
          behind ? null : phasePicker(),
          choice(
            `Cut ${fmtDuration(toBudget.hours)} from the ${chosen.name.toLowerCase()} to get back inside the budget`,
            `Clock time and enzyme time are not the same: the hours that put this over were warm and these are cold. Cutting ${fmtDuration(toBudget.hours)} brings the dough to about ${(ceiling * MATURATION_TARGET).toFixed(0)} MU, a comfortable place in what ${c.flourLabel} can take.`,
            'target', `Cut ${fmtDuration(toBudget.hours)}`,
            () => applyCut(toBudget.hours, `Cut ${fmtDuration(toBudget.hours)} to get back inside the budget`)
          )
        )
      : null,

    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'compact' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Phase'), h('th', { class: 'num' }, 'Planned'), h('th', { class: 'num' }, 'Actual'), h('th', { class: 'num' }, 'Diff'))),
        h('tbody', {}, ...stages.map((x, i) => {
          // A phase still running is not early, it is unfinished. Only an
          // overrun is worth reporting before it ends.
          const gap = (x.hours - planned[i].hours) * 3600000;
          const diff = x.state === 'done' ? gap : (x.state === 'running' && gap > 0 ? gap : null);
          return h(
            'tr',
            { class: x.state === 'running' ? 'row-live' : null },
            h('td', {}, x.name, x.state === 'running' ? h('span', { class: 'hint' }, ' running now') : null),
            h('td', { class: 'num' }, fmtDuration(planned[i].hours)),
            h('td', { class: 'num' }, x.state === 'planned' ? '\u2014' : fmtDuration(x.hours)),
            h('td', { class: `num${diff !== null && Math.abs(diff) > 1800000 ? ' warn' : ''}` },
              diff === null ? (x.state === 'running' ? 'running' : '\u2014') : compactDrift(diff))
          );
        }))
      )
    ),
    h('p', { class: 'hint', style: { fontSize: '.72rem' } }, 'A phase counts as timed once both the step that starts it and the step that ends it are checked. Correct a time on the step itself if you ticked it late.')
  );
}

/** One way out of a timing problem: what it does, and the button to do it. */
function choice(title, note, iconName, label, onClick) {
  return h(
    'div',
    { class: 'choice' },
    h('div', { class: 'choice-body' },
      h('p', { class: 'choice-title' }, title),
      h('p', { class: 'choice-note' }, note)),
    h('button', { class: 'btn tonal small', onClick }, icon(iconName), label)
  );
}

/**
 * Where the projected maturation sits against what the flour can absorb. The
 * bands match the ones the recipe screen judges a cold proof by, so the two
 * screens cannot disagree about whether a dough is over-matured.
 */
function maturationVerdict(load) {
  if (load === null) return null;
  if (load > 1.15) return { tone: 'bad', text: (mu, ceil) => `${mu.toFixed(0)} MU is past the ${ceil} this flour can take. The enzymes will have gone too far: expect a slack dough that tears when you open it.` };
  if (load > MATURATION_WINDOW.high) return { tone: 'warn', text: (mu, ceil) => `${mu.toFixed(0)} MU is over the ${ceil} this flour can take. Take time out of a phase below, or accept a softer dough.` };
  if (load > 0.9) return { tone: 'warn', text: (mu, ceil) => `${mu.toFixed(0)} MU is near the top of the ${ceil} this flour can take. It will work, with no margin if the fridge runs warm.` };
  if (load < MATURATION_WINDOW.low) return { tone: 'warn', text: (mu, ceil) => `${mu.toFixed(0)} MU is short of what ${ceil} of budget allows. There is room to go longer.` };
  return { tone: 'good', text: (mu, ceil) => `${mu.toFixed(0)} MU sits comfortably inside the ${ceil} this flour can take.` };
}

/** Signed and short, for a column that has to fit on a phone. */
function compactDrift(ms) {
  const mins = Math.round(ms / 60000);
  if (mins === 0) return 'on time';
  const sign = mins > 0 ? '+' : '\u2212';
  return sign + fmtDuration(Math.abs(mins) / 60);
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
        // Every step is stamped, not just the ones that bound a phase. The
        // phase arithmetic only needs the boundaries, but the record of when
        // each thing actually happened is worth having on its own, and it is
        // the only way to see afterwards where an evening went.
        at[step.id] = Date.now();
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
