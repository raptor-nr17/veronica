// ===================================================================
// 678 (12 nov, stap 7 spraak): TWEE STEMMEN, EEN STEM. De butler (gewone Veronica) en de privé-hoek zijn twee INSTELLINGEN van dezelfde lokale Piper-stem op de Cat,
// geen twee modellen: een Piper-stem is een enkele spreker (een speaker-id heeft hij niet), dus het verschil zit in tempo, pauzes en -- alleen als er nabewerkt wordt --
// toonhoogte. PUUR rekenen: geen netwerk, geen opslag, geen DOM, geen model. De uitkomst gaat als `speed` naar sherpa-onnx (`OfflineTts.generate(tekst, sid, speed)`),
// of als `rate`/`pitch` naar de browserstem op de Chromebook (alleen een LOKALE stem, zie veronica.js).
// Afspraak: geen merk, persoon of plaats in dit bestand.
// ===================================================================
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Stemprofiel = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // speed: 1,0 = normaal tempo (hoger = sneller). pauzeMs: stilte tussen zinnen. pitch: alleen voor de browserstem (Piper heeft geen toonhoogte-instelling).
  const BUTLER = Object.freeze({ naam: 'butler', speed: 1.0, pauzeMs: 250, pitch: 1.0 });
  const PRIVE = Object.freeze({
    zacht: Object.freeze({ naam: 'prive-zacht', speed: 0.92, pauzeMs: 450, pitch: 0.97 }),
    speels: Object.freeze({ naam: 'prive-speels', speed: 0.95, pauzeMs: 400, pitch: 0.98 }),
    pittig: Object.freeze({ naam: 'prive-pittig', speed: 0.9, pauzeMs: 500, pitch: 0.95 }),
  });
  // profiel(rol, stemming): rol 'prive' of iets anders (= butler); stemming 'zacht' | 'speels' | 'pittig' (onbekend/auto -> speels). Nooit buiten de grenzen.
  function profiel(rol, stemming) {
    if (rol !== 'prive') return BUTLER;
    return PRIVE[stemming] || PRIVE.speels;
  }
  // zegBody(tekst, rol, stemming): de aanvraag voor POST /zeg van de stem-telefoon -- ALLEEN de tekst en het tempo; nooit de rol of de stemming zelf (die blijft hier).
  function zegBody(tekst, rol, stemming) {
    const p = profiel(rol, stemming);
    return { tekst: String(tekst == null ? '' : tekst).slice(0, 600), speed: p.speed };
  }
  return { profiel, zegBody, BUTLER, PRIVE };
}));
