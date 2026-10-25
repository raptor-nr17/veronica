// ===================================================================
// 500 (18 oktober): DE HARTSLAG EN DE ROEP VIA DE BRIEVENBUS -- byte-gelijk in JARVIS (www/) en Veronica (tools/veronica/)
// ===================================================================
//
// Wat het oplost: Veronica (een https-pagina op de Chromebook) kon de telefoons alleen over het eigen wifi bereiken. Zit de
// Chromebook op een ander net (een gastnetwerk houdt toestellen uit elkaar), of kreeg een telefoon een nieuw adres, dan zag
// Veronica "geen antwoord" en wist niet waarom. Nu:
//  - HARTSLAG: elke telefoon legt hoogstens eens per tien minuten (bij een verandering) en anders eens per uur een korte,
//    versleutelde regel op ntfy.sh: versie, adres op het wifi, rol, eigen motor (aan, model binnen, tempo), accu en warmte.
//    Zo weet Veronica OOK zonder wifi wanneer elke telefoon voor het laatst leefde en waarom hij niet antwoordt.
//  - ROEP: kan Veronica een telefoon niet over het wifi bereiken, dan legt ze de opdracht (dezelfde soorten als
//    /jarvis/roep) versleuteld op ntfy; de telefoon haalt hem zelf op (eens per minuut) en verwerkt hem op precies dezelfde
//    manier, NA dezelfde controle op de koppelcode.
// Geen server van ons: het onderwerp en de sleutel zijn een hash van het GEHEIME ntfy-onderwerp van de rij (jv + 30 tekens,
// zoals de ledenbrief van 482), nooit van de code van zes cijfers. Een roep draagt bovendien de koppelcode (binnen de
// versleuteling), een tijd (hoogstens vijftien minuten oud) en een eenmalig nummer: een oude roep opnieuw afspelen doet niets.
// ntfy.sh telt berichten per huis (een publiek IP): daarom geen hartslag per minuut.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Hartslag = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SERVER = 'https://ntfy.sh';
  const ONDERWERP_RE = /^jv[a-z0-9]{30}$/;
  const ID_RE = /^[a-z0-9]{12,40}$/;
  const IP_RE = /^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/;
  // 516: ntfy.sh geeft hoogstens 250 berichten per dag voor het HELE huis (een publiek IP). Met 10 minuten / een uur gingen twee
  // telefoons daar in het echte huis overheen (429). Nu: bij een verandering hoogstens eens per half uur, anders eens per anderhalf uur
  // (Veronica rekent een hartslag twee uur vers).
  const MIN_MS = 30 * 60 * 1000;      // bij een verandering hoogstens zo vaak
  const VERS_MS = 90 * 60 * 1000;     // zonder verandering toch eens per anderhalf uur
  const HOOGST_MS = 100 * 60 * 1000;  // 527: nooit langer stil dan dit (zolang er vandaag nog berichten over zijn)
  const ROEP_GELDIG_MS = 15 * 60 * 1000;
  // Soorten die naar ALLE telefoons mogen (naar: '*'); de rest moet een toestel bij naam (id) noemen.
  const VOOR_IEDEREEN = ['roep', 'zelftest'];
  const CODE_OVERNEMEN = ['word-werker'];   // 527: alleen deze roep mag een andere rij-code meebrengen (zie leesRoep)
  // 529: DE RELAY (tools/relay, 528) als EERSTE weg, naast ntfy.sh. Hij bootst ntfy na, dus alleen het adres verandert; de
  // versleuteling, de onderwerpen en de controles blijven precies dezelfde. Leeg adres = uit (zo staat het tot de relay bestaat).
  // Alleen een workers.dev-adres van Cloudflare via https: een getypt of geplakt ander adres doet niets.
  const RELAY_RE = /^https:\/\/[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){0,3}\.workers\.dev$/;
  // 548: via de relay is de hartslag de VASTE ROUTE: elke 30 s, met of zonder verandering (de klok van JARVIS tikt elke 30 s;
  // 2 s speling zodat een tik die net te vroeg valt niet een hele ronde overslaat). ntfy's dagbudget telt hier niet.
  const RELAY_MIN_MS = 28 * 1000;
  const RELAY_VERS_MS = 28 * 1000;

  const tekstBytes = (t) => new TextEncoder().encode(t);
  const naarHex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
  const hexNaar = (h) => new Uint8Array(String(h).match(/../g).map((x) => parseInt(x, 16)));
  const cryptoNu = (c) => c || (typeof crypto !== 'undefined' ? crypto : null);
  const schoon = (t, n) => String(t === null || t === undefined ? '' : t).replace(/[^\p{L}\p{N} .,:%()·_/-]/gu, '').slice(0, n);
  const getal = (x, min, max) => (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : null);

  function meetuurBlok(x) {
    if (!x || typeof x !== 'object') return null;
    const g = (v, a, b) => getal(typeof v === 'number' ? v : NaN, a, b);
    if (x.bezig === true) return { bezig: true, start: Math.floor(Number(x.start) || 0), n: g(x.n, 0, 1000), tot: Math.floor(Number(x.tot) || 0) };
    const REDEN = ['klaar', 'te warm', 'accu laag', 'motor weg', 'gestopt', 'drie fouten'];
    return { bezig: false, start: Math.floor(Number(x.start) || 0), min: g(x.min, 0, 1000), n: g(x.n, 0, 1000), gelukt: g(x.gelukt, 0, 1000),
      tpsMid: g(x.tpsMid, 0, 1000), tpsMin: g(x.tpsMin, 0, 1000), tpsMax: g(x.tpsMax, 0, 1000), tpsBegin: g(x.tpsBegin, 0, 1000), tpsEind: g(x.tpsEind, 0, 1000),
      tempBegin: g(x.tempBegin, -20, 90), tempMax: g(x.tempMax, -20, 90), accuBegin: g(x.accuBegin, 0, 100), accuEind: g(x.accuEind, 0, 100),
      laadt: ['steeds', 'soms', 'nooit'].includes(x.laadt) ? x.laadt : null, reden: REDEN.includes(x.reden) ? x.reden : '' };
  }
  function relayGeldig(u) {
    const a = String(u || '').trim().replace(/\/+$/, '').toLowerCase();
    return RELAY_RE.test(a) ? a : null;
  }
  // 529: HET MEETUUR (meetplan D). De telefoon meet zelf, met zijn eigen motor, een uur lang elke drie minuten het tempo bij een
  // middellange vraag, en de warmte en de accu. Dit maakt van de monsters EEN samenvatting (alleen getallen); de hartslag draagt die.
  function meetuurUit(monsters, start, reden) {
    const m = (Array.isArray(monsters) ? monsters : []).filter((x) => x && typeof x.t === 'number');
    const tps = m.map((x) => x.tps).filter((x) => typeof x === 'number' && x > 0).sort((a, b) => a - b);
    const temp = m.map((x) => x.temp).filter((x) => typeof x === 'number');
    const accu = m.map((x) => x.accu).filter((x) => typeof x === 'number');
    const r1 = (x) => Math.round(x * 10) / 10;
    return {
      start: Math.floor(Number(start) || 0), min: m.length ? Math.round((m[m.length - 1].t - (Number(start) || m[0].t)) / 60000) : 0,
      n: m.length, gelukt: tps.length,
      tpsMid: tps.length ? r1(tps[Math.floor(tps.length / 2)]) : null, tpsMin: tps.length ? r1(tps[0]) : null, tpsMax: tps.length ? r1(tps[tps.length - 1]) : null,
      tpsBegin: tps.length ? r1(m.find((x) => x.tps > 0).tps) : null, tpsEind: tps.length ? r1(m.slice().reverse().find((x) => x.tps > 0).tps) : null,
      tempBegin: temp.length ? r1(temp[0]) : null, tempMax: temp.length ? r1(Math.max(...temp)) : null,
      accuBegin: accu.length ? accu[0] : null, accuEind: accu.length ? accu[accu.length - 1] : null,
      laadt: m.length ? (m.every((x) => x.laadt === true) ? 'steeds' : m.some((x) => x.laadt === true) ? 'soms' : 'nooit') : null,
      reden: String(reden || ''),
    };
  }
  async function onderwerp(o, soort, c) {
    if (!ONDERWERP_RE.test(String(o || ''))) return null;
    const voor = soort === 'roep' ? 'veronica-roep:' : 'veronica-hartslag:';
    return (soort === 'roep' ? 'vr' : 'vh') + naarHex(await cryptoNu(c).subtle.digest('SHA-256', tekstBytes(voor + o))).slice(0, 30);
  }
  // 508: een korte VINGERAFDRUK van het geheime onderwerp (8 tekens van een hash). Een telefoon zet hem open in /jarvis/status, zodat
  // Veronica ziet of hij dezelfde brievenbus gebruikt als zij, zonder dat het onderwerp zelf ooit open op het wifi staat.
  async function vinger(o, c) {
    if (!ONDERWERP_RE.test(String(o || ''))) return null;
    return naarHex(await cryptoNu(c).subtle.digest('SHA-256', tekstBytes('brievenbus-vinger:' + o))).slice(0, 8);
  }
  async function sleutel(o, soort, gebruik, c) {
    const sub = cryptoNu(c).subtle;
    const raw = await sub.digest('SHA-256', tekstBytes((soort === 'roep' ? 'veronica-roep-sleutel:' : 'veronica-hartslag-sleutel:') + o));
    return sub.importKey('raw', raw, { name: 'AES-GCM' }, false, [gebruik]);
  }
  async function sluit(o, soort, d, c) {
    const iv = new Uint8Array(12);
    cryptoNu(c).getRandomValues(iv);
    const data = await cryptoNu(c).subtle.encrypt({ name: 'AES-GCM', iv }, await sleutel(o, soort, 'encrypt', c), tekstBytes(JSON.stringify(d)));
    return JSON.stringify({ iv: naarHex(iv), data: naarHex(data) });
  }
  async function open(o, soort, regel, c) {
    let m, b;
    try { m = JSON.parse(regel); } catch (e) { return null; }
    if (!m || (m.event && m.event !== 'message') || typeof m.message !== 'string') return null;
    try {
      b = JSON.parse(m.message);
      const tekst = await cryptoNu(c).subtle.decrypt({ name: 'AES-GCM', iv: hexNaar(b.iv) }, await sleutel(o, soort, 'decrypt', c), hexNaar(b.data));
      return { d: JSON.parse(new TextDecoder().decode(tekst)), id: typeof m.id === 'string' ? m.id : null };
    } catch (e) { return null; }
  }

  // ---- De hartslag ----
  // Alleen wat Veronica nodig heeft om te zeggen hoe het met een telefoon gaat. Geen code, geen sleutel, geen model-tekst.
  function gidsBlok(g) {
    if (!g || typeof g !== 'object') return null;
    const l = g.laatst && typeof g.laatst === 'object' ? g.laatst : null;
    return {
      klaar: getal(g.klaar, 0, 1e6) || 0, afgekeurd: getal(g.afgekeurd, 0, 1e6) || 0,
      laatst: l ? { t: Math.floor(Number(l.t) || 0), soort: ['vertaal', 'keuring', 'bord', 'buurtpin'].includes(l.soort) ? l.soort : '',
        taal: ['nl', 'de', 'en'].includes(l.taal) ? l.taal : '', ok: l.ok === true, ms: getal(l.ms, 0, 3600000) || 0,
        tokens: getal(l.tokens, 0, 100000) || 0, tps: getal(l.tps, 0, 1000) || 0, reden: schoon(l.reden, 80) } : null,
    };
  }
  function schoonHartslag(h) {
    const x = h || {};
    const m = x.motor && typeof x.motor === 'object' ? x.motor : null;
    const p = m && m.proef && typeof m.proef === 'object' ? m.proef : null;
    const i = x.instel && typeof x.instel === 'object' ? x.instel : null;
    const l = x.lijnen && typeof x.lijnen === 'object' ? x.lijnen : null;
    return {
      v: 1,
      t: Math.floor(Number(x.t) || 0),
      id: ID_RE.test(String(x.id || '')) ? String(x.id) : '',
      naam: schoon(x.naam, 40),
      rol: x.rol === 'baas' ? 'baas' : 'werker',
      // 533: rektelefoon of de dagelijkse beheerder (de rol 'baas' kan ook een rektelefoon zijn die de rij even leidt). Leeg = oude JARVIS.
      voorkeur: x.voorkeur === 'kern' || x.voorkeur === 'rek' ? x.voorkeur : '',
      versie: /^\d+\.\d+\.\d+$/.test(String(x.versie || '')) ? String(x.versie) : '',
      adressen: (Array.isArray(x.adressen) ? x.adressen : []).map(String).filter((a) => IP_RE.test(a)).filter((a, i, l) => l.indexOf(a) === i).slice(0, 4),
      poort: Number.isInteger(x.poort) && x.poort > 0 && x.poort < 65536 ? x.poort : 8080,
      dagelijks: x.dagelijks === true,
      sparen: x.sparen === true,
      // 544: het geheugen dat Android meldt (GB) en de vrije ruimte (GB), voor de keuze van de leider en de geheugen-telefoon; en of
      // deze telefoon de geheugen-telefoon is. Alleen getallen en een ja/nee.
      ram: getal(x.ram, 0, 64),
      vrij: getal(x.vrij, 0, 4096),
      kaartje: getal(x.kaartje, 0, 4096),   // 551: GB vrij op het SD-kaartje (null = geen kaartje of onbekend)
      geheugen: x.geheugen === true,
      // 546: het gast-brein (de dagelijkse telefoon die meerekent als hij niet in gebruik is, 548b): mag hij nu, en zo niet, de code waarom. Alleen bij hem.
      gast: x.gast && typeof x.gast === 'object' ? { mag: x.gast.mag === true, reden: schoon(x.gast.reden, 20) } : null,
      accu: getal(x.accu, 0, 100),
      laadt: x.laadt === true,
      // 527: mag Android JARVIS stilzetten? false = de batterij van JARVIS staat niet op Onbeperkt; zonder lader slaapt hij dan.
      batterijVrij: typeof x.batterijVrij === 'boolean' ? x.batterijVrij : null,
      // 529: gaat deze hartslag via de relay (true) of via ntfy.sh (false)?
      relay: x.relay === true,
      elke: getal(x.elke, 0, 6 * 3600 * 1000),   // 552: hoe vaak deze JARVIS zijn hartslag stuurt (ms); leeg = een oude JARVIS
      privePost: x.privePost === true,   // 536: deze telefoon is aan de privé-hoek gekoppeld en leest "Praat met de rij" (alleen ja/nee)
      // 529: DE WAAKHOND. Lag JARVIS stil (geen tik van zijn eigen klok, meestal: Android liet hem slapen), dan meldt hij dat zelf:
      // de laatste vijf keer, begin en duur in minuten, en of hij toen aan de lader hing. Zo is te METEN of de dienst het volhoudt.
      slaap: (Array.isArray(x.slaap) ? x.slaap : []).slice(-5).map((g) => ({ t: Math.floor(Number(g && g.t) || 0), min: getal(Number(g && g.min), 0, 100000), laadt: g && typeof g.laadt === 'boolean' ? g.laadt : null }))
        .filter((g) => g.t > 0 && g.min !== null),
      // 529: het meetuur (meetplan D): bezig, of de samenvatting van het laatste
      meetuur: meetuurBlok(x.meetuur),
      // 529: WAAROM STOPTE DE APP (Android 11+, ApplicationExitInfo): de laatste vijf keer, tijdstip, de redencode van Android en
      // hoe belangrijk de app toen was. Alleen getallen; Veronica maakt er een zin van.
      stops: (Array.isArray(x.stops) ? x.stops : []).slice(-5).map((g) => ({ t: Math.floor(Number(g && g.t) || 0), reden: getal(Number(g && g.reden), 0, 99), belang: getal(Number(g && g.belang), 0, 1000) }))
        .filter((g) => g.t > 0 && g.reden !== null),
      temp: getal(x.temp, -20, 90),
      motor: m ? {
        aan: m.aan === true,
        fase: schoon(m.fase, 20),
        procent: getal(m.procent, 0, 100),
        klaar: m.klaar === true,
        backend: schoon(m.backend, 10),
        tps: getal(m.tps, 0, 1000),
        teOud: m.teOud === true,
        // 507: welk model (bestandsnaam zonder .litertlm), welke soort (klein = de lichte motor) en wat de app ECHT aan geheugen
        // gebruikt met het model geladen (PSS) en hoeveel er nog vrij is. Alleen getallen en een naam; geen inhoud.
        model: schoon(String(m.model || '').replace(/\.litertlm$/i, ''), 60),
        soort: ['zwaar', 'groot', 'klein', 'te-oud'].includes(m.soort) ? m.soort : '',
        procesMb: getal(m.procesMb, 0, 20000),
        vrijMb: getal(m.vrijMb, 0, 64000),
        dicht: getal(m.dicht, 0, 64) || 0, dichtT: Math.floor(Number(m.dichtT) || 0),   // 552: bellers met een verkeerde code die een minuut buiten zitten
        proef: p ? { ok: p.ok === true, tps: getal(p.tps, 0, 1000), ms: getal(p.ms, 0, 600000), t: Math.floor(Number(p.t) || 0), temp: getal(p.temp, -20, 90), zin: schoon(p.zin, 120) } : null,
      } : null,
      // 501: de motor-instellingen die nu gelden (motorinstel.js), en of de motor draden en temperatuur aannam
      instel: i ? {
        bron: i.bron === 'veronica' ? 'veronica' : 'standaard', model: ['auto', 'E2B', 'E4B'].includes(i.model) ? i.model : 'auto', gpu: i.gpu === true,
        draden: getal(i.draden, 1, 8), context: getal(i.context, 256, 8192), temp: getal(i.temp, 0, 1.5), denk: getal(i.denk, 0, 4096),
        accuMin: getal(i.accuMin, 0, 100), tempMax: getal(i.tempMax, 0, 90), alleenLader: i.alleenLader === true,
        geladen: i.geladen === true, dradenToegepast: i.dradenToegepast === true, temperatuurToegepast: i.temperatuurToegepast === true,
      } : null,
      // 520: hoe snel de lijnen van deze telefoon zijn (middelste van de laatste metingen, in ms), en hoe lang het duurde van
      // "klaargezet in de postbus" tot "deze telefoon begon" (alleen een getal; geen adres, geen inhoud).
      lijnen: l ? { brievenbus: getal(l.brievenbus, 0, 120000), postbus: getal(l.postbus, 0, 120000), wifi: getal(l.wifi, 0, 120000) } : null,
      oppakMs: getal(x.oppakMs, 0, 7 * 24 * 3600000),
      // 522: de laatste zin van de werker van de gids op deze telefoon ("Wacht: niet aan de lader", "Niets gedaan: ..."), zodat
      // Veronica ziet WAAROM er niets gebeurt. Telt niet mee in hartslagSleutel (anders een hartslag per zin).
      werk: schoon(x.werk, 120),
      // 554: BIJWERKEN. Welke nieuwe versie klaarstaat en waarom hij er (nog) niet op staat ("wacht op een tik op de melding",
      // "Android weigerde: ..."). Zonder dit zag Veronica op een gastnetwerk nooit waarom een telefoon op een oude versie bleef.
      bijwerk: x.bijwerk && typeof x.bijwerk === 'object' && schoon(x.bijwerk.nieuw, 16)
        ? { nieuw: schoon(x.bijwerk.nieuw, 16), stap: schoon(x.bijwerk.stap, 160), code: schoon(x.bijwerk.code, 20), stil: x.bijwerk.stil === true ? true : x.bijwerk.stil === false ? false : null } : null,
      // 524: wat de werker van de gids deed: hoeveel concepten klaar, hoeveel afgekeurd door de eigen controle, en het laatste
      // stuk werk als getallen (soort, taal, duur, tempo) met een korte reden bij een afkeuring. Nooit de tekst zelf. In
      // hartslagSleutel tellen alleen de twee tellers (binnen het dagbudget van hartslagNodig).
      gids: gidsBlok(x.gids),
      // 522: JARVIS staat uit (de Uit-knop = ook de noodstop van de AI-kern): sinds wanneer en waardoor. null = staat aan.
      pauze: x.pauze && typeof x.pauze === 'object' ? { t: Math.floor(Number(x.pauze.t) || 0), door: schoon(x.pauze.door, 40) } : null,
      // 567: ZELFHERSTEL. Wat JARVIS bij de laatste start of hartslag vanzelf goedzette (rol/dagelijks), in gewone woorden. Leeg =
      // niets te herstellen. Telt NIET mee in hartslagSleutel (anders een hartslag per correctie).
      herstel: schoon(x.herstel, 160),
      // 570: PLEK. Waar de telefoon staat: soort ('gast'/'hoofd'/'hotspot'), het etiket van de eigenaar en het /24. NOOIT de
      // SSID zelf (die kan een gezinsnaam dragen). null = plek onbekend. Telt niet mee in hartslagSleutel.
      locatie: x.locatie && typeof x.locatie === 'object' && ['gast', 'hoofd', 'hotspot'].includes(x.locatie.soort)
        ? { soort: x.locatie.soort, naam: schoon(x.locatie.naam, 40), net: schoon(x.locatie.net, 15) } : null,
    };
  }
  // server: leeg = ntfy.sh, anders een geldig relay-adres (529); een ongeldig adres = geen verzoek.
  const naarServer = (server) => (server ? relayGeldig(server) : SERVER);
  async function hartslagVerzoek(o, h, c, server) {
    const topic = await onderwerp(o, 'hartslag', c);
    const url = naarServer(server);
    if (!topic || !url) return null;
    const d = schoonHartslag(h);
    if (!d.id) return null;
    return { method: 'POST', url, data: JSON.stringify({ topic, message: await sluit(o, 'hartslag', d, c) }) };
  }
  // Wat er in een hartslag verandert telt (niet de tijd en niet het precieze accuprocent); anders eens per uur.
  function hartslagSleutel(h) {
    const d = schoonHartslag(h);
    const m = d.motor || {};
    const i = d.instel || {};
    const g = d.gids || {};
    // 524: een nieuw concept of een afkeuring telt WEL (de tellers, niet de tijd): zo ziet Veronica het werk binnen het half uur.
    // Het dagbudget (hartslagNodig) blijft de rem.
    // 507: het geheugengebruik telt NIET mee (dat schommelt; anders een hartslag per kleine verandering), het model wel
    return [d.versie, d.rol, d.adressen.join(','), d.dagelijks, d.sparen, !!d.pauze, d.laadt, d.batterijVrij, d.relay, d.privePost, m.aan, m.fase, m.klaar, m.proef ? m.proef.t : 0, m.model, m.soort,
      i.bron, i.model, i.gpu, i.draden, i.context, i.temp, i.accuMin, i.tempMax, i.alleenLader, i.geladen, i.dradenToegepast, i.temperatuurToegepast, g.klaar || 0, g.afgekeurd || 0, d.bijwerk ? `${d.bijwerk.nieuw}:${d.bijwerk.code}` : '', d.meetuur ? `${d.meetuur.bezig ? 'b' : 'u'}${d.meetuur.start}` : ''].join('|');
  }
  // 522d: HET DAGBUDGET VERDELEN. ntfy.sh telt berichten per dag; een telefoon heeft er NTFY_DAG_MAX (40) en houdt er een paar
  // achter de hand voor iets anders dan de hartslag. Waren er overdag veel veranderingen, dan ging elke half uur een hartslag weg
  // en was het budget 's avonds op: dan zag Veronica uren niets. Met `over` (wat er vandaag nog mag) en `totEinde` (ms tot het
  // einde van de dag) wordt de tussentijd minstens de rest van de dag gedeeld door wat er over is. Niets meer over = geen hartslag.
  function hartslagNodig(o) {
    const x = o || {};
    const sinds = (x.nu || 0) - (x.laatstT || 0);
    if (x.relay === true) return sinds >= (x.sleutel !== x.laatstSleutel ? RELAY_MIN_MS : RELAY_VERS_MS);   // 529
    let spreid = 0;
    if (typeof x.over === 'number') {
      if (x.over <= 0) return false;
      spreid = Math.max(0, Number(x.totEinde) || 0) / x.over;
    }
    // 527: HOOGSTENS HOOGST_MS STIL, met of zonder verandering. Was het budget krap, dan kon een telefoon met een verandering
    // (de accu) tot het einde van de dag zwijgen, en zonder verandering vier uur; Veronica noemt hem na twee uur al oud. Zo zag
    // een rektelefoon op 22 oktober er uren dood uit. HOOGST_MS ligt onder de twee uur van Veronica en kost hoogstens ~15 per dag.
    if (x.sleutel !== x.laatstSleutel) return sinds >= Math.max(MIN_MS, Math.min(spreid, HOOGST_MS));
    return sinds >= Math.max(VERS_MS, Math.min(spreid, HOOGST_MS));
  }
  async function leesHartslag(o, regel, c) {
    const r = await open(o, 'hartslag', regel, c);
    if (!r || !r.d || r.d.v !== 1) return null;
    const d = schoonHartslag(r.d);
    return d.id && d.t ? d : null;
  }

  // ---- 535: Het gezondheidsrapport ----
  // Wat JARVIS zelf niet kan oplossen, gaat NIET meer via het deelvenster van Android maar naar Veronica: op DEZELFDE lijn en met
  // DEZELFDE sleutel als de hartslag (geen extra luisterverbinding), maar met v: 2, zodat een oudere Veronica het laat liggen
  // (leesHartslag eist v: 1). Alleen codes, korte zinnen en tellers; geen sleutel, geen koppelcode, geen gesprekstekst.
  const GEZOND_MAX = 6;
  const getalTussen = (x, min, max) => { const n = Math.floor(Number(x)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0; };
  function schoonGezond(g) {
    const x = g || {};
    const open = (Array.isArray(x.open) ? x.open : []).slice(0, GEZOND_MAX).map((m) => ({
      code: schoon(m && m.code, 40).replace(/[^A-Za-z0-9_-]/g, ''), adres: schoon(m && m.adres, 60), zin: schoon(m && m.zin, 200),
      eerst: getalTussen(m && m.eerst, 0, 9e15), keren: getalTussen(m && m.keren, 1, 9999),
    })).filter((m) => m.code && m.zin);
    return {
      v: 2, soort: 'gezond', t: getalTussen(x.t, 0, 9e15), id: ID_RE.test(String(x.id || '')) ? String(x.id) : '', naam: schoon(x.naam, 40), versie: schoon(x.versie, 20),
      telefoons: getalTussen(x.telefoons, 0, 50), mee: getalTussen(x.mee, 0, 50), open, opgelost: getalTussen(x.opgelost, 0, 999),
    };
  }
  // Wat telt als verandering: de SET open problemen (code + adres), niet de zin of de teller.
  function gezondSleutel(g) { return schoonGezond(g).open.map((m) => `${m.code}|${m.adres}`).sort().join(','); }
  async function gezondVerzoek(o, g, c, server) {
    const topic = await onderwerp(o, 'hartslag', c);
    const url = naarServer(server);
    if (!topic || !url) return null;
    const d = schoonGezond(g);
    if (!d.id || !d.t) return null;
    return { method: 'POST', url, data: JSON.stringify({ topic, message: await sluit(o, 'hartslag', d, c) }) };
  }
  async function leesGezond(o, regel, c) {
    const r = await open(o, 'hartslag', regel, c);
    if (!r || !r.d || r.d.v !== 2 || r.d.soort !== 'gezond') return null;
    const d = schoonGezond(r.d);
    return d.id && d.t ? d : null;
  }

  // ---- De roep ----
  // { naar: <toestel-id> of '*', soort, ...velden }. De code reist mee BINNEN de versleuteling.
  async function roepVerzoek(o, roep, code, nu, c, server) {
    const topic = await onderwerp(o, 'roep', c);
    const url = naarServer(server);
    if (!topic || !url || !/^\d{6}$/.test(String(code || '')) || !roep || typeof roep.soort !== 'string') return null;
    const naar = roep.naar === '*' ? '*' : (ID_RE.test(String(roep.naar || '')) ? String(roep.naar) : null);
    if (!naar || (naar === '*' && !VOOR_IEDEREEN.includes(roep.soort))) return null;
    const n = new Uint8Array(8);
    cryptoNu(c).getRandomValues(n);
    const d = Object.assign({}, roep, { naar, code: String(code), t: Math.floor(nu), n: naarHex(n), van: 'veronica' });
    const tekst = JSON.stringify(d);
    if (tekst.length > 2048) return null;   // zelfde grens als /jarvis/roep
    return { method: 'POST', url, data: JSON.stringify({ topic, message: await sluit(o, 'roep', d, c) }) };
  }
  // Een regel van ntfy -> de roep (ZONDER code, als tekst zoals /jarvis/roep hem geeft), of null. `gezien` is een Set van
  // eenmalige nummers die deze telefoon al deed.
  async function leesRoep(o, regel, x, c) {
    const r = await open(o, 'roep', regel, c);
    const d = r && r.d;
    if (!d || typeof d !== 'object' || typeof d.soort !== 'string') return null;
    // 527: EEN ANDERE RIJ-CODE. Alleen "Maak werker" (word-werker), na de klik met bevestiging in Veronica, mag met een andere
    // code binnenkomen: de telefoon neemt dan de code van Veronica over (nieuweCode). De brievenbus zelf is het bewijs: de roep is
    // versleuteld met een sleutel uit het geheime onderwerp, net als de rijbrief (513). Elke andere roep vraagt dezelfde code.
    if (!/^\d{6}$/.test(String(x.code || '')) || !/^\d{6}$/.test(String(d.code || ''))) return null;
    const andereCode = String(d.code) !== String(x.code);
    if (andereCode && !(x.codeOvernemen === true && CODE_OVERNEMEN.includes(d.soort))) return null;
    if (!(d.naar === x.id || (d.naar === '*' && VOOR_IEDEREEN.includes(d.soort)))) return null;
    const t = Number(d.t) || 0;
    if (Math.abs((x.nu || 0) - t) > ROEP_GELDIG_MS) return null;
    if (!/^[0-9a-f]{16}$/.test(String(d.n || '')) || (x.gezien && x.gezien.has(d.n))) return null;
    if (x.gezien) x.gezien.add(d.n);
    const uit = Object.assign({}, d);
    delete uit.code; delete uit.naar; delete uit.n; delete uit.t;
    uit.van = 'veronica';
    delete uit.nieuweCode;
    if (andereCode) uit.nieuweCode = String(d.code);
    return JSON.stringify(uit);
  }

  // Ophalen (de telefoon, eens per minuut) en luisteren (Veronica, een doorlopende verbinding).
  function pollUrl(topic, sinds, server) { return `${naarServer(server) || SERVER}/${topic}/json?poll=1&since=${encodeURIComponent(String(sinds || '15m'))}`; }

  // ---- De diagnose in gewone taal (Veronica) ----
  // h = de laatste hartslag of null; wifi = { antwoordt: true/false/null }; nuMs.
  function minutenZin(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 2) return 'net';
    if (m < 90) return `${m} minuten geleden`;
    const u = Math.round(m / 60);
    return u < 48 ? `${u} uur geleden` : `${Math.round(u / 24)} dagen geleden`;
  }
  function diagnose(h, wifi, nuMs) {
    const w = wifi || {};
    if (!h) {
      if (w.antwoordt === true) return `Antwoordt over het wifi. ${w.uitleg || '(Nog geen hartslag via de brievenbus: dat kan pas vanaf JARVIS 1.9.46.)'}`;   // 508: de reden als de telefoon die meldt
      return 'Nog geen hartslag via de brievenbus. Draait JARVIS op deze telefoon (en is hij bijgewerkt naar 1.9.46)? Open JARVIS een keer.';
    }
    const oud = nuMs - h.t;
    const delen = [`Laatst gezien ${minutenZin(oud)}`, h.versie ? `JARVIS ${h.versie}` : null, h.adressen.length ? `adres ${h.adressen[0]}` : null].filter(Boolean);
    let waarom = '';
    if (oud > 3 * VERS_MS) waarom = 'Al lang geen hartslag: staat de telefoon uit, of is JARVIS dicht? Open JARVIS een keer.';
    // 503: een gastnetwerk houdt toestellen uit elkaar; dat is GEEN fout. De brievenbus is de hoofdweg, het wifi een bonus.
    else if (w.antwoordt === false) waarom = 'Geen directe wifi-verbinding (op een gastnetwerk zien toestellen elkaar niet; dat is goed zo). Opdrachten en de hartslag gaan via de brievenbus.';
    return `${delen.join(' · ')}.${waarom ? ` ${waarom}` : ''}`;
  }
  // Motor en model in een regel (Veronica): "motor aan · model binnen · 4,2 tokens/s · 31 °C".
  function motorZin(h) {
    const m = h && h.motor;
    if (!m) return 'eigen motor: onbekend';
    if (m.teOud) return 'te oud voor de eigen motor';
    const delen = [m.aan ? 'motor aan' : 'motor uit'];
    // 505: per fase een zin, zodat je ziet waar hij op wacht (de reden zelf reist niet mee in de hartslag).
    if (m.soort === 'klein') delen.push('lichte motor');   // 507
    if (m.klaar) delen.push(`model binnen${m.backend ? ` (${m.backend})` : ''}${m.model ? `: ${m.model}` : ''}`);
    else if (m.fase === 'downloaden') delen.push(`model ophalen: ${m.procent || 0}%`);
    else if (m.fase === 'zoeken') delen.push('zoekt het model op');
    else if (m.fase === 'laden') delen.push('model wordt geladen');
    else if (m.fase === 'gepauzeerd') delen.push('gepauzeerd');
    else if (m.fase === 'fout') delen.push('liep vast (wordt opnieuw geprobeerd)');
    else if (m.aan) delen.push('model nog niet binnen (komt op wifi aan de lader)');
    const p = m.proef;
    if (p && p.ok && p.tps) delen.push(`${String(p.tps).replace('.', ',')} tokens/s`);
    else if (m.tps) delen.push(`${String(m.tps).replace('.', ',')} tokens/s`);
    if (m.klaar && m.procesMb) delen.push(`gebruikt ${m.procesMb} MB${m.vrijMb ? `, ${m.vrijMb} MB vrij` : ''}`);   // 507: gemeten
    const temp = p && p.temp !== null && p.temp !== undefined ? p.temp : h.temp;
    if (temp !== null && temp !== undefined) delen.push(`${Math.round(temp)} °C`);
    return delen.join(' · ');
  }

  // 520: de lijnen in gewone taal (Veronica): "lijnen: brievenbus 0,9 s · postbus 0,3 s · taak opgepakt na 4 min".
  function lijnZin(h) {
    const l = h && h.lijnen;
    const tijd = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${String(Math.round(ms / 100) / 10).replace('.', ',')} s`);
    const delen = [];
    if (l) for (const [k, naam] of [['wifi', 'wifi'], ['brievenbus', 'brievenbus'], ['postbus', 'postbus']]) if (typeof l[k] === 'number') delen.push(`${naam} ${tijd(l[k])}`);
    if (h && typeof h.oppakMs === 'number') delen.push(`taak opgepakt na ${h.oppakMs < 90000 ? tijd(h.oppakMs) : `${Math.round(h.oppakMs / 60000)} min`}`);
    return delen.length ? `lijnen: ${delen.join(' · ')}` : '';
  }

  return { schoonGezond, gezondSleutel, gezondVerzoek, leesGezond, GEZOND_MAX, lijnZin, SERVER, MIN_MS, VERS_MS, HOOGST_MS, CODE_OVERNEMEN, RELAY_MIN_MS, RELAY_VERS_MS, relayGeldig, meetuurUit, meetuurBlok, ROEP_GELDIG_MS, VOOR_IEDEREEN, onderwerp, vinger, schoonHartslag, hartslagVerzoek, hartslagSleutel, hartslagNodig, leesHartslag, roepVerzoek, leesRoep, pollUrl, diagnose, motorZin, minutenZin };
}));
