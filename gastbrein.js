// ===================================================================
// 546: HET GAST-BREIN -- de dagelijkse telefoon die 's nachts meerekent, zonder scherm, zonder netwerk en zonder opslag
// ===================================================================
//
// Besluit van de eigenaar (24 oktober): de dagelijkse telefoon (12 GB) is GEEN rektelefoon en nooit baas. Hij doet alleen mee als
// alles klopt, en dan alleen voor het zware werk (lange verhalen, lastige vragen, het nakijken van antwoorden van de rektelefoons),
// met het grote model in OlliteRT (poort 8000). Hardere grenzen dan het rek:
//  - thuis: op hetzelfde wifi als het rek;
//  - aan de lader en het scherm uit (niet in gebruik);
//  - accu tussen 80% en vol;
//  - niet warmer dan 38 graden;
//  - nooit overdag: alleen tussen 23:00 en 07:00.
// Onbekend telt als NEE, bij elk punt. Gaat er een punt mis, dan merkt het rek dat aan de volgende hartslag (of aan het wifi) en draait
// alles door op het kleine model; klopt alles weer, dan schuift hij stil terug. JARVIS kan de server van OlliteRT niet zelf starten
// (460): staat die uit, dan zegt het gast-brein dat eerlijk en krijgt hij geen werk.
// Dit bestand staat byte-gelijk in JARVIS en in Veronica.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.GastBrein = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ACCU_MIN = 80;
  const TEMP_MAX = 38;
  const NACHT_VAN = 23;
  const NACHT_TOT = 7;
  const POORT = 8000;
  const isNacht = (uur) => typeof uur === 'number' && (uur >= NACHT_VAN || uur < NACHT_TOT);
  const getal = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

  // i = { thuis, laadt, schermAan, procent, temperatuur, uur, server } -> { mag, reden } (reden = code, de zin maakt zin())
  function magRekenen(i) {
    const x = i || {};
    if (x.thuis !== true) return { mag: false, reden: 'niet-thuis' };
    if (x.laadt !== true) return { mag: false, reden: 'geen-lader' };
    if (x.schermAan !== false) return { mag: false, reden: 'in-gebruik' };
    if (!isNacht(x.uur)) return { mag: false, reden: 'overdag' };
    const p = getal(x.procent);
    if (p === null || p < ACCU_MIN) return { mag: false, reden: 'accu' };
    const t = getal(x.temperatuur);
    if (t === null || t > TEMP_MAX) return { mag: false, reden: 'warm' };
    if (x.server !== true) return { mag: false, reden: 'server-uit' };
    return { mag: true, reden: '' };
  }
  const ZINNEN = Object.freeze({
    'niet-thuis': 'niet thuis (niet op het wifi van het rek)',
    'geen-lader': 'niet aan de lader',
    'in-gebruik': 'in gebruik (scherm aan)',
    overdag: 'overdag: rekent alleen tussen 23:00 en 07:00',
    accu: `accu onder ${ACCU_MIN}%`,
    warm: `warmer dan ${TEMP_MAX} graden (of onbekend)`,
    'server-uit': 'de server van OlliteRT staat uit (Start Server of Start on Boot in OlliteRT)',
  });
  function zin(g) {
    if (!g) return 'Gast-brein: afwezig.';
    return g.mag ? 'Gast-brein: aanwezig, rekent mee aan het zware werk.' : `Gast-brein: afwezig, ${ZINNEN[g.reden] || 'onbekend'}.`;
  }
  // Mag een klus naar het gast-brein? Alleen zwaar werk (gewicht zwaar) of nakijken/lastig (soort 'lastig').
  function klusVoorGast(soort, gewicht) { return gewicht === 'zwaar' || soort === 'lastig'; }

  return { ACCU_MIN, TEMP_MAX, NACHT_VAN, NACHT_TOT, POORT, isNacht, magRekenen, zin, ZINNEN, klusVoorGast };
}));
