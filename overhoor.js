// ===================================================================
// 678 (21 punten, punt 20 "uitleg en overhoren"): een OVERHOOR-helper. PUUR rekenen in CODE -- geen model, geen netwerk,
// geen opslag, geen DOM. De helper VERZINT NOOIT het goede antwoord: hij krijgt KAARTEN (een vraag + een of meer goede
// antwoorden, aangeleverd door de kennisbank/geheugen of door een mens -- nooit hier bedacht) en doet maar twee dingen:
//   1) een gegeven antwoord BEOORDELEN tegen de aangeleverde goede antwoorden (exact genormaliseerd, of een getal-vergelijking);
//   2) met een Leitner-doosjessysteem de VOLGENDE kaart kiezen en de voortgang bijhouden.
// "Uitleg" (de tekst die een onderwerp verklaart) is modelwerk; deze helper doet alleen het OVERHOREN. Een model mag een
// uitleg schrijven en vragen voorstellen, maar het goede antwoord komt uit de aangeleverde kaart -- niet uit deze code.
// Een "bijna"-treffer (een tikfout) is ALLEEN advies: een fout feit telt NOOIT vanzelf als goed (zelfde §320-discipline --
// de code beoordeelt, verzint niets). De beller beslist of hij een "bijna" alsnog vraagt te bevestigen.
//
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Overhoor = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_DOOS = 5;                 // doos 1 (net fout / nieuw) .. 5 (beheerst)
  // Leitner-intervallen per doos (ms): hoe lang een goed beantwoorde kaart met rust blijft. Doos 1 = meteen weer aan de beurt.
  const DAG = 24 * 60 * 60 * 1000;
  const INTERVAL_MS = Object.freeze({ 1: DAG, 2: 2 * DAG, 3: 4 * DAG, 4: 8 * DAG, 5: 16 * DAG });
  const BIJNA_MAX_AFSTAND = 2;        // hoogstens twee tekens verschil ...
  const BIJNA_MAX_DEEL = 0.25;        // ... en hoogstens een kwart van het woord -- anders is het geen tikfout maar een ander antwoord

  function binnenDoos(d) { return Math.max(1, Math.min(MAX_DOOS, Math.round(d || 1))); }

  // normaliseer(tekst): kleine letters, accenten weg, leestekens aan de randen weg, witruimte samengevouwen. Voor het VERGELIJKEN
  // van antwoorden -- nooit voor weergave.
  function normaliseer(tekst) {
    return String(tekst == null ? '' : tekst)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accenten eraf (é -> e)
      .replace(/[.,;:!?'"()\[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // getalUit(tekst): als de hele (genormaliseerde) tekst één getal is -> dat getal, anders null. Komma telt als decimaalteken;
  // een eenheid erachter (km, graden, %) mag. "drie" blijft tekst -- een woord-getal verzinnen we niet.
  function getalUit(tekst) {
    // eigen lichte normalisatie: normaliseer() zou de komma als leesteken wegstrippen vóór hij decimaalteken kan worden
    const t = String(tekst == null ? '' : tekst).toLowerCase().trim().replace(',', '.');
    const m = t.match(/^(-?\d+(?:\.\d+)?)\s*[a-z%°]*$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    return isFinite(n) ? n : null;
  }

  // afstand(a, b): Levenshtein-afstand tussen twee strings (voor de "bijna"-herkenning). Puur.
  function afstand(a, b) {
    a = String(a); b = String(b);
    if (a === b) return 0;
    const n = a.length, m = b.length;
    if (!n) return m; if (!m) return n;
    let vorige = new Array(m + 1);
    for (let j = 0; j <= m; j++) vorige[j] = j;
    for (let i = 1; i <= n; i++) {
      let huidig = [i];
      for (let j = 1; j <= m; j++) {
        const kost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        huidig[j] = Math.min(vorige[j] + 1, huidig[j - 1] + 1, vorige[j - 1] + kost);
      }
      vorige = huidig;
    }
    return vorige[m];
  }

  function antwoordenVan(goed) {
    if (Array.isArray(goed)) return goed.map((x) => String(x == null ? '' : x)).filter((x) => x.trim());
    const s = String(goed == null ? '' : goed);
    return s.trim() ? [s] : [];
  }

  // beoordeel(gegeven, goedeAntwoorden, opties): vergelijk een gegeven antwoord met de aangeleverde goede antwoorden.
  //  -> { goed, bijna, reden, verwacht }. goed is STRIKT: exact genormaliseerd gelijk, of een getal-gelijkheid. bijna is ALLEEN
  //  advies (een tikfout dicht bij één goed antwoord) en zet goed NOOIT. Leeg antwoord -> niet goed, niet bijna.
  function beoordeel(gegeven, goedeAntwoorden, opties) {
    const o = opties && typeof opties === 'object' ? opties : {};
    const lijst = antwoordenVan(goedeAntwoorden);
    const verwacht = lijst.length ? lijst[0] : null;
    const g = normaliseer(gegeven);
    if (!g) return { goed: false, bijna: false, reden: 'leeg', verwacht: verwacht };
    if (!lijst.length) return { goed: false, bijna: false, reden: 'geen goed antwoord aangeleverd', verwacht: null };

    const gGetal = getalUit(gegeven);
    for (const a of lijst) {
      if (normaliseer(a) === g) return { goed: true, bijna: false, reden: 'exact', verwacht: a };
      if (gGetal !== null) { const ag = getalUit(a); if (ag !== null && ag === gGetal) return { goed: true, bijna: false, reden: 'getal gelijk', verwacht: a }; }
    }
    // niet goed: is het een tikfout dicht bij één antwoord? (alleen advies, nooit goed)
    const maxAfstand = typeof o.bijnaAfstand === 'number' ? o.bijnaAfstand : BIJNA_MAX_AFSTAND;
    let dichtst = null;
    for (const a of lijst) {
      const na = normaliseer(a);
      if (gGetal !== null && getalUit(a) !== null) continue;   // twee getallen die niet gelijk zijn: geen tikfout, gewoon fout
      const d = afstand(g, na);
      const deel = d / Math.max(g.length, na.length, 1);
      if (d <= maxAfstand && deel <= BIJNA_MAX_DEEL && (dichtst === null || d < dichtst.d)) dichtst = { d: d, a: a };
    }
    if (dichtst) return { goed: false, bijna: true, reden: 'bijna (mogelijk een tikfout)', verwacht: dichtst.a };
    return { goed: false, bijna: false, reden: 'fout', verwacht: verwacht };
  }

  // maakKaart(vraag, antwoord, id): een kaart klaarmaken voor de overhoring. Verandert de antwoorden NIET (geen verzinnen); doos 1,
  // meteen aan de beurt. id valt terug op de vraagtekst (de beller mag een eigen id meegeven).
  function maakKaart(vraag, antwoord, id) {
    const antwoorden = antwoordenVan(antwoord);
    return {
      id: id != null ? String(id) : String(vraag == null ? '' : vraag),
      vraag: String(vraag == null ? '' : vraag),
      antwoorden: antwoorden,
      doos: 1, volgende_ms: 0, gezien: 0, goedAchtereen: 0, laatst: 0,
    };
  }

  // naBeoordeling(kaart, goed, nu): een NIEUWE kaart met de doos/planning bijgewerkt. Goed -> één doos omhoog (tot 5); fout ->
  // terug naar doos 1. volgende_ms = nu + het interval van de nieuwe doos. Muteert de ingaande kaart niet.
  function naBeoordeling(kaart, goed, nu) {
    const k = kaart && typeof kaart === 'object' ? kaart : {};
    const t = typeof nu === 'number' ? nu : 0;
    const huidige = binnenDoos(k.doos);
    const nieuweDoos = goed ? Math.min(MAX_DOOS, huidige + 1) : 1;
    return Object.assign({}, k, {
      doos: nieuweDoos,
      volgende_ms: t + (INTERVAL_MS[nieuweDoos] || DAG),
      gezien: (typeof k.gezien === 'number' ? k.gezien : 0) + 1,
      goedAchtereen: goed ? (typeof k.goedAchtereen === 'number' ? k.goedAchtereen : 0) + 1 : 0,
      laatst: t,
    });
  }

  function aanDeBeurt(kaart, nu) {
    const t = typeof nu === 'number' ? nu : 0;
    return (typeof kaart.volgende_ms === 'number' ? kaart.volgende_ms : 0) <= t;
  }

  // kies(kaarten, nu): de volgende kaart om te vragen -- een kaart die aan de beurt is (volgende_ms <= nu), met de LAAGSTE doos
  // eerst (die zit het minst vast), dan de kaart die het langst wacht, dan stabiel op volgorde. Niets aan de beurt -> null.
  function kies(kaarten, nu) {
    const t = typeof nu === 'number' ? nu : 0;
    const lijst = (Array.isArray(kaarten) ? kaarten : []).filter((k) => k && typeof k === 'object');
    let beste = null, besteI = -1;
    for (let i = 0; i < lijst.length; i++) {
      const k = lijst[i];
      if (!aanDeBeurt(k, t)) continue;
      if (beste === null) { beste = k; besteI = i; continue; }
      const kd = binnenDoos(k.doos), bd = binnenDoos(beste.doos);
      const kv = typeof k.volgende_ms === 'number' ? k.volgende_ms : 0;
      const bv = typeof beste.volgende_ms === 'number' ? beste.volgende_ms : 0;
      if (kd < bd || (kd === bd && kv < bv)) { beste = k; besteI = i; }
    }
    return beste;
  }

  // voortgang(kaarten, nu): { totaal, perDoos:{1..5}, nuAanDeBeurt, beheerst }. beheerst = in doos 5.
  function voortgang(kaarten, nu) {
    const t = typeof nu === 'number' ? nu : 0;
    const lijst = (Array.isArray(kaarten) ? kaarten : []).filter((k) => k && typeof k === 'object');
    const perDoos = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let nuAanDeBeurt = 0;
    for (const k of lijst) {
      perDoos[binnenDoos(k.doos)] += 1;
      if (aanDeBeurt(k, t)) nuAanDeBeurt += 1;
    }
    return { totaal: lijst.length, perDoos: perDoos, nuAanDeBeurt: nuAanDeBeurt, beheerst: perDoos[5] };
  }

  return {
    MAX_DOOS: MAX_DOOS, INTERVAL_MS: INTERVAL_MS,
    normaliseer: normaliseer, getalUit: getalUit, afstand: afstand,
    beoordeel: beoordeel, maakKaart: maakKaart, naBeoordeling: naBeoordeling,
    aanDeBeurt: aanDeBeurt, kies: kies, voortgang: voortgang,
  };
}));
