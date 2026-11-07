// ===================================================================
// 661 (stap 8 van "Lokale AI slimmer maken"): HET KENNISBOEK -- de MEET-POORT. Geen scherm, geen netwerk, geen opslag; alleen rekenen.
// ===================================================================
//
// Het kennisboek (opgeloste gevallen, met een schrijver en versiekopieën op de SD-kaarten) mag een vraag HELPEN, maar alleen als het echt
// helpt. Daarom twee regels van de eigenaar, in de code:
//  1. HOOGSTENS 4 gevallen ophalen bij een vraag (`MAX_GEVALLEN`) -- anders vult het de context met ruis.
//  2. Het kennisboek staat ALLEEN standaard aan als "met" BETER meet dan "zonder" op de vaste meetset (slimmeet.js): meer goed EN niet
//     meer fout-en-stellig. Meet het niet beter, dan blijft het uit (geen gevoel, een meting).
//
// standaardAan(met, zonder) -> { aan, reden }: met/zonder zijn de `getallen` van twee meetrondes (zie slimmeet.beoordeel). `aan` is alleen
// true als het kennisboek bewezen helpt.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Kennisboekmeet = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_GEVALLEN = 4;         // hoogstens zoveel gevallen bij een vraag
  const MIN_WINST_PCT = 1;        // "met" moet minstens dit percentpunt meer goed scoren om echt beter te heten (ruis-marge)

  const getal = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

  // Kies hoogstens MAX_GEVALLEN gevallen, de meest passende eerst (score hoog -> laag). gevallen: [{ tekst, score }]. Zuiver.
  function kiesGevallen(gevallen, max) {
    const n = Math.max(0, Math.min(typeof max === 'number' ? max : MAX_GEVALLEN, MAX_GEVALLEN));
    return (Array.isArray(gevallen) ? gevallen.slice() : [])
      .sort((a, b) => (getal(b && b.score) || 0) - (getal(a && a.score) || 0))
      .slice(0, n);
  }

  // Meet "met" tegen "zonder". Beter = minstens MIN_WINST_PCT meer goed EN niet meer fout-en-stellig. Ontbreekt een meting, dan uit
  // (nooit standaard aan zonder bewijs).
  function standaardAan(met, zonder) {
    const m = met || {}, z = zonder || {};
    const mg = getal(m.goedPct), zg = getal(z.goedPct);
    const mf = getal(m.foutZekerPct), zf = getal(z.foutZekerPct);
    if (mg == null || zg == null) return { aan: false, reden: 'niet gemeten' };
    if (mf != null && zf != null && mf > zf) return { aan: false, reden: 'met-is-meer-fout-en-stellig' };
    if (mg - zg >= MIN_WINST_PCT) return { aan: true, reden: `met scoort ${Math.round((mg - zg) * 10) / 10} punt meer goed` };
    return { aan: false, reden: 'met-meet-niet-beter' };
  }

  return { MAX_GEVALLEN, MIN_WINST_PCT, kiesGevallen, standaardAan };
}));
