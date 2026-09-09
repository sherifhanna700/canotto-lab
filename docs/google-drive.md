# Turning on Drive sync

The app keeps everything in the browser and works fully without an account.
Drive sync is optional: connect a Google account and the whole library is kept
as one JSON file in that person's own Drive.

Nobody using the app has to set anything up. The app carries a single OAuth
client id, which identifies the app to Google and is public by design. Google
enforces which web addresses may use it, which is why it is not a secret.

Until that id is filled in, the Setup screen says sync is not switched on and
offers the file download instead.

## What to create, once

1. Go to the [Google Cloud console](https://console.cloud.google.com/) and
   create a project. Any name.
2. Under **APIs and services → Library**, enable the **Google Drive API**.
3. Under **APIs and services → OAuth consent screen**, choose **External**,
   fill in the app name, your email as support and developer contact, and save.
4. On the **Scopes** step add these three:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/drive.file`

   `drive.file` is the narrow one: it lets the app touch only files it created
   itself. It cannot read anything else in anyone's Drive, and the consent
   screen tells them so.
5. Publish the consent screen. While it is in **Testing**, only accounts listed
   as test users can connect, and their access expires after a week.
6. Under **APIs and services → Credentials**, create an **OAuth client ID** of
   type **Web application**. Add these **Authorized JavaScript origins**:

   ```
   https://sherifhanna700.github.io
   http://localhost:8080
   ```

   Origins carry no path, so the GitHub Pages entry covers every site under
   that account. Add whatever port you serve locally on.
7. Copy the client id. It looks like `1234567890-abc123.apps.googleusercontent.com`.

## Where it goes

One line, in `src/lib/drive.js`:

```js
const BUILT_IN_CLIENT_ID = '1234567890-abc123.apps.googleusercontent.com';
```

Then `npm test`, which restamps the build, and commit. To try a client id
without editing the file, set `window.GOOGLE_CLIENT_ID` before the app loads.

## What it does

Sync reads `canotto-lab.json` from the connected Drive, merges it with what is
in the browser, and writes the result back. Merging is per record and the
newest edit wins, so two devices working on different recipes both keep their
work.

Nothing is ever deleted by a sync. A recipe removed on one device comes back
from the other, because losing work to a sync is worse than seeing something
you meant to bin. Deleting for good means deleting on every device, or deleting
the file in Drive.

The access token lives in memory only, never in storage. Google reissues one
without a prompt while the person's Google session is alive, which is why
returning to the app looks like staying signed in.
