// ===================================================================
// HET MULTIZOEKEN (462) -- de zoekkassa aangesloten op de zoekmachine
// ===================================================================
//
// Dezelfde vorm als PriveZoek.maakZoeker: `zoek(vraag, opties)` geeft { ok, term, bronnen: [...], aantal, meldingen }. Dus de AI-kern en
// KlantZoek merken niets, maar de vraag gaat nu zo:
//
//   1. LOKAAL EERST: staat het antwoord in de lokale index (lokaalindex.js) -- genoeg stukken -- dan gaat er NIETS naar internet;
//   2. de bewaker keurt de zoekterm (zoals altijd; dezelfde bewaker als de privé-kamer);
//   3. per toegestane bron een DEELVRAAG, om de beurt over de telefoons (zoekkassa.js: planDeelvragen);
//   4. elke deelvraag haalt een slot bij de KASSA (een rem, een uurgrens en een blokkade voor het HELE HUIS, want alle telefoons
//      hebben hetzelfde publieke IP); pas dan haalt een telefoon zijn adres op, over het eigen wifi;
//   5. de resultaten worden samengevoegd (een pagina maar een keer) en door dezelfde zeef gehaald als altijd.
//
// WAT DIT NIET DOET: een limiet omzeilen. Meer telefoons = meer bronnen TEGELIJK, niet meer verzoeken per bron. Een 429 van een bron
// sluit die bron voor het hele huis en er volgt GEEN poging via een andere telefoon.
//
// PRIVE-ZOEKEN GAAT HIER NOOIT DOORHEEN: een privé-zoekterm blijft op de telefoon met de kamer-sleutel (prive-zoek.js). Deze zoeker is
// voor de algemene zoekmachine (klant-zoek.js); de telefoons krijgen de zoekterm te zien, en de deelvraag-route weigert X-Prive.
//
// Geen scherm. Het netwerk komt van buiten (http), net als bij prive-zoek.js.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.ZoekMulti = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_PER_BRON = 5;
  const MAX_TERM = 200;
  const GENOEG_LOKAAL = 5;
  const WEB_POORT = 8080;
  const STANDAARD_BRONNEN = ['wikipedia', 'wikidata', 'marginalia'];      // zoals de zoekmachine altijd deed (zonder DuckDuckGo)
  const enc = encodeURIComponent;

  // Bronnen die de kassa kent maar prive-zoek.js niet: PDOK (Nederlandse adressen) en arXiv. Alleen met `bronnen` te vragen.
  const EXTRA = {
    pdok: {
      naam: 'PDOK Locatieserver', hosts: ['api.pdok.nl'],
      adres: (q) => `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${enc(q)}&rows=${MAX_PER_BRON}&fl=weergavenaam,type,id`,
      lees: (d) => ((d && d.response && d.response.docs) || []).slice(0, MAX_PER_BRON).map((x) => ({ titel: String(x.weergavenaam || ''), tekst: String(x.type || ''), url: `https://api.pdok.nl/bzk/locatieserver/search/v3_1/lookup?id=${enc(String(x.id || ''))}` })),
    },
    arxiv: {
      naam: 'arXiv', hosts: ['export.arxiv.org'], xml: true,
      adres: (q) => `https://export.arxiv.org/api/query?search_query=all:${enc(q)}&max_results=${MAX_PER_BRON}`,
      lees: (d) => [...String(d || '').matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, MAX_PER_BRON).map((m) => {
        const t = (/<title>([\s\S]*?)<\/title>/.exec(m[1]) || [])[1] || '';
        const s = (/<summary>([\s\S]*?)<\/summary>/.exec(m[1]) || [])[1] || '';
        const id = (/<id>([\s\S]*?)<\/id>/.exec(m[1]) || [])[1] || '';
        return { titel: t.replace(/\s+/g, ' ').trim(), tekst: s.replace(/\s+/g, ' ').trim().slice(0, 200), url: id.trim().replace(/^http:/, 'https:') };
      }),
    },
  };

  // 537: DE BRONREGELS LOS VAN DE ZOEKER. Een telefoon die een deelvraag via de brievenbus krijgt, past PRECIES dezelfde regels toe als
  // de zoeker hier: alleen een bekende bron, het adres bouwt de telefoon zelf (nooit een adres van buiten), https op een host van die bron.
  function bronRegels(Z) {
    const bron = (naam) => (Z.BRONNEN && Object.prototype.hasOwnProperty.call(Z.BRONNEN, naam) && !Z.BRONNEN[naam].uit ? Z.BRONNEN[naam]
      : Object.prototype.hasOwnProperty.call(EXTRA, naam) ? EXTRA[naam] : null) || null;
    const toegestaanAdres = (naam, adres) => {
      let u; try { u = new URL(adres); } catch (e) { return false; }
      const b = bron(naam);
      return !!b && u.protocol === 'https:' && !u.port && !u.username && b.hosts.includes(u.hostname) && (Z.isToegestaanAdres(adres) || naam in EXTRA);
    };
    // Wat een bron teruggaf, gezeefd: alleen openbare https-links die de bewaker doorlaat, hoogstens MAX_PER_BRON, korte teksten.
    const zeef = (naam, lijst, bewaker, maat) => {
      const m = maat || {};
      let weg = 0;
      const resultaten = (Array.isArray(lijst) ? lijst : []).filter((x) => x && typeof x.url === 'string' && x.url.length <= (m.url || 2000) && Z.isOpenbaarLink(x.url)).filter((x) => {
        const toegestaan = bewaker.beoordeelResultaat(x).toegestaan;
        if (!toegestaan) weg += 1;
        return toegestaan;
      }).slice(0, MAX_PER_BRON).map((x) => Object.assign({ bron: naam }, x, { titel: String(x.titel || '').slice(0, m.titel || 400), tekst: String(x.tekst || '').slice(0, m.tekst || 200) }));
      return { resultaten, weggelaten: weg };
    };
    return { bron, toegestaanAdres, zeef };
  }

  // 537: DE DEELVRAGEN VAN EEN ZOEKKAARTJE, op de telefoon. Een deel = { bron, term, taal, veilig }. Een voor een (nooit tegelijk naar
  // buiten), met een korte pauze; de rem voor het hele huis houdt Veronica bij (haar kassa gaf het slot al). Terug per deel alleen
  // { status, resultaten }: korte teksten, zodat het antwoord in de stukjes van de brievenbus past. NOOIT een adres van buiten ophalen.
  // o: { http, zoekmodule (PriveZoek), kassaModule (ZoekKassa), bewaker, wacht? }
  const BRIEF_MAX_DELEN = 3;
  const BRIEF_MAAT = Object.freeze({ titel: 120, tekst: 120, url: 300 });
  async function doeBriefDelen(o, delen) {
    const R = bronRegels(o.zoekmodule);
    const wacht = o.wacht || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const uit = [];
    const lijst = (Array.isArray(delen) ? delen : []).slice(0, BRIEF_MAX_DELEN);
    for (let i = 0; i < lijst.length; i += 1) {
      const d = lijst[i] && typeof lijst[i] === 'object' ? lijst[i] : {};
      const naam = String(d.bron || '');
      const term = String(d.term || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TERM);
      const taal = /^[a-z]{2}$/.test(String(d.taal || '')) ? d.taal : 'nl';
      const bx = R.bron(naam);
      if (!bx || !term || !o.bewaker.beoordeel(term, 'zoek').toegestaan) { uit.push({ bron: naam, status: 0, resultaten: [] }); continue; }
      const adres = bx.adres(term, taal, !!d.veilig, {});
      if (!R.toegestaanAdres(naam, adres)) { uit.push({ bron: naam, status: 0, resultaten: [] }); continue; }
      if (i > 0) await wacht(400);
      let r;
      try { r = await o.http({ method: 'GET', url: adres, headers: { Accept: bx.xml ? 'application/atom+xml' : 'application/json', 'User-Agent': o.kassaModule.UA }, connectTimeout: 8000, readTimeout: 12000 }); } catch (e) { r = null; }
      const status = (r && r.status) || 0;
      if (status !== 200 || (bx.geblokkeerd && bx.geblokkeerd(r))) { uit.push({ bron: naam, status: status === 200 ? 429 : status, resultaten: [] }); continue; }
      let data = r.data;
      if (!bx.xml && typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = null; } }
      let gelezen = [];
      try { gelezen = bx.lees(data, taal); } catch (e) { gelezen = []; }
      const z = R.zeef(naam, gelezen, o.bewaker, BRIEF_MAAT);
      uit.push({ bron: naam, status: 200, resultaten: z.resultaten.map((x) => ({ titel: x.titel, tekst: x.tekst, url: x.url })) });
    }
    return uit;
  }

  // o: { http, bewaker, kassa, kassaModule (ZoekKassa), zoekmodule (PriveZoek), telefoons: () => [{ id, lokaal: bool, host, brief?: bool }], code: () => rijcode, index (Lokaalindex.maakIndex()), wacht, nu,
  //      briefDeel?: async (telefoon, { bron, term, taal, veilig }) -> { status, resultaten } (537: een telefoon zonder wifi, via de brievenbus) }
  function maakMultiZoeker(o) {
    if (!o || typeof o.http !== 'function' || !o.kassa || !o.kassaModule || !o.zoekmodule || !o.bewaker) throw new Error('maakMultiZoeker: http, kassa, kassaModule, zoekmodule en bewaker zijn nodig');
    const Z = o.zoekmodule; const bewaker = o.bewaker; const kassa = o.kassa;
    const wacht = o.wacht || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const oudeTelefoons = new Set();          // telefoons die het eindpunt nog niet kennen (404/405): daar halen we zelf op
    const teller = { deelvragen: 0, opAnderen: 0, zelf: 0, lokaalGenoeg: 0, terugval: 0, viaBrief: 0, uitVoorraad: 0 };
    const { bron, toegestaanAdres, zeef } = bronRegels(Z);

    async function haalZelf(adres, xml) {
      const r = await o.http({ method: 'GET', url: adres, headers: { Accept: xml ? 'application/atom+xml' : 'application/json', 'User-Agent': o.kassaModule.UA }, connectTimeout: 8000, readTimeout: 12000 });
      teller.zelf += 1;
      return { status: r && r.status, data: r && r.data };
    }

    async function haalOpTelefoon(t, adres, xml) {
      if (t.lokaal || oudeTelefoons.has(t.id)) return haalZelf(adres, xml);
      const code = o.code ? o.code() : '';
      if (!code) return haalZelf(adres, xml);
      for (let poging = 0; poging < 4; poging += 1) {
        let r;
        try {
          r = await o.http({ method: 'POST', url: `http://${t.host}:${WEB_POORT}/jarvis/zoek-deel`, headers: { 'X-Koppelcode': code, 'Content-Type': 'application/json' }, data: { url: adres }, connectTimeout: 2500, readTimeout: 16000 });
        } catch (e) { throw new Error('telefoon-uit'); }
        if (r && (r.status === 404 || r.status === 405)) { oudeTelefoons.add(t.id); teller.terugval += 1; return haalZelf(adres, xml); }
        if (r && r.status === 429) { await wacht(350); continue; }                  // de telefoon doet er een tegelijk: even wachten, geen nieuw slot
        if (!r || r.status !== 200) throw new Error('telefoon-uit');
        const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        teller.opAnderen += 1;
        let data = d && d.data;
        if (!xml && typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { data = null; } }
        return { status: d && d.status, data };
      }
      throw new Error('telefoon-uit');
    }

    async function zoek(vraag, opties) {
      const op = opties || {};
      const term = String(vraag || '').trim().replace(/\s+/g, ' ').slice(0, MAX_TERM);
      const b = bewaker.beoordeel(term, 'zoek');
      if (!b.toegestaan) return { ok: false, geweigerd: true, code: b.code, reden: bewaker.REDENEN.zoek, bronnen: [] };
      const taal = op.taal || 'nl';
      const bronnen = [];
      let totaal = 0;

      // 1. LOKAAL EERST.
      if (o.index && !op.zonderLokaal) {
        const l = o.index.zoek(term, MAX_PER_BRON).filter((x) => bewaker.beoordeelResultaat(Object.assign({ url: x.url || 'https://lokaal.invalid/' }, x)).toegestaan);
        if (l.length) {
          bronnen.push({ bron: 'lokaal', ok: true, uitCache: false, telefoon: null, resultaten: l.map((x) => ({ bron: 'lokaal', titel: x.titel, tekst: x.tekst, url: x.url })) });
          totaal += l.length;
          if (l.length >= GENOEG_LOKAAL) { teller.lokaalGenoeg += 1; return { ok: true, term, bronnen, aantal: totaal, meldingen: [], lokaalGenoeg: true }; }
        }
      }

      // 2. De deelvragen over de telefoons.
      const lijst = (op.bronnen && op.bronnen.length ? op.bronnen : STANDAARD_BRONNEN).filter((x) => bron(x));
      const tels = (op.telefoons || (o.telefoons ? o.telefoons() : [])).filter((t) => t && t.id && (!t.brief || typeof o.briefDeel === 'function'));
      const telefoons = tels.length ? tels : [{ id: 'zelf', lokaal: true, host: '' }];
      const byId = new Map(telefoons.map((t) => [t.id, t]));
      const haal = async (naam, id) => {
        teller.deelvragen += 1;
        const bx = bron(naam);
        const t = byId.get(id);
        if (t && t.brief) {
          // 537: een telefoon zonder wifi. Hij bouwt het adres zelf en stuurt alleen de gezeefde resultaten terug; die gaan hier NOG EENS
          // door dezelfde zeef (wat een telefoon terugstuurt is data). Geen antwoord = een gooi, dan probeert de kassa de volgende telefoon.
          const r = await o.briefDeel(t, { bron: naam, term, taal, veilig: !!op.veilig });
          if (!r || r.status !== 200) return { status: (r && r.status) || 0, resultaten: [] };
          teller.viaBrief += 1;
          const z = zeef(naam, r.resultaten, bewaker);
          return { status: 200, resultaten: z.resultaten, weggelaten: z.weggelaten };
        }
        const adres = bx.adres(term, taal, !!op.veilig, { marginaliaSleutel: o.marginaliaSleutel && o.marginaliaSleutel() });
        if (!toegestaanAdres(naam, adres)) return { status: 0, resultaten: [] };
        const r = await haalOpTelefoon(t, adres, !!bx.xml);
        if (r.status === 429 || r.status === 403 || r.status === 503 || (bx.geblokkeerd && bx.geblokkeerd(r))) return { status: r.status || 429, resultaten: [] };
        if (r.status !== 200) return { status: r.status || 0, resultaten: [] };
        const z = zeef(naam, bx.lees(r.data, taal), bewaker);
        return { status: 200, resultaten: z.resultaten, weggelaten: z.weggelaten };
      };
      // 544 (Klus B): DE ZOEKVOORRAAD op de geheugen-telefoon (o.voorraad = { lees, schrijf }, alleen voor het algemene zoeken).
      // Eerst kijken; wat er staat gaat NOG EENS door dezelfde zeef (het is data van een andere telefoon). Een nieuw antwoord gaat erin.
      // Faalt de voorraad, dan merkt niemand het: dan wordt er gewoon gezocht.
      const metVoorraad = o.voorraad ? async (naam, id) => {
        try {
          const v = await o.voorraad.lees(naam, term, taal);
          if (v && Array.isArray(v.resultaten)) { const z = zeef(naam, v.resultaten, bewaker); teller.uitVoorraad += 1; return { status: 200, resultaten: z.resultaten, weggelaten: z.weggelaten, uitVoorraad: true }; }
        } catch (e) { /* dan zoeken */ }
        const r = await haal(naam, id);
        if (r && r.status === 200 && r.resultaten.length) { try { await o.voorraad.schrijf(naam, term, taal, r.resultaten); } catch (e) { /* niet erg */ } }
        return r;
      } : haal;
      // De register-regel van de kassa weet welke bronnen mogen; planDeelvragen gooit de rest eruit.
      const u = await o.kassaModule.zoekVerdeeld(kassa, term, telefoons, metVoorraad, wacht, { bronnen: lijst, taal, max: 40 });
      const meldingen = [];
      for (const d of u.delen) {
        const naam = (bron(d.bron) || {}).naam || d.bron;
        const e = { bron: d.bron, ok: !d.reden, uitCache: !!d.uitGeheugen, telefoon: d.telefoon || null, resultaten: d.resultaten || [] };
        if (d.reden) {
          e.reden = d.reden;
          e.zin = d.reden === 'geblokkeerd' ? `${naam} laat nu even geen zoekopdrachten toe. Ik gebruik de andere bronnen en probeer het later opnieuw.`
            : d.reden === 'uurgrens' ? `Ik heb ${naam} dit uur al vaak genoeg gevraagd. Ik wacht even met die bron.`
              : `${naam} was niet te bereiken. Ik gebruik de andere bronnen.`;
          meldingen.push(e.zin);
        }
        bronnen.push(e);
        totaal += e.resultaten.length;
      }
      return { ok: true, term, bronnen, aantal: totaal, meldingen };
    }

    return { zoek, teller, _oud: oudeTelefoons };
  }

  return { maakMultiZoeker, bronRegels, doeBriefDelen, BRIEF_MAX_DELEN, BRIEF_MAAT, EXTRA, STANDAARD_BRONNEN, GENOEG_LOKAAL };
}));
