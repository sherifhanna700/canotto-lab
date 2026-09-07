// Optional Firebase sync.
//
// The app is local-first and fully usable with no account. Cloud sync is a
// layer on top: sign in, and recipes and bakes are mirrored to Firestore under
// your own user id so they follow you between devices.
//
// The SDK is loaded dynamically, so a visitor who never signs in never
// downloads it. Configuration is read from, in order:
//   1. window.FIREBASE_CONFIG, set by an optional firebase-config.js
//   2. a config pasted into the app and kept in localStorage
// Nothing is hardcoded here, so this repo carries no project keys.

const SDK = 'https://www.gstatic.com/firebasejs/10.12.5';
const CONFIG_KEY = 'canotto-lab/firebase-config';

let app = null;
let auth = null;
let db = null;
let fns = null;
let currentUser = null;
const userListeners = new Set();

export function readConfig() {
  if (typeof window !== 'undefined' && window.FIREBASE_CONFIG) return window.FIREBASE_CONFIG;
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveConfig(cfgOrText) {
  const cfg = typeof cfgOrText === 'string' ? parseConfig(cfgOrText) : cfgOrText;
  if (!cfg?.apiKey || !cfg?.projectId) throw new Error('That config is missing apiKey or projectId.');
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  app = null;
  return cfg;
}

export function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
  app = null;
  auth = null;
  db = null;
  currentUser = null;
}

/** Accept either JSON or the JS object literal the Firebase console shows. */
export function parseConfig(text) {
  const trimmed = String(text).trim();
  const braced = trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
  try {
    return JSON.parse(braced);
  } catch {
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${braced});`)();
  }
}

export const isConfigured = () => !!readConfig();

async function ensureApp() {
  if (app) return { app, auth, db, fns };
  const cfg = readConfig();
  if (!cfg) throw new Error('Firebase is not configured yet.');

  const [appMod, authMod, dbMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);

  app = appMod.initializeApp(cfg);
  auth = authMod.getAuth(app);
  db = dbMod.getFirestore(app);
  fns = { ...authMod, ...dbMod };

  authMod.onAuthStateChanged(auth, (u) => {
    currentUser = u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL } : null;
    userListeners.forEach((cb) => cb(currentUser));
  });

  return { app, auth, db, fns };
}

export function onUser(cb) {
  userListeners.add(cb);
  cb(currentUser);
  return () => userListeners.delete(cb);
}

export const user = () => currentUser;

export async function signIn() {
  const { auth: a, fns: f } = await ensureApp();
  const provider = new f.GoogleAuthProvider();
  try {
    await f.signInWithPopup(a, provider);
  } catch (e) {
    // Popups are blocked in some in-app browsers; redirect is the fallback.
    if (String(e.code || '').includes('popup')) await f.signInWithRedirect(a, provider);
    else throw e;
  }
  return currentUser;
}

export async function signOutNow() {
  const { auth: a, fns: f } = await ensureApp();
  await f.signOut(a);
}

/* --------------------------------- sync --------------------------------- */

const stamp = (doc) => doc.updatedAt || doc.createdAt || '1970-01-01T00:00:00.000Z';

/**
 * Two-way merge. Newest write wins per document, compared on updatedAt.
 * Returns the merged arrays plus a count of what moved in each direction.
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

async function readCollection(name) {
  const { db: d, fns: f } = await ensureApp();
  if (!currentUser) throw new Error('Not signed in.');
  const snap = await f.getDocs(f.collection(d, 'users', currentUser.uid, name));
  return snap.docs.map((s) => s.data());
}

async function writeDocs(name, docs) {
  const { db: d, fns: f } = await ensureApp();
  if (!currentUser) throw new Error('Not signed in.');
  // Firestore caps a batch at 500 writes.
  for (let i = 0; i < docs.length; i += 400) {
    const batch = f.writeBatch(d);
    for (const doc of docs.slice(i, i + 400)) {
      batch.set(f.doc(d, 'users', currentUser.uid, name, doc.id), JSON.parse(JSON.stringify(doc)));
    }
    // eslint-disable-next-line no-await-in-loop
    await batch.commit();
  }
}

/**
 * Pull, merge, push. Returns the merged state so the caller can persist it.
 */
export async function sync(state) {
  await ensureApp();
  if (!currentUser) throw new Error('Sign in first.');

  const [remoteRecipes, remoteBakes] = await Promise.all([readCollection('recipes'), readCollection('bakes')]);
  const r = mergeCollections(state.recipes || [], remoteRecipes);
  const b = mergeCollections(state.bakes || [], remoteBakes);

  const toPushRecipes = r.merged.filter((doc) => !remoteRecipes.some((x) => x.id === doc.id && stamp(x) >= stamp(doc)));
  const toPushBakes = b.merged.filter((doc) => !remoteBakes.some((x) => x.id === doc.id && stamp(x) >= stamp(doc)));

  await Promise.all([writeDocs('recipes', toPushRecipes), writeDocs('bakes', toPushBakes)]);

  return {
    recipes: r.merged,
    bakes: b.merged,
    pulled: r.pulled + b.pulled,
    pushed: toPushRecipes.length + toPushBakes.length,
  };
}

export async function deleteRemote(name, id) {
  const { db: d, fns: f } = await ensureApp();
  if (!currentUser) return;
  await f.deleteDoc(f.doc(d, 'users', currentUser.uid, name, id));
}
