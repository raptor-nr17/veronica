// ===================================================================
// 678 (punt 22, 11 nov): de telefoonlijst in Veronica toont per rektelefoon of hij AANWEZIG is en of hij in het pantser zit.
// PUUR rekenen in CODE -- geen netwerk, geen opslag, geen DOM, geen model. De bron is wat ARTEMIS (de console op de computer) weet:
// welke rektelefoons er via kabel, wifi of Tailscale/adb verbonden zijn. Zo hangt "aanwezig" niet alleen van de hartslag af.
//
// EERLIJK: "aanwezig via ARTEMIS" is NIET "klaar in het pantser". Klaar zegt alleen de telefoon zelf (hartslag/motor). De hartslag draagt
// geen toesteltype, dus een ARTEMIS-toestel wordt NIET geraden aan een Veronica-telefoon gekoppeld: alleen als de eigenaar het toestel
// dezelfde NAAM gaf als een bekende telefoon (zelf gekozen, lokaal bewaard) nemen we diens klaar/reden over. Anders zegt de rij dat.
//
// Afspraak: geen merk, persoon of plaats in dit bestand (het gaat mee naar de openbare Veronica-site). De F8 komt hier nooit in:
// ARTEMIS levert hem niet (en wij laten hem ook niet toe als hij toch in de lijst stond).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Rekaanwezig = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX = 12;
  const VIA = { kabel: 'via de kabel', wifi: 'via wifi (adb)', tailscale: 'via Tailscale (adb)' };
  const SLEUTEL = 'veronica-rek-namen';

  const schoon = (t, max) => String(t == null ? '' : t).replace(/[^\p{L}\p{N} ._()\/+-]/gu, '').trim().slice(0, max);

  // lees(ruw): de JSON van ARTEMIS (/rek.json) -> een schone lijst [{model, via, sleutel}]. Onzin, een F8 of dubbelen vallen weg.
  function lees(ruw) {
    let l = ruw;
    if (typeof l === 'string') { try { l = JSON.parse(l); } catch (e) { return []; } }
    if (!Array.isArray(l)) return [];
    const gezien = new Set(); const uit = [];
    for (const x of l.slice(0, MAX * 2)) {
      if (!x || typeof x !== 'object') continue;
      const model = schoon(x.model, 40);
      const sleutel = /^[0-9a-f]{8}$/.test(String(x.sleutel || '')) ? String(x.sleutel) : '';
      const via = VIA[x.via] ? x.via : 'kabel';
      if (!model || !sleutel || gezien.has(sleutel)) continue;
      if (/F8|25102PCBEG/i.test(model)) continue;   // de dagelijkse telefoon hoort hier nooit
      gezien.add(sleutel); uit.push({ model: model, via: via, sleutel: sleutel });
      if (uit.length >= MAX) break;
    }
    return uit;
  }

  // namen(ruw): de zelf gekozen namen { sleutel: naam }. Kapotte opslag = {}.
  function namen(ruw) {
    let o = ruw;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return {}; } }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const uit = {};
    for (const k of Object.keys(o)) { const n = schoon(o[k], 40); if (/^[0-9a-f]{8}$/.test(k) && n) uit[k] = n; }
    return uit;
  }
  function zetNaam(map, sleutel, naam) {
    const uit = namen(map);
    const n = schoon(naam, 40);
    if (!/^[0-9a-f]{8}$/.test(String(sleutel || ''))) return uit;
    if (n) uit[sleutel] = n; else delete uit[sleutel];
    return uit;
  }

  // rijen(artemisLijst, namenMap, bekend): per ARTEMIS-toestel een rij. bekend = [{naam, klaar, reden}] van de telefoons die Veronica
  // zelf kent (uit pantserStand/hartslag). Een koppeling bestaat ALLEEN via een gelijke naam (hoofdletterongevoelig).
  function rijen(artemis, namenMap, bekend) {
    const nm = namen(namenMap);
    const bk = Array.isArray(bekend) ? bekend : [];
    return lees(artemis).map((a) => {
      const naam = nm[a.sleutel] || a.model;
      const eigen = nm[a.sleutel] ? bk.find((b) => b && String(b.naam || '').toLowerCase() === nm[a.sleutel].toLowerCase()) : null;
      let pantser; let klaar = null;
      if (eigen) { klaar = eigen.klaar === true; pantser = klaar ? 'klaar in het pantser' : `nog niet klaar: ${eigen.reden || 'geen reden gemeld'}`; }
      else pantser = 'in het pantser: nog niet bevestigd door de telefoon zelf (geen hartslag aan deze naam gekoppeld)';
      return { sleutel: a.sleutel, model: a.model, naam: naam, benoemd: !!nm[a.sleutel], aanwezig: true, via: a.via, viaZin: VIA[a.via], klaar: klaar, pantser: pantser,
        zin: `${naam}: aanwezig ${VIA[a.via]} · ${pantser}` };
    });
  }

  // samenvatting(rijen): een korte kop.
  function samenvatting(r) {
    const l = Array.isArray(r) ? r : [];
    if (!l.length) return '';
    const klaar = l.filter((x) => x.klaar === true).length;
    const onbekend = l.filter((x) => x.klaar === null).length;
    return `ARTEMIS ziet ${l.length} ${l.length === 1 ? 'rektelefoon' : 'rektelefoons'} aanwezig · ${klaar} bevestigd klaar in het pantser${onbekend ? ` · ${onbekend} nog niet bevestigd` : ''}`;
  }

  return { lees, namen, zetNaam, rijen, samenvatting, SLEUTEL, VIA, MAX };
}));
