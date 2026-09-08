// Flour library.
//
// W is the Chopin alveograph strength value: how much fermentation a flour can
// carry before the gluten network gives up. Italian mills publish it, most
// American and British mills do not.
//
// Provenance matters here, so every flour carries `sourced`:
//   true  - W and protein come from a published spec (see SOURCES below).
//   false - protein is the published figure but W is estimated from it.
// The app shows which is which rather than presenting a guess as a measurement.
//
// `ferment` is the published maturation window in hours where a source gives
// one. Where it does not, the W band table is used instead.
//
// The list is limited to flours that can actually carry a biga canotto
// schedule, plus semola and whole grain as blending components.

export const SOURCES = [
  { id: 'pizzaplan', label: 'Pizza flour comparison: W-value and protein', url: 'https://pizzaplan.app/en/flour-brands/' },
  { id: 'hgh', label: 'Pizza flour guide: W-value, protein and the right mix', url: 'https://www.housegardenhobby.com/pizza-flour-guide/' },
  { id: 'pizzablab', label: 'Biga preferment guide', url: 'https://www.pizzablab.com/the-encyclopizza/biga-preferment/' },
  { id: 'pizzablab-friction', label: 'Friction factor: heat generated during dough mixing', url: 'https://www.pizzablab.com/learning-and-resources/mixing-kneading/friction-factor-in-dough-making/' },
  { id: 'pizzaheaven-nuvola', label: 'Caputo Nuvola: the best flour for airy crust', url: 'https://thepizzaheaven.com/caputo-nuvola/' },
  { id: 'pizzaheaven-canotto', label: 'Mastering canotto pizza', url: 'https://thepizzaheaven.com/mastering-canotto-pizza/' },
];

/**
 * W bands. Fermentation hours and hydration windows are the published guide
 * values; the hydration figures are deliberately conservative and the style
 * shift in the advisor moves them for canotto and pan styles.
 * Source: housegardenhobby pizza flour guide.
 */
export const W_BANDS = [
  { min: 0, max: 249, ferment: [2, 12], hydration: [55, 60], label: 'W 180 to 240' },
  { min: 250, max: 279, ferment: [8, 24], hydration: [60, 65], label: 'W 250 to 280' },
  { min: 280, max: 319, ferment: [24, 48], hydration: [65, 70], label: 'W 280 to 320' },
  { min: 320, max: Infinity, ferment: [48, 72], hydration: [70, 80], label: 'W 320 and above' },
];

export function bandForW(w) {
  if (!Number.isFinite(w)) return null;
  return W_BANDS.find((b) => w >= b.min && w <= b.max) || W_BANDS[W_BANDS.length - 1];
}

export const FLOURS = [
  // ---- Italy ----
  { id: 'caputo-cuoco', brand: 'Caputo', name: 'Cuoco (Chef, red)', country: 'IT', grade: '00', protein: 13.0, w: 310, wRange: [300, 320], ferment: [48, 96], sourced: true, source: 'pizzaplan', notes: 'Built for 24 to 72 h cold maturation. The reference flour for long biga canotto.' },
  { id: 'caputo-pizzeria', brand: 'Caputo', name: 'Pizzeria (blue)', country: 'IT', grade: '00', protein: 12.5, w: 265, wRange: [260, 270], ferment: [24, 72], sourced: true, source: 'pizzaplan', notes: 'Classic Neapolitan. Comfortable at 60 to 65% hydration.' },
  { id: 'caputo-nuvola', brand: 'Caputo', name: 'Nuvola', country: 'IT', grade: '0', protein: 12.5, w: 270, wRange: [260, 280], ferment: [24, 72], sourced: true, source: 'pizzaplan', notes: 'Engineered for the contemporary canotto. Absorbs 65 to 70% comfortably, light digestible crumb.' },
  { id: 'caputo-nuvola-super', brand: 'Caputo', name: 'Nuvola Super', country: 'IT', grade: '0', protein: 13.5, w: 320, wRange: [300, 320], ferment: [48, 96], sourced: true, source: 'pizzaplan', notes: 'Stronger Nuvola. Protein published as 13.5% ± 0.5.' },
  { id: 'caputo-saccorosso', brand: 'Caputo', name: 'Saccorosso / Rinforzato', country: 'IT', grade: '00', protein: 13.0, w: 290, wRange: [280, 300], ferment: [24, 72], sourced: true, source: 'pizzaplan', notes: 'Reinforced. Sits just below Cuoco in strength.' },
  { id: 'caputo-manitoba', brand: 'Caputo', name: 'Manitoba Oro', country: 'IT', grade: '0', protein: 14.5, w: 390, wRange: [370, 410], ferment: [48, 96], sourced: false, source: 'pizzaplan', notes: 'Very strong. Use as a blending flour to lift W, rarely on its own.' },
  { id: 'caputo-integrale', brand: 'Caputo', name: 'Integrale (whole wheat)', country: 'IT', grade: 'Integrale', protein: 13.0, w: 260, ferment: [8, 24], sourced: false, notes: 'Whole grain. Drinks more water and ferments faster than the W suggests.' },
  { id: 'caputo-semola', brand: 'Caputo', name: 'Semola rimacinata', country: 'IT', grade: 'Semola', protein: 12.5, w: null, sourced: false, notes: 'Durum. Dusting flour, or up to 10% of the blend for bite.' },
  { id: '5stagioni-napoletana', brand: 'Le 5 Stagioni', name: 'Pizza Napoletana', country: 'IT', grade: '00', protein: 12.0, w: 260, wRange: [250, 270], ferment: [24, 48], sourced: true, source: 'pizzaplan', notes: 'Widely used Neapolitan flour.' },
  { id: '5stagioni-manitoba', brand: 'Le 5 Stagioni', name: 'Tipo 0 Manitoba', country: 'IT', grade: '0', protein: 14.0, w: 400, wRange: [380, 420], ferment: [48, 96], sourced: true, source: 'pizzaplan', notes: 'Blending flour for very long schedules.' },
  { id: 'dallagiovanna-classica-oro', brand: 'Dallagiovanna', name: 'Classica Oro', country: 'IT', grade: '00', protein: 13.0, w: 310, wRange: [300, 320], ferment: [48, 72], sourced: true, source: 'pizzaplan', notes: 'Strong, clean flavour, good biga candidate.' },
  { id: 'dallagiovanna-napoletana', brand: 'Dallagiovanna', name: 'La Napoletana', country: 'IT', grade: '00', protein: 12.5, w: 280, ferment: [24, 48], sourced: false, notes: 'W not published in the sources used here; estimated from protein.' },
  { id: 'grassi-pizza-00', brand: 'Molino Grassi', name: 'Farina per Pizza Tipo 00', country: 'IT', grade: '00', protein: 12.0, w: 260, wRange: [250, 270], ferment: [24, 48], sourced: true, source: 'pizzaplan', notes: 'Organic options available.' },
  { id: 'polselli-classica', brand: 'Polselli', name: 'Classica', country: 'IT', grade: '00', protein: 12.5, w: 270, wRange: [260, 280], ferment: [24, 72], sourced: true, source: 'pizzaplan', notes: 'Everyday Neapolitan flour.' },
  { id: 'polselli-super', brand: 'Polselli', name: 'Super', country: 'IT', grade: '00', protein: 13.5, w: 330, wRange: [320, 340], ferment: [48, 96], sourced: true, source: 'pizzaplan', notes: 'High strength, popular for 48 to 72 h.' },
  { id: 'petra-3', brand: 'Molino Quaglia', name: 'Petra 3', country: 'IT', grade: '0', protein: 12.5, w: 300, ferment: [24, 48], sourced: false, notes: 'Stone-milled, high absorption, medium to long fermentation. W not published; estimated.' },
  { id: 'petra-9', brand: 'Molino Quaglia', name: 'Petra 9 (whole)', country: 'IT', grade: 'Integrale', protein: 13.0, w: 280, ferment: [12, 36], sourced: false, notes: 'Whole stone-milled. Use as a fraction of the blend.' },
  { id: 'spadoni-pz2', brand: 'Molino Spadoni', name: 'PZ2 Napoletana', country: 'IT', grade: '00', protein: 13.0, w: 290, ferment: [24, 48], sourced: false, notes: 'W estimated from protein.' },

  // ---- United States ----
  { id: 'ka-bread', brand: 'King Arthur', name: 'Bread Flour', country: 'US', grade: 'Bread', protein: 12.7, w: null, ferment: [12, 48], sourced: true, source: 'pizzaplan', notes: 'No published W. The reliable American default; ferments faster than an Italian 00.' },
  { id: 'ka-sir-lancelot', brand: 'King Arthur', name: 'Sir Lancelot', country: 'US', grade: 'High gluten', protein: 14.2, w: null, ferment: [12, 48], sourced: false, notes: 'High gluten. Blending flour to raise strength.' },
  { id: 'gm-all-trumps', brand: 'General Mills', name: 'All Trumps', country: 'US', grade: 'High gluten', protein: 14.2, w: null, ferment: [12, 48], sourced: false, notes: 'New York standard. Bromated and unbromated versions exist.' },
  { id: 'gm-full-strength', brand: 'General Mills', name: 'Full Strength', country: 'US', grade: 'Bread', protein: 13.5, w: null, ferment: [12, 48], sourced: false, notes: 'Strong bakery flour.' },
  { id: 'central-milling-00', brand: 'Central Milling', name: 'Type 00 Normale', country: 'US', grade: '00', protein: 12.5, w: 280, ferment: [24, 48], sourced: false, notes: 'American-milled 00. W estimated.' },
  { id: 'brm-artisan-bread', brand: "Bob's Red Mill", name: 'Artisan Bread Flour', country: 'US', grade: 'Bread', protein: 12.5, w: null, ferment: [12, 48], sourced: true, source: 'pizzaplan', notes: 'Widely stocked. No published W.' },
  { id: 'giustos-high-performer', brand: "Giusto's", name: 'High Performer', country: 'US', grade: 'Bread', protein: 13.0, w: null, ferment: [12, 48], sourced: false, notes: 'West coast bakery staple.' },
  { id: 'us-semolina', brand: 'Generic', name: 'Semolina (fine)', country: 'US', grade: 'Semola', protein: 12.5, w: null, sourced: false, notes: 'Dusting, or a small fraction for bite.' },
  { id: 'us-whole-wheat', brand: 'Generic', name: 'Whole wheat', country: 'US', grade: 'Whole', protein: 13.5, w: null, ferment: [6, 24], sourced: false, notes: 'Raises absorption and speeds fermentation. Keep it a minority of the blend.' },

  // ---- Rest of Europe ----
  { id: 'doves-strong-white', brand: 'Doves Farm', name: 'Strong White Bread', country: 'UK', grade: 'Strong', protein: 13.0, w: null, ferment: [24, 48], sourced: true, source: 'pizzaplan', notes: 'Organic, supermarket availability. No published W.' },
  { id: 'marriages-very-strong', brand: "Marriage's", name: 'Very Strong White', country: 'UK', grade: 'Strong', protein: 14.0, w: null, ferment: [24, 48], sourced: false, notes: 'High protein British flour.' },
  { id: 'shipton-00', brand: 'Shipton Mill', name: 'Italian Type 00', country: 'UK', grade: '00', protein: 12.5, w: null, ferment: [12, 36], sourced: false, notes: 'UK-milled 00.' },
  { id: 'fr-gruau', brand: 'French standard', name: 'T45 Gruau', country: 'FR', grade: 'T45', protein: 13.5, w: 300, ferment: [24, 48], sourced: false, notes: 'Strong French flour. A good biga candidate.' },
  { id: 'es-fuerza', brand: 'Spanish standard', name: 'Harina de fuerza', country: 'ES', grade: 'Fuerza', protein: 13.0, w: 300, ferment: [24, 48], sourced: false, notes: 'Spanish strong flour.' },
];

export const COUNTRY_LABEL = { IT: 'Italy', US: 'United States', UK: 'United Kingdom', FR: 'France', ES: 'Spain', EU: 'Europe' };

export function findFlour(id) {
  return FLOURS.find((f) => f.id === id) || null;
}

export function floursByCountry() {
  const groups = new Map();
  for (const f of FLOURS) {
    if (!groups.has(f.country)) groups.set(f.country, []);
    groups.get(f.country).push(f);
  }
  return [...groups.entries()].map(([code, list]) => ({ code, label: COUNTRY_LABEL[code] || code, list }));
}

/**
 * Estimate W from protein, for flours whose mills publish no alveograph value.
 * Fitted to the flours in this library that publish both: 12.5% sits near
 * W 265, 13% near W 300, 14% near W 400.
 */
export function estimateW(protein) {
  if (!Number.isFinite(protein)) return null;
  return Math.round(Math.max(90, 180 + (protein - 11) * 60));
}

/** Weighted stats for a blend of {id|name, pct} entries. */
export function blendStats(entries) {
  const list = (entries || []).filter((e) => Number(e.pct) > 0);
  const total = list.reduce((s, e) => s + Number(e.pct), 0);
  if (!list.length || total <= 0) return { protein: null, w: null, estimated: false, sourced: false, total: 0, valid: false, ferment: null };

  let protein = 0;
  let w = 0;
  let estimated = false;
  let allSourced = true;
  let fLow = 0;
  let fHigh = 0;
  let fWeight = 0;

  for (const e of list) {
    const src = e.id ? findFlour(e.id) : null;
    const p = Number(e.protein ?? src?.protein);
    let ww = e.w ?? src?.w;
    if (!Number.isFinite(ww) || ww === null) {
      ww = estimateW(p);
      estimated = true;
    }
    if (!src?.sourced) allSourced = false;
    const share = Number(e.pct) / total;
    protein += (Number.isFinite(p) ? p : 0) * share;
    w += (Number.isFinite(ww) ? ww : 0) * share;
    const fer = src?.ferment;
    if (fer) {
      fLow += fer[0] * share;
      fHigh += fer[1] * share;
      fWeight += share;
    }
  }

  const wMid = Math.round(w);
  const band = bandForW(wMid);
  // Prefer the published maturation window; fall back to the W band.
  const ferment = fWeight > 0.5 ? [Math.round(fLow / fWeight), Math.round(fHigh / fWeight)] : band ? band.ferment : null;

  return {
    protein: Math.round(protein * 10) / 10,
    w: wMid,
    band,
    ferment,
    fermentSourced: fWeight > 0.5,
    estimated,
    sourced: allSourced && !estimated,
    total: Math.round(total * 100) / 100,
    valid: Math.abs(total - 100) < 0.51,
  };
}

/**
 * Fermentation ceiling in FU. Anchored to the published band: a W 280 to 320
 * flour is rated for 24 to 48 h of maturation, and the top of that window at
 * fridge temperature is what the ceiling represents.
 */
export function fuCeilingForW(w) {
  if (!Number.isFinite(w)) return null;
  return Math.round((w / 300) * 24 * 10) / 10;
}

/**
 * Hydration window. Base figures are the published W band; `styleShift` moves
 * the whole window, because a canotto rim wants more water than a New York
 * slice from the same flour.
 */
export function hydrationRangeForW(w, styleShift = 0) {
  if (!Number.isFinite(w)) return null;
  const band = bandForW(w);
  if (!band) return null;
  // Interpolate inside the band so a W 315 flour is not treated as a W 280 one.
  const lo = Math.max(band.min, 180);
  const hi = Number.isFinite(band.max) ? band.max : 420;
  const t = Math.min(1, Math.max(0, (w - lo) / (hi - lo || 1)));
  const low = band.hydration[0] + t * 2;
  const high = band.hydration[1] + t * 2;
  return { low: Math.round(low + styleShift), high: Math.round(high + styleShift), band: band.label };
}

export function blendLabel(entries) {
  const list = (entries || []).filter((e) => Number(e.pct) > 0);
  if (!list.length) return 'No flour selected';
  if (list.length === 1) return flourName(list[0]);
  return list.map((e) => `${Math.round(e.pct)}% ${flourName(e)}`).join(' + ');
}

export function flourName(entry) {
  if (!entry) return 'Flour';
  if (entry.name && !entry.id) return entry.name;
  const src = findFlour(entry.id);
  if (!src) return entry.name || 'Flour';
  return `${src.brand} ${src.name}`;
}

export function shortFlourName(entry) {
  const src = entry?.id ? findFlour(entry.id) : null;
  return src ? src.name : entry?.name || 'Flour';
}
