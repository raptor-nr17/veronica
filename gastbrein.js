// ===================================================================
// 546: HET GAST-BREIN -- de dagelijkse telefoon die meerekent als hij niet in gebruik is, zonder scherm, zonder netwerk en zonder opslag
// ===================================================================
//
// Besluit van de eigenaar (24 oktober): de dagelijkse telefoon (12 GB) is GEEN rektelefoon en nooit baas. Hij doet alleen mee als
// alles klopt, en dan alleen voor het zware werk (lange verhalen, lastige vragen, het nakijken van antwoorden van de rektelefoons),
// met het grote model in OlliteRT (poort 8000). De grenzen (548b, besluit van de eigenaar 24 oktober: "vergeet de 80 procent"):
//  - thuis: op hetzelfde wifi als het rek;
//  - niet in gebruik (scherm uit); aan de lader of niet maakt NIET uit;
//  - accu 30% of meer (onder 30% doet hij niet mee);
//  - niet warmer dan 38 graden.
// Het nachtvenster (23-07) en de lader-eis van 546 zijn weg: "niet in gebruik" is de bewaking overdag.
// Onbekend telt als NEE, bij elk punt. Gaat er een punt mis, dan merkt het rek dat aan de volgende hartslag (of aan het wifi) en draait
// alles door op het kleine model; klopt alles weer, dan schuift hij stil terug. JARVIS kan de server van OlliteRT niet zelf starten
// (460): staat die uit, dan zegt het gast-brein dat eerlijk en krijgt hij geen werk.
// Dit bestand staat byte-gelijk in JARVIS en in Veronica.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.GastBrein = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ACCU_MIN = 30;
  const TEMP_MAX = 38;
  const POORT = 8000;
  const getal = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

  // i = { thuis, schermAan, procent, temperatuur, server } -> { mag, reden } (reden = code, de zin maakt zin()). Lader en uur tellen
  // niet meer mee (548b); ze mogen nog wel meekomen.
  function magRekenen(i) {
    const x = i || {};
    if (x.thuis !== true) return { mag: false, reden: 'niet-thuis' };
    if (x.schermAan !== false) return { mag: false, reden: 'in-gebruik' };
    const p = getal(x.procent);
    if (p === null || p < ACCU_MIN) return { mag: false, reden: 'accu' };
    const t = getal(x.temperatuur);
    if (t === null || t > TEMP_MAX) return { mag: false, reden: 'warm' };
    if (x.server !== true) return { mag: false, reden: 'server-uit' };
    return { mag: true, reden: '' };
  }
  const ZINNEN = Object.freeze({
    'niet-thuis': 'niet thuis (niet op het wifi van het rek)',
    'in-gebruik': 'in gebruik (scherm aan)',
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

  return { ACCU_MIN, TEMP_MAX, POORT, magRekenen, zin, ZINNEN, klusVoorGast };
}));
