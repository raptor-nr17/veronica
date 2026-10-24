// ===================================================================
// 544 (Klus B): DE GEHEUGEN-TELEFOON -- de regels, zonder scherm, zonder netwerk en zonder opslag
// ===================================================================
//
// Eén rektelefoon met veel vrije ruimte bewaart wat de anderen samen gebruiken: het geheugen van Mijn-AI (ALLEEN versleuteld), het
// kennisboek, de modelbestanden (de uitdeelkast voor een nieuwe telefoon) en een voorraad zoekresultaten. De andere telefoons lezen
// en schrijven er via het eigen wifi (poort 8080, /jarvis/kast/..., alleen met de rij-code). Veronica zet er elke nacht een
// versleutelde kopie van op het kaartje van de Chromebook.
//
// WIE het is, rekent elke telefoon met DEZE functie uit, met wat hij van de anderen weet (de hartslagen): dan zijn ze het altijd eens.
//  - nooit de dagelijkse telefoon, nooit een zandbak, nooit een telefoon in noodstop of in sparen;
//  - een telefoon die een MENS als geheugen-telefoon aanwees (in Veronica) gaat voor, zolang hij meedoet;
//  - anders: aan de lader, de meeste VRIJE RUIMTE (minstens MIN_VRIJ_GB), dan het toestel-id (altijd een vaste winnaar);
//  - de huidige geheugen-telefoon houdt de rol zolang een ander niet duidelijk meer ruimte heeft (MARGE_GB): zo springt de rol niet
//    heen en weer bij elke foto die iemand maakt.
// De geheugen-telefoon rekent als LAATSTE in de rij: zijn werk is bewaren, en rekenen maakt hem warm en traag.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.GeheugenTel = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_VRIJ_GB = 32;
  const MARGE_GB = 16;
  const VERS_MS = 15 * 60 * 1000;
  // Wat er bewaard mag worden, met een plafond per soort (in bytes). Een voorraad zoekresultaten ruimt zelf de oudste op; de rest
  // weigert boven het plafond (liever een eerlijke weigering dan stil iets van de eigenaar weggooien).
  const SOORTEN = Object.freeze({
    geheugen: { max: 64 * 1024 * 1024, opruimen: false, versleuteld: true },
    kennisboek: { max: 256 * 1024 * 1024, opruimen: false, versleuteld: false },
    zoekcache: { max: 512 * 1024 * 1024, opruimen: true, versleuteld: false },
    modellen: { max: 8 * 1024 * 1024 * 1024, opruimen: false, versleuteld: false },
  });
  // Het geheugen van Mijn-AI komt alleen VERSLEUTELD aan (met de sleutel van de privé-hoek, privepost.js). De telefoon kan dat niet
  // nakijken, maar weigert wel alles wat niet met dit merkteken begint: zo belandt er nooit per ongeluk een leesbare tekst.
  const VERSLEUTELD_MERK = 'VPHG1:';
  const NAAM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  const goedeNaam = (n) => typeof n === 'string' && NAAM_RE.test(n) && !n.includes('..') && !n.endsWith('.part');
  const goedeSoort = (s) => Object.prototype.hasOwnProperty.call(SOORTEN, s);
  const getal = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

  // Doet deze hartslag mee als kandidaat? (de hartslag van hartslag.js, of een eigen kandidaat in dezelfde vorm)
  function kanBewaren(h, nu) {
    if (!h || !h.id) return false;
    if (typeof h.t === 'number' && nu - h.t > VERS_MS) return false;
    if (h.dagelijks || h.zandbak || h.pauze || h.sparen) return false;
    return (getal(h.vrij) || 0) >= MIN_VRIJ_GB;
  }
  // kies(harten, { nu, gekozen, huidige }) -> id of null. gekozen = de keuze van een mens (toestel-id), huidige = wie het nu is.
  function kies(harten, o) {
    const x = o || {};
    const nu = typeof x.nu === 'number' ? x.nu : Date.now();
    const l = (Array.isArray(harten) ? harten : []).filter((h) => kanBewaren(h, nu));
    if (!l.length) return null;
    if (x.gekozen) { const g = l.find((h) => h.id === x.gekozen); if (g) return g.id; }
    const vrij = (h) => getal(h.vrij) || 0;
    l.sort((a, b) => (b.laadt === true ? 1 : 0) - (a.laadt === true ? 1 : 0) || vrij(b) - vrij(a) || String(a.id).localeCompare(String(b.id)));
    const beste = l[0];
    const nuH = x.huidige && l.find((h) => h.id === x.huidige);
    if (nuH && nuH.id !== beste.id && (nuH.laadt === true || beste.laadt !== true) && vrij(beste) - vrij(nuH) < MARGE_GB) return nuH.id;
    return beste.id;
  }
  // Mag dit bestand erbij? bestaand = bytes die al in deze soort staan (zonder het bestand zelf), grootte = het nieuwe bestand.
  // terug { ok, opruimen (bytes die eerst weg moeten, alleen bij de zoekvoorraad), zin }
  function magBewaren(soort, naam, grootte, bestaand, begin) {
    if (!goedeSoort(soort)) return { ok: false, zin: 'Onbekende soort.' };
    if (!goedeNaam(naam)) return { ok: false, zin: 'Onbekende naam.' };
    const s = SOORTEN[soort];
    const n = Number(grootte) || 0;
    if (!(n > 0)) return { ok: false, zin: 'Leeg bestand.' };
    if (n > s.max) return { ok: false, zin: 'Te groot voor deze soort.' };
    if (s.versleuteld && String(begin || '').slice(0, VERSLEUTELD_MERK.length) !== VERSLEUTELD_MERK) return { ok: false, zin: 'Alleen versleuteld.' };
    const over = (Number(bestaand) || 0) + n - s.max;
    if (over > 0 && !s.opruimen) return { ok: false, zin: 'De plek voor deze soort is vol.' };
    return { ok: true, opruimen: over > 0 ? over : 0, zin: '' };
  }
  // De naam van een zoekresultaat in de voorraad: een korte vingerafdruk van bron + vraag (geen vraag in de bestandsnaam).
  function zoekNaam(bron, vraag) {
    let h = 0x811c9dc5;
    const t = `${String(bron || '')}\u0000${String(vraag || '').trim().toLowerCase()}`;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    let h2 = 0x9747b28c;
    for (let i = t.length - 1; i >= 0; i--) { h2 ^= t.charCodeAt(i); h2 = Math.imul(h2, 0x01000193) >>> 0; }
    return `z-${h.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}.json`;
  }
  // Een zoekresultaat is een dag goed; daarna zoekt de telefoon opnieuw.
  const ZOEK_GELDIG_MS = 24 * 60 * 60 * 1000;
  // De nacht van Veronica: tussen 2 en 5 uur, een keer per kalenderdag.
  function nachtKopieNu(nu, laatsteDag) {
    const d = new Date(nu);
    const dag = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { nu: d.getHours() >= 2 && d.getHours() < 5 && laatsteDag !== dag, dag };
  }
  function zin(id, harten, zelfId) {
    if (!id) return 'Geen geheugen-telefoon: geen rektelefoon met genoeg vrije ruimte aan de lader.';
    const h = (harten || []).find((x) => x && x.id === id);
    const naam = (h && h.naam) || 'een telefoon';
    const vrij = h && getal(h.vrij) !== null ? `, ${Math.round(h.vrij)} GB vrij` : '';
    return id === zelfId ? `Ik ben de geheugen-telefoon${vrij}.` : `${naam} is de geheugen-telefoon${vrij}.`;
  }

  return { MIN_VRIJ_GB, MARGE_GB, VERS_MS, SOORTEN, VERSLEUTELD_MERK, ZOEK_GELDIG_MS, goedeNaam, goedeSoort, kanBewaren, kies, magBewaren, zoekNaam, nachtKopieNu, zin };
}));
