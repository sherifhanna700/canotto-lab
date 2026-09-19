// Opening a file somebody sent you.
//
// A recipe is the thing meant to travel between people, so this lives where a
// recipe does as well as in the saving screen: whoever is handed a file looks
// for the way in on the screen the file is about, not under settings.
//
// One implementation, used from both. The rule it enforces is that opening
// adds; only a full backup replaces anything, and that asks first.

import { h, icon, toast, confirmDialog } from '../lib/ui.js?v=2313eb03';
import { openShared, importJSON, load } from '../lib/store.js?v=2313eb03';

/**
 * Ask for a file without a dialog of our own.
 *
 * The input is created, clicked and dropped: the browser's own picker is the
 * only chooser, and nothing is left on the page afterwards.
 */
export function pickFile(onText) {
  const input = h('input', { type: 'file', accept: 'application/json', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      await onText(await f.text());
    } catch (e) {
      toast(e.message);
    }
  });
  document.body.appendChild(input);
  input.click();
  input.remove();
}

/** Open whatever was sent, and say what it turned out to be. */
export async function openSharedFile(text) {
  const res = openShared(text);
  if (res.needsConfirm) {
    const count = load().recipes.length + load().bakes.length;
    confirmDialog(`That is a full backup rather than a single recipe. Opening it replaces everything in this browser, including ${count} recipe${count === 1 ? '' : 's'} and bakes of your own, and cannot be undone.`,
      () => { importJSON(text); toast('Data restored'); }, 'Replace everything');
    return res;
  }
  if (res.kind === 'recipe' || res.kind === 'recipes') {
    toast(res.added === 1
      ? `Added ${res.names[0]}. It is on the Recipes screen, ready to load.`
      : `Added ${res.added} recipes to your library.`);
    return res;
  }
  toast(res.added
    ? `Added ${res.added} run${res.added === 1 ? '' : 's'} to your log.`
    : 'Nothing new in that file.');
  return res;
}

/** The button itself, so both screens offer the same one. */
export const openSharedButton = (label = 'Open a shared recipe') =>
  h('button', { class: 'btn ghost small', onClick: () => pickFile(openSharedFile) }, icon('folder_open'), label);
