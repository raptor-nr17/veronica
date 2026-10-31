// ===================================================================
// (5) WIE BESTUURT HET REK MET ADB? (de ARTEMIS-controller) -- byte-gelijk in JARVIS en Veronica
// ===================================================================
//
// Besluit van de eigenaar (31 oktober): ARTEMIS (de adb-besturing van de rektelefoons) draait het liefst OP DE F8 zelf, zodat er
// geen Chromebook-Linux na elke herstart gestart hoeft te worden. De F8 denkt daarbij lokaal (OlliteRT/Gemma 4 E4B, al aanwezig) en
// bestuurt de rektelefoons met een ingebouwde adb-bibliotheek (dadb). Maar de F8 is de dagelijkse telefoon en gaat mee de deur uit.
// Daarom kiest deze pure functie de controller, in deze volgorde (keuze van de eigenaar):
//   1. de F8  -- ALLEEN thuis (op het hoofdwifi waar adb/mDNS werkt) EN boven 30% accu (GEEN lader nodig);
//   2. een thuisblijvende rektelefoon die bereikbaar is (bij voorkeur de geheugen-/leider-telefoon, de Cat) -- als de F8 van huis
//      is of te weinig accu heeft;
//   3. anders de Chromebook (ARTEMIS op de Linux) als laatste vangnet.
// ARTEMIS bestuurt NOOIT de F8 zelf, en opent nooit een bank-/kluis-/authenticator-/betaal-/crypto-app; dat blijft gelden welke
// controller het ook is. Onbekend telt als NEE. Deze functie praat met niets: geen netwerk, geen opslag.
// Dit bestand staat byte-gelijk in JARVIS en in Veronica.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Controller = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const F8_ACCU_MIN = 30;   // de F8 bestuurt alleen boven 30% accu (geen lader nodig) -- zelfde grens als het gast-brein
  const getal = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

  // kies(o) -> { wie: 'f8' | 'rek' | 'chromebook', id, naam, reden }
  //   o.f8  = { aanwezig, thuis, accu, id } of null   (aanwezig = de F8 meldt zich; thuis = op het hoofdwifi)
  //   o.rek = [ { id, naam, thuis, bereikbaar, voorkeurController } ]   (de rektelefoons uit de hartslagen)
  function kies(o) {
    const x = o || {};
    const f8 = x.f8 || null;
    const rek = Array.isArray(x.rek) ? x.rek : [];
    // 1. de F8: thuis en boven 30% accu.
    if (f8 && f8.aanwezig === true && f8.thuis === true && getal(f8.accu) !== null && getal(f8.accu) >= F8_ACCU_MIN) {
      return { wie: 'f8', id: f8.id || null, naam: 'de F8', reden: 'de F8 is thuis en heeft genoeg accu' };
    }
    // 2. een thuisblijvende, bereikbare rektelefoon (voorkeur: de geheugen-/leider-telefoon).
    const thuisRek = rek.filter((r) => r && r.thuis === true && r.bereikbaar === true);
    if (thuisRek.length) {
      const beste = thuisRek.find((r) => r.voorkeurController === true) || thuisRek[0];
      let weg;
      if (f8 && f8.aanwezig === true && f8.thuis === true) weg = 'de F8 is thuis maar heeft te weinig accu';
      else if (f8 && f8.aanwezig === true) weg = 'de F8 is van huis';
      else weg = 'er is geen F8';
      return { wie: 'rek', id: beste.id || null, naam: beste.naam || 'een rektelefoon', reden: `${weg}; een rektelefoon neemt het over` };
    }
    // 3. de Chromebook als laatste vangnet.
    return { wie: 'chromebook', id: null, naam: 'de Chromebook', reden: 'geen F8 en geen bereikbare thuis-rektelefoon; de Chromebook bestuurt' };
  }

  // Een korte zin voor Veronica/JARVIS.
  function zin(k) {
    if (!k) return 'Controller: onbekend.';
    const naam = k.wie === 'f8' ? 'de F8' : k.wie === 'rek' ? (k.naam || 'een rektelefoon') : 'de Chromebook';
    return `ARTEMIS-controller: ${naam} (${k.reden}).`;
  }

  return { kies, zin, F8_ACCU_MIN };
}));
