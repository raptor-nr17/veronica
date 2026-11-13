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
  const KOEL_SLEUTEL = 'veronica-rek-gekoeld';   // welke toestellen op een cooler liggen (zelf aangegeven, lokaal, per ARTEMIS-sleutel)

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
      const temp = typeof x.temp === 'number' && isFinite(x.temp) && x.temp > -20 && x.temp < 80 ? Math.round(x.temp * 10) / 10 : null;   // batterij in graden; onbekend blijft null
      // 678 (12 nov): het JARVIS-toestel-id dat ARTEMIS via adb van de telefoon ZELF las (/jarvis/status). Dat bindt dit ARTEMIS-toestel aan een Veronica-telefoon op
      // IDENTITEIT, niet op een IP-adres of een naam. Onbekend/ongeldig = null (JARVIS draait niet, of meldt zich niet).
      const toestel = /^[a-z0-9]{12,32}$/.test(String(x.toestel || '')) ? String(x.toestel) : null;
      const meldt = x.meldt === true ? true : x.meldt === false ? false : null;   // ARTEMIS: staat de telefoon in de relay-lijst? onbekend = null
      const jarvis = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(x.jarvis || '')) ? String(x.jarvis) : null;   // de JARVIS-versie die op die telefoon draait
      gezien.add(sleutel); uit.push({ model: model, via: via, sleutel: sleutel, temp: temp, toestel: toestel, jarvis: jarvis, meldt: meldt });
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

  // gekoeld(ruw): { sleutel: true } van de toestellen die op een cooler liggen. Standaard NIET gekoeld (voorzichtig). Kapotte opslag = {}.
  function gekoeld(ruw) {
    let o = ruw;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return {}; } }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const uit = {}; for (const k of Object.keys(o)) if (/^[0-9a-f]{8}$/.test(k) && o[k] === true) uit[k] = true;
    return uit;
  }
  function zetGekoeld(map, sleutel, aan) {
    const uit = gekoeld(map);
    if (!/^[0-9a-f]{8}$/.test(String(sleutel || ''))) return uit;
    if (aan) uit[sleutel] = true; else delete uit[sleutel];
    return uit;
  }

  // rijen(artemisLijst, namenMap, bekend): per ARTEMIS-toestel een rij. bekend = [{naam, klaar, reden}] van de telefoons die Veronica
  // zelf kent (uit pantserStand/hartslag). Een koppeling bestaat ALLEEN via een gelijke naam (hoofdletterongevoelig).
  function rijen(artemis, namenMap, bekend, koelMap) {
    const nm = namen(namenMap);
    const km = gekoeld(koelMap);
    const bk = Array.isArray(bekend) ? bekend : [];
    return lees(artemis).map((a) => {
      const naam = nm[a.sleutel] || a.model;
      // 678: EERST op identiteit (het toestel-id dat ARTEMIS van de telefoon las), pas dan op een zelf gekozen naam.
      const opId = a.toestel ? bk.find((b) => b && b.id && b.id === a.toestel) : null;
      const eigen = opId || (nm[a.sleutel] ? bk.find((b) => b && String(b.naam || '').toLowerCase() === nm[a.sleutel].toLowerCase()) : null);
      let pantser; let klaar = null;
      if (eigen) { klaar = eigen.klaar === true; pantser = klaar ? 'klaar in het pantser' : `nog niet klaar: ${eigen.reden || 'geen reden gemeld'}`; }
      else if (a.toestel && a.meldt === true) pantser = `JARVIS${a.jarvis ? ' ' + a.jarvis : ''} meldt zich wel bij de relay; ververs Veronica, hij verschijnt binnen enkele minuten`;
      else if (a.toestel) pantser = `JARVIS${a.jarvis ? ' ' + a.jarvis : ''} draait op deze telefoon, maar meldt zich niet bij Veronica: druk in de ARTEMIS-console op 'Koppel aan Veronica (via de kabel)', of scan op de telefoon de QR van Veronica`;
      else pantser = 'ARTEMIS ziet hem, maar JARVIS antwoordt niet op deze telefoon: start JARVIS (of installeer hem) en scan de QR van Veronica';
      const koel = km[a.sleutel] === true;
      return { sleutel: a.sleutel, model: a.model, naam: opId && opId.naam ? opId.naam : naam, benoemd: !!nm[a.sleutel] || !!opId, gekoppeld: !!eigen, toestel: a.toestel || null, aanwezig: true, via: a.via, viaZin: VIA[a.via], klaar: klaar, pantser: pantser,
        temp: a.temp, gekoeld: koel, jarvis: a.jarvis || null,
        zin: `${opId && opId.naam ? opId.naam : naam}: aanwezig ${VIA[a.via]}${a.temp != null ? ` · ${String(a.temp).replace('.', ',')} °C` : ''} · ${koel ? 'op de cooler' : 'niet op de cooler'} · ${pantser}` };
    });
  }

  // samenvatting(rijen): een korte kop.
  // telling(rijen, ps): "N van M klaar" MET de ARTEMIS-telefoons. M = de telefoons die Veronica kent + de aanwezige ARTEMIS-toestellen die ze nog niet
  // aan een telefoon van haar koppelde (die kon ze niet tellen: ze zijn er wel, ze melden alleen nog geen hartslag); N = wat Veronica klaar meldt.
  // Zo staat er niet meer "0 van 2 klaar" terwijl ARTEMIS er vier ziet. ps = { klaar, totaal } van de pantser-regel.
  function telling(rijen, ps) {
    const l = Array.isArray(rijen) ? rijen : []; const p = ps && typeof ps === 'object' ? ps : {};
    const kent = Number.isFinite(p.totaal) ? p.totaal : 0; const klaar = Number.isFinite(p.klaar) ? p.klaar : 0;
    // Een niet-benoemd ARTEMIS-toestel kan dezelfde telefoon zijn die Veronica al kent (we weten het pas bij een naam): dus NIET optellen maar het grootste van de twee.
    const totaal = Math.max(kent, l.length);
    const extra = Math.max(0, l.length - kent);
    return { klaar: Math.min(klaar, totaal), totaal: totaal, extra: extra, zin: `${Math.min(klaar, totaal)} van ${totaal} klaar` };
  }
  function samenvatting(r, ps) {
    const l = Array.isArray(r) ? r : [];
    if (!l.length) return '';
    if (ps) { const t = telling(l, ps); return `Pantser: ${t.zin} · ARTEMIS ziet ${l.length} ${l.length === 1 ? 'rektelefoon' : 'rektelefoons'} aanwezig${t.extra ? ` (${t.extra} nog niet aan Veronica gekoppeld)` : ''}`; }
    const klaar = l.filter((x) => x.klaar === true).length;
    const onbekend = l.filter((x) => x.klaar === null).length;
    return `ARTEMIS ziet ${l.length} ${l.length === 1 ? 'rektelefoon' : 'rektelefoons'} aanwezig · ${klaar} bevestigd klaar in het pantser${onbekend ? ` · ${onbekend} nog niet bevestigd` : ''}`;
  }

  return { lees, namen, zetNaam, gekoeld, zetGekoeld, rijen, telling, samenvatting, SLEUTEL, KOEL_SLEUTEL, VIA, MAX };
}));
