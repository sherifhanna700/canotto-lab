// Photographs of a bake, kept on the device.
//
// Pictures do not belong in localStorage: it holds a few megabytes of text and
// one photograph would eat the lot, taking the recipes with it. So they live in
// IndexedDB, which is meant for binary data and measures its room in hundreds
// of megabytes, and the bake record in localStorage carries nothing of them.
// They are joined by the bake's id and nothing else.
//
// They are also the one thing the app does not sync. A Drive file that fits in
// a pocket is what makes the sync quick and the storage small, and a dozen
// crumb shots would end that. It is said plainly on screen rather than left to
// be discovered when a phone comes up empty.
//
// Every photograph is scaled down and re-encoded before it is stored. A modern
// phone camera produces four thousand pixels across and eight megabytes, and
// nothing here is ever displayed larger than a card, so keeping the original
// would cost a hundred times what the picture is worth.

const DB_NAME = 'canotto-lab';
const DB_VERSION = 1;
const STORE = 'photos';

/** Long edge, in pixels. Generous for a crumb shot on a large screen. */
const MAX_EDGE = 1600;
const QUALITY = 0.82;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('This browser has no room for photographs.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        // Photographs are always asked for by the bake they belong to.
        store.createIndex('bakeId', 'bakeId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open the photo store.'));
  });
  return dbPromise;
}

const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    try {
      out = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('The photo store refused that.'));
  });
};

export const isSupported = () => Boolean(globalThis.indexedDB);

/**
 * Shrink a picture to something worth keeping.
 *
 * Returns a JPEG blob no larger than MAX_EDGE on its long side. Orientation is
 * left to the browser, which applies EXIF rotation when it decodes, so a photo
 * taken sideways arrives the right way up.
 */
export async function shrink(file, { maxEdge = MAX_EDGE, quality = QUALITY } = {}) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('That image could not be read.');
  return { blob, width, height };
}

const newId = () => `ph${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function addPhoto(bakeId, file) {
  if (!file?.type?.startsWith('image/')) throw new Error('That is not an image.');
  const { blob, width, height } = await shrink(file);
  const record = {
    id: newId(),
    bakeId,
    blob,
    type: 'image/jpeg',
    width,
    height,
    bytes: blob.size,
    addedAt: new Date().toISOString(),
  };
  await tx('readwrite', (store) => store.put(record));
  return record;
}

/** Every photograph for one bake, oldest first, without their blobs. */
export async function listPhotos(bakeId) {
  const rows = await tx('readonly', (store) => store.index('bakeId').getAll(bakeId));
  return (rows || [])
    .sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)))
    .map(({ blob, ...rest }) => rest);
}

export async function countPhotos(bakeId) {
  const n = await tx('readonly', (store) => store.index('bakeId').count(bakeId));
  return n || 0;
}

/*
 * Object URLs are cached and reused.
 *
 * The screen is rebuilt from scratch on every change, so minting a fresh URL
 * per render would hand the browser a new copy of every photograph several
 * times a second and never give one back. One URL per photograph, held until
 * it is deleted, is both faster and the only version that does not leak.
 */
const urls = new Map();

export async function photoUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const row = await tx('readonly', (store) => store.get(id));
  if (!row?.blob) return null;
  const url = URL.createObjectURL(row.blob);
  urls.set(id, url);
  return url;
}

function forgetUrl(id) {
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
}

export async function removePhoto(id) {
  forgetUrl(id);
  await tx('readwrite', (store) => store.delete(id));
}

export async function removePhotosFor(bakeId) {
  const rows = await listPhotos(bakeId);
  for (const row of rows) forgetUrl(row.id);
  await tx('readwrite', (store) => {
    for (const row of rows) store.delete(row.id);
  });
  return rows.length;
}

/** The whole store, for a total to show next to the other storage figures. */
export async function photoTotals() {
  const rows = await tx('readonly', (store) => store.getAll());
  return {
    count: (rows || []).length,
    bytes: (rows || []).reduce((sum, r) => sum + (r.bytes || r.blob?.size || 0), 0),
  };
}

export async function getBlob(id) {
  const row = await tx('readonly', (store) => store.get(id));
  return row?.blob || null;
}
