// Cache busting for a no-build ES module app.
//
// GitHub Pages sends cache-control: max-age=600, and browsers, especially the
// in-app webviews inside chat apps, hold module files far longer than that. A
// visitor could then run a mix of old and new files, or an entirely old app.
//
// This stamps a content hash onto every relative import and onto the entry
// script and stylesheet in index.html. A new deploy is a new set of URLs, so no
// cache can serve the old build. Re-running it with no source changes produces
// the same hash, so it is safe to run on every commit.
//
// Usage: npm run stamp

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

const jsFiles = walk(join(root, 'src'));
const cssFile = join(root, 'assets', 'style.css');
const htmlFile = join(root, 'index.html');

/** Strip any existing stamp so the hash depends on content, not on the last run. */
const unstamp = (text) => text.replace(/\?v=[0-9a-f]{8}(?=['")])/g, '');

const hash = createHash('sha256');
for (const f of [...jsFiles.sort(), cssFile, htmlFile]) {
  hash.update(relative(root, f));
  hash.update(unstamp(readFileSync(f, 'utf8')));
}
const version = hash.digest('hex').slice(0, 8);

let changed = 0;

// Relative imports only. External URLs and template literals are left alone.
const IMPORT_RE = /(from\s+|import\s+)(['"])(\.[^'"]+?\.js)(\?v=[0-9a-f]{8})?\2/g;

for (const file of jsFiles) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(IMPORT_RE, (_m, kw, q, path) => `${kw}${q}${path}?v=${version}${q}`);
  if (after !== before) {
    writeFileSync(file, after);
    changed += 1;
  }
}

const beforeHtml = readFileSync(htmlFile, 'utf8');
const afterHtml = beforeHtml
  .replace(/(href=")(assets\/style\.css)(\?v=[0-9a-f]{8})?(")/, `$1$2?v=${version}$4`)
  .replace(/(src=")(src\/app\.js)(\?v=[0-9a-f]{8})?(")/, `$1$2?v=${version}$4`);
if (afterHtml !== beforeHtml) {
  writeFileSync(htmlFile, afterHtml);
  changed += 1;
}

console.log(`Stamped build ${version} across ${changed} file${changed === 1 ? '' : 's'}.`);
