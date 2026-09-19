// Two tools used during a run, and not a screen of their own.
//
// These were a Bake tab, which made a second place a bake seemed to live: it
// edited the same bake time as the schedule card and scored the same five
// marks as the protocol's last step. A run is one continuous thing, so the
// walkthrough now sits on the step it describes and the fault library sits
// with the diagnosis at the end. Neither records anything.

import { h, card, stat, pill, icon, sliderField } from '../lib/ui.js?v=bbceb21b';
import { update } from '../lib/store.js?v=bbceb21b';
import { bakeStages, ovenLabel } from '../model/equipment.js?v=bbceb21b';
import { DIAGNOSTICS, CATEGORIES, byCategory } from '../model/diagnostics.js?v=bbceb21b';

let simIndex = 0;
let timerId = null;
let elapsed = 0;


/* ------------------------------- simulator ------------------------------ */

export function heatModulation(ctx) {
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



/* ----------------------------- troubleshooting -------------------------- */

export function faultBrowser(ctx) {
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

