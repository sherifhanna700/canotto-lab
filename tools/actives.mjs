// How many people use this: DAU, WAU, MAU.
//
// The whole of our analytics. Reads the activity collection, where each
// document is one anonymous device and the only field is the date it was last
// active, and counts distinct devices seen within a window.
//
// Nothing here can identify anyone, because nothing identifying was ever
// stored. Run it with the Firebase CLI logged in as the project owner:
//
//     node tools/actives.mjs
//
// Reading the figures also prunes. MAU is the longest window anyone asks for,
// so a device last seen more than 35 days ago is of no further use and is
// deleted. Keeping it would mean holding a record for longer than any question
// it could answer, which is the definition of keeping it for nothing.
//
//     node tools/actives.mjs                 read and prune to 35 days
//     node tools/actives.mjs --keep 90       read and prune to 90 days instead
//     node tools/actives.mjs --no-prune      read only
//
// The counts can also just be read off the Firestore console, which is the
// no-tooling way: one document per device, one date in each.

import { execFileSync } from 'node:child_process';

const PROJECT = 'canotto-lab';
const args = process.argv.slice(2);
/*
 * Thirty-five days by default: thirty for MAU, and a few spare so a month
 * counted at the edge is not a month missing its first day.
 */
const pruneAfter = args.includes('--no-prune')
  ? null
  : Number(args.includes('--keep') ? args[args.indexOf('--keep') + 1] : 35);

/**
 * Borrow a token from the signed-in gcloud, so this script holds no credential
 * of its own. Needs `gcloud auth login` as the account that owns the project.
 */
function accessToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    console.error('Could not get a token. Run: gcloud auth login --project canotto-lab');
    process.exit(1);
    return '';
  }
}

const dayKey = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const daysAgo = (n) => dayKey(new Date(Date.now() - n * 86400000));

async function readAll(auth) {
  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/activity`;
  const rows = [];
  let pageToken = '';
  do {
    const url = `${base}?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`;
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(url, { headers: { Authorization: `Bearer ${auth}` } });
    if (!res.ok) throw new Error(`Firestore said ${res.status}: ${(await res.text()).slice(0, 200)}`);
    // eslint-disable-next-line no-await-in-loop
    const body = await res.json();
    for (const doc of body.documents || []) {
      rows.push({ name: doc.name, day: doc.fields?.day?.stringValue || '' });
    }
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return rows;
}

const auth = accessToken();
const rows = await readAll(auth);

const since = (n) => {
  const cutoff = daysAgo(n);
  return rows.filter((r) => r.day >= cutoff).length;
};

console.log(`\n  devices recorded   ${rows.length}`);
console.log(`  DAU (today)        ${rows.filter((r) => r.day === dayKey(new Date())).length}`);
console.log(`  WAU (7 days)       ${since(6)}`);
console.log(`  MAU (30 days)      ${since(29)}\n`);

if (pruneAfter) {
  const cutoff = daysAgo(pruneAfter);
  const stale = rows.filter((r) => r.day < cutoff);
  for (const row of stale) {
    // eslint-disable-next-line no-await-in-loop
    await fetch(`https://firestore.googleapis.com/v1/${row.name}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth}` },
    });
  }
  console.log(stale.length
    ? `  pruned ${stale.length} device${stale.length === 1 ? '' : 's'} last seen before ${cutoff}\n`
    : `  nothing older than ${cutoff} to clear\n`);
}
