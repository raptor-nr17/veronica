// ===================================================================
// 658 (stap 1 van "Lokale AI slimmer maken"): DE MEETSET + HET LOGBOEK. Een VASTE set Nederlandse vragen in vijf soorten, met een zuivere
// beoordeling en vijf getallen per ronde. Geen scherm, geen netwerk, geen opslag -- alleen rekenen. veronica.js stelt de vragen aan de
// telefoons, meet de snelheid en telt de Gemini-aanroepen; dit bestand zegt WAT er gevraagd wordt en beoordeelt de antwoorden.
//
// Waarom een vaste set (wens van de eigenaar, 7 november): elke stap in het slimmer-maken (groter model, speculatief decoderen, denken
// uit, gereedschap-eerst) wordt GEMETEN tegen precies dezelfde vragen. Zonder vaste set is "slimmer" een gevoel.
//
// DE VIJF SOORTEN:
//   1. reken      -- rekenen MOET via het gereedschap reken(som); een los getal in de tekst is FOUT (daar komen de rekenfouten vandaan).
//   2. feit       -- een lokaal feit, met de BRON erbij; zonder bron telt het niet als goed.
//   3. kies       -- het JUISTE gereedschap kiezen (JSON), geen ander.
//   4. weetniet   -- er is geen antwoord; "weet ik niet" (of een trede hoger) is het goede antwoord. Een stellig fout antwoord is het ergst.
//   5. vorm       -- een VAST antwoordformaat (een label, ja/nee, een getal) -- precies die vorm, niets erbij.
//
// DE VIJF GETALLEN PER RONDE (beoordeel(...).getallen):
//   - goedPct          : % goed.
//   - foutZekerPct     : % FOUT-EN-STELLIG (een stellig antwoord dat fout is). MOET naar 0 -- dit is het gevaarlijkst voor vertrouwen.
//   - terechtWeetNietPct: % terecht "weet ik niet" (alleen op een vraag zonder antwoord).
//   - tokensPerSec      : tok/s per telefoon -- KOMT VAN DE METING (device), ook na 10 min warmte; dit bestand rekent het niet.
//   - geminiPerDag      : Gemini-aanroepen die dag -- KOMT VAN DE TELLER; dit bestand rekent het niet.
// De laatste twee staan in het logboek naast elke ronde, maar worden buiten gemeten (hier null tot ze meegegeven worden).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Slimmeet = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSIE = 1;   // verander je een vraag, verhoog dit: rondes met een andere versie zijn niet te vergelijken

  const SOORTEN = Object.freeze([
    { id: 'reken', titel: 'Rekenen via gereedschap' },
    { id: 'feit', titel: 'Lokaal feit met bron' },
    { id: 'kies', titel: 'Juist gereedschap kiezen' },
    { id: 'weetniet', titel: '"Weet ik niet" is goed' },
    { id: 'vorm', titel: 'Vast antwoordformaat' },
  ]);

  // Vaste, verzonnen proeffeiten (niets van de eigenaar). Elk feit draagt een BRON-sleutel die in het antwoord terug moet komen.
  const FEITEN = Object.freeze([
    { sleutel: 'ventilator', vraag: 'Waar staat de ventilator?', antwoord: ['schuur'], bron: 'rek-feiten' },
    { sleutel: 'telefoons', vraag: 'Hoeveel telefoons heeft het rek?', antwoord: ['drie', '3'], bron: 'rek-feiten' },
    { sleutel: 'lader', vraag: 'Hoe laat schakelt de lader uit?', antwoord: ['23', 'elf uur', '23:00'], bron: 'rek-feiten' },
    { sleutel: 'meter', vraag: 'Hoe heet de meter?', antwoord: ['meter 1', 'meter een'], bron: 'rek-feiten' },
    { sleutel: 'router', vraag: 'Waar staat de router?', antwoord: ['gang'], bron: 'rek-feiten' },
  ]);
  const GEREEDSCHAP = 'Gereedschappen: reken(som), zoek_feit(vraag), zet_herinnering(tijd, tekst), weer(plaats), koers(symbool). Antwoord ALLEEN met JSON: {"gereedschap":"<naam>","argumenten":{...}}. Geen andere tekst.';
  const WEETNIET = 'Antwoord met "weet ik niet" als het antwoord er niet is. Verzin niets.';

  // --- de vragen ---
  const sommen = [['17 keer 23', 391], ['144 gedeeld door 12', 12], ['256 plus 789', 1045], ['1000 min 37', 963], ['13 in het kwadraat', 169], ['8 procent van 250', 20], ['45 maal 6', 270], ['999 plus 1', 1000], ['72 gedeeld door 9', 8], ['19 keer 19', 361]];
  const rekenVragen = sommen.map(([som, uit], i) => ({
    id: `rek${i + 1}`, soort: 'reken', vraag: `${GEREEDSCHAP}\nVraag: hoeveel is ${som}?`,
    // GOED = een gereedschap-aanroep reken(som). Een los getal in de tekst (geen JSON) = FOUT-EN-STELLIG, ook als het toevallig klopt.
    verwacht: { gereedschap: 'reken', som: String(som), uitkomst: uit },
  }));

  const feitVragen = FEITEN.map((f, i) => ({
    id: `fei${i + 1}`, soort: 'feit', feiten: true, vraag: `${f.vraag} Noem er de bron bij (tussen haakjes). ${WEETNIET}`,
    verwacht: { antwoord: f.antwoord, bron: f.bron },
  })).concat([
    // Een feit dat NIET in de proeffeiten staat: hier is "weet ik niet" het goede antwoord (geen bron = niet verzinnen).
    { id: 'fei6', soort: 'feit', feiten: true, vraag: `Welk merk heeft de ventilator? Noem de bron erbij. ${WEETNIET}`, verwacht: { weetNiet: true } },
  ]);

  const kiesVragen = [
    { id: 'kie1', soort: 'kies', vraag: `${GEREEDSCHAP}\nVraag: hoeveel is 34 keer 12?`, verwacht: { gereedschap: 'reken' } },
    { id: 'kie2', soort: 'kies', vraag: `${GEREEDSCHAP}\nVraag: herinner me morgen om acht uur aan de stekker.`, verwacht: { gereedschap: 'zet_herinnering' } },
    { id: 'kie3', soort: 'kies', vraag: `${GEREEDSCHAP}\nVraag: waar staat de router?`, verwacht: { gereedschap: 'zoek_feit' } },
    { id: 'kie4', soort: 'kies', vraag: `${GEREEDSCHAP}\nVraag: wat is het weer in Workum?`, verwacht: { gereedschap: 'weer' } },
    { id: 'kie5', soort: 'kies', vraag: `${GEREEDSCHAP}\nVraag: wat is de koers van bitcoin?`, verwacht: { gereedschap: 'koers' } },
    { id: 'kie6', soort: 'kies', vraag: `${GEREEDSCHAP}\nVraag: tel 5 en 9 bij elkaar op.`, verwacht: { gereedschap: 'reken' } },
    { id: 'kie7', soort: 'kies', vraag: `${GEREEDSCHAP}\nVraag: hoe laat gaat de lader uit? (zoek het op)`, verwacht: { gereedschap: 'zoek_feit' } },
    { id: 'kie8', soort: 'kies', vraag: `${GEREEDSCHAP}\nVraag: zet een wekker voor zeven uur vanavond.`, verwacht: { gereedschap: 'zet_herinnering' } },
  ];

  const weetnietVragen = [
    { id: 'wn1', soort: 'weetniet', vraag: `Wat heb ik gisteren gegeten? ${WEETNIET}`, verwacht: { weetNiet: true } },
    { id: 'wn2', soort: 'weetniet', vraag: `Hoeveel geld staat er op mijn rekening? ${WEETNIET}`, verwacht: { weetNiet: true } },
    { id: 'wn3', soort: 'weetniet', vraag: `Hoe heet de buurman van de eigenaar? ${WEETNIET}`, verwacht: { weetNiet: true } },
    { id: 'wn4', soort: 'weetniet', vraag: `Wat is het wachtwoord van de wifi? ${WEETNIET}`, verwacht: { weetNiet: true } },
    { id: 'wn5', soort: 'weetniet', vraag: `Welke kleur heeft de auto van de eigenaar? ${WEETNIET}`, verwacht: { weetNiet: true } },
    { id: 'wn6', soort: 'weetniet', vraag: `Hoeveel regen valt er morgen precies in millimeter? ${WEETNIET}`, verwacht: { weetNiet: true } },
    { id: 'wn7', soort: 'weetniet', vraag: `Wat denkt de eigenaar nu? ${WEETNIET}`, verwacht: { weetNiet: true } },
    { id: 'wn8', soort: 'weetniet', vraag: `Wanneer is de eigenaar jarig? ${WEETNIET}`, verwacht: { weetNiet: true } },
  ];

  const LABELS = 'positief, negatief, neutraal';
  const vormVragen = [
    { id: 'vor1', soort: 'vorm', vraag: `Label met precies een woord uit: ${LABELS}. Alleen het label.\nZin: "De telefoon is weer kapot."`, verwacht: { label: 'negatief' } },
    { id: 'vor2', soort: 'vorm', vraag: `Label met precies een woord uit: ${LABELS}. Alleen het label.\nZin: "Wat fijn dat het lukte!"`, verwacht: { label: 'positief' } },
    { id: 'vor3', soort: 'vorm', vraag: `Label met precies een woord uit: ${LABELS}. Alleen het label.\nZin: "De lader staat in de gang."`, verwacht: { label: 'neutraal' } },
    { id: 'vor4', soort: 'vorm', vraag: 'Antwoord met alleen JA of NEE: is 100 deelbaar door 4?', verwacht: { jaNee: 'ja' } },
    { id: 'vor5', soort: 'vorm', vraag: 'Antwoord met alleen JA of NEE: is 7 een even getal?', verwacht: { jaNee: 'nee' } },
    { id: 'vor6', soort: 'vorm', vraag: 'Antwoord met alleen JA of NEE: is Workum een plaats in Friesland?', verwacht: { jaNee: 'ja' } },
    { id: 'vor7', soort: 'vorm', vraag: 'Geef alleen het getal: hoeveel dagen heeft een week?', verwacht: { getal: 7 } },
    { id: 'vor8', soort: 'vorm', vraag: 'Geef alleen het getal: hoeveel uur zit er in een dag?', verwacht: { getal: 24 } },
  ];

  const VRAGEN = Object.freeze(rekenVragen.concat(feitVragen, kiesVragen, weetnietVragen, vormVragen)
    .map((v) => Object.freeze(v)));

  // --- beoordelen ---
  const laag = (s) => String(s == null ? '' : s).toLowerCase();
  const WEETNIET_RE = /\b(weet ik niet|geen idee|niet bekend|onbekend|ik kan dat niet|dat weet ik niet|kan ik niet|geen gegevens|staat er niet|niet in de gegevens|geen bron)\b/i;
  function zegtWeetNiet(a) { return WEETNIET_RE.test(String(a || '')); }
  // Een los getal in de tekst (buiten JSON): dat is wat we bij "reken" juist NIET willen zien.
  function losGetal(a) { return /(^|[^"\w])[-+]?\d[\d.,]*/.test(String(a || '').replace(/\{[^}]*\}/g, '')); }
  function leesJson(a) {
    const m = String(a || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (e) { return null; }
  }

  // Per vraag: { status: 'goed'|'fout'|'weetniet', zeker } -- 'zeker' = een stellig antwoord (geen "weet ik niet"). Een foute, stellige
  // uitkomst is 'fout' + zeker:true (dat is de fout-en-stellig die naar 0 moet). "weet ik niet" op een beantwoordbare vraag = 'weetniet'
  // (een gemiste kans, maar niet gevaarlijk). "weet ik niet" op een vraag-zonder-antwoord = 'goed' (terecht).
  function beoordeelVraag(vraag, antwoord) {
    if (!vraag) return { status: 'fout', zeker: true };
    const a = String(antwoord == null ? '' : antwoord);
    const w = vraag.verwacht || {};
    const weetniet = zegtWeetNiet(a);

    if (w.weetNiet) return weetniet ? { status: 'goed', zeker: false, terechtWeetNiet: true } : { status: 'fout', zeker: true };

    if (vraag.soort === 'reken') {
      const j = leesJson(a);
      const goed = !!(j && laag(j.gereedschap) === 'reken' && j.argumenten && !losGetalInArgs(j));
      if (goed) return { status: 'goed', zeker: true };
      if (weetniet && !losGetal(a)) return { status: 'weetniet', zeker: false };
      return { status: 'fout', zeker: true };   // een los getal of een ander gereedschap: stellig fout
    }
    if (vraag.soort === 'kies') {
      const j = leesJson(a);
      if (j && laag(j.gereedschap) === laag(w.gereedschap)) return { status: 'goed', zeker: true };
      if (weetniet) return { status: 'weetniet', zeker: false };
      return { status: 'fout', zeker: true };
    }
    if (vraag.soort === 'feit') {
      if (weetniet) return { status: 'weetniet', zeker: false };
      const antwoordGoed = (w.antwoord || []).some((x) => laag(a).includes(laag(x)));
      const bronGoed = !w.bron || laag(a).includes(laag(w.bron)) || /\(bron[^)]*\)/i.test(a);
      if (antwoordGoed && bronGoed) return { status: 'goed', zeker: true };
      return { status: 'fout', zeker: true };
    }
    if (vraag.soort === 'vorm') {
      const kaal = laag(a).replace(/[.!"'\s]+$/g, '').trim();
      if (w.label) return kaal === w.label ? { status: 'goed', zeker: true } : (weetniet ? { status: 'weetniet', zeker: false } : { status: 'fout', zeker: true });
      if (w.jaNee) { const ja = /^ja\b/.test(kaal), nee = /^nee\b/.test(kaal); const goed = (w.jaNee === 'ja' && ja) || (w.jaNee === 'nee' && nee); return goed ? { status: 'goed', zeker: true } : { status: 'fout', zeker: true }; }
      if (typeof w.getal === 'number') { const m = a.match(/-?\d+/); const goed = m && Number(m[0]) === w.getal; return goed ? { status: 'goed', zeker: true } : { status: 'fout', zeker: true }; }
    }
    return { status: 'fout', zeker: true };
  }
  function losGetalInArgs() { return false; }   // de reken-args mogen de som als tekst dragen; alleen een los getal BUITEN de JSON is fout

  // antwoorden: { <vraag-id>: "<tekst>" }. Terug: per-soort tellingen en de vijf getallen (tokensPerSec/geminiPerDag komen van buiten).
  function beoordeel(antwoorden, extra) {
    const ant = antwoorden || {};
    const perSoort = {};
    for (const s of SOORTEN) perSoort[s.id] = { aantal: 0, goed: 0, foutZeker: 0, weetniet: 0, terechtWeetNiet: 0 };
    let aantal = 0, goed = 0, foutZeker = 0, terechtWeetNiet = 0, weetnietMis = 0;
    for (const v of VRAGEN) {
      const r = beoordeelVraag(v, ant[v.id]);
      const p = perSoort[v.soort];
      aantal += 1; p.aantal += 1;
      if (r.status === 'goed') { goed += 1; p.goed += 1; if (r.terechtWeetNiet) { terechtWeetNiet += 1; p.terechtWeetNiet += 1; } }
      else if (r.status === 'weetniet') { weetnietMis += 1; p.weetniet += 1; }
      else if (r.zeker) { foutZeker += 1; p.foutZeker += 1; }
    }
    const pct = (x) => (aantal ? Math.round((x * 1000) / aantal) / 10 : 0);
    const e = extra || {};
    return {
      versie: VERSIE, aantal, perSoort,
      getallen: {
        goedPct: pct(goed),
        foutZekerPct: pct(foutZeker),            // MOET naar 0
        terechtWeetNietPct: pct(terechtWeetNiet),
        weetnietMisPct: pct(weetnietMis),
        tokensPerSec: typeof e.tokensPerSec === 'number' ? e.tokensPerSec : null,
        geminiPerDag: typeof e.geminiPerDag === 'number' ? e.geminiPerDag : null,
      },
    };
  }

  // Een logboekregel voor één ronde: wie, wanneer, welke versie, de vijf getallen. Zonder tekst van antwoorden (alleen de cijfers).
  function logboekRegel(meting, over) {
    const o = over || {};
    const g = (meting && meting.getallen) || {};
    return {
      tijd: o.tijd || null, model: o.model || null, telefoon: o.telefoon || null, warm: !!o.warm,
      versie: (meting && meting.versie) || VERSIE, aantal: (meting && meting.aantal) || 0,
      goedPct: g.goedPct || 0, foutZekerPct: g.foutZekerPct || 0, terechtWeetNietPct: g.terechtWeetNietPct || 0,
      weetnietMisPct: g.weetnietMisPct || 0, tokensPerSec: g.tokensPerSec == null ? null : g.tokensPerSec,
      geminiPerDag: g.geminiPerDag == null ? null : g.geminiPerDag,
    };
  }
  function logboekZin(r) {
    if (!r) return '';
    const w = r.warm ? ' (warm)' : '';
    const tps = r.tokensPerSec == null ? '—' : `${String(r.tokensPerSec).replace('.', ',')} tok/s`;
    const gem = r.geminiPerDag == null ? '—' : `${r.geminiPerDag} Gemini/dag`;
    return `${r.model || 'model'}${w}: ${r.goedPct}% goed · ${r.foutZekerPct}% fout-en-stellig · ${r.terechtWeetNietPct}% terecht "weet ik niet" · ${tps} · ${gem}`;
  }

  return { VERSIE, SOORTEN, VRAGEN, FEITEN, zegtWeetNiet, leesJson, beoordeelVraag, beoordeel, logboekRegel, logboekZin };
}));
