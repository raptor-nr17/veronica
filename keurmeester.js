// ===================================================================
// 678 (eigenaar 11 nov, punt 4): DE KEURMEESTER IS NOOIT EEN ENKEL MODEL, en nooit het model dat het antwoord maakte.
// Volgorde: eerst gewone regels + woordenzeef (Trap.controle); pas daarna twee rechters uit VERSCHILLENDE modelfamilies die het MOETEN EENS ZIJN.
// Oneens -> een derde (weer een andere telefoon, bij voorkeur weer een andere familie) of anders OMHOOG. Nooit een antwoord goedkeuren op een
// meerderheid van een enkele familie, en nooit zelfkeuring. Alleen rekenen: de rechters komen binnen als functie. Geen netwerk, geen opslag, geen DOM.
// Afspraak: geen merk, persoon of plaats van de eigenaar in dit bestand (modelfamilienamen zijn geen merk van hem).
// ===================================================================
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek(require('./trap.js'));
  else wortel.Keurmeester = fabriek(wortel.Trap);
}(typeof self !== 'undefined' ? self : this, function (Trap) {
  'use strict';

  const FAMILIES = Object.freeze([['gemma', /gemma/i], ['qwen', /qwen/i], ['llama', /llama/i], ['smol', /smol/i], ['phi', /\bphi/i], ['mistral', /mistral|ministral/i], ['deepseek', /deepseek/i]]);

  // familie(naam): de modelfamilie uit de naam, of 'onbekend'. Een onbekende familie telt NOOIT als "anders" (we kunnen niet bewijzen dat ze verschilt).
  function familie(naam) {
    const n = String(naam == null ? '' : naam);
    for (const [f, re] of FAMILIES) if (re.test(n)) return f;
    return 'onbekend';
  }

  // kiesRechters(kandidaten, maker): kandidaten = [{ id, model, klaar }]; maker = { id, model }.
  // Terug { rechters:[a,b]|[], reserve:[...], reden }. De rechters: niet de maker (op id), niet de familie van de maker, onderling twee verschillende, bekende families.
  function kiesRechters(kandidaten, maker) {
    const m = maker || {}; const mf = familie(m.model);
    const bruikbaar = (kandidaten || []).filter((k) => k && k.klaar !== false && k.id !== m.id && familie(k.model) !== 'onbekend' && familie(k.model) !== mf);
    const gezien = []; const uniek = [];
    for (const k of bruikbaar) { const f = familie(k.model); if (gezien.indexOf(f) < 0) { gezien.push(f); uniek.push(k); } }
    if (uniek.length < 2) return { rechters: [], reserve: [], reden: uniek.length ? 'maar een andere modelfamilie beschikbaar' : 'geen andere modelfamilie beschikbaar' };
    return { rechters: uniek.slice(0, 2), reserve: bruikbaar.filter((k) => uniek.slice(0, 2).indexOf(k) < 0), reden: '' };
  }

  // leesOordeel(raw): JA / NEE / ONZEKER uit de tekst van een rechter. Onleesbaar of dubbelzinnig = ONZEKER (nooit stilzwijgend ja).
  function leesOordeel(raw) {
    const t = String(raw == null ? '' : raw).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const m = t.match(/^[\s"'*#>\-]*(ja|nee|onzeker|yes|no)\b/i);
    if (!m) return 'ONZEKER';
    const w = m[1].toLowerCase();
    return (w === 'ja' || w === 'yes') ? 'JA' : (w === 'nee' || w === 'no') ? 'NEE' : 'ONZEKER';
  }

  // samenvoegen(a, b): twee oordelen -> 'goed' (beide JA), 'af' (beide NEE), 'oneens' (alle andere combinaties, ook ONZEKER).
  function samenvoegen(a, b) { return a === 'JA' && b === 'JA' ? 'goed' : a === 'NEE' && b === 'NEE' ? 'af' : 'oneens'; }

  // keur(soort, vraag, antwoord, maker, kandidaten, rechter): async.
  // rechter(telefoon, vraag, antwoord, {soort}) -> { oordeel:'JA'|'NEE'|'ONZEKER' | tekst } of { fout }.
  // Terug { ok, stap, rechters:[ids], omhoog, reden }. ok=true alleen als de regels EN twee verschillende families JA zeggen.
  async function keur(soort, vraag, antwoord, maker, kandidaten, rechter) {
    const regels = Trap.controle(soort, vraag, antwoord);
    if (!regels.ok) return { ok: false, stap: 'regels', rechters: [], omhoog: true, reden: regels.reden };
    const k = kiesRechters(kandidaten, maker);
    if (!k.rechters.length || typeof rechter !== 'function') return { ok: null, stap: 'geen-rechters', rechters: [], omhoog: false, reden: k.reden || 'geen rechter beschikbaar' };
    const vraagOordeel = async (tel) => { try { const r = await rechter(tel, vraag, antwoord, { soort: soort }); if (!r || r.fout) return 'ONZEKER'; return /^(JA|NEE|ONZEKER)$/.test(r.oordeel) ? r.oordeel : leesOordeel(r.oordeel); } catch (e) { return 'ONZEKER'; } };
    const [o1, o2] = await Promise.all(k.rechters.map(vraagOordeel));
    const uitslag = samenvoegen(o1, o2);
    const ids = k.rechters.map((x) => x.id);
    if (uitslag === 'goed') return { ok: true, stap: 'twee-rechters', rechters: ids, omhoog: false, reden: '' };
    if (uitslag === 'af') return { ok: false, stap: 'twee-rechters', rechters: ids, omhoog: true, reden: 'twee modellen uit verschillende families keuren het af' };
    // oneens: een derde. Bij voorkeur een andere familie dan beide rechters en dan de maker; anders omhoog.
    const gebruikt = [familie(maker && maker.model)].concat(k.rechters.map((x) => familie(x.model)));
    const derde = k.reserve.find((x) => gebruikt.indexOf(familie(x.model)) < 0);
    if (!derde) return { ok: false, stap: 'oneens', rechters: ids, omhoog: true, reden: 'de rechters zijn het oneens en er is geen derde uit een andere familie' };
    const o3 = await vraagOordeel(derde);
    // De derde beslist NIET alleen: hij moet met EEN van de twee instemmen die dezelfde kant op wijst, en een JA vraagt dat beide rechters niet NEE zeiden.
    const ja = [o1, o2, o3].filter((x) => x === 'JA').length; const nee = [o1, o2, o3].filter((x) => x === 'NEE').length;
    const ids3 = ids.concat([derde.id]);
    if (ja >= 2 && nee === 0) return { ok: true, stap: 'derde', rechters: ids3, omhoog: false, reden: '' };
    return { ok: false, stap: 'derde', rechters: ids3, omhoog: true, reden: 'ook met een derde model geen eensgezind oordeel' };
  }

  // rechterPrompt(vraag, antwoord): wat een rechter krijgt. Kort; JA/NEE op de eerste regel. Hij maakt niets, hij kijkt alleen na.
  function rechterPrompt(vraag, antwoord) {
    return 'Je kijkt een antwoord na. Antwoord op de EERSTE regel met alleen JA of NEE: is het antwoord juist, volledig en verzint het niets wat niet uit de vraag blijkt? '
      + 'Je mag daarna een korte reden geven.\nVraag: ' + String(vraag == null ? '' : vraag).slice(0, 600) + '\nAntwoord: ' + String(antwoord == null ? '' : antwoord).slice(0, 1500);
  }

  return { familie, kiesRechters, leesOordeel, samenvoegen, keur, rechterPrompt, FAMILIES: FAMILIES.map((f) => f[0]) };
}));
