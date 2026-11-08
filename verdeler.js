// ===================================================================
// 678 stap 5: DE VERDELER OP DE VERDEELTELEFOON -- één label, dan de weg. Rekent alleen: geen netwerk, geen opslag, geen model.
// De verdeeltelefoon (een klein snel model) krijgt de vraag met AFGEDWONGEN JSON terug en zegt met ÉÉN woord wat voor soort het is;
// deze code leest dat label, kiest de weg, en beslist of het stukje een trede hoger moet. veronica.js stuurt en logt.
// ===================================================================
//
// Afspraak met de eigenaar (8 november):
//  - DE VERDELER IS DE VERDEELTELEFOON (de kleinste snelle telefoon, een klein model). Hij CLASSIFICEERT alleen; hij beantwoordt niets zelf.
//  - HET LABEL KOMT UIT HET MODEL, met afgedwongen JSON, NOOIT uit een woordenzoeker in deze code (zelfde regel als 84:
//    de soort komt uit de bron, niet uit de tekst). Leest de JSON niet, dan valt het terug op 'moeilijk' -- nooit op 'bedienen'.
//  - VIER LABELS: makkelijk (lokaal beantwoorden), opzoeken (zoeken), moeilijk (groter model via de trap), bedienen (een telefoon
//    besturen op tekst -- stap 8, uiautomator). 'bedienen' wordt NOOIT geraden en NOOIT een terugval: een telefoon besturen is te
//    ingrijpend om op een misgelezen JSON te doen.
//  - EEN TREDE HOGER op een NAKIJKBAAR signaal (zelfde geest als trap.magOpschalen): het antwoord zegt zelf "ik weet het niet",
//    de zoekresultaten zijn zwak, of de token-entropie is hoog. NOOIT omdat het model zegt dat het een groter model wil.
//  - DE RESERVE (een groter lokaal of betaald model) IS DE LAATSTE, en standaard UIT. Nooit een gratis extern model voor de GEBRUIKERS van de gids in de EER
//    (de NIET-DOEN-regel); de reserve is lokaal-groter of betaald, en alleen voor de eigen vragen van de eigenaar.
//  - ELKE BESLISSING IS EEN LOGREGEL (beslis() geeft hem terug); veronica.js bewaart en toont hem.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Verdeler = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // De vier labels (machinevorm) -> titel + de weg die erbij hoort.
  const LABELS = Object.freeze(['makkelijk', 'opzoeken', 'moeilijk', 'bedienen']);
  const INFO = Object.freeze({
    makkelijk: { titel: 'Makkelijk', weg: 'lokaal', trede: 'klein', uitleg: 'een klein model beantwoordt dit zelf' },
    opzoeken: { titel: 'Moet opzoeken', weg: 'zoeken', trede: null, uitleg: 'eerst zoeken, dan het antwoord opbouwen' },
    moeilijk: { titel: 'Moeilijk', weg: 'groot', trede: 'E2B', uitleg: 'een groter model via de trap' },
    bedienen: { titel: 'Telefoon bedienen', weg: 'bedienen', trede: null, uitleg: 'een telefoon besturen op tekst (uiautomator)' },
  });
  // Synoniemen die het model kan teruggeven -> de machinevorm. Alles in kleine letters, zonder leestekens.
  const SYNONIEM = Object.freeze({
    makkelijk: 'makkelijk', makkelijke: 'makkelijk', eenvoudig: 'makkelijk', simpel: 'makkelijk', easy: 'makkelijk',
    opzoeken: 'opzoeken', 'moet opzoeken': 'opzoeken', zoeken: 'opzoeken', zoek: 'opzoeken', opzoek: 'opzoeken', search: 'opzoeken', internet: 'opzoeken',
    moeilijk: 'moeilijk', moeilijke: 'moeilijk', lastig: 'moeilijk', complex: 'moeilijk', hard: 'moeilijk',
    bedienen: 'bedienen', 'telefoon bedienen': 'bedienen', besturen: 'bedienen', telefoon: 'bedienen', actie: 'bedienen', doen: 'bedienen', control: 'bedienen',
  });
  const TERUGVAL = 'moeilijk';   // kan de JSON niet gelezen worden: liever een groter model dan een fout antwoord -- NOOIT 'bedienen'.
  const ENTROPIE_DREMPEL = 2.0;  // bits. Boven dit is het model onzeker genoeg om een trede hoger te gaan.
  const ZOEK_SCORE_DREMPEL = 0.3; // een topresultaat onder deze score (0..1) is "zwak".

  const tekst = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));

  // HET VERDEELVERZOEK voor de verdeeltelefoon: afgedwongen JSON met precies één van de vier labels, kort, in het Nederlands.
  function maakPrompt(vraag) {
    const v = tekst(vraag).replace(/\s+/g, ' ').trim().slice(0, 600);
    return 'Je bent een verdeler. Zeg alleen wat voor soort deze vraag is, niets anders.\n'
      + 'Antwoord met één JSON-object en niets eromheen: {"label": "<soort>"}.\n'
      + 'De soort is precies één van deze vier woorden:\n'
      + '- "makkelijk": een klein model kan dit zelf beantwoorden (een korte vraag, een begroeting, rekenen).\n'
      + '- "opzoeken": hiervoor moet eerst iets op het web worden opgezocht (nieuws, een actueel feit, een adres).\n'
      + '- "moeilijk": dit vraagt redeneren of veel kennis (uitleg, een plan, code, een lange samenvatting).\n'
      + '- "bedienen": de gebruiker vraagt om op een telefoon iets te doen (een app openen, een knop tikken, iets instellen).\n'
      + `De vraag:\n${v}\n`
      + 'Geef alleen de JSON.';
  }

  // Lees het label uit het (JSON-)antwoord van de verdeeltelefoon. -> { label, rauw, gelezen } (gelezen=false = JSON niet gelezen, terugval).
  function leesLabel(antwoord) {
    const a = tekst(antwoord).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    let rauw = null;
    const s = a.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    // Eerst echt JSON proberen; anders het eerste {...}-blok eruit vissen.
    for (const kandidaat of [s, (s.match(/\{[\s\S]*?\}/) || [null])[0]]) {
      if (!kandidaat) continue;
      try { const j = JSON.parse(kandidaat); if (j && typeof j === 'object' && j.label != null) { rauw = tekst(j.label); break; } } catch (e) { /* door */ }
    }
    if (rauw == null) return { label: TERUGVAL, rauw: null, gelezen: false };
    const sleutel = rauw.toLowerCase().replace(/[^a-zà-ÿ\s]/g, '').replace(/\s+/g, ' ').trim();
    const label = SYNONIEM[sleutel] || (LABELS.indexOf(sleutel) >= 0 ? sleutel : null);
    if (!label) return { label: TERUGVAL, rauw, gelezen: false };
    return { label, rauw, gelezen: true };
  }

  function bestemming(label) {
    const i = INFO[label] ? label : TERUGVAL;
    return Object.assign({ label: i }, INFO[i]);
  }

  // Token-entropie uit de logprobs van het model (als de motor ze meegeeft). tokens = [{ top: [{ logprob }] } ...] of [{ logprobs: {...} }].
  // Gemiddelde Shannon-entropie (bits) over de posities waar meer dan één kandidaat bekend is. Geen logprobs -> null (geen gok).
  function entropie(tokens) {
    const lijst = Array.isArray(tokens) ? tokens : [];
    let som = 0, n = 0;
    for (const t of lijst) {
      const top = (t && (t.top || t.top_logprobs || (t.logprobs && t.logprobs.top))) || null;
      if (!Array.isArray(top) || top.length < 2) continue;
      let h = 0;
      for (const k of top) {
        const lp = typeof k === 'number' ? k : (k && typeof k.logprob === 'number' ? k.logprob : null);
        if (lp == null) continue;
        const p = Math.exp(lp);
        if (p > 0) h -= p * Math.log2(p);
      }
      if (h > 0) { som += h; n++; }
    }
    return n ? som / n : null;
  }

  const ONZEKER = /\bik weet (het )?niet\b|\bweet ik niet\b|\bgeen (flauw )?idee\b|\bniet zeker\b|\bkan ik niet (zeggen|beantwoorden)\b|\bi (really )?don'?t know\b|\bnot sure\b|\bunsure\b/i;

  // EEN TREDE HOGER? Alleen op een nakijkbaar signaal, nooit op wat het model over zichzelf zegt.
  // signaal = { antwoord, zoekResultaten:[{score}]|aantal, entropie, entropieDrempel, zoekDrempel, modelVraagtGroter }. -> { op, reden }.
  function moetOpschalen(signaal) {
    const s = signaal || {};
    if (s.antwoord != null && ONZEKER.test(tekst(s.antwoord))) return { op: true, reden: 'het antwoord zegt zelf dat het het niet weet' };
    if (s.zoekResultaten != null) {
      const aantal = Array.isArray(s.zoekResultaten) ? s.zoekResultaten.length : (typeof s.zoekResultaten === 'number' ? s.zoekResultaten : null);
      if (aantal === 0) return { op: true, reden: 'geen zoekresultaten' };
      if (Array.isArray(s.zoekResultaten) && aantal) {
        const drempel = typeof s.zoekDrempel === 'number' ? s.zoekDrempel : ZOEK_SCORE_DREMPEL;
        const top = s.zoekResultaten.map((r) => (r && typeof r.score === 'number' ? r.score : null)).filter((x) => x !== null);
        if (top.length && Math.max.apply(null, top) < drempel) return { op: true, reden: 'de zoekresultaten zijn zwak' };
      }
    }
    if (typeof s.entropie === 'number') {
      const drempel = typeof s.entropieDrempel === 'number' ? s.entropieDrempel : ENTROPIE_DREMPEL;
      if (s.entropie > drempel) return { op: true, reden: `het model is onzeker (entropie ${s.entropie.toFixed(2)} boven ${drempel})` };
    }
    return { op: false, reden: s.modelVraagtGroter ? 'het model zegt het zelf -- dat telt niet' : 'geen nakijkbaar signaal' };
  }

  // DE RESERVE is de laatste: alleen als alle telefoons de klus niet aankonden (uitgeput), de reserve expliciet aan staat, en
  // alleen voor de eigen vragen van de eigenaar. Nooit een gratis extern model voor de gebruikers van de gids (de NIET-DOEN-regel).
  // o = { uitgeput, reserveAan, soort ('lokaal-groter'|'betaald'), voorGebruiker }. -> { weg, reden } | null.
  function reserveWeg(o) {
    const op = o || {};
    if (!op.uitgeput) return null;
    if (op.voorGebruiker) return null;                 // reserve is alleen voor eigen vragen, nooit voor een gebruiker van de gids
    if (!op.reserveAan) return { weg: null, reden: 'de reserve staat uit; alles bleef lokaal' };
    const soort = op.soort === 'betaald' ? 'betaald' : 'lokaal-groter';
    return { weg: soort, reden: soort === 'betaald' ? 'alles lokaal faalde -- betaalde reserve (eigen vraag)' : 'alles lokaal faalde -- een groter lokaal model als reserve' };
  }

  // DE BESLISSING als één loggbare regel. labelAntwoord = de uitvoer van leesLabel(). -> { t, vraag, label, titel, weg, trede, gelezen, reden }.
  function beslis(vraag, labelAntwoord, o) {
    const op = o || {};
    const l = labelAntwoord && labelAntwoord.label ? labelAntwoord : { label: TERUGVAL, rauw: null, gelezen: false };
    const b = bestemming(l.label);
    return {
      t: typeof op.nu === 'number' ? op.nu : Date.now(),
      vraag: tekst(vraag).replace(/\s+/g, ' ').trim().slice(0, 120),
      label: b.label, titel: b.titel, weg: b.weg, trede: b.trede, gelezen: l.gelezen !== false,
      reden: l.gelezen === false ? `JSON niet gelezen (${l.rauw == null ? 'geen label' : `"${tekst(l.rauw).slice(0, 40)}"`}) -- terugval op ${INFO[TERUGVAL].titel.toLowerCase()}` : b.uitleg,
    };
  }

  function logregel(beslissing) {
    const b = beslissing || {};
    return `[verdeler] ${b.titel || '?'} (${b.weg || '?'})${b.gelezen === false ? ' · geraden' : ''}: ${tekst(b.vraag).slice(0, 80)}`;
  }

  return { LABELS, INFO, TERUGVAL, ENTROPIE_DREMPEL, ZOEK_SCORE_DREMPEL, maakPrompt, leesLabel, bestemming, entropie, moetOpschalen, reserveWeg, beslis, logregel };
}));
