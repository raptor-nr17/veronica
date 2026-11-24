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
  const ROLLEN = { brein: 'het brein', controle: 'de controle', verdeler: 'de verdeler', bibliothecaris: 'de bibliothecaris' };
  const ROL_KOP = { brein: 'Brein', controle: 'Controle', verdeler: 'Verdeler', bibliothecaris: 'Bibliothecaris' };
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
      // 678 (18 nov): de ROL die ARTEMIS dit toestel gaf (brein, controle, verdeler, bibliothecaris), of hij NU klaar is (de stand van die rol
      // zegt klaar en de server antwoordt), en het model. Op het rek draait ARTEMIS de modellen; JARVIS hoeft daarvoor niet te antwoorden.
      const rol = ROLLEN[x.rol] ? x.rol : null;
      const rolModel = rol ? (schoon(x.rolModel, 60) || null) : null;
      gezien.add(sleutel); uit.push({ model: model, via: via, sleutel: sleutel, temp: temp, toestel: toestel, jarvis: jarvis, meldt: meldt, rol: rol, rolKlaar: rol ? x.rolKlaar === true : false, rolModel: rolModel, surf: x.surf === true });   // 678 (23 nov): de surfstand (de verdeler pauzeert)
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
      const naam = nm[a.sleutel] || (a.rol ? `${ROL_KOP[a.rol]} (${a.model})` : a.model);
      // 678: EERST op identiteit (het toestel-id dat ARTEMIS van de telefoon las), pas dan op een zelf gekozen naam.
      const opId = a.toestel ? bk.find((b) => b && b.id && b.id === a.toestel) : null;
      const eigen = opId || (nm[a.sleutel] ? bk.find((b) => b && String(b.naam || '').toLowerCase() === nm[a.sleutel].toLowerCase()) : null);
      let pantser; let klaar = null;
      if (a.rol) {   // 678 (18 nov): een rektelefoon met een rol: ARTEMIS weet of hij klaar is -- niets scannen, niets tikken
        klaar = a.rolKlaar === true;
        pantser = klaar ? `klaar als ${ROLLEN[a.rol]}${a.rolModel ? ` (${a.rolModel})` : ''}, via ARTEMIS`
          : `${ROLLEN[a.rol]}: het model start nog; ARTEMIS zet het vanzelf klaar`;
      } else if (eigen) { klaar = eigen.klaar === true; pantser = klaar ? 'klaar in het pantser' : `nog niet klaar: ${eigen.reden || 'geen reden gemeld'}`; }
      else if (a.toestel && a.meldt === true) pantser = `JARVIS${a.jarvis ? ' ' + a.jarvis : ''} meldt zich wel bij de relay; ververs Veronica, hij verschijnt binnen enkele minuten`;
      else if (a.toestel) pantser = `JARVIS${a.jarvis ? ' ' + a.jarvis : ''} draait op deze telefoon, maar meldt zich niet bij Veronica: druk in de ARTEMIS-console op 'Koppel aan Veronica (via de kabel)', of scan op de telefoon de QR van Veronica`;
      else pantser = 'ARTEMIS ziet hem, maar JARVIS antwoordt niet op deze telefoon: start JARVIS (of installeer hem) en scan de QR van Veronica';
      const koel = km[a.sleutel] === true;
      const toon = nm[a.sleutel] || a.rol ? naam : (opId && opId.naam ? opId.naam : naam);   // een rol of een eigen naam gaat voor een automatische tegelnaam
      return { sleutel: a.sleutel, model: a.model, naam: toon, rol: a.rol, rolModel: a.rolModel, benoemd: !!nm[a.sleutel] || !!opId, gekoppeld: !!eigen || !!a.rol, toestel: a.toestel || null, aanwezig: true, via: a.via, viaZin: VIA[a.via], klaar: klaar, pantser: pantser,
        temp: a.temp, gekoeld: koel, jarvis: a.jarvis || null,
        zin: `${toon}: aanwezig ${VIA[a.via]}${a.temp != null ? ` · ${String(a.temp).replace('.', ',')} °C` : ''} · ${koel ? 'op de cooler' : 'niet op de cooler'} · ${pantser}` };
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
    // 678 (18 nov): met rollen is ps al SAMENGEVOEGD (metRollen): de rollen zitten erin; alleen een toestel zonder rol en zonder koppeling komt erbij
    if (l.some((x) => x.rol)) {
      const los = l.filter((x) => !x.rol && !x.gekoppeld).length;
      return { klaar: Math.min(klaar, kent + los), totaal: kent + los, extra: los, zin: `${Math.min(klaar, kent + los)} van ${kent + los} klaar` };
    }
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

  // metRollen(ps, telefoons, artemisRuw, aan): de pantser-regel MET de rollen van ARTEMIS. ps = Pool.pantserRegel van de telefoons die Veronica zelf
  // kent; telefoons = [{naam, adres, id, dagelijks}]. Een telefoon die ook een ARTEMIS-toestel MET rol is (zelfde toestel-id) telt via zijn rol, niet
  // via een motor van JARVIS; een rol zonder Veronica-telefoon telt er gewoon bij. De dagelijkse telefoon telt nooit mee (die staat ook niet bij ARTEMIS).
  function metRollen(ps, telefoons, artemisRuw, aan) {
    const p = ps && typeof ps === 'object' ? ps : { regel: '', klaar: 0, totaal: 0, helpen: [] };
    if (!aan) return p;
    const rollen = lees(artemisRuw).filter((a) => a.rol);
    if (!rollen.length) return p;
    const tel = Array.isArray(telefoons) ? telefoons : [];
    const ids = new Set(rollen.map((a) => a.toestel).filter(Boolean));
    const gekoppeld = tel.filter((t) => t && !t.dagelijks && t.id && ids.has(t.id));
    const helpenV = (p.helpen || []).filter((h) => !gekoppeld.some((t) => t.adres === h.adres));
    const vKlaar = Math.max(0, (p.klaar || 0) - gekoppeld.filter((t) => !(p.helpen || []).some((h) => h.adres === t.adres)).length);
    const vTot = Math.max(0, (p.totaal || 0) - gekoppeld.length);
    const rk = rollen.filter((a) => a.rolKlaar);
    const nietKlaar = rollen.filter((a) => !a.rolKlaar).map((a) => ({ naam: `${ROL_KOP[a.rol]} (${a.model})`, adres: 'rek:' + a.sleutel, reden: 'het model start nog',
      zin: `${ROL_KOP[a.rol]} (${a.model}): het model start nog; ARTEMIS zet het vanzelf klaar` }));
    const klaar = vKlaar + rk.length; const totaal = vTot + rollen.length;
    const volg = ['brein', 'controle', 'verdeler', 'bibliothecaris'];
    const namenKlaar = volg.filter((r) => rk.some((a) => a.rol === r)).map((r) => ROLLEN[r].replace(/^(het|de) /, ''));
    const regel = `Pantser aan: ${klaar} van ${totaal} klaar · het rek via ARTEMIS: ${namenKlaar.length ? namenKlaar.join(', ') + ' klaar' : 'nog niets klaar'}`
      + `${p.tokensPerS != null ? ` · samen ±${p.tokensPerS} tokens/s` : ''}`;
    return Object.assign({}, p, { regel: regel, klaar: klaar, totaal: totaal, tegelijk: Math.max(p.tegelijk || 0, klaar), helpen: helpenV.concat(nietKlaar), rollen: rollen.length });
  }
  // tegelsBijwerken(telefoons, artemisRuw, o): wat er met de TEGELS van Veronica moet gebeuren nu ARTEMIS de rollen kent -- zonder dat de eigenaar
  // iets hoeft te doen. Terug { namen: [{adres, naam}], weg: [{adres, naam, reden}] }.
  //  - een tegel met een AUTOMATISCHE naam ("Telefoon 109", uit een hartslag zonder naam) die hetzelfde toestel-id heeft als een rol, krijgt de
  //    naam van die rol ("Controle (MODEL)"); een naam die de eigenaar zelf gaf blijft altijd staan;
  //  - een tegel met een automatische naam die AAN NIETS hangt -- geen rol, geen verse hartslag, en al een dag geen rechtstreeks antwoord -- is
  //    een oud adres en gaat weg. Nooit de beheerder, nooit de dagelijkse telefoon, en alleen als ARTEMIS de rollen echt kent.
  const AUTO_NAAM = /^Telefoon \.?\d{1,3}$/;
  const DAG_MS = 24 * 3600 * 1000;
  function tegelsBijwerken(telefoons, artemisRuw, o) {
    const op = o || {}; const tijd = op.nu || Date.now();
    const rollen = lees(artemisRuw).filter((a) => a.rol);
    const uit = { namen: [], weg: [] };
    if (!rollen.length) return uit;
    const vers = new Set(Array.isArray(op.versIds) ? op.versIds : []);
    const laatst = op.laatst || {};
    for (const t of Array.isArray(telefoons) ? telefoons : []) {
      if (!t || t.kern || t.dagelijks || !AUTO_NAAM.test(String(t.naam || ''))) continue;
      const a = t.id ? rollen.find((x) => x.toestel === t.id) : null;
      if (a) { const n = `${ROL_KOP[a.rol]} (${a.model})`; if (n !== t.naam) uit.namen.push({ adres: t.adres, naam: n }); continue; }
      const direct = Math.max(Number(laatst[t.adres]) || 0, Number(laatst[t.jarvis]) || 0);
      if ((t.id && vers.has(t.id)) || tijd - direct <= DAG_MS) continue;
      uit.weg.push({ adres: t.adres, naam: t.naam, reden: 'een oud adres: geen rol bij ARTEMIS, geen hartslag en al een dag geen antwoord' });
    }
    return uit;
  }

  return { lees, namen, zetNaam, gekoeld, zetGekoeld, rijen, telling, samenvatting, metRollen, tegelsBijwerken, ROLLEN, SLEUTEL, KOEL_SLEUTEL, VIA, MAX };
}));
