// ===================================================================
// 678 (14 nov): DE STEM VAN HET REK. Veronica laat een antwoord voorlezen door de telefoon met de rol bibliothecaris, als zijn stem
// (Piper via sherpa-onnx, JARVIS 1.9.95+, poort 8082) klaarstaat. Zo niet, dan blijft het de lokale stem van deze computer.
// Alleen over het EIGEN wifi (een privé-adres), met de rij-code; nooit voor de privé-hoek (privé-inhoud gaat niet over wifi).
// PUUR: geen netwerk, geen opslag, geen DOM. Het verzoek doet veronica.js.
// Afspraak: geen merk, persoon of plaats in dit bestand (het gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Stemrek = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const POORT = 8082;
  const KLAAR_VERS_MS = 3 * 60 * 1000;   // een "klaar" van /health geldt drie minuten
  const MAX_TEKST = 4000;

  // Alleen een adres in een privé-netwerk (10/8, 172.16/12, 192.168/16) -- nooit iets op internet.
  function privéAdres(host) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host || ''));
    if (!m) return false;
    const a = m.slice(1).map(Number);
    if (a.some((x) => x > 255)) return false;
    return a[0] === 10 || (a[0] === 172 && a[1] >= 16 && a[1] <= 31) || (a[0] === 192 && a[1] === 168);
  }

  // basis(jarvis): van het JARVIS-adres (http://ip:8080) naar de spraakserver op dezelfde telefoon (http://ip:8082), of null.
  function basis(jarvis) {
    const m = /^http:\/\/([0-9.]+):\d+\/?$/.exec(String(jarvis || ''));
    return m && privéAdres(m[1]) ? `http://${m[1]}:${POORT}` : null;
  }

  // kies(telefoons, rolVan): de spraakserver van de telefoon met de rol bibliothecaris. telefoons = [{ id, jarvis }].
  function kies(telefoons, rolVan) {
    for (const t of Array.isArray(telefoons) ? telefoons : []) {
      if (!t || !t.id || typeof rolVan !== 'function' || rolVan(t.id) !== 'bibliothecaris') continue;
      const b = basis(t.jarvis);
      if (b) return { id: t.id, basis: b };
    }
    return null;
  }

  // klaar(health, t, nu): staat de stem klaar volgens een /health-antwoord dat niet ouder is dan KLAAR_VERS_MS?
  function klaar(health, t, nu) {
    return !!(health && health.stem === 'klaar' && typeof t === 'number' && nu - t <= KLAAR_VERS_MS);
  }

  // mag(profiel): de privé-hoek nooit (privé-inhoud gaat niet over wifi); de butler wel.
  function mag(profiel) { return !(profiel && profiel.rol === 'prive'); }

  function zegLijf(tekst) { return JSON.stringify({ tekst: String(tekst == null ? '' : tekst).slice(0, MAX_TEKST) }); }

  return { POORT, KLAAR_VERS_MS, privéAdres, basis, kies, klaar, mag, zegLijf };
}));
