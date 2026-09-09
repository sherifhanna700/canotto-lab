// Setup: the things that describe your kitchen rather than a particular dough.
// Equipment, the temperatures you actually have, units, saving and sync.

import { h, card, selectField, textField, numberField, chip, stat, pill, toast, icon, confirmDialog } from '../lib/ui.js?v=6b063ab5';
import { editCurrent, update, exportJSON, importJSON, mergeBakes, download, resetAll, load, applySync } from '../lib/store.js?v=6b063ab5';
import { OVENS, MIXERS, findOven, findMixer, ovenLabel, mixerLabel, DEFAULT_EQUIPMENT } from '../model/equipment.js?v=6b063ab5';
import { DEFAULT_MODEL, rateAt, maturationRateAt, fermentUnits } from '../model/ferment.js?v=6b063ab5';
import { scheduleStages } from '../model/protocol.js?v=6b063ab5';
import { convertYeast } from '../model/dough.js?v=6b063ab5';
import { overallScore } from '../model/recipes.js?v=6b063ab5';
import { SOURCES, FLOURS } from '../model/flours.js?v=6b063ab5';
import { fmtTemp, fmtTempDelta, toDisplay, round } from '../model/units.js?v=6b063ab5';
import { canSaveToFile, saveToFile, openFromFile, currentFileName } from '../lib/share.js?v=6b063ab5';
import { lineChart } from '../lib/charts.js?v=6b063ab5';
import * as cloud from '../lib/cloud.js?v=6b063ab5';
import { tempField, tempDeltaField, } from './common.js?v=6b063ab5';
import { THEMES, readTheme, setTheme } from '../lib/theme.js?v=6b063ab5';

let cloudUser = null;
let cloudStatus = '';
cloud.onUser((u) => {
  cloudUser = u;
});

export default function renderSetup(ctx) {
  return [equipmentCard(ctx), kitchenCard(ctx), savingCard(ctx), cloudCard(ctx), calibrationCard(ctx), sourcesCard()];
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

/* ---------------------------------- cloud -------------------------------- */

function cloudCard() {
  const configured = cloud.isConfigured();
  const body = [];

  if (!configured) {
    let pasted = '';
    body.push(
      h('p', { class: 'note neutral' }, 'Sync across devices is optional and needs a Firebase project of your own, which is free. Create one, enable Google sign-in and Firestore, then paste the web app config here. Nothing is sent anywhere until you sign in.'),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field-label' }, 'Firebase web config'),
        h('span', { class: 'field-input' }, h('textarea', { rows: 5, placeholder: '{ "apiKey": "…", "authDomain": "…", "projectId": "…", "appId": "…" }', onInput: (e) => { pasted = e.target.value; } }))
      ),
      h('button', { class: 'btn', onClick: () => { try { cloud.saveConfig(pasted); toast('Firebase configured'); update(() => {}); } catch (e) { toast(e.message); } } }, icon('cloud'), 'Save configuration')
    );
  } else if (!cloudUser) {
    body.push(
      h('p', { class: 'note neutral' }, 'Firebase is configured. Sign in and your recipes and bakes follow you between devices.'),
      h(
        'div',
        { class: 'row tight' },
        h('button', { class: 'btn', onClick: async () => { try { await cloud.signIn(); toast('Signed in'); update(() => {}); } catch (e) { toast(e.message || 'Sign-in failed'); } } }, icon('login'), 'Sign in with Google'),
        h('button', { class: 'btn ghost', onClick: () => { cloud.clearConfig(); toast('Configuration removed'); update(() => {}); } }, icon('link_off'), 'Remove configuration')
      )
    );
  } else {
    body.push(
      h('div', { class: 'stats' }, stat('Signed in', cloudUser.name || cloudUser.email || 'account', cloudUser.email || ''), stat('Last sync', cloudStatus || 'not yet', 'newest edit wins per record')),
      h(
        'div',
        { class: 'row tight' },
        h('button', {
          class: 'btn',
          onClick: async () => {
            try {
              const res = await cloud.sync(load());
              applySync(res);
              cloudStatus = `${res.pulled} in, ${res.pushed} out`;
              toast(`Synced: ${res.pulled} pulled, ${res.pushed} pushed`);
            } catch (e) {
              toast(e.message || 'Sync failed');
            }
          },
        }, icon('sync'), 'Sync now'),
        h('button', { class: 'btn ghost', onClick: async () => { await cloud.signOutNow(); toast('Signed out'); update(() => {}); } }, icon('logout'), 'Sign out')
      )
    );
  }

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
    h('p', { class: 'note neutral' }, `At ${fmtTemp(fridge, u)} your yeast runs at ${(rateAt(fridge, m) * 100).toFixed(0)}% of its 20 \u00b0C rate while the flour\u2019s enzymes keep ${(maturationRateAt(fridge, m) * 100).toFixed(0)}%. The dough goes on maturing long after it has stopped rising, which is why a cold proof can be too long as well as too short.`),
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
