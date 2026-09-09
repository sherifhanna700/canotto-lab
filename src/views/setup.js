// Setup: the things that describe your kitchen rather than a particular dough.
// Equipment, the temperatures you actually have, units, saving and sync.

import { h, card, selectField, textField, numberField, chip, stat, pill, toast, icon, confirmDialog , toggleField } from '../lib/ui.js?v=4b76d5b2';
import { editCurrent, update, exportJSON, exportStateJSON, importJSON, mergeBakes, download, resetAll, load, applySync } from '../lib/store.js?v=4b76d5b2';
import { OVENS, MIXERS, findOven, findMixer, ovenLabel, mixerLabel, DEFAULT_EQUIPMENT } from '../model/equipment.js?v=4b76d5b2';
import { DEFAULT_MODEL, rateAt, maturationRateAt, fermentUnits } from '../model/ferment.js?v=4b76d5b2';
import { scheduleStages } from '../model/protocol.js?v=4b76d5b2';
import { convertYeast } from '../model/dough.js?v=4b76d5b2';
import { overallScore } from '../model/recipes.js?v=4b76d5b2';
import { SOURCES, FLOURS } from '../model/flours.js?v=4b76d5b2';
import { fmtTemp, fmtTempDelta, toDisplay, round } from '../model/units.js?v=4b76d5b2';
import { canSaveToFile, saveToFile, openFromFile, currentFileName } from '../lib/share.js?v=4b76d5b2';
import { lineChart } from '../lib/charts.js?v=4b76d5b2';
import * as drive from '../lib/drive.js?v=4b76d5b2';
import { isOff, setCounting } from '../lib/count.js?v=4b76d5b2';
import { tempField, tempDeltaField, } from './common.js?v=4b76d5b2';
import { THEMES, readTheme, setTheme } from '../lib/theme.js?v=4b76d5b2';

let driveAccount = null;
let driveStatus = '';
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
  return [equipmentCard(ctx), kitchenCard(ctx), savingCard(ctx), driveCard(ctx), countingCard(), calibrationCard(ctx), sourcesCard()];
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
      h('button', { class: 'btn ghost', onClick: () => pickFile(async (t) => { importJSON(t); toast('Data restored'); }) }, icon('upload'), 'Restore from a backup'),
      h('button', { class: 'btn ghost', onClick: () => pickFile(async (t) => { const n = mergeBakes(t); toast(n ? `${n} bakes merged in` : 'Nothing new in that file'); }) }, icon('merge'), 'Merge someone else’s bakes'),
      canSaveToFile()
        ? h('button', { class: 'btn ghost', onClick: async () => { try { const n = await saveToFile(exportJSON()); toast(`Saved to ${n}`); } catch (e) { if (e.name !== 'AbortError') toast('Could not save to that file'); } } }, icon('save'), fileName ? `Save to ${fileName}` : 'Save to a file')
        : null,
      canSaveToFile()
        ? h('button', { class: 'btn ghost', onClick: async () => { try { importJSON(await openFromFile()); toast('Loaded'); } catch (e) { if (e.name !== 'AbortError') toast('Could not open that file'); } } }, icon('folder_open'), 'Open a file')
        : null
    ),
    canSaveToFile()
      ? h('p', { class: 'note neutral' }, 'Point "Save to a file" at a folder your cloud storage already syncs, such as a Google Drive or iCloud folder on this machine. The browser remembers the file, so later saves are one click and the sync happens on its own.')
      : h('p', { class: 'note neutral' }, 'This browser cannot save straight to a file. Download a backup and keep it wherever you like, including a cloud folder.'),
    h('p', { class: 'note neutral' }, 'Every recipe also has a share link on the Recipes screen. The link carries the whole definition, so whoever opens it needs no account.'),
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

  body.push(
    h(
      'div',
      { class: 'stats' },
      stat('Connected', driveAccount.email || driveAccount.name || 'your Google account', 'private app storage'),
      stat('Last sync', driveStatus || 'not yet', 'newest edit wins, per record')
    ),
    h(
      'div',
      { class: 'row tight' },
      h('button', {
        class: 'btn',
        onClick: async () => {
          try {
            const res = await drive.sync(load(), { envelope: exportStateJSON });
            applySync(res.state);
            driveStatus = `${res.pulled} in, ${res.pushed} out`;
            toast(res.created ? 'Created canotto-lab.json in your Drive' : `Synced: ${res.pulled} in, ${res.pushed} out`);
          } catch (e) {
            toast(e.message || 'Sync failed');
          }
        },
      }, icon('sync'), 'Sync now'),
      h('button', { class: 'btn ghost', onClick: () => { drive.disconnect(); toast('Disconnected'); update(() => {}); } }, icon('link_off'), 'Disconnect')
    ),
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

/* -------------------------------- counting ------------------------------- */

function countingCard() {
  return card(
    'What this app collects',
    'Almost nothing, and it is worth being exact about which nothing.',
    h('p', { class: 'note good' }, 'Your recipes, bakes, scores and notes are stored in this browser and are never sent to us. There is no server of ours that could receive them.'),
    h('p', { class: 'note neutral' }, 'The one thing the app sends is a count of how many devices use it. Once a day at most, it reports a random number your browser made up for itself and today\u2019s date, and nothing else. It cannot say who you are, what you baked, or which account you might have connected.'),
    h(
      'div',
      { style: { margin: '10px 0 4px' } },
      toggleField({
        label: 'Count this device in the usage figures',
        checked: !isOff(),
        hint: 'Switched off, no request is made at all, rather than one with a flag on it. Everything else works the same.',
        onChange: (on) => { setCounting(on); toast(on ? 'Counting this device' : 'Not counting this device'); update(() => {}); },
      })
    ),
    h(
      'p',
      { class: 'note neutral' },
      'The whole of it is ',
      h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'written down here'),
      ', and because this app has no build step, the code running in your browser is the same text as the source. ',
      h('a', { href: 'https://github.com/sherifhanna700/canotto-lab/blob/main/src/lib/count.js', target: '_blank', rel: 'noopener' }, 'Read the counter'),
      ' and check.'
    )
  );
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
