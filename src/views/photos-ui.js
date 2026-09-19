// Photographs, wherever they are shown: the session in progress and filed bakes.
//
// One implementation for both. A picture taken during a bake and a picture
// added to it afterwards are the same picture, and the session keeps the id it
// will be filed under, so nothing is re-attached when the bake is filed.

import { h, toast, icon, confirmDialog } from '../lib/ui.js?v=53a849de';
import { update, photosForBake, addPhotoRecord, removePhotoRecord, removePhotoRecordsFor } from '../lib/store.js?v=53a849de';
import * as photos from '../lib/photos.js?v=53a849de';

export const urlCache = new Map();
const urlLoading = new Set();

/**
 * The object URL for a photograph, or null until it has been fetched.
 *
 * What photographs exist is known synchronously, because that lives with the
 * rest of the library. Only the bytes have to be waited for, and each one asks
 * for a redraw when it arrives.
 */
export function urlFor(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  if (!urlLoading.has(id)) {
    urlLoading.add(id);
    photos
      .photoUrl(id)
      .then((url) => urlCache.set(id, url))
      .catch(() => urlCache.set(id, null))
      .finally(() => {
        urlLoading.delete(id);
        update(() => {});
      });
  }
  return null;
}

/**
 * How many photographs something has, for a card that is not open.
 *
 * Known without touching IndexedDB, because what exists is recorded with the
 * rest of the library and only the bytes live in the picture store.
 */
export const photoCount = (ctx, bakeId) => photosForBake(ctx.s, bakeId).length;

export function lightbox(url) {
  const dlg = h(
    'div',
    { class: 'modal-backdrop lightbox', onClick: () => dlg.remove() },
    h('img', { src: url, alt: 'Bake photograph' })
  );
  document.body.appendChild(dlg);
}

/**
 * Delete every photograph of a bake or session: records, bytes, cached URLs.
 *
 * The records are dropped first and hand back the ids, so bytes that refuse to
 * go cannot leave a record pointing at a picture on its way out.
 */
export async function dropPhotosFor(bakeId) {
  const ids = removePhotoRecordsFor(bakeId);
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    await photos.removeBlob(id).catch(() => {});
    urlCache.delete(id);
  }
  return ids;
}

const FOOT = 'Photographs sync to your Google account as their own files, so they follow you between devices. They are not in the JSON export, which stays small and readable; download one from the picture itself if you want to keep it.';

/**
 * The picture strip for one bake, filed or still in progress.
 *
 * `bakeId` is the session's own id while it is being baked, and the same id
 * once it is filed, so the pictures need no moving.
 */
export function photoStrip(ctx, bakeId, { label = 'Photographs', empty = 'None yet.', hint = FOOT } = {}) {
  if (!photos.isSupported()) {
    return h('p', { class: 'note neutral' }, 'This browser has nowhere to keep photographs.');
  }
  const rows = photosForBake(ctx.s, bakeId);

  const pick = () => {
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const files = [...(input.files || [])];
      if (!files.length) return;
      try {
        for (const file of files) {
          // eslint-disable-next-line no-await-in-loop
          const record = await photos.addPhoto(file);
          addPhotoRecord({ ...record, bakeId });
        }
        toast(files.length === 1 ? 'Photo added' : `${files.length} photos added`);
      } catch (e) {
        toast(e.message || 'That image could not be added');
      }
      update(() => {});
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  };

  return h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    rows.length
      ? h('div', { class: 'photo-grid' }, ...rows.map((row) => {
          const url = urlFor(row.id);
          return h(
            'figure',
            { class: 'photo' },
            url
              ? h('img', {
                  src: url,
                  alt: `Photograph taken ${new Date(row.addedAt).toLocaleString()}`,
                  loading: 'lazy',
                  onClick: () => lightbox(url),
                })
              : /*
                 * Described but not here: this photograph belongs to the
                 * library and its bytes are still in Drive, on another device,
                 * or on the way. Saying so beats a broken frame.
                 */
                h('div', { class: 'photo-missing', title: 'Not on this device yet' }, h('span', { class: 'msym' }, 'cloud'), h('span', {}, 'Sync to fetch')),
            h('button', {
              class: 'photo-remove',
              title: 'Remove this photograph',
              'aria-label': 'Remove this photograph',
              onClick: (e) => {
                e.stopPropagation();
                confirmDialog('Remove this photograph? It goes from this device and from your Google account on the next sync.', async () => {
                  await photos.removeBlob(row.id).catch(() => {});
                  urlCache.delete(row.id);
                  removePhotoRecord(row.id);
                  toast('Removed');
                }, 'Remove');
              },
            }, h('span', { class: 'msym' }, 'close'))
          );
        }))
      : h('p', { class: 'hint' }, empty),
    h('div', { class: 'row tight' }, h('button', { class: 'btn ghost small', onClick: pick }, icon('add'), rows.length ? 'Add more' : 'Add photographs')),
    h('p', { class: 'hint', style: { fontSize: '.72rem' } }, hint)
  );
}
