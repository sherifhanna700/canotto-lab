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

let navBuilt = false;

/**
 * The nav is built once and only its classes change afterwards. Rebuilding it
 * every render reset the horizontal scroll, which hid the active tab whenever
 * it sat off to the right.
 */
function renderTabs() {
  const nav = $('#tabs');
  const justBuilt = !navBuilt;
  if (!navBuilt) {
    for (const t of TABS) {
      nav.appendChild(h('button', { class: 'tab', dataset: { id: t.id }, onClick: () => go(t.id) }, icon(t.icon), t.label));
    }
    navBuilt = true;
  }
  for (const btn of nav.children) btn.classList.toggle('active', btn.dataset.id === activeTab);
  if (justBuilt) {
    // On the first paint the strip has not been laid out, and the web fonts
    // land later and change every tab's width. Position it once after layout
    // and again once the fonts have settled, both without animation.
    const settle = () => keepActiveTabVisible(nav);
    requestAnimationFrame(settle);
    if (document.fonts?.ready) document.fonts.ready.then(settle).catch(() => {});
  } else {
    keepActiveTabVisible(nav);
  }
}

/**
 * Scroll the strip only when the active tab is not already fully in view.
 * scrollLeft is assigned directly rather than going through scrollTo with a
 * smooth behavior, which silently does nothing in some contexts and left the
 * active tab off screen.
 */
function keepActiveTabVisible(nav) {
  const active = nav.querySelector('.tab.active');
  if (!active || !nav.clientWidth) return;
  const pad = 16;
  const left = active.offsetLeft - nav.offsetLeft;
  const right = left + active.offsetWidth;
  if (left < nav.scrollLeft + pad) {
    nav.scrollLeft = Math.max(0, left - pad);
  } else if (right > nav.scrollLeft + nav.clientWidth - pad) {
    nav.scrollLeft = right - nav.clientWidth + pad;
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
