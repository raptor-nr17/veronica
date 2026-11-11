// ===================================================================
// 678 (lokale AI op het rek, onderdeel 2): DE SLIMHEIDSMETER PER ANTWOORD. Houdt van elk antwoord dat een telefoon gaf bij hoe goed (de
// controle van trap.js haalde het of niet) en hoe snel (tokens per seconde) hij was, en welke backend echt rekende (GPU of CPU). Daaruit
// leert de verdeler wie waarvoor het best is, en hoe groot het aandeel vragen is dat OMHOOG moest (F8 of buiten het rek).
// PUUR rekenen in CODE: geen netwerk, geen opslag, geen DOM, geen model. veronica.js bewaart de lijst (alleen getallen).
//
// Uit het onderzoek van 11 nov (docs/lokaal-modelsysteem.md, "Wat het onderzoek zegt"), CORRIGEERD door de eigenaar (17:36): het zijn LOKALE
// modellen, tokens kosten niets (alleen stroom) en de telefoons liggen op de cooler. Omhoog sturen kost dus alleen TIJD, geen geld:
//  - het aandeel dat omhoog gaat (richtpunt ~20%) is een SIGNAAL, geen kostengrens; een vraag zonder haast mag gerust vaker omhoog;
//  - bewaakt wordt de WACHTTIJD BIJ SNELLE VRAGEN (haast): de alarm gaat daarover, niet over een percentage;
//  - de slimheidsmeter houdt vooral SNELHEID en KWALITEIT per telefoon bij (nooit geld);
//  - Gemini is het enige dat echt iets kost of op een limiet loopt: het aantal Gemini-antwoorden per dag wordt geteld (geminiVandaag).
//  - goedkope chips bieden OpenCL vaak niet aan en vallen STIL terug op CPU: daarom wordt per telefoon gelogd welke backend echt rekende,
//    en wordt een stille terugval (GPU gevraagd, CPU gekregen) zichtbaar gemaakt.
//
// PRIVACY: een record bevat GEEN vraag, GEEN antwoord en geen tekst: alleen getallen, een korte telefoon-sleutel en woorden uit vaste lijsten.
// Afspraak: geen merk, persoon of plaats in dit bestand (het gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Antwoordlog = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX = 300;                 // hoeveel records hoogstens bewaard blijven (de oudste vallen eraf)
  const DOEL = 0.2;                // richtpunt: hoogstens een vijfde van de vragen gaat omhoog
  const LET_OP = 0.4;              // daarboven noemt het alarm het aandeel als oorzaak van trage snelle vragen
  const STORM = 0.6;               // daarboven gaat de meeste tijd naar doorsturen (alleen een signaal; geld kost het niet)
  const VENSTER = 30;              // het aandeel gaat over de laatste zoveel vragen
  const MIN_VRAGEN = 10;           // onder dit aantal zeggen we niets over het aandeel
  const SNEL_MAX_MS = 15000;       // een snelle vraag hoort binnen zoveel ms antwoord te hebben
  const MIN_SNEL = 5;              // onder dit aantal snelle vragen zeggen we niets over de wachttijd
  const MIN_METINGEN = 3;          // onder dit aantal antwoorden telt de leerstand van een telefoon niet mee
  const BACKENDS = Object.freeze(['gpu', 'cpu', 'onbekend']);
  const BRONNEN = Object.freeze(['geheugen', 'regels', 'model', 'f8', 'gemini', 'niemand']);
  const SOORTEN = Object.freeze(['algemeen', 'samenvatten', 'labelen', 'json', 'feit']);

  const getal = (x, lo, hi) => (typeof x === 'number' && isFinite(x) ? Math.max(lo, Math.min(hi, x)) : null);
  const woord = (x, lijst, std) => (lijst.indexOf(x) >= 0 ? x : std);
  const sleutel = (x) => String(x == null ? '' : x).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);

  // schoon(rec): een record naar de vaste vorm. s = 'poging' (een telefoon antwoordde) of 'vraag' (een heel traject is klaar).
  function schoon(rec) {
    const r = rec && typeof rec === 'object' ? rec : {};
    const s = r.s === 'vraag' ? 'vraag' : 'poging';
    const uit = { s: s, t: getal(r.t, 0, 4e12) || 0, soort: woord(r.soort, SOORTEN, 'algemeen') };
    if (s === 'vraag') {
      uit.bron = woord(r.bron, BRONNEN, 'niemand');
      uit.geescaleerd = r.geescaleerd === true;
      uit.pogingen = getal(r.pogingen, 0, 20) || 0;
      uit.haast = r.haast === true;             // een snelle vraag: iemand wacht erop (spraak, een tik)
      uit.wacht = getal(r.wacht, 0, 3.6e6);     // hoeveel ms de vraag in totaal onderweg was (som van de pogingen)
      return uit;
    }
    uit.telefoon = sleutel(r.telefoon);
    uit.ok = r.ok === true;
    uit.ms = getal(r.ms, 0, 3.6e6);
    uit.tokens = getal(r.tokens, 0, 1e5);
    uit.backend = woord(r.backend, BACKENDS, 'onbekend');
    uit.gevraagd = woord(r.gevraagd, BACKENDS, 'onbekend');   // wat we hoopten (GPU?) -- verschil met backend = stille terugval
    return uit;
  }
  function voeg(log, rec) { return (Array.isArray(log) ? log : []).concat([schoon(rec)]).slice(-MAX); }
  function lees(ruw) {
    let l = ruw;
    if (typeof l === 'string') { try { l = JSON.parse(l); } catch (e) { return []; } }
    return Array.isArray(l) ? l.map(schoon).filter((x) => x.t >= 0).slice(-MAX) : [];
  }

  // tokens per seconde van een poging, of null als het niet te weten is (geen tokens of geen tijd). Nooit verzonnen.
  function tps(rec) { return rec && rec.tokens > 0 && rec.ms > 0 ? Math.round((rec.tokens * 1000 / rec.ms) * 10) / 10 : null; }
  const mediaan = (l) => { if (!l.length) return null; const s = l.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 10) / 10; };

  // kwaliteit(log, telefoon, soort): { n, goed (0..1 of null), tps (mediaan of null) } voor een telefoon bij een soort klus.
  function kwaliteit(log, telefoon, soort) {
    const p = (Array.isArray(log) ? log : []).filter((x) => x.s === 'poging' && x.telefoon === sleutel(telefoon) && (!soort || x.soort === soort));
    return { n: p.length, goed: p.length ? Math.round(p.filter((x) => x.ok).length / p.length * 100) / 100 : null, tps: mediaan(p.map(tps).filter((x) => x != null)),
      ms: mediaan(p.map((x) => x.ms).filter((x) => x != null)) };   // ms: ook snelheid als er geen tokens geteld zijn
  }

  // rangschik(log, soort, kandidaten): de kandidaten (in de volgorde van hun ROL) bijgestuurd door wat er GEMETEN is, in drie groepen:
  //  1. aantoonbaar goed (genoeg metingen en vanaf 70% goed): vooraan, de beste eerst, bij gelijk de snelste;
  //  2. nog niet genoeg gemeten, of middelmatig: in de volgorde van de rol (de rol is dan de enige aanwijzing);
  //  3. aantoonbaar slecht (genoeg metingen en onder 50% goed): achteraan.
  // Verzint niets: zonder metingen beslist alleen de rol.
  const GOED = 0.7, SLECHT = 0.5;
  function rangschik(log, soort, kandidaten) {
    const k = (Array.isArray(kandidaten) ? kandidaten : []).map((c, i) => Object.assign({ i: i }, c, { kw: kwaliteit(log, c.id, soort) }));
    const groep = (c) => (c.kw.n >= MIN_METINGEN && c.kw.goed >= GOED ? 1 : c.kw.n >= MIN_METINGEN && c.kw.goed < SLECHT ? 3 : 2);
    const lijst = k.slice().sort((a, b) => (groep(a) - groep(b))
      || (groep(a) === 2 ? a.i - b.i : ((b.kw.goed - a.kw.goed) || ((b.kw.tps || 0) - (a.kw.tps || 0)) || (a.i - b.i))));
    return lijst.map((c) => ({ id: c.id, groep: groep(c), geleerd: c.kw.n >= MIN_METINGEN, goed: c.kw.goed, tps: c.kw.tps, ms: c.kw.ms, n: c.kw.n }));
  }

  // escalatie(log): het aandeel van de laatste VENSTER vragen dat OMHOOG moest (F8 of buiten het rek, of niemand kon het).
  function escalatie(log) {
    const v = (Array.isArray(log) ? log : []).filter((x) => x.s === 'vraag').slice(-VENSTER);
    const n = v.length;
    if (n < MIN_VRAGEN) return { n: n, aandeel: n ? Math.round(v.filter((x) => x.geescaleerd).length / n * 100) / 100 : null, status: 'te-weinig' };
    const aandeel = Math.round(v.filter((x) => x.geescaleerd).length / n * 100) / 100;
    return { n: n, aandeel: aandeel, status: aandeel >= STORM ? 'storm' : aandeel > LET_OP ? 'te-veel' : aandeel > DOEL ? 'let-op' : 'goed' };
  }
  const procent = (x) => `${Math.round(x * 100)}%`;
  // wachttijd(log): hoe lang SNELLE vragen (haast) onderweg waren. Alleen deze telt als probleem: een vraag zonder haast mag gerust lang duren.
  function wachttijd(log) {
    const v = (Array.isArray(log) ? log : []).filter((x) => x.s === 'vraag' && x.haast && x.wacht != null).slice(-VENSTER);
    if (v.length < MIN_SNEL) return { n: v.length, mediaanMs: v.length ? mediaan(v.map((x) => x.wacht)) : null, teLang: null, status: 'te-weinig' };
    const tel = v.filter((x) => x.wacht > SNEL_MAX_MS).length;
    const med = mediaan(v.map((x) => x.wacht));
    return { n: v.length, mediaanMs: med, teLang: Math.round(tel / v.length * 100) / 100, status: med > SNEL_MAX_MS || tel / v.length >= 0.5 ? 'te-lang' : 'goed' };
  }
  const sec = (ms) => `${Math.round(ms / 100) / 10} s`;
  // alarm(log): null als snelle vragen niet te lang wachten, anders { niveau: 'traag', zin }. Het aandeel dat omhoog ging wordt genoemd als
  // waarschijnlijke oorzaak, maar op zichzelf is een hoog aandeel GEEN alarm (het kost geen geld). Alleen een melding: het verandert niets.
  function alarm(log) {
    const w = wachttijd(log);
    if (w.status !== 'te-lang') return null;
    const e = escalatie(log);
    const oorzaak = e.aandeel != null && e.aandeel > LET_OP ? ` Waarschijnlijk omdat ${procent(e.aandeel)} van de vragen omhoog ging; kijk welke telefoon of welk soort vraag faalt.` : '';
    return { niveau: 'traag', zin: `Snelle vragen wachten te lang: de helft duurt langer dan ${sec(SNEL_MAX_MS)} (mediaan ${sec(w.mediaanMs)}).${oorzaak}` };
  }

  // geminiVandaag(log, vanaf): hoeveel vragen sinds `vanaf` (ms, begin van de dag) door Gemini zijn beantwoord. Gemini is het ENIGE dat een limiet heeft.
  function geminiVandaag(log, vanaf) { return (Array.isArray(log) ? log : []).filter((x) => x.s === 'vraag' && x.bron === 'gemini' && x.t >= (vanaf || 0)).length; }

  // backends(log): per telefoon hoe vaak GPU, CPU of onbekend echt rekende, en of er een STILLE terugval was (GPU gevraagd, CPU gekregen).
  function backends(log) {
    const uit = {};
    for (const x of (Array.isArray(log) ? log : [])) {
      if (x.s !== 'poging' || !x.telefoon) continue;
      const b = uit[x.telefoon] || (uit[x.telefoon] = { gpu: 0, cpu: 0, onbekend: 0, stilleTerugval: 0 });
      b[x.backend] += 1;
      if (x.gevraagd === 'gpu' && x.backend === 'cpu') b.stilleTerugval += 1;
    }
    for (const id of Object.keys(uit)) uit[id].zin = uit[id].stilleTerugval
      ? `rekende ${uit[id].stilleTerugval}x op de CPU terwijl de GPU gevraagd was (de chip biedt de GPU niet aan)` : uit[id].gpu ? 'rekent op de GPU' : uit[id].cpu ? 'rekent op de CPU' : 'backend nog onbekend';
    return uit;
  }

  return { schoon, voeg, lees, tps, kwaliteit, rangschik, escalatie, wachttijd, alarm, geminiVandaag, backends, MAX, DOEL, LET_OP, STORM, VENSTER, MIN_VRAGEN, MIN_METINGEN, SNEL_MAX_MS, MIN_SNEL, BACKENDS, BRONNEN, SOORTEN };
}));
