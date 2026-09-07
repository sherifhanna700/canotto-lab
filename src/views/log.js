// The bake log: every run, what it was made of, and what came out.

import { h, card, pill, toast, icon, confirmDialog, selectField, numberField, chip } from '../lib/ui.js';
import { update, updateBake, deleteBake, download, exportJSON } from '../lib/store.js';
import { computeRecipe } from '../model/dough.js';
import { scheduleStages } from '../model/protocol.js';
import { fermentUnits } from '../model/ferment.js';
import { overallScore, SCORE_KEYS, recipeRating } from '../model/recipes.js';
import { fmtTemp, fmtDuration, toDisplay, round } from '../model/units.js';
import { diagnose, DIAGNOSTICS } from '../model/diagnostics.js';
import { stars, scoreInputs, tempField } from './common.js';
import { bakeCSV } from '../lib/csv.js';
import { go } from '../app.js';

export default function renderLog(ctx) {
  const { s } = ctx;
  const bakes = [...s.bakes].sort((a, b) => String(b.bakedAt || '').localeCompare(String(a.bakedAt || '')));

  if (!bakes.length) {
    return [
      card(
        'Bake log',
        'Nothing filed yet.',
        h('div', { class: 'empty' }, h('span', { class: 'msym' }, 'history_edu'), h('p', {}, 'Run a bake, score it on the Bake screen, and it lands here. Once two bakes differ in one variable, the Compare screen can tell you which way it moved.'))
      ),
    ];
  }

  return [
    card(
      'Bake log',
      `${bakes.length} bake${bakes.length > 1 ? 's' : ''} recorded.`,
      h(
        'div',
        { class: 'row tight' },
        h('button', { class: 'btn ghost small', onClick: () => download('canotto-bakes.csv', bakeCSV(s), 'text/csv') }, icon('download'), 'Export CSV'),
        h('button', { class: 'btn ghost small', onClick: () => download('canotto-lab.json', exportJSON()) }, icon('download'), 'Export everything')
      )
    ),
    ...bakes.map((b) => bakeCard(ctx, b)),
  ];
}

function bakeCard(ctx, b) {
  const { u, s } = ctx;
  const c = computeRecipe(b.recipe);
  const stages = scheduleStages(b.schedule);
  const fu = fermentUnits(stages, ctx.model);
  const score = overallScore(b.scores);
  const open = s.ui?.openBake === b.id;
  const hits = diagnose(b);

  return card(
    b.title || b.recipeName || 'Bake',
    `${new Date(b.bakedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${c.flourLabel}`,
    h(
      'div',
      { class: 'spread' },
      h(
        'div',
        { class: 'chip-row' },
        pill(`${b.recipe.hydrationPct}% hydration`, 'neutral'),
        pill(`${b.recipe.method}`, 'neutral'),
        pill(`${fmtDuration(b.schedule.coldProofHours)} at ${fmtTemp(b.schedule.fridgeTempC, u)}`, 'neutral'),
        pill(`${fu.toFixed(1)} FU`, 'neutral'),
        pill(`${b.recipe.baseYeastPct}% ${b.recipe.yeastType.toUpperCase()}`, 'neutral'),
        Number.isFinite(b.actuals?.ambientTempC) ? pill(`ambient ${fmtTemp(b.actuals.ambientTempC, u)}`, 'neutral') : null,
        b.planned ? pill('Planned', 'accent') : null
      ),
      h('div', {}, h('span', { class: 'rating' }, score === null ? 'Unscored' : `${score.toFixed(1)} / 5`), ' ', stars(score))
    ),
    b.notes ? h('p', { class: 'note neutral' }, b.notes) : null,
    hits.length ? h('p', { class: 'note warn' }, `Likely: ${hits.map((d) => d.title).join('; ')}`) : null,
    h(
      'div',
      { class: 'item-actions' },
      h('button', { class: 'btn ghost small', onClick: () => update((st) => { st.ui = { ...st.ui, openBake: open ? null : b.id }; }) }, icon(open ? 'expand_less' : 'expand_more'), open ? 'Close' : 'Edit scores and detail'),
      h('button', { class: 'btn ghost small', onClick: () => confirmDialog('Delete this bake?', () => { deleteBake(b.id); toast('Deleted'); }, 'Delete') }, icon('delete'), 'Delete')
    ),
    open ? editor(ctx, b) : null
  );
}

function editor(ctx, b) {
  const { u } = ctx;
  const setScore = (k, v) => updateBake(b.id, { scores: { ...b.scores, [k]: v } });
  const setActual = (k) => (v) => updateBake(b.id, { actuals: { ...b.actuals, [k]: v } });

  return h(
    'div',
    { style: { display: 'grid', gap: '12px', marginTop: '6px' } },
    scoreInputs(b.scores, setScore),
    h(
      'div',
      { class: 'row' },
      tempField({ label: 'Ambient', valueC: b.actuals?.ambientTempC, unit: u, onChange: setActual('ambientTempC') }),
      tempField({ label: 'Floor', valueC: b.actuals?.deckTempC, unit: u, step: 5, onChange: setActual('deckTempC') }),
      tempField({ label: 'Ball core', valueC: b.actuals?.coreTempC, unit: u, onChange: setActual('coreTempC') }),
      numberField({ label: 'Bake time', value: b.actuals?.bakeSec ?? '', suffix: 'sec', onInput: setActual('bakeSec') })
    ),
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Notes'),
      h('span', { class: 'field-input' }, h('textarea', { rows: 3, onInput: (e) => updateBake(b.id, { notes: e.target.value }) }, b.notes || ''))
    ),
    h(
      'div',
      { class: 'field' },
      h('span', { class: 'field-label' }, 'Faults seen'),
      h(
        'div',
        { class: 'chip-row' },
        ...DIAGNOSTICS.map((d) =>
          chip(d.title, (b.issues || []).includes(d.id), () => {
            const set = new Set(b.issues || []);
            set.has(d.id) ? set.delete(d.id) : set.add(d.id);
            updateBake(b.id, { issues: [...set] });
          })
        )
      )
    )
  );
}
