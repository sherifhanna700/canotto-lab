// Troubleshooting library.
//
// Each entry carries an optional `detect` predicate. Given a bake record the
// app can then propose the likely causes instead of making you read the whole
// list, which is the difference between a reference and a diagnosis.

export const CATEGORIES = [
  { id: 'ALL', label: 'Everything' },
  { id: 'RIM', label: 'Rim / cornicione' },
  { id: 'CRUMB', label: 'Crumb' },
  { id: 'BAKE', label: 'Bake & oven' },
  { id: 'HANDLING', label: 'Handling' },
  { id: 'FERMENT', label: 'Fermentation' },
];

// Number(null) is 0, which would make an empty form look like a score of zero,
// so blank values have to be rejected before the numeric check.
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
};

export const DIAGNOSTICS = [
  {
    id: 'rim-dense',
    category: 'RIM',
    title: 'Dense, chewy or under-inflated rim',
    cause: 'The ball was launched too cold, or fingers pressed into the outer rim while opening it.',
    fix: 'Extend the counter temper until the core reaches 17 to 19 °C, and stop the finger press a full 2.5 cm short of the edge.',
    detect: (b) => n(b.scores?.canotto) !== null && b.scores.canotto <= 2 && (n(b.actuals?.coreTempC) === null || b.actuals.coreTempC < 16),
  },
  {
    id: 'rim-scorch',
    category: 'BAKE',
    title: 'Burner-facing rim scorches before the base sets',
    cause: 'The flame was left on high through the launch, or the pizza landed too close to the burner guard.',
    fix: 'Throttle to medium-low 30 seconds before launch and land on the centre-right of the deck.',
    detect: (b) => n(b.scores?.blistering) !== null && b.scores.blistering <= 2 && n(b.actuals?.bakeSec) !== null && b.actuals.bakeSec < 60,
  },
  {
    id: 'rim-collapse',
    category: 'RIM',
    title: 'Rim collapses or wrinkles after it leaves the oven',
    cause: 'Moisture trapped in the crumb from an underbake, or gluten degraded by an over-warm mix.',
    fix: 'Add 10 seconds and finish with a dome dwell. Check that the dough never passed 25 °C during mixing.',
    detect: (b) => n(b.actuals?.fdtC) !== null && b.actuals.fdtC > 25,
  },
  {
    id: 'tearing',
    category: 'HANDLING',
    title: 'Dough tears while hand-stretching',
    cause: 'The ball is under-relaxed, or the skin dried out during the temper.',
    fix: 'Keep the boxes sealed. Let a partially opened disc rest 30 seconds on the bench before the final stretch.',
  },
  {
    id: 'seam-blows',
    category: 'HANDLING',
    title: 'Ball seam blows open in the proofing box',
    cause: 'The counter was oily during balling, so the bottom seam never sealed.',
    fix: 'Ball on a completely dry counter. The oil belongs on the top dome only.',
  },
  {
    id: 'pale',
    category: 'BAKE',
    title: 'Pale crust and sluggish blistering',
    cause: 'Simple sugars used up by a long ferment, an under-heated floor, or a surface that dried during the temper.',
    fix: 'Heat-soak the floor to 445 °C or above and go to high flame right after the first turn. If the schedule is very long, a little diastatic malt restores browning.',
    detect: (b) => n(b.scores?.blistering) !== null && b.scores.blistering <= 2 && n(b.actuals?.deckTempC) !== null && b.actuals.deckTempC < 430,
  },
  {
    id: 'gumline',
    category: 'CRUMB',
    title: 'Gum line under the sauce',
    cause: 'The base set before the interior cooked, usually a very hot floor against a cold, wet ball.',
    fix: 'Drop the floor temperature by 15 °C, or temper the ball longer so it enters the oven warmer.',
    detect: (b) => n(b.actuals?.deckTempC) !== null && b.actuals.deckTempC > 480 && n(b.actuals?.coreTempC) !== null && b.actuals.coreTempC < 16,
  },
  {
    id: 'bready',
    category: 'CRUMB',
    title: 'Bready, tight crumb instead of an open honeycomb',
    cause: 'Under-fermented, or the gas was degassed out of the rim while opening.',
    fix: 'Raise the fermentation load. Check the fermentation reading on the Recipe panel before blaming your hands.',
    detect: (b) => n(b.scores?.honeycomb) !== null && b.scores.honeycomb <= 2,
  },
  {
    id: 'slack',
    category: 'FERMENT',
    title: 'Slack, soupy dough that will not hold a ball',
    cause: 'Fermentation ran past what the flour can carry, or the fridge was warmer than assumed.',
    fix: 'Verify the fridge with a thermometer. Cut the cold proof, or move to a stronger flour for this schedule.',
    detect: (b) => n(b.actuals?.fridgeTempC) !== null && b.actuals.fridgeTempC > 6,
  },
  {
    id: 'sour',
    category: 'FERMENT',
    title: 'Sharp, sour or alcoholic flavour',
    cause: 'Too much of the schedule ran warm, so acetic acid and ethanol built up.',
    fix: 'Shift fermentation into the cold. Same total load, more of it below 5 °C.',
  },
  {
    id: 'flat-base',
    category: 'BAKE',
    title: 'Soggy base, no crispness',
    cause: 'A cold floor, or a wet topping load sitting too long before launch.',
    fix: 'Let the floor recover between pizzas and dress the pizza immediately before launch.',
  },
  {
    id: 'uneven-rise',
    category: 'RIM',
    title: 'One side of the rim rises, the other stays flat',
    cause: 'Uneven ball tension from balling, or an uneven press.',
    fix: 'Cup the ball with even pressure all the way round and rotate the disc a quarter turn between presses.',
  },
];

export function byCategory(cat) {
  return cat === 'ALL' ? DIAGNOSTICS : DIAGNOSTICS.filter((d) => d.category === cat);
}

/** Which entries the numbers in this bake actually point at. */
export function diagnose(bake) {
  if (!bake) return [];
  return DIAGNOSTICS.filter((d) => {
    try {
      return typeof d.detect === 'function' && d.detect(bake);
    } catch {
      return false;
    }
  });
}
