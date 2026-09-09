// Optional Google Drive sync.
//
// The app is local-first and works fully with no account. This is a layer on
// top: connect a Google account and the whole library is kept as a single
// JSON file in that person's own Drive, so it follows them between devices and
// they keep it if they stop using the app.
//
// Drive rather than a database because this is a static site with no server.
// A database would mean every baker creating a cloud project of their own,
// which nobody is going to do for a pizza tracker. Here the app holds one
// public client id, and the file lives in the baker's Drive, not ours.
//
// The scope is drive.file, which grants access only to files this app itself
// created. It cannot see anything else in the Drive, and the consent screen
// says so.
//
// The Google script is loaded on demand, so a visitor who never connects
// never downloads it.

/**
 * The app's OAuth client id. Public by design: it identifies the app, it is
 * not a secret, and Google enforces which origins may use it. Empty here means
 * sync is simply not offered. See docs/google-drive.md to fill it in.
 */
const BUILT_IN_CLIENT_ID = '';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
const FILE_NAME = 'canotto-lab.json';
const FILE_ID_KEY = 'canotto-lab/drive-file-id';
const CONNECTED_KEY = 'canotto-lab/drive-connected';

/** Set window.GOOGLE_CLIENT_ID to try a different client without a rebuild. */
export function clientId() {
  if (typeof window !== 'undefined' && window.GOOGLE_CLIENT_ID) return window.GOOGLE_CLIENT_ID;
  return BUILT_IN_CLIENT_ID;
}

export const isConfigured = () => !!clientId();

/*
 * The access token is deliberately kept in memory only. Writing it to storage
 * would leave a live credential sitting in the browser for anything else on
 * the origin to read, and it buys nothing: Google will re-issue one without a
 * prompt while the Google session is alive.
 */
let token = null;
let tokenClient = null;
let account = null;
const listeners = new Set();

export function onAccount(cb) {
  listeners.add(cb);
  cb(account);
  return () => listeners.delete(cb);
}

export const currentAccount = () => account;

/** Whether this browser has connected before, so the UI can offer to resume. */
export const hasConnected = () => {
  try {
    return localStorage.getItem(CONNECTED_KEY) === '1';
  } catch {
    return false;
  }
};

function announce() {
  for (const cb of listeners) cb(account);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded) return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not reach Google.')));
      return undefined;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => { el.dataset.loaded = '1'; resolve(); };
    el.onerror = () => reject(new Error('Could not reach Google.'));
    document.head.appendChild(el);
    return undefined;
  });
}

async function ensureClient() {
  const id = clientId();
  if (!id) throw new Error('Drive sync is not set up for this build.');
  if (tokenClient) return tokenClient;
  await loadScript(GIS_SRC);
  if (!window.google?.accounts?.oauth2) throw new Error('Google sign-in did not load.');
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: id,
    scope: SCOPE,
    callback: () => {},
  });
  return tokenClient;
}

const tokenIsLive = () => token && token.expiresAt > Date.now();

/**
 * Get a usable access token.
 *
 * `interactive` false asks Google to issue one without showing anything, which
 * works while the person is still signed in to Google and has granted consent
 * before. That is what makes returning to the app feel like staying signed in
 * without keeping a credential on disk.
 */
async function getToken({ interactive }) {
  if (tokenIsLive()) return token.value;
  const client = await ensureClient();
  return new Promise((resolve, reject) => {
    client.callback = (res) => {
      if (res.error) {
        reject(new Error(res.error === 'access_denied' ? 'Google access was declined.' : `Google sign-in failed: ${res.error}`));
        return;
      }
      token = {
        value: res.access_token,
        // A minute of slack, so a request never starts on a token that expires
        // while it is in flight.
        expiresAt: Date.now() + (Number(res.expires_in) || 3600) * 1000 - 60000,
      };
      resolve(token.value);
    };
    client.error_callback = (err) => reject(new Error(err?.type === 'popup_closed' ? 'Sign-in window was closed.' : 'Google sign-in failed.'));
    client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

async function api(url, { method = 'GET', headers = {}, body, interactive = false } = {}) {
  const access = await getToken({ interactive });
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${access}`, ...headers }, body });
  if (res.status === 401) {
    // The token was rejected, so drop it and let the caller decide whether to
    // ask the person to connect again.
    token = null;
    throw new Error('Google access expired. Connect again.');
  }
  if (!res.ok) throw new Error(`Drive said ${res.status}. ${(await res.text()).slice(0, 120)}`);
  return res;
}

async function fetchAccount() {
  try {
    const res = await api('https://www.googleapis.com/oauth2/v3/userinfo');
    const info = await res.json();
    account = { email: info.email || null, name: info.name || null };
  } catch {
    // Knowing which account is connected is a convenience, not a requirement.
    account = { email: null, name: null };
  }
  announce();
  return account;
}

export async function connect() {
  await getToken({ interactive: true });
  try {
    localStorage.setItem(CONNECTED_KEY, '1');
  } catch {
    // A browser refusing storage still works, it just cannot resume silently.
  }
  return fetchAccount();
}

/** Try to pick up where we left off without showing the person anything. */
export async function resume() {
  if (!isConfigured() || !hasConnected()) return null;
  try {
    await getToken({ interactive: false });
    return await fetchAccount();
  } catch {
    return null;
  }
}

export function disconnect() {
  if (token && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(token.value);
    } catch {
      // Revoking is a courtesy. Dropping the token locally is what matters.
    }
  }
  token = null;
  account = null;
  try {
    localStorage.removeItem(CONNECTED_KEY);
    localStorage.removeItem(FILE_ID_KEY);
  } catch {
    // Nothing to clean up.
  }
  announce();
}

/* ------------------------------- the file -------------------------------- */

const rememberedFileId = () => {
  try {
    return localStorage.getItem(FILE_ID_KEY);
  } catch {
    return null;
  }
};

async function findFile() {
  const remembered = rememberedFileId();
  if (remembered) {
    try {
      await api(`https://www.googleapis.com/drive/v3/files/${remembered}?fields=id,trashed`);
      return remembered;
    } catch {
      // Deleted, or belongs to another account now. Fall through and search.
    }
  }
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const res = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
  const { files } = await res.json();
  const id = files?.[0]?.id || null;
  if (id) {
    try {
      localStorage.setItem(FILE_ID_KEY, id);
    } catch {
      // Not fatal; it will be found by search next time.
    }
  }
  return id;
}

async function readFile(id) {
  const res = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The file in Drive is not readable as Canotto Lab data.');
  }
}

async function writeFile(id, text) {
  const meta = { name: FILE_NAME, mimeType: 'application/json' };
  const boundary = `canotto${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
  const url = id
    ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart&fields=id`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
  const res = await api(url, {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const out = await res.json();
  try {
    localStorage.setItem(FILE_ID_KEY, out.id);
  } catch {
    // Same as above.
  }
  return out.id;
}

/* -------------------------------- merging -------------------------------- */

const stamp = (doc) => Date.parse(doc?.updatedAt || doc?.createdAt || 0) || 0;

/**
 * Last write wins, per document.
 *
 * Two devices editing different recipes both keep their work, and the same
 * recipe edited in two places keeps whichever was saved later. Nothing is
 * deleted by a sync: a recipe removed on one device comes back from the other,
 * which is the right way round for something that cannot be undone.
 */
export function mergeCollections(local, remote) {
  const byId = new Map();
  for (const doc of remote) byId.set(doc.id, { doc, from: 'remote' });
  let pulled = 0;
  let pushed = 0;
  for (const doc of local) {
    const existing = byId.get(doc.id);
    if (!existing) {
      byId.set(doc.id, { doc, from: 'local' });
      pushed += 1;
    } else if (stamp(doc) > stamp(existing.doc)) {
      byId.set(doc.id, { doc, from: 'local' });
      pushed += 1;
    } else if (stamp(doc) < stamp(existing.doc)) {
      pulled += 1;
    }
  }
  for (const [id, entry] of byId) {
    if (entry.from === 'remote' && !local.some((d) => d.id === id)) pulled += 1;
  }
  return { merged: [...byId.values()].map((e) => e.doc), pulled, pushed };
}

/**
 * Pull, merge, push. Returns the merged state so the caller can persist it,
 * along with what moved in each direction.
 */
export async function sync(state, { envelope }) {
  const id = await findFile();
  const remote = id ? await readFile(id) : { recipes: [], bakes: [] };

  const recipes = mergeCollections(state.recipes || [], Array.isArray(remote.recipes) ? remote.recipes : []);
  const bakes = mergeCollections(state.bakes || [], Array.isArray(remote.bakes) ? remote.bakes : []);
  const merged = { ...state, recipes: recipes.merged, bakes: bakes.merged };

  await writeFile(id, envelope(merged));
  return {
    state: merged,
    pulled: recipes.pulled + bakes.pulled,
    pushed: recipes.pushed + bakes.pushed,
    created: !id,
  };
}
