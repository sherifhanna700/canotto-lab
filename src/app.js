// App shell: tab routing, the shared render context, and the unit toggle.

import { load, subscribe, update, addRecipe } from './lib/store.js?v=1c325d9e';
import { readRecipeLink } from './lib/share.js?v=1c325d9e';
import { THEMES, readTheme, setTheme, nextTheme, applyTheme, watchSystem, resolved } from './lib/theme.js?v=1c325d9e';
import { h, $, icon } from './lib/ui.js?v=1c325d9e';
import { computeRecipe } from './model/dough.js?v=1c325d9e';
import { solveSchedule, activeSteps } from './model/protocol.js?v=1c325d9e';

import renderRecipe from './views/recipe.js?v=1c325d9e';
import renderProtocol from './views/protocol.js?v=1c325d9e';
import renderBake from './views/bake.js?v=1c325d9e';
import renderLog from './views/log.js?v=1c325d9e';
import renderSetup from './views/setup.js?v=1c325d9e';

const TABS = [
  { id: 'recipe', label: 'Recipe', icon: 'menu_book', render: renderRecipe },
  { id: 'protocol', label: 'Protocol', icon: 'checklist', render: renderProtocol },
  { id: 'bake', label: 'Bake', icon: 'local_fire_department', render: renderBake },
  { id: 'log', label: 'Log', icon: 'history_edu', render: renderLog },
  { id: 'setup', label: 'Setup', icon: 'tune', render: renderSetup },
];

/**
 * The build id, read off this module's own stamped URL. Shown in the footer so
 * "am I looking at the current version" has an answer without guesswork.
 */
export const BUILD = new URL(import.meta.url).searchParams.get('v') || 'dev';

let activeTab = location.hash.replace('#', '') || 'recipe';
if (!TABS.some((t) => t.id === activeTab)) activeTab = 'recipe';

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

  /*
   * Screens differ enormously in height, and swapping a tall one for a short
   * one is where the previous screen was ghosting through. Two things cause
   * that, and both are handled here.
   *
   * Scrolling to the top happens BEFORE the swap. Replacing the content first
   * collapses the page under a scroll position that no longer exists, so the
   * browser has to clamp the scroll, relayout and re-raster in one go, which
   * is exactly when it serves stale tiles.
   *
   * The container is then detached from the layout for the duration of the
   * swap. Hiding it discards its compositing layers outright, so there are no
   * old tiles left to show. Reading offsetHeight forces the new layout before
   * it is shown again, so this is not visible as a flash.
   */
  // Only scroll if there is somewhere to scroll from. A pointless scroll to
  // top is itself enough to make Android animate its address bar back in.
  if (window.scrollY > 0) window.scrollTo(0, 0);

  const main = $('#main');
  main.style.display = 'none';
  render();
  void main.offsetHeight;
  main.style.display = '';

  main.focus({ preventScroll: true });
}

/*
 * Focus survives a re-render.
 *
 * Every keystroke updates the model, which rebuilds the screen. Without this,
 * the input being typed into is destroyed and replaced, so the first character
 * lands and the rest go nowhere: typing 68 stored 6. Each field carries a
 * stable key, and the caret is put back where it was.
 */
function captureFocus() {
  const el = document.activeElement;
  if (!el || !el.dataset?.key) return null;
  const snap = { key: el.dataset.key };
  try {
    snap.start = el.selectionStart;
    snap.end = el.selectionEnd;
  } catch {
    // Number inputs do not expose a selection in every browser.
  }
  return snap;
}

/** Disambiguate repeated labels, such as the Share field on each flour row. */
function assignKeys(root) {
  const seen = new Map();
  for (const el of root.querySelectorAll('[data-k]')) {
    const k = el.dataset.k;
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    el.dataset.key = `${k}#${n}`;
  }
}

function restoreFocus(root, snap) {
  if (!snap) return;
  const el = root.querySelector(`[data-key="${CSS.escape(snap.key)}"]`);
  if (!el) return;
  el.focus({ preventScroll: true });
  if (snap.start !== null && snap.start !== undefined) {
    try {
      el.setSelectionRange(snap.start, snap.end);
    } catch {
      // Not selectable, focus alone is enough.
    }
  }
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
  const snap = captureFocus();
  const ctx = context();
  renderTabs();
  renderProgress(ctx);
  $('#brand-sub').textContent = ctx.s.current.title || 'Contemporary Canotto';
  $('#unit-toggle').textContent = `°${ctx.u}`;
  paintThemeButton();

  // Build off-document, then swap in one mutation. Replacing children one at a
  // time lets the browser paint a half-built screen, and leaves it juggling
  // raster tiles for content that is on its way out.
  const main = $('#main');
  const next = document.createDocumentFragment();
  const tab = TABS.find((t) => t.id === activeTab);
  try {
    for (const node of [tab.render(ctx)].flat()) if (node) next.appendChild(node);
  } catch (err) {
    console.error(err);
    next.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-body' }, h('p', { class: 'note bad' }, `Something went wrong rendering this screen: ${err.message}`))));
  }
  main.replaceChildren(next);

  assignKeys(main);
  restoreFocus(main, snap);
}

function paintThemeButton() {
  const pref = readTheme();
  const t = THEMES.find((x) => x.id === pref) || THEMES[0];
  const btn = $('#theme-toggle');
  btn.replaceChildren(icon(t.icon));
  btn.title = `Appearance: ${t.label.toLowerCase()}`;
  btn.setAttribute('aria-label', `Appearance: ${t.label}. Tap to change.`);
}

$('#theme-toggle').addEventListener('click', () => {
  setTheme(nextTheme());
  paintThemeButton();
  render();
});

watchSystem(() => render());
applyTheme();
paintThemeButton();

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
    origin: 'user',
    derivedFrom: null,
    createdAt: new Date().toISOString(),
    notes: incoming.notes || '',
    recipe: incoming.recipe,
    schedule: incoming.schedule,
    plan: null,
  });
  history.replaceState(null, '', location.pathname);
  activeTab = 'recipe';
})();

const foot = document.querySelector('.foot p');
if (foot) foot.textContent = `${foot.textContent} Build ${BUILD}.`;

// A throw inside a click handler never reaches the caller, so it would
// otherwise look like a button that simply does nothing.
window.addEventListener('error', (e) => {
  console.error('Canotto Lab:', e.message);
});

subscribe(() => render());
render();
