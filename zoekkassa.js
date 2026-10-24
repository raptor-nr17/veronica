// ===================================================================
// DE ZOEKKASSA (461) -- een rem voor het HELE HUIS, en het verdelen van deelvragen over telefoons
// ===================================================================
//
// Het probleem dat dit oplost: alle telefoons hangen aan HETZELFDE thuis-wifi en dus aan HETZELFDE publieke IP-adres.
// Een bron ziet geen vier telefoons maar een adres. Laat elke telefoon zijn eigen rem bijhouden, dan krijgt Nominatim
// (regel: hoogstens een verzoek per seconde) bij vier telefoons vier per seconde. Dat is precies wat de regels van de
// bronnen verbieden, en het is ook niet te verhelpen met "meer telefoons".
//
// Daarom is er EEN kassa. Een telefoon die een bron wil vragen haalt eerst een SLOT bij de kassa (de baas houdt hem bij).
// De kassa geeft per bron: een minimale pauze tussen twee verzoeken voor het hele huis, een grens per uur voor het
// hele huis, een blokkade voor het hele huis als een bron 429/403 zegt, en een gedeeld zoekgeheugen (cache).
//
// Wat dit WEL en NIET oplevert (eerlijk, zie docs/multizoeken.md):
//  - verdelen over BRONNEN versnelt: Wikipedia, Wikidata en Nominatim kunnen tegelijk, elk met zijn eigen rem;
//  - verdelen over TELEFOONS vermijdt GEEN enkele limiet: het IP-adres blijft hetzelfde. Er wordt dus niets "omzeild"
//    en dat is met opzet; elke bron krijgt van het huis samen hoogstens wat hij van een enkele gebruiker accepteert;
//  - het User-Agent is voor alle telefoons HETZELFDE (Wikimedia verbiedt verzoeken spreiden over verschillende
//    User-Agents om grenzen te ontlopen, beleid van 2024).
//
// Geen scherm en geen netwerk hierin: het ophalen zelf (een telefoon die een URL ophaalt) wordt van buiten aangeleverd.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.ZoekKassa = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const UUR_MS = 3600 * 1000;
  const CACHE_MS = 24 * UUR_MS;
  const CACHE_MAX = 300;
  const BLOK_MIN_MS = 15 * 60 * 1000;
  const BLOK_MAX_MS = 60 * 60 * 1000;
  // EEN User-Agent voor het hele huis.
  const UA = 'JARVIS-Zoekkassa/1.9.27 (persoonlijk gebruik, lage frequentie, een IP-adres)';

  // Het register. Elke bron: de regel waaraan we ons houden en waar die vandaan komt. `toegestaan:false` = niet gebruiken,
  // met de reden erbij. Een nieuwe bron komt hier alleen bij nadat zijn voorwaarden gelezen zijn.
  const REGISTER = Object.freeze({
    wikipedia: { naam: 'Wikipedia', groep: 'wikimedia', toegestaan: true, remMs: 250, perUur: 600, seriele: true,
      regel: 'Wikimedia: een duidelijke User-Agent met contact, verzoeken na elkaar (niet tegelijk), niet spreiden over User-Agents.' },
    wikidata: { naam: 'Wikidata', groep: 'wikimedia', toegestaan: true, remMs: 250, perUur: 600, seriele: true,
      regel: 'Zelfde beleid als Wikipedia (Wikimedia).' },
    osm: { naam: 'OpenStreetMap (Nominatim)', toegestaan: true, remMs: 1100, perUur: 300, seriele: true,
      regel: 'Hoogstens 1 verzoek per seconde in totaal, duidelijke User-Agent, resultaten bewaren (cache), geen bulk.' },
    openmeteo: { naam: 'Open-Meteo', toegestaan: true, remMs: 1000, perUur: 400, seriele: true,
      regel: 'Gratis voor niet-commercieel gebruik: minder dan 10.000 per dag, 5.000 per uur, 600 per minuut; naamsvermelding (CC BY 4.0). Dit is geen commerciele dienst.' },
    marginalia: { naam: 'Marginalia', toegestaan: true, remMs: 3000, perUur: 20, seriele: true,
      regel: 'De openbare sleutel deelt zijn rem met iedereen: een 429 is normaal; rustig aan, resultaten CC-BY-NC-SA.' },
    openverse: { naam: 'Openverse', toegestaan: true, remMs: 1000, perUur: 5, seriele: true,
      regel: 'Zonder sleutel hoogstens 5 per uur en 100 per dag.' },
    duckduckgo: { naam: 'DuckDuckGo (lichte pagina)', toegestaan: false, remMs: 0, perUur: 0, seriele: true,
      regel: 'UIT sinds 462: geen officiele API en geen toestemming voor geautomatiseerd gebruik gevonden. Alleen weer aan na een ja op de officiele voorwaarden.' },
    pdok: { naam: 'PDOK Locatieserver (Nederlandse adressen)', toegestaan: true, remMs: 500, perUur: 600, seriele: true,
      regel: 'Open overheidsdienst, geen sleutel. Geen vast getal nagekeken (geen toegang): daarom zuinig, 2 per seconde, 600 per uur voor het hele huis.' },
    arxiv: { naam: 'arXiv', toegestaan: true, remMs: 3000, perUur: 100, seriele: true,
      regel: 'Hoogstens 1 verzoek per 3 seconden voor al je machines samen, een verzoek tegelijk (arXiv API-voorwaarden, volgens het onderzoek van Cowork).' },
    tavily: { naam: 'Tavily', toegestaan: false, remMs: 0, perUur: 0, seriele: true,
      regel: 'Alleen met een eigen sleutel van de eigenaar (gratis tegoed, geen kaart). Wij maken geen account en vullen geen sleutel in: staat uit tot de eigenaar er zelf een zet.' },
    brave: { naam: 'Brave Search API', toegestaan: false, remMs: 0, perUur: 0, seriele: true, regel: 'Niet meer gratis (onderzoek van Cowork).' },
    googlecse: { naam: 'Google Programmable Search (CSE)', toegestaan: false, remMs: 0, perUur: 0, seriele: true, regel: 'Sluit op 1 januari 2027 en staat niet in de lijst met toegestane bronnen.' },
    commoncrawl: { naam: 'Common Crawl (CDX-index)', toegestaan: false, remMs: 0, perUur: 0, seriele: true,
      regel: 'NIET opgenomen: de index-server is bedoeld voor onderzoek en vraagt om een eigen User-Agent en een lage frequentie; voor een gewone zoekvraag ongeschikt (traag, geen tekst). Alleen als de eigenaar er om vraagt.' },
    searxng: { naam: 'Openbare SearXNG-instanties', toegestaan: false, remMs: 0, perUur: 0, seriele: true,
      regel: 'NIET opgenomen: het JSON-formaat staat op openbare instanties meestal uit en de bot-limiter geeft 429 aan een script; elke instantie heeft eigen voorwaarden die we niet kunnen nalezen. Een eigen instantie (zelf draaien) mag later wel.' },
    google: { naam: 'Google', toegestaan: false, remMs: 0, perUur: 0, seriele: true, regel: 'Nooit: niet uitlezen of nabootsen.' },
    bing: { naam: 'Bing', toegestaan: false, remMs: 0, perUur: 0, seriele: true, regel: 'Nooit: niet uitlezen of nabootsen.' },
    // 542: de rest van de grote zoekmachines staat er bij naam in, zodat niemand ze "per ongeluk" toevoegt.
    yahoo: { naam: 'Yahoo', toegestaan: false, remMs: 0, perUur: 0, seriele: true, regel: 'Nooit: niet uitlezen of nabootsen.' },
    yandex: { naam: 'Yandex', toegestaan: false, remMs: 0, perUur: 0, seriele: true, regel: 'Nooit: niet uitlezen of nabootsen.' },
    baidu: { naam: 'Baidu', toegestaan: false, remMs: 0, perUur: 0, seriele: true, regel: 'Nooit: niet uitlezen of nabootsen.' },
    ecosia: { naam: 'Ecosia', toegestaan: false, remMs: 0, perUur: 0, seriele: true, regel: 'Nooit: niet uitlezen of nabootsen.' },
    startpage: { naam: 'Startpage', toegestaan: false, remMs: 0, perUur: 0, seriele: true, regel: 'Nooit: niet uitlezen of nabootsen.' },
  });

  function maakKassa(o) {
    const opt = o || {};
    const nu = opt.nu || (() => Date.now());
    const register = opt.register || REGISTER;
    const volgendeMag = new Map();    // bron -> vroegste tijd voor het volgende verzoek (voor het hele huis)
    const aanvragen = new Map();      // bron -> tijden van de laatste verzoeken
    const blokTot = new Map();        // bron -> tot wanneer de bron met rust gelaten wordt
    const blokTeller = new Map();
    const cache = new Map();
    const telling = { sloten: 0, geweigerd: 0, uitCache: 0 };

    // Vraag een slot voor een verzoek aan `bron`. Terug:
    //  { ok:true, wachtMs }  -> wacht zo lang en haal dan op (het slot telt al als verzoek);
    //  { ok:false, reden }   -> haal NIET op. reden: onbekend | niet-toegestaan | geblokkeerd | uurgrens
    function slot(bron) {
      const r = register[bron];
      if (!r) { telling.geweigerd += 1; return { ok: false, reden: 'onbekend' }; }
      if (!r.toegestaan) { telling.geweigerd += 1; return { ok: false, reden: 'niet-toegestaan' }; }
      const t = nu();
      if ((blokTot.get(bron) || 0) > t) { telling.geweigerd += 1; return { ok: false, reden: 'geblokkeerd', totMs: blokTot.get(bron) }; }
      const recent = (aanvragen.get(bron) || []).filter((x) => t - x < UUR_MS);
      if (recent.length >= r.perUur) { aanvragen.set(bron, recent); telling.geweigerd += 1; return { ok: false, reden: 'uurgrens' }; }
      const g = r.groep || bron;          // Wikipedia en Wikidata zijn een dienst (Wikimedia): een gezamenlijke rem
      const mag = Math.max(t, volgendeMag.get(g) || 0);
      volgendeMag.set(g, mag + r.remMs);
      recent.push(mag);
      aanvragen.set(bron, recent);
      telling.sloten += 1;
      return { ok: true, wachtMs: mag - t };
    }

    // De bron zei 429/403/503 of stuurde een controlevraag: voor het hele huis met rust laten, steeds langer.
    function blokkade(bron) {
      const n = (blokTeller.get(bron) || 0) + 1;
      blokTeller.set(bron, n);
      blokTot.set(bron, nu() + Math.min(BLOK_MIN_MS * Math.pow(2, n - 1), BLOK_MAX_MS));
    }
    function gelukt(bron) { blokTeller.delete(bron); }
    // 542: de stand van een bron LEZEN zonder een slot te nemen (voor het statuswoord op het scherm). ok | rust | uit.
    function stand(bron) {
      const r = register[bron];
      if (!r || !r.toegestaan) return { stand: 'uit' };
      const t = nu();
      if ((blokTot.get(bron) || 0) > t) return { stand: 'rust', totMs: blokTot.get(bron) };
      if ((aanvragen.get(bron) || []).filter((x) => t - x < UUR_MS).length >= r.perUur) return { stand: 'rust' };
      return { stand: 'ok' };
    }

    // Het zoekgeheugen. De sleutel bevat bron, taal en term; het hele huis deelt het.
    const sleutelVan = (bron, taal, term) => `${bron}|${taal || 'nl'}|${String(term || '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
    function uitGeheugen(bron, taal, term) {
      const c = cache.get(sleutelVan(bron, taal, term));
      if (c && nu() - c.t < CACHE_MS) { telling.uitCache += 1; return c.resultaten; }
      return null;
    }
    function inGeheugen(bron, taal, term, resultaten) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(sleutelVan(bron, taal, term), { t: nu(), resultaten });
    }
    function wis() { cache.clear(); }

    return { slot, blokkade, gelukt, stand, uitGeheugen, inGeheugen, wis, telling, _cache: cache };
  }

  // Een vraag in deelvragen: een per toegestane bron. Telefoons die meedoen krijgen de bronnen om de beurt, met
  // de bronnen die het meest vragen (de langzaamste rem) eerst, zodat die niet als laatste beginnen.
  // Terug: [{ bron, telefoon }]. Zonder telefoons: leeg. Geen bron wordt twee keer uitgezet, en geen onbekende of
  // niet-toegestane bron komt erin.
  function planDeelvragen(bronnen, telefoons, register) {
    const reg = register || REGISTER;
    const lijst = [];
    const gezien = new Set();
    for (const b of bronnen || []) {
      if (gezien.has(b) || !reg[b] || !reg[b].toegestaan) continue;
      gezien.add(b); lijst.push(b);
    }
    lijst.sort((a, b) => reg[b].remMs - reg[a].remMs || a.localeCompare(b));
    const tels = (telefoons || []).filter((t) => t && t.id);
    if (!tels.length) return [];
    return lijst.map((bron, i) => ({ bron, telefoon: tels[i % tels.length].id }));
  }

  // Resultaten van de bronnen samenvoegen: dezelfde pagina (zelfde adres zonder # en slot-/) maar een keer, de bron die
  // hem het eerst gaf wint; de volgorde van de bronnen blijft staan; hoogstens `max` stuks.
  function normaalAdres(u) {
    try { const x = new URL(String(u)); x.hash = ''; return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase(); } catch (e) { return ''; }
  }
  function voegSamen(delen, max) {
    const gezien = new Set();
    const uit = [];
    for (const d of delen || []) {
      for (const r of (d && d.resultaten) || []) {
        const k = normaalAdres(r.url);
        if (k && gezien.has(k)) continue;
        if (k) gezien.add(k);
        uit.push(Object.assign({ bron: d.bron }, r));
        if (uit.length >= (max || 20)) return uit;
      }
    }
    return uit;
  }

  // Het hele pad voor een vraag, met van buiten aangeleverd: haal(bron, telefoonId) -> { status, resultaten } en wacht(ms).
  // Valt een telefoon uit tijdens zijn deelvraag (haal geeft een fout), dan vangt de VOLGENDE telefoon die deelvraag op;
  // ze wordt niet twee keer tegelijk gedaan.
  async function zoekVerdeeld(kassa, vraag, telefoons, haal, wacht, opties) {
    const o = opties || {};
    const taal = o.taal || 'nl';
    const plan = planDeelvragen(o.bronnen || Object.keys(REGISTER), telefoons, o.register);
    const meldingen = [];
    const delen = await Promise.all(plan.map(async (p) => {
      const g = kassa.uitGeheugen(p.bron, taal, vraag);
      if (g) return { bron: p.bron, resultaten: g, uitGeheugen: true, telefoon: null };
      const kandidaten = [p.telefoon].concat((telefoons || []).map((t) => t.id).filter((id) => id !== p.telefoon));
      for (const id of kandidaten) {
        const s = kassa.slot(p.bron);
        if (!s.ok) { meldingen.push({ bron: p.bron, reden: s.reden }); return { bron: p.bron, resultaten: [], telefoon: null, reden: s.reden }; }
        if (s.wachtMs > 0) await wacht(s.wachtMs);
        let r;
        try { r = await haal(p.bron, id); } catch (e) { meldingen.push({ bron: p.bron, reden: 'telefoon-uit', telefoon: id }); continue; }
        if (r && (r.status === 429 || r.status === 403 || r.status === 503)) { kassa.blokkade(p.bron); meldingen.push({ bron: p.bron, reden: 'geblokkeerd' }); return { bron: p.bron, resultaten: [], telefoon: id, reden: 'geblokkeerd' }; }
        if (!r || r.status !== 200) { meldingen.push({ bron: p.bron, reden: 'fout' }); return { bron: p.bron, resultaten: [], telefoon: id, reden: 'fout' }; }
        kassa.gelukt(p.bron);
        kassa.inGeheugen(p.bron, taal, vraag, r.resultaten || []);
        return { bron: p.bron, resultaten: r.resultaten || [], telefoon: id };
      }
      return { bron: p.bron, resultaten: [], telefoon: null, reden: 'geen-telefoon' };
    }));
    // De volgorde van de bronnen is die van het register, niet die van het binnenkomen: zo is het resultaat altijd gelijk.
    const reg = o.register || REGISTER;
    const volgorde = Object.keys(reg);
    delen.sort((a, b) => volgorde.indexOf(a.bron) - volgorde.indexOf(b.bron));
    return { vraag, delen, resultaten: voegSamen(delen, o.max), meldingen };
  }

  return { REGISTER, UA, CACHE_MS, CACHE_MAX, maakKassa, planDeelvragen, voegSamen, normaalAdres, zoekVerdeeld };
}));
