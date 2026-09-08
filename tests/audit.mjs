/*
 * Sanity audit.
 *
 * The unit tests check that the maths does what it was written to do. This
 * checks that what it does could be true at all, across the range of doughs
 * someone might actually build: no negative water, no step scheduled after the
 * bake, no weights that fail to sum to the batch, no advice that cannot be
 * followed.
 *
 * It exists because the three-factor water rule was arithmetically faithful to
 * the textbook and physically nonsense for this dough, recommending 39 C water
 * for a mix that would land three degrees below target. Every check that could
 * catch that class of fault verifies the answer independently rather than
 * asking the same function twice.
 *
 * Run with: npm run audit
 */
import { computeRecipe } from '../src/model/dough.js';
import { DEFAULT_SCHEDULE, scheduleStages, solveSchedule, STEPS } from '../src/model/protocol.js';
import { fermentUnits, ripeness, yeastForFU, mixWater, rateAt } from '../src/model/ferment.js';
import { suggestPlan } from '../src/model/advisor.js';
import { blendStats, FLOURS } from '../src/model/flours.js';
import { cToF } from '../src/model/units.js';

const problems = [];
const flag = (where, what) => problems.push(`${where}: ${what}`);

const hydrations = [58, 65, 70, 75, 82];
const balls = [1, 4, 8, 24];
const proofs = [6, 24, 42, 66, 96];
const fridges = [0, 2.8, 6, 10];
const rooms = [16, 21.1, 27];
const prefFlour = [40, 70, 100];

for (const hydrationPct of hydrations)
for (const b of balls)
for (const prefermentFlourPct of prefFlour) {
  const c = computeRecipe({ hydrationPct, balls: b, prefermentFlourPct });
  const w = c.weigh;
  const where = `hyd ${hydrationPct}, ${b} balls, biga ${prefermentFlourPct}%`;

  if (w.flour.total <= 0) flag(where, 'no flour');
  if (Math.abs(w.flour.biga + w.flour.final - w.flour.total) > 0.51) flag(where, 'flour columns do not add up');
  if (Math.abs(w.water.biga + w.water.final - w.water.total) > 0.51) flag(where, 'water columns do not add up');
  if (w.water.final < 0) flag(where, `negative water in the final mix (${w.water.final} g)`);
  if (w.water.bassinage < 0 || w.water.saltWash < 0) flag(where, 'negative bassinage or salt wash');
  if (w.water.doses.some((d) => d < 0)) flag(where, 'negative dose');
  const total = w.flour.total + w.water.total + w.salt + w.oil + w.yeast.total;
  if (Math.abs(total - c.totalDough) > 2) flag(where, `weights sum to ${total.toFixed(0)} g, batch is ${c.totalDough} g`);
}

for (const coldProofHours of proofs)
for (const fridgeTempC of fridges)
for (const roomTempC of rooms) {
  const S = { ...DEFAULT_SCHEDULE, coldProofHours, fridgeTempC, roomTempC, bigaRoomTempC: roomTempC };
  const where = `${coldProofHours} h at ${Math.round(cToF(fridgeTempC))} F, room ${Math.round(cToF(roomTempC))} F`;
  const fu = fermentUnits(scheduleStages(S));
  if (!(fu > 0)) flag(where, `fermentation units ${fu}`);
  const need = yeastForFU(fu);
  if (!(need > 0) || need > 10) flag(where, `needs ${need.toFixed(2)}% yeast`);
  const sched = solveSchedule(S);
  if (!(sched.totalMin > 0)) flag(where, 'lead time is not positive');
  for (const [id, at] of Object.entries(sched.at)) {
    if (at > 0) flag(where, `step ${id} is scheduled after the launch`);
  }
  const order = ['p1-1','p1-2','p1-3','p1-4','p2-1','p2-4','p3-1','p3-4','p4-1','p5-1','p5-2','p5-4'];
  for (let i = 1; i < order.length; i += 1) {
    if (sched.at[order[i]] < sched.at[order[i - 1]]) flag(where, `${order[i]} happens before ${order[i - 1]}`);
  }
}

// Mix water across the same range
for (const fridgeTempC of fridges)
for (const roomTempC of rooms)
for (const prefermentFlourPct of prefFlour) {
  const c = computeRecipe({ prefermentFlourPct });
  const r = mixWater({ weigh: c.weigh, prefermentTempC: fridgeTempC, flourTempC: roomTempC, frictionC: 9, ddtC: 23.3 });
  const where = `mix water, biga ${prefermentFlourPct}% at ${Math.round(cToF(fridgeTempC))} F, flour ${Math.round(cToF(roomTempC))} F`;
  if (!Number.isFinite(r.useC)) flag(where, 'water temperature is not a number');
  if (r.useC < 0 || r.useC > 45) flag(where, `recommends water at ${r.useC.toFixed(1)} C`);
  if (r.reachable && Math.abs(r.landsAtC - 23.3) > 0.2) flag(where, `claims reachable but lands at ${r.landsAtC.toFixed(1)} C`);

  /*
   * Verify the recommendation independently, from first principles, rather
   * than trusting the same function that produced it. This is the check that
   * would have caught the three-factor rule recommending 39 C for a dough that
   * lands nowhere near the target.
   */
  const lands = landingTemp(c.weigh, fridgeTempC, roomTempC, 9, r.useC);
  if (Math.abs(lands - r.landsAtC) > 0.05) flag(where, `says the dough lands at ${r.landsAtC.toFixed(1)} C, independent balance says ${lands.toFixed(1)} C`);
  if (r.reachable && Math.abs(lands - 23.3) > 0.2) flag(where, `recommends ${r.useC.toFixed(1)} C water for a ${(23.3).toFixed(1)} C target, which actually lands at ${lands.toFixed(1)} C`);
}

/** An independent heat balance, written out longhand on purpose. */
function landingTemp(w, bigaC, flourC, frictionC, waterC) {
  const CW = 4.18, CF = 1.8, CO = 2.0;
  const parts = [
    [w.flour.biga * CF, bigaC],
    [w.water.biga * CW, bigaC],
    [w.flour.final * CF, flourC],
    [(w.salt + w.oil) * CO, flourC],
    [w.water.final * CW, waterC],
  ];
  const cap = parts.reduce((a, [c]) => a + c, 0);
  const heat = parts.reduce((a, [c, t]) => a + c * t, 0);
  return heat / cap + frictionC;
}

// Every flour, through the advisor
for (const f of FLOURS) {
  const flours = [{ id: f.id, pct: 100 }];
  const blend = blendStats(flours);
  const plan = suggestPlan(blend, { flours });
  const where = `advisor: ${f.brand} ${f.name}`;
  if (!(plan.idyPct > 0) || plan.idyPct > 5) flag(where, `suggests ${plan.idyPct.toFixed(3)}% yeast`);
  if (plan.hydration && (plan.hydration.recommended < 45 || plan.hydration.recommended > 95)) flag(where, `suggests ${plan.hydration.recommended}% hydration`);
  for (const st of plan.stages) if (st.hours < 0) flag(where, `negative ${st.name}`);
  const built = computeRecipe({ ...plan.recipePatch, flours });
  if (built.weigh.water.final < 0) flag(where, 'its own plan gives negative final mix water');
}

// Step text, across the same spread
for (const hydrationPct of hydrations)
for (const prefermentFlourPct of prefFlour) {
  const c = computeRecipe({ hydrationPct, prefermentFlourPct });
  for (const u of ['C', 'F']) for (const step of STEPS) {
    const ctx = { c, S: DEFAULT_SCHEDULE, u, E: { mixerId: 'spiral', ovenId: 'gas-deck' } };
    const body = step.body(ctx);
    if (/NaN|undefined|Infinity/.test(body + step.title(ctx) + step.badge(ctx))) {
      flag(`step ${step.id} (hyd ${hydrationPct}, biga ${prefermentFlourPct}%, °${u})`, 'text contains NaN or undefined');
    }
    if (/-\d+(\.\d+)? g/.test(body)) flag(`step ${step.id}`, `negative grams: ${body.match(/-\d+(\.\d+)? g/)[0]}`);
  }
}

console.log(problems.length ? `${problems.length} problems:\n  ` + [...new Set(problems)].join('\n  ') : 'no implausible outputs found');
