// ===================================================================
// 523: ZOEKEN OP BETEKENIS IN MIJN PRIVÉ-HOEK -- alles op deze Chromebook, niets naar buiten
// ===================================================================
//
// Gewone rekencode, GEEN netwerk en GEEN opslag: dit bestand krijgt de inhoud van de privé-hoek (kern, karakter, samenvattingen,
// logboek, voorstellen, favoriete namen) en een vraag, en geeft de stukken terug die er in BETEKENIS het dichtst bij liggen.
//
// De rekenfunctie (een embedder: teksten -> getallen) wordt van buiten aangereikt. In Veronica is dat EmbeddingGemma in de browser
// zelf (transformers.js, het model een keer opgehaald en daarna lokaal); zolang dat er niet is, de ingebouwde woorddelen-methode van
// zoekgeheugen.js. Twee methodes worden NOOIT in een ranglijst gemengd: lukt de embedder voor een stuk niet, dan valt de hele
// zoekvraag terug op de woorddelen.
//
// Vectoren staan alleen in het geheugen van de pagina (een tabel op de tekst, hoogstens MAX_CACHE stukken). Er wordt niets bewaard,
// niets gelogd en niets verstuurd; de privé-hoek blijft de enige plek waar de tekst staat.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek(require('./zoekgeheugen.js'));
  else wortel.PriveBetekenis = fabriek(wortel.ZoekGeheugen);
}(typeof self !== 'undefined' ? self : this, function (Z) {
  'use strict';

  const MAX_CACHE = 4000;
  const MIN_SCORE_WOORDEN = 0.2;     // woorddelen: een losse letter-overeenkomst telt niet
  const MIN_SCORE_MODEL = 0.3;       // een echt betekenismodel geeft altijd iets; daaronder is het ruis
  const MAX_TEKST = 600;             // een stuk wordt hooguit zo lang ingelezen (de rest verandert de betekenis zelden)
  const PREFIX_VRAAG = (Z && Z.PREFIX_VRAAG) || 'task: search query | text: ';
  const PREFIX_STUK = (Z && Z.PREFIX_RESULTAAT) || 'task: search result | text: ';

  const tekstVan = (t) => (t && typeof t === 'object' && 'tekst' in t ? String(t.tekst || '') : String(t == null ? '' : t));

  // Alle doorzoekbare stukken van de hoek, met waar ze vandaan komen. Geen wachtwoorden: die staan er nooit in (496).
  function stukkenVan(store) {
    const st = store || {};
    const uit = [];
    const zet = (soort, dag, tekst) => { const t = tekstVan(tekst).trim(); if (t) uit.push({ soort, dag: dag || '', tekst: t.slice(0, MAX_TEKST) }); };
    zet('kern', '', st.kern);
    zet('karakter', '', st.karakter);
    for (const s of Array.isArray(st.samenvattingen) ? st.samenvattingen : []) zet('samenvatting', s.dag, s.tekst);
    for (const d of Array.isArray(st.logboek) ? st.logboek : []) for (const r of d.regels || []) zet('logboek', d.dag, r.tekst);
    for (const v of Array.isArray(st.voorstellen) ? st.voorstellen : []) zet('voorstel', v.dag, v.tekst);
    for (const f of Array.isArray(st.favorieten) ? st.favorieten : []) zet('favoriet', '', f.naam);
    return uit;
  }

  function maak(opt) {
    const o = opt || {};
    const embedder = typeof o.embedder === 'function' ? o.embedder : null;
    const naam = embedder ? String(o.embedderNaam || 'eigen model') : 'woorddelen';
    const cache = new Map();
    const onthoud = (k, v) => { if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value); cache.set(k, v); };

    async function vectoren(teksten, prefix) {
      const sleutels = teksten.map((t) => prefix + t);
      const nodig = sleutels.filter((k) => !cache.has(k));
      if (nodig.length) {
        const v = await embedder(nodig);
        if (!Array.isArray(v) || v.length !== nodig.length || v.some((x) => !Array.isArray(x) && !(x && typeof x.length === 'number'))) throw new Error('embedder');
        nodig.forEach((k, i) => onthoud(k, Array.from(v[i])));
      }
      return sleutels.map((k) => cache.get(k));
    }
    const normaal = (v) => { let s = 0; for (const x of v) s += x * x; const n = Math.sqrt(s); return n > 0 ? v.map((x) => x / n) : v; };

    // De stukken met een score, hoogste eerst; methode zegt wat er rekende.
    async function zoek(store, vraag, n) {
      const q = tekstVan(vraag).trim();
      const stukken = stukkenVan(store);
      if (!q || !stukken.length) return { methode: embedder ? naam : 'woorddelen', resultaten: [] };
      let methode = 'woorddelen';
      let vq; let vs;
      if (embedder) {
        try {
          vq = normaal((await vectoren([q], PREFIX_VRAAG))[0]);
          vs = (await vectoren(stukken.map((s) => s.tekst), PREFIX_STUK)).map(normaal);
          methode = naam;
        } catch (e) { vq = null; vs = null; }   // niet gemengd: alles terug naar de woorddelen
      }
      if (!vq) { vq = Z.ingebouwdeVector(q); vs = stukken.map((s) => Z.ingebouwdeVector(s.tekst)); }
      const min = methode === 'woorddelen' ? MIN_SCORE_WOORDEN : MIN_SCORE_MODEL;
      const resultaten = stukken.map((s, i) => Object.assign({}, s, { score: Math.round(Z.cosinus(vq, vs[i]) * 1000) / 1000 }))
        .filter((r) => r.score >= min)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, Math.min(50, Number(n) || 8)));
      return { methode, resultaten };
    }
    return { zoek, methode: () => naam, cacheGrootte: () => cache.size };
  }

  return { maak, stukkenVan, MAX_CACHE, MIN_SCORE_WOORDEN, MIN_SCORE_MODEL, PREFIX_VRAAG, PREFIX_STUK };
}));
