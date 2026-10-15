// ===================================================================
// DE NULMETING (462) -- twintig minuten per telefoon, dan weet je wat hij ECHT kan
// ===================================================================
//
// Snelheden op oude chips zijn alleen schattingen; de enige eerlijke manier is meten. Deze meting draait vanuit Veronica tegen de
// OpenAI-adressen van de telefoon (de eigen motor op 8081 of OlliteRT op 8000) en is bedoeld om EEN KEER per telefoon te doen:
//
//   minuut 0        : beginmeting (accu, temperatuur, aan de lader?)
//   elke minuut     : accu en temperatuur noteren
//   minuut 1,3,...19: tien vragen, afwisselend KORT (24 tokens) en MIDDEN (120 tokens); de eerste is koud (model laden telt mee)
//   minuut 20       : eindmeting
//
// De meting STOPT zelf als het onveilig wordt: 45 graden of warmer, accu onder 15% zonder lader, drie mislukte vragen achter elkaar,
// of de noodstop. Dan is de uitslag "niet geslaagd" en de telefoon blijft HULP. De meting zet niets op de telefoon aan of uit.
//
// Dit bestand is ZUIVER: de vragen, de status en de klok komen van buiten (io). De uitslag past op `kiesEngine({ nulmeting })` in
// motorkeuze.js: de meting wint van de gok.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Nulmeting = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DUUR_MIN = 20;
  const MIN_TPS = 0.8;                 // dezelfde grens als NULMETING_MIN_TPS in motorkeuze.js
  const STOP_TEMP = 45;
  const WARM_TEMP = 42;
  const STOP_ACCU = 15;
  const MAX_ACHTER_ELKAAR = 3;
  const MAX_MISLUKT = 2;               // van tien

  const KORT = Object.freeze({ soort: 'kort', max_tokens: 24, prompt: "Tel van een tot twintig, met komma's ertussen." });
  const MIDDEN = Object.freeze({ soort: 'midden', max_tokens: 120, prompt: 'Schrijf drie korte zinnen over een haven aan een meer.' });

  // Het plan: [{ min, soort }], op volgorde. 'status' elke minuut, 'vraag' op de oneven minuten tot en met 19.
  function plan() {
    const p = [];
    for (let m = 0; m <= DUUR_MIN; m += 1) {
      p.push({ min: m, soort: 'status' });
      if (m >= 1 && m <= 19 && m % 2 === 1) p.push({ min: m, soort: 'vraag', vraag: (m - 1) / 2 % 2 === 0 ? KORT : MIDDEN, koud: m === 1 });
    }
    return p;
  }

  const mediaan = (l) => { if (!l.length) return null; const s = l.slice().sort((a, b) => a - b); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
  const rond = (x, n) => (x === null || x === undefined ? null : Math.round(x * (n || 10)) / (n || 10));

  // metingen: { status: [{ min, temp, accu, laadt }], vragen: [{ min, soort, ok, ms, tokens, koud }], afgebroken: reden|null }
  function beoordeel(m) {
    const st = (m && m.status) || []; const vr = (m && m.vragen) || [];
    const redenen = [];
    const goede = vr.filter((v) => v.ok && v.ms > 0 && v.tokens > 0);
    const tpsLijst = goede.map((v) => v.tokens * 1000 / v.ms);
    const tpsBin = goede.filter((v) => !v.koud).map((v) => v.tokens * 1000 / v.ms);
    const helft = Math.ceil(tpsBin.length / 2);
    const eerste = mediaan(tpsBin.slice(0, helft)); const tweede = mediaan(tpsBin.slice(helft));
    const geheel = mediaan(tpsBin.length ? tpsBin : tpsLijst);
    // Het volgehouden tempo is het langzaamste van "geheel" en "tweede helft": een telefoon die vertraagt door hitte telt zo eerlijk.
    const tps = geheel === null ? null : (tweede !== null ? Math.min(geheel, tweede) : geheel);
    const vertraagt = eerste !== null && tweede !== null && tweede < eerste * 0.6;
    const temps = st.map((s) => s.temp).filter((x) => typeof x === 'number');
    const tempMax = temps.length ? Math.max(...temps) : null;
    const tempStijging = temps.length ? temps[temps.length - 1] - temps[0] : null;
    const accus = st.map((s) => s.accu).filter((x) => typeof x === 'number');
    const accuVerschil = accus.length ? accus[accus.length - 1] - accus[0] : null;
    const laadt = st.length ? st.some((s) => s.laadt === true) : null;
    const mislukt = vr.filter((v) => !v.ok).length;
    let ok = true;
    if (m && m.afgebroken) { ok = false; redenen.push(`De meting is afgebroken: ${AFBREEK_ZIN[m.afgebroken] || m.afgebroken}.`); }
    if (vr.length < 6 && !(m && m.afgebroken)) { ok = false; redenen.push('Te weinig vragen beantwoord om iets te zeggen.'); }
    if (mislukt > MAX_MISLUKT) { ok = false; redenen.push(`${mislukt} van ${vr.length} vragen mislukten.`); }
    if (tps === null) { ok = false; redenen.push('Geen enkel antwoord gemeten.'); } else if (tps < MIN_TPS) { ok = false; redenen.push(`Te traag: ±${rond(tps)} tokens per seconde (minimaal ${MIN_TPS}).`); }
    if (tempMax !== null && tempMax >= STOP_TEMP) { ok = false; redenen.push(`Te warm: ${rond(tempMax)} graden.`); } else if (tempMax !== null && tempMax >= WARM_TEMP) redenen.push(`Warm: ${rond(tempMax)} graden; een ventilator of een koelere plek helpt.`);
    if (vertraagt) redenen.push('De snelheid zakte tijdens de meting (hitte of een zuinigheidsstand): het volgehouden tempo telt.');
    if (accuVerschil !== null && accuVerschil < -10 && laadt !== true) redenen.push(`De accu zakte ${Math.abs(accuVerschil)} procentpunt in twintig minuten zonder lader: alleen aan de lader inzetten.`);
    const advies = !ok ? 'hulp' : tps >= 8 ? 'zwaar' : tps >= 3 ? 'midden' : 'licht';
    if (ok) redenen.unshift(`Geslaagd: ±${rond(tps)} tokens per seconde volgehouden${tempMax !== null ? `, hoogstens ${rond(tempMax)} graden` : ''}.`);
    return { ok, tps: rond(tps), tpsPiek: rond(tpsLijst.length ? Math.max(...tpsLijst) : null), geschat: true, mislukt, van: vr.length, tempMax: rond(tempMax), tempStijging: rond(tempStijging), accuVerschil, laadt, vertraagt, advies, redenen };
  }

  const AFBREEK_ZIN = {
    'te-warm': `de telefoon werd te warm (${STOP_TEMP} graden)`, 'accu-laag': `de accu zakte onder ${STOP_ACCU}% zonder lader`,
    onbereikbaar: `${MAX_ACHTER_ELKAAR} vragen achter elkaar mislukten`, noodstop: 'de noodstop is gebruikt',
  };

  // De meting zelf. io: { vraag(v) -> { ok, ms, tokens }, status() -> { temp, accu, laadt }, wacht(ms) }, opties: { stop() -> bool }
  // Terug: de metingen (voor beoordeel). Gooit nooit; wat misgaat staat in `afgebroken`.
  async function voerUit(io, opties) {
    const o = opties || {};
    const metingen = { status: [], vragen: [], afgebroken: null };
    let achterElkaar = 0;
    let vorigeMin = 0;
    for (const stap of plan()) {
      if (stap.min > vorigeMin) { await io.wacht((stap.min - vorigeMin) * 60000); vorigeMin = stap.min; }
      if (o.stop && o.stop()) { metingen.afgebroken = 'noodstop'; break; }
      if (stap.soort === 'status') {
        let s = {};
        try { s = (await io.status()) || {}; } catch (e) { s = {}; }
        metingen.status.push({ min: stap.min, temp: typeof s.temp === 'number' ? s.temp : null, accu: typeof s.accu === 'number' ? s.accu : null, laadt: s.laadt === true });
        if (typeof s.temp === 'number' && s.temp >= STOP_TEMP) { metingen.afgebroken = 'te-warm'; break; }
        if (typeof s.accu === 'number' && s.accu < STOP_ACCU && s.laadt !== true) { metingen.afgebroken = 'accu-laag'; break; }
      } else {
        let r;
        try { r = await io.vraag(stap.vraag); } catch (e) { r = { ok: false }; }
        const ok = !!(r && r.ok);
        metingen.vragen.push({ min: stap.min, soort: stap.vraag.soort, ok, ms: ok ? r.ms : null, tokens: ok ? r.tokens : null, koud: !!stap.koud });
        achterElkaar = ok ? 0 : achterElkaar + 1;
        if (achterElkaar >= MAX_ACHTER_ELKAAR) { metingen.afgebroken = 'onbereikbaar'; break; }
      }
    }
    return metingen;
  }

  // De uitslag zoals motorkeuze.js hem wil: { ok, tps }.
  const voorKeuze = (u) => ({ ok: !!(u && u.ok), tps: u && typeof u.tps === 'number' ? u.tps : null });

  return { plan, beoordeel, voerUit, voorKeuze, KORT, MIDDEN, DUUR_MIN, MIN_TPS, STOP_TEMP, WARM_TEMP, STOP_ACCU, MAX_ACHTER_ELKAAR, MAX_MISLUKT, AFBREEK_ZIN };
}));
