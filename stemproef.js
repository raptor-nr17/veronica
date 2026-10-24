// ===================================================================
// 538 stap 5: DE STEMPROEF -- welke stem klinkt het best, blind gekozen
// ===================================================================
//
// De eigenaar kiest op deze computer een map met een proef: stemproef.json en de geluidsbestanden. Per verhaal staan de stemmen
// door elkaar onder de letters A tot en met E; welke stem achter een letter zit blijft verborgen tot ELK verhaal een keuze heeft.
// Dan pas de uitslag: per stem hoe vaak hij gekozen is.
//
//  - Geen netwerk: de bestanden komen uit de gekozen map en worden in de browser zelf afgespeeld.
//  - De keuzes worden onthouden per proef (vingerafdruk van stemproef.json), op NAAM van de stem, niet op letter: na een herlading
//    staan de letters opnieuw door elkaar en blijft de proef blind.
//  - De volgorde komt uit een willekeur-haak (in de browser crypto.getRandomValues). Een vaste volgorde zou na een keer niet meer
//    blind zijn.
//  - De proef zegt erbij dat de stemmen door AI gemaakt zijn (artikel 50 van de AI-verordening): dat staat ook in elk bestand.
//
// stemproef.json:  { "versie": 1, "verhalen": [ { "id", "titel", "tekst"?, "stemmen": [ { "stem", "bestand" } ] } ] }
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Stemproef = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];
  const MAX_VERHALEN = 5;
  const GELUID = /\.(m4a|mp3|wav|ogg|opus|aac)$/i;

  function vinger(tekst) {   // FNV-1a, 32 bits: genoeg om twee proeven uit elkaar te houden
    let h = 0x811c9dc5;
    for (let i = 0; i < tekst.length; i++) { h ^= tekst.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }
  const kaal = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

  // Leest stemproef.json. `bestanden` = de namen in de gekozen map. Geeft { proef } of { fout } met een zin voor een mens.
  function leesProef(jsonTekst, bestanden) {
    let j;
    try { j = JSON.parse(jsonTekst); } catch (e) { return { fout: 'stemproef.json is geen geldige lijst.' }; }
    if (!j || j.versie !== 1 || !Array.isArray(j.verhalen)) return { fout: 'Dit is geen stemproef (versie 1).' };
    const aanwezig = new Set(bestanden || []);
    if (!j.verhalen.length || j.verhalen.length > MAX_VERHALEN) return { fout: `Een proef heeft 1 tot ${MAX_VERHALEN} verhalen.` };
    const verhalen = [];
    const ids = new Set();
    for (const v of j.verhalen) {
      const id = kaal(v && v.id, 60);
      if (!id || ids.has(id)) return { fout: 'Elk verhaal heeft een eigen id nodig.' };
      ids.add(id);
      const st = Array.isArray(v.stemmen) ? v.stemmen : [];
      if (st.length < 2 || st.length > LETTERS.length) return { fout: `Verhaal ${id}: 2 tot ${LETTERS.length} stemmen.` };
      const namen = new Set();
      const stemmen = [];
      for (const s of st) {
        const stem = kaal(s && s.stem, 40);
        const bestand = String((s && s.bestand) || '');
        if (!stem || namen.has(stem)) return { fout: `Verhaal ${id}: elke stem een keer.` };
        if (!GELUID.test(bestand) || /[\\/]|\.\./.test(bestand)) return { fout: `Verhaal ${id}: ${kaal(bestand, 60) || 'een bestand'} is geen geluidsbestand in deze map.` };
        if (!aanwezig.has(bestand)) return { fout: `${bestand} staat niet in de gekozen map.` };
        namen.add(stem);
        stemmen.push({ stem, bestand });
      }
      verhalen.push({ id, titel: kaal(v.titel, 120) || id, tekst: kaal(v.tekst, 4000), stemmen });
    }
    return { proef: { id: vinger(jsonTekst), verhalen } };
  }

  // Fisher-Yates met een willekeur-haak die een getal in [0, 1) geeft.
  function maakBlind(proef, willekeur) {
    const r = typeof willekeur === 'function' ? willekeur : null;
    if (!r) throw new Error('een willekeur-haak is nodig');
    return proef.verhalen.map((v) => {
      const s = v.stemmen.slice();
      for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = s[i]; s[i] = s[j]; s[j] = t; }
      return { id: v.id, titel: v.titel, tekst: v.tekst, keuzes: s.map((x, i) => ({ letter: LETTERS[i], stem: x.stem, bestand: x.bestand })) };
    });
  }

  function nieuweStand(proef) { return { proef: proef.id, keuzes: {} }; }
  function geldigeStand(stand, proef) { return stand && stand.proef === proef.id && stand.keuzes && typeof stand.keuzes === 'object' ? stand : nieuweStand(proef); }

  // Een tik op een letter. De stand onthoudt de NAAM van de stem.
  function kies(stand, blind, verhaalId, letter) {
    const v = blind.find((x) => x.id === verhaalId);
    const k = v && v.keuzes.find((x) => x.letter === letter);
    if (!k) return stand;
    return { proef: stand.proef, keuzes: Object.assign({}, stand.keuzes, { [verhaalId]: k.stem }) };
  }

  function klaar(stand, proef) { return proef.verhalen.every((v) => !!stand.keuzes[v.id]); }

  // Pas als elk verhaal een keuze heeft; anders null (dan blijft het blind).
  function uitslag(stand, proef) {
    if (!klaar(stand, proef)) return null;
    const tel = {};
    for (const v of proef.verhalen) for (const s of v.stemmen) tel[s.stem] = tel[s.stem] || 0;
    for (const v of proef.verhalen) tel[stand.keuzes[v.id]]++;
    const lijst = Object.keys(tel).map((stem) => ({ stem, aantal: tel[stem] })).sort((a, b) => b.aantal - a.aantal || a.stem.localeCompare(b.stem));
    const top = lijst[0].aantal;
    const winnaars = lijst.filter((x) => x.aantal === top).map((x) => x.stem);
    return { lijst, winnaar: winnaars.length === 1 ? winnaars[0] : null, gelijk: winnaars.length > 1 ? winnaars : [] };
  }

  function uitslagTekst(stand, proef) {
    const u = uitslag(stand, proef);
    if (!u) return '';
    const r = ['Stemproef ' + proef.id];
    r.push(u.winnaar ? `Beste stem: ${u.winnaar}` : `Gelijk: ${u.gelijk.join(', ')}`);
    for (const x of u.lijst) r.push(`${x.stem}: ${x.aantal} van ${proef.verhalen.length}`);
    for (const v of proef.verhalen) r.push(`${v.titel}: ${stand.keuzes[v.id]}`);
    return r.join('\n');
  }

  return { LETTERS, MAX_VERHALEN, leesProef, maakBlind, nieuweStand, geldigeStand, kies, klaar, uitslag, uitslagTekst, vinger };
}));
