// Setup: the things that describe your kitchen rather than a particular dough.
// Equipment, the temperatures you actually have, units, saving and sync.

import { h, card, selectField, textField, numberField, chip, stat, pill, toast, icon, confirmDialog } from '../lib/ui.js?v=bbceb21b';
import { editCurrent, update, exportJSON, exportStateJSON, importJSON, openShared, download, resetAll, load, applySync } from '../lib/store.js?v=bbceb21b';
import { OVENS, MIXERS, findOven, findMixer, ovenLabel, mixerLabel, DEFAULT_EQUIPMENT } from '../model/equipment.js?v=bbceb21b';
import { DEFAULT_MODEL, rateAt, maturationRateAt, fermentUnits } from '../model/ferment.js?v=bbceb21b';
import { scheduleStages } from '../model/protocol.js?v=bbceb21b';
import { convertYeast } from '../model/dough.js?v=bbceb21b';
import { overallScore } from '../model/recipes.js?v=bbceb21b';
import { SOURCES, FLOURS } from '../model/flours.js?v=bbceb21b';
import { fmtTemp, fmtTempDelta, toDisplay, round } from '../model/units.js?v=bbceb21b';
import { canSaveToFile, saveToFile, openFromFile, currentFileName } from '../lib/share.js?v=bbceb21b';
import { lineChart } from '../lib/charts.js?v=bbceb21b';
import * as drive from '../lib/drive.js?v=bbceb21b';
import * as photos from '../lib/photos.js?v=bbceb21b';
import { tempField, tempDeltaField, } from './common.js?v=bbceb21b';
import { THEMES, readTheme, setTheme } from '../lib/theme.js?v=bbceb21b';

let driveAccount = null;
let syncing = false;
let syncNote = '';
drive.onAccount((a) => {
  driveAccount = a;
});

/*
 * Show the connection again after a reload. This asks Google for nothing: it
 * reads back which account was connected and says so. A token is fetched when
 * a sync is actually requested, off the click that requested it.
 */
if (drive.isConfigured() && drive.hasConnected() && !driveAccount) drive.resume();

export default function renderSetup(ctx) {
  return [equipmentCard(ctx), kitchenCard(ctx), savingCard(ctx), driveCard(ctx), calibrationCard(ctx), sourcesCard()];
}

/* ------------------------------- equipment ------------------------------ */

function equipmentCard(ctx) {
  const { s, u, E } = ctx;
  const oven = findOven(E.ovenId);
  const mixer = findMixer(E.mixerId);
  const setEq = (patch) => update((st) => Object.assign(st.current.equipment, patch));

  return card(
    'Your equipment',
    'Recorded with every bake, so the comparison screen can group by the kit you used.',

    h('h3', { style: { fontSize: '.86rem', marginTop: '2px' } }, 'Oven'),
    selectField({
      label: 'Type',
      value: E.ovenId,
      options: OVENS.map((o) => ({ value: o.id, label: o.label })),
      hint: oven.notes,
      onChange: (v) => {
        const o = findOven(v);
        // The oven itself is kitchen kit; its temperatures belong to the recipe.
        update((st) => { st.current.equipment.ovenId = v; });
        editCurrent((c) => {
          c.schedule.deckTempC = o.deckC;
          c.schedule.domeTempC = o.domeC;
          c.schedule.bakeSec = o.bakeSec;
        });
      },
    }),
    h(
      'div',
      { class: 'row' },
      textField({ label: 'Make', value: E.ovenMake, placeholder: 'Gozney, Ooni, Alfa…', onInput: (v) => setEq({ ovenMake: v }) }),
      textField({ label: 'Model', value: E.ovenModel, placeholder: 'Dome S1, Koda 16…', onInput: (v) => setEq({ ovenModel: v }) })
    ),
    h(
      'div',
      { class: 'row' },
      tempField({ label: 'Floor', valueC: s.current.schedule.deckTempC, unit: u, step: 5, onChange: (v) => editCurrent((c) => { c.schedule.deckTempC = v; }) }),
      tempField({ label: 'Dome', valueC: s.current.schedule.domeTempC, unit: u, step: 5, onChange: (v) => editCurrent((c) => { c.schedule.domeTempC = v; }) }),
      numberField({ label: 'Bake time', value: s.current.schedule.bakeSec, min: 20, max: 600, step: 5, suffix: 'sec', onInput: (v) => editCurrent((c) => { c.schedule.bakeSec = v; }) }),
      numberField({ label: 'Preheat', value: s.current.schedule.preheatMin, min: 10, max: 180, step: 5, suffix: 'min', onInput: (v) => editCurrent((c) => { c.schedule.preheatMin = v; }) })
    ),

    h('h3', { style: { fontSize: '.86rem', marginTop: '6px' } }, 'Mixer'),
    selectField({
      label: 'Type',
      value: E.mixerId,
      options: MIXERS.map((m) => ({ value: m.id, label: m.label })),
      hint: mixer.notes,
      onChange: (v) => update((st) => {
        st.current.equipment.mixerId = v;
        st.current.water = { ...st.current.water, frictionC: findMixer(v).frictionC };
      }),
    }),
    h(
      'div',
      { class: 'row' },
      textField({ label: 'Make', value: E.mixerMake, placeholder: 'Famag, Sunmix…', onInput: (v) => setEq({ mixerMake: v }) }),
      textField({ label: 'Model', value: E.mixerModel, placeholder: 'IM-5S, Sun 6…', onInput: (v) => setEq({ mixerModel: v }) })
    ),
    tempDeltaField({
      label: 'Friction allowance',
      valueC: s.current.water?.frictionC ?? mixer.frictionC,
      unit: u,
      step: 1,
      hint: `How much the mixer warms the dough during the mix. ${mixer.label} defaults to ${fmtTempDelta(mixer.frictionC, u)}. Measure a mix or two and set your own.`,
      onChange: (v) => update((st) => { st.current.water = { ...st.current.water, frictionC: v }; }),
    }),

    h(
      'div',
      { class: 'stats' },
      stat('Oven', ovenLabel(E), oven.flame ? 'flame modulated' : 'electric elements'),
      stat('Mixer', mixerLabel(E), `${fmtTempDelta(mixer.frictionC, u)} friction`)
    ),
    h('p', { class: 'note neutral' }, 'The step instructions follow this. Mixing by hand does not read as "speed 1", and an electric oven is not told to turn a flame down.'),
    h('button', { class: 'btn ghost small', onClick: () => { update((st) => { st.current.equipment = { ...DEFAULT_EQUIPMENT }; }); toast('Equipment reset'); } }, icon('restart_alt'), 'Reset equipment')
  );
}

/* -------------------------------- kitchen ------------------------------- */

function kitchenCard(ctx) {
  const { s, u, S } = ctx;
  return card(
    'Your kitchen',
    'The temperatures you actually have. Every schedule the app proposes is built around these.',
    h(
      'div',
      { class: 'row' },
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Temperature units'),
        h('span', { class: 'field-input' }, h('div', { class: 'chip-row' }, chip('°F', u === 'F', () => update((st) => { st.settings.unit = 'F'; })), chip('°C', u === 'C', () => update((st) => { st.settings.unit = 'C'; }))))
      ),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Appearance'),
        h('span', { class: 'field-input' }, h('div', { class: 'chip-row' }, ...THEMES.map((t) => chip(t.label, readTheme() === t.id, () => { setTheme(t.id); update(() => {}); }))))
      ),
      tempField({ label: 'Cold ferment temperature', valueC: S.fridgeTempC, unit: u, step: 1, hint: 'Whatever your fridge actually holds', onChange: (v) => editCurrent((c) => { c.schedule.fridgeTempC = v; c.schedule.bigaFridgeTempC = v; }) }),
      tempField({ label: 'Room temperature', valueC: S.roomTempC, unit: u, step: 1, onChange: (v) => editCurrent((c) => { c.schedule.roomTempC = v; c.schedule.bigaRoomTempC = v; }) }),
      tempField({ label: 'Bench temperature', valueC: S.benchTempC, unit: u, step: 1, onChange: (v) => editCurrent((c) => { c.schedule.benchTempC = v; }) })
    ),
    h('p', { class: 'note neutral' }, 'These belong to the recipe you have loaded, because they decide what its timings mean. Changing them while the shipped protocol is loaded copies it to a version of your own first.'),
    h('p', { class: 'note neutral' }, `At ${fmtTemp(S.fridgeTempC, u)} your dough ferments at ${(rateAt(S.fridgeTempC, ctx.model) * 100).toFixed(0)}% of its room-temperature rate. Measure the fridge with a thermometer rather than trusting the dial; a few degrees changes the schedule by many hours.`)
  );
}

/* --------------------------------- saving ------------------------------- */

function pickFile(onText) {
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

/**
 * Open whatever somebody sent, and say what it was.
 *
 * A recipe is meant to travel: crafted here, sent, followed there, edited and
 * sent back. That only works if opening one adds it, so this never replaces
 * anything. A full backup is the exception and is handed to the restore path,
 * which asks first.
 */
async function openSharedFile(text) {
  const res = openShared(text);
  if (res.needsConfirm) {
    confirmDialog('That is a full backup rather than a single recipe or run. Replacing everything in this browser with it cannot be undone.',
      () => { importJSON(text); toast('Data restored'); }, 'Replace everything');
    return;
  }
  if (res.kind === 'recipe' || res.kind === 'recipes') {
    toast(res.added === 1
      ? `Added ${res.names[0]}. It is on the Recipes screen, ready to load.`
      : `Added ${res.added} recipes to your library.`);
    return;
  }
  toast(res.added
    ? `Added ${res.added} run${res.added === 1 ? '' : 's'} to your log.`
    : 'Nothing new in that file.');
}

function savingCard(ctx) {
  const { s } = ctx;
  const fileName = currentFileName();

  return card(
    'Saving',
    'Everything is stored in this browser. These are the ways to keep a copy somewhere safer.',
    h(
      'div',
      { class: 'stats' },
      stat('Recipes', String(s.recipes.length), 'saved definitions'),
      stat('Bakes', String(s.bakes.filter((b) => !b.planned).length), 'runs recorded'),
      stat('Planned', String(s.bakes.filter((b) => b.planned).length), 'queued experiments'),
      stat('Storage', fileName ? 'File linked' : 'This browser', fileName || 'export to keep a copy')
    ),
    h(
      'div',
      { class: 'row tight' },
      h('button', { class: 'btn', onClick: () => download('canotto-lab.json', exportJSON()) }, icon('download'), 'Download a backup'),
      h('button', { class: 'btn ghost', onClick: () => pickFile(openSharedFile) }, icon('folder_open'), 'Open a shared file'),
      /*
       * Restoring is the one way in that throws work away, so it says so
       * first. It used to be the only way in at all, which meant opening a
       * recipe a friend sent replaced the whole library with it.
       */
      h('button', { class: 'btn ghost', onClick: () => pickFile(async (t) => {
        const count = load().recipes.length + load().bakes.length;
        confirmDialog(`Replace everything in this browser with that backup? ${count} recipe${count === 1 ? '' : 's'} and bakes here now would go. To add a shared recipe or run to what you already have, use Open a shared file instead.`,
          () => { importJSON(t); toast('Data restored'); }, 'Replace everything');
      }) }, icon('upload'), 'Restore from a backup'),
      canSaveToFile()
        ? h('button', { class: 'btn ghost', onClick: async () => { try { const n = await saveToFile(exportJSON()); toast(`Saved to ${n}`); } catch (e) { if (e.name !== 'AbortError') toast('Could not save to that file'); } } }, icon('save'), fileName ? `Save to ${fileName}` : 'Save to a file')
        : null,
      canSaveToFile()
        ? h('button', { class: 'btn ghost', onClick: async () => { try { await openSharedFile(await openFromFile()); } catch (e) { if (e.name !== 'AbortError') toast(e.message || 'Could not open that file'); } } }, icon('description'), 'Open a file')
        : null
    ),
    canSaveToFile()
      ? h('p', { class: 'note neutral' }, 'Point "Save to a file" at a folder your cloud storage already syncs, such as a Google Drive or iCloud folder on this machine. The browser remembers the file, so later saves are one click and the sync happens on its own.')
      : h('p', { class: 'note neutral' }, 'This browser cannot save straight to a file. Download a backup and keep it wherever you like, including a cloud folder.'),
    h('p', { class: 'note neutral' }, 'Every recipe also has a share link on the Recipes screen. The link carries the whole definition, so whoever opens it needs no account.'),
    /*
     * Worth one line on the screen where people look for it, now that the
     * counting card that used to say it is gone.
     */
    h('p', { class: 'note good' }, 'Nothing here is collected. Your recipes, bakes, scores and notes stay in this browser, the app counts nothing and writes to no service of ours, and the only thing that ever leaves is what you export or sync to a Google account of your own.'),
    h('button', { class: 'btn danger small', onClick: () => confirmDialog('Delete everything stored in this browser? Download a backup first if you want to keep it.', () => { resetAll(); toast('Everything cleared'); }, 'Delete everything') }, icon('delete_forever'), 'Clear all data')
  );
}

/* ---------------------------------- drive -------------------------------- */

function driveCard() {
  const body = [];

  if (!drive.isConfigured()) {
    /*
     * No client id in this build, so there is nothing to offer. Say what the
     * feature would be rather than pretending it does not exist, and point at
     * what already works instead.
     */
    body.push(
      h('p', { class: 'note neutral' }, 'Sync is not switched on in this build. Until it is, the file on this screen is the way to carry your library between devices: download it, or use Save to file if your browser offers it.')
    );
    return card('Sync across devices', 'Not available here.', ...body);
  }

  if (!driveAccount) {
    body.push(
      h('p', { class: 'note neutral' }, 'Connect a Google account and your recipes and bakes are kept in that account\u2019s private storage for this app, so they follow you between devices. It is not a folder in your Drive: nothing appears there, and the app cannot see, list or touch a single other file you own. Only this app can read what it puts there, and you can delete it from here whenever you like.'),
      h('div', { class: 'row tight' }, h('button', {
        class: 'btn',
        onClick: async () => {
          try {
            await drive.connect();
            toast('Connected to Drive');
            update(() => {});
          } catch (e) {
            toast(e.message || 'Could not connect');
          }
        },
      }, icon('cloud'), 'Connect Google account'))
    );
    return card('Sync across devices', 'Optional. The app works fully without it.', ...body);
  }

  const last = drive.lastSync();
  body.push(
    h(
      'div',
      { class: 'stats' },
      stat('Connected', driveAccount.email || driveAccount.name || 'your Google account', 'private app storage'),
      stat('Last sync', last ? whenAgo(last.at) : 'not yet', 'newest edit wins, per record')
    ),
    h(
      'div',
      { class: 'row tight' },
      h('button', {
        class: 'btn',
        disabled: syncing || undefined,
        onClick: async () => {
          syncing = true;
          drive.rememberSync(null);
          update(() => {});
          try {
            const res = await drive.sync(load(), { envelope: exportStateJSON });
            applySync(res.state);
            /*
             * The library names the photographs; this fetches and sends the
             * pictures themselves, one file each. It runs after the document
             * so an interrupted sync still leaves the descriptions agreed, and
             * the next attempt simply moves the bytes that are still missing.
             */
            let pics = { sent: 0, fetched: 0, deleted: 0 };
            if (photos.isSupported()) {
              pics = await drive.syncPhotos({
                wanted: res.photoIds || [],
                removed: res.photosRemoved || [],
                photos,
                onProgress: ({ stage, done, total }) => {
                  syncNote = stage === 'up'
                    ? `Sending photographs, ${done + 1} of ${total}\u2026`
                    : `Fetching photographs, ${done + 1} of ${total}\u2026`;
                  update(() => {});
                },
              });
            }
            syncNote = '';
            res.photos = pics;
            drive.rememberSync({
              ok: !res.sessionDisplaced,
              conflict: Boolean(res.sessionDisplaced),
              text: res.created ? 'Created canotto-lab.json in your Google account.' : describeSync(res),
            });
          } catch (e) {
            drive.rememberSync({ ok: false, text: e.message || 'The sync did not finish.' });
          } finally {
            syncing = false;
            syncNote = '';
            update(() => {});
          }
        },
      }, icon('sync'), syncing ? 'Syncing\u2026' : 'Sync now'),
      h('button', { class: 'btn ghost', onClick: () => { drive.disconnect(); toast('Disconnected'); update(() => {}); } }, icon('link_off'), 'Disconnect')
    ),

    /*
     * The result of the last sync, where it can be read rather than caught. A
     * toast is the wrong shape for this: it is the one thing someone might want
     * to look at again a minute later, and it was disappearing while they read
     * it.
     */
    syncing
      ? h('p', { class: 'note neutral' }, syncNote || 'Talking to Google\u2026')
      : last
        ? h('p', { class: `note ${last.ok ? 'good' : (last.conflict ? 'warn' : 'bad')}` }, `${last.text} ${whenAgo(last.at)}.`)
        : h('p', { class: 'note neutral' }, 'Nothing synced from this browser yet. Press Sync now and the result will stay here.'),
    h('p', { class: 'note neutral' }, 'A sync never deletes anything. A recipe removed on one device comes back from the other, because losing work to a sync is worse than seeing something you meant to bin.'),
    h('p', { class: 'hint', style: { fontSize: '.75rem' } }, 'Google may show its own window the first time you sync in a new session. That is it handing over a fresh key, and it closes itself. The app never asks for one just because a page loaded.'),
    h(
      'div',
      { class: 'row tight' },
      h('button', {
        class: 'btn danger small',
        onClick: () => confirmDialog(
          'Delete the stored copy in your Google account? What is in this browser is untouched, and the next sync would upload it again.',
          async () => {
            try {
              const gone = await drive.deleteRemote();
              toast(gone ? 'Stored copy deleted' : 'There was nothing stored');
            } catch (e) {
              toast(e.message || 'Could not delete it');
            }
          },
          'Delete'
        ),
      }, icon('delete'), 'Delete the stored copy')
    ),
    h('p', { class: 'hint', style: { fontSize: '.75rem' } }, 'Private app storage cannot be opened or emptied from Drive itself, so this is the way to remove it. Download the JSON above first if you want to keep a copy you can hold.')
  );

  return card('Sync across devices', 'Optional. The app works fully without it.', ...body);
}

/* ------------------------------ calibration ----------------------------- */

function calibrationCard(ctx) {
  const { s, u } = ctx;
  const m = s.settings.model;

  const yeast = [];
  const enzyme = [];
  for (let t = -2; t <= 40; t += 1) {
    yeast.push({ x: toDisplay(t, u), y: rateAt(t, m) });
    enzyme.push({ x: toDisplay(t, u), y: maturationRateAt(t, m) });
  }
  const fridge = s.current.schedule.fridgeTempC;

  return card(
    'The two clocks',
    'Yeast and enzymes both slow down in the cold, but not by the same amount. That gap is the whole reason a cold proof works, and these constants set its size.',
    lineChart({
      series: [{ points: yeast, label: 'yeast' }, { points: enzyme, label: 'enzymes' }],
      xLabel: `Temperature (\u00b0${u})`,
      yLabel: `Rate at ${fmtTemp(20, u)} = 1`,
      height: 220,
      markers: [{ x: toDisplay(fridge, u), label: 'your fridge' }],
    }),
    h('p', { class: 'note neutral' }, `At ${fmtTemp(fridge, u)} your yeast runs at ${(rateAt(fridge, m) * 100).toFixed(0)}% of its ${fmtTemp(20, u)} rate while the flour\u2019s enzymes keep ${(maturationRateAt(fridge, m) * 100).toFixed(0)}%. The dough goes on maturing long after it has stopped rising, which is why a cold proof can be too long as well as too short.`),
    h(
      'div',
      { class: 'row' },
      numberField({ label: 'Yeast Q10 above 15 \u00b0C', value: m.q10Warm, min: 1.4, max: 4, step: 0.1, onInput: (v) => update((st) => { st.settings.model.q10Warm = v ?? DEFAULT_MODEL.q10Warm; }) }),
      numberField({ label: 'Yeast Q10 below 15 \u00b0C', value: m.q10Cold, min: 1.4, max: 8, step: 0.1, onInput: (v) => update((st) => { st.settings.model.q10Cold = v ?? DEFAULT_MODEL.q10Cold; }) }),
      numberField({ label: 'Enzyme Q10', value: m.q10Enzyme, min: 1.1, max: 3, step: 0.05, onInput: (v) => update((st) => { st.settings.model.q10Enzyme = v ?? DEFAULT_MODEL.q10Enzyme; }) })
    ),
    h('p', { class: 'hint', style: { fontSize: '.75rem' } }, 'Defaults are set so the curves pass through published figures: yeast at roughly a tenth of room rate at 4 \u00b0C, enzyme activity holding just under half. Change them only if your own bakes say otherwise.'),
    h('button', { class: 'btn ghost small', onClick: () => { update((st) => { st.settings.model = { ...DEFAULT_MODEL }; }); toast('Model reset'); } }, icon('restart_alt'), 'Reset to defaults')
  );
}

/** "just now", "6 minutes ago", "yesterday". Precise enough to be useful. */
function whenAgo(at) {
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * What a sync actually did, in words.
 *
 * It used to report two numbers and say nothing about the third thing that
 * moves. Someone who had just ticked their way through half a protocol, synced,
 * and read "0 in, 0 out" would reasonably conclude their progress had not gone
 * anywhere, when it had.
 */
export function describeSync(res) {
  const parts = [];
  if (res.pulled) parts.push(`${res.pulled} in`);
  if (res.pushed) parts.push(`${res.pushed} out`);
  /*
   * Only claim a bake moved if one did. Saying "sent this device's bake in
   * progress" while the protocol showed nothing ticked described work that did
   * not exist, and hid the useful fact underneath: the stored copy had no bake
   * either, because whatever wrote it could not carry one.
   */
  if (res.photos?.sent) parts.push(`${res.photos.sent} photo${res.photos.sent === 1 ? '' : 's'} out`);
  if (res.photos?.fetched) parts.push(`${res.photos.fetched} photo${res.photos.fetched === 1 ? '' : 's'} in`);
  if (res.sessionMoved && res.sessionHasProgress) {
    parts.push(res.sessionFrom === 'remote'
      ? 'picked up the bake in progress'
      : 'sent this device\u2019s bake in progress');
  }
  let summary = parts.length ? `Synced: ${parts.join(', ')}` : 'Already up to date';

  if (!res.sessionHasProgress && !res.remoteHadSession) {
    summary += '. Neither this device nor the stored copy has a bake in progress. If one should be there, open the device that has it, pull down to reload the page, and sync from there.';
  }

  /*
   * Two devices each holding a bake is the one case worth interrupting for.
   * They cannot be merged, so one is set aside, and that is somebody's evening.
   * Saying which and where the other went is the least this can do.
   */
  if (res.sessionDisplaced) {
    return `${summary}. Both devices had a bake going, so the ${res.sessionFrom === 'remote' ? 'other one' : 'one on this device'} was kept and the other set aside. Download the JSON above before syncing again if you want the one that lost.`;
  }
  return summary;
}

/* -------------------------------- sources ------------------------------- */

function sourcesCard() {
  const sourced = FLOURS.filter((f) => f.sourced).length;
  return card(
    'Where the numbers come from',
    `${sourced} of ${FLOURS.length} flours carry published strength or maturation figures. The rest are estimated from protein, and the app says so wherever it uses one.`,
    h('ul', { class: 'src-list' }, ...SOURCES.map((x) => h('li', {}, h('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.label)))),
    h(
      'p',
      { class: 'note neutral' },
      'Everything this app exports is plain JSON and names the schema it follows, so anything else can read it. ',
      h('a', { href: 'schema/', target: '_blank', rel: 'noopener' }, 'The data formats are published here.')
    ),
    h(
      'details',
      { class: 'foldout' },
      h('summary', {}, 'How the fermentation model works'),
      h('p', { style: { fontSize: '.83rem', margin: '0 0 8px' } }, 'A fermentation unit is one hour of yeast work at 20 °C, and a maturation unit is one hour of enzyme work at the same temperature. Both follow a Q10 law. The yeast curve steepens below 15 °C because a fridge slows dough more than a single coefficient predicts; the enzyme curve does not.'),
      h('p', { style: { fontSize: '.83rem', margin: '0 0 8px' } }, 'Duration comes from maturation. A flour\u2019s W value is a budget for how much enzyme work its gluten can absorb before it goes slack, so the stronger the flour the longer it will take a cold proof. That is what sets the suggested window, and what makes 66 hours right at one fridge temperature and too long at another.'),
      h('p', { style: { fontSize: '.83rem', margin: '0 0 8px' } }, 'Yeast comes from fermentation. Halve the yeast and you need about twice the fermentation units, so the app scales your inoculation from a bake that already worked rather than from a constant it invented.'),
      h('p', { style: { fontSize: '.83rem', margin: 0 } }, 'The freeze buffer is left out of both readings. Extra yeast added to cover freeze mortality replaces cells that will die, it does not add fermentation.')
    ),
    h('p', { class: 'note neutral' }, 'W values vary by lot and mills revise their specs. Treat every figure as a starting point and let your own bake log overrule it.')
  );
}
