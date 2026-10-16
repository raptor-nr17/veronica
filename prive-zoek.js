// ===================================================================
// ZOEKEN VOOR DE PRIVE-KAMER -- alleen toegestane, gratis, open bronnen
// ===================================================================
//
// Wat hier naar buiten gaat is de ZOEKTERM, en niets anders: geen geheugen, geen eerdere vragen, geen
// naam van de eigenaar. De bronnen zijn een vaste lijst (Wikipedia, Wikidata, Openverse, Marginalia, OSM).
// Google, Bing en andere zoekmachines worden NOOIT uitgelezen of nagebootst: dat staat niet alleen niet
// in de lijst, isToegestaanAdres() weigert ze ook als iemand ze toch probeert.
//
// ELKE bron heeft een rem (een minimale tijd tussen twee verzoeken, voor Nominatim de eigen regel van
// een per seconde) en een cache in het werkgeheugen (24 uur, hoogstens 200 antwoorden). De cache staat
// NIET op schijf: een privé-zoekterm hoort niet na te blijven. Sluit de kamer, dan wordt hij gewist.
//
// De resultaten openen NIET op deze telefoon en niet op de Chromebook, maar op de surftelefoon (prive-surf.js).
//
// Het verdelen: elke bron is een deelvraag. De resultaten van een bron worden door een telefoon met de
// kamer-sleutel samengevat, de bronnen tegelijk over de beschikbare telefoons (zie zoekVerdeeld).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.PriveZoek = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CACHE_MS = 24 * 3600 * 1000;
  const CACHE_MAX = 200;
  const MAX_TERM = 200;
  const MAX_PER_BRON = 5;
  const GEBLOKKEERD_MIN_MS = 15 * 60 * 1000;  // een bron die blokkeert: eerst 15 minuten rust, bij elke volgende blokkade dubbel, hoogstens een uur
  const GEBLOKKEERD_MAX_MS = 60 * 60 * 1000;
  const GEBLOKKEERD_MS = GEBLOKKEERD_MIN_MS;
  // De volgorde: goedkoop en netjes eerst, de fragiele scrape als laatste. Genoeg resultaten = niet verder vragen.
  const VOLGORDE = ['wikipedia', 'wikidata', 'marginalia'];     // 462: DuckDuckGo is UIT (geen officiele API, geen toestemming voor geautomatiseerd gebruik gevonden)
  const GENOEG = 8;
  const UA = 'JARVIS-Privekamer/1.9.24 (persoonlijk gebruik, lage frequentie)';
  const UUR_MS = 3600 * 1000;
  const MAX_PER_UUR = 20;                     // per bron; alle telefoons delen een IP, dus dit geldt voor het hele huis
  const BRON_ZIN = {
    geblokkeerd: (naam) => `${naam} laat nu even geen zoekopdrachten toe. Ik gebruik de andere bronnen en probeer het later opnieuw.`,
    uurgrens: (naam) => `Ik heb ${naam} dit uur al vaak genoeg gevraagd. Ik wacht even met die bron.`,
    uitgeschakeld: (naam) => `${naam} gebruik ik niet: er is geen toestemming voor geautomatiseerd gebruik. Ik gebruik de andere bronnen.`,
    geenverbinding: (naam) => `${naam} was niet te bereiken. Ik gebruik de andere bronnen.`,
  };

  const enc = encodeURIComponent;
  const BRONNEN = {
    duckduckgo: {
      uit: true,       // 462: UITGESCHAKELD. Code en lezer blijven (getest), maar de bron wordt niet bevraagd en het adres is niet toegestaan.
      naam: 'DuckDuckGo', hosts: ['html.duckduckgo.com'], remMs: [4000, 8000],
      adres: (q, taal, veilig) => `https://html.duckduckgo.com/html/?q=${enc(q)}&kp=${veilig ? 1 : -2}&kl=${taal === 'de' ? 'de-de' : taal === 'en' ? 'wt-wt' : 'nl-nl'}`,
      lees: (d) => leesDdg(d),
      geblokkeerd: (r) => r.status === 202 || DDG_GEBLOKKEERD_RE.test(typeof r.data === 'string' ? r.data.slice(0, 20000) : ''),
    },
    wikipedia: {
      naam: 'Wikipedia', hosts: ['nl.wikipedia.org', 'en.wikipedia.org', 'de.wikipedia.org'], remMs: [250, 600],
      adres: (q, taal) => `https://${['nl', 'en', 'de'].includes(taal) ? taal : 'nl'}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q)}&srlimit=${MAX_PER_BRON}&format=json&origin=*`,
      lees: (d, taal) => ((d && d.query && d.query.search) || []).slice(0, MAX_PER_BRON).map((x) => ({
        titel: String(x.title || ''), tekst: String(x.snippet || '').replace(/<[^>]*>/g, ''),
        url: `https://${['nl', 'en', 'de'].includes(taal) ? taal : 'nl'}.wikipedia.org/wiki/${enc(String(x.title || '').replace(/ /g, '_'))}`,
      })),
    },
    wikidata: {
      naam: 'Wikidata', hosts: ['www.wikidata.org'], remMs: [250, 600],
      adres: (q, taal) => `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc(q)}&language=${['nl', 'en', 'de'].includes(taal) ? taal : 'nl'}&limit=${MAX_PER_BRON}&format=json&origin=*`,
      lees: (d) => ((d && d.search) || []).slice(0, MAX_PER_BRON).map((x) => ({
        titel: String(x.label || x.id || ''), tekst: String(x.description || ''), url: `https://www.wikidata.org/wiki/${enc(String(x.id || ''))}`,
      })),
    },
    openverse: {
      naam: 'Openverse', hosts: ['api.openverse.org'], remMs: [1000, 2000],
      adres: (q) => `https://api.openverse.org/v1/images/?q=${enc(q)}&page_size=${MAX_PER_BRON}`,
      lees: (d) => ((d && d.results) || []).slice(0, MAX_PER_BRON).map((x) => ({
        titel: String(x.title || 'Zonder titel'), tekst: `${x.creator ? `door ${x.creator}, ` : ''}${x.license ? `licentie ${String(x.license).toUpperCase()}` : ''}`,
        url: String(x.foreign_landing_url || x.url || ''),
      })),
    },
    marginalia: {
      naam: 'Marginalia', hosts: ['api.marginalia.nu'], remMs: [2000, 4000],
      adres: (q, taal, veilig, ctx) => `https://api.marginalia.nu/${enc((ctx && ctx.marginaliaSleutel) || 'public')}/search/${enc(q)}?count=${MAX_PER_BRON}${veilig ? '' : '&nsfw=0'}`,
      lees: (d) => ((d && d.results) || []).slice(0, MAX_PER_BRON).map((x) => ({ titel: String(x.title || x.url || ''), tekst: String(x.description || ''), url: String(x.url || '') })),
    },
    osm: {
      naam: 'OpenStreetMap', hosts: ['nominatim.openstreetmap.org'], remMs: [1100, 2000],
      adres: (q) => `https://nominatim.openstreetmap.org/search?q=${enc(q)}&format=json&limit=${MAX_PER_BRON}`,
      lees: (d) => (Array.isArray(d) ? d : []).slice(0, MAX_PER_BRON).map((x) => ({
        titel: String(x.display_name || ''), tekst: String(x.type || ''),
        url: `https://www.openstreetmap.org/?mlat=${enc(x.lat)}&mlon=${enc(x.lon)}#map=16/${enc(x.lat)}/${enc(x.lon)}`,
      })),
    },
  };

  // DuckDuckGo: GEEN officiele zoek-API. Dit leest de lichte HTML-pagina (html.duckduckgo.com), zoals een browser
  // zonder script dat doet. Het is de enige gewone zoekmachine die vanaf een thuis-IP in metingen van derden
  // betrouwbaar bleef antwoorden (Google, Brave en Startpage blokkeerden), maar het kan elk moment dichtgaan of een
  // controlevraag sturen: dan wordt de bron een half uur overgeslagen (zie GEBLOKKEERD_MS) en gaat het door met de rest.
  // Niet nagekeken vanuit de bouwomgeving (geen toegang): de leesfunctie is getoetst op een voorbeeld van de opmaak.
  function htmlTekst(t) {
    return String(t || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function ddgAdres(href) {
    let h = String(href || '').replace(/&amp;/g, '&');
    if (h.startsWith('//')) h = `https:${h}`;
    let u;
    try { u = new URL(h); } catch (e) { return null; }
    if (/(^|\.)duckduckgo\.com$/.test(u.hostname)) {
      if (u.pathname.startsWith('/y.js')) return null;                 // een advertentie
      const echt = u.searchParams.get('uddg');
      if (!echt) return null;
      try { return new URL(echt).href; } catch (e) { return null; }
    }
    return u.href;
  }
  function leesDdg(html) {
    const tekst = String(html || '');
    const knoppen = [...tekst.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    const stukjes = [...tekst.matchAll(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/g)];
    const uit = [];
    knoppen.forEach((m, i) => {
      const url = ddgAdres(m[1]);
      if (url) uit.push({ titel: htmlTekst(m[2]), tekst: htmlTekst(stukjes[i] && stukjes[i][1]), url });
    });
    return uit.slice(0, 3 * MAX_PER_BRON);     // eerst ruim lezen: de zeef haalt er nog af, de grens komt daarna
  }
  const DDG_GEBLOKKEERD_RE = /anomaly|unusual traffic|are you a human|captcha|challenge-form/i;
  const TOEGESTAAN = new Set([].concat(...Object.values(BRONNEN).filter((b) => !b.uit).map((b) => b.hosts)));
  // Wat hier NOOIT in mag, ook niet als iemand de lijst probeert uit te breiden met een lijkende naam.
  const VERBODEN_RE = /(^|\.)(google|googleapis|gstatic|bing|yahoo|yandex|baidu|ecosia|startpage|brave)\./i;

  function isToegestaanAdres(adres) {
    let u;
    try { u = new URL(String(adres || '')); } catch (e) { return false; }
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return false;
    if (VERBODEN_RE.test(u.hostname)) return false;
    return TOEGESTAAN.has(u.hostname);
  }
  // Een resultaat openen in de browser: alleen https, geen gegevens in de URL.
  function isOpenbaarLink(adres) {
    let u;
    try { u = new URL(String(adres || '')); } catch (e) { return false; }
    return u.protocol === 'https:' && !u.username && !u.password && !VERBODEN_RE.test(u.hostname);
  }

  // `proefDdg` is ALLEEN voor de tests (rem, blokkade en zeef toetsen op de DuckDuckGo-lezer). De app geeft hem nooit mee: check_prive_kamer kijkt in de bron.
  function maakZoeker(o) {
    const http = o.http;                                  // (opties) -> { status, data }, het gewone CapacitorHttp
    const bewaker = o.bewaker;
    const nu = o.nu || (() => Date.now());
    const wacht = o.wacht || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const cache = new Map();
    const volgendeMag = new Map();
    const teller = { verzoeken: 0, uitCache: 0, geweigerd: 0 };

    function wisCache() { cache.clear(); }
    const willekeur = o.willekeur || Math.random;
    async function rem(bron) {
      const [min, max] = BRONNEN[bron].remMs;
      const pauze = Math.round(min + willekeur() * (max - min));      // met spreiding: nooit een vast ritme
      const t = nu();
      const mag = Math.max(t, volgendeMag.get(bron) || 0);
      volgendeMag.set(bron, mag + pauze);
      if (mag > t) await wacht(mag - t);
    }
    const ketens = new Map();                          // per bron EEN verzoek tegelijk
    const blokkades = new Map();                       // per bron: hoe vaak achter elkaar geblokkeerd

    const aanvragen = new Map();                     // per bron: de tijden van de laatste verzoeken (de uurgrens)
    const geblokkeerdTot = new Map();                // per bron: tot wanneer we hem met rust laten
    const maxPerUur = o.maxPerUur || MAX_PER_UUR;

    async function zoekBron(bron, term, taal, veilig) {
      const b = BRONNEN[bron];
      if (!b) return { bron, ok: false, reden: 'onbekende-bron', resultaten: [] };
      if (b.uit && !o.proefDdg) return { bron, ok: false, reden: 'uitgeschakeld', zin: BRON_ZIN.uitgeschakeld(b.naam), resultaten: [] };
      const sleutel = `${bron}|${taal}|${veilig ? 1 : 0}|${term.toLowerCase()}`;
      const c = cache.get(sleutel);
      if (c && nu() - c.t < CACHE_MS) { teller.uitCache += 1; return { bron, ok: true, uitCache: true, resultaten: c.resultaten }; }
      if ((geblokkeerdTot.get(bron) || 0) > nu()) return { bron, ok: false, reden: 'geblokkeerd', zin: BRON_ZIN.geblokkeerd(b.naam), resultaten: [] };
      const adres = b.adres(term, taal, !!veilig, { marginaliaSleutel: o.marginaliaSleutel && o.marginaliaSleutel() });
      if (!isToegestaanAdres(adres) && !(o.proefDdg && b.uit && adres.startsWith('https://html.duckduckgo.com/html/'))) { teller.geweigerd += 1; return { bron, ok: false, reden: 'adres-niet-toegestaan', resultaten: [] }; }
      const recent = (aanvragen.get(bron) || []).filter((t) => nu() - t < UUR_MS);
      if (recent.length >= maxPerUur) { aanvragen.set(bron, recent); return { bron, ok: false, reden: 'uurgrens', zin: BRON_ZIN.uurgrens(b.naam), resultaten: [] }; }
      const vorige = ketens.get(bron) || Promise.resolve();
      let klaar; const dit = new Promise((r) => { klaar = r; });
      ketens.set(bron, vorige.then(() => dit));
      await vorige;
      try { return await vraagBron(bron, b, term, taal, veilig, adres, sleutel, recent); } finally { klaar(); }
    }

    async function vraagBron(bron, b, term, taal, veilig, adres, sleutel, recent) {
      await rem(bron);
      recent.push(nu()); aanvragen.set(bron, recent);
      teller.verzoeken += 1;
      let r;
      try {
        r = await http({ method: 'GET', url: adres, headers: { Accept: bron === 'duckduckgo' ? 'text/html' : 'application/json', 'User-Agent': UA }, connectTimeout: 8000, readTimeout: 12000 });
      } catch (e) { return { bron, ok: false, reden: 'geen-verbinding', zin: BRON_ZIN.geenverbinding(b.naam), resultaten: [] }; }
      // Een bron die blokkeert (429/403, of een controlevraag): een half uur met rust laten, de rest gaat door.
      if (r && (r.status === 429 || r.status === 403 || r.status === 503 || (b.geblokkeerd && b.geblokkeerd(r)))) {
        const aantal = (blokkades.get(bron) || 0) + 1;
        blokkades.set(bron, aantal);
        geblokkeerdTot.set(bron, nu() + Math.min(GEBLOKKEERD_MIN_MS * Math.pow(2, aantal - 1), GEBLOKKEERD_MAX_MS));   // 15 min, 30, 60, 60 ...
        return { bron, ok: false, reden: 'geblokkeerd', zin: BRON_ZIN.geblokkeerd(b.naam), resultaten: [] };
      }
      if (!r || r.status !== 200) return { bron, ok: false, reden: `http-${r && r.status}`, zin: BRON_ZIN.geenverbinding(b.naam), resultaten: [] };
      let d = r.data;
      if (typeof d === 'string' && bron !== 'duckduckgo') { try { d = JSON.parse(d); } catch (e) { return { bron, ok: false, reden: 'geen-json', resultaten: [] }; } }
      // DE ENE ZEEF voor alles wat een bron teruggeeft: titel, beschrijving en adres gaan door de bewaker
      // (prive-bewaker.js, gewone code). Wat eronder valt komt nergens terecht. Niets anders zeeft hierna nog eens.
      let weg = 0;
      const resultaten = b.lees(d, taal).filter((x) => x.url && isOpenbaarLink(x.url)).filter((x) => {
        const ok = bewaker.beoordeelResultaat(x).toegestaan;
        if (!ok) weg += 1;
        return ok;
      }).slice(0, MAX_PER_BRON).map((x) => Object.assign({ bron: b.naam, domein: new URL(x.url).hostname.replace(/^www\./, '') }, x, { tekst: String(x.tekst || '').slice(0, 200) }));
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(sleutel, { t: nu(), resultaten });
      blokkades.delete(bron);                  // een gelukt verzoek: de teller van blokkades begint opnieuw
      return { bron, ok: true, uitCache: false, resultaten, weggelaten: weg };
    }

    // Een vraag in deelvragen: een per bron, tegelijk (de rem staat per bron, niet voor alles samen).
    // Weigert de bewaker de zoekterm, dan komt er EEN neutrale zin terug en gaat er niets naar buiten.
    async function zoek(vraag, opties) {
      const op = opties || {};
      const term = String(vraag || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TERM);
      const b = bewaker.beoordeel(term, 'zoek');
      if (!b.toegestaan) return { ok: false, geweigerd: true, code: b.code, reden: bewaker.REDENEN.zoek, bronnen: [] };
      // Volgens VOLGORDE, een voor een (nooit parallel): genoeg resultaten = de fragielere bronnen met rust laten.
      const lijst = (op.bronnen && op.bronnen.length ? op.bronnen : VOLGORDE).filter((x) => BRONNEN[x]);
      const genoeg = op.genoeg || (op.bronnen && op.bronnen.length ? Infinity : GENOEG);
      const bronnen = [];
      let totaal = 0;
      for (const x of lijst) {
        if (totaal >= genoeg) break;
        const u = await zoekBron(x, term, op.taal || 'nl', !!op.veilig);
        bronnen.push(u);
        totaal += u.resultaten.length;
      }
      return { ok: true, term, bronnen, aantal: totaal, meldingen: bronnen.filter((x) => x.zin).map((x) => x.zin) };
    }

    return { zoek, zoekBron, wisCache, teller, _cache: cache, geblokkeerdTot };
  }

  // Het verdelen: per bron laat een telefoon met de sleutel de resultaten samenvatten, tegelijk.
  // `vat` is wachtrij-gebonden en komt van buiten (prive.js); hier alleen het patroon.
  async function zoekVerdeeld(zoeker, vat, vraag, opties) {
    const u = await zoeker.zoek(vraag, opties);
    if (!u.ok) return u;
    const delen = await Promise.all(u.bronnen.map(async (b) => {
      if (!b.resultaten.length) return { bron: b.bron, samenvatting: '', resultaten: [] };
      const tekst = b.resultaten.map((x, i) => `${i + 1}. ${x.titel}: ${x.tekst}`).join('\n');
      const s = await vat(`Vraag: ${u.term}\nResultaten van ${BRONNEN[b.bron].naam}:\n${tekst}\n\nNoem in een of twee zinnen welke resultaten bij de vraag passen, met hun nummer. Verzin niets.`);
      return { bron: b.bron, samenvatting: s || '', resultaten: b.resultaten };
    }));
    return { ok: true, term: u.term, delen };
  }

  return { leesDdg, BRON_ZIN, GEBLOKKEERD_MS, GEBLOKKEERD_MIN_MS, GEBLOKKEERD_MAX_MS, VOLGORDE, GENOEG, UA, MAX_PER_UUR, BRONNEN, isToegestaanAdres, isOpenbaarLink, maakZoeker, zoekVerdeeld, CACHE_MS, CACHE_MAX, MAX_TERM };
}));
