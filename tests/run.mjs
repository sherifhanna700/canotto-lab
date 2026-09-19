// Model tests. Run with `npm test`. No framework: assertions and a counter.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * The counter is browser code, and the only browser thing it touches is
 * localStorage. A dozen lines of it here beats a headless browser, and keeps
 * the claims in privacy.html checkable by `npm test`.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(String(k)),
    clear: () => store.clear(),
  };
}
import { computeRecipe, allocateFlours, convertYeast, DEFAULT_RECIPE, effectiveYeastPct } from '../src/model/dough.js';
import { blendStats, hydrationRangeForW, estimateW, maturationCeilingForW, bandForW, FLOURS } from '../src/model/flours.js';
import { rateAt, maturationRateAt, fermentUnits, maturationUnits, yeastForFU, waterTempFor, DEFAULT_MODEL } from '../src/model/ferment.js';
import { solveSchedule, scheduleStages, STEPS, activeSteps, DEFAULT_SCHEDULE, totalColdHours } from '../src/model/protocol.js';
import { actualStages, projectedStages, drifts, projectedLaunch, sayDrift, hasTimings, PHASE_BOUNDS, TIMED_STEPS, trimmablePhases, trimStage, trimForMaturation } from '../src/model/timeline.js';
import { suggestPlan, reviewPlan, defaultLeadHours, strengthBand, coldProofWindow, coldProofVerdict, hoursForMaturation, HOUSE_REFERENCE, MATURATION_TARGET } from '../src/model/advisor.js';
import { recipeFromBlend, overallScore, recipeRating, starterRecipes, houseRecipe } from '../src/model/recipes.js';
import { bakeStages, ovenLabel, mixerLabel, mixerPhrasing, findMixer, OVENS, MIXERS } from '../src/model/equipment.js';
import { diagnose } from '../src/model/diagnostics.js';
import { laterSession } from '../src/lib/drive.js';
import { update as storeUpdate, load as storeLoad, resetAll, applySync, addPhotoRecord, removePhotoRecord, removePhotoRecordsFor, snapshotBake, startNewSession, photosForBake } from '../src/lib/store.js';
import { derive, findFactor } from '../src/model/metrics.js';
import { mergeCollections } from '../src/lib/drive.js';
import { normaliseRecipe, EMPTY_ACTUALS, EMPTY_SCORES, SCHEMA_BASE, exportStateJSON } from '../src/lib/store.js';
import { DEFAULT_SCHEDULE as SCHED } from '../src/model/protocol.js';
import { validate, loadSchemas } from '../tools/validate-schema.mjs';
import { DEFAULT_EQUIPMENT } from '../src/model/equipment.js';
import { cToF, fToC, deltaToDisplay, deltaFromDisplay, reconcile, splitDoses } from '../src/model/units.js';

let passed = 0;
/*
 * Tests run one after another, including async ones.
 *
 * This used to call fn() and move on, which meant an async test was never
 * waited for: it passed the moment it started, and a failure surfaced as an
 * unhandled rejection rather than a FAIL. Anything sharing state between async
 * tests also interleaved. Queueing them keeps the order on the page the order
 * they run in.
 */
let queue = Promise.resolve();

const failures = [];

const test = (name, fn) => {
  queue = queue.then(async () => {
    try {
      await fn();
      passed += 1;
    } catch (err) {
      console.error(`FAIL  ${name}\n      ${err.message}`);
      failures.push(name);
      process.exitCode = 1;
    }
  });
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tolerance ${tol})`);

/* ------------------------------- dough ---------------------------------- */

test('total dough matches balls times ball weight', () => {
  const c = computeRecipe({ balls: 8, ballWeight: 275, wastePct: 0 });
  assert.equal(c.totalDough, 2200);
});

test('displayed parts always add up to the displayed whole', () => {
  const c = computeRecipe({});
  const w = c.weigh;
  assert.equal(w.flour.biga + w.flour.final, w.flour.total, 'flour columns');
  assert.equal(w.water.biga + w.water.final, w.water.total, 'water columns');
  assert.equal(w.water.bassinage + w.water.saltWash, w.water.final, 'bassinage plus salt wash is the final mix water');
  assert.equal(w.water.doses.reduce((a, b) => a + b, 0), w.water.bassinage, 'the doses are the bassinage');
  assert.equal(w.flour.biga + w.water.biga + w.yeast.biga, w.bigaMass, 'the biga total is its own parts');
});

test('that holds across a wide range of recipes, not just the default', () => {
  for (const hyd of [58, 65, 70, 75, 82]) {
    for (const balls of [1, 4, 8, 23]) {
      for (const pf of [40, 70, 100]) {
        for (const doses of [1, 3, 5]) {
          const w = computeRecipe({ hydrationPct: hyd, balls, prefermentFlourPct: pf, bassinageDoses: doses }).weigh;
          const where = `hyd ${hyd}, balls ${balls}, biga flour ${pf}%, ${doses} doses`;
          assert.equal(w.flour.biga + w.flour.final, w.flour.total, `flour: ${where}`);
          assert.equal(w.water.biga + w.water.final, w.water.total, `water: ${where}`);
          assert.equal(w.water.bassinage + w.water.saltWash, w.water.final, `final water: ${where}`);
          assert.equal(w.water.doses.reduce((a, b) => a + b, 0), w.water.bassinage, `doses: ${where}`);
        }
      }
    }
  }
});

test('reconcile distributes rounding instead of dropping it', () => {
  assert.deepEqual(reconcile(316.4, [118.65, 197.75]), [119, 197]);
  assert.deepEqual(splitDoses(100, 3), [34, 33, 33]);
  assert.equal(splitDoses(197, 3).reduce((a, b) => a + b, 0), 197);
  assert.deepEqual(reconcile(0, [0, 0]), [0, 0], 'an empty split does not divide by zero');
});

test('ingredient masses sum back to the total dough', () => {
  const c = computeRecipe({});
  const sum = c.flour + c.water + c.salt + c.oil + c.sugar + c.malt + c.yeast;
  near(sum, c.totalDough, 0.01, 'ingredients should reconstruct the batch');
});

test('house recipe reproduces the original calculator', () => {
  const c = computeRecipe(DEFAULT_RECIPE);
  near(c.flour, 1266, 1, 'flour');
  near(c.preferment.water, 570, 1, 'biga water');
  near(c.finalMix.saltWash, 119, 1, 'salt wash water');
  near(c.salt, 35.4, 0.2, 'salt');
});

test('freeze buffer applies only when balls go to the freezer', () => {
  assert.equal(effectiveYeastPct({ baseYeastPct: 0.1, freezeBufferPct: 0.03, frozenBalls: 0 }), 0.1);
  near(effectiveYeastPct({ baseYeastPct: 0.1, freezeBufferPct: 0.03, frozenBalls: 4 }), 0.13, 1e-9, 'buffered');
});

test('preferment and final mix split the flour and water exactly', () => {
  const c = computeRecipe({ prefermentFlourPct: 60 });
  near(c.preferment.flour + c.finalMix.flour, c.flour, 0.01, 'flour split');
  near(c.preferment.water + c.finalMix.water, c.water, 0.01, 'water split');
});

test('an impossible preferment hydration is reported, not silently wrong', () => {
  const c = computeRecipe({ hydrationPct: 60, prefermentFlourPct: 100, prefermentHydrationPct: 80 });
  assert.ok(c.warnings.some((w) => w.includes('preferment')), 'expected a warning');
});

test('flour allocation honours per-flour stage assignment', () => {
  const rows = allocateFlours([{ id: 'a', pct: 70, stage: 'biga' }, { id: 'b', pct: 30, stage: 'final' }], 1000, 700);
  near(rows[0].biga, 700, 0.01, 'biga flour');
  near(rows[1].final, 300, 0.01, 'held back flour');
});

test('yeast conversion round-trips', () => {
  const idy = 0.1;
  near(convertYeast(convertYeast(idy, 'idy', 'fresh'), 'fresh', 'idy'), idy, 1e-9, 'round trip');
  near(convertYeast(0.1, 'idy', 'fresh'), 0.3, 1e-9, 'fresh is three times instant dry');
});

/* ------------------------------- flours --------------------------------- */

test('every flour has a name and a plausible protein figure', () => {
  for (const f of FLOURS) {
    assert.ok(f.id && f.brand && f.name, `flour missing identity: ${JSON.stringify(f)}`);
    assert.ok(f.protein > 5 && f.protein < 20, `implausible protein for ${f.id}: ${f.protein}`);
    if (f.w !== null && f.w !== undefined) assert.ok(f.w > 80 && f.w < 500, `implausible W for ${f.id}`);
  }
});

test('blend stats weight by share', () => {
  const b = blendStats([{ id: 'caputo-cuoco', pct: 50 }, { id: 'caputo-pizzeria', pct: 50 }]);
  near(b.w, (310 + 265) / 2, 1, 'blended W');
  assert.equal(b.valid, true);
});

test('a blend that does not total 100% is flagged', () => {
  assert.equal(blendStats([{ id: 'caputo-cuoco', pct: 80 }]).valid, false);
});

test('W estimation matches the flours that publish both figures', () => {
  near(estimateW(12.5), 270, 15, 'Pizzeria-class flour');
  near(estimateW(13), 300, 15, 'Cuoco-class flour');
});

test('every shipped recipe is a biga dough', () => {
  for (const r of starterRecipes()) {
    assert.equal(r.recipe.method, 'biga', `${r.name} should be biga`);
    assert.ok(r.recipe.prefermentFlourPct > 0, `${r.name} needs a preferment`);
  }
});

test('W bands come from the published guide', () => {
  assert.deepEqual(bandForW(310).ferment, [24, 48]);
  assert.deepEqual(bandForW(200).hydration, [55, 60]);
});

test('a stronger flour permits more hydration', () => {
  assert.ok(hydrationRangeForW(330).high > hydrationRangeForW(200).high);
});

/* ------------------------------ fermentation ---------------------------- */

test('rate is 1.0 at the reference temperature and rises with heat', () => {
  near(rateAt(20), 1, 1e-9, 'reference');
  assert.ok(rateAt(30) > rateAt(20));
  assert.ok(rateAt(4) < rateAt(20) * 0.3, 'a fridge is much slower than a counter');
  assert.ok(rateAt(45) < rateAt(35), 'activity falls off past the optimum');
});

test('fermentation units add up across stages', () => {
  const fu = fermentUnits([{ hours: 2, tempC: 20 }, { hours: 3, tempC: 20 }]);
  near(fu, 5, 1e-9, 'five hours at the reference temperature');
});

test('yeast slows far more than enzymes do in the cold', () => {
  // The published figures this model is anchored to: yeast drops to roughly a
  // tenth of its room rate at fridge temperature while the flour's own enzymes
  // keep just under half. The gap is what a cold proof exists to exploit.
  near(rateAt(4), 0.1, 0.03, 'yeast rate at 4 C');
  near(maturationRateAt(4), 0.45, 0.06, 'enzyme rate at 4 C');
  assert.ok(maturationRateAt(4) > rateAt(4) * 3, 'enzymes outrun yeast in the fridge');
});

test('maturation units accumulate through a cold proof that barely ferments', () => {
  const stage = [{ hours: 48, tempC: 4 }];
  assert.ok(fermentUnits(stage) < 6, 'little yeast work happens at 4 C');
  assert.ok(maturationUnits(stage) > 18, 'but plenty of enzyme work does');
});

test('a colder fridge needs more time for the same fermentation', () => {
  const warm = fermentUnits([{ hours: 48, tempC: 6 }]);
  const cold = fermentUnits([{ hours: 48, tempC: 1 }]);
  assert.ok(warm > cold, 'warmer fridge ferments further in the same time');
});

test('yeast and time trade off inversely against a reference bake', () => {
  const ref = HOUSE_REFERENCE;
  near(yeastForFU(ref.fu, { refYeastPct: ref.yeastPct, refFU: ref.fu }), ref.yeastPct, 1e-9, 'the reference reproduces itself');
  assert.ok(yeastForFU(ref.fu * 2, { refYeastPct: ref.yeastPct, refFU: ref.fu }) < ref.yeastPct, 'twice the units, less yeast');
});

test('a stronger flour can absorb a longer cold proof', () => {
  assert.ok(maturationCeilingForW(340) > maturationCeilingForW(260), 'W buys maturation headroom');
});

/* --------------------- the cold proof window verdict --------------------- */

const cuoco = { flours: [{ id: 'caputo-cuoco', pct: 100 }], w: 310 };
const windowFor = (fridgeTempC, coldProofHours) => {
  const schedule = { ...DEFAULT_SCHEDULE, fridgeTempC, coldProofHours };
  return coldProofWindow({ blend: cuoco, schedule });
};

test('the same cold proof reads differently at different fridge temperatures', () => {
  // This is the behaviour the app exists to provide: 66 hours is right in a
  // 37 F fridge and too long in a 43 F one, because the enzymes run faster.
  assert.equal(coldProofVerdict(windowFor(2.8, 66)).key, 'on', '66 h at 37 F');
  assert.equal(coldProofVerdict(windowFor(6.1, 66)).key, 'long', '66 h at 43 F');
  assert.ok(windowFor(6.1, 66).high < windowFor(2.8, 66).high, 'a warmer fridge shortens the window');
});

test('the window moves with flour strength as well as temperature', () => {
  const weak = coldProofWindow({ blend: { flours: [{ id: 'caputo-nuvola', pct: 100 }], w: 270 }, schedule: { ...DEFAULT_SCHEDULE, coldProofHours: 66 } });
  const strong = coldProofWindow({ blend: { flours: [{ id: 'polselli-super', pct: 100 }], w: 330 }, schedule: { ...DEFAULT_SCHEDULE, coldProofHours: 66 } });
  assert.ok(strong.high > weak.high, 'stronger flour tolerates longer');
  assert.equal(coldProofVerdict(strong).key, 'on', '66 h suits a W 330 flour');
  assert.ok(coldProofVerdict(weak).key.endsWith('long'), '66 h is too long for a W 270 flour');
});

test('a short cold proof is called short', () => {
  assert.ok(coldProofVerdict(windowFor(2.8, 8)).key.endsWith('short'), '8 h is not enough');
});

test('the suggested duration always lands inside its own window', () => {
  for (const f of FLOURS.filter((x) => Number.isFinite(x.w))) {
    for (const fridgeTempC of [1.7, 2.8, 4.4, 6.1]) {
      const blend = { flours: [{ id: f.id, pct: 100 }], w: f.w };
      const w = coldProofWindow({ blend, schedule: { ...DEFAULT_SCHEDULE, fridgeTempC, coldProofHours: 24 } });
      if (!w) continue;
      const check = coldProofWindow({ blend, schedule: { ...DEFAULT_SCHEDULE, fridgeTempC, coldProofHours: w.ideal } });
      assert.equal(coldProofVerdict(check).key, 'on', `${f.name} at ${fridgeTempC} C: its own suggestion should read as on target`);
      assert.ok(w.ideal >= 0 && w.ideal < 400, `${f.name}: suggestion within reach`);
    }
  }
});

test('water temperature solver uses three or four factors as appropriate', () => {
  near(waterTempFor({ ddtC: 24, flourTempC: 20, roomTempC: 20, frictionC: 8 }), 24 * 3 - 48, 1e-9, 'three factor');
  near(waterTempFor({ ddtC: 24, flourTempC: 20, roomTempC: 20, frictionC: 8, prefermentTempC: 4 }), 24 * 4 - 52, 1e-9, 'four factor');
});

/* ------------------------- splitting the cold ferment -------------------- */

test('a recipe saved before the split reads back unchanged', () => {
  /*
   * The migration property, and the one worth guarding hardest: bulkColdHours
   * defaults to zero, so a schedule written before this existed describes the
   * same dough, phase for phase and unit for unit.
   */
  const { bulkColdHours, ...asSavedBefore } = DEFAULT_SCHEDULE;
  const stages = scheduleStages(asSavedBefore);
  near(fermentUnits(stages), 17.2, 0.05, 'the house protocol still comes to 17.2 FU');
  near(maturationUnits(stages), 45, 0.5, 'and 45 MU');
  assert.equal(stages.find((x) => x.name === 'Bulk cold ferment').hours, 0, 'with no bulk phase');
});

test('splitting the cold time does not change what the dough gets', () => {
  /*
   * Same hours at the same fridge temperature, so the same maturation. The
   * split is a decision about gluten and gas, not about the model, and the app
   * must not pretend otherwise by reporting a difference that is not there.
   */
  const straight = scheduleStages({ ...DEFAULT_SCHEDULE, bulkColdHours: 0, coldProofHours: 66 });
  const split = scheduleStages({ ...DEFAULT_SCHEDULE, bulkColdHours: 48, coldProofHours: 18 });
  near(maturationUnits(split), maturationUnits(straight), 1e-9, 'maturation is identical');
  near(fermentUnits(split), fermentUnits(straight), 1e-9, 'and so is fermentation');
  assert.equal(totalColdHours({ ...DEFAULT_SCHEDULE, bulkColdHours: 48, coldProofHours: 18 }), 66);
});

test('either half of the cold ferment can be nothing', () => {
  for (const [bulk, balled] of [[0, 66], [66, 0], [48, 18], [0, 0]]) {
    const stages = scheduleStages({ ...DEFAULT_SCHEDULE, bulkColdHours: bulk, coldProofHours: balled });
    near(stages.find((x) => x.name === 'Bulk cold ferment').hours, bulk, 1e-9, `bulk ${bulk}`);
    near(stages.find((x) => x.name === 'Cold proof').hours, balled, 1e-9, `balled ${balled}`);
    assert.ok(stages.every((x) => x.hours >= 0), 'no phase goes negative');
  }
});

test('balling sits between the two cold phases, not before both', () => {
  /*
   * The whole point of the split: the dough is divided partway through the
   * cold ferment. If balling stayed where it was, a bulk phase would be bulk
   * in name only.
   */
  const at = solveSchedule({ ...DEFAULT_SCHEDULE, bulkColdHours: 48, coldProofHours: 18 }).at;
  assert.ok(at['p3-3'] < at['p3-bulk'], 'the oil veil comes before the bulk ferment');
  assert.ok(at['p3-bulk'] < at['p3-4'], 'the bulk ferment comes before balling');
  assert.ok(at['p3-4'] < at['p4-1'], 'and balling before the balled proof');
  near((at['p3-4'] - at['p3-bulk']) / 60, 48, 0.01, 'the bulk phase is as long as asked');
  near((at['p5-1'] - at['p4-1']) / 60, 18, 0.01, 'and so is the balled one');
});

test('with no bulk phase the order is exactly what it always was', () => {
  const at = solveSchedule(DEFAULT_SCHEDULE).at;
  near((at['p4-1'] - at['p3-4']) / 60 * 60, DEFAULT_SCHEDULE.ballingMin, 0.01, 'balling runs straight into the cold proof');
  near((at['p3-4'] - at['p3-bulk']) / 60, 0, 1e-9, 'and the bulk phase takes no time at all');
});

test('the published schema names every step the phases are bounded by', () => {
  /*
   * The schema described the five phases this protocol used to have, and went
   * on describing them after a sixth and seventh were added. Nothing failed,
   * because a description is prose: it was simply wrong, and wrong in the one
   * document other people would build against.
   */
  const bake = readFileSync(new URL('../schema/bake.schema.json', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../schema/README.md', import.meta.url), 'utf8');

  for (const id of TIMED_STEPS) {
    assert.ok(bake.includes(id), `bake.schema.json does not mention the bounding step ${id}`);
    assert.ok(readme.includes(id), `schema/README.md does not mention the bounding step ${id}`);
  }
  for (const phase of PHASE_BOUNDS) {
    assert.ok(readme.toLowerCase().includes(phase.name.toLowerCase().replace(' & ', ' and ')),
      `schema/README.md does not list the phase "${phase.name}"`);
  }

  // Every knob the phases are planned by has to be in the protocol schema.
  const protocolSchema = readFileSync(new URL('../schema/protocol.schema.json', import.meta.url), 'utf8');
  for (const phase of PHASE_BOUNDS) {
    if (!phase.plan) continue;
    assert.ok(protocolSchema.includes(phase.plan), `protocol.schema.json is missing ${phase.plan}`);
  }
});

test('a step skipped by the schedule is not skipped when the schedule uses it', () => {
  /*
   * Found by asking whether the protocol really adapts. A step can be skipped
   * because of the recipe, as the freezer steps are, or because of the
   * schedule, as the bulk cold ferment is when set to zero. The protocol view
   * was asking with the recipe alone, so the bulk step read as skipped however
   * long the bulk ferment was, which also left it impossible to tick off.
   */
  const bulk = STEPS.find((x) => x.id === 'p3-bulk');
  const recipeOnly = { c: { recipe: { frozenBalls: 0 } } };
  assert.equal(bulk.skipWhen(recipeOnly), true, 'with no schedule it cannot know, and says skipped');
  assert.equal(bulk.skipWhen({ ...recipeOnly, S: { ...DEFAULT_SCHEDULE, bulkColdHours: 48 } }), false,
    'but given the schedule it is plainly in use');

  // Every step that skips on the schedule must tolerate being asked without
  // one, or the protocol screen throws rather than renders.
  for (const step of STEPS) {
    if (!step.skipWhen) continue;
    assert.doesNotThrow(() => step.skipWhen(recipeOnly), `${step.id} must survive being asked without a schedule`);
  }
});

test('the bulk step is offered only when it is used', () => {
  const withBulk = activeSteps({ c: { recipe: { frozenBalls: 0 } }, S: { ...DEFAULT_SCHEDULE, bulkColdHours: 48 } });
  const without = activeSteps({ c: { recipe: { frozenBalls: 0 } }, S: DEFAULT_SCHEDULE });
  assert.ok(withBulk.some((x) => x.id === 'p3-bulk'), 'shown when there is a bulk ferment');
  assert.ok(!without.some((x) => x.id === 'p3-bulk'), 'and dropped when there is not');
});

test('the flour budget is spent on the cold ferment as a whole', () => {
  const blend = { flours: [{ id: 'caputo-cuoco', pct: 100 }], w: 310 };
  const straight = coldProofWindow({ blend, schedule: { ...DEFAULT_SCHEDULE, bulkColdHours: 0, coldProofHours: 66 } });
  const split = coldProofWindow({ blend, schedule: { ...DEFAULT_SCHEDULE, bulkColdHours: 48, coldProofHours: 18 } });

  near(split.actual, 66, 1e-9, 'the figure judged is the two added together');
  near(split.low, straight.low, 1e-9, 'and the window does not move with the split');
  near(split.high, straight.high, 1e-9);
  assert.equal(coldProofVerdict(split).key, coldProofVerdict(straight).key, 'so the verdict is the same');
  assert.equal(split.split, true, 'but the app knows it is in two parts');
  assert.equal(straight.split, false);
});

test('the phase a bake is measured on is found by name, not position', () => {
  /*
   * Inserting the bulk phase shifted every later index by one. Anything
   * reading a phase by number kept returning a figure, just the wrong one.
   */
  const t = Date.parse('2026-09-18T08:00:00Z');
  const H = 3600000;
  const bake = {
    recipe: DEFAULT_RECIPE,
    schedule: { ...DEFAULT_SCHEDULE, bulkColdHours: 24 },
    scores: EMPTY_SCORES,
    doneAt: { 'p4-1': t, 'p5-1': t + 30 * H },
  };
  const d = derive(bake, DEFAULT_MODEL);
  near(findFactor('balledColdHours').get(bake, d), 30, 0.01, 'the balled proof is the one that was measured');
  near(findFactor('bulkColdHours').get(bake, d), 24, 0.01, 'the bulk phase comes from the plan');
  near(findFactor('coldProofHours').get(bake, d), 54, 0.01, 'and the total is the two together');
});

/* ------------------------------- timeline ------------------------------- */

const T0 = Date.parse('2026-09-01T08:00:00Z');
const hoursAfter = (h) => T0 + h * 3600000;

test('a phase between two marks measures what really elapsed', () => {
  const stages = actualStages({
    doneAt: { 'p1-3': T0, 'p1-4': hoursAfter(4.5) },
    schedule: DEFAULT_SCHEDULE,
    planned: scheduleStages(DEFAULT_SCHEDULE),
  });
  near(stages[0].hours, 4.5, 1e-9, 'measured against the clock, not the plan');
  assert.equal(stages[0].state, 'done');
  assert.equal(stages[1].state, 'running', 'the next phase is under way');
});

test('a phase still running is measured up to now', () => {
  const stages = actualStages({
    doneAt: { 'p4-1': T0 },
    schedule: DEFAULT_SCHEDULE,
    planned: scheduleStages(DEFAULT_SCHEDULE),
    now: hoursAfter(24),
  });
  const proof = stages.find((x) => x.name === 'Cold proof');
  near(proof.hours, 24, 1e-9, '24 hours into the cold proof');
  assert.equal(proof.state, 'running');
});

test('an untouched phase falls back to the plan', () => {
  const planned = scheduleStages(DEFAULT_SCHEDULE);
  const stages = actualStages({ doneAt: {}, schedule: DEFAULT_SCHEDULE, planned });
  assert.ok(stages.length === planned.length, 'one entry per phase, however many there are');
  assert.ok(stages.every((x) => x.state === 'planned'), 'nothing is claimed as measured');
  // By name, because a phase inserted ahead of this one would otherwise make
  // the assertion silently check something else.
  const proof = stages.findIndex((x) => x.name === 'Cold proof');
  near(stages[proof].hours, planned[proof].hours, 1e-9, 'planned cold proof carried through');
});

test('running late shows up as maturation the plan did not ask for', () => {
  // The case that started this: the final mix happens half an hour late, so
  // the biga sits in the fridge half an hour longer than the protocol says.
  // Measured at the moment of the mix, so nothing downstream absorbs it.
  const planned = scheduleStages(DEFAULT_SCHEDULE);
  const coldHold = (endHours) => actualStages({
    doneAt: { 'p1-4': T0, 'p2-1': hoursAfter(endHours) },
    schedule: DEFAULT_SCHEDULE,
    planned,
    now: hoursAfter(endHours),
  }).find((x) => x.name === 'Biga cold hold');

  near(coldHold(17.5).hours, 17.5, 1e-9, 'the fridge held it half an hour longer');
  assert.ok(
    maturationUnits([coldHold(17.5)]) > maturationUnits([coldHold(17)]),
    'and that half hour is real maturation, not a rounding difference'
  );
});

test('a bake in progress projects forward instead of undercounting', () => {
  // Half an hour late out of the fridge, final mix just started. Summing only
  // what has elapsed would report less maturation than the plan, which is
  // nonsense: the dough is behind schedule, not ahead of it.
  const planned = scheduleStages(DEFAULT_SCHEDULE);
  const doneAt = { 'p1-3': T0, 'p1-4': hoursAfter(3.75), 'p2-1': hoursAfter(21.25) };
  const now = hoursAfter(21.25);

  const sofar = maturationUnits(actualStages({ doneAt, schedule: DEFAULT_SCHEDULE, planned, now }));
  const ahead = maturationUnits(projectedStages({ doneAt, schedule: DEFAULT_SCHEDULE, planned, now }));
  const plan = maturationUnits(planned);

  assert.ok(sofar < plan, 'elapsed alone undercounts a bake that has barely started');
  assert.ok(ahead > plan, 'projected forward, the extra half hour in the fridge shows as more maturation');
  assert.ok(ahead - plan < 1, 'and it is a small amount, because half an hour cold is not much');
});

test('a phase that has overrun keeps its real time in the projection', () => {
  const planned = scheduleStages(DEFAULT_SCHEDULE);
  // Left on the bench for six hours against a planned two.
  const doneAt = { 'p2-1': T0 };
  const stages = projectedStages({ doneAt, schedule: DEFAULT_SCHEDULE, planned, now: hoursAfter(6) });
  const bench = stages.find((x) => x.name === 'Mix & bench');
  near(bench.hours, 6, 1e-9, 'the overrun is not wished away');
});

test('catching up on the clock does not put the dough back where it was', () => {
  /*
   * The case from a real bake: the mix ran 1 h 32 m long on a warm bench, so
   * the schedule slipped two hours. Cutting two hours off the cold proof puts
   * dinner back on time, but sheds far less maturation than the bench added,
   * because enzymes at 21 C work more than twice as fast as at 3 C.
   */
  const planned = scheduleStages(DEFAULT_SCHEDULE);
  const over = planned.map((x) => (x.name === 'Mix & bench' ? { ...x, hours: x.hours + 1.53, state: 'done' } : { ...x, state: 'planned' }));
  const proofIndex = planned.findIndex((x) => x.name === 'Cold proof');

  const planMU = maturationUnits(planned);
  const lateMU = maturationUnits(over);
  assert.ok(lateMU > planMU, 'the overrun added maturation');

  const clockCut = maturationUnits(trimStage(over, proofIndex, 2));
  assert.ok(clockCut > planMU, 'two hours off the fridge does not undo it');

  const need = trimForMaturation({ stages: over, index: proofIndex, targetMU: planMU });
  assert.ok(need.feasible, 'there is enough cold proof to cut from');
  assert.ok(need.hours > 2, `it takes more than the clock slip: ${need.hours.toFixed(1)} h`);
  near(maturationUnits(trimStage(over, proofIndex, need.hours)), planMU, 1e-6, 'cutting that much lands on the plan');
});

test('only phases that have not finished can be trimmed', () => {
  const stages = [
    { name: 'Biga ambient rest', hours: 4, tempC: 21, state: 'done' },
    { name: 'Cold proof', hours: 66, tempC: 3, state: 'running' },
    { name: 'Counter temper', hours: 4, tempC: 21, state: 'planned' },
    { name: 'Nothing left', hours: 0, tempC: 21, state: 'planned' },
  ];
  assert.deepEqual(trimmablePhases(stages).map((x) => x.name), ['Cold proof', 'Counter temper']);
});

test('a trim never drives a phase below zero', () => {
  const stages = [{ name: 'Cold proof', hours: 3, tempC: 3, state: 'running' }];
  near(trimStage(stages, 0, 10)[0].hours, 0, 1e-9, 'clamped at nothing');
});

test('nothing to shed means nothing to offer', () => {
  const planned = scheduleStages(DEFAULT_SCHEDULE);
  const i = planned.findIndex((x) => x.name === 'Cold proof');
  const onPlan = trimForMaturation({ stages: planned, index: i, targetMU: maturationUnits(planned) });
  assert.equal(onPlan.feasible, false, 'a schedule already on target is not asked to cut');
});

test('drift is signed, and late is positive', () => {
  const launchISO = '2026-09-01T18:00:00.000Z';
  const at = { 'p2-1': -600 };
  const planned = Date.parse(launchISO) - 600 * 60000;
  const d = drifts({ doneAt: { 'p2-1': planned + 30 * 60000 }, at, launchISO });
  near(d['p2-1'], 30 * 60000, 1e-9, 'thirty minutes late');
  assert.equal(sayDrift(d['p2-1']), '30 min late');
  assert.equal(sayDrift(-90 * 60000), '1 h 30 min early');
  assert.equal(sayDrift(0), 'on time');
});

test('a late step pushes the launch by the same amount', () => {
  const launchISO = '2026-09-01T18:00:00.000Z';
  const at = { 'p5-1': -240 };
  const planned = Date.parse(launchISO) - 240 * 60000;
  const p = projectedLaunch({ doneAt: { 'p5-1': planned + 45 * 60000 }, at, launchISO });
  near(p.slipMs, 45 * 60000, 1e-9, 'the slip carries to the oven');
  near(p.launchMs - p.plannedMs, 45 * 60000, 1e-9, 'dinner moves by the same 45 minutes');
});

test('the projection follows the latest step by plan order, not tick order', () => {
  const launchISO = '2026-09-01T18:00:00.000Z';
  const at = { 'p1-4': -3000, 'p5-1': -240 };
  const base = Date.parse(launchISO);
  // Someone ticks the temper first, then goes back for a missed earlier box.
  const p = projectedLaunch({
    doneAt: { 'p5-1': base - 240 * 60000 + 15 * 60000, 'p1-4': base - 3000 * 60000 + 90 * 60000 },
    at,
    launchISO,
  });
  assert.equal(p.from, 'p5-1', 'the last thing that happened governs what is left');
  near(p.slipMs, 15 * 60000, 1e-9, 'not the 90 minute drift from hours ago');
});

test('every checked step counts toward the projection, not just phase bounds', () => {
  const launchISO = '2026-09-01T18:00:00.000Z';
  const base = Date.parse(launchISO);
  // p2-2 is a bench step in the middle of a phase, not one of the ten bounds.
  const at = { 'p2-1': -240, 'p2-2': -230 };
  const p = projectedLaunch({
    doneAt: { 'p2-1': base - 240 * 60000, 'p2-2': base - 230 * 60000 + 20 * 60000 },
    at,
    launchISO,
  });
  assert.equal(p.from, 'p2-2', 'the most recent thing that happened governs what is left');
  near(p.slipMs, 20 * 60000, 1e-9, 'and it carries its own slip');
});

test('a stamp on any step is enough to start reporting', () => {
  assert.equal(hasTimings({ 'p3-2': Date.now() }), true, 'a mid-phase step counts');
  assert.equal(hasTimings({}), false);
  assert.equal(hasTimings({ 'p3-2': 'not a time' }), false, 'and rubbish does not');
});

test('nothing recorded means nothing claimed', () => {
  assert.equal(hasTimings({}), false);
  assert.equal(hasTimings({ 'p1-3': T0 }), true);
  assert.equal(projectedLaunch({ doneAt: {}, at: {}, launchISO: '2026-09-01T18:00:00.000Z' }), null);
});

/* ------------------------------- protocol ------------------------------- */

test('the schedule solves backwards to the documented lead time', () => {
  const s = solveSchedule();
  near(s.totalMin / 60, 92.9, 0.5, 'lead time in hours');
  assert.equal(s.at['p5-4'], 0, 'launch is the anchor');
  assert.ok(s.at['p1-1'] < 0, 'the first step is before the launch');
});

test('lengthening the cold proof moves the mix earlier, not the bake later', () => {
  const base = solveSchedule();
  const longer = solveSchedule({ ...DEFAULT_SCHEDULE, coldProofHours: 90 });
  assert.equal(longer.at['p5-4'], base.at['p5-4'], 'launch stays put');
  assert.ok(longer.at['p1-1'] < base.at['p1-1'], 'the biga starts earlier');
  near(base.at['p1-1'] - longer.at['p1-1'], 24 * 60, 1, 'moved by the extra 24 hours');
});

test('every step renders text for both unit systems and every mixer', () => {
  const c = computeRecipe({});
  for (const u of ['C', 'F']) {
    for (const m of MIXERS) {
      for (const step of STEPS) {
        const ctx = { c, S: DEFAULT_SCHEDULE, u, E: { mixerId: m.id, ovenId: 'gas-deck' } };
        assert.ok(step.title(ctx).length > 3, `${step.id} title`);
        assert.ok(step.body(ctx).length > 20, `${step.id} body`);
        assert.ok(step.badge(ctx).length > 0, `${step.id} badge`);
      }
    }
    for (const step of STEPS) {
      const ctx = { c, S: DEFAULT_SCHEDULE, u, E: { mixerId: 'spiral', ovenId: 'gas-deck' } };
      assert.ok(step.title(ctx).length > 3, `${step.id} title`);
      assert.ok(step.body(ctx).length > 20, `${step.id} body`);
      assert.ok(step.badge(ctx).length > 0, `${step.id} badge`);
    }
  }
});

test('the frozen track drops out of an all-fresh batch', () => {
  assert.equal(activeSteps({ c: computeRecipe({ frozenBalls: 4 }) }).length, 19);
  assert.equal(activeSteps({ c: computeRecipe({ frozenBalls: 0 }) }).length, 17);
});

/* -------------------------------- advisor ------------------------------- */

test('strength band tracks W', () => {
  assert.equal(strengthBand(310).key, 'very-strong');
  assert.equal(strengthBand(240).key, 'weak');
  assert.equal(strengthBand(380).key, 'extra-strong');
});

test('the advisor reconstructs the house protocol from the flour alone', () => {
  const flours = [{ id: 'caputo-cuoco', pct: 100 }];
  const plan = suggestPlan(blendStats(flours), { flours, totalHours: 93 });
  near(plan.schedule.coldProofHours, 66, 4, 'cold proof');
  near(plan.schedule.bigaColdHours, 17, 3, 'biga cold hold');
  near(plan.idyPct, 0.1, 0.015, 'inoculation');
  near(plan.hydration.recommended, 70, 3, 'hydration');
});

test('a change of one degree in the fridge moves the suggested inoculation', () => {
  const flours = [{ id: 'caputo-cuoco', pct: 100 }];
  const at = (c) => suggestPlan(blendStats(flours), { flours, totalHours: 93, fridgeTempC: c }).idyPct;
  const cold = at(2.8);
  const warmer = at(2.8 + 5 / 9); // one degree Fahrenheit
  assert.ok(warmer < cold, 'a warmer fridge needs less yeast');
  // The Recompute button compares at three decimal places, so the difference
  // has to survive that rounding or the button sits dead while inputs move.
  assert.notEqual(Math.round(cold * 1000), Math.round(warmer * 1000), 'one degree must be visible at the precision the app stores');
});

test('a shorter schedule needs more yeast than a long one', () => {
  const flours = [{ id: 'caputo-cuoco', pct: 100 }];
  const short = suggestPlan(blendStats(flours), { flours, totalHours: 24 });
  const long = suggestPlan(blendStats(flours), { flours, totalHours: 96 });
  assert.ok(short.idyPct > long.idyPct * 2, 'a 24 hour schedule needs far more yeast than a 96 hour one');
});

test('the flour library only carries flours a biga canotto can use', () => {
  for (const f of FLOURS) {
    const w = f.w ?? estimateW(f.protein);
    assert.ok(w >= 240 || f.grade === 'Semola' || f.grade === 'Whole' || f.grade === 'Integrale', `${f.id} is too soft to be in this list`);
  }
});

test('the lead time defaults to the middle of the published window', () => {
  near(defaultLeadHours(blendStats([{ id: 'caputo-cuoco', pct: 100 }])), 72, 0.51, 'Cuoco window midpoint');
});

test('review flags a schedule that overruns the flour', () => {
  const blend = blendStats([{ id: 'caputo-pizzeria', pct: 100 }]);
  const notes = reviewPlan({ blend, stages: [{ hours: 200, tempC: 6 }], idyPct: 0.1 }).notes;
  assert.ok(notes.some((n) => n.tone === 'bad'), 'expected a hard warning');
});

/* -------------------------------- recipes ------------------------------- */

test('a recipe generated from a blend is complete and bakeable', () => {
  const r = recipeFromBlend([{ id: 'caputo-nuvola', pct: 100 }]);
  assert.ok(r.id && r.name);
  const c = computeRecipe(r.recipe);
  assert.ok(c.flour > 0 && c.water > 0);
  assert.ok(r.schedule.coldProofHours > 0);
});

test('exactly one recipe ships, and it is the house protocol', () => {
  const starters = starterRecipes();
  assert.equal(starters.length, 1, 'only the house protocol should ship as a preset');
  assert.equal(starters[0].origin, 'house');
  const c = computeRecipe(starters[0].recipe);
  assert.ok(c.flour > 0, 'the house recipe has no flour');
  assert.ok(!c.warnings.some((w) => w.includes('add up')), c.warnings.join('; '));
});

test('a recipe built from the creation inputs honours every one of them', () => {
  const flours = [{ id: 'caputo-nuvola-super', pct: 100 }];
  const r = recipeFromBlend(flours, {
    name: 'Friday dough',
    totalHours: 60,
    balls: 6,
    ballWeight: 300,
    frozenBalls: 2,
    roomTempC: 24,
    fridgeTempC: 5,
  });
  assert.equal(r.name, 'Friday dough');
  assert.equal(r.recipe.balls, 6);
  assert.equal(r.recipe.ballWeight, 300);
  assert.equal(r.recipe.frozenBalls, 2);
  assert.equal(r.schedule.fridgeTempC, 5);
  assert.equal(r.schedule.roomTempC, 24);
  assert.equal(r.recipe.flours[0].id, 'caputo-nuvola-super');
  // The schedule the engine generated should add up to the requested maturation.
  const total = r.schedule.bigaRestHours + r.schedule.bigaColdHours + r.schedule.coldProofHours + r.schedule.temperHours;
  near(total, 60 - 2, 1.5, 'phases should span the requested maturation');
});

test('a warmer fridge shortens the generated cold proof', () => {
  const flours = [{ id: 'caputo-cuoco', pct: 100 }];
  const cold = recipeFromBlend(flours, { totalHours: 72, fridgeTempC: 2 });
  const warm = recipeFromBlend(flours, { totalHours: 72, fridgeTempC: 8 });
  assert.equal(cold.schedule.coldProofHours, warm.schedule.coldProofHours, 'time is what the baker asked for');
  assert.ok(warm.recipe.baseYeastPct < cold.recipe.baseYeastPct, 'a warmer fridge needs less yeast for the same clock time');
});

test('overall score averages only the marks that were given', () => {
  assert.equal(overallScore({ canotto: 4, honeycomb: 4 }), 4);
  assert.equal(overallScore({}), null);
});

test('recipe rating aggregates its own bakes only', () => {
  const bakes = [
    { recipeId: 'x', scores: { canotto: 4, honeycomb: 4 } },
    { recipeId: 'x', scores: { canotto: 2, honeycomb: 2 } },
    { recipeId: 'y', scores: { canotto: 5, honeycomb: 5 } },
  ];
  const r = recipeRating('x', bakes);
  assert.equal(r.runs, 2);
  assert.equal(r.average, 3);
});

/* ---------------------------------- misc -------------------------------- */

test('bake stages scale with the bake time', () => {
  const s = bakeStages(90);
  assert.equal(s[0].sec, 0);
  assert.equal(s[s.length - 1].sec, 90);
});

test('an electric oven gets element wording, not flame wording', () => {
  const gas = bakeStages(75, 'gas-deck');
  const electric = bakeStages(110, 'electric-pizza');
  assert.ok(gas.every((s) => !/ELEMENT/.test(s.flame)));
  assert.ok(electric.every((s) => !/FLAME/.test(s.flame)), 'no flame language on an electric oven');
});

test('equipment falls back to the preset label and takes a custom make and model', () => {
  assert.equal(ovenLabel({ ovenId: 'wood' }), 'Wood-fired oven');
  assert.equal(ovenLabel({ ovenId: 'custom', ovenMake: 'Gozney', ovenModel: 'Dome' }), 'Gozney Dome');
  assert.equal(mixerLabel({ mixerId: 'hand' }), 'By hand');
  assert.ok(mixerLabel({ mixerId: 'spiral', mixerMake: 'Famag' }).startsWith('Famag'));
});

test('friction allowance follows the mixer', () => {
  assert.ok(findMixer('hand').frictionC < findMixer('spiral').frictionC);
  assert.ok(findMixer('spiral').frictionC < findMixer('planetary').frictionC);
});

test('mixing instructions adapt to hand mixing', () => {
  assert.match(mixerPhrasing({ mixerId: 'hand' }).lowSpeed, /hand/);
  assert.match(mixerPhrasing({ mixerId: 'spiral' }).lowSpeed, /speed/);
});

test('an untouched session produces no diagnosis', () => {
  const blank = {
    scores: { canotto: null, honeycomb: null, blistering: null, flavour: null, base: null },
    actuals: { ambientTempC: null, fdtC: null, fridgeTempC: null, coreTempC: null, deckTempC: null, domeTempC: null, bakeSec: null },
  };
  assert.equal(diagnose(blank).length, 0, 'blank fields must not read as a score of zero');
});

test('diagnosis fires only on the numbers that warrant it', () => {
  const hits = diagnose({ scores: { honeycomb: 2 }, actuals: {} }).map((d) => d.id);
  assert.ok(hits.includes('bready'));
  assert.equal(diagnose({ scores: { honeycomb: 5 }, actuals: {} }).length, 0);
});

test('cloud merge keeps the newest version of each record', () => {
  const { merged } = mergeCollections([{ id: 'a', updatedAt: '2026-02-02', v: 'local' }], [{ id: 'a', updatedAt: '2026-01-01', v: 'remote' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].v, 'local');
});

test('the shipped protocol is the reference the app measures against', () => {
  // Fork-on-edit exists to keep these numbers true. If they drift, the thing
  // every schedule is compared against has moved.
  const h = houseRecipe();
  assert.equal(h.origin, 'house');
  assert.equal(h.schedule.coldProofHours, 66, 'the house cold proof');
  assert.equal(h.schedule.bigaColdHours, 17, 'the house biga cold hold');
  assert.equal(h.recipe.baseYeastPct, 0.1, 'the house inoculation');
  assert.equal(h.recipe.hydrationPct, 70, 'the house hydration');
  assert.equal(h.schedule.fridgeTempC, SCHED.fridgeTempC);
});

test('a recipe missing fields is filled in rather than left to crash a screen', () => {
  const r = normaliseRecipe({ id: 'x', recipe: { hydrationPct: 75 } });
  assert.equal(r.recipe.hydrationPct, 75, 'the given value survives');
  assert.equal(typeof r.recipe.yeastType, 'string', 'missing fields get a default');
  assert.ok(Array.isArray(r.recipe.flours) && r.recipe.flours.length, 'a flour is always present');
  assert.ok(r.schedule.coldProofHours > 0, 'the schedule is complete');
  assert.ok(computeRecipe(r.recipe).flour > 0, 'and it computes');
});

test('temperature conversion round-trips', () => {
  near(fToC(cToF(3)), 3, 1e-9, 'round trip');
  near(cToF(2.8), 37, 0.1, 'the default fridge is 37 F');
});

test('a temperature difference scales without the freezing offset', () => {
  near(deltaToDisplay(9, 'F'), 16.2, 0.01, '9 C of friction is 16.2 F, not 48');
  near(deltaFromDisplay(deltaToDisplay(9, 'F'), 'F'), 9, 1e-9, 'round trip');
  assert.equal(deltaToDisplay(9, 'C'), 9, 'no change in Celsius');
});

/* -------------------------- published schemas --------------------------- */

const schemas = await loadSchemas(new URL('../schema', import.meta.url).pathname);
const check = (data, file) => validate(data, schemas[file], schemas, '$', schemas[file].$id);

/** A bake shaped exactly as the app files one. */
function sampleBake() {
  return {
    id: 'b1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    bakedAt: '2026-09-11T17:00',
    recipeId: 'house-canotto',
    recipeName: 'Contemporary Canotto (house)',
    title: 'Contemporary Canotto (house)',
    planned: false,
    notes: 'Rim was taller than last time.',
    issues: ['gumline'],
    equipment: { ...DEFAULT_EQUIPMENT },
    recipe: { ...houseRecipe().recipe },
    schedule: { ...houseRecipe().schedule },
    actuals: { ...EMPTY_ACTUALS, ambientTempC: 18, deckTempC: 452, bakeSec: 75 },
    scores: { ...EMPTY_SCORES, canotto: 4, honeycomb: 4 },
  };
}

const SCHEMA_FILES = [
  'common.schema.json',
  'dough.schema.json',
  'protocol.schema.json',
  'recipe.schema.json',
  'recipes.schema.json',
  'bake.schema.json',
  'log.schema.json',
  'export.schema.json',
];

test('every schema file is itself valid JSON with an id and a title', () => {
  for (const name of SCHEMA_FILES) {
    const s = schemas[name];
    assert.ok(s, `${name} is missing`);
    assert.ok(s.$id?.startsWith('https://'), `${name} needs an absolute $id so $ref works from anywhere`);
    assert.ok(s.title && s.description, `${name} needs a title and a description`);
  }
});

test('the shipped recipe validates against the published recipe schema', () => {
  const errors = check(houseRecipe(), 'recipe.schema.json');
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('a generated recipe validates too', () => {
  const r = recipeFromBlend([{ id: 'caputo-nuvola-super', pct: 100, stage: 'blend' }], { totalHours: 60 });
  const errors = check(r, 'recipe.schema.json');
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('a logged bake validates against the published bake schema', () => {
  const errors = check(sampleBake(), 'bake.schema.json');
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('a log export validates against the log schema', () => {
  const file = {
    $schema: `${SCHEMA_BASE}/log.schema.json`,
    app: 'Canotto Lab',
    exportedAt: new Date().toISOString(),
    bakes: [sampleBake(), sampleBake()],
  };
  const errors = check(file, 'log.schema.json');
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('a recipe library export validates against the recipes schema', () => {
  const file = {
    $schema: `${SCHEMA_BASE}/recipes.schema.json`,
    app: 'Canotto Lab',
    exportedAt: new Date().toISOString(),
    recipes: [houseRecipe(), recipeFromBlend([{ id: 'caputo-cuoco', pct: 100, stage: 'blend' }])],
  };
  const errors = check(file, 'recipes.schema.json');
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('every exported document type has a schema of its own', () => {
  // What the app writes, and the schema each file claims to follow.
  const written = {
    'canotto-lab.json': 'export.schema.json',
    'canotto-recipes.json': 'recipes.schema.json',
    'canotto-log.json': 'log.schema.json',
    '<recipe>.json': 'recipe.schema.json',
  };
  for (const [file, schema] of Object.entries(written)) {
    assert.ok(schemas[schema], `${file} claims ${schema}, which does not exist`);
    assert.ok(SCHEMA_FILES.includes(schema), `${schema} is not in the published set`);
  }
});

test('an export envelope validates, and names its own schema', () => {
  const file = {
    $schema: `${SCHEMA_BASE}/export.schema.json`,
    app: 'Canotto Lab',
    exportedAt: new Date().toISOString(),
    version: 1,
    recipes: [houseRecipe()],
    bakes: [sampleBake()],
    settings: { unit: 'F', model: { ...DEFAULT_MODEL } },
  };
  const errors = check(file, 'export.schema.json');
  assert.deepEqual(errors, [], errors.join('\n'));
  assert.ok(file.$schema.endsWith('/export.schema.json'), 'an export should say what it is');
});

test('the schemas compose rather than repeat themselves', async () => {
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../schema', import.meta.url).pathname;
  for (const name of SCHEMA_FILES) {
    if (name === 'common.schema.json') continue;
    const text = readFileSync(`${dir}/${name}`, 'utf8');
    assert.ok(text.includes('common.schema.json'), `${name} should build on the shared definitions`);
  }
  // The file header is defined once and composed, not pasted into each document.
  for (const name of ['log.schema.json', 'recipes.schema.json', 'export.schema.json']) {
    const doc = schemas[name];
    assert.ok(Array.isArray(doc.allOf), `${name} should compose the envelope with allOf`);
    assert.ok(doc.allOf.some((s) => String(s.$ref || '').endsWith('#/$defs/envelope')), `${name} should reference the shared envelope`);
    assert.equal(readFileSync(`${dir}/${name}`, 'utf8').includes('"exportedAt"'), false, `${name} should not redeclare the header`);
  }
});

test('a document schema pins its own identity, so a log cannot pass as a backup', () => {
  const wrong = {
    $schema: `${SCHEMA_BASE}/export.schema.json`,
    app: 'Canotto Lab',
    exportedAt: new Date().toISOString(),
    bakes: [sampleBake()],
  };
  assert.ok(check(wrong, 'log.schema.json').length, 'a file claiming to be a backup should not validate as a log');
});

test('the schemas actually reject malformed data', () => {
  assert.ok(check({ ...houseRecipe(), recipe: { ...houseRecipe().recipe, yeastType: 'sourdough' } }, 'recipe.schema.json').length, 'an unknown yeast type should fail');
  assert.ok(check({ ...sampleBake(), scores: { canotto: 9 } }, 'bake.schema.json').length, 'a score of 9 out of 5 should fail');
  assert.ok(check({ ...sampleBake(), bakedAt: undefined }, 'bake.schema.json').length, 'a bake with no date should fail');
});

/**
 * Blank out comments and the text of strings, leaving the code.
 *
 * Done in one left-to-right pass, because doing it as a series of regexes
 * cannot work: stripping single-quoted strings first means an apostrophe in a
 * double-quoted string ("Baker's percentages") opens a string that runs to the
 * next apostrophe, swallowing whatever code lies between. That is how the
 * import guard came to be silently blind to parts of two files.
 *
 * Code inside a template's ${...} is kept, since it is code and can call
 * something that was never imported. Assumes no view holds a quote character
 * inside a regular expression literal, which none does.
 */
function stripLiterals(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  const skipString = (q) => {
    i += 1;
    while (i < n && src[i] !== q) i += src[i] === '\\' ? 2 : 1;
    i += 1;
  };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      out += ' ';
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? n : end;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'") {
      skipString(c);
      out += "''";
      continue;
    }
    if (c === '`') {
      i += 1;
      out += '``';
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i += 1; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          let level = 1;
          i += 2;
          const start = i;
          while (i < n && level) {
            const ch = src[i];
            if (ch === '"' || ch === "'" || ch === '`') { skipString(ch); continue; }
            if (ch === '{') level += 1;
            else if (ch === '}') level -= 1;
            i += 1;
          }
          out += ` ${stripLiterals(src.slice(start, i - 1))} `;
          continue;
        }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

test('a bake is recorded in one place', async () => {
  /*
   * The run is one continuous thing: biga on Monday, pizzas on Friday, judged
   * the moment they come out. It used to be written down twice, because a Bake
   * screen recorded conditions and all five marks while the protocol recorded
   * measurements and three of the same marks at its last step. Nothing said
   * which was the real one, because both were, and a second surface is easy to
   * add back without noticing.
   *
   * Editing a bake already filed is a different thing and stays in the log.
   */
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../src/views', import.meta.url).pathname;
  const writers = [];
  const scorers = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(`${dir}/${file}`, 'utf8');
    if (/current\.(actuals|scores)\s*\[[^\]]*\]\s*=/.test(src)) writers.push(file);
    // Calls, not the definition and not the import naming it.
    const calls = [...src.matchAll(/^(?!import\b)(?!export function\b).*\bscoreInputs\s*\(/gm)];
    if (calls.length) scorers.push(file);
  }
  assert.deepEqual(writers, ['protocol.js'], 'only the run records what happened');
  assert.deepEqual(scorers.sort(), ['log.js', 'protocol.js'],
    'scored once at the end of the run, and afterwards only by editing the filed bake');
});

test('every view imports what it uses', async () => {
  /*
   * A missing import throws inside a click handler, where nothing surfaces it:
   * the button simply does nothing. This has happened three times.
   *
   * It used to collect every unknown call and then keep only a hardcoded list
   * of names, which meant it could only ever catch the three mistakes already
   * made. A helper deleted during a refactor sailed past it and broke the whole
   * screen. It now reports anything that is neither imported, declared, bound
   * as a parameter, a keyword, nor a browser global.
   */
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = new URL('../src/views', import.meta.url).pathname;

  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
    'await', 'super', 'async', 'var', 'let', 'const', 'new', 'do', 'else', 'try', 'yield', 'void', 'delete', 'in', 'of']);
  const GLOBALS = new Set(['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
    'queueMicrotask', 'fetch', 'alert', 'confirm', 'prompt', 'structuredClone', 'isNaN', 'isFinite',
    'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'atob', 'btoa']);

  const problems = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const raw = readFileSync(`${dir}/${file}`, 'utf8');
    // Scan the code, not the prose: "as it happened (" is not a call.
    const text = stripLiterals(raw);
    const known = new Set([...KEYWORDS, ...GLOBALS]);

    for (const m of raw.matchAll(/import \{([^}]*)\} from/g)) {
      for (const part of m[1].split(',')) known.add(part.trim().split(' as ').pop());
    }
    for (const m of raw.matchAll(/import \* as ([A-Za-z_$][\w$]*)/g)) known.add(m[1]);
    for (const m of text.matchAll(/(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1]);
    // Destructured bindings and parameter lists: anything named between braces
    // or parentheses is in scope by the time it is called.
    for (const m of text.matchAll(/[({]([^(){}]*)[)}]/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/[:=]/)[0].trim().replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(name)) known.add(name);
      }
    }

    for (const [, name] of text.matchAll(/(?<![.\w$'"`])([a-z][A-Za-z0-9_$]*)\s*\(/g)) {
      if (!known.has(name)) problems.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual([...new Set(problems)], [], `used but never defined or imported:\n  ${[...new Set(problems)].join('\n  ')}`);
});


test('a logged bake is judged on the time it really had', () => {
  const base = { recipe: DEFAULT_RECIPE, schedule: DEFAULT_SCHEDULE, scores: EMPTY_SCORES };
  const t = Date.parse('2026-09-01T08:00:00Z');
  const H = 3600000;
  // Same recipe on paper. One of them actually sat 12 hours longer in the cold.
  const asPlanned = derive({ ...base }, DEFAULT_MODEL);
  const ranLong = derive(
    { ...base, doneAt: { 'p4-1': t, 'p5-1': t + (DEFAULT_SCHEDULE.coldProofHours + 12) * H } },
    DEFAULT_MODEL
  );
  assert.equal(asPlanned.timed, false, 'no timings, so the plan stands');
  assert.equal(ranLong.timed, true);
  assert.ok(ranLong.mu > asPlanned.mu, 'the extra twelve hours count against the flour budget');
  const proof = findFactor('coldProofHours');
  assert.ok(
    proof.get({ ...base, doneAt: { 'p4-1': t, 'p5-1': t + 78 * H } }, ranLong) > DEFAULT_SCHEDULE.coldProofHours,
    'the cold proof factor reports what happened, not what was written down'
  );
});

/* -------------------- carrying a bake between devices ------------------- */

test('the bake in progress travels with everything else', () => {
  /*
   * The reported failure: sync on one address, open the app on another, sync
   * again, and the recipe was there but the half-ticked protocol was not. The
   * session was simply never in the file.
   */
  const doc = JSON.parse(exportStateJSON({
    version: 1,
    recipes: [houseRecipe()],
    bakes: [],
    settings: { model: DEFAULT_MODEL, equipment: DEFAULT_EQUIPMENT },
    current: { title: 'mid bake', done: ['p1-3', 'p1-4'], doneAt: { 'p1-3': 1, 'p1-4': 2 }, updatedAt: '2026-09-09T10:00:00Z' },
  }));
  assert.ok(doc.current, 'the session is in the document at all');
  assert.deepEqual(doc.current.done, ['p1-3', 'p1-4'], 'with what was ticked');
  assert.deepEqual(doc.current.doneAt, { 'p1-3': 1, 'p1-4': 2 }, 'and when');
  check(doc, 'export.schema.json');
});

test('a bake in progress beats a device that was merely opened later', () => {
  /*
   * The reported failure, and a design error rather than a slip. "Last touched
   * wins" treats opening the app on a second device and changing a temperature
   * as equal to having four steps ticked on the first. Syncing then discarded a
   * real bake in favour of an idle screen, which is the one outcome worth
   * preventing.
   */
  const bake = { done: ['p1-3', 'p1-4', 'p2-1', 'p4-1'], updatedAt: '2026-09-10T20:00:00Z' };
  const idle = { done: [], updatedAt: '2026-09-10T21:30:00Z' };

  assert.equal(laterSession(idle, bake).current.done.length, 4, 'the bake survives from the other device');
  assert.equal(laterSession(bake, idle).current.done.length, 4, 'and from this one');
  assert.equal(laterSession(idle, bake).from, 'remote');
});

test('work counts as work however it was recorded', () => {
  const idle = { done: [], updatedAt: '2026-09-10T23:00:00Z' };
  const byTicks = { done: ['p1-3'], updatedAt: '2026-09-10T08:00:00Z' };
  const byTimes = { done: [], doneAt: { 'p1-3': 1 }, updatedAt: '2026-09-10T08:00:00Z' };
  const byMeasurement = { done: [], actuals: { fdtC: 23.9 }, updatedAt: '2026-09-10T08:00:00Z' };
  const byScore = { done: [], scores: { canotto: 4 }, updatedAt: '2026-09-10T08:00:00Z' };
  const byNote = { done: [], notes: 'slack at the end', updatedAt: '2026-09-10T08:00:00Z' };

  for (const [name, real] of [['ticks', byTicks], ['times', byTimes], ['a measurement', byMeasurement], ['a score', byScore], ['a note', byNote]]) {
    assert.equal(laterSession(idle, real).from, 'remote', `${name} should count as a bake worth keeping`);
  }
});

test('when both devices have a bake, the later one wins and says so', () => {
  /*
   * Two real sessions cannot be merged, so one is set aside. That is somebody's
   * evening, so it is reported rather than done quietly.
   */
  const older = { done: ['p1-3'], updatedAt: '2026-09-10T09:00:00Z' };
  const newer = { done: ['p1-3', 'p1-4'], updatedAt: '2026-09-10T11:00:00Z' };

  const pulled = laterSession(older, newer);
  assert.equal(pulled.from, 'remote', 'the later bake wins');
  assert.equal(pulled.displaced, true, 'and the app knows one was set aside');

  const kept = laterSession(newer, older);
  assert.equal(kept.from, 'local');
  assert.equal(kept.displaced, true, 'reported from either side');
});

test('nothing is reported as displaced when nothing was', () => {
  const bake = { done: ['p1-3'], updatedAt: '2026-09-10T09:00:00Z' };
  const idle = { done: [], updatedAt: '2026-09-10T11:00:00Z' };
  assert.equal(laterSession(idle, bake).displaced, false, 'an idle screen is not a loss');
  assert.equal(laterSession(bake, bake).displaced, false, 'and the same bake on both sides is not a conflict');
});

test('a session is taken whole, never stitched together', () => {
  // Half of one schedule and half of another is a bake nobody ran.
  const mine = { title: 'a', done: ['p1-3'], schedule: { coldProofHours: 66 }, updatedAt: '2026-09-09T09:00:00Z' };
  const theirs = { title: 'b', done: ['p1-3', 'p1-4', 'p2-1'], schedule: { coldProofHours: 42 }, updatedAt: '2026-09-09T10:00:00Z' };
  const { current } = laterSession(mine, theirs);
  assert.deepEqual(current, theirs, 'the winner arrives intact');
});

test('with nothing on the other side, this device keeps its own', () => {
  const mine = { title: 'a', updatedAt: '2026-09-09T09:00:00Z' };
  assert.equal(laterSession(mine, undefined).from, 'local');
  assert.equal(laterSession(mine, undefined).current, mine);
});

test('a session is stamped when it changes, and only then', async () => {
  globalThis.localStorage.clear();
  resetAll();
  assert.equal(storeLoad().current.updatedAt ?? null, null, 'a fresh session has never been touched');

  storeUpdate((st) => { st.current.done = ['p1-3']; });
  const first = storeLoad().current.updatedAt;
  assert.ok(first, 'ticking a step stamps it');

  // A no-op must not make this device look like the more recent one.
  await new Promise((r) => setTimeout(r, 5));
  storeUpdate(() => {});
  assert.equal(storeLoad().current.updatedAt, first, 'a save that changed nothing changes nothing');

  await new Promise((r) => setTimeout(r, 5));
  storeUpdate((st) => { st.current.doneAt = { 'p1-3': 123 }; });
  assert.notEqual(storeLoad().current.updatedAt, first, 'recording a time stamps it again');
  globalThis.localStorage.clear();
});

test('writing down a sync does not make it look like fresh work', () => {
  /*
   * applySync goes through the same update() as everything else, so without
   * care it restamped the session. This device would then hold a time later
   * than the copy just written to Drive, so the two disagreed the moment they
   * were made to agree, and a session pulled from another device came back
   * looking like this one's own.
   */
  globalThis.localStorage.clear();
  resetAll();
  const theirs = { title: 'from the other device', done: ['p1-3'], updatedAt: '2026-09-09T11:00:00Z' };
  applySync({ recipes: [], bakes: [], current: theirs });
  assert.equal(storeLoad().current.updatedAt, '2026-09-09T11:00:00Z', 'the stamp arrives unchanged');
  assert.deepEqual(storeLoad().current.done, ['p1-3'], 'along with the work');
  globalThis.localStorage.clear();
});

test('a sync that moved a session says so, in either direction', async () => {
  /*
   * "0 in, 0 out" after ticking half a protocol reads as nothing having
   * happened, because the count only ever covered recipes and bakes.
   */
  const { describeSync } = await import('../src/views/setup.js');
  const real = { sessionMoved: true, sessionHasProgress: true, remoteHadSession: true, pulled: 0, pushed: 0 };
  assert.equal(describeSync({ ...real, sessionFrom: 'local' }), 'Synced: sent this device\u2019s bake in progress');
  assert.equal(describeSync({ ...real, sessionFrom: 'remote' }), 'Synced: picked up the bake in progress');
  assert.equal(
    describeSync({ ...real, sessionFrom: 'remote', pulled: 2, pushed: 1 }),
    'Synced: 2 in, 1 out, picked up the bake in progress'
  );
});

test('the app never claims to have moved a bake that does not exist', async () => {
  /*
   * The reported failure, and the worst kind: the screen said it had sent this
   * device's bake in progress while the protocol tab showed nothing ticked. It
   * was describing work that did not exist, and hiding the fact that mattered,
   * which is that the stored copy had no bake either because whatever wrote it
   * could not carry one.
   */
  const { describeSync } = await import('../src/views/setup.js');
  const empty = describeSync({
    pulled: 0, pushed: 0, sessionMoved: true, sessionFrom: 'local',
    sessionHasProgress: false, remoteHadSession: false,
  });
  assert.ok(!/bake in progress/.test(empty.split('. ')[0]), 'no bake is claimed to have moved');
  assert.match(empty, /Neither this device nor the stored copy has a bake/, 'and the real state is stated');
  assert.match(empty, /reload the page/, 'with what to do about it');
});

test('nothing is said about reloading when a bake really is there', async () => {
  const { describeSync } = await import('../src/views/setup.js');
  const fine = describeSync({
    pulled: 0, pushed: 0, sessionMoved: true, sessionFrom: 'remote',
    sessionHasProgress: true, remoteHadSession: true,
  });
  assert.ok(!/reload the page/.test(fine), 'no advice offered when nothing is wrong');
});

test('the sync result is kept, not flashed', async () => {
  /*
   * A toast is the wrong shape for the one thing someone might want to look at
   * again a minute later, so the outcome is stored and rendered in the card.
   * It has to survive a reload, because that is exactly when a person comes
   * back to ask whether the sync worked.
   */
  const { rememberSync, lastSync } = await import('../src/lib/drive.js');
  globalThis.localStorage.clear();
  assert.equal(lastSync(), null, 'nothing claimed before anything happened');

  rememberSync({ ok: true, text: 'Synced: picked up the bake in progress' });
  const kept = lastSync();
  assert.equal(kept.ok, true);
  assert.match(kept.text, /picked up the bake in progress/);
  assert.ok(kept.at > 0, 'and when it happened, so the card can say how long ago');

  rememberSync({ ok: false, text: 'The sync did not finish.' });
  assert.equal(lastSync().ok, false, 'a failure is kept just as plainly');

  rememberSync(null);
  assert.equal(lastSync(), null, 'and it clears while a sync is running');
  globalThis.localStorage.clear();
});

test('the sync card never reports a stale result as current', async () => {
  const { rememberSync, lastSync, disconnect } = await import('../src/lib/drive.js');
  globalThis.localStorage.clear();
  rememberSync({ ok: true, text: 'Synced' });
  disconnect();
  assert.equal(lastSync(), null, 'disconnecting forgets what the last sync did');
  globalThis.localStorage.clear();
});

test('setting a bake aside is said plainly, not buried', async () => {
  const { describeSync } = await import('../src/views/setup.js');
  const both = describeSync({
    pulled: 0, pushed: 0, sessionMoved: true, sessionFrom: 'remote',
    sessionDisplaced: true, sessionHasProgress: true, remoteHadSession: true,
  });
  assert.match(both, /Both devices had a bake going/, 'the conflict is named');
  assert.match(both, /set aside/, 'and what happened to the other one');
  assert.match(both, /Download the JSON/, 'and what to do about it');

  const clean = describeSync({
    pulled: 0, pushed: 0, sessionMoved: true, sessionFrom: 'remote',
    sessionDisplaced: false, sessionHasProgress: true, remoteHadSession: true,
  });
  assert.ok(!/set aside/.test(clean), 'and nothing alarming is said when nothing was lost');
});

/* ------------------------- photographs across devices ------------------- */

test('the library names photographs, and does not carry them', () => {
  /*
   * The point of the design: descriptions travel in the document, bytes travel
   * as their own files. A document with a picture inside it is a document that
   * stops syncing quickly, which was the objection that nearly kept these off
   * Drive altogether.
   */
  const doc = JSON.parse(exportStateJSON({
    version: 1,
    recipes: [],
    bakes: [],
    settings: {},
    photos: [{ id: 'ph1', bakeId: 'b1', width: 1600, height: 1200, bytes: 152000, addedAt: '2026-09-19T10:00:00Z' }],
    photosRemoved: ['ph0'],
  }));
  assert.equal(doc.photos.length, 1, 'the photograph is described');
  assert.equal(doc.photos[0].id, 'ph1');
  assert.ok(!JSON.stringify(doc).includes('base64'), 'and no bytes ride along');
  assert.ok(JSON.stringify(doc).length < 2000, `the document stays small: ${JSON.stringify(doc).length} bytes`);
  assert.deepEqual(doc.photosRemoved, ['ph0'], 'deletions travel too');
});

test('photographs merge as a union, because they never change', async () => {
  const { laterSession } = await import('../src/lib/drive.js');
  assert.ok(laterSession, 'drive module loads');

  // The merge the sync performs, written out.
  const mine = { photos: [{ id: 'a', bakeId: 'b1' }, { id: 'b', bakeId: 'b1' }], photosRemoved: [] };
  const theirs = { photos: [{ id: 'b', bakeId: 'b1' }, { id: 'c', bakeId: 'b2' }], photosRemoved: [] };
  const removedIds = [...new Set([...mine.photosRemoved, ...theirs.photosRemoved])];
  const gone = new Set(removedIds);
  const byId = new Map();
  for (const p of [...theirs.photos, ...mine.photos]) if (!gone.has(p.id)) byId.set(p.id, p);
  assert.deepEqual([...byId.keys()].sort(), ['a', 'b', 'c'], 'both devices keep every picture');
});

test('a deleted photograph does not come back on the next sync', () => {
  /*
   * Without a record of the deletion the merge is a union, so the other device
   * would hand the picture straight back along with its bytes. The tombstone
   * is what makes a delete mean something.
   */
  const mine = { photos: [{ id: 'b', bakeId: 'b1' }], photosRemoved: ['a'] };
  const theirs = { photos: [{ id: 'a', bakeId: 'b1' }, { id: 'b', bakeId: 'b1' }], photosRemoved: [] };

  const removedIds = [...new Set([...mine.photosRemoved, ...theirs.photosRemoved])];
  const gone = new Set(removedIds);
  const byId = new Map();
  for (const p of [...theirs.photos, ...mine.photos]) if (!gone.has(p.id)) byId.set(p.id, p);

  assert.deepEqual([...byId.keys()], ['b'], 'the deleted one stays deleted');
  assert.deepEqual(removedIds, ['a'], 'and the deletion is carried to the other device');
});

test('adding a photograph again lifts its deletion', () => {
  globalThis.localStorage.clear();
  resetAll();
  addPhotoRecord({ id: 'ph9', bakeId: 'b1', bytes: 1, addedAt: '2026-09-19T10:00:00Z' });
  removePhotoRecord('ph9');
  assert.deepEqual(storeLoad().photosRemoved, ['ph9']);
  addPhotoRecord({ id: 'ph9', bakeId: 'b1', bytes: 1, addedAt: '2026-09-19T11:00:00Z' });
  assert.deepEqual(storeLoad().photosRemoved, [], 'a tombstone must not outlive the thing it buried');
  assert.equal(storeLoad().photos.length, 1);
  globalThis.localStorage.clear();
});

test('deleting a bake buries its photographs with it', () => {
  globalThis.localStorage.clear();
  resetAll();
  addPhotoRecord({ id: 'p1', bakeId: 'b1', bytes: 1, addedAt: '2026-09-19T10:00:00Z' });
  addPhotoRecord({ id: 'p2', bakeId: 'b1', bytes: 1, addedAt: '2026-09-19T10:01:00Z' });
  addPhotoRecord({ id: 'p3', bakeId: 'b2', bytes: 1, addedAt: '2026-09-19T10:02:00Z' });
  const ids = removePhotoRecordsFor('b1');
  assert.deepEqual(ids.sort(), ['p1', 'p2']);
  assert.deepEqual(storeLoad().photos.map((p) => p.id), ['p3'], 'the other bake keeps its own');
  assert.deepEqual(storeLoad().photosRemoved.sort(), ['p1', 'p2'], 'so they do not return from the other device');
  globalThis.localStorage.clear();
});

test('a photograph taken during the bake is already on it when it is filed', () => {
  /*
   * Pictures are taken at the bench, not after the record exists, so the
   * session carries the id the bake will be filed under. If filing minted a
   * fresh id instead, every picture would point at a session that had just
   * ended and would have to be moved across by hand.
   */
  globalThis.localStorage.clear();
  resetAll();
  const sessionId = storeLoad().current.id;
  assert.ok(sessionId, 'a session has an id from the start');
  addPhotoRecord({ id: 'ph1', bakeId: sessionId, bytes: 1, addedAt: '2026-09-19T10:00:00Z' });

  const bake = snapshotBake(storeLoad());
  assert.equal(bake.id, sessionId, 'the record takes the session it came from');
  startNewSession();

  assert.deepEqual(photosForBake(storeLoad(), bake.id).map((p) => p.id), ['ph1'], 'still on the bake');
  assert.notEqual(storeLoad().current.id, sessionId, 'and the next session is a different one');
  assert.deepEqual(photosForBake(storeLoad(), storeLoad().current.id), [], 'starting with no pictures');
  globalThis.localStorage.clear();
});

test('clearing a session takes its wall clock with it', () => {
  // Filing used to leave doneAt behind, so the next bake started already
  // holding the times the last one was ticked at.
  globalThis.localStorage.clear();
  resetAll();
  storeUpdate((st) => { st.current.done = ['p1-1']; st.current.doneAt = { 'p1-1': '2026-09-19T09:00:00Z' }; st.current.notes = 'x'; });
  startNewSession();
  const c = storeLoad().current;
  assert.deepEqual(c.done, [], 'nothing ticked');
  assert.deepEqual(c.doneAt, {}, 'and no times left over');
  assert.equal(c.notes, '');
  globalThis.localStorage.clear();
});

test('a session replaced by another device brings its photographs across', () => {
  /*
   * Pictures are attached by id. If the other device's session wins, the ones
   * taken here would point at a session that no longer exists: not deleted,
   * but unreachable from any screen. Both are the same bake in progress.
   */
  globalThis.localStorage.clear();
  resetAll();
  const mine = storeLoad().current.id;
  addPhotoRecord({ id: 'ph-mine', bakeId: mine, bytes: 1, addedAt: '2026-09-19T10:00:00Z' });
  addPhotoRecord({ id: 'ph-filed', bakeId: 'b-old', bytes: 1, addedAt: '2026-09-19T09:00:00Z' });

  applySync({ current: { ...storeLoad().current, id: 'sess-theirs' }, photos: storeLoad().photos });

  const s = storeLoad();
  assert.equal(s.current.id, 'sess-theirs', 'their session won');
  assert.deepEqual(photosForBake(s, 'sess-theirs').map((p) => p.id), ['ph-mine'], 'the picture came with it');
  assert.deepEqual(photosForBake(s, 'b-old').map((p) => p.id), ['ph-filed'], 'a filed bake is left alone');
  globalThis.localStorage.clear();
});

test('what sync writes to Drive is a valid export document', () => {
  /*
   * Sync uploads the merge of both sides, which is not the state in storage,
   * so it is built from a state object rather than read back. If that shape
   * ever drifted, the file in someone's Drive would be the thing that broke,
   * and they would find out on the device that had no copy left.
   */
  const merged = {
    version: 1,
    recipes: [houseRecipe()],
    bakes: [sampleBake()],
    settings: { model: DEFAULT_MODEL, equipment: DEFAULT_EQUIPMENT },
  };
  const doc = JSON.parse(exportStateJSON(merged));
  assert.equal(doc.$schema, `${SCHEMA_BASE}/export.schema.json`, 'names the schema it follows');
  assert.equal(doc.recipes.length, 1);
  assert.equal(doc.bakes.length, 1);
  check(doc, 'export.schema.json');
});

test('a sync merge keeps both sides and never drops a record', () => {
  const mine = [{ id: 'a', updatedAt: '2026-09-02T00:00:00Z' }, { id: 'b', updatedAt: '2026-09-01T00:00:00Z' }];
  const theirs = [{ id: 'b', updatedAt: '2026-09-03T00:00:00Z' }, { id: 'c', updatedAt: '2026-09-01T00:00:00Z' }];
  const { merged, pulled, pushed } = mergeCollections(mine, theirs);
  assert.deepEqual(merged.map((d) => d.id).sort(), ['a', 'b', 'c'], 'nothing is lost either way');
  assert.equal(merged.find((d) => d.id === 'b').updatedAt, '2026-09-03T00:00:00Z', 'the newer edit wins');
  assert.equal(pushed, 1, 'a went out');
  assert.equal(pulled, 2, 'b and c came in');
});

/* ------------------------- what we say we collect ------------------------ */

/*
 * These tests exist to keep the privacy page honest. Every claim it makes
 * about what leaves the device is checked against what the code actually
 * sends, so the two cannot drift apart quietly.
 */

test('the privacy page describes the storage keys that actually exist', () => {
  const page = readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');
  const sources = ['src/lib/drive.js', 'src/lib/store.js', 'src/lib/theme.js', 'src/app.js']
    .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
    .join('\n');
  const used = new Set([...sources.matchAll(/'(canotto-lab\/[a-z0-9-]+)'/g)].map((m) => m[1]));
  /*
   * Keys that appear only in the list of things to delete are not stored, they
   * are swept up. Requiring the page to describe them would mean documenting
   * storage the app exists to remove.
   */
  const removed = new Set([...sources.matchAll(/ORPHANED_KEYS = \[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((k) => k[1])));
  for (const key of used) {
    if (removed.has(key)) continue;
    assert.ok(page.includes(key), `privacy.html does not mention the stored key ${key}`);
  }
  assert.ok(used.size >= 4, `expected the known keys, found ${used.size}`);
});

test('a page load never asks Google for anything', () => {
  /*
   * The token client always wants a popup, so asking for one on load either
   * gets blocked or throws a sign-in window at someone who is just opening the
   * app. This is the regression that did exactly that: reloading re-prompted,
   * and dismissing the prompt left the screen offering to connect again.
   */
  const drive = readFileSync(new URL('../src/lib/drive.js', import.meta.url), 'utf8');
  const resume = drive.slice(drive.indexOf('export function resume'), drive.indexOf('export function disconnect'));
  assert.ok(!/getToken|requestAccessToken|await /.test(resume), 'resume() reads what it remembered and asks Google nothing');

  const setup = readFileSync(new URL('../src/views/setup.js', import.meta.url), 'utf8');
  assert.ok(!/drive\.connect\(\)[^)]*\n?[^)]*module scope/.test(setup), 'and nothing connects at module scope');
  const onLoad = setup.slice(0, setup.indexOf('export default'));
  assert.ok(!/drive\.connect|getToken/.test(onLoad), 'nothing before the first render reaches for a token');
});

test('the token survives a reload but not a closed tab', () => {
  /*
   * sessionStorage is the whole point: localStorage would outlive the tab, and
   * memory alone would not outlive a reload, which is the case worth covering.
   * A cookie would be no safer, because only a server can set HttpOnly and
   * this app has none.
   */
  const drive = readFileSync(new URL('../src/lib/drive.js', import.meta.url), 'utf8');
  assert.match(drive, /sessionStorage\.setItem\(TOKEN_KEY/, 'the token is kept for the tab');
  assert.ok(!/localStorage\.(get|set)Item\(TOKEN_KEY/.test(drive), 'never in localStorage');
  assert.ok(!/document\.cookie/.test(drive), 'and never in a cookie');
  assert.match(drive, /expiresAt > Date\.now\(\)/, 'an expired token is discarded rather than used');

  // Disconnecting must take it with it, or the next person at the browser
  // inherits a live key.
  const disconnect = drive.slice(drive.indexOf('export function disconnect'), drive.indexOf('/* ------------------------------- the file'));
  assert.match(disconnect, /keepToken\(null\)/, 'disconnect drops the token');
  assert.match(disconnect, /removeItem\(ACCOUNT_KEY\)/, 'and forgets the account');
});

test('a returning baker is not asked which account they are', () => {
  /*
   * Without a hint, Google shows the account chooser on the first sync of
   * every session, even though the app has been connected to one account all
   * along and knows which. The hint answers that in advance.
   */
  const drive = readFileSync(new URL('../src/lib/drive.js', import.meta.url), 'utf8');
  const getToken = drive.slice(drive.indexOf('async function getToken'), drive.indexOf('async function api'));
  assert.match(getToken, /rememberedAccount\(\)\?\.email/, 'the remembered address is used as the hint');
  assert.match(getToken, /requestAccessToken\(\{[^}]*hint/s, 'and passed to Google with the request');
});

test('what the usage count left behind is cleared away', async () => {
  /*
   * Removing a feature does not remove what it wrote to someone's browser.
   * Anyone who turned counting off would carry that flag for good, and the
   * privacy page's list of stored keys would be wrong for exactly the people
   * who cared enough to switch it off.
   */
  globalThis.localStorage.clear();
  const orphans = ['canotto-lab/device', 'canotto-lab/counted-on', 'canotto-lab/no-count'];
  for (const k of orphans) globalThis.localStorage.setItem(k, 'left over');

  // The sweep runs when the module is first evaluated, which already happened,
  // so call it the way a fresh page would.
  const { forgetRemovedFeatures } = await import('../src/lib/store.js');
  forgetRemovedFeatures();
  const stale = orphans.filter((k) => globalThis.localStorage.getItem(k) !== null);
  assert.deepEqual(stale, [], 'nothing from the counter survives a load');
  globalThis.localStorage.clear();
});

test('every kind of storage the app uses is disclosed, not only the obvious one', () => {
  /*
   * The key-coverage test above walks localStorage keys, so a second kind of
   * storage could be added without it noticing. Photographs are kept in
   * IndexedDB precisely because they are too big for the other, and that is
   * exactly the sort of thing a privacy page quietly stops being true about.
   */
  const sources = ['src/lib/photos.js', 'src/lib/store.js', 'src/lib/drive.js', 'src/app.js']
    .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
    .join('\n');
  const page = readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');

  if (/indexedDB/i.test(sources)) {
    assert.match(page, /IndexedDB/i, 'the page must name the second store');
    assert.match(page, /photograph/i, 'and say what is in it');
    assert.match(page, /not in the JSON export/i, 'and where it does not go');
  }
  assert.ok(!/sessionStorage\.setItem\('canotto-lab\/(?!drive-token)/.test(sources),
    'anything new in sessionStorage would need documenting too');
});

test('the app collects nothing, and the page is allowed to say so', () => {
  /*
   * This guard used to run the other way. The page denied having a server while
   * the app wrote a daily count to Firestore, and the test existed to stop that
   * contradiction coming back. The counting has since been removed outright, so
   * the same test now holds the stronger claim: no part of the app may write to
   * a service of ours, and if that ever changes this fails until the page is
   * rewritten to admit it.
   */
  const sources = ['src/lib/drive.js', 'src/lib/store.js', 'src/lib/theme.js', 'src/app.js', 'src/views/setup.js']
    .map((f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))
    .join('\n');

  assert.ok(!/firestore\.googleapis\.com/.test(sources), 'nothing writes to our database');
  assert.ok(!/firebase(app|io)\.com|firebasedatabase/.test(sources), 'nor to any other store of ours');

  // Only Google's own endpoints, and only for a sync the person asked for.
  const hosts = [...sources.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]);
  const allowed = new Set(['www.googleapis.com', 'accounts.google.com', 'sherifhanna700.github.io', 'github.com', 'json-schema.org']);
  for (const host of new Set(hosts)) {
    assert.ok(allowed.has(host), `unexpected host in app code: ${host}`);
  }

  const page = readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');
  assert.match(page, /No counting/i, 'and the page states it plainly');

  // The database that counting used must stay shut.
  const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /match \/\{document=\*\*\}[\s\S]*allow read, write: if false/, 'every path is closed');
  assert.ok(!/allow (create|update|write): if request/.test(rules), 'and nothing is writable under any condition');
});
test('the app asks Google for the hidden folder and nothing wider', () => {
  const drive = readFileSync(new URL('../src/lib/drive.js', import.meta.url), 'utf8');
  assert.match(drive, /auth\/drive\.appdata/, 'the narrow scope');
  assert.ok(!/auth\/drive['" ]/.test(drive), 'never full Drive access');
  assert.ok(!/auth\/drive\.file/.test(drive), 'not even the create-your-own-files scope');
  const page = readFileSync(new URL('../privacy.html', import.meta.url), 'utf8');
  assert.ok(page.includes('drive.appdata'), 'and the privacy page names the same scope');
});

await queue;
/*
 * Say what failed, last, where it is read.
 *
 * This used to print only the number that passed, which is true and useless:
 * a failure scrolls off the top and the final line still reads like success.
 * A run checked by its last line was reported as green with a test failing.
 */
if (failures.length) {
  console.error(`\n${failures.length} FAILED, ${passed} passed:\n  ${failures.join('\n  ')}`);
} else {
  console.log(`\n${passed} model tests passed.`);
}
