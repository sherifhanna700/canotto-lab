// Saving and sharing without a backend.
//
// Three routes, in order of how little setup they need:
//   1. localStorage      - automatic, this browser only.
//   2. A JSON file       - export once, keep it in Drive, iCloud or anywhere.
//   3. A link            - one recipe packed into a URL, small enough to text.
//
// The File System Access API, where the browser supports it, remembers the file
// you chose so later saves are one click. That is what makes "save to my Drive
// folder" work without any Google API at all: point it at a synced folder.

const supportsFS = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window;
export const canSaveToFile = supportsFS;

let handle = null;

export async function saveToFile(text, suggestedName = 'canotto-lab.json') {
  if (!supportsFS()) throw new Error('unsupported');
  if (!handle) {
    handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'Canotto Lab data', accept: { 'application/json': ['.json'] } }],
    });
  }
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return handle.name;
}

export async function openFromFile() {
  if (!supportsFS()) throw new Error('unsupported');
  const [picked] = await window.showOpenFilePicker({
    types: [{ description: 'Canotto Lab data', accept: { 'application/json': ['.json'] } }],
  });
  handle = picked;
  const file = await picked.getFile();
  return file.text();
}

export function forgetFile() {
  handle = null;
}

export function currentFileName() {
  return handle?.name || null;
}

/* --------------------------- share one recipe --------------------------- */

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Pack a recipe into a link. Only the definition travels, never the bake log. */
export function recipeLink(recipe, base = location.href.split('#')[0]) {
  const slim = {
    n: recipe.name,
    y: recipe.style,
    r: recipe.recipe,
    s: recipe.schedule,
    o: recipe.notes || '',
  };
  return `${base}#import=${toBase64Url(JSON.stringify(slim))}`;
}

export function readRecipeLink(hash = location.hash) {
  const m = /[#&]import=([A-Za-z0-9\-_]+)/.exec(hash);
  if (!m) return null;
  try {
    const slim = JSON.parse(fromBase64Url(m[1]));
    return { name: slim.n, style: slim.y, recipe: slim.r, schedule: slim.s, notes: slim.o };
  } catch (e) {
    console.warn('Could not read that recipe link.', e);
    return null;
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
