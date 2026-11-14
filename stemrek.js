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

  // ---- HET OOR VAN HET REK (14 nov): de telefoon met de rol brein verstaat een opname (Whisper via sherpa-onnx, POST /luister op 8082,
  // een PCM16 mono WAV van 16 kHz). Zelfde regels als de stem: alleen een privé-adres, met de rij-code, en alleen als /health "klaar" zegt.
  const MAX_WAV = 4000000;   // de grens van de telefoon (JarvisSpraakKern.MAX_LUISTER_LIJF)
  function kiesRol(telefoons, rolVan, rol) {
    for (const t of Array.isArray(telefoons) ? telefoons : []) {
      if (!t || !t.id || typeof rolVan !== 'function' || rolVan(t.id) !== rol) continue;
      const b = basis(t.jarvis);
      if (b) return { id: t.id, basis: b };
    }
    return null;
  }
  function kiesOor(telefoons, rolVan) { return kiesRol(telefoons, rolVan, 'brein'); }
  function oorKlaar(health, t, nu) {
    return !!(health && health.oor === 'klaar' && typeof t === 'number' && nu - t <= KLAAR_VERS_MS);
  }
  // wavPast(wav): een WAV die de telefoon aanneemt (RIFF-kop, niet leeg, niet boven de grens).
  function wavPast(wav) {
    const n = wav && typeof wav.byteLength === 'number' ? wav.byteLength : -1;
    if (n <= 44 || n > MAX_WAV) return false;
    const b = new Uint8Array(wav.buffer || wav, wav.byteOffset || 0, 4);
    return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
  }
  // leesVersta(antwoord): de verstane tekst uit {"tekst": "..."}, of null. Lege tekst = niets verstaan (geen fout).
  function leesVersta(antwoord) {
    let d = antwoord;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return null; } }
    if (!d || typeof d.tekst !== 'string') return null;
    return d.tekst.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEKST);
  }

  return { POORT, KLAAR_VERS_MS, MAX_WAV, privéAdres, basis, kies, klaar, mag, zegLijf, kiesOor, oorKlaar, wavPast, leesVersta };
}));
