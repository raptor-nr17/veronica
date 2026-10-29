// ===================================================================
// Telefoon-besturingssysteem -- de kern voor "op iedere telefoon een andere site" (opzet: docs/telefoon-besturingssysteem.md)
// ===================================================================
//
// PURE logica, geen DOM en geen netwerk: de besturen-pagina (besturen.html) gebruikt dit om op EEN telefoon een webadres te
// openen, in zijn EIGEN browserprofiel, zodat sites elkaar en de rest van het systeem niet kunnen raken. De veiligheidsregels
// zijn dezelfde als bij ARTEMIS: bank-, kluis-, betaal-, authenticator- en crypto-sites worden NOOIT geopend.
//
// Dit is stap 2 van de opzet (de site per telefoon). Stap 1 (alle schermen kijken, ook in de privé-hoek) en stap 3 (bedienen)
// bouwen hierop voort. Niets hiervan opent iets uit zichzelf -- de besturen-pagina roept openSiteOpdracht aan na een tik.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Telefoonsite = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // bank/kluis/betaal/authenticator/crypto -- NOOIT openen (zelfde woorden als de vangnet-proxy VERBODEN_APP).
  const VERBODEN = /(\bbank\b|abn|amro|rabo|\bing\b|\bsns\b|\basn\b|bunq|regiobank|knab|revolut|wise|paypal|tikkie|ideal|creditcard|master ?card|\bvisa\b|betaal|payment|google ?pay|apple ?pay|\bwallet\b|authenticator|\bauthy\b|2fa|\botp\b|bitwarden|lastpass|1password|keepass|dashlane|wachtwoord|password|\bvault\b|kluis|digid|crypto|coinbase|binance|kraken|metamask|ledger|trezor|bitcoin|ethereum|blockchain|\bbtc\b|\beth\b)/i;

  // Een getypt adres opschonen en keuren. Geeft { ok:true, url } of { ok:false, reden } -- de reden is altijd een gewone zin.
  function veiligeUrl(invoer) {
    let s = String(invoer || '').trim();
    if (!s) return { ok: false, reden: 'Geef een webadres op.' };
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
      // geen schema: als het op een domein lijkt, https:// ervoor; anders is het geen adres.
      if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#]|$)/i.test(s)) s = 'https://' + s;
      else return { ok: false, reden: 'Dat is geen webadres.' };
    }
    let u;
    try { u = new URL(s); } catch (e) { return { ok: false, reden: 'Dat is geen geldig adres.' }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reden: 'Alleen gewone http- of https-adressen.' };
    let pad = u.pathname + ' ' + u.search;
    try { pad = decodeURIComponent(pad); } catch (e) { /* laat staan */ }
    if (VERBODEN.test(u.hostname) || VERBODEN.test(pad)) {
      return { ok: false, reden: 'Bank-, kluis-, betaal-, inlog- en crypto-sites worden hier nooit geopend.' };
    }
    return { ok: true, url: u.href };
  }

  // Elk toestel een EIGEN, vast browserprofiel (zodat sites elkaar en de rest niet raken). Afgeleid van het serienummer, stabiel.
  function profielVoor(serial) {
    let h = 5381; const s = 'tel:' + String(serial || '');
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h + s.charCodeAt(i)) >>> 0);
    return 'veronica-tel-' + h.toString(16).padStart(8, '0');
  }

  // De adb-opdracht om een site te openen op EEN telefoon (de besturen-pagina voert hem uit via de WebUSB-adb van die telefoon).
  // -d <url> met de VIEW-intent; een vaste browser per telefoon mag meegegeven worden (dan opent hij altijd in dezelfde browser,
  // met zijn eigen profiel). Geeft { ok:false, reden } als het adres niet mag -- dan wordt er NIETS verstuurd.
  function openSiteOpdracht(serial, invoer, opties) {
    const o = opties || {};
    const v = veiligeUrl(invoer);
    if (!v.ok) return { ok: false, reden: v.reden };
    if (!serial) return { ok: false, reden: 'Geen telefoon gekozen.' };
    const argv = ['-s', String(serial), 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', v.url];
    if (o.browserPakket) argv.push(String(o.browserPakket));
    return { ok: true, url: v.url, profiel: profielVoor(serial), argv };
  }

  return { VERBODEN, veiligeUrl, profielVoor, openSiteOpdracht };
}));
