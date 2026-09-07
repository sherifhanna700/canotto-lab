// App shell: tab routing, the shared render context, and the unit toggle.

import { load, subscribe, update, addRecipe } from './lib/store.js';
import { readRecipeLink } from './lib/share.js';
import { h, clear, $, icon } from './lib/ui.js';
import { computeRecipe } from './model/dough.js';
import { solveSchedule, activeSteps } from './model/protocol.js';

import renderRecipes from './views/recipes.js';
import renderDough from './views/dough.js';
import renderProtocol from './views/protocol.js';
import renderBake from './views/bake.js';
import renderLog from './views/log.js';
import renderCompare from './views/compare.js';
import renderLab from './views/lab.js';
import renderSetup from './views/setup.js';
import renderHelp from './views/help.js';

const TABS = [
  { id: 'recipes', label: 'Recipes', icon: 'menu_book', render: renderRecipes },
  { id: 'dough', label: 'Dough', icon: 'calculate', render: renderDough },
  { id: 'protocol', label: 'Protocol', icon: 'checklist', render: renderProtocol },
  { id: 'bake', label: 'Bake', icon: 'local_fire_department', render: renderBake },
  { id: 'log', label: 'Log', icon: 'history_edu', render: renderLog },
  { id: 'compare', label: 'Compare', icon: 'insights', render: renderCompare },
  { id: 'lab', label: 'Lab', icon: 'science', render: renderLab },
  { id: 'setup', label: 'Setup', icon: 'tune', render: renderSetup },
  { id: 'help', label: 'Reference', icon: 'help', render: renderHelp },
];

let activeTab = location.hash.replace('#', '') || 'recipes';
if (!TABS.some((t) => t.id === activeTab)) activeTab = 'recipes';

/** Everything a view needs, recomputed on each render. */
export function context() {
  const s = load();
  const u = s.settings.unit;
  const c = computeRecipe(s.current.recipe);
  const sched = solveSchedule(s.current.schedule);
  return { s, u, c, S: s.current.schedule, E: s.current.equipment, sched, model: s.settings.model };
}

export function go(tabId) {
  activeTab = tabId;
  history.replaceState(null, '', `#${tabId}`);
  render();
}

function renderTabs() {
  const nav = clear($('#tabs'));
  for (const t of TABS) {
    nav.appendChild(
      h('button', { class: `tab${t.id === activeTab ? ' active' : ''}`, onClick: () => go(t.id) }, icon(t.icon), t.label)
    );
  }
}

function renderProgress(ctx) {
  const chip = $('#progress-chip');
  const steps = activeSteps(ctx);
  const done = ctx.s.current.done.filter((id) => steps.some((st) => st.id === id)).length;
  chip.hidden = activeTab !== 'protocol';
  $('#progress-text').textContent = `${done} / ${steps.length}`;
  $('#progress-fill').style.width = `${steps.length ? (done / steps.length) * 100 : 0}%`;
}

export function render() {
  const ctx = context();
  renderTabs();
  renderProgress(ctx);
  $('#brand-sub').textContent = ctx.s.current.title || 'Contemporary Canotto';
  $('#unit-toggle').textContent = `°${ctx.u}`;

  const main = clear($('#main'));
  const tab = TABS.find((t) => t.id === activeTab);
  try {
    for (const node of [tab.render(ctx)].flat()) if (node) main.appendChild(node);
  } catch (err) {
    console.error(err);
    main.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-body' }, h('p', { class: 'note bad' }, `Something went wrong rendering this screen: ${err.message}`))));
  }
  main.focus({ preventScroll: true });
}

$('#unit-toggle').addEventListener('click', () => {
  update((s) => {
    s.settings.unit = s.settings.unit === 'F' ? 'C' : 'F';
  });
});

window.addEventListener('hashchange', () => {
  const id = location.hash.replace('#', '');
  if (TABS.some((t) => t.id === id) && id !== activeTab) {
    activeTab = id;
    render();
  }
});

/** A shared recipe link drops straight into the library on first load. */
(function importSharedRecipe() {
  const incoming = readRecipeLink();
  if (!incoming) return;
  const s = load();
  addRecipe({
    id: `r${Date.now().toString(36)}`,
    name: incoming.name || 'Shared recipe',
    style: incoming.style || 'canotto',
    origin: 'shared',
    derivedFrom: null,
    createdAt: new Date().toISOString(),
    notes: incoming.notes || '',
    recipe: { ...s.current.recipe, ...incoming.recipe },
    schedule: { ...s.current.schedule, ...incoming.schedule },
    plan: null,
  });
  history.replaceState(null, '', location.pathname);
  activeTab = 'recipes';
})();

subscribe(() => render());
render();
