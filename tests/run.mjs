// Model tests. Run with `npm test`. No framework: assertions and a counter.

import assert from 'node:assert/strict';
import { computeRecipe, allocateFlours, convertYeast, DEFAULT_RECIPE, effectiveYeastPct } from '../src/model/dough.js';
import { blendStats, hydrationRangeForW, estimateW, fuCeilingForW, bandForW, FLOURS } from '../src/model/flours.js';
import { rateAt, fermentUnits, yeastForFU, ripeness, ripenessVerdict, waterTempFor, calibrateK, DEFAULT_MODEL } from '../src/model/ferment.js';
import { solveSchedule, scheduleStages, STEPS, activeSteps, DEFAULT_SCHEDULE } from '../src/model/protocol.js';
import { suggestPlan, reviewPlan, defaultLeadHours, strengthBand } from '../src/model/advisor.js';
import { recipeFromBlend, overallScore, recipeRating, starterRecipes } from '../src/model/recipes.js';
import { bakeStages, ovenLabel, mixerLabel, mixerPhrasing, findMixer, OVENS, MIXERS } from '../src/model/equipment.js';
import { diagnose } from '../src/model/diagnostics.js';
import { mergeCollections } from '../src/lib/cloud.js';
import { cToF, fToC, deltaToDisplay, deltaFromDisplay } from '../src/model/units.js';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tolerance ${tol})`);

/* ------------------------------- dough ---------------------------------- */

test('total dough matches balls times ball weight', () => {
  const c = computeRecipe({ balls: 8, ballWeight: 275, wastePct: 0 });
  assert.equal(c.totalDough, 2200);
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

test('the house schedule lands in the ripeness window at its own inoculation', () => {
  const stages = scheduleStages(DEFAULT_SCHEDULE);
  const r = ripeness(stages, 0.1);
  near(r, 1, 0.1, 'house protocol ripeness');
  assert.equal(ripenessVerdict(r).key, 'on');
});

test('a colder fridge needs more time for the same fermentation', () => {
  const warm = fermentUnits([{ hours: 48, tempC: 6 }]);
  const cold = fermentUnits([{ hours: 48, tempC: 1 }]);
  assert.ok(warm > cold, 'warmer fridge ferments further in the same time');
});

test('required yeast falls as the schedule lengthens', () => {
  assert.ok(yeastForFU(40) < yeastForFU(10));
});

test('water temperature solver uses three or four factors as appropriate', () => {
  near(waterTempFor({ ddtC: 24, flourTempC: 20, roomTempC: 20, frictionC: 8 }), 24 * 3 - 48, 1e-9, 'three factor');
  near(waterTempFor({ ddtC: 24, flourTempC: 20, roomTempC: 20, frictionC: 8, prefermentTempC: 4 }), 24 * 4 - 52, 1e-9, 'four factor');
});

test('calibration takes the median of the samples', () => {
  near(calibrateK([{ fu: 10, idyPct: 0.2 }, { fu: 20, idyPct: 0.2 }, { fu: 30, idyPct: 0.2 }]), 4, 1e-9, 'median K');
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

test('the shipped starters all compute without warnings about the blend', () => {
  for (const r of starterRecipes()) {
    const c = computeRecipe(r.recipe);
    assert.ok(c.flour > 0, `${r.name} has no flour`);
    assert.ok(!c.warnings.some((w) => w.includes('add up')), `${r.name}: ${c.warnings.join('; ')}`);
  }
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

test('temperature conversion round-trips', () => {
  near(fToC(cToF(3)), 3, 1e-9, 'round trip');
  near(cToF(2.8), 37, 0.1, 'the default fridge is 37 F');
});

test('a temperature difference scales without the freezing offset', () => {
  near(deltaToDisplay(9, 'F'), 16.2, 0.01, '9 C of friction is 16.2 F, not 48');
  near(deltaFromDisplay(deltaToDisplay(9, 'F'), 'F'), 9, 1e-9, 'round trip');
  assert.equal(deltaToDisplay(9, 'C'), 9, 'no change in Celsius');
});

console.log(`\n${passed} model tests passed.`);
