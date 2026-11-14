// ===================================================================
// 678 (14 nov): DE ZELFRONDE VAN ARTEMIS, zoals Veronica hem toont. ARTEMIS (de console op de Chromebook) kijkt elke ~15 minuten zelf
// na wat Cowork vroeger met de hand nakeek: draait ARTEMIS, werkt de console zichzelf bij, meldt elke rektelefoon zich bij de relay,
// werkt Claude door, komt Cowork of de eigenaar nog in de console, en draait de bewaker. Hij schrijft dat in zelfronde.json; Veronica
// leest dat ALLEEN (op Meer, via /zelfronde.json) en zet het hier om in korte regels.
// PUUR: geen netwerk, geen opslag, geen DOM. Een veld dat niet klopt telt niet mee: liever een regel minder dan een verzonnen regel.
// Afspraak: geen merk, persoon of plaats in dit bestand (het gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Zelfronde = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NAMEN = Object.freeze({ artemis: 'ARTEMIS', bijwerken: 'Bijwerken', melden: 'Melden bij Veronica', claude: 'Claude', cowork: 'Cowork', bewaker: 'Bewaker van de console' });
  const OUD_MS = 45 * 60 * 1000;   // een zelfronde draait elke ~15 min; ouder dan drie rondes = de console zelf staat mogelijk stil

  // lees(tekst): { t (ms), punten: [{ naam, ok (true|false|null), zin }] } of null.
  function lees(tekst) {
    let d;
    try { d = typeof tekst === 'string' ? JSON.parse(tekst) : tekst; } catch (e) { return null; }
    if (!d || typeof d !== 'object' || !Array.isArray(d.punten)) return null;
    const t = Number(d.t);
    if (!isFinite(t) || t <= 0) return null;
    const punten = [];
    for (const p of d.punten.slice(0, 20)) {
      if (!p || typeof p !== 'object' || !Object.prototype.hasOwnProperty.call(NAMEN, p.naam)) continue;
      if (!(p.ok === true || p.ok === false || p.ok === null)) continue;
      const zin = typeof p.zin === 'string' ? p.zin.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300) : '';
      if (!zin) continue;
      punten.push({ naam: p.naam, ok: p.ok, zin });
    }
    return { t: t * 1000, punten };
  }

  function duur(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    return m < 90 ? `${m} min` : `${Math.round(m / 60)} uur`;
  }

  // regels(z, nu): de kop en per punt een regel. Eerst wat aandacht vraagt, dan het onbekende, dan wat goed is.
  function regels(z, nu) {
    if (!z) return [];
    const n = Number(nu) || Date.now();
    const leeftijd = n - z.t;
    const nee = z.punten.filter((p) => p.ok === false);
    const kop = leeftijd > OUD_MS
      ? `Zelfronde van ARTEMIS: de laatste is van ${duur(leeftijd)} geleden. De console doet hem normaal elk kwartier; staat de console stil?`
      : nee.length
        ? `Zelfronde van ARTEMIS (${duur(leeftijd)} geleden): ${nee.length} ${nee.length === 1 ? 'punt vraagt' : 'punten vragen'} aandacht.`
        : `Zelfronde van ARTEMIS (${duur(leeftijd)} geleden): alles in orde.`;
    const volgorde = (p) => (p.ok === false ? 0 : p.ok === null ? 1 : 2);
    const rij = z.punten.slice().sort((a, b) => volgorde(a) - volgorde(b))
      .map((p) => `${p.ok === true ? 'OK' : p.ok === false ? 'NEE' : '?'} ${NAMEN[p.naam]}: ${p.zin}`);
    return [kop].concat(rij);
  }

  return { lees, regels, NAMEN, OUD_MS };
}));
