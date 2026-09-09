# Canotto Lab

A tracker for biga-based contemporary canotto pizza.

It started as a single static page holding one protocol. This is the same protocol with
every hardcoded number turned into a variable, plus the thing a static page cannot do:
a record of what you actually baked, so you can tell which permutation was better.

**Live app:** https://canotto-lab.web.app/

## Five screens

**Recipe.** One preset ships, the house protocol. Everything else you build.

The screen works inputs to outputs. **Your recipes** lists what is stored, with load,
duplicate, download as JSON, share as a link and delete on each, plus a download of the
lot. **Inputs** is what you have and what you want: the flour or blend, how much dough,
your fridge and room temperatures, and how long you want it to mature. Recompute, and the
engine works out the hydration, the biga ratios, the inoculation and the length of every
phase, which in turn become the 19-step protocol. Everything it produced stays editable
afterwards if you want to override it.

Creating from scratch walks the same five inputs and previews what they give you before
anything is saved.

Edits go to a working draft, not to the stored recipe. A bar appears naming what you are
editing and offering Save or Discard, so a recipe can be opened, played with and walked
away from without harm. The shipped protocol cannot be written over at all: saving on top
of it makes a copy, and the reference keeps its numbers, because it is what every other
schedule is measured against.

Every recipe carries the average score of the bakes filed against it.

Two clocks run in a cold-fermented dough, and confusing them is why so much cold-proof
advice contradicts itself. Yeast makes the gas, and it nearly stops in a fridge: at 4 °C it
works at roughly a tenth of its room rate. The flour's own enzymes soften the gluten and
free up sugar, and they keep close to half their room rate down there. The gap between the
two curves is the entire reason a cold proof exists.

So the app tracks both. A *fermentation unit* is an hour of yeast work at 20 °C and sets
how much yeast a schedule needs. A *maturation unit* is an hour of enzyme work at 20 °C
and sets how long the dough can stay in the fridge. A flour's W value is a budget for
maturation: strong flour absorbs more enzyme work before the gluten goes slack, which is
why W 330 will carry a proof that would ruin W 260.

That is what lets the app answer the question it was built for. Given your flour, your
fridge temperature and the rest of your schedule, it says whether your cold proof is too
long, too short, or about right, and offers the duration it would pick. The same 66 hours
reads as fine at 37 °F and too long at 43 °F, because the enzymes ran faster. The cold
ferment temperature is a first-class knob, because for most people it is fixed by the
fridge they own and everything else has to bend around it.

**Protocol.** The 19 steps across 5 phases, with the schedule solved backwards from when
you want the first pizza on the deck. Change the cold proof and the mix time moves, not
the dinner. Quantities in the step text are computed from the live recipe, so the
checklist and the calculator can never disagree.

**Bake.** Heat modulation scaled to your bake time and your oven, a timer, and the
conditions on the day including ambient temperature, which is what actually varies for an
outdoor oven. Score the bake out of five on rim height, honeycomb, blistering, flavour and
base, and the app names the likely faults from the numbers you recorded.

**Log.** Every bake, and what the differences between them add up to. Once three bakes are
scored, it ranks each variable by how it correlates with the score and will plot any
factor against any outcome.

**Setup.** Oven and mixer by type and by make and model, the temperatures your kitchen
actually has, units, appearance, and saving. Appearance follows your device by default
and can be forced light or dark, from Setup or the button in the header. The mixer sets the friction allowance, and the step text
adapts: mixing by hand does not read as "speed 1", and an electric oven is not told to
turn a flame down.

## Where the numbers come from

Flour strength and maturation windows are published figures where a source exists, and
estimated from protein where none does. The app marks which is which rather than
presenting a guess as a measurement. The library only carries flours that can actually
carry a biga canotto schedule, plus semola and whole grain as blending components.

- [Pizza flour comparison: W-value and protein](https://pizzaplan.app/en/flour-brands/)
- [Pizza flour guide: W-value, protein and the right mix](https://www.housegardenhobby.com/pizza-flour-guide/)
- [Biga preferment guide](https://www.pizzablab.com/the-encyclopizza/biga-preferment/)
- [Caputo Nuvola](https://thepizzaheaven.com/caputo-nuvola/) and [mastering canotto pizza](https://thepizzaheaven.com/mastering-canotto-pizza/)

Two things in this app are **not** taken from a source, and are marked as such
in the code. The Q10 coefficients in the fermentation model, and the specific
heat of flour used in the dough temperature calculation. Water's specific heat
is exact; flour's is the usual approximation. Both are starting points the app
can replace with a figure worked back from your own bakes, which is the point
of logging them.

The fermentation model is a Q10 rate law with a steeper coefficient in the cold range. Its
constant K is anchored to the house protocol, which ripens on 0.10% instant dry yeast
across 24.2 FU. Score a few bakes 4 or better and the app will refit K to your own
results. W values vary by lot; treat every figure as a starting point and let your bake
log overrule it.

## Saving

Everything is stored in the browser. Nothing leaves the device unless you choose to send
it. Three ways to keep it safe, in order of how little setup they need:

1. **Export a JSON backup.** Keep it wherever you like, including a cloud folder.
2. **Save straight to a file.** On Chrome and Edge the app can write to a file you pick
   and remember it, so later saves are one click. Point it at a folder Google Drive or
   iCloud already syncs and you get cloud backup with no accounts and no API.
3. **Sync to your Google account.** Optional. Connect an account and the whole library
   is kept as a single `canotto-lab.json` in that account's private storage for this
   app, so it follows you between devices. Nothing to set up: no project, no keys, no
   database.

Recipes can also be shared as a link that carries the whole definition, so the person
opening it needs no account at all.

### About sync

The app asks for the `drive.appdata` scope, the narrowest thing Drive offers. It grants a
hidden per-application folder and nothing else. Nothing appears in your Drive, and the app
cannot see, list or touch any other file you own. The Google consent screen says as much.

Because that storage is hidden, you cannot empty it from Drive, so Setup carries a button
that deletes it, and the JSON download is the copy you can actually hold.

Merging is per record and the newest edit wins, so two devices working on different
recipes both keep their work. Nothing is ever deleted by a sync. A recipe removed on one
device comes back from the other, because losing work to a sync is worse than seeing
something you meant to bin.

The key Google issues is kept for the life of the tab and discarded when you close it, so a
reload does not need a new one. It never reaches us, and Google expires it after about an
hour regardless. There is no long-lived credential behind it, because Google does not issue
one to a page with no server.

Running your own copy of this app? [docs/google-drive.md](docs/google-drive.md) covers
the one-off OAuth client that has to exist before the Setup screen offers any of this.

Hosting, cache headers and deployment are covered in
[docs/hosting.md](docs/hosting.md).

## Privacy

Your recipes and bakes are stored in your browser and are never sent to us. If you
connect a Google account they go to that account's private storage for this app, not
through any server of ours, because there isn't one.

The one thing the app sends is a count of how many devices use it, once a day at most:
a random number the browser generated for itself, and today's date. Nothing else. It
can be switched off in Setup, and off means the request is not made rather than made
with a flag on it.

There is no build step, so the JavaScript running in your browser is the same text as
the source here. The counting is [`src/lib/count.js`](src/lib/count.js), the rules that
constrain what it may write are [`firestore.rules`](firestore.rules), and the sync is
[`src/lib/drive.js`](src/lib/drive.js). The tests in `tests/run.mjs` check the code
against the claims in [privacy.html](privacy.html), so the two cannot drift apart.

## Data formats

Everything the app exports is plain JSON, and every file names the schema it
follows. The log exports as JSON or as CSV with the derived figures already
worked out. Recipes export singly or as a set.

Schemas are JSON Schema 2020-12. They live in [`schema/`](schema/) in this
repository and are served from
[`/schema/`](https://sherifhanna700.github.io/canotto-lab/schema/), which is
also each one's `$id`, so a validator that fetches references resolves them by
itself.

They are layered rather than parallel. `common` holds the pieces every schema
uses: a temperature, a percentage, a score, a flour entry, the header on every
exported file. `dough` and `protocol` are the two halves of a recipe. `recipe`
and `bake` compose those. `recipes`, `log` and `export` are the documents the
app actually writes, and each composes the shared header with `allOf` and pins
its own `$schema` value, so a log cannot pass as a backup.

The index there covers the things
worth knowing before reading the data, chiefly that temperatures are always
Celsius, that a bake carries its own copy of the dough and protocol so it stays
truthful after the recipe is edited, and that a null score means not judged
rather than bad.

The test suite validates real exports against those schemas, so they cannot
quietly drift from what the app writes.

## Running it

No build step. It is plain ES modules.

```sh
npm run serve     # http://localhost:8080
npm test          # stamps the build, then runs the model tests
npm run stamp     # cache busting only
```

Three layers of testing. `npm test` covers the model: the dough maths, the
fermentation model, the schedule solver, the schemas. `tests/qa-plan.md` covers
what a person actually does with the app, and `tests/browser-qa.js` executes it
in a real browser against the running build. Load the app, paste that file into
the console and run `await canottoQA()`. It drives every number and text field
the way a keyboard does, drags the sliders, builds a recipe, files a bake,
exports it and checks the arithmetic on screen. 96 checks, a few seconds.

`npm run audit` is the third. The unit tests check that the maths does what it
was written to do; the audit checks that what it does could be true at all,
across the range of doughs someone might build. No negative water, no step
scheduled after the bake, no weights that fail to sum to the batch, no advice
that cannot be followed. Where it can, it verifies an answer from first
principles rather than asking the same function twice.

That split exists because the defects have come in three kinds. Interaction
faults: a field that fought the person typing in it, a screen that rebuilt
itself under a keyboard, a button that stayed dead when its inputs moved.
Presentation faults: figures rounded one way for display and another for
comparison. And one that was neither, where the maths was faithful to the
textbook and still physically wrong, which is what the audit exists to catch.

`npm run stamp` writes a content hash onto every relative import and onto the entry
script and stylesheet, so a deploy is a new set of URLs and no browser can serve a
half-old build. It is idempotent, and `npm test` runs it, so committing after a test run
is enough. The current build id is shown in the footer of the app.

## Layout

```
index.html            app shell
assets/style.css      the whole stylesheet
src/app.js            tab routing and the render loop
src/model/            pure logic, no DOM
  units.js            temperature and mass formatting
  dough.js            baker's percentage engine
  flours.js           flour library, blend maths, W bands
  ferment.js          the fermentation model and the mix water heat balance
  advisor.js          flour to schedule proposals
  protocol.js         the 19 steps and the schedule solver
  recipes.js          named recipes and scoring
  metrics.js          the variables the Log compares on
  equipment.js        ovens, mixers, and heat modulation stages
  diagnostics.js      troubleshooting, with auto-detection
src/lib/              storage, charts, DOM helpers, sharing, theme, cloud
src/views/            one module per screen
schema/               published JSON Schemas for the exported data
tools/stamp.mjs       cache busting
tools/validate-schema.mjs  the subset validator the tests use
tests/run.mjs         model tests
tests/audit.mjs       sanity sweep over the model's outputs
tests/qa-plan.md      what a person does with the app
tests/browser-qa.js   that plan, executed in a browser
```

The model layer has no DOM dependency, which is why it can be tested in Node and why the
same maths drives the checklist, the calculator and the comparison charts.
