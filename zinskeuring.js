// ===================================================================
// 678 (21 punten, stap 16, het nachtwerk voor de gids: "tekstkeuring PER ZIN, gesteund door de bron ja/nee"). Een concept (een vertaling of
// een herschreven verhaal) wordt in zinnen geknipt; per zin kijkt de CODE of de getallen en de eigennamen erin ook in de bron staan. Een zin
// met een getal of naam die NIET in de bron staat krijgt "geen steun" met de reden. Dat is precies de fout die een klein model maakt
// (een verzonnen jaartal, een verkeerde plaats). De keuring BESLIST niets: hij wijst de mens bij het nalezen op de zinnen om op te letten.
// PUUR: geen netwerk, geen opslag, geen DOM, geen model.
//
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Zinskeuring = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const tekst = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
  // zinnen(t): knippen op . ! ? gevolgd door een spatie en een hoofdletter/cijfer/aanhalingsteken; een afkorting met een kleine letter erna blijft heel.
  function zinnen(t) {
    return tekst(t).replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=["'“‘(]?[A-Z0-9À-Ý])/).map((z) => z.trim()).filter(Boolean);
  }
  // getallen: 1969, 9,95, 1.200 -> genormaliseerd zonder duizendtal-punt en met een punt als komma
  function getallen(t) {
    return (tekst(t).match(/\d+(?:[.,]\d+)*/g) || []).map((g) => g.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  }
  // eigennamen: woorden met een hoofdletter die NIET aan het begin van de zin staan (een zin begint altijd met een hoofdletter).
  function namen(zin) {
    const w = tekst(zin).replace(/["'“”‘’()]/g, ' ').split(/\s+/).filter(Boolean);
    const uit = [];
    for (let i = 1; i < w.length; i++) {
      const s = w[i].replace(/[.,;:!?]+$/, '');
      if (/^[A-ZÀ-Ý][a-zà-ÿ'-]{2,}$/.test(s) && !/[.!?]$/.test(w[i - 1])) uit.push(s);
    }
    return uit;
  }
  const norm = (s) => tekst(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // keur(bron, concept) -> [{ zin, steun, reden }]. steun = alle getallen en namen uit de zin staan in de bron.
  function keur(bron, concept) {
    const b = norm(bron); const bg = new Set(getallen(bron));
    return zinnen(concept).map((zin) => {
      const misG = getallen(zin).filter((g) => !bg.has(g));
      const misN = namen(zin).filter((n) => b.indexOf(norm(n)) < 0);
      const r = [];
      if (misG.length) r.push(`getal${misG.length > 1 ? 'len' : ''} ${misG.join(', ')} niet in de bron`);
      if (misN.length) r.push(`naam ${misN.join(', ')} niet in de bron`);
      return { zin, steun: !r.length, reden: r.join('; ') };
    });
  }
  // samenvatting(uitslag) -> een korte zin voor het nalezen ("2 van de 9 zinnen: let op") of '' als alles steun heeft.
  function samenvatting(uitslag) {
    const u = Array.isArray(uitslag) ? uitslag : [];
    const mis = u.map((x, i) => ({ x, i })).filter((y) => !y.x.steun);
    if (!mis.length) return '';
    return `Let op bij ${mis.length} van de ${u.length} zinnen: ` + mis.slice(0, 4).map((y) => `zin ${y.i + 1} (${y.x.reden})`).join('; ') + (mis.length > 4 ? '; ...' : '') + '.';
  }
  return { zinnen, getallen, namen, keur, samenvatting };
}));
