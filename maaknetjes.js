// ===================================================================
// 678 (21 punten, stap 12 -> punt 5 "maak mijn bericht netjes"): een tekst NETJES maken (alleen spelling + zinsbouw), met een
// VERSCHILWEERGAVE naast het origineel en een harde regel dat de BETEKENIS niet verandert. PUUR rekenen: geen netwerk, geen model,
// geen opslag, geen DOM. Het model (Gemma 4 E2B) krijgt de vaste prompt uit `maakPrompt`; deze code bouwt het verschil en bewaakt
// met `veilig()` dat de "nette" versie niet stiekem iets toevoegt of weglaat (getallen, bedragen, e-mail/URL, veel langer/korter).
// NOOIT automatisch versturen: deze code stuurt niets; ze levert alleen het verschil + een oordeel, de eigenaar beslist.
//
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Maaknetjes = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_TEKENS = 4000;

  // De vaste prompt. Alleen spelling + zinsbouw; betekenis, feiten en toon NIET veranderen; niets toevoegen of weglaten; ÉÉN uitkomst.
  function maakPrompt(tekst) {
    return 'Je verbetert ALLEEN de spelling en de zinsbouw van het volgende bericht. Verander de BETEKENIS niet, voeg niets toe en '
      + 'laat niets weg; houd dezelfde taal en toon; verander geen getallen, bedragen, namen, e-mailadressen of links. Geef UITSLUITEND '
      + 'de verbeterde tekst terug, zonder uitleg.\n\nBericht:\n' + String(tekst == null ? '' : tekst).slice(0, MAX_TEKENS);
  }

  function woorden(t) { return String(t == null ? '' : t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(Boolean); }
  // "inhoudswoorden" = de dingen die de betekenis dragen en NIET mogen veranderen: getallen, bedragen, e-mail, URL.
  function harde(t) {
    const s = String(t == null ? '' : t);
    const uit = [];
    const re = /(\d+(?:[.,]\d+)*\s*(?:euro|eur|€|%|uur|km|m|dagen|dag|weken|week)?|[\w.+-]+@[\w.-]+\.\w+|https?:\/\/[^\s)]+)/giu;
    let m; while ((m = re.exec(s))) uit.push(m[0].toLowerCase().replace(/\s+/g, ''));
    return uit.sort();
  }

  // veilig(origineel, netjes) -> { ok, reden }. ok:false als de "nette" versie de betekenis lijkt te raken: andere harde feiten
  // (getallen/bedragen/mail/URL), of veel langer/korter (meer dan de helft erbij/eraf in woorden). Dan toont de app het ORIGINEEL.
  function veilig(origineel, netjes) {
    const o = String(origineel == null ? '' : origineel).trim();
    const n = String(netjes == null ? '' : netjes).trim();
    if (!n) return { ok: false, reden: 'leeg' };
    if (n.length > MAX_TEKENS) return { ok: false, reden: 'te lang' };
    const ho = harde(o).join('|'), hn = harde(n).join('|');
    if (ho !== hn) return { ok: false, reden: 'harde feiten (getal/bedrag/mail/link) veranderd' };
    const wo = woorden(o).length, wn = woorden(n).length;
    if (wo >= 4 && (wn > wo * 1.5 || wn < wo * 0.5)) return { ok: false, reden: 'te veel toegevoegd of weggelaten' };
    return { ok: true, reden: '' };
  }

  // Een woord-voor-woord verschil (LCS) voor de weergave naast het origineel. Elk stuk: {soort:'zelfde'|'weg'|'bij', tekst}.
  // Begrensd op MAX_WOORDEN; daarboven geen fijn verschil (dan toont de app gewoon beide teksten naast elkaar).
  const MAX_WOORDEN = 1200;
  function verschil(origineel, netjes) {
    const a = tokens(origineel), b = tokens(netjes);
    if (a.length > MAX_WOORDEN || b.length > MAX_WOORDEN) return null;
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i].toLowerCase() === b[j].toLowerCase() ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const uit = []; let i = 0, j = 0;
    const duw = (soort, tekst) => { const l = uit[uit.length - 1]; if (l && l.soort === soort) l.tekst += tekst; else uit.push({ soort: soort, tekst: tekst }); };
    while (i < n && j < m) {
      if (a[i].toLowerCase() === b[j].toLowerCase()) { duw('zelfde', b[j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { duw('weg', a[i]); i++; }
      else { duw('bij', b[j]); j++; }
    }
    while (i < n) { duw('weg', a[i]); i++; }
    while (j < m) { duw('bij', b[j]); j++; }
    return uit;
  }
  function tokens(t) { return String(t == null ? '' : t).match(/\s+|[^\s]+/g) || []; }

  return { maakPrompt: maakPrompt, veilig: veilig, verschil: verschil, harde: harde, MAX_TEKENS: MAX_TEKENS };
}));
