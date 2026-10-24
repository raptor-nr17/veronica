// ===================================================================
// 553: DE TRAP, VAN KLEIN NAAR GROOT -- alle telefoons tegelijk, elk met het kleinste model dat goed genoeg is. Rekent alleen:
// geen netwerk, geen opslag, geen model. veronica.js stuurt de stukjes naar de telefoons en roept dit aan voor elke keuze.
// ===================================================================
//
// Afspraak met de eigenaar (24 oktober):
//  - EEN model over meerdere telefoons verdelen is trager (het wifi). Dus niet: elke telefoon houdt EEN model geladen en doet een
//    heel stukje. Meer telefoons = meer stukjes tegelijk.
//  - DE TRAP: klein, dan E2B, dan E4B. Fenna knipt het doel in stukjes; elk stukje begint op het kleinste model dat voor DAT soort klus
//    goed genoeg scoort in de slimheidsmeter. Haalt een antwoord de CONTROLE niet, dan schuift het stukje door naar het volgende grotere
//    model op een ANDERE telefoon. Opschalen gebeurt op de controle of een lage score, nooit op wat het model zelf over zichzelf zegt.
//  - DE F8 (het gast-brein, E4B) ALLEEN ALS HET NIET ANDERS KAN: als de kleinere modellen de controle niet haalden, als alle andere
//    telefoons vol of te warm zijn, en voor het samenvoegen en de eindcontrole. Elke keer met de reden erbij (F8_REDEN), voor Veronica.
//    De regels van het gast-brein zelf (accu, thuis, niet in gebruik, warmte) gelden al voordat hij hier als groen binnenkomt.
//  - Belangrijke vragen gaan DUBBEL naar twee telefoons; het eerste antwoord dat de controle haalt wint. Nooit dubbel naar de F8.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Trap = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TRAP = Object.freeze(['klein', 'E2B', 'E4B']);
  // Soort klus -> de groep van de slimheidsmeter die erover gaat.
  const SOORTEN = Object.freeze({
    algemeen: { titel: 'Algemene vraag', groep: 'kort' },
    samenvatten: { titel: 'Samenvatten', groep: 'samenvatten' },
    labelen: { titel: 'Labelen', groep: 'labelen' },
    json: { titel: 'Gegevens als JSON', groep: 'gereedschap' },
    feit: { titel: 'Feit terugvinden', groep: 'feit' },
  });
  const DREMPEL = 0.7;          // een trede is "goed genoeg" voor een soort klus vanaf 70% goed in die groep
  const MAX_STUKKEN = 24;
  const MAX_RIJ = 3;            // hoeveel stukjes een telefoon hoogstens in de rij heeft voor hij "vol" is
  const F8_REDEN = Object.freeze({
    controle: 'de kleinere modellen haalden de controle niet',
    vol: 'alle andere telefoons zijn vol of te warm',
    samenvoegen: 'het samenvoegen en de eindcontrole',
    'geen-groter': 'geen andere telefoon heeft een groot genoeg model',
  });

  const tekst = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
  const trapNr = (t) => TRAP.indexOf(t);
  function volgende(trede) { const i = trapNr(trede); return i >= 0 && i < TRAP.length - 1 ? TRAP[i + 1] : null; }

  // Welke trede draait een telefoon? Uit wat hij zelf meldt (gast-brein = E4B; de modelnaam; de lichte motor = klein).
  function trede(info) {
    const x = info || {};
    if (x.gast) return 'E4B';
    const naam = tekst(x.model).toLowerCase();
    if (/e4b/.test(naam)) return 'E4B';
    if (/e2b/.test(naam)) return 'E2B';
    if (x.soort === 'klein' || /qwen|smol|gemma-?3-?1b|0\.6b|0\.8b|360m|1b\b/.test(naam)) return 'klein';
    return x.soort === 'zwaar' ? 'E4B' : 'E2B';
  }
  // De score van een trede voor een soort klus, uit de metingen van de slimheidsmeter (de nieuwste per telefoon+model). 0..1 of null.
  function score(metingen, telefoon, model, groep) {
    const m = (Array.isArray(metingen) ? metingen : []).filter((x) => x && x.telefoon === telefoon && (!model || x.model === model) && x.groepen && x.groepen[groep])
      .sort((a, b) => (b.t || 0) - (a.t || 0))[0];
    const g = m && m.groepen[groep];
    return g && g.van ? g.goed / g.van : null;
  }

  // HET MODELKAARTJE van een telefoon: model, trede, geheugen, gemeten snelheid, gemeten slimheid per groep en de status.
  // tel = { id, naam, gast, model, soort, ram, tps, kleur ('groen'|'oranje'|'rood'), reden, temp, warm }, metingen = slimheidsmetingen.
  function kaartje(tel, metingen) {
    const t = tel || {};
    const tr = trede(t);
    const slim = {};
    for (const s of Object.keys(SOORTEN)) slim[s] = score(metingen, t.naam, t.slimModel || null, SOORTEN[s].groep);
    const warm = typeof t.temp === 'number' && t.temp >= 38;
    const status = warm ? 'rood' : (t.kleur === 'groen' || t.kleur === 'oranje' || t.kleur === 'rood' ? t.kleur : 'rood');
    return {
      id: tekst(t.id), naam: tekst(t.naam).slice(0, 40) || 'Een telefoon', gast: t.gast === true, model: tekst(t.model).slice(0, 60) || 'onbekend', trede: tr,
      ramGb: typeof t.ram === 'number' ? t.ram : null, tps: typeof t.tps === 'number' && t.tps > 0 ? t.tps : null, slim, status,
      reden: warm ? 'te warm (38 graden of meer)' : tekst(t.reden).slice(0, 120),
    };
  }
  function kaartjeZin(k) {
    const s = Object.entries(k.slim).filter(([, v]) => v !== null).map(([n, v]) => `${SOORTEN[n].titel.toLowerCase()} ${Math.round(v * 100)}%`);
    return `${k.naam}${k.gast ? ' (gast-brein)' : ''}: ${k.model} (${k.trede})${k.ramGb ? ` · ${String(k.ramGb).replace('.', ',')} GB` : ''}`
      + ` · ${k.tps ? `±${String(Math.round(k.tps * 10) / 10).replace('.', ',')} tokens/s` : 'tempo nog niet gemeten'}`
      + ` · ${s.length ? s.join(', ') : 'slimheid nog niet gemeten'} · ${k.status === 'groen' ? 'doet mee' : `doet niet mee${k.reden ? ` (${k.reden})` : ''}`}`;
  }

  // Waar begint een soort klus? Op klein als een kleine telefoon voor die soort goed genoeg scoort (gemeten!); anders op E2B.
  // E4B is nooit het begin: daar komt een stukje alleen als de controle op een kleiner model faalde.
  function beginTrede(soort, kaartjes) {
    const s = SOORTEN[soort] ? soort : 'algemeen';
    const klein = (kaartjes || []).filter((k) => k.trede === 'klein' && !k.gast && k.status === 'groen');
    const goed = klein.some((k) => typeof k.slim[s] === 'number' && k.slim[s] >= DREMPEL);
    if (goed) return { trede: 'klein', reden: `een klein model scoort voor ${SOORTEN[s].titel.toLowerCase()} ${Math.round(Math.max(...klein.map((k) => k.slim[s] || 0)) * 100)}%` };
    if (!klein.length) return { trede: 'E2B', reden: 'er doet geen telefoon met een klein model mee' };
    return { trede: 'E2B', reden: klein.some((k) => typeof k.slim[s] === 'number') ? `de kleine modellen scoren voor ${SOORTEN[s].titel.toLowerCase()} onder ${Math.round(DREMPEL * 100)}%` : 'de kleine modellen zijn voor deze soort nog niet gemeten' };
  }

  // FENNA KNIPT: een lijst (genummerd of met streepjes) wordt een stukje per regel; anders per alinea; een lange alinea in zinnen tot
  // ~600 tekens. Een doel met een eigen lijst stukjes (doel.stukken) blijft zoals het is. Hoogstens MAX_STUKKEN.
  function knip(doel) {
    if (doel && Array.isArray(doel.stukken)) return doel.stukken.map(tekst).map((x) => x.trim()).filter(Boolean).slice(0, MAX_STUKKEN).map((x, i) => ({ nr: i + 1, tekst: x }));
    const t = tekst(doel && typeof doel === 'object' ? doel.tekst : doel).replace(/\r/g, '').trim();
    if (!t) return [];
    const regels = t.split('\n').map((r) => r.trim()).filter(Boolean);
    const lijst = regels.filter((r) => /^(\d+[.)]|[-*•])\s+/.test(r));
    let delen;
    if (lijst.length >= 2) delen = lijst.map((r) => r.replace(/^(\d+[.)]|[-*•])\s+/, ''));
    else {
      const alineas = t.split(/\n\s*\n/).map((a) => a.replace(/\s+/g, ' ').trim()).filter(Boolean);
      delen = [];
      for (const a of alineas) {
        if (a.length <= 700) { delen.push(a); continue; }
        let stuk = '';
        for (const zin of a.match(/[^.!?]+[.!?]*\s*/g) || [a]) {
          if ((stuk + zin).length > 600 && stuk) { delen.push(stuk.trim()); stuk = ''; }
          stuk += zin;
        }
        if (stuk.trim()) delen.push(stuk.trim());
      }
    }
    return delen.filter(Boolean).slice(0, MAX_STUKKEN).map((x, i) => ({ nr: i + 1, tekst: x }));
  }

  // WIE DOET DIT STUKJE? De telefoons zonder F8 met een model van deze trede of groter (nooit een kleinere); de minst belaste eerst,
  // dan het kleinste model, dan de snelste. De F8 alleen met een reden. rij = { id: aantal stukjes in de rij }, nietDeze = telefoons die dit stukje
  // al deden (doorschuiven gaat naar een ANDERE telefoon). Terug { telefoon, f8Reden } of null (niemand kan het nu).
  function kies(trede0, kaartjes, rij, o) {
    const op = o || {};
    const nr = trapNr(trede0);
    const niet = new Set(op.nietDeze || []);
    const last = (k) => (rij && rij[k.id]) || 0;
    const groen = (kaartjes || []).filter((k) => k.status === 'groen' && !niet.has(k.id));
    const gewoon = groen.filter((k) => !k.gast);
    const vrij = gewoon.filter((k) => last(k) < (op.maxRij || MAX_RIJ));
    // ZOVEEL MOGELIJK TEGELIJK: eerst wie het minst te doen heeft; bij gelijke rij het kleinste passende model, dan de snelste.
    const passend = vrij.filter((k) => trapNr(k.trede) >= nr)
      .sort((a, b) => (last(a) - last(b)) || (trapNr(a.trede) - trapNr(b.trede)) || ((b.tps || 0) - (a.tps || 0)) || a.naam.localeCompare(b.naam));
    // OVERLOOP: een telefoon met een KLEINER model dat voor deze soort klus nog NIET gemeten is, mag het proberen als hij minder te doen
    // heeft dan de passende telefoons (of als die vol zijn) -- zo staat er geen telefoon stil, en de controle schuift het door als het
    // niet goed is. Een model dat gemeten is en te laag scoort nooit; een doorgeschoven stukje gaat nooit omlaag.
    const over = op.soort && !op.doorgeschoven ? vrij.filter((k) => trapNr(k.trede) < nr && k.slim && k.slim[op.soort] === null)
      .sort((a, b) => (last(a) - last(b)) || ((b.tps || 0) - (a.tps || 0)) || a.naam.localeCompare(b.naam)) : [];
    if (over.length && (!passend.length || last(over[0]) < last(passend[0]))) return { telefoon: over[0], f8Reden: null, overloop: true };
    if (passend.length) return { telefoon: passend[0], f8Reden: null };
    if (op.geenF8) return null;
    const f8 = groen.find((k) => k.gast);
    if (!f8 || trapNr(f8.trede) < nr) return null;
    // Waarom de F8? Is er nog een gewone telefoon met een groot genoeg model (maar vol of te warm), dan "vol"; heeft dit stukje de
    // controle al eens niet gehaald, dan "controle"; anders heeft geen andere telefoon een groot genoeg model.
    const groterBestaat = (kaartjes || []).some((k) => !k.gast && trapNr(k.trede) >= nr && !niet.has(k.id));
    const reden = op.doorgeschoven ? 'controle' : (groterBestaat || !vrij.length) ? 'vol' : 'geen-groter';
    return { telefoon: f8, f8Reden: reden };
  }
  // Het eerste plan: elk stukje op zijn begintrede, verdeeld over alle groene telefoons (zoveel mogelijk tegelijk).
  function plan(stukken, kaartjes, o) {
    const op = o || {};
    const begin = beginTrede(op.soort, kaartjes);
    const rij = {};
    const uit = [];
    for (const s of stukken || []) {
      const k = kies(begin.trede, kaartjes, rij, { maxRij: op.maxRij, soort: op.soort });
      if (!k) { uit.push({ nr: s.nr, trede: begin.trede, telefoon: null, f8Reden: null, dubbel: null }); continue; }
      rij[k.telefoon.id] = (rij[k.telefoon.id] || 0) + 1;
      let dubbel = null;
      if (op.belangrijk) {
        const d = kies(begin.trede, kaartjes, rij, { maxRij: Infinity, nietDeze: [k.telefoon.id], geenF8: true, soort: op.soort });
        if (d) { dubbel = d.telefoon; rij[d.telefoon.id] = (rij[d.telefoon.id] || 0) + 1; }
      }
      uit.push({ nr: s.nr, trede: k.telefoon.gast ? 'E4B' : (k.overloop ? k.telefoon.trede : begin.trede), telefoon: k.telefoon, f8Reden: k.f8Reden, overloop: !!k.overloop, dubbel });
    }
    return { begin, toewijzing: uit };
  }
  // Wie voegt samen? De F8 als hij groen is (dat is zijn taak); anders de grootste trede die er is, de snelste eerst.
  function samenvoeger(kaartjes) {
    const groen = (kaartjes || []).filter((k) => k.status === 'groen');
    const f8 = groen.find((k) => k.gast);
    if (f8) return { telefoon: f8, f8Reden: 'samenvoegen' };
    const rest = groen.slice().sort((a, b) => (trapNr(b.trede) - trapNr(a.trede)) || ((b.tps || 0) - (a.tps || 0)));
    return rest.length ? { telefoon: rest[0], f8Reden: null } : null;
  }

  // DE CONTROLE (de code, geen model): leeg, weigering, herhaling, te kort, niet Nederlands, JSON die niet leest, een label dat geen
  // label is, een samenvatting die langer is dan het stuk. -> { ok, reden }
  const NL = ['de', 'het', 'een', 'en', 'van', 'niet', 'op', 'te', 'dat', 'die', 'voor', 'met', 'zijn', 'er', 'aan', 'ook', 'als', 'bij', 'maar', 'om', 'dan', 'naar', 'wordt', 'je', 'ik', 'we', 'deze', 'dit'];
  const EN = ['the', 'and', 'of', 'to', 'that', 'with', 'for', 'this', 'are', 'was', 'you', 'not', 'but', 'from', 'they', 'have'];
  const woorden = (x) => tekst(x).toLowerCase().replace(/[^a-zà-ÿ0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  function controle(soort, stuk, antwoord) {
    const a = tekst(antwoord).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    if (!a) return { ok: false, reden: 'leeg antwoord' };
    if (/als (een )?(ai|taalmodel)|as an ai|ik kan (je )?daar niet mee helpen|i can(no|')t help/i.test(a)) return { ok: false, reden: 'weigert of praat over zichzelf' };
    const w = woorden(a);
    if (soort === 'json') {
      const s = a.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      try { const j = JSON.parse(s); if (!j || typeof j !== 'object') return { ok: false, reden: 'geen JSON-object' }; } catch (e) { return { ok: false, reden: 'JSON leest niet' }; }
      return { ok: true, reden: '' };
    }
    if (soort === 'labelen') return w.length >= 1 && w.length <= 6 && !a.includes('\n') ? { ok: true, reden: '' } : { ok: false, reden: 'geen kort label' };
    if (a.replace(/\s+/g, ' ').toLowerCase() === tekst(stuk).replace(/\s+/g, ' ').trim().toLowerCase()) return { ok: false, reden: 'herhaalt alleen het stuk' };
    if (w.length < 3) return { ok: false, reden: 'te kort' };
    const nl = w.filter((x) => NL.includes(x)).length, en = w.filter((x) => EN.includes(x)).length;
    if (w.length >= 8 && en > nl) return { ok: false, reden: 'niet in het Nederlands' };
    if (soort === 'samenvatten') {
      const ws = woorden(stuk);
      if (ws.length >= 20 && w.length > Math.max(60, Math.round(ws.length * 0.8))) return { ok: false, reden: 'langer dan een samenvatting' };
      const inhoud = new Set(ws.filter((x) => x.length > 4));
      if (inhoud.size && !w.some((x) => inhoud.has(x))) return { ok: false, reden: 'heeft niets met het stuk te maken' };
    }
    return { ok: true, reden: '' };
  }

  // Wat elke telefoon voor zijn stukje krijgt, en wat de samenvoeger krijgt. Kort en zonder iets van de privé-hoek.
  function opdracht(soort, doel, stuk, totaal) {
    const s = SOORTEN[soort] ? soort : 'algemeen';
    const wat = { algemeen: 'Beantwoord dit deel kort en feitelijk', samenvatten: 'Vat dit deel samen in hoogstens twee zinnen', labelen: 'Geef dit deel een label van hoogstens vier woorden, niets anders',
      json: 'Zet de gegevens in dit deel in een JSON-object, niets anders', feit: 'Zoek in dit deel het gevraagde feit; staat het er niet in, zeg dat' }[s];
    return `${wat}. Het hele doel: ${tekst(doel).slice(0, 300)}\nDeel ${stuk.nr} van ${totaal}:\n${tekst(stuk.tekst).slice(0, 1500)}\nAntwoord in het Nederlands.`;
  }
  function samenvoegOpdracht(soort, doel, delen) {
    const d = (delen || []).map((x) => `Deel ${x.nr}: ${tekst(x.antwoord).slice(0, 800)}`).join('\n');
    return `Voeg deze deelantwoorden samen tot een antwoord op het doel. Verzin niets wat niet in de delen staat. Het doel: ${tekst(doel).slice(0, 300)}\n${d}\nAntwoord in het Nederlands.${soort === 'json' ? ' Geef een JSON-object.' : ''}`;
  }

  // 556: FENNA BEPAALT ZELF DE SOORT KLUS (het keuzevak is weg). Gewone code op de woorden van de vraag; twijfel = algemeen.
  function raadSoort(tekst) {
    const t = String(tekst || '').toLowerCase();
    if (/\bjson\b|als (een )?(lijst|tabel) met (velden|kolommen)|in velden/.test(t)) return 'json';
    if (/vat .*samen|samenvatting|samenvatten|in het kort|kort samen/.test(t)) return 'samenvatten';
    if (/\blabel|\bcategorie|indelen|sorteer .* in|welke soort|classificeer/.test(t)) return 'labelen';
    if (/^(wat|wie|wanneer|waar|hoeveel|welk|welke|hoe laat|in welk)\b.{0,160}\?\s*$/.test(t.trim()) && t.length < 200) return 'feit';
    return 'algemeen';
  }
  return { raadSoort, TRAP, SOORTEN, DREMPEL, MAX_STUKKEN, MAX_RIJ, F8_REDEN, volgende, trede, score, kaartje, kaartjeZin, beginTrede, knip, kies, plan, samenvoeger, controle, opdracht, samenvoegOpdracht };
}));
