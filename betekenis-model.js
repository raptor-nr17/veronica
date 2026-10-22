// ===================================================================
// 523b: HET BETEKENISMODEL IN DE BROWSER (EmbeddingGemma, via transformers.js 3.7.6, Apache 2.0)
// ===================================================================
//
// Rekent teksten om naar getallen (een "embedding"), helemaal op deze Chromebook. De bibliotheek staat naast Veronica in
// ./betekenis/ (niets van een andere site). Het MODEL wordt alleen opgehaald na een tik van een mens, een keer, van de modelsite;
// de browser bewaart het daarna zelf (Cache Storage) en dan werkt het ook zonder internet. Er gaat nooit een tekst naar buiten:
// het rekenen gebeurt hier. Staat "Vol lokaal" aan, dan houdt de poort van Veronica het ophalen tegen en zegt dit dat eerlijk.
//
// Geen opslag van teksten of getallen: prive-betekenis.js houdt de getallen alleen in het geheugen van de pagina.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.BetekenisModel = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MODEL = 'onnx-community/embeddinggemma-300m-ONNX';
  const DTYPE = 'q4';                 // ±198 MB; op de runner (betekenis-proef.yml, 21 oktober) 4 van 4 goed, net als fp32 (1,2 GB)
  const BASIS = './betekenis/';       // de bibliotheek en de rekenkern (wasm) staan naast Veronica
  // De voorvoegsels die EmbeddingGemma zelf voorschrijft (modelkaart): een vraag en een stuk tekst worden anders ingelezen.
  const PREFIX_VRAAG = 'task: search result | query: ';
  const PREFIX_STUK = 'title: none | text: ';
  const MAX_PER_KEER = 16;            // een paar stukken tegelijk: de pagina blijft bruikbaar

  // Een zin voor een mens bij elke stand. Geen foutcode.
  function zin(stand, extra) {
    if (stand === 'klaar') return 'Het betekenismodel staat klaar op deze computer.';
    if (stand === 'laden') return `Het betekenismodel wordt opgehaald${extra ? ` (${extra})` : ''}. Een keer; daarna werkt het ook zonder internet.`;
    if (stand === 'lokaal') return 'Vol lokaal staat aan: het model ophalen gaat niet. Zet Vol lokaal even uit, of zoek verder met de woorddelen.';
    if (stand === 'fout') return 'Het betekenismodel kon niet worden opgehaald. Ik zoek verder met de woorddelen.';
    return 'Het betekenismodel is er nog niet (een keer ophalen, ongeveer 200 MB). Tot dan zoek ik met de woorddelen.';
  }

  // 523c: HET MODEL OP HET KAARTJE. Het model is openbaar (geen privé-inhoud), dus het mag in de KAST van het kaartje (kaartje.js,
  // dezelfde map waar de modellen voor de telefoons staan). De cache van transformers.js kijkt eerst op het kaartje, dan in de
  // opslag van de browser; een nieuw opgehaald bestand gaat naar het kaartje als dat erin zit, anders naar de browser.
  // Alleen bestanden van DIT model krijgen een kastnaam; al het andere gaat gewoon naar de browser.
  function kastNaam(url) {
    const m = /\/onnx-community\/embeddinggemma-300m-ONNX\/resolve\/[^/]+\/(.+)$/.exec(String(url || '').split('?')[0]);
    if (!m) return null;
    const n = `betekenis-${m[1].replace(/\//g, '_')}`;
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(n) && !n.includes('..') ? n : null;
  }
  // kaartje: { kastBestand(naam) -> File|null, kastSchrijfStroom(naam, stroom, bytes) -> {ok} }; browser: een Cache (caches.open)
  // of null. Geeft de vorm die transformers.js als customCache verwacht: match(verzoek) en put(verzoek, antwoord).
  function kaartjeCache(kaartje, browser) {
    const sleutel = (v) => (typeof v === 'string' ? v : (v && v.url) || '');
    return {
      async match(verzoek) {
        const naam = kastNaam(sleutel(verzoek));
        if (naam && kaartje) { try { const f = await kaartje.kastBestand(naam); if (f) return new Response(f); } catch (e) { /* dan de browser */ } }
        return browser ? browser.match(sleutel(verzoek)) : undefined;
      },
      async put(verzoek, antwoord) {
        const naam = kastNaam(sleutel(verzoek));
        if (naam && kaartje && antwoord && antwoord.body) {
          try {
            const [a, b] = antwoord.body.tee();
            const r = await kaartje.kastSchrijfStroom(naam, a, Number(antwoord.headers && antwoord.headers.get && antwoord.headers.get('content-length')) || 0);
            if (r && r.ok) { b.cancel().catch(() => {}); return; }
            if (browser) { await browser.put(sleutel(verzoek), new Response(b, { headers: antwoord.headers })); return; }
            return;
          } catch (e) { /* dan de browser, met het hele antwoord als dat nog kan */ }
        }
        if (browser) { try { await browser.put(sleutel(verzoek), antwoord); } catch (e) { /* niet bewaard: de volgende keer opnieuw */ } }
      },
    };
  }

  // laad({ importeer, opVoortgang, cache }) -> { embedder(teksten) -> number[][], naam }
  // importeer is de functie die de bibliotheek inleest (in Veronica: (pad) => import(pad)); zo is dit los te toetsen.
  async function laad(opt) {
    const o = opt || {};
    const importeer = o.importeer || ((pad) => import(pad));
    const T = await importeer(`${o.basis || BASIS}transformers.min.js`);
    const env = T.env;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    if (o.cache) { env.useCustomCache = true; env.customCache = o.cache; env.useBrowserCache = false; }   // 523c: kaartje eerst
    try {
      env.backends.onnx.wasm.wasmPaths = new URL(o.basis || BASIS, (typeof location !== 'undefined' && location.href) || 'http://localhost/').href;
      env.backends.onnx.wasm.numThreads = (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) ? Math.min(4, (navigator.hardwareConcurrency || 2)) : 1;
    } catch (e) { /* een oudere bibliotheek: dan de standaard */ }
    const voortgang = (p) => {
      if (!o.opVoortgang || !p) return;
      if (p.status === 'progress' && typeof p.progress === 'number') o.opVoortgang(Math.round(p.progress));
    };
    const pijp = await T.pipeline('feature-extraction', o.model || MODEL, { dtype: o.dtype || DTYPE, device: 'wasm', progress_callback: voortgang });
    async function embedder(teksten) {
      const uit = [];
      for (let i = 0; i < teksten.length; i += MAX_PER_KEER) {
        const r = await pijp(teksten.slice(i, i + MAX_PER_KEER), { pooling: 'mean', normalize: true });
        for (const v of r.tolist()) uit.push(v);
      }
      return uit;
    }
    return { embedder, naam: 'EmbeddingGemma (op deze computer)' };
  }

  return { laad, zin, kastNaam, kaartjeCache, MODEL, DTYPE, BASIS, PREFIX_VRAAG, PREFIX_STUK, MAX_PER_KEER };
}));
