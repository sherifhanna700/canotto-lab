// Reference: troubleshooting, and where the numbers come from.

import { h, card, chip, pill } from '../lib/ui.js';
import { update } from '../lib/store.js';
import { DIAGNOSTICS, CATEGORIES, byCategory } from '../model/diagnostics.js';
import { SOURCES, FLOURS } from '../model/flours.js';

export default function renderHelp(ctx) {
  return [diagnosticsCard(ctx), sourcesCard(), modelNoteCard()];
}

function diagnosticsCard(ctx) {
  const { s } = ctx;
  const cat = s.ui?.diagCat || 'ALL';
  const list = byCategory(cat);

  return card(
    'When it goes wrong',
    'Cause and fix for the faults this style throws up. The Bake screen picks these out automatically from what you record.',
    h('div', { class: 'chip-row' }, ...CATEGORIES.map((c) => chip(c.label, c.id === cat, () => update((st) => { st.ui = { ...st.ui, diagCat: c.id }; })))),
    h(
      'div',
      { class: 'list' },
      ...list.map((d) =>
        h(
          'div',
          { class: 'item' },
          h('div', { class: 'item-head' }, h('div', { class: 'item-title' }, d.title), pill(d.category, 'neutral')),
          h('p', { style: { margin: 0, fontSize: '.8rem' } }, h('strong', {}, 'Cause. '), d.cause),
          h('p', { style: { margin: 0, fontSize: '.8rem' } }, h('strong', {}, 'Fix. '), d.fix)
        )
      )
    )
  );
}

function sourcesCard() {
  const sourced = FLOURS.filter((f) => f.sourced).length;
  return card(
    'Where the numbers come from',
    `${sourced} of ${FLOURS.length} flours carry published strength or maturation figures. The rest are estimated from protein, and the app says so wherever it uses one.`,
    h('ul', { class: 'src-list' }, ...SOURCES.map((s) => h('li', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.label)))),
    h('p', { class: 'note neutral' }, 'W values vary by lot and mills revise their specs. Treat every figure as a starting point and let your own bake log overrule it.')
  );
}

function modelNoteCard() {
  return card(
    'How the fermentation model works',
    'Enough to know when to trust it.',
    h('p', { style: { fontSize: '.83rem', margin: 0 } }, 'One fermentation unit is one hour at 20 °C. Rate follows a Q10 law, doubling roughly every 10 °C, with a steeper coefficient below 15 °C because a fridge slows dough more than a single Q10 predicts, and a roll-off above 35 °C where heat starts to stress the yeast.'),
    h('p', { style: { fontSize: '.83rem', margin: 0 } }, 'Ripeness assumes inoculation and time trade off roughly inversely: halve the yeast and you need about twice the fermentation units. That holds well enough across the range this style works in, and badly at the extremes.'),
    h('p', { style: { fontSize: '.83rem', margin: 0 } }, 'The constant tying the two together is anchored to the house protocol, which ripens on 0.10% instant dry yeast across 23.4 units. It is a starting point. Log bakes, mark the good ones, and refit it to your own kitchen on the Setup screen.'),
    h('p', { class: 'note warn' }, 'The freeze buffer is deliberately left out of the ripeness reading. Extra yeast added to cover freeze mortality is replacing cells that will die, not adding fermentation.')
  );
}
