// App shell: tab routing, the shared render context, and the unit toggle.

import { load, subscribe, update, addRecipe, isDirty, saveCurrent, discardCurrent } from './lib/store.js?v=15b611c0';
import { readRecipeLink } from './lib/share.js?v=15b611c0';
import { THEMES, readTheme, setTheme, nextTheme, applyTheme, watchSystem, resolved } from './lib/theme.js?v=15b611c0';
import { h, $, icon, clear, toast } from './lib/ui.js?v=15b611c0';
import { computeRecipe } from './model/dough.js?v=15b611c0';
import { solveSchedule, activeSteps } from './model/protocol.js?v=15b611c0';

import renderRecipe from './views/recipe.js?v=15b611c0';
import renderProtocol from './views/protocol.js?v=15b611c0';
import renderBake from './views/bake.js?v=15b611c0';
import renderLog from './views/log.js?v=15b611c0';
import renderSetup from './views/setup.js?v=15b611c0';

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
/**
 * Is this a field where the keyboard carries state we must not destroy?
 *
 * Text entry on a phone keeps shift, auto-capitalisation and any in-progress
 * composition against the element itself. Replacing the element throws all of
 * that away, which is why a capital letter would not stick: the node it was
 * typed into no longer existed by the time the next key arrived.
 */
function isTextEntry(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  // Number fields are included: a value is typed one character at a time, and
  // "0." on the way to "0.05" is not something the model should see and echo
  // back. Sliders are not, since they commit on release and hold no state.
  return el.tagName === 'INPUT' && ['text', 'search', 'email', 'url', 'number'].includes(el.type);
}

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

/*
 * Foldouts stay open across a redraw.
 *
 * The screen is rebuilt from scratch each time, so a details element opened by
 * the baker came back closed on the next keystroke, taking whatever they were
 * reading with it. Remembered by summary text, which is stable and unique
 * within a screen.
 */
function captureFoldouts(root) {
  return new Set([...root.querySelectorAll('details[open]')].map((d) => d.querySelector('summary')?.textContent));
}

function restoreFoldouts(root, open) {
  if (!open.size) return;
  for (const d of root.querySelectorAll('details')) {
    if (open.has(d.querySelector('summary')?.textContent)) d.open = true;
  }
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

/**
 * The prose field currently being typed into, if any.
 *
 * Tracked explicitly rather than read from document.activeElement at render
 * time, because focus moves at its own pace: during a focusout the browser
 * still reports the old element as focused, so an inferred check skipped the
 * very redraw it was meant to trigger.
 */
let typingIn = null;

/**
 * The slider currently under a finger or a pointer, if any.
 *
 * A drag is a pointer interaction rather than a focus one, so it needs its own
 * guard. Rebuilding the screen mid-drag replaces the very element being
 * dragged: the thumb snaps back to the stored value and the gesture is lost,
 * because the finger is now on a node that is no longer in the page.
 */
let draggingSlider = null;

export function render() {
  const main = $('#main');

  /*
   * Never rebuild the screen underneath someone typing prose.
   *
   * The model has already been updated, so nothing is lost; only the redraw
   * waits until they leave the field. Number fields still redraw live, because
   * watching the gram table follow a hydration change is worth having and a
   * numeric keypad has no state to lose.
   */
  /*
   * Both suspensions are self-healing.
   *
   * They are lifted by focusout and pointerup, and if either never arrives,
   * because the element was removed or the window lost focus, the app would
   * stop redrawing altogether and look dead. So the guard also checks that the
   * thing it is protecting is still there and still being interacted with.
   */
  if (typingIn && (!main.contains(typingIn) || document.activeElement !== typingIn)) typingIn = null;
  if (draggingSlider && !main.contains(draggingSlider)) draggingSlider = null;

  if (typingIn) return;
  if (draggingSlider) return;

  const snap = captureFocus();
  const openFoldouts = captureFoldouts(main);
  const ctx = context();
  renderTabs();
  renderProgress(ctx);
  $('#brand-sub').textContent = ctx.s.current.title || 'Contemporary Canotto';
  $('#unit-toggle').textContent = `°${ctx.u}`;
  paintThemeButton();

  // Build off-document, then swap in one mutation. Replacing children one at a
  // time lets the browser paint a half-built screen, and leaves it juggling
  // raster tiles for content that is on its way out.
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
  restoreFoldouts(main, openFoldouts);
  restoreFocus(main, snap);
  renderSaveBar();
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

/**
 * The editing bar.
 *
 * Edits go to a working draft, not to the stored recipe, so this is what says
 * so: which recipe is open, that it has unsaved changes, and the two ways out.
 * It only exists while there is something to decide.
 */
function renderSaveBar() {
  const s = load();
  const bar = $('#save-bar');
  const dirty = isDirty(s);
  bar.hidden = !dirty;
  document.body.classList.toggle('has-save-bar', dirty);
  if (!dirty) return;

  const saved = s.recipes.find((r) => r.id === s.current.recipeId);
  const isHouse = saved?.origin === 'house';
  clear(bar);
  bar.appendChild(
    h(
      'div',
      { class: 'save-bar-inner' },
      h(
        'div',
        { class: 'save-bar-what' },
        h('span', { class: 'save-bar-name' }, s.current.title || 'Recipe'),
        h('span', { class: 'save-bar-note' }, isHouse ? 'Saving makes a copy of your own' : 'Unsaved changes')
      ),
      h(
        'div',
        { class: 'save-bar-actions' },
        h('button', { class: 'btn ghost small', onClick: () => { discardCurrent(); toast('Changes discarded'); } }, 'Discard'),
        h('button', {
          class: 'btn small',
          onClick: () => {
            const r = saveCurrent();
            toast(r.forked ? `Saved as ${r.name}. The house protocol is untouched.` : `Saved ${r.name}`);
          },
        }, icon('save'), isHouse ? 'Save as a copy' : 'Save')
      )
    )
  );
}

const foot = document.querySelector('.foot p');
if (foot) foot.textContent = `${foot.textContent} Build ${BUILD}.`;

// A throw inside a click handler never reaches the caller, so it would
// otherwise look like a button that simply does nothing.
window.addEventListener('error', (e) => {
  console.error('Canotto Lab:', e.message);
});

// Suspend redraws while a prose field has focus, and catch up on leaving it.
// focusin and focusout are used because focus and blur do not bubble.
/*
 * Enter finishes a field rather than navigating away from it.
 *
 * With no form to submit, the browser was free to hand Enter to the next
 * focusable control, which scrolled the page to somewhere unrelated. Blurring
 * commits the value, closes the keyboard, and leaves the page where it is.
 */
$('#main').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
  if (!['INPUT', 'SELECT'].includes(e.target.tagName)) return;
  e.preventDefault();
  e.target.blur();
});

$('#main').addEventListener('focusin', (e) => {
  if (isTextEntry(e.target)) typingIn = e.target;
});

const isSlider = (el) => el?.tagName === 'INPUT' && el.type === 'range';

$('#main').addEventListener('pointerdown', (e) => {
  if (isSlider(e.target)) draggingSlider = e.target;
});

// On the window, because a drag routinely ends with the pointer somewhere else.
for (const end of ['pointerup', 'pointercancel']) {
  window.addEventListener(end, () => {
    if (!draggingSlider) return;
    draggingSlider = null;
    render();
  });
}

$('#main').addEventListener('focusout', (e) => {
  if (e.target !== typingIn) return;
  typingIn = null;
  render();
});

subscribe(() => render());
render();
