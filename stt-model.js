// ===================================================================
// 641 (super-jarvis, fase 1b, keuze c): SPRAAK-NAAR-TEKST IN DE BROWSER (Whisper, via transformers.js 3.7.6, Apache 2.0)
// ===================================================================
//
// Zet een opname (16 kHz mono) om in tekst, helemaal op deze Chromebook -- geen telefoon nodig, geen internet nadat het model
// er een keer is. De BIBLIOTHEEK is dezelfde die het betekenismodel al gebruikt (./betekenis/transformers.min.js + de wasm-kern);
// er komt niets van een andere site bij. Het MODEL (onnx-community/whisper-base, meertalig, dus ook Nederlands) wordt alleen
// opgehaald via de ENE poort van Veronica (zelfde patroon als het betekenismodel, §523b/§556); de browser bewaart het daarna zelf
// (Cache Storage) en dan werkt luisteren ook zonder internet. Staat "Vol lokaal" aan, dan houdt de poort het ophalen tegen en
// zegt dit dat eerlijk.
//
// Er gaat NOOIT audio of tekst naar buiten: het omzetten gebeurt hier. DuckDuckGo/Google komen er niet aan te pas -- dat is juist
// de bedoeling (thuis-modus, 1b).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.SttModel = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MODEL = 'onnx-community/whisper-base';   // meertalig (NIET de .en-variant); Nederlands werkt. tiny is te zwak, base de balans.
  // whisper-base: de encoder op fp32 houden en alleen de decoder kwantiseren geeft de beste kwaliteit per MB (±75 MB). Lukt die
  // combinatie niet op het model, dan valt transformers.js terug op wat er is; de proef op de echte Chromebook beslist de dtype.
  const DTYPE = { encoder_model: 'fp32', decoder_model_merged: 'q8' };
  const BASIS = './betekenis/';       // DEZELFDE bibliotheek als het betekenismodel (transformers.min.js + ort-wasm)
  const TAAL = 'nl';                  // Nederlands; het model is meertalig maar we weten de taal, dus die zetten we vast
  const MAX_SECONDEN = 30;            // een korte opdracht/zin; langer knippen we niet (we nemen zelf maar ~8 s op)

  // Een zin voor een mens bij elke stand. Geen foutcode.
  function zin(stand, extra) {
    if (stand === 'klaar') return 'Het luistermodel staat klaar op deze computer: ik versta je ook zonder internet.';
    if (stand === 'laden') return `Het luistermodel wordt opgehaald${extra ? ` (${extra})` : ''}. Een keer; daarna versta ik je ook zonder internet.`;
    if (stand === 'lokaal') return 'Vol lokaal staat aan: het luistermodel ophalen gaat niet. Zet Vol lokaal even uit.';
    if (stand === 'fout') return 'Het luistermodel kon niet worden opgehaald. Ik probeer het later nog eens.';
    return 'Het luistermodel is er nog niet (een keer ophalen, ongeveer 75 MB). Tot dan luister ik via een telefoon of, met internet, via de browser.';
  }

  // HET MODEL OP HET KAARTJE (zelfde idee als betekenis-model, 523c). Het model is openbaar, dus het mag in de KAST van het
  // kaartje. Alleen bestanden van DIT model krijgen een kastnaam; al het andere gaat gewoon naar de browser.
  function kastNaam(url) {
    const m = /\/onnx-community\/whisper-base\/resolve\/[^/]+\/(.+)$/.exec(String(url || '').split('?')[0]);
    if (!m) return null;
    const n = `luister-${m[1].replace(/\//g, '_')}`;
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

  // laad({ importeer, opVoortgang, cache }) -> { verstaander(float32@16k) -> tekst, naam }
  // importeer is de functie die de bibliotheek inleest (in Veronica: (pad) => import(pad)); zo is dit los te toetsen.
  async function laad(opt) {
    const o = opt || {};
    const importeer = o.importeer || ((pad) => import(pad));
    const T = await importeer(`${o.basis || BASIS}transformers.min.js`);
    const env = T.env;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    if (o.cache) { env.useCustomCache = true; env.customCache = o.cache; env.useBrowserCache = false; }   // kaartje eerst
    try {
      env.backends.onnx.wasm.wasmPaths = new URL(o.basis || BASIS, (typeof location !== 'undefined' && location.href) || 'http://localhost/').href;
      env.backends.onnx.wasm.numThreads = (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) ? Math.min(4, (navigator.hardwareConcurrency || 2)) : 1;
    } catch (e) { /* een oudere bibliotheek: dan de standaard */ }
    const voortgang = (p) => {
      if (!o.opVoortgang || !p) return;
      if (p.status === 'progress' && typeof p.progress === 'number') o.opVoortgang(Math.round(p.progress));
    };
    const pijp = await T.pipeline('automatic-speech-recognition', o.model || MODEL, { dtype: o.dtype || DTYPE, device: 'wasm', progress_callback: voortgang });
    // samples: Float32Array (mono, 16 kHz). Geeft de verstane tekst terug (getrimd), of '' als er niets verstaan is.
    async function verstaander(samples) {
      const r = await pijp(samples, { language: o.taal || TAAL, task: 'transcribe', chunk_length_s: MAX_SECONDEN, return_timestamps: false });
      const tekst = r && typeof r.text === 'string' ? r.text.trim() : '';
      return tekst;
    }
    return { verstaander, naam: 'Whisper (op deze computer)' };
  }

  return { laad, zin, kastNaam, kaartjeCache, MODEL, DTYPE, BASIS, TAAL, MAX_SECONDEN };
}));
