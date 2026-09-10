// Bake day: the flame modulation walkthrough, a live timer, and the form that
// turns this session into a logged bake.

import { h, card, numberField, selectField, textField, stat, pill, toast, icon, sliderField } from '../lib/ui.js?v=37fdeb15';
import { update, editCurrent, snapshotBake, addBake, EMPTY_ACTUALS, EMPTY_SCORES } from '../lib/store.js?v=37fdeb15';
import { bakeStages, OVENS, findOven, ovenLabel } from '../model/equipment.js?v=37fdeb15';
import { diagnose, DIAGNOSTICS, CATEGORIES, byCategory } from '../model/diagnostics.js?v=37fdeb15';
import { overallScore, SCORE_KEYS } from '../model/recipes.js?v=37fdeb15';
import { fmtTemp, fmtGrams } from '../model/units.js?v=37fdeb15';
import { tempField, scoreInputs, stars, } from './common.js?v=37fdeb15';
import { go } from '../app.js?v=37fdeb15';

let simIndex = 0;
let timerId = null;
let elapsed = 0;

export default function renderBake(ctx) {
  return [ovenCard(ctx), simCard(ctx), conditionsCard(ctx), resultCard(ctx), troubleshootingCard(ctx)];
}

/* ---------------------------------- oven -------------------------------- */

function ovenCard(ctx) {
  const { s, u, S, E } = ctx;
  const oven = findOven(E.ovenId);

  return card(
    'Oven',
    `${ovenLabel(E)}. Floor temperature decides whether the base sets before the rim burns.`,
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn ghost small', onClick: () => go('setup') }, icon('tune'), 'Change equipment')
    ),
    h(
      'div',
      { class: 'row' },
      tempField({ label: 'Target floor', valueC: S.deckTempC, unit: u, step: 5, onChange: (v) => editCurrent((c) => { c.schedule.deckTempC = v; }) }),
      tempField({ label: 'Target dome', valueC: S.domeTempC, unit: u, step: 5, onChange: (v) => editCurrent((c) => { c.schedule.domeTempC = v; }) }),
      numberField({ label: 'Bake time', value: S.bakeSec, min: 20, max: 600, step: 5, suffix: 'sec', onInput: (v) => editCurrent((c) => { c.schedule.bakeSec = v; }) }),
      numberField({ label: 'Preheat soak', value: S.preheatMin, min: 10, max: 120, step: 5, suffix: 'min', onInput: (v) => editCurrent((c) => { c.schedule.preheatMin = v; }) })
    )
  );
}

/* ------------------------------- simulator ------------------------------ */

function simCard(ctx) {
  const { S, E } = ctx;
  const stages = bakeStages(S.bakeSec, E.ovenId);
  simIndex = Math.min(simIndex, stages.length - 1);
  const stage = stages[simIndex];

  const pizza = h('div', { class: 'sim-pizza', style: { transform: `rotate(${stage.deg}deg)` } }, h('div', { class: 'sim-north' }));
  const oven = h('div', { class: 'sim-oven' }, h('div', { class: `sim-flame flame-${stage.tone}` }, stage.flame), pizza);

  const timerLabel = h('span', { class: 'stat-value' }, `${Math.round(elapsed)} / ${S.bakeSec} s`);

  const tick = () => {
    elapsed += 1;
    const s2 = bakeStages(S.bakeSec, E.ovenId);
    let idx = 0;
    s2.forEach((x, i) => {
      if (elapsed >= x.sec) idx = i;
    });
    if (idx !== simIndex || elapsed >= S.bakeSec) {
      simIndex = idx;
      if (elapsed >= S.bakeSec) stopTimer();
      rerender();
      return;
    }
    timerLabel.textContent = `${Math.round(elapsed)} / ${S.bakeSec} s`;
  };

  const startTimer = () => {
    stopTimer();
    elapsed = 0;
    simIndex = 0;
    timerId = setInterval(tick, 1000);
    rerender();
  };

  return card(
    'Heat modulation',
    `${ovenLabel(E)}, scaled to your ${S.bakeSec} second bake. Step through it, or run the timer while you turn the pizza.`,
    oven,
    h(
      'div',
      { class: 'sim-stage' },
      h('h3', { style: { fontSize: '1rem' } }, `${stage.sec}s · ${stage.label}`),
      h('p', { style: { margin: '2px 0', fontSize: '.86rem' } }, stage.action),
      h('p', { style: { margin: 0, fontSize: '.78rem', color: 'var(--on-surface-variant)' } }, stage.why),
      h('div', { class: 'step-meta' }, pill(`${stage.deg}° rotation`, 'neutral'), pill(stage.facing, 'neutral'))
    ),
    sliderField({
      label: 'Step',
      value: simIndex,
      min: 0,
      max: stages.length - 1,
      step: 1,
      format: (v) => stages[v].label,
      onInput: (v) => {
        simIndex = v;
        stopTimer();
        rerender();
      },
    }),
    h(
      'div',
      { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, 'Timer'), timerLabel, h('span', { class: 'stat-sub' }, timerId ? 'running' : 'stopped'))
    ),
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn', onClick: startTimer }, icon('play_arrow'), 'Start the bake timer'),
      h('button', { class: 'btn ghost', onClick: () => { stopTimer(); rerender(); } }, icon('stop'), 'Stop')
    )
  );
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

function rerender() {
  update(() => {});
}

/* ------------------------------- conditions ----------------------------- */

function conditionsCard(ctx) {
  const { s, u } = ctx;
  const a = s.current.actuals;
  const set = (k) => (v) => update((st) => { st.current.actuals[k] = v; });

  return card(
    'Conditions on the day',
    'Outdoor ovens live and die by this. Record it, and the comparison screen can tell you whether it mattered.',
    h(
      'div',
      { class: 'row' },
      tempField({ allowEmpty: true, label: 'Ambient temperature', valueC: a.ambientTempC, unit: u, step: 1, hint: 'Air temperature where you are cooking', onChange: set('ambientTempC') }),
      numberField({ allowEmpty: true, label: 'Humidity', value: a.humidityPct ?? '', min: 0, max: 100, suffix: '%', onInput: set('humidityPct') }),
      tempField({ allowEmpty: true, label: 'Measured floor', valueC: a.deckTempC, unit: u, step: 5, onChange: set('deckTempC') }),
      tempField({ allowEmpty: true, label: 'Measured dome', valueC: a.domeTempC, unit: u, step: 5, onChange: set('domeTempC') })
    ),
    h(
      'div',
      { class: 'row' },
      tempField({ allowEmpty: true, label: 'Ball core at launch', valueC: a.coreTempC, unit: u, step: 1, onChange: set('coreTempC') }),
      tempField({ allowEmpty: true, label: 'Measured fridge', valueC: a.fridgeTempC, unit: u, step: 1, onChange: set('fridgeTempC') }),
      numberField({ allowEmpty: true, label: 'Actual cold hold', value: a.coldHoldHours ?? '', min: 0, max: 200, step: 0.5, suffix: 'h', onInput: set('coldHoldHours') }),
      numberField({ allowEmpty: true, label: 'Actual bake time', value: a.bakeSec ?? '', min: 10, max: 900, step: 1, suffix: 'sec', onInput: set('bakeSec') })
    ),
    Number.isFinite(a.ambientTempC) && a.ambientTempC < 8
      ? h('p', { class: 'note warn' }, 'Cold ambient air pulls heat out of the deck between pizzas. Allow a longer recovery between launches than the schedule assumes.')
      : null
  );
}

/* --------------------------------- result ------------------------------- */

function resultCard(ctx) {
  const { s } = ctx;
  const scores = s.current.scores;
  const overall = overallScore(scores);
  const provisional = { scores, actuals: s.current.actuals };
  const hits = diagnose(provisional);

  return card(
    'Score this bake',
    'Five marks out of five. Whatever you leave blank is simply left out of the average.',
    scoreInputs(scores, (k, v) => update((st) => { st.current.scores[k] = v; })),
    h(
      'div',
      { class: 'stats' },
      h(
        'div',
        { class: 'stat' },
        h('span', { class: 'stat-label' }, 'Overall'),
        h('span', { class: 'stat-value' }, overall === null ? 'Not scored' : `${overall.toFixed(1)} / 5`),
        overall === null ? null : h('span', { class: 'stat-sub' }, stars(overall))
      )
    ),
    hits.length
      ? h(
          'div',
          {},
          h('p', { class: 'note warn' }, 'Based on what you recorded, these are the likely causes:'),
          h('ul', { class: 'src-list' }, ...hits.map((d) => h('li', {}, h('strong', {}, d.title), ' — ', d.fix)))
        )
      : null,
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn', onClick: () => fileBake(ctx, hits) }, icon('save'), 'File this bake in the log'),
      h('button', { class: 'btn ghost', onClick: () => go('log') }, icon('history_edu'), 'Open the log')
    )
  );
}

/* ----------------------------- troubleshooting -------------------------- */

function troubleshootingCard(ctx) {
  const { s } = ctx;
  const cat = s.ui?.diagCat || 'ALL';
  return card(
    'When it goes wrong',
    'Cause and fix for the faults this style throws up.',
    h(
      'details',
      { class: 'foldout' },
      h('summary', {}, `Browse all ${DIAGNOSTICS.length} faults`),
      h('div', { class: 'chip-row', style: { marginBottom: '8px' } }, ...CATEGORIES.map((cc) =>
        h('button', { class: `chip${cc.id === cat ? ' active' : ''}`, onClick: () => update((st) => { st.ui = { ...st.ui, diagCat: cc.id }; }) }, cc.label)
      )),
      h('div', { class: 'list' }, ...byCategory(cat).map((d) =>
        h(
          'div',
          { class: 'item' },
          h('div', { class: 'item-title' }, d.title),
          h('p', { style: { margin: 0, fontSize: '.8rem' } }, h('strong', {}, 'Cause. '), d.cause),
          h('p', { style: { margin: 0, fontSize: '.8rem' } }, h('strong', {}, 'Fix. '), d.fix)
        )
      ))
    )
  );
}

function fileBake(ctx, hits) {
  const bake = snapshotBake(ctx.s, { issues: hits.map((d) => d.id) });
  addBake(bake);
  update((st) => {
    st.current.actuals = { ...EMPTY_ACTUALS };
    st.current.scores = { ...EMPTY_SCORES };
    st.current.done = [];
    st.current.notes = '';
  });
  toast('Filed. The comparison screen picks it up straight away.');
  go('log');
}
