// ===================================================================
// 678 (21 punten, stap 15 -> punt 10 "herinneringen met stem"): DE NEDERLANDSE DATUMPARSER. Zet gewone taal ("morgen om half 3",
// "volgende dinsdag", "over twee weken", "3 december om 9 uur") om in een tijdstip. PUUR rekenen: geen netwerk, geen model, geen
// opslag, geen DOM. Het model (E2B) vult straks alleen `{wat, wanneer_tekst}`; de HARDE datum maakt deze code, zodat een model
// NOOIT zelf een tijdstip verzint (zelfde §320-discipline als de gids-getallen). Een Android AlarmClock-/Calendar-intent (device)
// gebruikt de uitkomst; die intent zit NIET hier.
//
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site). Alles in Nederlandse tijd:
// de aanroeper geeft `nu` (ms) mee; de parser rekent in lokale tijd van de omgeving waarin hij draait (de Chromebook staat op NL).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Datumparser = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WEEKDAGEN = { zondag: 0, maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6 };
  const MAANDEN = {
    januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6, juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12,
    jan: 1, feb: 2, mrt: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, okt: 10, nov: 11, dec: 12,
  };
  const EENHEID_MIN = { minuut: 1, minuten: 1, min: 1, uur: 60, uren: 60, dag: 1440, dagen: 1440, week: 10080, weken: 10080 };
  const GETAL_WOORD = { een: 1, één: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8, negen: 9, tien: 10, elf: 11, twaalf: 12, kwart: 15, half: 30 };

  function getal(w) { if (w == null) return NaN; if (/^\d+$/.test(w)) return parseInt(w, 10); return GETAL_WOORD[w] != null ? GETAL_WOORD[w] : NaN; }

  // Leest een kloktijd uit de tekst. Geeft {uur, min} of null. Snapt: "om 15:00", "15.30", "9 uur", "half 3", "kwart over 8",
  // "kwart voor 9", en de dagdelen 's ochtends/'s middags/'s avonds/'s nachts (die een 12-uurs tijd verschuiven).
  function leesTijd(t) {
    let m;
    // kwart over / voor, half
    if ((m = t.match(/\bkwart\s+over\s+(\d{1,2}|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)\b/))) { const u = getal(m[1]); if (u >= 0) return pasDagdeel(t, { uur: u % 24, min: 15 }); }
    if ((m = t.match(/\bkwart\s+voor\s+(\d{1,2}|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)\b/))) { const u = getal(m[1]); if (u >= 0) return pasDagdeel(t, { uur: (u + 23) % 24, min: 45 }); }
    if ((m = t.match(/\bhalf\s+(\d{1,2}|een|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)\b/))) { const u = getal(m[1]); if (u >= 0) return pasDagdeel(t, { uur: (u + 23) % 24, min: 30 }); }
    // 15:00 / 15.30 / 15u30 / 9u
    if ((m = t.match(/\b(\d{1,2})[:.u](\d{2})\b/))) { const u = +m[1], mi = +m[2]; if (u < 24 && mi < 60) return pasDagdeel(t, { uur: u, min: mi }); }
    if ((m = t.match(/\bom\s+(\d{1,2})(?:\s*uur)?\b/)) || (m = t.match(/\b(\d{1,2})\s*uur\b/))) { const u = +m[1]; if (u < 24) return pasDagdeel(t, { uur: u, min: 0 }); }
    // dagdeel zonder getal
    if (/'s\s*ochtends|vanochtend|vanmorgen/.test(t)) return { uur: 9, min: 0 };
    if (/'s\s*middags|vanmiddag/.test(t)) return { uur: 14, min: 0 };
    if (/'s\s*avonds|vanavond/.test(t)) return { uur: 20, min: 0 };
    if (/'s\s*nachts|vannacht/.test(t)) return { uur: 23, min: 0 };
    return null;
  }
  // 's middags/'s avonds schuift een 1-12 tijd naar de PM-helft.
  function pasDagdeel(t, k) {
    if (/'s\s*middags|vanmiddag|'s\s*avonds|vanavond/.test(t) && k.uur >= 1 && k.uur <= 11) return { uur: k.uur + 12, min: k.min };
    return k;
  }

  function maakDatum(nu, jaar, maand1, dag, tijd) {
    const d = new Date(nu);
    d.setFullYear(jaar, maand1 - 1, dag);
    d.setHours(tijd ? tijd.uur : 9, tijd ? tijd.min : 0, 0, 0);   // zonder tijd: 09:00
    return d;
  }

  // parse(tekst, nu) -> { ms, heeftTijd, zeker, soort } of null.
  //   ms       = het tijdstip in ms (epoch), altijd in de TOEKOMST t.o.v. nu.
  //   heeftTijd= of er een kloktijd in stond (anders 09:00 als standaard).
  //   zeker    = false bij een relatieve dag zonder expliciete tijd (dan is 09:00 een gok).
  function parse(tekst, nu) {
    if (typeof tekst !== 'string' || !tekst.trim()) return null;
    const t = tekst.toLowerCase();
    nu = typeof nu === 'number' ? nu : Date.now();
    const tijd = leesTijd(t);
    let m;

    // "over N minuten/uur/dagen/weken"
    if ((m = t.match(/\bover\s+(\d+|een|één|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|elf|twaalf)\s+(minuut|minuten|min|uur|uren|dag|dagen|week|weken)\b/))) {
      const n = getal(m[1]); const per = EENHEID_MIN[m[2]];
      if (n >= 0 && per) {
        const ms = nu + n * per * 60000;
        const heeftTijd = per >= 1440 && !!tijd;   // bij dagen/weken kan er een aparte kloktijd bij staan
        if (per >= 1440 && tijd) { const d = new Date(ms); d.setHours(tijd.uur, tijd.min, 0, 0); return { ms: d.getTime(), heeftTijd: true, zeker: true, soort: 'over' }; }
        return { ms: ms, heeftTijd: per < 1440, zeker: true, soort: 'over' };
      }
    }

    // expliciete datum "3 december", "3 dec", "op 3 januari 2027"
    if ((m = t.match(/\b(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?\b/)) && MAANDEN[m[2]]) {
      const dag = +m[1], maand = MAANDEN[m[2]]; let jaar = m[3] ? +m[3] : new Date(nu).getFullYear();
      let d = maakDatum(nu, jaar, maand, dag, tijd);
      if (!m[3] && d.getTime() < nu) d = maakDatum(nu, jaar + 1, maand, dag, tijd);   // al voorbij -> volgend jaar
      if (!isNaN(d.getTime())) return { ms: d.getTime(), heeftTijd: !!tijd, zeker: true, soort: 'datum' };
    }
    // numerieke datum "3-12", "03/12/2026", "2026-12-03"
    if ((m = t.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) { const d = maakDatum(nu, +m[1], +m[2], +m[3], tijd); if (!isNaN(d.getTime())) return { ms: d.getTime(), heeftTijd: !!tijd, zeker: true, soort: 'datum' }; }
    if ((m = t.match(/\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\b/))) {
      const dag = +m[1], maand = +m[2]; if (maand >= 1 && maand <= 12 && dag >= 1 && dag <= 31) {
        let jaar = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : new Date(nu).getFullYear();
        let d = maakDatum(nu, jaar, maand, dag, tijd);
        if (!m[3] && d.getTime() < nu) d = maakDatum(nu, jaar + 1, maand, dag, tijd);
        if (!isNaN(d.getTime())) return { ms: d.getTime(), heeftTijd: !!tijd, zeker: true, soort: 'datum' };
      }
    }

    // vandaag / vanavond / vanmiddag (met of zonder tijd)
    if (/\b(vandaag|vanavond|vanmiddag|vanochtend|vanmorgen|vannacht)\b/.test(t)) {
      const d = new Date(nu); const k = tijd || leesTijd(t) || { uur: 9, min: 0 }; d.setHours(k.uur, k.min, 0, 0);
      if (d.getTime() < nu) d.setDate(d.getDate() + 1);   // al voorbij vandaag -> morgen zelfde tijd
      return { ms: d.getTime(), heeftTijd: !!tijd, zeker: !!tijd, soort: 'vandaag' };
    }
    // morgen / overmorgen
    if (/\bovermorgen\b/.test(t)) return relatieveDag(nu, 2, tijd);
    if (/\bmorgen\b/.test(t)) return relatieveDag(nu, 1, tijd);

    // weekdag: "maandag", "volgende/aanstaande dinsdag"
    for (const naam in WEEKDAGEN) {
      if (new RegExp('\\b' + naam + '\\b').test(t)) {
        const doel = WEEKDAGEN[naam]; const d = new Date(nu); const huidig = d.getDay();
        let delta = (doel - huidig + 7) % 7;
        const volgende = /\b(volgende|aanstaande|komende)\b/.test(t);
        if (delta === 0) delta = 7;                 // "maandag" op maandag = volgende maandag
        if (volgende && delta < 7) delta += 0;       // "volgende maandag" = de eerstvolgende (al gedekt)
        d.setDate(d.getDate() + delta);
        const k = tijd || { uur: 9, min: 0 }; d.setHours(k.uur, k.min, 0, 0);
        return { ms: d.getTime(), heeftTijd: !!tijd, zeker: !!tijd, soort: 'weekdag' };
      }
    }
    // alleen een kloktijd ("om 15:00") zonder dag -> vandaag, of morgen als al voorbij
    if (tijd) {
      const d = new Date(nu); d.setHours(tijd.uur, tijd.min, 0, 0);
      if (d.getTime() <= nu) d.setDate(d.getDate() + 1);
      return { ms: d.getTime(), heeftTijd: true, zeker: true, soort: 'tijd' };
    }
    return null;
  }

  function relatieveDag(nu, dagen, tijd) {
    const d = new Date(nu); d.setDate(d.getDate() + dagen);
    const k = tijd || { uur: 9, min: 0 }; d.setHours(k.uur, k.min, 0, 0);
    return { ms: d.getTime(), heeftTijd: !!tijd, zeker: !!tijd, soort: 'relatief' };
  }

  return { parse: parse, WEEKDAGEN: WEEKDAGEN, MAANDEN: MAANDEN };
}));
