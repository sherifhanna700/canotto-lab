// Ovens and mixers.
//
// The presets are starting points, not a closed list. Anything can be recorded
// as a custom make and model, and that text travels with the bake so the
// comparison screen can group by the kit you actually used.
//
// The mixer matters beyond record-keeping: friction is where a large part of
// the final dough temperature comes from, and it varies enormously between
// mixing by hand and running a spiral for five minutes.

export const OVENS = [
  { id: 'gas-portable', label: 'Portable gas oven', deckC: 445, domeC: 485, bakeSec: 85, flame: true, notes: 'Ooni, Gozney, Alfa and similar. Rolling roof flame on one side.' },
  { id: 'gas-deck', label: 'Gas deck oven', deckC: 452, domeC: 490, bakeSec: 75, flame: true, notes: 'Larger gas dome with a stone or biscotto floor.' },
  { id: 'wood', label: 'Wood-fired oven', deckC: 460, domeC: 500, bakeSec: 70, flame: true, notes: 'Live fire. The hot spot moves as the fire burns down.' },
  { id: 'electric-pizza', label: 'Electric pizza oven', deckC: 400, domeC: 450, bakeSec: 110, flame: false, notes: 'Effeuno, Ooni Volt and similar. Separate top and bottom elements.' },
  { id: 'home-steel', label: 'Home oven with a steel or stone', deckC: 290, domeC: 300, bakeSec: 360, flame: false, notes: 'Preheat for an hour, then finish under the grill.' },
  { id: 'custom', label: 'Something else', deckC: 450, domeC: 490, bakeSec: 90, flame: true, notes: 'Record the make and model and set the temperatures yourself.' },
];

export const MIXERS = [
  { id: 'hand', label: 'By hand', frictionC: 1, notes: 'Almost no friction heat. Water temperature does nearly all the work.' },
  { id: 'spiral', label: 'Spiral mixer', frictionC: 9, notes: 'The usual choice for this style. Gentle on gluten, moderate heat.' },
  { id: 'planetary', label: 'Planetary / stand mixer', frictionC: 13, notes: 'Heats the dough faster than a spiral. Watch the temperature.' },
  { id: 'fork', label: 'Fork mixer', frictionC: 6, notes: 'Very gentle, slow, and cool running.' },
  { id: 'processor', label: 'Food processor', frictionC: 17, notes: 'Very fast and very hot. Use ice water.' },
  { id: 'custom', label: 'Something else', frictionC: 9, notes: 'Set the friction allowance yourself once you have measured a mix or two.' },
];

export const DEFAULT_EQUIPMENT = {
  ovenId: 'gas-deck',
  ovenMake: '',
  ovenModel: '',
  mixerId: 'spiral',
  mixerMake: '',
  mixerModel: '',
};

export const findOven = (id) => OVENS.find((o) => o.id === id) || OVENS[1];
export const findMixer = (id) => MIXERS.find((m) => m.id === id) || MIXERS[1];

/** "Gozney Dome" if given, otherwise the preset's own label. */
export function ovenLabel(eq) {
  const named = [eq?.ovenMake, eq?.ovenModel].filter(Boolean).join(' ').trim();
  return named || findOven(eq?.ovenId).label;
}

export function mixerLabel(eq) {
  const named = [eq?.mixerMake, eq?.mixerModel].filter(Boolean).join(' ').trim();
  const preset = findMixer(eq?.mixerId);
  if (named) return `${named} ${preset.id === 'hand' ? '' : preset.label.toLowerCase()}`.trim();
  return preset.label;
}

/** How the mixing instructions should read for this kind of mixer. */
export function mixerPhrasing(eq) {
  const id = eq?.mixerId || 'spiral';
  if (id === 'hand') {
    return {
      bowl: 'mixing bowl',
      lowSpeed: 'mixing gently by hand',
      highSpeed: 'working the dough firmly by hand',
      clears: 'the dough comes together',
    };
  }
  if (id === 'processor') {
    return { bowl: 'processor bowl', lowSpeed: 'pulsing', highSpeed: 'running the blade', clears: 'the dough forms a ball' };
  }
  return {
    bowl: `${findMixer(id).label.toLowerCase()} bowl`,
    lowSpeed: 'on speed 1',
    highSpeed: 'on speed 4 to 5',
    clears: 'the dough clears the bowl',
  };
}

/* --------------------------- flame modulation --------------------------- */

/** Stage boundaries as a fraction of total bake time. */
const STAGES = [
  {
    at: 0,
    label: 'Launch',
    deg: 0,
    flame: 'MEDIUM-LOW',
    tone: 'warm',
    action: 'Land on the side of the deck away from the burner. Leave it untouched.',
    facing: 'North marker: back wall',
    why: 'Dropping the flame before launch stops the rim scorching on the burner side before the base has set. The floor flashes the water in the dough straight to steam.',
  },
  {
    at: 0.27,
    label: 'Base set',
    deg: 0,
    flame: 'MEDIUM-LOW',
    tone: 'warm',
    action: 'Watch the rim balloon. The base is now firm.',
    facing: 'North marker: back wall',
    why: 'Thermal mass in the floor turns the hydration into steam, which is what drives the honeycomb open without burning the underside.',
  },
  {
    at: 0.33,
    label: '180° turn, flame up',
    deg: 180,
    flame: 'HIGH',
    tone: 'hot',
    action: 'Rotate 180° with the turning peel and go to high.',
    facing: 'North marker: front mouth',
    why: 'The pale side now faces the rolling roof flame at full power.',
  },
  {
    at: 0.6,
    label: 'Quarter turn',
    deg: 270,
    flame: 'HIGH',
    tone: 'hot',
    action: 'Quarter turn clockwise. Keep turning every 10 to 15 seconds.',
    facing: 'North marker: east wall',
    why: 'The ceiling flame micro-blisters the lipids in the oil veil into leopard spots around the sides.',
  },
  {
    at: 1,
    label: 'Dome dwell and exit',
    deg: 360,
    flame: 'HIGH → OFF',
    tone: 'done',
    action: 'Lift on the peel to kiss the ceiling for 5 seconds, then pull it.',
    facing: 'North marker: back wall, full turn complete',
    why: 'Rim inflated, hollow and blistered. Rest it on a wire rack for a minute so the base does not steam itself soft.',
  },
];

/** An electric oven has no flame to modulate, so the language changes. */
const ELECTRIC_OVERRIDES = {
  0: { flame: 'TOP ELEMENT LOW', action: 'Launch onto the stone. Leave it untouched while the base sets.', why: 'A lower top element early stops the rim colouring before the base has set on the stone.' },
  1: { flame: 'TOP ELEMENT LOW', action: 'Watch the rim balloon. The base is now firm on the stone.', why: 'The stone drives the oven spring from underneath while the top stays gentle.' },
  2: { flame: 'TOP ELEMENT HIGH', action: 'Rotate 180° and raise the top element.', why: 'Radiant heat from above drives the colour once the base is firm.' },
  3: { flame: 'TOP ELEMENT HIGH', action: 'Quarter turn. Electric ovens colour unevenly, so keep it moving.', why: 'Turning evens out the hot spot the element leaves on one side.' },
  4: { flame: 'ELEMENTS OFF', action: 'Lift towards the roof for a few seconds if the rim is still pale, then pull it.' },
};

export function bakeStages(totalSec = 75, ovenId = 'gas-deck') {
  const electric = !findOven(ovenId).flame;
  return STAGES.map((s, i) => ({
    ...s,
    ...(electric ? ELECTRIC_OVERRIDES[i] || {} : {}),
    sec: Math.round(s.at * totalSec),
    totalSec,
  }));
}

export function stageAt(sec, totalSec = 75, ovenId = 'gas-deck') {
  const stages = bakeStages(totalSec, ovenId);
  let found = stages[0];
  for (const s of stages) if (sec >= s.sec) found = s;
  return found;
}
