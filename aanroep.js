// ===================================================================
// 678 (eigenaar 11 nov 17:41, punt 3): DE VERDELER OP EEN HEEL KLEIN MODEL met STRIKTE schemacontrole op de uitvoer. Een klein model (Qwen3 0.6B of
// FunctionGemma) schrijft een JSON-aanroep; deze module leest die ALS ONBETROUWBAAR: alleen een geldige aanroep tegen een vast schema komt erdoor. Bij een
// ongeldige aanroep: opnieuw proberen (met de reden erbij) of OMHOOG sturen; NOOIT de aanroep blind uitvoeren.
// PUUR rekenen in CODE: geen netwerk, geen opslag, geen DOM, geen model. De uitvoerder (het model) komt binnen als functie.
//
// Regels van het schema (bewust streng; een klein model is onbetrouwbaar):
//  - EEN JSON-object, geen tekst eromheen die iets uitvoerbaars bevat (denk-blokken en code-hekjes mogen eraf);
//  - GEEN onbekende velden, GEEN ontbrekende verplichte velden;
//  - elk veld precies van zijn type: een enum alleen een exacte waarde, een boolean alleen true/false (geen "true"), een getal eindig en binnen zijn grens,
//    een tekst zonder stuurtekens en binnen zijn lengte;
//  - bij een aanroep van een gereedschap: de NAAM moet op de lijst staan (allowlist), de argumenten volgen het schema van dat gereedschap.
// Afspraak: geen merk, persoon of plaats in dit bestand (het gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek(require('./trap.js'));
  else wortel.Aanroep = fabriek(wortel.Trap);
}(typeof self !== 'undefined' ? self : this, function (Trap) {
  'use strict';

  const MAX_RAW = 4000;            // een antwoord van een klein model dat hier langer is, is al verdacht
  const MAX_POGINGEN = 2;          // een keer opnieuw, daarna omhoog

  // Het schema van de verdeler: de soort klus (alleen soorten die de trap kent) en of het zwaar is.
  const VERDELER_SCHEMA = Object.freeze({
    soort: { type: 'enum', waarden: Object.keys((Trap && Trap.SOORTEN) || { algemeen: 1, samenvatten: 1, labelen: 1, json: 1, feit: 1 }), verplicht: true },
    zwaar: { type: 'bool', verplicht: true },
  });

  const stuur = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

  // uitJson(raw): het EERSTE complete JSON-object uit de tekst van een model, of null. Denk-blokken en code-hekjes eraf; daarna de eerste evenwichtige {...}.
  function uitJson(raw) {
    let t = String(raw == null ? '' : raw).slice(0, MAX_RAW);
    t = t.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim();
    const i = t.indexOf('{'); if (i < 0) return null;
    let diep = 0, instr = false, esc = false;
    for (let k = i; k < t.length; k++) {
      const c = t[k];
      if (instr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') instr = false; continue; }
      if (c === '"') instr = true; else if (c === '{') diep++; else if (c === '}') { diep--; if (diep === 0) return t.slice(i, k + 1); }
    }
    return null;
  }

  // controleer(waarde, schema): { ok, fout }. Streng: onbekende velden, ontbrekende verplichte velden en een verkeerd type zijn allemaal een fout.
  function controleer(waarde, schema) {
    if (!waarde || typeof waarde !== 'object' || Array.isArray(waarde)) return { ok: false, fout: 'geen JSON-object' };
    const velden = Object.keys(schema);
    for (const k of Object.keys(waarde)) if (velden.indexOf(k) < 0) return { ok: false, fout: `onbekend veld "${k}"` };
    for (const k of velden) {
      const s = schema[k]; const w = waarde[k];
      if (w === undefined) { if (s.verplicht) return { ok: false, fout: `veld "${k}" ontbreekt` }; continue; }
      if (s.type === 'enum') { if (typeof w !== 'string' || s.waarden.indexOf(w) < 0) return { ok: false, fout: `"${k}" moet een van ${s.waarden.join('/')} zijn` }; }
      else if (s.type === 'bool') { if (w !== true && w !== false) return { ok: false, fout: `"${k}" moet true of false zijn` }; }
      else if (s.type === 'getal') { if (typeof w !== 'number' || !isFinite(w) || (s.min != null && w < s.min) || (s.max != null && w > s.max)) return { ok: false, fout: `"${k}" is geen geldig getal` }; }
      else if (s.type === 'tekst') { if (typeof w !== 'string' || w.length > (s.maxLen || 200) || stuur.test(w)) return { ok: false, fout: `"${k}" is geen geldige tekst` }; }
      else return { ok: false, fout: `onbekend veldtype in het schema voor "${k}"` };
    }
    return { ok: true, fout: '' };
  }

  // lees(raw, schema): { ok, waarde, fout }. Het model-antwoord wordt NOOIT uitgevoerd; dit levert alleen een geldige waarde of een reden.
  function lees(raw, schema) {
    const j = uitJson(raw);
    if (j == null) return { ok: false, waarde: null, fout: 'geen JSON-object gevonden' };
    let w; try { w = JSON.parse(j); } catch (e) { return { ok: false, waarde: null, fout: 'JSON leest niet' }; }
    const c = controleer(w, schema);
    return c.ok ? { ok: true, waarde: w, fout: '' } : { ok: false, waarde: null, fout: c.fout };
  }

  // leesAanroep(raw, gereedschappen): een gereedschapsaanroep { naam, argumenten } tegen een ALLOWLIST: gereedschappen = { naam: schemaVanDeArgumenten }.
  // Een naam die niet op de lijst staat is een fout; de argumenten volgen het schema van DAT gereedschap.
  function leesAanroep(raw, gereedschappen) {
    const lijst = gereedschappen && typeof gereedschappen === 'object' ? gereedschappen : {};
    const schema = { naam: { type: 'enum', waarden: Object.keys(lijst), verplicht: true } };
    const j = uitJson(raw); if (j == null) return { ok: false, aanroep: null, fout: 'geen JSON-object gevonden' };
    let w; try { w = JSON.parse(j); } catch (e) { return { ok: false, aanroep: null, fout: 'JSON leest niet' }; }
    if (!w || typeof w !== 'object' || Array.isArray(w)) return { ok: false, aanroep: null, fout: 'geen JSON-object' };
    const kop = controleer({ naam: w.naam }, schema); if (!kop.ok) return { ok: false, aanroep: null, fout: 'gereedschap niet toegestaan: ' + kop.fout };
    for (const k of Object.keys(w)) if (k !== 'naam' && k !== 'argumenten') return { ok: false, aanroep: null, fout: `onbekend veld "${k}"` };
    const arg = controleer(w.argumenten === undefined ? {} : w.argumenten, lijst[w.naam]);
    return arg.ok ? { ok: true, aanroep: { naam: w.naam, argumenten: w.argumenten === undefined ? {} : w.argumenten }, fout: '' } : { ok: false, aanroep: null, fout: `argumenten van ${w.naam}: ${arg.fout}` };
  }

  // verdeelPrompt(vraag, vorigeFout): wat het kleine model krijgt. Kort, met het schema, en bij een tweede poging de reden van de vorige fout.
  function verdeelPrompt(vraag, vorigeFout) {
    const soorten = VERDELER_SCHEMA.soort.waarden.join(', ');
    return 'Deel deze vraag in. Antwoord met ALLEEN een JSON-object, zonder uitleg: {"soort": een van [' + soorten + '], "zwaar": true of false}. '
      + '"zwaar" is true als het antwoord lang of ingewikkeld moet zijn.' + (vorigeFout ? ' Je vorige antwoord was ongeldig (' + String(vorigeFout).slice(0, 80) + '). Probeer het opnieuw.' : '')
      + '\nVraag: ' + String(vraag == null ? '' : vraag).slice(0, 400);
  }

  // uitvoer(schema, vraagModel, opties): vraagt het model hoogstens MAX_POGINGEN keer (de tweede met de reden van de fout), leest elk antwoord STRENG, en geeft
  // { ok:true, waarde, pogingen } of { ok:false, omhoog:true, reden, pogingen }: bij omhoog beslist de beller (een groter model of gewone code) -- er is NIETS uitgevoerd.
  // vraagModel(poging, vorigeFout) -> tekst (mag gooien of niets geven: dan telt het als een ongeldige poging).
  async function uitvoer(schema, vraagModel, opties) {
    const o = opties || {}; const max = Math.max(1, Math.min(o.maxPogingen || MAX_POGINGEN, 3));
    let fout = ''; let n = 0;
    for (let p = 1; p <= max; p++) {
      n = p;
      let raw = '';
      try { raw = await vraagModel(p, fout); } catch (e) { fout = 'het model gaf een fout'; continue; }
      const r = lees(raw, schema);
      if (r.ok) return { ok: true, waarde: r.waarde, pogingen: p };
      fout = r.fout;
    }
    return { ok: false, omhoog: true, reden: fout || 'ongeldig', pogingen: n };
  }

  // verdeel(vraag, vraagModel): de indeling van de verdeler. Terug { soort, zwaar, pogingen } of { fout, omhoog } (cascade.js valt dan terug op gewone code).
  async function verdeel(vraag, vraagModel) {
    const r = await uitvoer(VERDELER_SCHEMA, (poging, fout) => vraagModel(verdeelPrompt(vraag, fout), poging), {});
    return r.ok ? { soort: r.waarde.soort, zwaar: r.waarde.zwaar, pogingen: r.pogingen } : { fout: r.reden, omhoog: true, pogingen: r.pogingen };
  }

  return { uitJson, controleer, lees, leesAanroep, verdeelPrompt, uitvoer, verdeel, VERDELER_SCHEMA, MAX_POGINGEN };
}));
