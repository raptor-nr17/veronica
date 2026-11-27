// 678/102 (27 nov, eigenaar): "gebruik de F8 ook in het rek, maar alleen onder strenge voorwaarden: alleen als hij bij het rek staat, aan
// de oplader ligt en de temperatuur onder de veilige grens blijft; wordt hij te warm of komt hij van de lader, dan meteen stoppen en uit de
// trap halen. De F8 blijft nooit baas of bestuurd."
// DE POORT VAN DE F8 -- puur, geen netwerk, geen opslag. Dezelfde regel staat in de waakhond van ARTEMIS (f8_poort in artemis-rek); die
// geeft zijn oordeel op /f8.json, en Veronica laat de F8 alleen meedoen als ARTEMIS EN deze regel allebei ja zeggen.
//  - aan de lader (laadt in de hartslag);
//  - bij het rek: hetzelfde wifi-net (/24) als minstens een rektelefoon met een verse hartslag. Tailscale alleen telt NIET: dat werkt ook
//    van ver weg;
//  - koel: de accutemperatuur uit de hartslag. Instappen tot en met TEMP_START, stoppen zodra hij boven TEMP_STOP komt (de marge
//    ertussen voorkomt aan-uit-aan). De CHIPtemperatuur staat niet in de hartslag; die telt pas mee als JARVIS hem meestuurt;
//  - een verse hartslag (hoogstens VERS_MS oud): geen meting = niet mee.
// Wat de F8 doet als hij meedoet: rekenwerk (tekst schrijven) in de rij. NOOIT bestuurd, NOOIT baas, NOOIT via adb.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.F8Poort = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TEMP_START = 37;            // °C accu: hoogstens dit om in te stappen
  const TEMP_STOP = 38;             // °C accu: daarboven meteen eruit (dezelfde grens als het gast-brein en de beheerronde)
  const VERS_MS = 3 * 60 * 1000;    // een hartslag ouder dan dit telt niet
  const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const TS = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;
  function netVan(h) {
    if (!h) return null;
    const l = h.locatie || h.plek;
    const m = l && typeof l.net === 'string' ? /^(\d+\.\d+\.\d+)(\.\d+)?(\/24)?$/.exec(l.net) : null;
    if (m && !TS.test(m[1] + '.')) return m[1];
    for (const a of (Array.isArray(h.adressen) ? h.adressen : [])) {
      if (typeof a === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(a) && !TS.test(a)) return a.split('.').slice(0, 3).join('.');
    }
    return null;
  }
  const vers = (h, nu) => { const t = getal(h && h.t); return t !== null && nu - t <= VERS_MS && nu - t >= -60000; };
  // f8: zijn hartslag; rek: de hartslagen van de rektelefoons; vorigMag: mocht hij bij de vorige keer (voor de marge); nu: ms.
  // -> { mag, reden }
  function beoordeel(f8, rek, vorigMag, nu) {
    const n = getal(nu) || Date.now();
    if (!f8 || f8.dagelijks !== true) return { mag: false, reden: 'geen hartslag van de F8' };
    if (!vers(f8, n)) return { mag: false, reden: 'de hartslag van de F8 is niet vers' };
    if (f8.laadt !== true) return { mag: false, reden: 'de F8 ligt niet aan de lader' };
    const temp = getal(f8.temp);
    if (temp === null) return { mag: false, reden: 'de temperatuur van de F8 is onbekend' };
    const grens = vorigMag === true ? TEMP_STOP : TEMP_START;
    if (temp > grens) return { mag: false, reden: `de F8 is te warm (${Math.round(temp * 10) / 10} °C, grens ${grens} °C)` };
    const eigen = netVan(f8);
    if (!eigen) return { mag: false, reden: 'het wifi-net van de F8 is onbekend' };
    const rekNetten = (Array.isArray(rek) ? rek : []).filter((h) => h && h.dagelijks !== true && vers(h, n)).map(netVan).filter(Boolean);
    if (!rekNetten.includes(eigen)) return { mag: false, reden: 'de F8 staat niet bij het rek (ander wifi-net)' };
    return { mag: true, reden: `aan de lader, bij het rek, ${Math.round(temp * 10) / 10} °C` };
  }
  return { TEMP_START, TEMP_STOP, VERS_MS, netVan, beoordeel };
}));
