// ===================================================================
// 678 (21 punten, punt 7 "zoek in mijn ideeen" + punt 8 "onthoud dat"): de KENNISBANK/GEHEUGEN-kern. PUUR rekenen in CODE --
// geen model, geen netwerk, geen opslag, geen DOM. Dit is de stap-14-helper: een feitenlijst waarin je iets ONTHOUDT en
// waarin je ZOEKT, met de harde §119/§320-discipline:
//   - EEN REGEL PER FEIT: { datum, onderwerp, feit, bron, bevestigd }. Nieuw feit = TOEVOEGEN, nooit een oude regel overschrijven;
//     de geschiedenis blijft altijd staan (huidige() vouwt pas bij het LEZEN samen -- nieuwste wint).
//   - BRON IS VERPLICHT bij een antwoord: zoek() geeft NOOIT een feit terug zonder bron (bestandsnaam/"ik"/een URL). Zonder bron
//     telt een regel niet mee -- de code mag een bron niet verzinnen.
//   - SCHRIJVEN NAAR prive/ ALLEEN NA BEVESTIGING: een feit dat naar de prive-index zou gaan staat op `bevestigd: null`
//     (onhoorbaar/onvindbaar) tot een mens het vrijgeeft -- zelfde poort als de plekpuzzels van 90 en de wachtrij van 119.
//   - VERGETEN IS EEN GRAFSTEEN, nooit stil wissen (zelfde regel als fenna-kluis §551): vergeet() markeert `verwijderd`, de regel
//     blijft in de geschiedenis.
//   - DE CODE VERZINT NOOIT EEN FEIT. Een model mag straks een VRAAG of een UITLEG schrijven, maar het feit en de bron komen uit
//     deze lijst (de Drive-export / het geheugen / een mens), niet uit deze code.
// De twee GESCHEIDEN indexen (prive/ en web/) en het nachtelijk herindexeren zitten op het TOESTEL (SD-kaart); dit is de pure
// kern die beide delen. Woord-overlap staat hier als scoremethode; op het toestel mag EmbeddingGemma dat vervangen -- zelfde
// vorm in/uit (een lijst feiten + een vraag -> gescoorde feiten).
//
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Kennisbank = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const ZOEK_DREMPEL = 0.18;          // onder deze overlap-score geen antwoord (liever niets dan een gok)
  const ZOEK_MAX = 5;                 // hoogstens zoveel feiten per vraag terug
  // Stopwoorden tellen niet mee in de overlap -- anders scoort "de het een" alles hoog.
  const STOP = Object.freeze(new Set(('de het een en of maar want als dan die dat deze dit er is zijn was waren wordt worden ' +
    'van voor naar met op in aan bij om te te uit over onder tussen ik je jij u we wij ze zij hij het mijn jouw ' +
    'wat wie waar hoe waarom welke niet wel ook nog al heb hebben had').split(/\s+/)));

  // normaliseer(tekst): kleine letters, accenten weg, leestekens weg, witruimte samengevouwen. Voor het VERGELIJKEN en
  // GROEPEREN -- nooit voor weergave.
  function normaliseer(tekst) {
    return String(tekst == null ? '' : tekst)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[.,;:!?'"()\[\]{}\/\\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // woorden(tekst): de betekenisdragende woorden (stopwoorden en losse letters eruit), als Set.
  function woorden(tekst) {
    const uit = new Set();
    for (const w of normaliseer(tekst).split(' ')) {
      if (w.length >= 2 && !STOP.has(w)) uit.add(w);
    }
    return uit;
  }

  // overlap(a, b): Jaccard-achtige overlap van twee woord-Sets, 0..1 (gedeeld / kleinste set, zodat een korte vraag die
  // helemaal in een lang feit zit hoog scoort).
  function overlap(aSet, bSet) {
    if (!aSet.size || !bSet.size) return 0;
    let gedeeld = 0;
    for (const w of aSet) if (bSet.has(w)) gedeeld++;
    return gedeeld / Math.min(aSet.size, bSet.size);
  }

  // id(regel): een stabiele sleutel uit datum+onderwerp+feit (deterministisch -- geen Date.now/random, zodat tests kloppen).
  function hash(s) {
    let h = 2166136261 >>> 0;
    s = String(s == null ? '' : s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  function idVan(regel) {
    if (regel && regel.id) return String(regel.id);
    return hash((regel && regel.datum) + '|' + normaliseer(regel && regel.onderwerp) + '|' + normaliseer(regel && regel.feit));
  }

  // geldig(regel): een bruikbaar feit heeft een onderwerp EN een feit EN een bron. Zonder bron is het geen feit (de code mag
  // er geen verzinnen) -- dan telt het niet mee bij het lezen.
  function geldig(regel) {
    return !!(regel && String(regel.onderwerp || '').trim() && String(regel.feit || '').trim() && String(regel.bron || '').trim());
  }

  // onthoud(regels, nieuw, nu): voeg EEN feit toe. Overschrijft nooit; de geschiedenis blijft. Een feit voor de prive-index
  // (nieuw.prive === true) komt op `bevestigd: null` -- onvindbaar tot een mens het vrijgeeft. Anders bevestigd: true.
  // Geeft een NIEUWE lijst terug (puur). Een feit zonder onderwerp/feit/bron wordt geweigerd (fout gegooid): liever hard dan
  // een halve regel in de bank.
  function onthoud(regels, nieuw, nu) {
    const lijst = Array.isArray(regels) ? regels.slice() : [];
    const datum = Number.isFinite(nieuw && nieuw.datum) ? nieuw.datum : (Number.isFinite(nu) ? nu : 0);
    const regel = {
      onderwerp: String((nieuw && nieuw.onderwerp) || '').trim(),
      feit: String((nieuw && nieuw.feit) || '').trim(),
      bron: String((nieuw && nieuw.bron) || '').trim(),
      datum: datum,
      bevestigd: (nieuw && nieuw.prive) ? null : (nieuw && 'bevestigd' in nieuw ? nieuw.bevestigd : true),
      verwijderd: false
    };
    if (!regel.onderwerp || !regel.feit || !regel.bron) {
      throw new Error('onthoud: onderwerp, feit en bron zijn alledrie verplicht (de code verzint geen bron)');
    }
    regel.id = idVan(regel);
    lijst.push(regel);
    return lijst;
  }

  // leesbaar(regels): de regels die MEETELLEN -- geldig, niet verwijderd, niet nog onbevestigd (bevestigd !== null) en niet
  // afgewezen (bevestigd !== false). Dit is de enige poort waardoor huidige()/zoek() lezen.
  function leesbaar(regels) {
    return (Array.isArray(regels) ? regels : []).filter(function (r) {
      return geldig(r) && !r.verwijderd && r.bevestigd !== null && r.bevestigd !== false;
    });
  }

  // huidige(regels): per onderwerp het NIEUWSTE leesbare feit (nieuwste wint; gelijkspel -> laatst toegevoegd). De
  // geschiedenis blijft in `regels` staan -- dit vouwt alleen samen voor het lezen. Gesorteerd op datum (nieuwste eerst).
  function huidige(regels) {
    const perOnderwerp = new Map();
    const lees = leesbaar(regels);
    for (let i = 0; i < lees.length; i++) {
      const r = lees[i];
      const sleutel = normaliseer(r.onderwerp);
      const bestaat = perOnderwerp.get(sleutel);
      // nieuwer wint; bij gelijke datum wint de latere in de lijst (grotere index)
      if (!bestaat || r.datum > bestaat.r.datum || (r.datum === bestaat.r.datum && i > bestaat.i)) {
        perOnderwerp.set(sleutel, { r: r, i: i });
      }
    }
    return Array.from(perOnderwerp.values()).map(function (x) { return x.r; })
      .sort(function (a, b) { return b.datum - a.datum; });
  }

  // zoek(regels, vraag, opties): de feiten die bij de vraag passen, ALTIJD met bron. Scoort op woord-overlap tegen
  // onderwerp+feit over de HUIDIGE feiten; alleen boven de drempel; gesorteerd op score, dan nieuwste. Geen treffer -> [].
  // De code verzint niets: zonder passend feit komt er geen antwoord.
  function zoek(regels, vraag, opties) {
    const o = opties || {};
    const drempel = Number.isFinite(o.drempel) ? o.drempel : ZOEK_DREMPEL;
    const max = Number.isFinite(o.max) ? o.max : ZOEK_MAX;
    const vraagSet = woorden(vraag);
    if (!vraagSet.size) return [];
    const uit = [];
    for (const r of huidige(regels)) {
      const score = overlap(vraagSet, woorden(r.onderwerp + ' ' + r.feit));
      if (score >= drempel) {
        uit.push({ onderwerp: r.onderwerp, feit: r.feit, bron: r.bron, datum: r.datum, id: r.id, score: score });
      }
    }
    uit.sort(function (a, b) { return b.score - a.score || b.datum - a.datum; });
    return uit.slice(0, max);
  }

  // tegenstrijdig(regels, nu, vensterMs): mogelijke tegenstrijdigheden om WEKELIJKS met een tik te bevestigen. Per onderwerp:
  // het huidige (nieuwste) feit, plus ELK ander leesbaar feit op datzelfde onderwerp binnen `vensterMs` ervoor met een ANDER
  // (genormaliseerd) feit EN een andere bron. Twee tijdgenoten die het oneens zijn kun je niet met "nieuwste wint" afdoen --
  // die legt de code aan een mens voor. Een enkele latere bijwerking van dezelfde bron is GEEN tegenstrijdigheid.
  function tegenstrijdig(regels, nu, vensterMs) {
    const venster = Number.isFinite(vensterMs) ? vensterMs : WEEK;
    const lees = leesbaar(regels);
    const perOnderwerp = new Map();
    for (const r of lees) {
      const s = normaliseer(r.onderwerp);
      if (!perOnderwerp.has(s)) perOnderwerp.set(s, []);
      perOnderwerp.get(s).push(r);
    }
    const uit = [];
    for (const rij of perOnderwerp.values()) {
      rij.sort(function (a, b) { return b.datum - a.datum; });
      const huidig = rij[0];
      const eerder = [];
      for (let i = 1; i < rij.length; i++) {
        const r = rij[i];
        if ((huidig.datum - r.datum) > venster) break;        // te oud -> geen tijdgenoot meer
        if (normaliseer(r.feit) !== normaliseer(huidig.feit) &&
            String(r.bron).trim() !== String(huidig.bron).trim()) {
          eerder.push(r);
        }
      }
      if (eerder.length) uit.push({ onderwerp: huidig.onderwerp, huidig: huidig, eerder: eerder });
    }
    return uit;
  }

  // bevestig(regels, id, bevestigd): zet de bevestigd-vlag van EEN feit (true = vrijgeven / false = afwijzen). Puur; nieuwe
  // lijst. Zo komt een prive-feit pas na een mensentik in huidige()/zoek() -- de device-kant schrijft alleen bevestigd:true
  // naar de prive-index.
  function bevestig(regels, id, bevestigd) {
    const doel = String(id);
    const waarde = bevestigd === false ? false : true;
    return (Array.isArray(regels) ? regels : []).map(function (r) {
      if (idVan(r) === doel) { const k = Object.assign({}, r); k.bevestigd = waarde; return k; }
      return r;
    });
  }

  // vergeet(regels, id): een GRAFSTEEN -- markeert het feit als verwijderd, wist het nooit uit de geschiedenis. Puur; nieuwe lijst.
  function vergeet(regels, id) {
    const doel = String(id);
    return (Array.isArray(regels) ? regels : []).map(function (r) {
      if (idVan(r) === doel) { const k = Object.assign({}, r); k.verwijderd = true; return k; }
      return r;
    });
  }

  return {
    ZOEK_DREMPEL: ZOEK_DREMPEL, ZOEK_MAX: ZOEK_MAX, WEEK: WEEK,
    normaliseer: normaliseer, woorden: woorden, overlap: overlap, idVan: idVan, geldig: geldig,
    onthoud: onthoud, leesbaar: leesbaar, huidige: huidige, zoek: zoek,
    tegenstrijdig: tegenstrijdig, bevestig: bevestig, vergeet: vergeet
  };
}));
