# Hosting

The site is static: plain ES modules, no build step, no server. Anything that
serves files will run it.

The app is deployed to **Firebase Hosting** at
[canotto-lab.web.app](https://canotto-lab.web.app), which is the address to
give people.

The repository and the published schemas stay on GitHub. Schema `$id`s point at
`sherifhanna700.github.io/canotto-lab/schema/`, and they should stay there
whatever happens to the app's address. An `$id` is an identifier other people's
tools store and resolve, so moving one breaks anything that already read it.
Where the app is served is a hosting decision; where a schema lives is a
promise.

GitHub Pages therefore keeps serving everything, the app included, and remains
a working second copy if a deploy goes wrong.

Firebase Hosting is used for two reasons beyond the shorter name.

**Cache control.** GitHub Pages sends the same ten minute cache lifetime to
everything, including the entry page, which is how a visitor can end up running
half of one build and half of another. Firebase lets each kind of file say what
it means:

| File | Cache-Control |
| --- | --- |
| `index.html` | `no-cache, must-revalidate` |
| `*.js`, `*.css` | `public, max-age=31536000, immutable` |
| `/schema/**` | `public, max-age=3600`, plus `Access-Control-Allow-Origin: *` so other tools can read them |

That pairing is only safe because every module is requested with a content hash
in the query string, so a new build is a new URL and a cached copy of an old
one can never be served in its place. The entry page is the only file that has
to be fresh, and it is the only one told not to cache.

**One project for two jobs.** A Firebase project is a Google Cloud project, so
the same one that serves the site holds the OAuth client that Drive sync needs.
See [google-drive.md](google-drive.md).

## What is not deployed

`firebase.json` lists what to leave out, and the patterns matter more than they
look. Firebase's documented `**/.*` ignores files whose name starts with a dot
but not the contents of a directory whose name does, so a first deploy shipped
the entire `.git` directory and served the repository history at
`/.git/`. `**/.*/**` and an explicit `.git/**` are what actually keep it out.

A correct deploy is 41 files. If a deploy ever reports hundreds, something is
being swept in that should not be, and the quickest check is:

```sh
curl -o /dev/null -w '%{http_code}\n' https://canotto-lab.web.app/.git/HEAD
```

404 is the only acceptable answer.

## Cost

Nothing, on the Spark plan, which needs no card. This site is a few hundred
kilobytes against a 10 GB storage allowance, and the daily transfer allowance
is far more than a pizza tracker will use. Nothing here needs Cloud Functions
or any other billable service.

## Setting it up, once

```sh
npm install -g firebase-tools
firebase login
firebase projects:create canotto-lab     # or pick a free id if that one is gone
firebase deploy --only hosting
```

If the id `canotto-lab` is already taken, use another and change it in
`.firebaserc` and in the `projectId` in `.github/workflows/deploy.yml`. Nothing
else refers to it: the schema addresses do not move with the app.

## Deploying on every push

```sh
firebase init hosting:github
```

That writes a service account into the repository secret the workflow expects,
`FIREBASE_SERVICE_ACCOUNT`. The workflow in `.github/workflows/deploy.yml` runs
the test suite first, checks the committed build stamp matches the committed
source, and only then deploys. Without that secret the deploy step is skipped
rather than failed, so the repository still builds for anyone else.

## Keeping GitHub Pages

It stays on. It costs nothing, it serves the schemas at the addresses they
claim, and it is a working copy of the app if a deploy ever goes wrong. The
files are identical either way.
