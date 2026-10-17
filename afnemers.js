/*
 * 485 (17 oktober): WIE GEBRUIKT DE REKENKRACHT? De baas telt per afnemer hoeveel klussen er het afgelopen uur klaar kwamen:
 * Claude (de rekenpostbus en het rekenpool-adres), de verhalengids (de postbus met vertaal- en keurklussen) en de eigen vragen.
 * Alleen getallen: geen inhoud, geen namen, geen tijdstippen naar buiten. Mijn-AI telt NIET mee: de privé-hoek praat
 * rechtstreeks met een motor en laat niets na, ook geen teller.
 */
(function (wereld) {
  'use strict';
  const AFNEMERS = ['claude', 'gids', 'eigen'];
  const UUR_MS = 60 * 60 * 1000;
  const MAX = 2000;
  function maak() {
    const tijden = { claude: [], gids: [], eigen: [] };
    const totaal = { claude: 0, gids: 0, eigen: 0 };
    return {
      tel(afnemer, nu) {
        if (!AFNEMERS.includes(afnemer)) return false;
        tijden[afnemer].push(nu);
        if (tijden[afnemer].length > MAX) tijden[afnemer].shift();
        totaal[afnemer] += 1;
        return true;
      },
      stand(nu) {
        const uur = {};
        for (const a of AFNEMERS) { tijden[a] = tijden[a].filter((t) => nu - t <= UUR_MS); uur[a] = tijden[a].length; }
        return { uur, totaal: Object.assign({}, totaal) };
      },
    };
  }
  // Voor Veronica: alleen gehele getallen 0..99999 per bekende afnemer; al het andere valt weg.
  function lees(x) {
    if (!x || typeof x !== 'object' || !x.uur || typeof x.uur !== 'object') return null;
    const g = (v) => (Number.isInteger(v) && v >= 0 && v <= 99999 ? v : 0);
    const uur = {};
    const totaal = {};
    for (const a of AFNEMERS) { uur[a] = g(x.uur[a]); totaal[a] = g(x.totaal && x.totaal[a]); }
    return { uur, totaal };
  }
  function zin(s) {
    if (!s) return '';
    const u = s.uur;
    return `Klussen het afgelopen uur via de baas: Claude ${u.claude}, verhalengids ${u.gids}, eigen vragen ${u.eigen}. Mijn-AI telt niet mee (privé).`;
  }
  const uit = { AFNEMERS, UUR_MS, maak, lees, zin };
  if (typeof module !== 'undefined' && module.exports) module.exports = uit;
  else wereld.Afnemers = uit;
})(typeof window !== 'undefined' ? window : globalThis);
