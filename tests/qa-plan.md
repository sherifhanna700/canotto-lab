# Canotto Lab QA plan

Written against what a person does with the app, not against the code. Every
check below is executed by `tests/browser-qa.js`, which runs in a real browser
against the real build. Model-level behaviour is covered separately by
`tests/run.mjs`; this is for the things only a browser can tell you.

## Why these

Most of the defects found in this app have been interaction defects, not maths
defects: a field that fought the person typing in it, a screen that rebuilt
itself under a keyboard, a button that stayed dead when its inputs moved. The
plan is weighted accordingly.

## J1. First run

A new visitor with no saved data.

1. All five tabs render without error.
2. Exactly one recipe exists, the house protocol.
3. Defaults are sane: 70% hydration, 37 °F cold ferment, 70 °F room, 8 × 275 g.
4. The footer shows a build id.

## J2. Number entry

The field must not fight the person typing. For every number field on every tab:

1. It can be cleared. The box goes empty and stays empty.
2. A multi-digit value can be typed one character at a time.
3. The element is not replaced mid-entry.
4. The value is still there after leaving the field.
5. A decimal can be typed. "0." must be allowed to become "0.015".
6. Out-of-range entry is corrected when the field is left, not while typing.

## J3. Text entry

1. Capitals survive. The element is not replaced between keystrokes.
2. Text persists after leaving the field.
3. Anything derived from it catches up: the oven summary, the name in the header.

## J4. Building a recipe

1. New recipe opens the five-step form.
2. Name, flour, batch, temperatures and maturation all take input.
3. Creating adds it to the library and loads it.
4. The protocol reflects the new recipe: flour name and gram weights in the steps.

## J5. Managing recipes

1. Duplicate produces a copy, loaded and independently editable.
2. Renaming updates the list and the header immediately, with no save step.
3. Deleting removes it; the house protocol offers Restore instead of Delete.
4. Download writes valid JSON naming its schema.

## J14. Editing and saving

Edits go to a working draft. Nothing is stored until it is saved, so a recipe
can be opened, played with, and walked away from without harm.

1. Editing does not change the stored recipe.
2. A bar appears naming the recipe being edited and offering Save and Discard.
3. Save writes the draft to the recipe and the bar goes.
4. Discard puts the draft back to what is stored.
5. The shipped protocol cannot be written over. Saving on top of it makes a
   copy, which becomes the one being worked on, and the reference keeps its
   original numbers.
6. A shipped protocol that an earlier version edited in place is rescued on
   load: the baker's work is kept as a recipe of their own and the reference is
   restored.

## J6. Recompute

1. With a freshly recomputed recipe, the button is disabled.
2. Changing any input enables it, including a one degree change of fridge.
3. Recomputing updates the ratios and the phases, and disables the button again.

## J7. The protocol

1. Times solve backwards from the launch time, and moving launch moves them all.
2. Lengthening the cold proof moves the first mix earlier, not the bake later.
3. Checking a step updates the progress counter.
4. Quantities in the step text match the What to weigh table.

## J8. Baking and logging

1. Conditions and scores accept input, including being left blank.
2. Filing a bake clears the session and the bake appears in the log.
3. The log shows it with the right hydration, proof and score.

## J9. Export

1. Log exports JSON that parses, names log.schema.json, and contains the bakes.
2. Log exports CSV with a header row and one row per bake.
3. Recipes export JSON naming recipes.schema.json.

## J10. Settings

1. The unit toggle converts rather than reinterprets: 37 °F is 2.8 °C.
2. The theme toggle cycles system, light and dark, and sets color-scheme.
3. Equipment make and model persist and appear in the summary.

## J11. Persistence

1. Everything survives a reload.
2. Impossible saved values are repaired on load rather than shown.

## J15. Targets and the keyboard

1. A value the app itself prints as the target reads as on target. The bounds
   are stored in Celsius and shown in the baker's unit, so the verdict must be
   judged against the rounded numbers on screen, not the exact ones beneath.
2. Both ends of every target range are inclusive.
3. Enter finishes a field: it commits, closes the keyboard, and leaves the page
   where it was rather than jumping to the next control.
4. A foldout the baker has opened stays open through a redraw.

## J13. Sliders

1. A slider leaves vertical gestures to the page. A swipe to scroll that starts
   on the track must scroll, not drag the thumb.
2. A redraw triggered by something else while a drag is in progress must not
   replace the slider or move the thumb.
3. Releasing commits the value and lets the rest of the screen catch up.

## J12. Arithmetic on screen

1. Water columns add up: biga plus final mix equals total.
2. Bassinage plus salt wash equals the final mix water.
3. The bassinage doses sum to the bassinage.

## J16. Duration advice

The reason the app exists: telling the pizzaiolo whether a cold proof is too
long or too short for the flour they picked and the fridge they own. Every step
here is done from the Recipe tab with the house protocol loaded.

1. At 37 °F on Caputo Cuoco, a 66 hour cold proof reads "About right", and the
   window quoted is roughly 27 to 72 hours.
2. Raising the fridge to 43 °F and changing nothing else flips the same 66 hours
   to a too-long verdict, because enzymes run faster in a warmer fridge.
3. Dropping the fridge to 34 °F widens the window instead.
4. Switching to a stronger flour at a fixed fridge temperature lengthens the
   window; switching to a weaker one shortens it.
5. On a flour too weak to carry a 24 hour biga and a long cold proof, the app
   says so in those terms rather than quoting a window starting at zero.
6. A short cold proof, say 8 hours, is called short.
7. The button offering a duration sets exactly that duration, and the verdict
   then reads "About right".
8. The phase table shows both clocks, and the cold proof line carries far more
   maturation units than fermentation units.
9. Inoculation is reported before the freeze buffer, and the scaling button is
   absent when the yeast already suits the schedule.

## J19. Catching up

Running late has two answers and they are not the same for the dough, because
an hour lost on a warm bench is worth several hours in a fridge.

1. When behind, the app offers both moving the launch and holding it while
   cutting the slip out of a chosen phase.
2. The phase to cut from can be changed, and only phases that have not finished
   and have a single duration knob are offered.
3. Each option states the maturation the dough will end on, and cutting the
   clock slip sheds less maturation than the delay added.
4. Taking a cut actually shortens that phase in the schedule.
5. Maturation is judged against what the flour can absorb, not against the
   current plan, so trimming a phase cannot move the target with it.
6. When the projection is over the flour's budget, a cut sized to bring it back
   inside is offered as well.
