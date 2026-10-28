# Research brief: how long can a flour actually go?

You are settling a modelling question for **Canotto Lab**, an app that plans
biga-based contemporary canotto pizza dough and judges whether a given schedule
suits a given flour. Its guidance is currently wrong in ways we have fixed, and
wrong in one way we cannot settle without you.

You do not need the app or its code. Everything needed is below. Answer the
questions from evidence, and say plainly where the evidence does not reach.

---

## 1. The model you are checking

The app runs two clocks over the same schedule.

- **Fermentation (yeast work).** One FU = one hour of yeast activity at 20 °C.
  Rate follows a Q10 law: **Q10 = 2 above 15 °C**, and **Q10 = 5.92 below it**
  (a steeper cold coefficient, fitted so that activity at 4 °C lands on a
  published ~10% of the 20 °C rate). This decides how much yeast to use.

- **Maturation (enzyme work).** One MU = one hour of enzyme activity at 20 °C.
  A single **Q10 = 1.65** across the whole range, flat enough that 4 °C retains
  ~45% of the 20 °C rate. This decides how long the dough can go before the
  gluten is degraded.

A schedule is a list of stages, each with hours and a temperature. Total
maturation is `Σ hours × rate(temp) × flourShare`, where `flourShare` is the
fraction of the total flour present at that stage (1.0 after the final mix;
0.45 during a 45% biga — **this weighting is new and is itself one of the
questions below**).

A flour is given a **budget in MU**, computed from its published maturation
window and the temperature that window was published at. Example: Caputo Cuoco
publishes 24–72 h at 3–4 °C, so its budget is `72 × rate(4 °C) = 32.3 MU`.
The app aims to spend 90% of the budget and warns above 100%.

### The reference schedule (the app's house protocol)

| Stage | Hours | Temp | Flour present |
|---|---|---|---|
| Biga ambient rest | 3.75 | 21.1 °C | 45% |
| Biga cold hold | 17 | 2.8 °C | 45% |
| Mix & bench | 1.75 | 21.1 °C | 100% |
| Balling | 0.25 | 21.1 °C | 100% |
| Cold proof | 66 | 2.8 °C | 100% |
| Counter temper | 4 | 21.1 °C | 100% |

Flour: 100% Caputo Cuoco (W 310). Hydration 70%, 45% of the flour in the biga.

---

## 2. The disagreement to resolve

With the corrected arithmetic, that schedule spends **39.2 MU** against Cuoco's
published budget of **32.3 MU** — **121%**. The app would now tell the baker
their dough is over-matured.

| Cold proof | Total MU | % of published budget |
|---|---|---|
| 24 h | 21.5 | 67% |
| 48 h | 31.6 | 98% |
| **66 h (as baked, reportedly well)** | **39.2** | **121%** |
| 72 h | 41.8 | 129% |

Either the model is still wrong, or a published window is not a ceiling for a
dough built on a preferment. **That is question 1.**

---

## 3. Questions, in priority order

For each: give an answer, a confidence (high / medium / low / unresolved), the
evidence, and — where it applies — the specific number or formula we should use.

**Q1. What does a mill's published maturation window actually cover?**
When Caputo says Cuoco is for "24–72 hours" at 3–4 °C, is that (a) the whole
process from first mix to bake, (b) only the final dough after mixing, with a
preferment's time additional and uncounted, or (c) a marketing range with no
precise meaning? This single answer decides whether a 21 h biga plus a 66 h
cold proof is legitimate or over the limit.

**Q2. How should a preferment's maturation be counted?**
We currently weight a biga's stages by its share of the flour (45% biga → its
hours count 0.45). Is that defensible? Alternatives: count it in full, not at
all, or by some other relation. Does enzyme activity in a stiff 45–50%
hydration biga differ enough from a full-hydration dough to matter? Note that a
biga is typically much drier than the final dough, and enzyme activity is
water-dependent.

**Q3. When a source gives hours with no temperature, what did it mean?**
Most published windows omit it, which makes them unusable — the same 24 hours is
a different dough on a worktop and in a fridge. We currently infer: windows
topping out at ≤24 h mean room temperature, >24 h mean refrigerated. Is that a
sound reading of industry convention? Give the convention if one exists.

**Q4. Is Q10 = 1.65 right for enzyme activity in dough between 2 °C and 25 °C?**
Everything above converts between temperatures through this number. Proteolysis
and amylase activity in wheat dough is the relevant mechanism. What does the
literature support, and does a single Q10 hold across that range or does it
need a break like the yeast curve does? If the value is wrong, every window
conversion in the app is wrong by a compounding factor.

**Q5. Does W predict how long a flour can go — and if so, how?**
W is the Chopin alveograph value, the work to inflate a bubble of dough. The
app previously mapped W bands straight to hours, which we removed as unsound.
Is there a defensible mapping from W (or P/L, protein, falling number) to a
maximum maturation time at a stated temperature? If there is not, say so — that
is a useful answer, since it means per-flour published windows are the only
honest source.

**Q6. Can water absorption be predicted from a flour's published specs?**
We removed hydration-from-W after finding it recommended 73–83% for a W 390
blending flour. Is absorption predictable from protein, damaged starch,
farinograph water absorption, or must it come per-flour from the mill? What is
the right default for a canotto-style dough?

**Q7. What do real contemporary canotto formulas actually do?**
Build a dataset of **at least 15** published biga canotto formulas from
pizzaioli, schools, or reputable publications. For each record: flour and its W,
biga percentage and hydration, biga time and temperature, bulk and balled proof
times and temperatures, final hydration, and the source. This is the empirical
check on Q1: if practitioners routinely run a 20 h biga plus a 60–72 h cold
proof on W 300–320 flour, then a published window is not a ceiling for
preferment doughs, whatever the mill's label says.

---

## 4. Evidence standards

These matter more than the conclusions. The bug that prompted this brief was
caused by hours recorded without the temperature they referred to.

- **Every time figure must carry its temperature.** If a source omits it, record
  the figure as "temperature unstated" rather than assuming one. Never convert a
  figure whose reference temperature is unknown.
- **Never average across sources with different reference temperatures.**
- **Source priority:** mill technical data sheets (*schede tecniche*, usually
  Italian, often PDF) and other primary specifications first; then professional
  bodies and standards (e.g. AVPN) and baking science literature; then
  professional pizzaioli and schools; blogs and aggregators last, and only as
  corroboration of something already found.
- **Quote exactly**, with the publication, URL, date accessed, and the original
  language where it is not English.
- **Record disagreement rather than resolving it silently.** Where two sources
  conflict, present both and say which is better founded and why.
- **"Unknown" is an acceptable answer** and is more useful than a plausible
  number. Do not invent, interpolate, or round a figure into existence.

---

## 5. What to return

1. **A direct answer to each of Q1–Q7**, each with a confidence rating and the
   evidence it rests on.
2. **An evidence table**: claim | exact quote | source | URL | date | temperature
   stated? (yes / no / inferred).
3. **Specific recommended changes**, as numbers and formulas we can implement:
   the Q10 to use, how to account for a preferment, what a flour's budget should
   be and from what, what to do when a window has no temperature.
4. **The Q7 dataset**, as a table.
5. **An explicit list of what you could not establish**, and what evidence would
   be needed to settle each — including whether anyone has actually measured
   gluten degradation against time and temperature in a pizza dough, or whether
   the whole published-window convention is practitioner heuristic.

Flag anything that contradicts the constants in section 1 directly, and say so
in plain terms.
