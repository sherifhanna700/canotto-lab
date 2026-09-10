// What actually happened, as against what the protocol asked for.
//
// A schedule is a plan, and a plan is wrong the moment the biga sits twenty
// minutes longer than intended because the phone rang. For judging a bake
// afterwards, and for deciding what to do about it during, the only numbers
// worth having are the real ones.
//
// So the app records wall clock time whenever a step is checked off, and this
// module turns those marks into phase durations. Absolute timestamps are
// stored, never the gaps between them: a gap cannot be corrected on its own
// without silently moving everything after it, and people do mistype.
//
// Nothing here touches the DOM or the clock directly. The caller passes `now`,
// which is what makes any of it testable.

/**
 * The checkmarks that bound each phase. These are the steps where the dough
 * physically changes place or state, which is why they are the ones worth
 * timing: everything between them is the same dough at the same temperature.
 */
import { DEFAULT_MODEL, maturationRateAt, maturationUnits } from './ferment.js?v=23f40929';

export const PHASE_BOUNDS = [
  { name: 'Biga ambient rest', from: 'p1-3', to: 'p1-4', tempKey: 'bigaRoomTempC', plan: 'bigaRestHours' },
  { name: 'Biga cold hold', from: 'p1-4', to: 'p2-1', tempKey: 'bigaFridgeTempC', plan: 'bigaColdHours' },
  { name: 'Mix & bench', from: 'p2-1', to: 'p4-1', tempKey: 'benchTempC', plan: null },
  { name: 'Cold proof', from: 'p4-1', to: 'p5-1', tempKey: 'fridgeTempC', plan: 'coldProofHours' },
  { name: 'Counter temper', from: 'p5-1', to: 'p5-4', tempKey: 'roomTempC', plan: 'temperHours' },
];

/**
 * The steps whose times bound a phase. Every step is stamped when it is
 * checked off, but only these ten decide how long a phase actually ran.
 */
export const TIMED_STEPS = [...new Set(PHASE_BOUNDS.flatMap((p) => [p.from, p.to]))];

export const HOUR = 3600000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const stamp = (doneAt, id) => num(doneAt?.[id]);

/**
 * Phase durations as they really ran.
 *
 * A phase whose start is marked but not its end is still running, and its
 * duration so far is measured against `now`. That is the number a person
 * standing at the fridge actually wants.
 */
export function actualStages({ doneAt = {}, schedule = {}, planned = [], now = Date.now() }) {
  return PHASE_BOUNDS.map((bound, i) => {
    const fallback = planned[i] || {};
    const started = stamp(doneAt, bound.from);
    const ended = stamp(doneAt, bound.to);
    const tempC = Number.isFinite(schedule[bound.tempKey]) ? schedule[bound.tempKey] : fallback.tempC;

    if (started !== null && ended !== null && ended > started) {
      return { name: bound.name, hours: (ended - started) / HOUR, tempC, state: 'done', started, ended };
    }
    if (started !== null) {
      return { name: bound.name, hours: Math.max(0, (now - started) / HOUR), tempC, state: 'running', started, ended: null };
    }
    return { name: bound.name, hours: fallback.hours ?? 0, tempC, state: 'planned', started: null, ended: null };
  });
}

/** True once anything at all has been timed. */
export function hasTimings(doneAt) {
  return Object.keys(doneAt || {}).some((id) => stamp(doneAt, id) !== null);
}

/**
 * How far each recorded step ran from its planned clock time. Positive is
 * late. The plan comes from solveSchedule, whose offsets are minutes before
 * the launch, so a step's planned instant is launch plus its offset.
 */
export function drifts({ doneAt = {}, at = {}, launchISO }) {
  const launch = new Date(launchISO).getTime();
  if (!Number.isFinite(launch)) return {};
  const out = {};
  for (const id of Object.keys(doneAt)) {
    const actual = stamp(doneAt, id);
    const offset = num(at[id]);
    if (actual === null || offset === null) continue;
    out[id] = actual - (launch + offset * 60000);
  }
  return out;
}

/**
 * The one question a baker running late actually has: is dinner moving, or is
 * the cold proof getting shorter?
 *
 * Given the last thing marked done and the plan for everything after it, this
 * returns the launch time the remaining schedule now implies, and how far that
 * has slipped from the launch originally set.
 */
export function projectedLaunch({ doneAt = {}, at = {}, launchISO }) {
  const launch = new Date(launchISO).getTime();
  if (!Number.isFinite(launch)) return null;

  let last = null;
  for (const id of Object.keys(doneAt)) {
    const t = stamp(doneAt, id);
    const offset = num(at[id]);
    if (t === null || offset === null) continue;
    // The latest mark by plan position, not by the order they were ticked.
    // Every checked step counts, so the projection follows the most recent
    // thing that actually happened rather than the last phase boundary.
    if (!last || offset > last.offset) last = { id, at: t, offset };
  }
  if (!last) return null;

  // Everything after the last mark still takes as long as the protocol says,
  // so the slip at that point carries straight through to the oven.
  const slipMs = last.at - (launch + last.offset * 60000);
  return { from: last.id, slipMs, launchMs: launch + slipMs, plannedMs: launch };
}

/** A signed duration in plain words: "32 min late", "on time". */
export function sayDrift(ms, { round = 60000 } = {}) {
  if (!Number.isFinite(ms)) return '';
  const r = Math.round(ms / round) * round;
  if (r === 0) return 'on time';
  const late = r > 0;
  const mins = Math.abs(r) / 60000;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  const size = h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
  return `${size} ${late ? 'late' : 'early'}`;
}

/**
 * Where the bake is heading, as opposed to where it has got to.
 *
 * Summing actual durations alone always undercounts a bake in progress, since
 * every phase not yet reached counts as zero, and comparing that against the
 * plan's total is meaningless. This uses what really happened for finished
 * phases and what the protocol still asks for everywhere else, so the total
 * answers the question worth asking mid-bake: given how it has gone so far,
 * what will this dough have had by the time it hits the oven?
 *
 * A phase that has already overrun its plan keeps its real elapsed time. It is
 * not going to un-happen.
 */
export function projectedStages({ doneAt = {}, schedule = {}, planned = [], now = Date.now() }) {
  const actual = actualStages({ doneAt, schedule, planned, now });
  return actual.map((x, i) => {
    const plan = planned[i]?.hours ?? 0;
    if (x.state === 'done') return x;
    if (x.state === 'running') return { ...x, hours: Math.max(x.hours, plan) };
    return { ...x, hours: plan };
  });
}

/**
 * Phases that can still have time taken out of them.
 *
 * A finished phase is history. A phase that is running or still to come can be
 * shortened, which is the other way out of running late: hold the launch where
 * it is and take the time from somewhere downstream.
 */
export function trimmablePhases(stages, { minHours = 0.25 } = {}) {
  return stages
    .map((x, index) => ({ index, name: x.name, hours: x.hours, tempC: x.tempC, state: x.state }))
    .filter((x) => x.state !== 'done' && x.hours > minHours);
}

/** The same stages with `hours` taken out of one of them. */
export function trimStage(stages, index, hours) {
  return stages.map((x, i) => (i === index ? { ...x, hours: Math.max(0, x.hours - hours) } : x));
}

/**
 * How much to cut from one phase to land back on a maturation figure.
 *
 * Maturation is linear in time at a fixed temperature, so this is a division
 * rather than a search. It matters because clock time and enzyme time are not
 * interchangeable: an hour lost on a warm bench is worth several hours in the
 * fridge, so catching up on the clock does not put the dough back where it was.
 */
export function trimForMaturation({ stages, index, targetMU, model = DEFAULT_MODEL }) {
  const stage = stages[index];
  if (!stage) return null;
  const rate = maturationRateAt(stage.tempC, model);
  if (!(rate > 0)) return null;
  const excess = maturationUnits(stages, model) - targetMU;
  const hours = excess / rate;
  return {
    hours,
    // Only worth offering when there is something to cut and enough phase to
    // cut it from.
    feasible: hours > 0.25 && hours < stage.hours,
  };
}
