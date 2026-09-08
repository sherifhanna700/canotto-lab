# Canotto Lab

A tracker for biga-based contemporary canotto pizza.

It started as a single static page holding one protocol. This is the same protocol with
every hardcoded number turned into a variable, plus the thing a static page cannot do:
a record of what you actually baked, so you can tell which permutation was better.

**Live app:** https://sherifhanna700.github.io/canotto-lab/

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
anything is saved. Edits save onto the selected recipe as you make them, so the name in
the list is always the name in the field. Every recipe carries the average score of the
bakes filed against it.

Fermentation is the heart of it. Every phase reduces to *fermentation units*, one FU being
an hour at 20 °C. That is what makes two schedules comparable: 66 hours at 37 °F and
18 hours at 65 °F are not the same amount of fermentation, and the app says so. The cold
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
3. **Firebase sync.** Optional. Sign in and recipes and bakes mirror to Firestore under
   your own user id, so they follow you between devices.

Recipes can also be shared as a link that carries the whole definition, so the person
opening it needs no account at all.

### Setting up Firebase sync

The repository carries no project keys. To enable sync:

1. Create a Firebase project, add a Web app, enable **Google** under Authentication, and
   create a **Firestore** database.
2. Add your GitHub Pages domain under Authentication → Settings → Authorized domains.
3. Deploy the rules in `firestore.rules`, which scope every document to its owner.
4. Open **Setup** in the app and paste the web config. It is kept in the browser.

Alternatively copy `firebase-config.example.js` to `firebase-config.js`, fill it in, and
add `<script src="firebase-config.js"></script>` to `index.html` before the module script.
That file is gitignored.

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

Two layers of testing. `npm test` covers the model: the dough maths, the
fermentation model, the schedule solver, the schemas. `tests/qa-plan.md` covers
what a person actually does with the app, and `tests/browser-qa.js` executes it
in a real browser against the running build. Load the app, paste that file into
the console and run `await canottoQA()`. It drives every number and text field
the way a keyboard does, drags the sliders, builds a recipe, files a bake,
exports it and checks the arithmetic on screen. 90 checks, a few seconds.

That split exists because nearly every defect in this app has been an
interaction defect rather than a maths one: a field that fought the person
typing in it, a screen that rebuilt itself under a keyboard, a button that
stayed dead when its inputs moved. Unit tests could not have caught any of them.

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
  ferment.js          the fermentation model
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
```

The model layer has no DOM dependency, which is why it can be tested in Node and why the
same maths drives the checklist, the calculator and the comparison charts.
