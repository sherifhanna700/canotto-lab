# Canotto Lab data formats

Everything the app exports is plain JSON, and every file names the schema it
follows. If you want to build something on top of this data, or feed it your
own, these are the shapes.

Schemas are [JSON Schema 2020-12](https://json-schema.org/) and live at:

```
https://sherifhanna700.github.io/canotto-lab/schema/
```

### How they fit together

Three layers, each built on the one below, so nothing is described twice.

```
common
  |   the pieces every schema uses: a temperature,
  |   a percentage, a score, a flour entry, and the
  |   header on every exported file
  |
  +-- dough      the two halves
  +-- protocol   of a recipe
  |     |
  |     +-- recipe   one named recipe
  |     +-- bake     one logged bake
  |           |
  +-----------+-- recipes   a set of recipes
              +-- log       a bake log
              +-- export    a full backup
```

`common` is never validated against directly. The three documents at the bottom
compose its header with `allOf` and add their own payload, and each pins its own
`$schema` value, so a log cannot quietly pass as a backup.

| File | What it describes |
|---|---|
| `common.schema.json` | Shared building blocks. Referenced, never written |
| `dough.schema.json` | The dough: baker's percentages, batch size, flour blend |
| `protocol.schema.json` | The timings and temperatures the dough is made to |
| `recipe.schema.json` | A named recipe: a dough plus a protocol |
| `recipes.schema.json` | A set of recipes, as written by Download all |
| `bake.schema.json` | One logged bake: what was made, what was measured, how it scored |
| `log.schema.json` | A bake log, as written by Log, Export JSON |
| `export.schema.json` | A full backup: recipes, log and settings together |

Which file the app writes against which schema:

| The app writes | Against |
|---|---|
| `canotto-log.json` | `log.schema.json` |
| `canotto-recipes.json` | `recipes.schema.json` |
| `<recipe-name>.json` | `recipe.schema.json` |
| `canotto-lab.json` | `export.schema.json` |

`dough` and `protocol` are not written on their own. They are the two halves
that `recipe` and `bake` are built from, published separately so you can
reference them directly.

## Things worth knowing before you read the data

**Temperatures are always degrees Celsius.** The display unit is a preference
and lives in `settings.unit`. Nothing in the data changes when you flip it.

**A bake carries its own copy of the dough and protocol.** It does not just
point at a recipe. Recipes get edited, and a bake has to stay truthful about
what was actually made, so the copy is deliberate. `recipeId` is a convenience,
and may point at a recipe that no longer exists.

**Scores are one to five, or null.** Null means not judged, which is not the
same as bad. The overall score is the mean of whichever were given, so a bake
scored on two axes is not penalised against one scored on five.

**`planned: true` means the bake has not happened.** Exclude those from any
analysis.

**Inoculation is `baseYeastPct` in whatever `yeastType` says**, and the freeze
buffer is added on top only when `frozenBalls` is above zero. Relative potency
between the yeast types is 1 : 1.25 : 3 for instant dry, active dry and fresh.

**Flour shares are percentages that should total 100.** A flour either has an
`id` from the app's library or a `name` of its own. `w` is the Chopin
alveograph value and is null where the mill publishes none.

## Reading a bake without the app

The fermentation model is not needed to read the data, but it is what makes two
schedules comparable. One fermentation unit is one hour at 20 °C. Rate follows a
Q10 law, doubling roughly every 10 °C, with a steeper coefficient below 15 °C
because a fridge slows dough more than a single Q10 predicts. Sum
`hours × rate(temperature)` across the phases and you have the number the app
compares bakes on. The constants are in `settings.model`.

## Example

```json
{
  "$schema": "https://sherifhanna700.github.io/canotto-lab/schema/export.schema.json",
  "app": "Canotto Lab",
  "exportedAt": "2026-09-11T18:22:04.000Z",
  "bakes": [
    {
      "id": "b1",
      "bakedAt": "2026-09-11T17:00",
      "recipeName": "Contemporary Canotto (house)",
      "recipe": { "balls": 8, "ballWeight": 275, "hydrationPct": 70, "yeastType": "idy", "baseYeastPct": 0.1 },
      "schedule": { "coldProofHours": 66, "fridgeTempC": 2.8, "roomTempC": 21.1 },
      "actuals": { "ambientTempC": 18, "deckTempC": 452, "bakeSec": 75 },
      "scores": { "canotto": 4, "honeycomb": 4, "blistering": null }
    }
  ]
}
```

## Getting them

They are in the repository that publishes this site, under `schema/`, and served
from the same URL:

```sh
curl -O https://sherifhanna700.github.io/canotto-lab/schema/log.schema.json

git clone https://github.com/sherifhanna700/canotto-lab
# schemas are in schema/
```

Each `$id` is the published URL, so a validator that fetches references will
resolve them on its own.
