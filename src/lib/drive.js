// Optional sync to the baker's own Google account.
//
// The app is local-first and works fully with no account. This is a layer on
// top: connect a Google account and the whole library is kept as a single JSON
// file, so it follows them between devices.
//
// Drive rather than a database of ours, because a baker's recipes are not ours
// to hold. The only store this project keeps counts devices, one date each,
// and its rules will not accept anything more. Here the app holds one public
// client id and the storage belongs to the baker.
//
// The scope is drive.appdata, which is the narrowest thing Drive offers: a
// hidden per-application folder that only this app can see. It is not a folder
// in their Drive that they browse past; it does not appear in Drive at all,
// and this app cannot see, list or touch a single other file they own. The
// consent screen says as much.
//
// The cost of that privacy is that they cannot open the file themselves, so
// the app has to offer a way to delete it. That is what deleteRemote is for,
// alongside the JSON download, which is the copy they can actually hold.
//
// The Google script is loaded on demand, so a visitor who never connects never
// downloads it.

/**
 * The app's OAuth client id. Public by design: it identifies the app, it is
 * not a secret, and Google enforces which origins may use it. Empty here means
 * sync is simply not offered. See docs/google-drive.md to fill it in.
 */
const BUILT_IN_CLIENT_ID = '551174233109-oht8hinkgu92qodvi9fvjsi8f6r5sc2k.apps.googleusercontent.com';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'openid email https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'canotto-lab.json';
const FILE_ID_KEY = 'canotto-lab/drive-file-id';
const CONNECTED_KEY = 'canotto-lab/drive-connected';
const ACCOUNT_KEY = 'canotto-lab/drive-account';

/** Set window.GOOGLE_CLIENT_ID to try a different client without a rebuild. */
export function clientId() {
  if (typeof window !== 'undefined' && window.GOOGLE_CLIENT_ID) return window.GOOGLE_CLIENT_ID;
  return BUILT_IN_CLIENT_ID;
}

export const isConfigured = () => !!clientId();

/*
 * The access token is kept for the life of the tab, and no longer.
 *
 * It goes in sessionStorage rather than localStorage, which is the difference
 * between surviving a reload and surviving a closed tab. A reload is the case
 * worth covering: without it, opening the app again meant another trip to
 * Google for a token it had just been given. Closing the tab is where it
 * should end, because a token is a bearer credential and the less time one
 * sits at rest the better.
 *
 * A cookie would be no safer here. Only a server can set HttpOnly, and this
 * app has none, so a cookie set from script is readable by exactly the same
 * things sessionStorage is, with a size limit and a copy attached to every
 * request thrown in. What keeps anyone signed in to Google is Google's own
 * cookie on their domain, which is what makes this quick when it does happen.
 *
 * There is no refresh token to be had either: Google does not issue them to
 * browser clients. So an hour is the ceiling however this is stored, and
 * storing it buys a reload, not a session.
 */
const TOKEN_KEY = 'canotto-lab/drive-token';

let token = readToken();

/** The token from this tab's session, if it is still worth having. */
function readToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.value || !(parsed.expiresAt > Date.now())) {
      sessionStorage.removeItem(TOKEN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function keepToken(next) {
  token = next;
  try {
    if (next) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage refused. The token still works for this page, and the next
    // reload simply asks Google again.
  }
}
let tokenClient = null;
let account = null;
const listeners = new Set();

export function onAccount(cb) {
  listeners.add(cb);
  cb(account);
  return () => listeners.delete(cb);
}

export const currentAccount = () => account;

/** Whether this browser has connected before, so the UI can say so. */
export const hasConnected = () => {
  try {
    return localStorage.getItem(CONNECTED_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * The address of the connected account, kept so the app can say which one it
 * is without asking Google every time the page loads. It never leaves this
 * browser, and disconnecting removes it.
 */
function rememberedAccount() {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

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
      keepToken({
        value: res.access_token,
        // A minute of slack, so a request never starts on a token that expires
        // while it is in flight.
        expiresAt: Date.now() + (Number(res.expires_in) || 3600) * 1000 - 60000,
      });
      resolve(token.value);
    };
    client.error_callback = (err) => reject(new Error(err?.type === 'popup_closed' ? 'Sign-in window was closed.' : 'Google sign-in failed.'));

    /*
     * Name the account we already know about.
     *
     * Without a hint Google has to ask which account this is, every session,
     * even though the app has been connected to one all along and can say so.
     * The hint answers that question in advance, so someone who has connected
     * before goes straight through instead of picking themselves out of a list
     * they did not need to see.
     *
     * It is only ever the address this browser stored when connecting. If it
     * is stale, or that account is not signed in, Google falls back to asking,
     * which is the right thing to do and needs no handling here.
     */
    const hint = rememberedAccount()?.email || undefined;
    client.requestAccessToken({ prompt: interactive ? 'consent' : '', ...(hint ? { hint } : {}) });
  });
}

async function api(url, { method = 'GET', headers = {}, body, interactive = false } = {}) {
  const access = await getToken({ interactive });
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${access}`, ...headers }, body });
  if (res.status === 401) {
    // The token was rejected, so drop it and let the caller decide whether to
    // ask the person to connect again.
    keepToken(null);
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
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    // The app still works, it just cannot name the account after a reload.
  }
  announce();
  return account;
}

export async function connect() {
  await getToken({ interactive: true });
  try {
    localStorage.setItem(CONNECTED_KEY, '1');
  } catch {
    // A browser refusing storage still works, it just forgets between visits.
  }
  return fetchAccount();
}

/** Try to pick up where we left off without showing the person anything. */
/**
 * Show the connection again after a reload, without contacting Google.
 *
 * There is no silent token here to be had. Google's token client always wants
 * a popup, and a popup without a click is either blocked or, worse, a sign-in
 * window appearing unbidden on every page load. Asking on load did exactly
 * that: it interrupted people who had already connected, and when the popup
 * was dismissed it left the screen offering to connect all over again.
 *
 * So nothing is asked for until there is something to do. The app remembers
 * which account was connected and says so, and the token is fetched at the
 * moment of a sync, off the back of the click that asked for it.
 */
export function resume() {
  if (!isConfigured() || !hasConnected()) return null;
  account = rememberedAccount() || { email: null, name: null };
  announce();
  return account;
}

export function disconnect() {
  if (token && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(token.value);
    } catch {
      // Revoking is a courtesy. Dropping the token locally is what matters.
    }
  }
  keepToken(null);
  account = null;
  try {
    localStorage.removeItem(CONNECTED_KEY);
    localStorage.removeItem(FILE_ID_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
    localStorage.removeItem(LAST_SYNC_KEY);
  } catch {
    // Nothing to clean up.
  }
  announce();
}

/* ------------------------------ last outcome ----------------------------- */

/*
 * What the last sync did, kept so it can be read rather than caught.
 *
 * This used to be a toast, which is the wrong shape for it: a line that
 * disappears while you are still reading, in a strip too narrow for a sentence,
 * telling you the one thing you might want to check again a minute later. It is
 * a record, so it is kept like one, and it survives a reload because that is
 * exactly when someone comes back to ask whether the sync actually worked.
 */
const LAST_SYNC_KEY = 'canotto-lab/drive-last-sync';

export function lastSync() {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function rememberSync(record) {
  try {
    if (record) localStorage.setItem(LAST_SYNC_KEY, JSON.stringify({ ...record, at: Date.now() }));
    else localStorage.removeItem(LAST_SYNC_KEY);
  } catch {
    // The sync still happened. Only the note about it is lost.
  }
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
  // spaces=appDataFolder is what confines the search to this app's own hidden
  // folder. Without it the query would run against the whole Drive, which this
  // token has no right to read anyway, and would simply come back empty.
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const res = await api(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
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
  // A new file has to be told to live in the hidden folder. An existing one
  // already does, and repeating the parent on an update is an error.
  const meta = id
    ? { name: FILE_NAME, mimeType: 'application/json' }
    : { name: FILE_NAME, mimeType: 'application/json', parents: ['appDataFolder'] };
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

/**
 * Remove the stored copy.
 *
 * This matters more here than it would with a visible file. The hidden folder
 * cannot be opened or emptied from Drive, so without this the only way to be
 * rid of the data would be to revoke the whole app in Google account settings.
 */
export async function deleteRemote() {
  const id = await findFile();
  if (!id) return false;
  await api(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' });
  try {
    localStorage.removeItem(FILE_ID_KEY);
  } catch {
    // Nothing to clean up.
  }
  return true;
}

/* ------------------------------ photo files ------------------------------ */

/*
 * One file per photograph, in the same hidden folder as the library.
 *
 * The library itself only names them, so it stays small and syncs in a moment
 * whatever else is stored. Pictures are immutable once taken: a given id always
 * means the same bytes, so a file that is already there never needs sending
 * again and either side can stop and resume without losing its place.
 */
const photoName = (id) => `photo-${id}.jpg`;

/** Which photographs the Drive folder already holds, as id to file id. */
async function listRemotePhotos() {
  const q = encodeURIComponent("name contains 'photo-' and trashed=false");
  const found = new Map();
  let pageToken = '';
  do {
    const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=nextPageToken,files(id,name)&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`;
    // eslint-disable-next-line no-await-in-loop
    const res = await api(url);
    // eslint-disable-next-line no-await-in-loop
    const body = await res.json();
    for (const file of body.files || []) {
      const match = /^photo-(.+)\.jpg$/.exec(file.name || '');
      if (match) found.set(match[1], file.id);
    }
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return found;
}

async function uploadPhoto(id, blob) {
  const meta = { name: photoName(id), mimeType: 'image/jpeg', parents: ['appDataFolder'] };
  const boundary = `canotto${Math.random().toString(36).slice(2)}`;
  // The bytes go up as base64 inside the multipart body, which is what the
  // simple upload endpoint accepts without a second round trip to start a
  // resumable session. A photograph of this size does not need one.
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read that photograph.'));
    reader.readAsDataURL(blob);
  });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64}\r\n--${boundary}--`;
  const res = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()).id;
}

async function downloadPhoto(fileId) {
  const res = await api(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return res.blob();
}

async function deleteRemotePhoto(fileId) {
  await api(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' });
}

/**
 * Make the folder and this device agree about which pictures exist.
 *
 * Sends what is here and missing there, fetches what is there and missing
 * here, and removes what has been deleted on either side. Everything is by id,
 * so a sync interrupted halfway simply picks up the rest next time.
 */
export async function syncPhotos({ wanted, removed, photos, onProgress = () => {} }) {
  const remote = await listRemotePhotos();
  const gone = new Set(removed || []);

  // A photograph deleted on either device is deleted from the folder, or the
  // next sync would hand it straight back.
  let deleted = 0;
  for (const [id, fileId] of remote) {
    if (!gone.has(id)) continue;
    // eslint-disable-next-line no-await-in-loop
    await deleteRemotePhoto(fileId).catch(() => {});
    remote.delete(id);
    deleted += 1;
  }

  const live = wanted.filter((id) => !gone.has(id));
  const here = await photos.whichArePresent(live);

  const toSend = live.filter((id) => here.has(id) && !remote.has(id));
  const toFetch = live.filter((id) => !here.has(id) && remote.has(id));
  let sent = 0;
  let fetched = 0;

  for (const id of toSend) {
    onProgress({ stage: 'up', done: sent, total: toSend.length });
    // eslint-disable-next-line no-await-in-loop
    const blob = await photos.getBlob(id);
    if (!blob) continue;
    // eslint-disable-next-line no-await-in-loop
    await uploadPhoto(id, blob);
    sent += 1;
  }

  for (const id of toFetch) {
    onProgress({ stage: 'down', done: fetched, total: toFetch.length });
    // eslint-disable-next-line no-await-in-loop
    const blob = await downloadPhoto(remote.get(id));
    // eslint-disable-next-line no-await-in-loop
    await photos.putBlob(id, blob);
    fetched += 1;
  }

  return { sent, fetched, deleted };
}

/* -------------------------------- merging -------------------------------- */

/**
 * What the file holds that this version has never heard of.
 *
 * A device on a later version writes fields this one does not know, and
 * rebuilding the document from the keys it does know would quietly strip them
 * on the way past: open the app on an old phone, sync, and the new phone's
 * work is gone from the file with nothing to show it happened. The schema
 * allows a document to carry more than it describes, so this carries it.
 *
 * The envelope's own header is rewritten on every write and is not carried.
 */
export function unknownFields(remote, state) {
  const HEADER = new Set(['$schema', 'app', 'exportedAt']);
  const out = {};
  for (const [k, v] of Object.entries(remote || {})) {
    if (!HEADER.has(k) && !(k in (state || {}))) out[k] = v;
  }
  return out;
}

const stamp = (doc) => Date.parse(doc?.updatedAt || doc?.createdAt || 0) || 0;

/**
 * Last write wins, per document, except where a deletion was recorded.
 *
 * Two devices editing different recipes both keep their work, and the same
 * recipe edited in two places keeps whichever was saved later. A sync never
 * decides on its own to delete anything: a record simply missing on one side
 * comes back from the other,
 * which is the right way round for something that cannot be undone.
 */
export function mergeCollections(local, remote, removed = []) {
  const gone = new Set(removed);
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
  // Anything either device deliberately deleted stays deleted. Without this
  // the merge below simply hands it back from the other side.
  return {
    merged: [...byId.values()].map((e) => e.doc).filter((d) => !gone.has(d.id)),
    pulled,
    pushed,
  };
}

/**
 * Pull, merge, push. Returns the merged state so the caller can persist it,
 * along with what moved in each direction.
 */
/** Has anything actually been done in this session, or is it just open? */
export function hasProgress(current) {
  if (!current) return false;
  if (Array.isArray(current.done) && current.done.length) return true;
  if (current.doneAt && Object.keys(current.doneAt).length) return true;
  const recorded = (obj) => obj && Object.values(obj).some((v) => v !== null && v !== undefined && v !== '');
  return recorded(current.actuals) || recorded(current.scores) || Boolean(current.notes);
}

/**
 * Which half-finished bake is the real one.
 *
 * A session is not a collection and cannot be merged item by item: a dough is
 * either the one on this device or the one on the other, and mixing the two
 * would produce a schedule nobody ran. So one of them wins whole.
 *
 * Which one is not simply the later. That was the first rule here and it was
 * wrong in the case that matters: open the app on a second device, change a
 * temperature, look around, and that device now holds the more recent session
 * while holding no bake at all. Syncing then threw away a real bake in
 * progress in favour of an idle screen, which is the one outcome worth
 * preventing.
 *
 * So a session with work in it beats one without, and only when both have work,
 * or neither does, does it come down to which was touched last. A session
 * nobody has touched has no stamp and loses to anything.
 *
 * When both sides have work and they differ, one of them is being set aside.
 * That is reported rather than done quietly, because it is somebody's evening.
 */
export function laterSession(mine, theirs) {
  const at = (c) => Date.parse(c?.updatedAt || 0) || 0;
  const pick = (current, from) => ({
    current,
    from,
    // True when the side not chosen also had a bake going.
    displaced: hasProgress(from === 'remote' ? mine : theirs)
      && JSON.stringify(mine || null) !== JSON.stringify(theirs || null),
  });

  if (!theirs) return pick(mine, 'local');
  if (!mine) return pick(theirs, 'remote');

  const mineWorking = hasProgress(mine);
  const theirsWorking = hasProgress(theirs);
  if (mineWorking !== theirsWorking) {
    return mineWorking ? pick(mine, 'local') : pick(theirs, 'remote');
  }
  return at(theirs) > at(mine) ? pick(theirs, 'remote') : pick(mine, 'local');
}

export async function sync(state, { envelope }) {
  // The click that started this is the gesture Google needs, so a token can be
  // asked for here even if the last one has expired.
  await getToken({ interactive: false });
  const id = await findFile();
  const remote = id ? await readFile(id) : { recipes: [], bakes: [] };

  /*
   * A deletion is a fact about the library, so it is merged like one: both
   * sides' tombstones are kept and applied to both sides' records.
   */
  const bakesRemoved = [...new Set([...(state.bakesRemoved || []), ...(remote.bakesRemoved || [])])];
  const recipesRemoved = [...new Set([...(state.recipesRemoved || []), ...(remote.recipesRemoved || [])])];

  const recipes = mergeCollections(state.recipes || [], Array.isArray(remote.recipes) ? remote.recipes : [], recipesRemoved);
  const bakes = mergeCollections(state.bakes || [], Array.isArray(remote.bakes) ? remote.bakes : [], bakesRemoved);
  const session = laterSession(state.current, remote.current);

  /*
   * Photographs are immutable, so their descriptions merge as a union by id
   * rather than by which is newer. Anything either side has deleted is taken
   * out of that union and stays out.
   */
  const removedIds = [...new Set([...(state.photosRemoved || []), ...(remote.photosRemoved || [])])];
  const gone = new Set(removedIds);
  const photoById = new Map();
  for (const p of [...(remote.photos || []), ...(state.photos || [])]) {
    if (p?.id && !gone.has(p.id)) photoById.set(p.id, p);
  }
  const mergedPhotos = [...photoById.values()];

  /*
   * The constants travel; the display unit does not. Whether this phone shows
   * Celsius is nobody else's business, but the Q10 curves decide every figure
   * the app produces, so the later word on them wins and both devices hold it.
   */
  const mineAt = Date.parse(state.settings?.modelUpdatedAt || 0) || 0;
  const theirsAt = Date.parse(remote.settings?.modelUpdatedAt || 0) || 0;
  const model = theirsAt > mineAt && remote.settings?.model
    ? { model: remote.settings.model, modelUpdatedAt: remote.settings.modelUpdatedAt }
    : null;

  const unknown = unknownFields(remote, state);

  const merged = {
    ...unknown,
    ...state,
    settings: model ? { ...state.settings, ...model } : state.settings,
    recipes: recipes.merged,
    bakes: bakes.merged,
    current: session.current,
    photos: mergedPhotos,
    photosRemoved: removedIds,
    bakesRemoved,
    recipesRemoved,
  };

  await writeFile(id, envelope(merged));
  return {
    state: merged,
    pulled: recipes.pulled + bakes.pulled,
    pushed: recipes.pushed + bakes.pushed,
    sessionFrom: session.from,
    // The other device also had a bake going, and it is not the one kept.
    sessionDisplaced: session.displaced,
    /*
     * Whether the session that won actually contains a bake, and whether the
     * stored copy held one at all. Without these the app said it had "sent
     * this device's bake in progress" while that device showed nothing ticked,
     * which is worse than saying nothing: it describes work that does not
     * exist and hides the fact that the file had none either.
     */
    sessionHasProgress: hasProgress(session.current),
    remoteHadSession: hasProgress(remote.current),
    // What the caller needs to reconcile the picture files themselves.
    photoIds: mergedPhotos.map((p) => p.id),
    photosRemoved: removedIds,
    bakesRemoved,
    recipesRemoved,
    /*
     * Whether the bake in progress actually moved, as opposed to both sides
     * already holding the same one.
     *
     * The comparison is against whichever side lost, because that is the side
     * that changed: a push changes the file, a pull changes this device.
     * Comparing against the file both ways reported a pull as nothing having
     * happened, which is the same silence this was meant to fix.
     */
    sessionMoved: JSON.stringify(session.current || null)
      !== JSON.stringify((session.from === 'remote' ? state.current : remote.current) || null),
    created: !id,
  };
}
