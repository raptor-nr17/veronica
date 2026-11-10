// ===================================================================
// 678 (21 punten, punt 17 "pijndagboek + pauzeherinneringen"): PUUR rekenen in CODE -- geen model, geen netwerk, geen opslag,
// geen DOM. Twee dingen, allebei feitelijk:
//   1) een DAGBOEK: de gebruiker noteert wat HIJ voelt (een niveau 0..10, een plek, een notitie). De code slaat het op als een
//      regel per keer (geschiedenis blijft) en vat het FEITELIJK samen (aantal, gemiddelde, hoogste/laagste, en of het de laatste
//      tijd hoger/lager/gelijk is dan daarvoor). Dat is de EIGEN data van de gebruiker teruggeven -- geen oordeel.
//   2) PAUZEHERINNERINGEN: puur op TIJD ("je zit al X minuten; sta even op"), nooit gekoppeld aan een pijnoordeel.
//
// HARDE REGEL: GEEN MEDISCH ADVIES. De module stelt geen diagnose, noemt geen aandoening, raadt geen behandeling/medicijn aan en
// verwijst niet naar een arts/therapie. Hij RAPPORTEERT alleen de ingevoerde getallen en de verstreken tijd. `check_pijndagboek.js`
// toetst dat de uitvoer-teksten geen enkel woord uit VERBODEN bevatten. Een mens (of een UI) mag er context bij zetten; deze code niet.
//
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Pijndagboek = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_NIVEAU = 10;
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const MINUUT = 60 * 1000;
  // Woorden die NOOIT in een uitvoer-tekst van deze module mogen staan -- de grens tussen "jouw data teruggeven" en medisch advies.
  const VERBODEN = Object.freeze(['diagnose', 'behandel', 'medicijn', 'medicatie', 'arts', 'dokter', 'huisarts', 'therapie',
    'ziekte', 'aandoening', 'symptoom', 'genees', 'pijnstiller', 'recept', 'oefening', 'raadpleeg', 'fysio']);

  function getal(x, laag, hoog, standaard) {
    const n = Number(x);
    if (!Number.isFinite(n)) return standaard;
    return Math.max(laag, Math.min(hoog, Math.round(n)));
  }

  // noteer(regels, nieuw, nu): een dagboekregel toevoegen. niveau 0..10 is verplicht en wordt begrensd; plek/notitie zijn vrije
  // tekst van de gebruiker (worden NIET door de code uitgelegd). Geschiedenis blijft (toevoegen, nooit overschrijven). Puur.
  function noteer(regels, nieuw, nu) {
    const lijst = Array.isArray(regels) ? regels.slice() : [];
    if (!nieuw || nieuw.niveau == null || !Number.isFinite(Number(nieuw.niveau))) {
      throw new Error('noteer: een niveau 0..10 is verplicht');
    }
    lijst.push({
      datum: Number.isFinite(nieuw.datum) ? nieuw.datum : (Number.isFinite(nu) ? nu : 0),
      niveau: getal(nieuw.niveau, 0, MAX_NIVEAU, 0),
      plek: String(nieuw.plek == null ? '' : nieuw.plek).trim(),
      notitie: String(nieuw.notitie == null ? '' : nieuw.notitie).trim(),
    });
    return lijst;
  }

  // recent(regels, nu, vensterMs): de regels binnen het venster, nieuwste eerst.
  function recent(regels, nu, vensterMs) {
    const venster = Number.isFinite(vensterMs) ? vensterMs : WEEK;
    const grens = (Number.isFinite(nu) ? nu : 0) - venster;
    return (Array.isArray(regels) ? regels : [])
      .filter(function (r) { return r && Number.isFinite(r.datum) && r.datum >= grens; })
      .sort(function (a, b) { return b.datum - a.datum; });
  }

  // overzicht(regels, nu, vensterMs): FEITELIJKE samenvatting over het venster. aantal/gemiddeld/hoogste/laagste, en een trend
  // die de NIEUWERE helft met de OUDERE helft vergelijkt ('hoger'/'lager'/'gelijk'/'te weinig'). Geen oordeel, geen advies.
  function overzicht(regels, nu, vensterMs) {
    const r = recent(regels, nu, vensterMs);
    if (!r.length) return { aantal: 0, gemiddeld: null, hoogste: null, laagste: null, trend: 'geen' };
    const n = r.map(function (x) { return x.niveau; });
    const som = n.reduce(function (a, b) { return a + b; }, 0);
    const gemiddeld = Math.round((som / n.length) * 10) / 10;
    // r is nieuwste-eerst; de nieuwere helft = het eerste deel.
    let trend = 'te weinig';
    if (r.length >= 4) {
      const helft = Math.floor(r.length / 2);
      const nieuw = n.slice(0, helft);
      const oud = n.slice(r.length - helft);
      const gem = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
      const dn = gem(nieuw) - gem(oud);
      trend = Math.abs(dn) < 0.5 ? 'gelijk' : (dn > 0 ? 'hoger' : 'lager');
    }
    return { aantal: r.length, gemiddeld: gemiddeld, hoogste: Math.max.apply(null, n), laagste: Math.min.apply(null, n), trend: trend };
  }

  // samenvatZin(ov): een FEITELIJKE regel uit overzicht() -- alleen getallen en de trend, nooit een oordeel of advies.
  function samenvatZin(ov) {
    if (!ov || !ov.aantal) return 'Nog niets genoteerd.';
    const t = ov.trend === 'hoger' ? ', de laatste tijd hoger' : ov.trend === 'lager' ? ', de laatste tijd lager'
      : ov.trend === 'gelijk' ? ', ongeveer gelijk gebleven' : '';
    return `${ov.aantal} keer genoteerd · gemiddeld ${ov.gemiddeld} (van ${ov.laagste} tot ${ov.hoogste})${t}.`;
  }

  // --- pauzeherinneringen: puur op TIJD, los van de pijn. ---
  // pauzeStatus(laatstePauzeMs, nu, opties): staat er een pauze te wachten? intervalMin = na hoeveel minuten zitten (standaard 50).
  // Geeft {due, sindsMin, zin}. De zin is neutraal ("sta even op"), nooit medisch.
  function pauzeStatus(laatstePauzeMs, nu, opties) {
    const o = opties || {};
    const interval = Number.isFinite(o.intervalMin) ? o.intervalMin : 50;
    const start = Number.isFinite(laatstePauzeMs) ? laatstePauzeMs : (Number.isFinite(nu) ? nu : 0);
    const sindsMin = Math.max(0, Math.floor(((Number.isFinite(nu) ? nu : 0) - start) / MINUUT));
    const due = sindsMin >= interval;
    const zin = due ? `Je zit al ${sindsMin} minuten achter elkaar. Sta even op en beweeg.` : `Nog ${interval - sindsMin} minuten tot de volgende pauze.`;
    return { due: due, sindsMin: sindsMin, zin: zin };
  }

  return {
    MAX_NIVEAU: MAX_NIVEAU, WEEK: WEEK, VERBODEN: VERBODEN,
    noteer: noteer, recent: recent, overzicht: overzicht, samenvatZin: samenvatZin, pauzeStatus: pauzeStatus,
  };
}));
