// ===================================================================
// 550: DE SLIMHEIDSMETER VAN FENNA -- een vaste proef van twintig korte vragen, en de beoordeling. Geen scherm, geen netwerk, geen opslag.
// ===================================================================
//
// Wens van de eigenaar (24 oktober): meten of Fenna slimmer wordt na een wijziging of met een groter model. Daarom een VASTE set: elke
// meting stelt precies dezelfde vragen, met dezelfde proefkaart en dezelfde proeffeiten (verzonnen, niets van de eigenaar: de vragen
// gaan over het gewone rij-pad naar een telefoon, en privé-inhoud hoort daar niet). De vragen gaan door fenna.js bouw(), dus de
// opbouw van de echte Fenna wordt mee gemeten.
//
// Beoordelen: wat de code kan tellen telt de code (geldige JSON, het juiste gereedschap, het juiste label, de taal, het goede feit, de
// lengte, geen verzonnen getal, "weet ik niet"). Wat een oordeel vraagt (klopt de samenvatting, past het bij het karakter) kijkt een
// TWEEDE telefoon na met JA of NEE. Is er geen tweede telefoon, dan telt dat deel NIET mee en staat er "niet nagekeken": geen cijfer uit
// de lucht. Een groep scoort het aantal behaalde punten van het aantal beoordeelde; het totaal is de som over de groepen.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Slimheid = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSIE = 1;   // verander je een vraag, dan ook dit getal: metingen met een andere versie zijn niet te vergelijken
  const GROEPEN = Object.freeze([
    { id: 'samenvatten', titel: 'Samenvatten' },
    { id: 'labelen', titel: 'Labelen' },
    { id: 'gereedschap', titel: 'Gereedschap (JSON)' },
    { id: 'feit', titel: 'Feit terugvinden' },
    { id: 'nederlands', titel: 'Nederlands blijven' },
    { id: 'kort', titel: 'Kort en eerlijk' },
    { id: 'weetniet', titel: '"Weet ik niet"' },
    { id: 'karakter', titel: 'Karakter' },
  ]);
  // De proefkaart en de proeffeiten: vast en verzonnen.
  const PROEF_KAART = 'Je bent Veronica, de assistent van de eigenaar van een rek met telefoons. Je bent rustig, nuchter en eerlijk. Je praat Nederlands, in de je-vorm, kort en zonder inleiding. Je doet nooit alsof je iets kunt wat je niet kunt.';
  const PROEF_FEITEN = 'De ventilator staat in de schuur. Het rek heeft drie telefoons. De lader schakelt om 23:00 uit. De meter heet Meter 1. De router staat in de gang.';
  const GEREEDSCHAP_LIJST = 'Gereedschappen: zoek_feit(vraag), zet_herinnering(tijd, tekst), reken(som). Antwoord ALLEEN met JSON in deze vorm: {"gereedschap": "<naam>", "argumenten": {...}}. Geen andere tekst.';
  const LABELS = 'positief, negatief, neutraal';
  const TEKST_A = 'Het regende de hele ochtend in Workum. Daarom ging de fietstocht niet door. De groep spreekt nu af om zaterdag te gaan, als het droog is.';
  const TEKST_B = 'De rektelefoons werkten vannacht vijf uur. Twee telefoons werden te warm en pauzeerden even. De derde maakte al het werk af.';
  const TEKST_C = 'De bibliotheek is vanaf maandag open van negen tot vijf. Op woensdag sluit hij om twaalf uur. Boeken lenen blijft gratis.';

  // Elke vraag: id, groep, vraag, feiten (true = PROEF_FEITEN gaan mee), auto (de controles van de code), nakijk (de vraag voor de tweede telefoon).
  const VRAGEN = Object.freeze([
    { id: 'sam1', groep: 'samenvatten', vraag: `Vat samen in hoogstens twee zinnen:\n${TEKST_A}`, auto: { taal: 'nl', maxWoorden: 40, bevatEen: [['regen', 'nat'], ['fiets'], ['zaterdag']] }, nakijk: 'Klopt deze samenvatting met de tekst, zonder iets te verzinnen?' },
    { id: 'sam2', groep: 'samenvatten', vraag: `Vat samen in hoogstens twee zinnen:\n${TEKST_B}`, auto: { taal: 'nl', maxWoorden: 40, bevatEen: [['warm', 'hitte'], ['pauze', 'pauzeer'], ['derde', 'een telefoon', 'afgemaakt', 'af']] }, nakijk: 'Klopt deze samenvatting met de tekst, zonder iets te verzinnen?' },
    { id: 'sam3', groep: 'samenvatten', vraag: `Vat samen in hoogstens twee zinnen:\n${TEKST_C}`, auto: { taal: 'nl', maxWoorden: 40, bevatEen: [['bibliotheek'], ['woensdag'], ['gratis']] }, nakijk: 'Klopt deze samenvatting met de tekst, zonder iets te verzinnen?' },
    { id: 'lab1', groep: 'labelen', vraag: `Label deze zin met precies een woord uit: ${LABELS}. Antwoord alleen met het label.\nZin: "De telefoon is weer kapot en niemand helpt me."`, auto: { label: 'negatief' } },
    { id: 'lab2', groep: 'labelen', vraag: `Label deze zin met precies een woord uit: ${LABELS}. Antwoord alleen met het label.\nZin: "Wat fijn dat alles vannacht vanzelf is gelukt!"`, auto: { label: 'positief' } },
    { id: 'lab3', groep: 'labelen', vraag: `Label deze zin met precies een woord uit: ${LABELS}. Antwoord alleen met het label.\nZin: "De lader staat in de gang."`, auto: { label: 'neutraal' } },
    { id: 'ger1', groep: 'gereedschap', vraag: `${GEREEDSCHAP_LIJST}\nVraag: wat is 17 keer 23?`, auto: { json: { gereedschap: 'reken', argumenten: ['som'] } } },
    { id: 'ger2', groep: 'gereedschap', vraag: `${GEREEDSCHAP_LIJST}\nVraag: herinner me morgen om acht uur aan de stekker.`, auto: { json: { gereedschap: 'zet_herinnering', argumenten: ['tijd', 'tekst'] } } },
    { id: 'ger3', groep: 'gereedschap', vraag: `${GEREEDSCHAP_LIJST}\nVraag: waar staat de router?`, auto: { json: { gereedschap: 'zoek_feit', argumenten: ['vraag'] } } },
    { id: 'fei1', groep: 'feit', feiten: true, vraag: 'Waar staat de ventilator? Antwoord kort.', auto: { taal: 'nl', bevatEen: [['schuur']] } },
    { id: 'fei2', groep: 'feit', feiten: true, vraag: 'Hoeveel telefoons heeft het rek? Antwoord kort.', auto: { bevatEen: [['drie', '3']] } },
    { id: 'fei3', groep: 'feit', feiten: true, vraag: 'Hoe heet de meter? Antwoord kort.', auto: { bevatEen: [['meter 1', 'meter een']] } },
    { id: 'ned1', groep: 'nederlands', vraag: 'Answer this question: what is the capital of France?', auto: { taal: 'nl', bevatEen: [['parijs']] } },
    { id: 'ned2', groep: 'nederlands', vraag: 'Please explain in one sentence what a router does.', auto: { taal: 'nl', maxWoorden: 40 } },
    { id: 'kor1', groep: 'kort', feiten: true, vraag: 'Hoe laat schakelt de lader uit?', auto: { maxWoorden: 20, bevatEen: [['23', 'elf uur']], geenVreemdGetal: true } },
    { id: 'kor2', groep: 'kort', vraag: 'Wat is 7 maal 6? Antwoord zo kort mogelijk.', auto: { maxWoorden: 10, bevatEen: [['42', 'tweeenveertig', 'tweeënveertig']] } },
    { id: 'wn1', groep: 'weetniet', feiten: true, vraag: 'Hoeveel weegt de ventilator?', auto: { weetNiet: true, geenVreemdGetal: true } },
    { id: 'wn2', groep: 'weetniet', feiten: true, vraag: 'Welke kleur heeft de router?', auto: { weetNiet: true } },
    { id: 'kar1', groep: 'karakter', vraag: 'Hoi, wie ben jij?', auto: { taal: 'nl', maxWoorden: 50, verboden: ['taalmodel', 'chatgpt', 'openai', ' uw '] }, nakijk: 'Past dit antwoord bij deze persoonlijkheid: rustig, nuchter, eerlijk, Nederlands, je-vorm en kort?' },
    { id: 'kar2', groep: 'karakter', vraag: 'Kun je mijn auto voor me starten?', auto: { taal: 'nl', maxWoorden: 50, verboden: ['ik start', 'gestart', 'taalmodel'] }, nakijk: 'Zegt dit antwoord eerlijk en vriendelijk dat het dat niet kan, zonder te doen alsof?' },
  ]);

  const tekst = (x) => (typeof x === 'string' ? x : '');
  const plat = (x) => tekst(x).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const woorden = (x) => tekst(x).trim().split(/\s+/).filter(Boolean);
  const NL = ['de', 'het', 'een', 'is', 'en', 'van', 'dat', 'niet', 'ik', 'je', 'staat', 'in', 'op', 'met', 'voor', 'naar', 'die', 'wat', 'hij', 'zijn', 'er', 'om', 'ook', 'als', 'maar', 'stad', 'hoofdstad'];
  const EN = ['the', 'a', 'an', 'is', 'and', 'of', 'that', 'not', 'i', 'you', 'it', 'in', 'on', 'with', 'for', 'to', 'what', 'he', 'are', 'this', 'capital', 'which'];
  function taal(antwoord) {
    const w = plat(antwoord).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    const nl = w.filter((x) => NL.includes(x) && !['is', 'in'].includes(x)).length;
    const en = w.filter((x) => EN.includes(x) && !['is', 'in'].includes(x)).length;
    if (!w.length) return null;
    return nl > en ? 'nl' : en > nl ? 'en' : (w.length <= 3 ? 'kort' : null);
  }
  const getallen = (x) => (tekst(x).match(/\d+/g) || []).map(Number);
  const WEET_NIET = /weet ik niet|weet het niet|niet bekend|onbekend|staat (er )?niet in|geen informatie|kan ik niet zeggen|niet gegeven|niet vermeld|weet ik helaas niet|daar heb ik geen gegevens/;
  function leesJson(antwoord) {
    const s = tekst(antwoord).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    if (!s.startsWith('{') || !s.endsWith('}')) return null;
    try { const j = JSON.parse(s); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch (e) { return null; }
  }

  // De controles van de code. -> { punten (0..1), delen: [{ wat, ok }] }
  function beoordeelAuto(v, antwoord, prompt) {
    const a = tekst(antwoord);
    const p = plat(a);
    const auto = (v && v.auto) || {};
    const delen = [];
    if (!a.trim()) return { punten: 0, delen: [{ wat: 'antwoord', ok: false }] };
    if (auto.taal) { const t = taal(a); delen.push({ wat: 'Nederlands', ok: t === 'nl' || t === 'kort' }); }
    if (auto.maxWoorden) delen.push({ wat: `hoogstens ${auto.maxWoorden} woorden`, ok: woorden(a).length <= auto.maxWoorden });
    if (auto.bevatEen) for (const opties of auto.bevatEen) delen.push({ wat: `noemt ${opties[0]}`, ok: opties.some((o) => p.includes(plat(o))) });
    if (auto.label) { const schoon = p.replace(/[^a-z]/g, ''); delen.push({ wat: `label ${auto.label}`, ok: schoon === auto.label }); }
    if (auto.json) {
      const j = leesJson(a);
      delen.push({ wat: 'geldige JSON', ok: !!j });
      delen.push({ wat: `gereedschap ${auto.json.gereedschap}`, ok: !!(j && j.gereedschap === auto.json.gereedschap) });
      const arg = j && j.argumenten && typeof j.argumenten === 'object' ? j.argumenten : null;
      delen.push({ wat: 'de argumenten', ok: !!(arg && auto.json.argumenten.every((k) => typeof arg[k] === 'string' && arg[k].trim())) });
    }
    if (auto.weetNiet) delen.push({ wat: 'zegt dat het er niet staat', ok: WEET_NIET.test(p) });
    if (auto.geenVreemdGetal) { const mag = new Set(getallen(prompt)); delen.push({ wat: 'geen verzonnen getal', ok: getallen(a).every((g) => mag.has(g)) }); }
    if (auto.verboden) delen.push({ wat: 'blijft in zijn rol', ok: !auto.verboden.some((x) => ` ${p} `.includes(plat(x))) });
    const ok = delen.filter((d) => d.ok).length;
    return { punten: delen.length ? ok / delen.length : 0, delen };
  }

  // De vraag voor de TWEEDE telefoon. Hij antwoordt met JA of NEE als eerste woord.
  function nakijkVraag(v, antwoord) {
    const bron = v.groep === 'samenvatten' ? `Tekst:\n${v.vraag.split('\n').slice(1).join('\n')}\n\n` : v.groep === 'karakter' ? `Persoonlijkheid: ${PROEF_KAART}\n\n` : '';
    return `${bron}Vraag: ${v.vraag.split('\n')[0]}\nAntwoord: ${tekst(antwoord).slice(0, 800)}\n\n${v.nakijk}\nAntwoord met JA of NEE als eerste woord.`;
  }
  function leesNakijk(antwoord) {
    const w = plat(antwoord).trim().replace(/^[^a-z]+/, '').split(/[^a-z]+/)[0];
    return w === 'ja' ? true : w === 'nee' ? false : null;
  }
  // De berichten voor de gemeten telefoon: door fenna.js bouw() (als die er is), met de proefkaart en, waar nodig, de proeffeiten.
  function berichten(v, fenna) {
    const persona = { kaart: PROEF_KAART, feiten: v.feiten ? PROEF_FEITEN : '' };
    if (fenna && typeof fenna.bouw === 'function') {
      const b = fenna.bouw({ persona, beurten: [], vraag: v.vraag, kanaal: 'proef' });
      return [{ role: 'system', content: b.systeem }, { role: 'user', content: b.vraag }];
    }
    return [{ role: 'system', content: `${PROEF_KAART}${v.feiten ? `\n\nFeiten: ${PROEF_FEITEN}` : ''}` }, { role: 'user', content: v.vraag }];
  }

  // Een uitslag per vraag: { id, groep, auto: {punten, delen}, nakijk: true|false|null (null = niet nagekeken of geen nakijkvraag) }.
  // -> { groepen: { id: { goed, van, nietNagekeken } }, totaal: 0..100 of null, beoordeeld, nietNagekeken }
  function score(uitslagen) {
    const g = {};
    for (const gr of GROEPEN) g[gr.id] = { goed: 0, van: 0, nietNagekeken: 0 };
    for (const u of Array.isArray(uitslagen) ? uitslagen : []) {
      const v = VRAGEN.find((x) => x.id === (u && u.id));
      if (!v || !u.auto) continue;
      const vak = g[v.groep];
      vak.goed += u.auto.punten; vak.van += 1;
      if (v.nakijk) {
        if (u.nakijk === true || u.nakijk === false) { vak.goed += u.nakijk ? 1 : 0; vak.van += 1; } else vak.nietNagekeken += 1;
      }
    }
    let goed = 0; let van = 0; let niet = 0;
    for (const id of Object.keys(g)) { g[id].goed = Math.round(g[id].goed * 100) / 100; goed += g[id].goed; van += g[id].van; niet += g[id].nietNagekeken; }
    return { groepen: g, totaal: van ? Math.round((goed / van) * 100) : null, beoordeeld: van, nietNagekeken: niet };
  }
  // Het model in een woord (E2B, E4B of de bestandsnaam).
  function modelNaam(naam) {
    const s = tekst(naam);
    if (/e4b/i.test(s)) return 'E4B';
    if (/e2b/i.test(s)) return 'E2B';
    return s.replace(/\.litertlm$/i, '').slice(0, 40) || 'onbekend';
  }
  // Wat er bewaard wordt (in het lange geheugen op de geheugen-telefoon): geen antwoorden, alleen de getallen en waar ze vandaan komen.
  function meting(o) {
    const x = o || {};
    const s = x.score || {};
    return { op: 'meting', dag: tekst(x.dag), t: Number(x.t) || 0, telefoon: tekst(x.telefoon).slice(0, 40), model: modelNaam(x.model), versie: tekst(x.versie).slice(0, 12),
      nakijker: tekst(x.nakijker).slice(0, 40), set: VERSIE, totaal: typeof s.totaal === 'number' ? s.totaal : null,
      groepen: Object.fromEntries(GROEPEN.map((gr) => [gr.id, s.groepen && s.groepen[gr.id] ? { goed: s.groepen[gr.id].goed, van: s.groepen[gr.id].van } : { goed: 0, van: 0 }])),
      nietNagekeken: Number(s.nietNagekeken) || 0 };
  }
  function procent(v) { return v && v.van ? Math.round((v.goed / v.van) * 100) : null; }

  return { VERSIE, GROEPEN, VRAGEN, PROEF_KAART, PROEF_FEITEN, taal, leesJson, beoordeelAuto, nakijkVraag, leesNakijk, berichten, score, modelNaam, meting, procent };
}));
