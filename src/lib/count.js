// Counting how many people use this, and nothing else.
//
// The only question worth answering is how many bakers the app has: daily,
// weekly and monthly actives. That number needs some way to tell two devices
// apart, so this stores one random identifier per browser. It is generated
// here, it means nothing anywhere else, and it is never joined to a Google
// account, a recipe, an email, or anything a person typed.
//
// What is sent, once a day at most, is exactly one field:
//
//     { day: "2026-09-09" }
//
// A date and not a timestamp, because the hour someone bakes is none of our
// business and a coarser value is a weaker fingerprint. No page views, no
// events, no referrer, no screen size, no recipe, no counts of anything they
// made. The rules on the other end reject a write that carries anything else,
// so this cannot quietly grow into analytics later without that being an
// obvious, deliberate change in two places.
//
// Actives are then read off the collection by whoever runs the app: today's
// date for DAU, the last seven days for WAU, the last thirty for MAU. Nothing
// in the app can read it back.
//
// It can be switched off, and off means no request at all rather than a
// request with a flag on it.

const ID_KEY = 'canotto-lab/device';
const SENT_KEY = 'canotto-lab/counted-on';
const OFF_KEY = 'canotto-lab/no-count';

const PROJECT = 'canotto-lab';
const COLLECTION = 'activity';

const read = (k) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // A browser refusing storage still runs the app. It just counts as a new
    // device each time, which overcounts slightly and is the harmless way to
    // be wrong.
  }
};

export const isOff = () => read(OFF_KEY) === '1';

export function setCounting(on) {
  try {
    if (on) localStorage.removeItem(OFF_KEY);
    else localStorage.setItem(OFF_KEY, '1');
  } catch {
    // Nothing to do.
  }
}

/** A random identifier for this browser. Not derived from anything about anyone. */
function deviceId() {
  let id = read(ID_KEY);
  if (id) return id;
  const bytes = new Uint8Array(16);
  (globalThis.crypto || {}).getRandomValues?.(bytes);
  id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  write(ID_KEY, id);
  return id;
}

/** Today where the person is, since that is what "daily active" means to them. */
export function today(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/**
 * Record that this device was used today, at most once a day.
 *
 * Failure is silent and harmless. If the network is down or the write is
 * rejected, the app carries on exactly as before: nothing here is worth
 * interrupting someone's bake for, and nothing here is retried.
 */
export async function countToday({ now = new Date(), fetcher = fetch } = {}) {
  if (isOff()) return { counted: false, reason: 'off' };
  const day = today(now);
  if (read(SENT_KEY) === day) return { counted: false, reason: 'already' };

  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${COLLECTION}/${deviceId()}`;
  try {
    const res = await fetcher(`${url}?updateMask.fieldPaths=day`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { day: { stringValue: day } } }),
    });
    if (!res.ok) return { counted: false, reason: `http ${res.status}` };
    // Only mark it done on success, so a failed day is counted the next time
    // the app opens rather than skipped.
    write(SENT_KEY, day);
    return { counted: true, day };
  } catch {
    return { counted: false, reason: 'offline' };
  }
}
