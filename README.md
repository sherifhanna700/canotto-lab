# Canotto Lab

Plan, run and compare contemporary canotto pizza doughs.

It started as a single static page holding one protocol. This is the same protocol with
every hardcoded number turned into a variable, plus the thing a static page cannot do:
a record of what you actually baked, so you can tell which permutation was better.

**Live app:** https://sherifhanna700.github.io/canotto-lab/

## What it does

**Recipes.** Pick a flour or blend a few, pick a style, and the app proposes a complete
recipe: method, hydration, phase structure, times and inoculation. Save it under a name,
duplicate it, tweak it, share it as a link. Every recipe carries the average score of the
bakes filed against it.

**Dough.** Baker's percentages against total flour, split across the preferment and the
final mix. Flour blends are supported, and each flour can be sent to the biga, held back
for the refresh, or split evenly.

**Fermentation.** Every phase reduces to *fermentation units*, one FU being an hour at
20 °C. That is what makes two different schedules comparable: 66 hours at 37 °F and
18 hours at 65 °F are not the same amount of fermentation, and the app says so. The cold
ferment temperature is a first-class knob, because for most people it is fixed by the
fridge they own and everything else has to bend around it.

**Protocol.** The 19 steps across 5 phases, with the schedule solved backwards from when
you want the first pizza on the deck. Change the cold proof and the mix time moves, not
the dinner. Quantities in the step text are computed from the live recipe, so the
checklist and the calculator can never disagree.

**Bake.** Heat modulation scaled to your bake time and your oven, a timer, and the
conditions on the day including ambient temperature, which is what actually varies for an
outdoor oven. Ovens and mixers are chosen by type and recorded by make and model, and the
mixer sets the friction allowance in the water temperature calculation. Step text adapts:
mixing by hand does not read as "speed 1", and an electric oven does not talk about
flames.

**Log and Compare.** Score each bake out of five on rim height, honeycomb, blistering,
flavour and base. The Compare screen ranks every variable by how it correlates with the
score, plots any factor against any outcome, and leaderboards your recipes.

**Lab.** Pick one or two variables and the values to try. The app generates the grid as
planned bakes, so the experiment is designed before the dough is mixed.

## Where the numbers come from

Flour strength and maturation windows are published figures where a source exists, and
estimated from protein where none does. The app marks which is which rather than
presenting a guess as a measurement.

- [Pizza flour comparison: W-value and protein](https://pizzaplan.app/en/flour-brands/)
- [Pizza flour guide: W-value, protein and the right mix](https://www.housegardenhobby.com/pizza-flour-guide/)
- [Biga preferment guide](https://www.pizzablab.com/the-encyclopizza/biga-preferment/)
- [Caputo Nuvola](https://thepizzaheaven.com/caputo-nuvola/) and [mastering canotto pizza](https://thepizzaheaven.com/mastering-canotto-pizza/)
- [King Arthur Baking product pages](https://shop.kingarthurbaking.com/items/00-pizza-flour)

The fermentation model is a Q10 rate law with a steeper coefficient in the cold range. Its
constant K is anchored to the house protocol, which ripens on 0.10% instant dry yeast
across 23.4 FU. Score a few bakes 4 or better and the app will refit K to your own
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
4. Open **Help & data** in the app and paste the web config. It is kept in the browser.

Alternatively copy `firebase-config.example.js` to `firebase-config.js`, fill it in, and
add `<script src="firebase-config.js"></script>` to `index.html` before the module script.
That file is gitignored.

## Running it

No build step. It is plain ES modules.

```sh
npm run serve     # http://localhost:8080
npm test          # model tests
```

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
  advisor.js          flour to recipe proposals
  protocol.js         the 19 steps and the schedule solver
  recipes.js          named recipes and scoring
  metrics.js          the variables Compare and Lab work on
  equipment.js        ovens, mixers, and heat modulation stages
  diagnostics.js      troubleshooting, with auto-detection
src/lib/              storage, charts, DOM helpers, sharing, cloud
src/views/            one module per screen
tests/run.mjs         model tests
```

The model layer has no DOM dependency, which is why it can be tested in Node and why the
same maths drives the checklist, the calculator and the comparison charts.
