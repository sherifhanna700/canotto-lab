// Appearance.
//
// Three states: follow the system, force light, force dark. The choice lives in
// its own storage key so the inline script in the head can apply it before the
// first paint, without waiting for the app to load.

const KEY = 'canotto-lab/theme';
export const THEMES = [
  { id: 'system', label: 'Match my device', icon: 'brightness_auto' },
  { id: 'light', label: 'Light', icon: 'light_mode' },
  { id: 'dark', label: 'Dark', icon: 'dark_mode' },
];

export function readTheme() {
  try {
    const v = localStorage.getItem(KEY);
    return THEMES.some((t) => t.id === v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function systemPrefersDark() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Resolve the preference to what is actually painted. */
export function resolved(pref = readTheme()) {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref;
}

export function applyTheme(pref = readTheme()) {
  document.documentElement.dataset.theme = resolved(pref);
  return pref;
}

export function setTheme(pref) {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // Private browsing. The choice still applies for this session.
  }
  return applyTheme(pref);
}

export function nextTheme(pref = readTheme()) {
  const i = THEMES.findIndex((t) => t.id === pref);
  return THEMES[(i + 1) % THEMES.length].id;
}

/** Follow the device while the preference is "system". */
export function watchSystem(onChange) {
  if (typeof matchMedia !== 'function') return;
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const handler = () => {
    if (readTheme() === 'system') {
      applyTheme('system');
      onChange?.();
    }
  };
  mq.addEventListener ? mq.addEventListener('change', handler) : mq.addListener(handler);
}
