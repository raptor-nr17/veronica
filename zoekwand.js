// ===================================================================
// DE ZOEKWAND (555) -- elke telefoon een eigen zoekmachine, naast elkaar op het scherm
// ===================================================================
//
// Per telefoon EEN tegel: versie, accu, warmte en model (uit zijn hartslag), wat hij NU zoekt, welke pagina's hij las (titel en
// adres), wat zijn EIGEN model eruit haalde, en zijn status met de reden. Deze module houdt alleen bij wat er gebeurt; de tegels
// tekent veronica.js. Geen netwerk, geen opslag: wat hier staat is weg bij herladen.
//
// TWEE WANDEN, NOOIT GEMENGD: de gewone (zoekstapel) en de PRIVÉ (onderzoek uit de privé-hoek). Een privé-wand neemt ALLEEN een
// stap aan van een telefoon over het EIGEN wifi (geen `brief:`-telefoon: geen postbus, geen relay, geen brievenbus), en wist zichzelf
// bij `wis()` (noodstop, of de hoek gaat dicht).
//
// Geen schermafbeelding: de telefoons lezen de bronnen als TEKST (Wikipedia, Wikidata, ...), niet in een browser. Een plaatje zou
// een extra verzoek naar buiten zijn, en Veronica haalt zelf niets van internet (476c). Alles is platte tekst; niets is aanklikbaar.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Zoekwand = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_PAGINAS = 6;
  const MAX_ANTWOORD = 600;
  const MAX_TELEFOONS = 16;
  const FASEN = ['zoekt', 'denkt', 'klaar', 'fout'];
  const kort = (s, n) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  // Alleen een gewoon webadres, als tekst. Al het andere (javascript:, data:, leeg) valt weg.
  const adres = (u) => (/^https?:\/\/[^\s]+$/i.test(String(u || '')) ? kort(u, 200) : '');

  function maak(opties) {
    const o = opties || {};
    const prive = o.prive === true;
    const per = new Map();
    let geweigerd = 0;

    // stap({ telefoon: id, naam, fase, term, uitslag, kern, zin }, nu) -- uit de zoekstapel (zoeken.js opStap)
    function stap(x, nu) {
      const s = x || {};
      const id = String(s.telefoon || '');
      if (!id) return false;
      if (prive && id.startsWith('brief:')) { geweigerd += 1; return false; }   // privé: nooit via de postbus, de relay of de brievenbus
      if (!FASEN.includes(s.fase)) return false;
      if (!per.has(id) && per.size >= MAX_TELEFOONS) return false;
      const r = per.get(id) || { id, naam: '', zoekt: '', fase: '', paginas: [], antwoord: '', antwoordVan: '', tps: null, zin: '', klaar: 0, t: 0 };
      r.naam = kort(s.naam || r.naam || id, 60);
      r.t = Number(nu) || Date.now();
      r.fase = s.fase;
      if (s.term) r.zoekt = kort(s.term, 160);
      if (s.fase === 'zoekt') { r.zin = ''; }
      const u = s.uitslag;
      if (u && Array.isArray(u.samengevoegd)) {
        r.paginas = u.samengevoegd.slice(0, MAX_PAGINAS).map((p) => ({ titel: kort(p && p.titel, 120), adres: adres(p && p.url), bron: kort((p && Array.isArray(p.bronnen) ? p.bronnen : []).join(', '), 60) }))
          .filter((p) => p.titel || p.adres);
      }
      if (s.fase === 'klaar') {
        r.klaar += 1;
        const k = s.kern;
        if (k && k.ok && k.tekst) { r.antwoord = kort(k.tekst, MAX_ANTWOORD); r.antwoordVan = r.zoekt; r.tps = typeof k.tps === 'number' ? k.tps : null; }
        r.zin = k && !k.ok ? kort(k.zin, 160) : (u && !u.ok ? kort(u.zin || 'Zoeken lukte niet.', 160) : (u && u.ok && !r.paginas.length ? 'Niets gevonden.' : ''));
      }
      if (s.fase === 'fout') r.zin = kort(s.zin || 'Dit lukte niet.', 160);
      per.set(id, r);
      return true;
    }
    function wis() { per.clear(); }
    function lijst() { return [...per.values()].map((r) => Object.assign({}, r, { paginas: r.paginas.map((p) => Object.assign({}, p)) })); }
    function van(id) { const r = per.get(String(id || '')); return r ? Object.assign({}, r, { paginas: r.paginas.slice() }) : null; }
    // Wat de tegel zegt over de activiteit, in een zin.
    function nuZin(r, nu) {
      if (!r || !r.fase) return 'Zoekt nu niets.';
      if (r.fase === 'zoekt') return `Zoekt nu: "${r.zoekt}"`;
      if (r.fase === 'denkt') return `Leest wat hij vond over "${r.zoekt}" en vraagt zijn eigen model om de kern.`;
      const sinds = Math.max(0, Math.round(((Number(nu) || Date.now()) - r.t) / 1000));
      const oud = sinds < 90 ? `${sinds} s geleden` : `${Math.round(sinds / 60)} min geleden`;
      return r.fase === 'fout' ? `${r.zin} (${oud})` : `Klaar met "${r.zoekt}" (${oud}).`;
    }
    return Object.freeze({ prive, stap, wis, lijst, van, nuZin, geweigerd: () => geweigerd });
  }

  return { maak, MAX_PAGINAS, MAX_ANTWOORD, MAX_TELEFOONS, FASEN };
}));
