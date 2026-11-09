// ===================================================================
// 678 (21 punten, punt 18 "meldingen voorlezen en sorteren"): zet een stapel meldingen op volgorde van belang en maak er één
// korte voorleeszin van. PUUR rekenen in CODE -- GEEN model, geen netwerk, geen opslag, geen DOM. Het belang komt uit een
// meegegeven prioriteit (ntfy-stijl 1..5) of, als die ontbreekt, uit vaste SIGNAALWOORDEN in de tekst (storing/leeg/oververhit =
// hoog; klaar/gelukt = laag). Nooit een model nodig: sorteren is rekenen, geen oordeel dat verzonnen kan worden.
//
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Meldingsorteer = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX = 200;
  const DUBBEL_MS = 5 * 60 * 1000;   // dezelfde tekst binnen vijf minuten = één melding
  const HOOG = ['storing', 'vast', 'offline', 'onbereikbaar', 'leeg', 'bijna leeg', 'oververhit', 'te warm', 'fout', 'mislukt', 'noodstop', 'geen verbinding', 'kwijt', 'crash', 'vol'];
  const LAAG = ['klaar', 'gereed', 'gelukt', 'voltooid', 'bijgewerkt', 'update klaar', 'aangemeld', 'verbonden'];

  function binnen(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // weeg(m) -> 1..5. Een meegegeven prioriteit wint; anders uit de signaalwoorden; anders 3 (midden).
  function weeg(m) {
    if (!m) return 3;
    if (typeof m.prioriteit === 'number' && isFinite(m.prioriteit)) return binnen(Math.round(m.prioriteit), 1, 5);
    const t = String(m.tekst || '').toLowerCase();
    if (HOOG.some((w) => t.indexOf(w) >= 0)) return 5;
    if (LAAG.some((w) => t.indexOf(w) >= 0)) return 2;
    return 3;
  }
  function belangrijk(m) { return weeg(m) >= 4; }

  // sorteer(meldingen, nu) -> een NIEUWE lijst, op belang (hoog eerst) en bij gelijk belang op tijd (nieuwste eerst). Lege tekst
  // valt eruit; exact dezelfde tekst binnen vijf minuten telt één keer (de nieuwste/belangrijkste blijft). Begrensd op MAX.
  function sorteer(meldingen, nu) {
    const lijst = (Array.isArray(meldingen) ? meldingen : []).filter((m) => m && String(m.tekst || '').trim()).slice(0, MAX);
    const verrijkt = lijst.map((m, i) => ({ m: m, w: weeg(m), t: typeof m.tijd === 'number' ? m.tijd : 0, i: i }));
    // ontdubbelen op tekst binnen DUBBEL_MS: houd de hoogste weging, dan de nieuwste
    const perTekst = new Map();
    for (const e of verrijkt) {
      const sleutel = String(e.m.tekst).trim().toLowerCase();
      const b = perTekst.get(sleutel);
      if (!b) { perTekst.set(sleutel, e); continue; }
      if (Math.abs(e.t - b.t) <= DUBBEL_MS) { if (e.w > b.w || (e.w === b.w && e.t > b.t)) perTekst.set(sleutel, e); }
      else perTekst.set(sleutel + '#' + e.i, e);   // ver uit elkaar: aparte meldingen
    }
    const uniek = [...perTekst.values()];
    uniek.sort((a, b) => b.w - a.w || b.t - a.t || a.i - b.i);
    return uniek.map((e) => e.m);
  }

  // telling(meldingen) -> { totaal, belangrijk } op de gesorteerde/ontdubbelde lijst.
  function telling(meldingen, nu) {
    const s = sorteer(meldingen, nu);
    return { totaal: s.length, belangrijk: s.filter((m) => belangrijk(m)).length };
  }

  // voorleesTekst(meldingen, nu) -> één korte zin om voor te lezen; de belangrijkste eerst, met de bron als die er is.
  function voorleesTekst(meldingen, nu) {
    const s = sorteer(meldingen, nu);
    if (!s.length) return 'Geen nieuwe meldingen.';
    const nb = s.filter((m) => belangrijk(m)).length;
    const top = s[0];
    const bron = top.bron ? String(top.bron).trim() : '';
    const kop = bron ? `${bron}: ${top.tekst}` : String(top.tekst);
    if (s.length === 1) return `Eén melding. ${kop}`;
    const belang = nb ? `, waarvan ${nb} belangrijk` : '';
    return `${s.length} meldingen${belang}. De belangrijkste: ${kop}`;
  }

  return { weeg: weeg, belangrijk: belangrijk, sorteer: sorteer, telling: telling, voorleesTekst: voorleesTekst, HOOG: HOOG, LAAG: LAAG, MAX: MAX };
}));
