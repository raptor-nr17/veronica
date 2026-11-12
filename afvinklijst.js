// ===================================================================
// 678 (21 punten, punt 11): WERKOPNAMES -> AFVINKLIJST. Het uitschrijven (Whisper) en het opstellen (een klein model) gebeurt op het toestel; deze module
// is de PURE kant: de vaste prompt, het STRENG lezen van de JSON van het model, en de harde regel dat elk punt op de lijst terug te vinden is in wat er
// echt gezegd is (een bronzin). Een punt zonder bronzin in de uitschrijving wordt weggehaald, nooit bijgemaakt. Alleen een lijst: niets wordt uitgevoerd,
// verstuurd of ingepland. Geen netwerk, geen opslag, geen DOM, geen model.
// Afspraak: geen merk, persoon of plaats in dit bestand.
// ===================================================================
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek(require('./aanroep.js'));
  else wortel.Afvinklijst = fabriek(wortel.Aanroep);
}(typeof self !== 'undefined' ? self : this, function (Aanroep) {
  'use strict';
  const MAX_PUNTEN = 25;
  const PUNT = Object.freeze({ taak: { type: 'tekst', maxLen: 160, verplicht: true }, bron: { type: 'tekst', maxLen: 300, verplicht: true }, wanneer: { type: 'tekst', maxLen: 60 } });
  const norm = (x) => String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9à-ÿ\s]/gi, ' ').replace(/\s+/g, ' ').trim();

  function maakPrompt(uitschrijving) {
    return 'Hieronder staat de uitschrijving van een werkopname. Maak een afvinklijst van de dingen die iemand moet DOEN. Antwoord met ALLEEN JSON: '
      + '{"punten":[{"taak":"korte opdracht","bron":"de zin uit de tekst waar dit uit komt, letterlijk","wanneer":"alleen als er een tijd genoemd wordt"}]}. '
      + 'Neem alleen op wat echt gezegd is; verzin niets.\n\n' + String(uitschrijving == null ? '' : uitschrijving).slice(0, 6000);
  }

  // lees(raw, uitschrijving): { punten:[{taak,bron,wanneer?}], weggelaten:n, fout? }. Elk punt: streng schema EN de bronzin moet (genormaliseerd) in de uitschrijving staan.
  function lees(raw, uitschrijving) {
    const j = Aanroep.uitJson(raw); if (j == null) return { punten: [], weggelaten: 0, fout: 'geen JSON gevonden' };
    let w; try { w = JSON.parse(j); } catch (e) { return { punten: [], weggelaten: 0, fout: 'JSON leest niet' }; }
    if (!w || typeof w !== 'object' || !Array.isArray(w.punten) || Object.keys(w).some((k) => k !== 'punten')) return { punten: [], weggelaten: 0, fout: 'verkeerde vorm' };
    const tekst = norm(uitschrijving); const uit = []; let weg = 0; const gezien = new Set();
    for (const p of w.punten.slice(0, MAX_PUNTEN * 2)) {
      const c = Aanroep.controleer(p, PUNT);
      const bron = c.ok ? norm(p.bron) : '';
      const sleutel = c.ok ? norm(p.taak) : '';
      if (!c.ok || bron.length < 6 || tekst.indexOf(bron) < 0 || gezien.has(sleutel) || uit.length >= MAX_PUNTEN) { weg++; continue; }
      gezien.add(sleutel);
      uit.push(p.wanneer ? { taak: p.taak, bron: p.bron, wanneer: p.wanneer } : { taak: p.taak, bron: p.bron });
    }
    return { punten: uit, weggelaten: weg };
  }

  // zin(resultaat): wat Veronica zegt. Eerlijk over wat er is weggelaten.
  function zin(r) {
    if (!r || r.fout) return 'Ik kon geen lijst maken uit deze opname.';
    if (!r.punten.length) return 'Ik vond niets in de opname dat je moet doen.' + (r.weggelaten ? ` (${r.weggelaten} punten liet ik weg omdat ze niet in de tekst stonden.)` : '');
    return `Ik vond ${r.punten.length} ${r.punten.length === 1 ? 'ding' : 'dingen'} om af te vinken.` + (r.weggelaten ? ` ${r.weggelaten} liet ik weg omdat ze niet in de opname stonden.` : '');
  }
  return { maakPrompt, lees, zin, MAX_PUNTEN };
}));
