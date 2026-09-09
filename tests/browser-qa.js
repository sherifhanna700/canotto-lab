/*
 * Browser QA for Canotto Lab.
 *
 * Executes tests/qa-plan.md against the running app, in a real browser, driving
 * the same events a person's fingers produce. Model behaviour is covered by
 * tests/run.mjs; this covers the things only a browser can tell you, which is
 * where nearly every defect in this app has actually been.
 *
 * Load it into the page and call:  await window.canottoQA()
 * It returns { passed, failed, lines }.
 */
(function () {
  /*
   * The app renders synchronously: an input event updates the model, which
   * re-renders before the handler returns. So yielding a microtask is enough
   * between steps, and using real timers would be actively harmful, since a
   * background tab has its timers clamped to one per second and the run would
   * take minutes instead of milliseconds.
   */
  const sleep = () => Promise.resolve();
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];

  const tabs = () => $$('#tabs .tab');
  const tabName = () => $('#tabs .tab.active').textContent.replace(/^[a-z_]+/, '');
  const cards = () => $$('#main .card, #main .phase');
  const stored = () => JSON.parse(localStorage.getItem('canotto-lab/v1') || 'null');

  const labelled = (name, exact = true) =>
    $$('#main label.field').find((l) => {
      const t = l.querySelector('.field-label').textContent.trim();
      return exact ? t === name : t.startsWith(name);
    });

  const numberFields = () => $$('#main input[type=number]');
  const byKey = (k) => $$('#main input, #main textarea, #main select').find((e) => e.dataset.k === k);
  const button = (text) => $$('#main button').find((b) => b.textContent.includes(text));
  const statValue = (name) =>
    $$('#main .stat').find((s) => s.querySelector('.stat-label').textContent === name)?.querySelector('.stat-value').textContent;

  async function goTab(i) {
    tabs()[i].click();
    await sleep(120);
  }

  /** Type into a field the way a keyboard does: focus, then one key at a time. */
  async function typeInto(el, text, { clearFirst = true } = {}) {
    // A field inside a closed foldout cannot be focused, and a hidden input is
    // not something a person can type into. Open the way to it first.
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    el.focus();
    if (clearFirst) {
      el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(10);
    }
    const cleared = el.value === '';
    const survived = [];
    /*
     * Build the text locally rather than reading value back between keys.
     * A number input reports an empty value for an intermediate state like
     * "0.", so appending to el.value would silently drop the "0." and turn
     * 0.3 into 3. A keyboard types into the raw buffer, and so does this.
     */
    let buffer = cleared ? '' : el.value;
    for (const ch of text) {
      survived.push(document.activeElement === el || byKey(el.dataset.k) === el);
      buffer += ch;
      el.value = buffer;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(6);
    }
    const typed = el.value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await sleep(45);
    return { cleared, typed, nodeSurvived: survived.every(Boolean) };
  }

  window.canottoQA = async function canottoQA() {
    const lines = [];
    // Exposed live so a long run can be watched rather than waited on.
    window.canottoQAProgress = lines;
    let passed = 0;
    let failed = 0;
    const check = (id, ok, detail = '') => {
      if (ok) passed += 1;
      else failed += 1;
      lines.push(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
      return ok;
    };

    /* -------------------------------- J1 -------------------------------- */
    /*
     * Must start from a freshly loaded page. Clearing storage here would not
     * help: the app holds its state in memory from load, so a dirty session
     * would produce failures that look like regressions and are not.
     */
    /*
     * Read what the app is actually showing, not what is in storage. The app
     * holds its state in memory from load, so clearing storage without a
     * reload leaves it running on the old data and every check downstream
     * fails for the wrong reason.
     */
    await goTab(0);
    const openingRows = $$('#main .item-title').length;
    const opening = stored();
    if (openingRows > 1 || (opening && opening.bakes.length)) {
      return {
        passed: 0,
        failed: 1,
        lines: ['FAIL  precondition: run this on a fresh page. Do localStorage.clear() then reload, then run again.'],
      };
    }
    location.hash = '#recipe';
    await goTab(0);

    const names = [];
    for (let i = 0; i < tabs().length; i += 1) {
      await goTab(i);
      const broke = $$('#main .note.bad').some((n) => /went wrong/.test(n.textContent));
      names.push(tabName());
      check(`J1.1 ${tabName()} renders`, !broke && cards().length > 0, `${cards().length} cards`);
    }
    check('J1.1 five tabs', names.length === 5, names.join(', '));

    await goTab(0);
    check('J1.2 one recipe, the house protocol',
      $$('#main .item-title').length === 1 && /house/i.test($$('#main .item-title')[0].textContent),
      $$('#main .item-title').map((e) => e.textContent).join(', '));

    const fridge = labelled('Cold ferment temperature');
    const room = labelled('Room temperature');
    check('J1.3 defaults',
      fridge?.querySelector('input').value === '37' && room?.querySelector('input').value === '70',
      `fridge ${fridge?.querySelector('input').value}, room ${room?.querySelector('input').value}`);
    check('J1.4 build id shown', /Build \w+/.test($('.foot p').textContent), $('.foot p').textContent.split('Build ')[1] || '');

    /* -------------------------------- J2 -------------------------------- */
    for (let t = 0; t < tabs().length; t += 1) {
      await goTab(t);
      const tab = tabName();
      const keys = numberFields().map((e) => e.dataset.k);
      for (const key of keys) {
        const el = byKey(key);
        if (!el) continue;
        const step = parseFloat(el.step) || 1;
        const min = el.min === '' ? null : parseFloat(el.min);
        const max = el.max === '' ? null : parseFloat(el.max);
        let target = step < 1 ? (min ?? 0) + step * 3 : (min !== null ? min + step : 12);
        if (max !== null && target > max) target = max;
        target = Math.round(target * 1000) / 1000;
        const text = String(target);

        const r = await typeInto(el, text);
        const settled = byKey(key)?.value;
        check(`J2 ${tab}/${key}`,
          r.cleared && r.typed === text && r.nodeSurvived && Number(settled) === target,
          `clear:${r.cleared ? 'y' : 'N'} node:${r.nodeSurvived ? 'kept' : 'REPLACED'} "${text}"->"${r.typed}"->"${settled}"`);
      }
    }

    // J2.5 decimals, on the field with the finest step
    await goTab(0);
    const yeast = byKey('Inoculation');
    if (yeast) {
      const r = await typeInto(yeast, '0.085');
      check('J2.5 decimals can be typed', r.typed === '0.085' && Number(byKey('Inoculation').value) === 0.085, `got "${r.typed}"`);
    }

    // J2.6 out of range is corrected on leaving, not while typing
    const salt = byKey('Salt');
    if (salt) {
      const r = await typeInto(salt, '99');
      const after = Number(byKey('Salt').value);
      check('J2.6 bounds applied on leaving', r.typed === '99' && after <= Number(salt.max || 99), `typed 99, settled ${after}`);
    }

    /* -------------------------------- J3 -------------------------------- */
    await goTab(4);
    const make = labelled('Make')?.querySelector('input');
    const r3 = await typeInto(make, 'Gozney');
    check('J3.1 capitals survive, element kept', r3.typed === 'Gozney' && r3.nodeSurvived, `"${r3.typed}" node ${r3.nodeSurvived ? 'kept' : 'REPLACED'}`);
    check('J3.3 derived summary catches up', statValue('Oven') === 'Gozney', `summary "${statValue('Oven')}"`);

    await goTab(0);
    const nameField = labelled('Recipe name')?.querySelector('input');
    const r3b = await typeInto(nameField, 'Friday Dough');
    check('J3.2 name persists', byKey('Recipe name')?.value === 'Friday Dough', `"${r3b.typed}"`);
    check('J3.3 header follows the name', $('#brand-sub').textContent === 'Friday Dough', `"${$('#brand-sub').textContent}"`);

    /* -------------------------------- J4 -------------------------------- */
    button('New recipe').click();
    await sleep(150);
    const steps = $$('#main h3').map((h) => h.textContent);
    check('J4.1 five step form', steps.length >= 5, steps.join(' / '));
    const newName = labelled('Recipe name')?.querySelector('input');
    await typeInto(newName, 'Nuvola test');
    const flourSel = $$('#main select')[0];
    flourSel.value = 'caputo-nuvola-super';
    flourSel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    check('J4.2 inputs take', byKey('Recipe name')?.value === 'Nuvola test', byKey('Recipe name')?.value);
    button('Create recipe').click();
    await sleep(200);
    const titles = $$('#main .item-title').map((e) => e.textContent);
    check('J4.3 created and loaded', titles.includes('Nuvola test') && $$('#main .item.active .item-title')[0]?.textContent === 'Nuvola test', titles.join(', '));

    await goTab(1);
    const bigaStep = $('#main .step-body')?.textContent || '';
    check('J4.4 protocol reflects the recipe', /Nuvola Super/.test(bigaStep), bigaStep.slice(0, 80));

    /* -------------------------------- J5 -------------------------------- */
    await goTab(0);
    const beforeCount = $$('#main .item').length;
    button('Duplicate').click();
    await sleep(200);
    check('J5.1 duplicate', $$('#main .item').length === beforeCount + 1, `${beforeCount} -> ${$$('#main .item').length}`);
    const houseRow = $$('#main .item').find((i) => /house/i.test(i.textContent));
    check('J5.3 house offers Restore not Delete',
      !!houseRow && /Restore/.test(houseRow.textContent) && !/Delete/.test(houseRow.textContent),
      houseRow ? [...houseRow.querySelectorAll('.item-actions button')].map((b) => b.textContent.replace(/^[a-z_]+/, '')).join(',') : 'no house row');

    lines.push('     (J14 needs the shipped protocol loaded; run canottoQAHouse() on a fresh page)');

    /* -------------------------------- J6 -------------------------------- */
    const recompute = () => button('Recompute');
    recompute().click();
    await sleep(200);
    check('J6.1 disabled once applied', recompute().disabled === true);
    const f = byKey('Cold ferment temperature');
    await typeInto(f, String(Number(f.value) + 1));
    check('J6.2 one degree enables it', recompute().disabled === false, `fridge now ${byKey('Cold ferment temperature')?.value}`);
    recompute().click();
    await sleep(200);
    check('J6.3 recompute settles', recompute().disabled === true);

    /* -------------------------------- J7 -------------------------------- */
    await goTab(1);
    const firstTime = () => $('#main .step-time')?.textContent;
    const t0 = firstTime();
    const launch = $('#main input[type="datetime-local"]');
    launch.value = '2026-10-02T18:00';
    launch.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(150);
    check('J7.1 times follow the launch time', firstTime() !== t0, `${t0} -> ${firstTime()}`);

    // A mobile date picker commits with change, not input. Both must work.
    const t1 = firstTime();
    launch.value = '2026-10-03T12:30';
    launch.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep();
    check('J7.1 a date picker commit is honoured', firstTime() !== t1, `${t1} -> ${firstTime()}`);

    // And the phases drive the start time.
    await goTab(0);
    const proof = byKey('Cold proof');
    const startBefore = () => { const c = $$('#main .stat').find((x) => x.querySelector('.stat-label').textContent === 'Start mixing'); return c?.querySelector('.stat-value').textContent; };
    await typeInto(proof, String(Number(proof.value) - 24));
    await goTab(1);
    const startAfter = startBefore();
    await goTab(0);
    await typeInto(byKey('Cold proof'), String(Number(byKey('Cold proof').value) + 24));
    await goTab(1);
    check('J7.2 shortening the cold proof moves the first mix later',
      startAfter !== startBefore(), `${startAfter} with 24 h less, ${startBefore()} with it back`);

    const beforeChecks = $('#progress-text').textContent;
    $('#main .step-check').click();
    await sleep(150);
    check('J7.3 progress counts', $('#progress-text').textContent !== beforeChecks, `${beforeChecks} -> ${$('#progress-text').textContent}`);

    /* ------------------------------- J12 -------------------------------- */
    await goTab(0);
    const grams = (label) => {
      const row = $$('#main table tr').find((r) => r.textContent.trim().startsWith(label));
      return row ? [...row.children].map((c) => parseFloat(c.textContent)) : null;
    };
    const water = grams('Water');
    check('J12.1 water columns add up', water && Math.abs(water[3] + water[4] - water[2]) < 0.01, water ? `${water[3]} + ${water[4]} = ${water[2]}` : 'no row');
    const bass = parseFloat(statValue('Bassinage'));
    const wash = parseFloat(statValue('Salt wash'));
    check('J12.2 bassinage plus salt wash is the final mix water', Math.abs(bass + wash - water[4]) < 0.01, `${bass} + ${wash} vs ${water[4]}`);
    const doseText = $$('#main .stat').find((s) => s.querySelector('.stat-label').textContent === 'Bassinage')?.querySelector('.stat-sub').textContent;
    /*
     * Two forms: "3 doses of 66 g" when they divide evenly, and
     * "doses of 8, 8, 7 g" when they do not. Read them differently.
     */
    const evenly = doseText.match(/^(\d+) doses of ([\d.]+) g$/);
    const doseSum = evenly
      ? Number(evenly[1]) * Number(evenly[2])
      : (doseText.match(/[\d.]+/g) || []).map(Number).reduce((a, b) => a + b, 0);
    check('J12.3 doses sum to the bassinage', Math.abs(doseSum - bass) < 0.01, `${doseText} -> ${doseSum} vs ${bass}`);

    /* ------------------------------- J15 -------------------------------- */
    await goTab(1);
    const targetField = $$('#main label.field').find((l) => l.querySelector('.field-label').textContent.trim() === 'Biga water temperature');
    const hintText = targetField?.querySelector('.hint')?.textContent || '';
    const bounds = (hintText.match(/-?\d+/g) || []).map(Number);
    for (const [end, value] of [['low', bounds[0]], ['high', bounds[1]]]) {
      const el = targetField.querySelector('input');
      await typeInto(el, String(value));
      const verdict = $$('#main label.field')
        .find((l) => l.querySelector('.field-label').textContent.trim() === 'Biga water temperature')
        ?.querySelector('.pill')?.textContent;
      check(`J15.1 the ${end} end of "${hintText.trim()}" reads as on target`, verdict === 'On target', `${value} -> ${verdict}`);
    }

    // Enter must finish the field, not hand focus to whatever comes next.
    const enterField = $$('#main input[type=number]')[0];
    enterField.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    enterField.focus();
    const scrollBefore = window.scrollY;
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    enterField.dispatchEvent(ev);
    await sleep();
    check('J15.3 Enter finishes the field and stays put',
      ev.defaultPrevented && document.activeElement !== enterField && window.scrollY === scrollBefore,
      `prevented ${ev.defaultPrevented}, focus left ${document.activeElement !== enterField}, scroll ${scrollBefore} -> ${window.scrollY}`);

    // A foldout must survive a redraw, or it snaps shut mid-edit.
    await goTab(0);
    const fold = $$('#main details')[0];
    fold.open = true;
    const summary = fold.querySelector('summary').textContent;
    await typeInto(byKey('Salt'), '2.9');
    const still = $$('#main details').find((d) => d.querySelector('summary').textContent === summary);
    check('J15.4 an open foldout stays open through a redraw', !!still?.open, `"${summary}" ${still?.open ? 'still open' : 'CLOSED'}`);

    /* ------------------------------- J13 -------------------------------- */
    await goTab(0);
    const slider = $$('#main input[type=range]').find((e) => e.dataset.k === 'Hydration');
    check('J13.1 sliders leave vertical gestures to the page',
      getComputedStyle(slider).touchAction.includes('pan-y'),
      `touch-action: ${getComputedStyle(slider).touchAction}`);

    // Mid-drag, something else asks for a redraw. The thumb must not move.
    slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    slider.value = String(Number(slider.value) + 4);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    const held = slider.value;
    const other = byKey('Recipe name');
    other.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    other.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await sleep();
    const stillThere = $$('#main input[type=range]').find((e) => e.dataset.k === 'Hydration');
    check('J13.2 a redraw mid-drag does not move the thumb',
      stillThere === slider && stillThere.value === held,
      `element ${stillThere === slider ? 'kept' : 'REPLACED'}, thumb ${held} -> ${stillThere?.value}`);

    // Releasing commits and lets the screen catch up.
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await sleep();
    check('J13.3 releasing commits the value',
      Number(stored().current.recipe.hydrationPct) === Number(held),
      `model ${stored().current.recipe.hydrationPct}, thumb ${held}`);

    /* -------------------------------- J8 -------------------------------- */
    await goTab(2);
    const ambient = labelled('Ambient temperature')?.querySelector('input');
    await typeInto(ambient, '64');
    check('J8.1 conditions take input', Number(byKey('Ambient temperature')?.value) === 64, byKey('Ambient temperature')?.value);
    const score = $$('#main select').find((s) => s.closest('label')?.textContent.includes('Canotto height'));
    score.value = '4';
    score.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    button('File this bake in the log').click();
    await sleep(250);
    check('J8.2 filed and shown in the log', tabName() === 'Log' && stored().bakes.length === 1, `${stored().bakes.length} bakes, on ${tabName()}`);

    /* -------------------------------- J9 -------------------------------- */
    const files = [];
    const realCreate = URL.createObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (b) => { files.push(b); return realCreate(b); };
    HTMLAnchorElement.prototype.click = function () { if (files.length) files[files.length - 1].fname = this.download; };
    button('Export JSON').click();
    await sleep(120);
    button('Export CSV').click();
    await sleep(120);
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    const jsonText = await files[0].text();
    const csvText = await files[1].text();
    let parsed = null;
    try { parsed = JSON.parse(jsonText); } catch (e) { /* reported below */ }
    check('J9.1 log JSON valid and self-describing',
      !!parsed && /log\.schema\.json$/.test(parsed.$schema) && parsed.bakes.length === 1,
      parsed ? parsed.$schema.split('/').pop() : 'unparseable');
    check('J9.2 log CSV has a header and a row', csvText.split('\n').length === 2 && csvText.startsWith('id,'), `${csvText.split('\n').length} lines`);

    /* ------------------------------- J10 -------------------------------- */
    await goTab(4);
    const beforeUnit = byKey('Cold ferment temperature')?.value;
    $('#unit-toggle').click();
    await sleep(150);
    const afterUnit = byKey('Cold ferment temperature')?.value;
    check('J10.1 units convert, not reinterpret',
      Math.abs(Number(afterUnit) - ((Number(beforeUnit) - 32) * 5) / 9) < 0.2,
      `${beforeUnit} °F -> ${afterUnit} °C`);
    $('#unit-toggle').click();
    await sleep(150);

    const themes = [];
    for (let i = 0; i < 3; i += 1) { $('#theme-toggle').click(); await sleep(80); themes.push(document.documentElement.dataset.theme); }
    check('J10.2 theme cycles and sets color-scheme',
      new Set(themes).size >= 2 && getComputedStyle(document.documentElement).colorScheme === document.documentElement.dataset.theme,
      themes.join(' -> '));

    /* ------------------------------- J16 -------------------------------- */
    /*
     * The advice the app exists to give. Everything here is read off the
     * screen, because the point is what the pizzaiolo is told, not what the
     * model computes.
     */
    await goTab(0);
    const setNum = async (label, v) => {
      const el = labelled(label, false)?.querySelector('input[type=number]');
      if (!el) return false;
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await sleep();
      return true;
    };
    const setFlour = async (match) => {
      const sel = $$('#main select').find((x) => [...x.options].some((o) => match.test(o.text)));
      if (!sel) return false;
      sel.value = [...sel.options].find((o) => match.test(o.text)).value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep();
      return true;
    };
    /*
     * Scope every reading to the Phases card. "Cold proof" also appears as a
     * stat label on the Inputs card, and reading that one silently answers a
     * different question.
     */
    const phases = () => cards().find((c) => /^Phases/.test(c.querySelector('h2, h3')?.textContent || ''));
    const phaseStat = (name) => $$('.stat', phases())
      .find((x) => x.querySelector('.stat-label')?.textContent === name);
    /*
     * The cold proof field carries its own verdict and target, because it is
     * the one input with a right answer. Read it off the field, not off a
     * stat card, so this checks what the field actually says.
     */
    const proofHint = () => labelled('Cold proof', false)?.querySelector('.hint')?.textContent.trim() || '';
    const proofVerdict = () => proofHint().split('\u00b7')[0].trim();
    const wants = () => (proofHint().split('\u00b7')[1] || '').replace(/wants/, '').trim();
    const adviceNote = () => $$('#main .note')
      .map((n) => n.textContent)
      .find((t) => /wants|maturation units/.test(t)) || '';

    /*
     * Earlier journeys leave the recipe forked and the schedule deliberately
     * mangled, so start from known ground using the app's own Restore.
     */
    /*
     * J2 types into every number field it can find, and the fermentation
     * constants on Setup are number fields, so the model itself needs putting
     * back before any of the advice below means anything.
     */
    await goTab(4);
    button('Reset to defaults')?.click();
    await sleep();
    await goTab(0);
    button('Restore')?.click();
    await sleep();
    $$('.modal-actions button').find((b) => b.textContent.trim() === 'Restore')?.click();
    await sleep();
    check('J16.0 the house protocol restores as shipped',
      /W 310/.test(statValue('Strength') || '') && Number(labelled('Cold proof', false)?.querySelector('input').value) === 66,
      `${statValue('Strength')}, ${labelled('Cold proof', false)?.querySelector('input').value} h`);
    check('J16.0b the fermentation model is back to defaults',
      Math.abs(stored().settings.model.q10Enzyme - 1.65) < 0.001,
      `enzyme Q10 ${stored().settings.model.q10Enzyme}`);
    const at37 = proofVerdict();
    const window37 = wants();
    check('J16.1 66 h at 37 F on Cuoco is about right', at37 === 'About right', `${window37} -> ${at37}`);

    await setNum('Cold ferment temperature', 43);
    const at43 = proofVerdict();
    check('J16.2 the same 66 h at 43 F is called too long',
      /long/i.test(at43 || ''), `${wants()} -> ${at43}`);

    await setNum('Cold ferment temperature', 34);
    const hoursIn = (t) => (t || '').match(/\d+/g)?.map(Number) || [];
    const cold34 = hoursIn(wants());
    await setNum('Cold ferment temperature', 37);
    const cold37 = hoursIn(window37);
    check('J16.3 a colder fridge widens the window',
      cold34[cold34.length - 1] > cold37[cold37.length - 1],
      `34 F: ${cold34.join('-')} vs 37 F: ${cold37.join('-')}`);

    await setFlour(/Polselli Super|Super/);
    const strongWindow = hoursIn(wants());
    await setFlour(/Nuvola/);
    const weakWindow = hoursIn(wants());
    check('J16.4 flour strength moves the window',
      strongWindow[strongWindow.length - 1] > weakWindow[weakWindow.length - 1],
      `strong ${strongWindow.join('-')} vs weak ${weakWindow.join('-')}`);

    check('J16.5 a flour too weak for the biga is told so in those terms',
      /maturation units .* can take/.test(adviceNote()) && !/wants 0 to/.test(adviceNote()),
      adviceNote().slice(0, 90));

    await setFlour(/Cuoco/);
    await setNum('Cold proof', 8);
    check('J16.6 8 h is called short', /short/i.test(proofVerdict() || ''), `${wants()} -> ${proofVerdict()}`);

    const fixBtn = button('Set it to');
    const asked = Number((fixBtn?.textContent.match(/\d+/) || [0])[0]);
    fixBtn?.click();
    await sleep();
    const proofNow = Number(labelled('Cold proof', false)?.querySelector('input').value);
    check('J16.7 taking the suggestion satisfies the app',
      asked > 0 && proofNow === asked && proofVerdict() === 'About right',
      `set ${asked} h, field reads ${proofNow}, verdict ${proofVerdict()}`);

    const phaseFold = $$('#main details').find((d) => /Phase by phase/.test(d.textContent));
    if (phaseFold) phaseFold.open = true;
    await sleep();
    const proofRow = $$('#main tbody tr').find((r) => /Cold proof/.test(r.children[0]?.textContent));
    const rowFU = Number(proofRow?.children[4]?.textContent);
    const rowMU = Number(proofRow?.children[5]?.textContent);
    check('J16.8 the cold proof matures far more than it ferments',
      rowMU > rowFU * 3, `${rowFU} FU against ${rowMU} MU`);

    check('J16.9 inoculation is quoted before the freeze buffer',
      /instant dry before any freeze buffer/.test($$('#main .note').map((n) => n.textContent).join(' ')),
      '');

    await setNum('Cold proof', 66);
    await setNum('Cold ferment temperature', 37);

    /* ------------------------------- J17 -------------------------------- */
    /*
     * Real times. A plan is wrong the moment something runs late, and the
     * whole point of ticking a box is that the app records when it actually
     * happened rather than when it was supposed to.
     */
    await goTab(1);
    const stepBy = (re) => $$('#main .step').find((el) => re.test(el.querySelector('.step-title')?.textContent || ''));
    const tick = async (re) => { stepBy(re)?.querySelector('.step-check')?.click(); await sleep(); };

    const before = Date.now();
    await tick(/Ambient yeast awakening rest/);
    const stamped = stored()?.current?.doneAt?.['p1-3'];
    check('J17.1 checking a step records the wall clock',
      Number.isFinite(stamped) && stamped >= before && stamped <= Date.now() + 1000,
      stamped ? new Date(stamped).toISOString() : 'nothing recorded');

    await tick(/Cold ferment at/);
    await tick(/Tear the biga/);
    const marks = stored()?.current?.doneAt || {};
    check('J17.2 each timed step gets its own stamp',
      ['p1-3', 'p1-4', 'p2-1'].every((id) => Number.isFinite(marks[id])),
      Object.keys(marks).join(', '));

    const actualCardEl = cards().find((c) => /Where you actually are/.test(c.textContent));
    check('J17.3 the actual-times card appears once something is timed', !!actualCardEl,
      actualCardEl ? 'shown' : 'MISSING');

    /*
     * Rewrite one stamp through the editor the way a person correcting a late
     * tick would, and check the phase length follows it.
     */
    const editor = $$('#main input[type=datetime-local]').find((i) => i.dataset.k === 'stamp-p1-4');
    if (editor) {
      const start = marks['p1-3'];
      const target = new Date(start + 4 * 3600000 - new Date(start).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      editor.value = target;
      editor.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep();
    }
    const rows = $$('#main tbody tr').filter((r) => /Biga ambient rest/.test(r.children[0]?.textContent || ''));
    // The picker only has minute precision, so an edited stamp lands within a
    // minute of the target rather than exactly on it.
    check('J17.4 correcting a stamp changes the phase it bounds',
      !!editor && /^(4 h|3 h 59 m)$/.test((rows[0]?.children[2]?.textContent || '').trim()),
      rows[0] ? [...rows[0].children].map((c) => c.textContent.trim()).join(' | ') : 'no row');

    check('J17.5 an untimed phase is not claimed as measured',
      $$('#main tbody tr').some((r) => /Cold proof/.test(r.children[0]?.textContent || '') && /\u2014/.test(r.children[2]?.textContent || '')),
      'cold proof shows a dash');

    /* Unticking must take the stamp with it, or a stale time survives. */
    await tick(/Tear the biga/);
    check('J17.6 unchecking a step drops its recorded time',
      !Number.isFinite(stored()?.current?.doneAt?.['p2-1']),
      JSON.stringify(Object.keys(stored()?.current?.doneAt || {})));

    await goTab(0);

    /* ------------------------------- J11 -------------------------------- */
    const snapshot = stored();
    check('J11.1 state persisted', !!snapshot && snapshot.recipes.length >= 2 && snapshot.bakes.length === 1,
      `${snapshot?.recipes.length} recipes, ${snapshot?.bakes.length} bakes`);

    const broken = JSON.parse(JSON.stringify(snapshot));
    broken.current.schedule.roomTempC = -14.44;
    localStorage.setItem('canotto-lab/v1', JSON.stringify(broken));
    lines.push('     (reload required for J11.2, run canottoQAAfterReload() next)');

    return { passed, failed, lines };
  };

  /**
   * J14, which has to begin with the shipped protocol loaded, so it runs on a
   * fresh page rather than after the rest of the sweep.
   */
  window.canottoQAHouse = async function () {
    const out = [];
    const say = (id, ok, detail) => out.push(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
    const st = () => JSON.parse(localStorage.getItem('canotto-lab/v1') || 'null');
    const field = (n) => [...document.querySelectorAll('#main label.field')]
      .find((l) => l.querySelector('.field-label').textContent.trim() === n)?.querySelector('input');
    const bar = () => document.getElementById('save-bar');
    const barButton = (t) => [...bar().querySelectorAll('button')].find((b) => b.textContent.includes(t));
    const type = async (el, value) => {
      el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await Promise.resolve();
    };
    const savedRecipe = () => { const s = st(); return s.recipes.find((r) => r.id === s.current.recipeId); };

    // Something has to be written before there is anything to compare against.
    document.getElementById('unit-toggle').click();
    document.getElementById('unit-toggle').click();
    await Promise.resolve();

    say('J14.0 the shipped protocol is loaded', savedRecipe().origin === 'house', savedRecipe().name);
    say('J14.2a no bar until something changes', bar().hidden, 'bar hidden');

    await type(field('Inoculation'), '0.09');
    say('J14.1 editing does not touch the stored recipe', savedRecipe().recipe.baseYeastPct === 0.1, `stored ${savedRecipe().recipe.baseYeastPct}%, draft ${st().current.recipe.baseYeastPct}%`);
    say('J14.2 the bar names the recipe and offers a way out',
      !bar().hidden && bar().textContent.includes(savedRecipe().name) && !!barButton('Discard'),
      bar().textContent.replace(/\s+/g, ' ').trim());
    say('J14.5a it offers a copy rather than an overwrite', !!barButton('Save as a copy'), barButton('Save as a copy') ? 'Save as a copy' : 'plain Save');

    const houseId = savedRecipe().id;
    const before = st().recipes.length;
    barButton('Save as a copy').click();
    await Promise.resolve();
    const after = st();
    const house = after.recipes.find((r) => r.id === houseId);
    say('J14.5 saving on the shipped protocol copies it',
      after.recipes.length === before + 1 && after.current.recipeId !== houseId && house.recipe.baseYeastPct === 0.1,
      `${before} -> ${after.recipes.length}, house still ${house.recipe.baseYeastPct}%, working on "${savedRecipe().name}"`);
    say('J14.3 the copy holds the edit and the bar goes', savedRecipe().recipe.baseYeastPct === 0.09 && bar().hidden, `copy ${savedRecipe().recipe.baseYeastPct}%`);

    // A plain save on a recipe of one's own.
    await type(field('Inoculation'), '0.12');
    say('J14.3a a normal recipe saves in place', !!barButton('Save') && !barButton('Save as a copy'), 'plain Save offered');
    barButton('Save').click();
    await Promise.resolve();
    say('J14.3b saved', savedRecipe().recipe.baseYeastPct === 0.12 && bar().hidden, `stored ${savedRecipe().recipe.baseYeastPct}%`);

    // Discard.
    await type(field('Inoculation'), '0.30');
    barButton('Discard').click();
    await Promise.resolve();
    say('J14.4 discard puts the draft back', field('Inoculation').value === '0.12' && savedRecipe().recipe.baseYeastPct === 0.12, `field reads ${field('Inoculation').value}`);

    return out.join('\n');
  };

  /** J14.6, the rescue, which needs a damaged saved state and a reload. */
  window.canottoQARescueSetup = function () {
    localStorage.setItem('canotto-lab/v1', JSON.stringify({
      version: 1,
      recipes: [{
        id: 'house-canotto', name: 'Contemporary Canotto (first run)', origin: 'house',
        createdAt: '2026-09-01T00:00:00.000Z',
        recipe: { hydrationPct: 70, baseYeastPct: 0.11, saltPct: 2.8, oilPct: 0.9, balls: 8, ballWeight: 275, yeastType: 'idy', prefermentFlourPct: 100, prefermentHydrationPct: 45, flours: [{ id: 'caputo-cuoco', pct: 100, stage: 'blend' }] },
        schedule: { coldProofHours: 66, fridgeTempC: 2.8, roomTempC: 21.1, bigaRestHours: 3.75, bigaColdHours: 17, temperHours: 4 },
      }],
      bakes: [],
      current: { recipeId: 'house-canotto' },
    }));
    return 'seeded a house protocol edited in place; reload and run canottoQARescueCheck()';
  };

  window.canottoQARescueCheck = function () {
    const s = JSON.parse(localStorage.getItem('canotto-lab/v1'));
    const house = s.recipes.find((r) => r.origin === 'house');
    const mine = s.recipes.find((r) => r.name === 'Contemporary Canotto (first run)');
    const ok = house && mine && house.recipe.baseYeastPct === 0.1 && mine.recipe.baseYeastPct === 0.11
      && mine.origin === 'user' && s.current.recipeId === mine.id;
    return `${ok ? 'PASS' : 'FAIL'}  J14.6 an edited shipped protocol is rescued  house back to ${house?.recipe.baseYeastPct}%, work kept as "${mine?.name}" at ${mine?.recipe.baseYeastPct}%, loaded ${s.recipes.find((r) => r.id === s.current.recipeId)?.name}`;
  };

  /** The half of J11 that needs a fresh load. */
  window.canottoQAAfterReload = function () {
    const room = [...document.querySelectorAll('#main label.field')]
      .find((l) => l.querySelector('.field-label').textContent.trim() === 'Room temperature')
      ?.querySelector('input');
    const ok = room && Math.abs(Number(room.value) - 70) < 1;
    return `${ok ? 'PASS' : 'FAIL'}  J11.2 impossible saved values repaired on load  room reads ${room?.value}`;
  };
})();
