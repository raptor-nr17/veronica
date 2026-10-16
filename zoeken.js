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

  // o: { haal(url, init, ms) -> Response (Veronica's eigen), telefoons() -> [{ id, naam, host }], code() -> koppelcode, wacht?, nu? }
  function maak(o) {
    if (!o || typeof o.haal !== 'function' || typeof o.telefoons !== 'function' || typeof o.code !== 'function') throw new Error('VeronicaZoek.maak: haal, telefoons en code zijn nodig');
    const kassa = ZoekKassa.maakKassa({ nu: o.nu });
    const tellers = { vragen: 0, geweigerd: 0, zonderTelefoon: 0 };
    // De ophaler voor zoekmulti.js: ALLEEN de deelvraag-route van een telefoon. Alles anders (rechtstreeks internet) = geen verbinding.
    const http = async (r) => {
      const m = /^http:\/\/([^/:]+):8080\/jarvis\/zoek-deel$/.exec(String((r && r.url) || ''));
      if (!m) return { status: 0, data: null };
      const antw = await o.haal(r.url, { method: 'POST', headers: r.headers || {}, body: JSON.stringify(r.data || {}) }, (r.readTimeout || 16000) + (r.connectTimeout || 2500));
      return { status: antw.status, data: await antw.text() };
    };
    const multi = ZoekMulti.maakMultiZoeker({
      http, bewaker, kassa, kassaModule: ZoekKassa, zoekmodule: PriveZoek,
      telefoons: () => o.telefoons().map((t) => ({ id: t.id, lokaal: false, host: t.host })),
      code: () => o.code(), wacht: o.wacht,
    });

    async function zoek(vraag, opties) {
      const p = poort(vraag);
      if (!p.toegestaan) { tellers.geweigerd += 1; return { ok: false, geweigerd: true, code: p.code, zin: p.reden, let_op: LET_OP }; }
      const tels = o.telefoons();
      if (!tels.length) { tellers.zonderTelefoon += 1; return { ok: false, zin: 'Geen telefoon bereikbaar. Veronica haalt zelf niets van internet: alleen de telefoons doen de deelvragen.', let_op: LET_OP }; }
      if (!o.code()) return { ok: false, zin: 'Koppel Veronica eerst met de hoofdtelefoon.', let_op: LET_OP };
      tellers.vragen += 1;
      const u = await multi.zoek(p.term, { bronnen: (opties && opties.bronnen) || STANDAARD_BRONNEN, taal: (opties && opties.taal) || 'nl', zonderLokaal: true });
      const naam = new Map(tels.map((t) => [t.id, t.naam || t.id]));
      const delen = (u.bronnen || []).map((b) => ({
        bron: b.bron, naam: (PriveZoek.BRONNEN[b.bron] || {}).naam || b.bron, ok: !!b.ok, uitGeheugen: !!b.uitCache, telefoon: b.telefoon ? (naam.get(b.telefoon) || b.telefoon) : null,
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
      return { ok: true, term: p.term, delen, samengevoegd, aantal: samengevoegd.length, meldingen: u.meldingen || [], zin, opAnderen, let_op: LET_OP };
    }
    return Object.freeze({ zoek, tellers, kassa });
  }

  return { maak, poort, voegPerAdresSamen, STANDAARD_BRONNEN, LET_OP, REDEN };
}));
