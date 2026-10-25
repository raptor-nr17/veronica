// ===================================================================
// 562: EIGEN SEARXNG als eerste bron -- de regels, zonder netwerk
// ===================================================================
//
// SearXNG draait op de Linux-kant van de Chromebook (artemis/installeer.sh: `artemis-rek searxng`), met JSON-uitvoer aan en de
// bot-limiter uit (alleen ons eigen rek gebruikt hem). De telefoons en Onderzoek met de telefoons gebruiken hem als EERSTE bron,
// vóór de losse bronnen (Wikipedia, Marginalia, ...). Dit bestand is byte-identiek in JARVIS (www/) en Veronica (tools/veronica/).
//
// Vier regels, allemaal pure functies (geen fetch, geen opslag), zodat ze te toetsen zijn:
//  - priveHost(adres): alleen een PRIVÉ adres mag (deze computer, het eigen wifi, of Tailscale 100.64-127). Nooit een openbaar
//    adres: een eigen SearXNG hoort binnen het eigen netwerk, niet op internet. http mag hier (het is een privé-adres).
//  - zoekAdres(basis, term): het JSON-zoekadres. format=json, en een duidelijke taal.
//  - leesResultaten(json): de lijst {titel, tekst, url} uit het SearXNG-antwoord. De URL's gaan daarna door DEZELFDE bewaker als
//    altijd (alleen openbare https-links); SearXNG is maar de vindplaats, niet de bron die we vertrouwen.
//  - blokkerende(json): uit /stats welke zoekmachines BLOKKEREN (een foutpercentage of een melding). Voor het scherm van Veronica.
//
// De vorm van het SearXNG-antwoord is AANGENOMEN uit de SearXNG-documentatie (results[], /stats engines[]) en NIET live nagekeken
// vanuit de container; de eerste echte run op de Chromebook is de controle.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.SearxBron = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Privé-adres: loopback, RFC1918 (10/8, 172.16/12, 192.168/16) of Tailscale (100.64.x.x t/m 100.127.x.x). Nooit een openbaar adres.
  function priveHost(adres) {
    let u;
    try { u = new URL(String(adres)); } catch (e) { return false; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return true;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (!m) return false;
    const a = +m[1]; const b = +m[2];
    if ([a, b, +m[3], +m[4]].some((n) => n > 255)) return false;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;   // Tailscale CGNAT-bereik
    return false;
  }

  function basisSchoon(adres) {
    if (!priveHost(adres)) return null;
    return String(adres).replace(/\/+$/, '');
  }

  function zoekAdres(basis, term, taal) {
    const b = basisSchoon(basis);
    if (!b) return null;
    const t = String(term || '').trim();
    if (!t) return null;
    return `${b}/search?q=${encodeURIComponent(t)}&format=json&language=${encodeURIComponent(taal || 'nl')}&safesearch=1`;
  }

  function statsAdres(basis) {
    const b = basisSchoon(basis);
    return b ? `${b}/stats?format=json` : null;
  }

  function leesResultaten(json, max) {
    const lijst = json && Array.isArray(json.results) ? json.results : [];
    const uit = [];
    for (const r of lijst) {
      if (!r || typeof r.url !== 'string') continue;
      uit.push({
        titel: String(r.title || '').replace(/\s+/g, ' ').trim().slice(0, 400),
        tekst: String(r.content || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        url: r.url,
      });
      if (uit.length >= (max || 5)) break;
    }
    return uit;
  }

  // Uit /stats: welke zoekmachines blokkeren. SearXNG geeft per engine o.a. een naam, een foutpercentage en soms een
  // melding ("Access denied", "CAPTCHA", "Too many requests"). We noemen een engine "blokkeert" als er een fout-/blokmelding
  // staat, of het foutpercentage hoog is. Terug: [{ naam, reden }], gesorteerd op naam.
  function blokkerende(json) {
    const engines = json && Array.isArray(json.engines) ? json.engines : [];
    const uit = [];
    for (const e of engines) {
      if (!e || !e.name) continue;
      const fouten = Array.isArray(e.errors) ? e.errors.map((x) => String(x)).join('; ')
        : (e.error ? String(e.error) : '');
      const pct = Number(e.error_percentage != null ? e.error_percentage : e.errorPercentage);
      const blokkeert = /denied|captcha|blocked|too many|429|rate|forbidden|timeout/i.test(fouten) || (Number.isFinite(pct) && pct >= 50);
      if (blokkeert) uit.push({ naam: String(e.name), reden: fouten || (Number.isFinite(pct) ? `${Math.round(pct)}% fout` : 'blokkeert') });
    }
    uit.sort((a, b) => a.naam.localeCompare(b.naam));
    return uit;
  }

  // De bronvolgorde: staat er een eigen SearXNG-adres, dan 'searxng' VOORAAN, daarna de gewone bronnen (zonder dubbel).
  function bronVolgorde(basis, gewone) {
    const lijst = Array.isArray(gewone) ? gewone.slice() : [];
    if (basisSchoon(basis)) return ['searxng'].concat(lijst.filter((x) => x !== 'searxng'));
    return lijst.filter((x) => x !== 'searxng');
  }

  return { priveHost, basisSchoon, zoekAdres, statsAdres, leesResultaten, blokkerende, bronVolgorde };
}));
