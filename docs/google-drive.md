# Turning on sync

The app keeps everything in the browser and works fully without an account.
Sync is optional: connect a Google account and the whole library is kept as one
JSON file in that account's private storage for this app.

Nobody using the app has to set anything up. The app carries a single OAuth
client id, which identifies the app to Google and is public by design. Google
enforces which web addresses may use it, which is why it is not a secret.

Until that id is filled in, the Setup screen says sync is not switched on and
offers the file download instead.

The client id is already in the build, so nothing below needs doing again. It
is kept for the record, and for anyone running their own copy.

## What to create, once

1. Go to the [Google Cloud console](https://console.cloud.google.com/) and
   create a project. If you already made a Firebase project to host the site,
   use that one: every Firebase project is a Google Cloud project, so the
   hosting and the OAuth client live together.
2. Under **APIs and services → Library**, enable the **Google Drive API**.
3. Under **APIs and services → OAuth consent screen**, choose **External**,
   fill in the app name, your email as support and developer contact, and save.
4. On the **Scopes** step add these three:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/drive.appdata`

   `drive.appdata` is the narrowest thing Drive offers. It gives the app a
   hidden per-application folder and nothing else: not a folder in the person's
   Drive that they browse past, but one that does not appear in Drive at all,
   and no ability to see, list or touch any other file they own. Do **not** add
   `drive` or `drive.file`; neither is needed and both ask for far more.

   The email scope is only so the app can show which account is connected,
   which matters once someone has two.
5. Publish the consent screen. While it is in **Testing**, only accounts listed
   as test users can connect, and their access expires after a week.
6. Under **APIs and services → Credentials**, create an **OAuth client ID** of
   type **Web application**. Add these **Authorized JavaScript origins**:

   ```
   https://canotto-lab.web.app
   https://canotto-lab.firebaseapp.com
   https://sherifhanna700.github.io
   http://localhost:8080
   ```

   Firebase serves the site on both of its own domains, so both need listing.
   The GitHub Pages entry is only needed while that mirror is still in use, and
   because origins carry no path it covers every site under that account. Add
   whatever port you serve locally on.
7. Copy the client id. It looks like `1234567890-abc123.apps.googleusercontent.com`.

## Where it goes

One line, in `src/lib/drive.js`:

```js
const BUILT_IN_CLIENT_ID = '1234567890-abc123.apps.googleusercontent.com';
```

Then `npm test`, which restamps the build, and commit. To try a client id
without editing the file, set `window.GOOGLE_CLIENT_ID` before the app loads.

## What it does

Sync reads `canotto-lab.json` from the app's hidden folder, merges it with what
is in the browser, and writes the result back. Merging is per record and the
newest edit wins, so two devices working on different recipes both keep their
work.

Nothing is ever deleted by a sync. A recipe removed on one device comes back
from the other, because losing work to a sync is worse than seeing something
you meant to bin.

The cost of hidden storage is that a person cannot open or empty it from Drive,
so the Setup screen carries a button that deletes it, and the JSON download is
the copy they can actually hold. Revoking the app in Google account settings
removes it too.

The access token lives in memory only, never in storage. Google reissues one
without a prompt while the person's Google session is alive, which is why
returning to the app looks like staying signed in.
