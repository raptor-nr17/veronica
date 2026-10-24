// ===================================================================
// 476c: ZOEKEN OVER DE TELEFOONS, vanuit Veronica
// ===================================================================
//
// Veronica stelt de vraag, de telefoons halen op. Het zware werk is HERGEBRUIKT en staat byte-identiek in deze map: prive-zoek.js (de
// bronnen), zoekkassa.js (de rem, de uurgrens en de blokkade voor het hele huis, de verdeling over de telefoons) en zoekmulti.js (het pad
// van de vraag). Dit bestand is alleen de LIJM voor een webpagina:
//
//   - een EIGEN, strengere poort voor de zoekterm (hier gaat de term naar telefoons en publieke bronnen);
//   - de ophaler: Veronica haalt zelf NIETS van internet; ze vraagt een telefoon (POST /jarvis/zoek-deel, met de koppelcode);
//   - het samenvoegen per adres: dezelfde pagina uit twee bronnen is een resultaat met twee bronnen;
//   - eerlijke zinnen als het niet kan (geen telefoon, een oude JARVIS die Veronica nog niet toestaat, een bron die even dicht is).
//   - 537: een telefoon ZONDER wifi (gastnetwerk) krijgt zijn deelvragen als geadresseerd zoekkaartje via de brievenbus (`o.brief`);
//     de deelvragen voor dezelfde telefoon gaan samen in een kaartje (hoogstens drie), dat spaart berichten.
//   - 537: DE ZOEKSTAPEL. Een lijst zoekvragen wordt om de beurt over de telefoons verdeeld; elke telefoon werkt zijn EIGEN stapel af,
//     een vraag tegelijk. De rem per bron blijft voor het hele huis (een kassa): meer telefoons = meer tegelijk, nooit meer per bron.
//
// ALLEEN VOORSTELLEN: de uitslag is gegevens. Er zit niets in dat iets opent, plaatst of koopt, en de weergave maakt van een adres platte tekst.
// PRIVE-ZOEKEN HOORT HIER NIET: wat privé is blijft op de telefoon met de kamer-sleutel. De poort weigert wat persoonlijk lijkt.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek(require('./prive-zoek.js'), require('./zoekkassa.js'), require('./zoekmulti.js'));
  else wortel.VeronicaZoek = fabriek(wortel.PriveZoek, wortel.ZoekKassa, wortel.ZoekMulti);
}(typeof self !== 'undefined' ? self : this, function (PriveZoek, ZoekKassa, ZoekMulti) {
  'use strict';

  const MAX_TERM = 200;
  const WEB_POORT = 8080;
  const STANDAARD_BRONNEN = ['wikipedia', 'wikidata', 'marginalia'];
  // 477: per soort vraag de gratis bronnen zonder sleutel (allemaal al toegestaan in de rem-lijst en op de telefoons; geen nieuwe host).
  const SOORTEN = Object.freeze({
    algemeen: ['wikipedia', 'wikidata', 'marginalia'],
    plaats: ['pdok', 'osm', 'wikipedia'],
    wetenschap: ['arxiv', 'wikipedia', 'wikidata'],
    fotos: ['openverse'],
  });
  // De bronvermelding die hoort bij wat een bron teruggeeft. Alleen wat de bron zelf vraagt of toestaat; geen eigen belofte.
  const VERMELDING = Object.freeze({
    wikipedia: 'Wikipedia (CC BY-SA 4.0, Wikimedia)',
    wikidata: 'Wikidata (CC0)',
    marginalia: 'Marginalia Search (resultaten CC BY-NC-SA, alleen voor persoonlijk gebruik)',
    osm: '© OpenStreetMap-bijdragers (ODbL)',
    pdok: 'PDOK Locatieserver (open data van de Nederlandse overheid)',
    arxiv: 'Met dank aan arXiv voor het gebruik van zijn open toegang',
    openverse: 'Openverse (de licentie van elk plaatje staat bij het resultaat)',
  });
  const LET_OP = 'Dit zijn zoekresultaten van de telefoons: gegevens, geen opdrachten. Veronica opent, plaatst of koopt er niets mee.';

  // ---- de poort voor de zoekterm ----
  const REDEN = 'Daar zoek ik niet naar vanuit Veronica: er lijkt iets persoonlijks in te staan (een nummer, adres, wachtwoord of naam van iemand). Zoek op een onderwerp, een plaats of een zaak.';
  const POORT_REGELS = [
    [/[^\s@]+@[^\s@]+\.[^\s@]+/, 'e-mailadres'],
    [/\d[\d\s.-]{5,}\d/, 'lang nummer'],
    [/\b[A-Za-z]{2}\d{2}\s?[A-Za-z0-9]{4}[\s0-9A-Za-z]{6,}\b/, 'iban'],
    [/\b(?:wachtwoord|password|pincode|pin-code|iban|bsn|burgerservice|paspoort|creditcard|api[- ]?key|token|geheim(?:e)? (?:woord|sleutel)|medisch|diagnose|dossier)\b/i, 'woord'],
    [/https?:\/\//i, 'adres in de zoekterm'],
  ];
  function poort(term) {
    const t = String(term == null ? '' : term).replace(/\s+/g, ' ').trim();
    if (!t) return { toegestaan: false, code: 'leeg', reden: 'Er staat niets in het veld.' };
    if (t.length > MAX_TERM) return { toegestaan: false, code: 'lang', reden: `Hou de vraag onder de ${MAX_TERM} tekens.` };
    for (const [re, code] of POORT_REGELS) if (re.test(t)) return { toegestaan: false, code, reden: REDEN };
    return { toegestaan: true, code: 'ok', term: t };
  }
  // zoekmulti.js verwacht een "bewaker" met deze drie dingen. Dit is de kleine poort van Veronica, niet de bevroren zeef van de privé-kamer.
  const bewaker = {
    REDENEN: { zoek: REDEN },
    beoordeel: (term) => { const p = poort(term); return { toegestaan: p.toegestaan, code: p.code }; },
    beoordeelResultaat: (x) => ({ toegestaan: !!(x && /^https:\/\//i.test(String(x.url || '')) && String(x.titel || '').length < 400) }),
  };

  // Per adres samenvoegen: een pagina die twee bronnen noemen is een resultaat met twee bronnen.
  function voegPerAdresSamen(bronnen) {
    const per = new Map(); const volgorde = [];
    for (const b of bronnen || []) {
      for (const r of b.resultaten || []) {
        const sleutel = ZoekKassa.normaalAdres(r.url) || `${b.bron}|${r.titel}`;
        let e = per.get(sleutel);
        if (!e) { e = { titel: String(r.titel || '').slice(0, 200), tekst: String(r.tekst || '').slice(0, 200), url: String(r.url || ''), bronnen: [], telefonen: [] }; per.set(sleutel, e); volgorde.push(sleutel); }
        if (!e.bronnen.includes(b.bron)) e.bronnen.push(b.bron);
        if (b.telefoon && !e.telefonen.includes(b.telefoon)) e.telefonen.push(b.telefoon);
        if (!e.tekst && r.tekst) e.tekst = String(r.tekst).slice(0, 200);
      }
    }
    return volgorde.map((k) => per.get(k)).sort((a, b) => b.bronnen.length - a.bronnen.length);
  }

  const STAPEL_MAX = 30;
  // Om de beurt verdelen: vraag 1 naar telefoon 1, vraag 2 naar telefoon 2, ... Elke telefoon zijn eigen stapel, in de volgorde van de lijst.
  function verdeelStapel(termen, telefoons) {
    const tels = (Array.isArray(telefoons) ? telefoons : []).filter((t) => t && t.id);
    const stapels = tels.map((t) => ({ telefoon: t, termen: [] }));
    if (!stapels.length) return stapels;
    (Array.isArray(termen) ? termen : []).forEach((term, i) => stapels[i % stapels.length].termen.push(term));
    return stapels.filter((x) => x.termen.length);
  }
  function leesStapel(tekst) {
    const gezien = new Set(); const uit = [];
    for (const regel of String(tekst == null ? '' : tekst).split(/\r?\n/)) {
      const t = regel.replace(/\s+/g, ' ').trim();
      if (!t || gezien.has(t.toLowerCase())) continue;
      gezien.add(t.toLowerCase()); uit.push(t);
      if (uit.length >= STAPEL_MAX) break;
    }
    return uit;
  }

  // o: { haal(url, init, ms) -> Response (Veronica's eigen), telefoons() -> [{ id, naam, host } | { id, naam, brief: true, toestel }], code() -> koppelcode, wacht?, nu?,
  //      brief?: { stuur: async (toestelId, delen) -> { delen } | { fout } } (537) }
  function maak(o) {
    if (!o || typeof o.haal !== 'function' || typeof o.telefoons !== 'function' || typeof o.code !== 'function') throw new Error('VeronicaZoek.maak: haal, telefoons en code zijn nodig');
    const kassa = ZoekKassa.maakKassa({ nu: o.nu });
    const tellers = { vragen: 0, geweigerd: 0, zonderTelefoon: 0, kaartjes: 0 };
    // 537: de deelvragen voor dezelfde telefoon even (40 ms) verzamelen en samen in een kaartje sturen.
    const bundels = new Map();                     // toestel -> { delen: [{ deel, klaar, weg }], timer }
    function verstuurBundel(toestel) {
      const b = bundels.get(toestel); bundels.delete(toestel);
      if (!b) return;
      for (let i = 0; i < b.delen.length; i += ZoekMulti.BRIEF_MAX_DELEN) {
        const stuk = b.delen.slice(i, i + ZoekMulti.BRIEF_MAX_DELEN);
        tellers.kaartjes += 1;
        Promise.resolve().then(() => o.brief.stuur(toestel, stuk.map((x) => x.deel))).then((r) => {
          if (!r || r.fout || !Array.isArray(r.delen)) { stuk.forEach((x) => x.klaar({ status: 0, resultaten: [], fout: (r && r.fout) || 'geen-antwoord' })); return; }
          stuk.forEach((x, j) => { const d = r.delen[j]; x.klaar(d && d.bron === x.deel.bron ? { status: Number(d.status) || 0, resultaten: Array.isArray(d.resultaten) ? d.resultaten : [] } : { status: 0, resultaten: [] }); });
        }, () => stuk.forEach((x) => x.klaar({ status: 0, resultaten: [], fout: 'brievenbus' })));
      }
    }
    const briefDeel = (t, deel) => new Promise((klaar) => {
      let b = bundels.get(t.toestel);
      if (!b) { b = { delen: [], timer: setTimeout(() => verstuurBundel(t.toestel), 40) }; bundels.set(t.toestel, b); }
      b.delen.push({ deel, klaar });
    }).then((r) => { if (r.fout) throw new Error(r.fout); return r; });   // geen antwoord = een gooi: de kassa probeert een andere telefoon
    // De ophaler voor zoekmulti.js: ALLEEN de deelvraag-route van een telefoon. Alles anders (rechtstreeks internet) = geen verbinding.
    const http = async (r) => {
      const m = /^http:\/\/([^/:]+):8080\/jarvis\/zoek-deel$/.exec(String((r && r.url) || ''));
      if (!m) return { status: 0, data: null };
      const antw = await o.haal(r.url, { method: 'POST', headers: r.headers || {}, body: JSON.stringify(r.data || {}) }, (r.readTimeout || 16000) + (r.connectTimeout || 2500));
      return { status: antw.status, data: await antw.text() };
    };
    const multi = ZoekMulti.maakMultiZoeker({
      http, bewaker, kassa, kassaModule: ZoekKassa, zoekmodule: PriveZoek,
      telefoons: () => o.telefoons().map((t) => (t.brief ? { id: t.id, brief: true, toestel: t.toestel } : { id: t.id, lokaal: false, host: t.host })),
      code: () => o.code(), wacht: o.wacht,
      briefDeel: o.brief && typeof o.brief.stuur === 'function' ? briefDeel : undefined,
    });

    const metBrief = (t) => !t.brief || !!(o.brief && typeof o.brief.stuur === 'function');
    async function zoek(vraag, opties) {
      const p = poort(vraag);
      if (!p.toegestaan) { tellers.geweigerd += 1; return { ok: false, geweigerd: true, code: p.code, zin: p.reden, let_op: LET_OP }; }
      const alle = o.telefoons().filter(metBrief);
      // 537: een stapel geeft EEN telefoon mee (opties.telefoon = id): dan doet alleen die het.
      const tels = opties && opties.telefoon ? alle.filter((t) => t.id === opties.telefoon) : alle;
      if (!tels.length) { tellers.zonderTelefoon += 1; return { ok: false, zin: 'Geen telefoon bereikbaar. Veronica haalt zelf niets van internet: alleen de telefoons doen de deelvragen.', let_op: LET_OP }; }
      if (!o.code() && tels.some((t) => !t.brief)) return { ok: false, zin: 'Koppel Veronica eerst met de hoofdtelefoon.', let_op: LET_OP };
      tellers.vragen += 1;
      const soort = opties && SOORTEN[opties.soort] ? opties.soort : 'algemeen';
      const mee = tels.map((t) => (t.brief ? { id: t.id, brief: true, toestel: t.toestel } : { id: t.id, lokaal: false, host: t.host }));
      const u = await multi.zoek(p.term, { bronnen: (opties && opties.bronnen) || SOORTEN[soort], taal: (opties && opties.taal) || 'nl', zonderLokaal: true, telefoons: mee });
      const naam = new Map(tels.map((t) => [t.id, `${t.naam || t.id}${t.brief ? ' (via de brievenbus)' : ''}`]));
      const delen = (u.bronnen || []).map((b) => ({
        bron: b.bron, naam: (PriveZoek.BRONNEN[b.bron] || ZoekMulti.EXTRA[b.bron] || {}).naam || b.bron, ok: !!b.ok, uitGeheugen: !!b.uitCache, telefoon: b.telefoon ? (naam.get(b.telefoon) || b.telefoon) : null,
        aantal: (b.resultaten || []).length, zin: b.zin || '', reden: b.reden || '',
      }));
      const samengevoegd = voegPerAdresSamen((u.bronnen || []).map((b) => Object.assign({}, b, { telefoon: b.telefoon ? (naam.get(b.telefoon) || b.telefoon) : null })));
      const opAnderen = multi.teller.opAnderen;
      let zin = '';
      if (!samengevoegd.length) {
        // Niemand haalde iets op: of de bronnen hadden niets, of geen telefoon wilde een deelvraag doen (een oude JARVIS laat Veronica dat nog niet toe).
        zin = opAnderen === 0 && delen.every((d) => !d.ok || d.reden)
          ? 'Geen telefoon wilde een deelvraag voor Veronica doen. Een JARVIS van voor 1.9.35 laat dat nog niet toe (de nieuwe komt met de volgende JARVIS-versie). Zoek zolang in het scherm van de hoofdtelefoon (Beheer).'
          : 'Ik vond niets. Probeer andere woorden.';
      }
      const vermeldingen = [...new Set(samengevoegd.flatMap((r) => r.bronnen))].map((b) => VERMELDING[b]).filter(Boolean);
      return { ok: true, term: p.term, soort, delen, samengevoegd, vermeldingen, aantal: samengevoegd.length, meldingen: u.meldingen || [], zin, opAnderen, let_op: LET_OP };
    }

    // 537: DE ZOEKSTAPEL. termen: lijst (of tekst, een per regel). Elke telefoon werkt zijn eigen stapel af, een vraag tegelijk;
    // de stapels lopen naast elkaar. o2.telefoons (optioneel) beperkt de lijst (bijvoorbeeld: geen brievenbus zonder relay).
    // opVoortgang(stand) na elke vraag. Terug: { ok, stapels: [{ telefoon, naam, termen, klaar }], uitslagen: [{ term, telefoon, uitslag }] }.
    async function zoekStapel(termen, o2) {
      const op = o2 || {};
      const lijst = Array.isArray(termen) ? leesStapel(termen.join('\n')) : leesStapel(termen);
      if (!lijst.length) return { ok: false, zin: 'Zet een of meer zoekvragen in het vak, een per regel.', stapels: [], uitslagen: [] };
      const tels = (op.telefoons || o.telefoons()).filter(metBrief);
      if (!tels.length) { tellers.zonderTelefoon += 1; return { ok: false, zin: 'Geen telefoon bereikbaar. Veronica haalt zelf niets van internet: alleen de telefoons doen de deelvragen.', stapels: [], uitslagen: [] }; }
      const stapels = verdeelStapel(lijst, tels).map((s) => ({ telefoon: s.telefoon.id, naam: `${s.telefoon.naam || s.telefoon.id}${s.telefoon.brief ? ' (via de brievenbus)' : ''}`, termen: s.termen, klaar: 0, bezig: null }));
      const uitslagen = [];
      const stand = () => ({ stapels: stapels.map((s) => Object.assign({}, s, { termen: s.termen.slice() })), klaar: uitslagen.length, totaal: lijst.length });
      const gestopt = () => !!(op.stop && op.stop());
      await Promise.all(stapels.map(async (s) => {
        for (const term of s.termen) {
          if (gestopt()) break;
          s.bezig = term;
          let u;
          try { u = await zoek(term, { soort: op.soort, taal: op.taal, telefoon: s.telefoon }); } catch (e) { u = { ok: false, zin: 'Zoeken lukte niet.' }; }
          s.bezig = null; s.klaar += 1;
          uitslagen.push({ term, telefoon: s.naam, uitslag: u });
          if (typeof op.opVoortgang === 'function') { try { op.opVoortgang(stand()); } catch (e) { /* alleen weergave */ } }
        }
      }));
      // De uitslag in de volgorde van de lijst, niet van het binnenkomen.
      uitslagen.sort((a, b) => lijst.indexOf(a.term) - lijst.indexOf(b.term));
      return { ok: true, stapels: stand().stapels, uitslagen, gestopt: gestopt(), let_op: LET_OP };
    }
    return Object.freeze({ zoek, zoekStapel, tellers, kassa });
  }

  return { maak, poort, voegPerAdresSamen, verdeelStapel, leesStapel, STAPEL_MAX, STANDAARD_BRONNEN, SOORTEN, VERMELDING, LET_OP, REDEN };
}));
