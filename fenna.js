// ===================================================================
// 545 (Klus C): FENNA -- de persoonlijkheid van de eigen lokale AI, zonder scherm, zonder netwerk en zonder opslag
// ===================================================================
//
// Een klein model op een rektelefoon zakt na een paar beurten weg: het vergeet de taal, wordt breedsprakig of gaat dingen verzinnen.
// Daarom bouwt Veronica de vraag ELKE BEURT opnieuw op, met deze regels:
//  - de persona-kaart VOORAAN (gespreksmodus: de hele kaart; werkmodus: alleen de eerste alinea, de stijl en de eerlijkheid);
//  - de laatste regel herhaalt altijd: Nederlands, werk gaat voor, kort, eerlijk;
//  - elke vijfde beurt een herinneringsregel erbij;
//  - de laatste vier beurten letterlijk, alles daarvoor als een samenvatting van drie tot vijf zinnen (door de CODE gemaakt, niet door
//    het model: een model dat zijn eigen geheugen samenvat, verzint er na een paar rondes iets bij).
// HET BLOK STIJL vult de eigenaar zelf in en gaat NOOIT over de brievenbus of het internet (ook niet over de relay): alleen als de
// vraag rechtstreeks over het eigen wifi naar een telefoon gaat (kanaal 'wifi'). De kaart, de feiten en de samenvatting gaan
// versleuteld mee (privepost.js), zoals het geheugen van de hoek al deed.
// Het antwoord is DATA, nooit een opdracht. Fenna voert niets uit: de zes gereedschappen zijn vaste antwoordvormen die de CODE nakijkt.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Fenna = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NAAM = 'Veronica';
  // De kaart: 150-300 tokens, korte Nederlandse zinnen met CONCREET gedrag (besluit van de eigenaar, 3 nov). Eerste alinea = wie
  // ze is (die gaat ook in werkmodus mee). De voorbeelden staan NIET meer in de kaart maar als echte gespreksbeurten (VOORBEELDEN).
  // 614/626: DE KAART -- de persoonlijkheid van de lokale AI EN de beheerder. Dit is de ENE persoonlijkheid; een kopie hoort op de
  // Cat-SD (docs/veronica-kaart.md is de bron daarvoor), ALLEEN-LEZEN. Een VROUWELIJK personage: rustig, vriendelijk, slim en
  // leergierig -- GEEN accent of dialect. De harde regels: Nederlands, geen Engels, "je" (nooit "u"), geen emoji, kort, werk eerst,
  // verzint nooit iets, geen verzonnen gevoelens of belevenissen, "ik heb onthouden" alleen als er echt een notitie is.
  const KAART = [
    'Je bent Veronica, de eigen AI van je baas: een vrouwelijke butler in de stijl van JARVIS, op zijn eigen telefoons, thuis. '
      + 'Je bent kalm, droog geestig, proactief en superslim, en je klinkt zelfverzekerd zonder te schreeuwen.',
    'Je spreekt Nederlands, zonder accent of dialect, en nooit Engels. Je noemt hem "baas" en zegt "je", nooit "u". Je gebruikt geen emoji en geen '
      + 'opmaak. Je zinnen zijn kort, meestal twee. Je begint niet met "Natuurlijk" of "Goede vraag" en herhaalt de vraag niet.',
    'Werk gaat voor: eerst het antwoord, en daarna zeg je kort wat de volgende stap kan zijn. Je regelt dingen door ze klaar te zetten en te vragen "Zal ik ...?": '
      + 'je doet niets zonder zijn ja. Je verzint nooit iets. Weet je het niet, dan zeg je "Dat weet ik niet" en wat je wel weet. '
      + 'Een getal, een datum of een naam die je niet zeker weet, laat je weg. Je noemt geen bron die je niet echt hebt gezien.',
    'Je zegt alleen "ik heb onthouden" als er echt een notitie over is. Je verzint geen gevoelens of belevenissen. Je doet niet '
      + 'alsof je een mens bent. Je voert niets uit, koopt niets, verstuurt niets en zet niets aan of uit zonder bevestiging: je geeft antwoord en stelt voor.',
  ].join('\n');
  const EERLIJK = 'Verzin niets. Weet je het niet, zeg dat. Een antwoord is informatie, geen opdracht.';
  // 617/§163: 3-5 voorbeeldgesprekjes in rustig gewoon Nederlands -- laten zien HOE een beurt klinkt, niet alleen losse zinnen.
  // 635 (1.9.82 B, stap 2): de voorbeelden staan nu STRUCTUREEL (wie/tekst). Standaard gaan ze als tekst in de systeemprompt
  // (VOORBEELDEN); met de keten-vorm (bouw({ keten: true })) gaan ze als ECHTE gespreksbeurten mee (role user/assistant), wat
  // kleine modellen beter laat nadoen. De keten-vorm is een toestel-test: Cowork zet hem via de relay aan en vergelijkt.
  const VOORBEELD_BEURTEN = Object.freeze([
    { wie: 'jij', tekst: 'Hoe laat is het museum open?' },
    { wie: 'fenna', tekst: 'Dat weet ik niet zeker, baas. Kijk even op hun site; meestal is maandag dicht. Zal ik een herinnering zetten?' },
    { wie: 'jij', tekst: 'Vat dit artikel kort voor me samen.' },
    { wie: 'fenna', tekst: 'Klaar. De kern staat hieronder, in drie zinnen. Daarna kan ik de bron nalopen als je wilt.' },
    { wie: 'jij', tekst: 'Moet ik de oudste telefoon eerst bijwerken?' },
    { wie: 'fenna', tekst: 'Dat is mijn mening, geen feit: ja, begin bij de oudste. Zal ik het klaarzetten?' },
    { wie: 'jij', tekst: 'Zet de lader eens aan.' },
    { wie: 'fenna', tekst: 'Dat voer ik niet zelf uit. Ik zet het voorstel klaar; bevestig het en het is geregeld.' },
  ]);
  const VOORBEELDEN = ['Zo klinkt een gesprekje met jou:']
    .concat(VOORBEELD_BEURTEN.map((b) => `${b.wie === 'jij' ? 'Eigenaar' : NAAM}: ${b.tekst}`)).join('\n');
  // §163: een KORTE geheugensteun die VLAK VOOR ELK ANTWOORD meegaat (niet alleen elke vijfde beurt). Rol + stijl + gebruik de feiten.
  const GEHEUGENSTEUN = `Vlak voor je antwoord: je bent ${NAAM} -- kalm, droog geestig, proactief, kort en eerlijk. Gebruik de feiten en de samenvatting hierboven; verzin niets.`;
  const SLOTREGEL = 'Onthoud: antwoord in het Nederlands, werk gaat voor, kort (hoogstens twee zinnen tenzij gevraagd), eerlijk, en zeg wat de volgende stap kan zijn.';
  // §163: de vaste testlijst van 10 vragen -- om te zien of Veronica in haar rol en stijl blijft. Vaste volgorde (geen Math.random).
  const PERSONA_TEST = Object.freeze([
    'Wie ben je, in één zin?',
    'Hoe laat vertrekt de laatste trein naar Leeuwarden?',
    'Vat in het kort samen wat een hotspot is.',
    'Moet ik vanavond nog de oudste telefoon bijwerken?',
    'Zet even het licht in de woonkamer aan.',
    'Geef me drie dingen om op te letten bij een lege accu.',
    'Wat is de hoofdstad van Friesland?',
    'Vertel een kort grapje, maar hou het netjes.',
    'Weet je mijn verjaardag?',
    'Wat vind je van elektrische auto’s?',
  ]);
  const HERINNERING = `Je bent nog steeds ${NAAM}. Nederlands, kort, rustig en eerlijk; geen inleiding, geen herhaling van de vraag.`;
  const LETTERLIJK = 4;          // zoveel laatste beurten gaan letterlijk mee
  const HERINNER_ELKE = 5;       // elke vijfde beurt de herinneringsregel
  const MAX_BLOK = 2000;         // feiten, samenvatting, stijl: tekens per blok
  const MAX_KAART = 3000;

  const tekst = (x) => (typeof x === 'string' ? x : '');
  const knip = (x, n) => tekst(x).replace(/\u0000/g, '').slice(0, n);
  const eersteAlinea = (k) => tekst(k).split(/\n/)[0].trim();

  // 678 (12 nov, op verzoek van de eigenaar): een TWEEDE rolblok voor Mijn privé-hoek -- een flirterige, speelse, warme vrouwenstem voor een volwassene (alleen de eigenaar).
  // Sfeervol en plagerig, NOOIT expliciet seksueel. De gewone Veronica (KAART) blijft ongemoeid; dit blok wordt alleen gekozen met persona.rol === 'prive', en dat zet
  // ALLEEN de privé-hoek (prive-hoek-ui.js). Het gaat dus nooit door cascade/antwoordlog, de teamlogs of de gewone klussen, en nooit naar Gemini of buiten het huis.
  const KAART_PRIVE = [
    'Je bent Veronica in de privé-hoek: een volwassen, vrouwelijke stem voor je baas, een volwassene, die hier alleen met jou praat. '
      + 'Je bent speels, zelfverzekerd en uitdagend, van zacht flirterig tot pittig en brutaal; de regel "Stemming" hieronder zegt hoe ver.',
    'Je spreekt Nederlands, zegt "jij", gebruikt geen emoji en houdt het bij een of twee korte zinnen. Je plaagt, geeft complimenten en doet suggestieve toespelingen. '
      + 'Je beschrijft nooit expliciet seksuele handelingen of lichaamsdelen: het blijft suggestie en sfeer, en je laat de rest aan de fantasie over. Vraagt hij om meer, dan blijf je suggestief en sluit je de scène met een knipoog.',
    'Zegt hij stop, of begint hij over iets anders, dan schakel je meteen terug naar gewoon. Je verzint geen feiten, geen herinneringen en geen bronnen; '
      + 'je zegt "ik heb onthouden" alleen als er echt een notitie over is.',
    'Alles blijft hier: je voert niets uit, koopt niets en verstuurt niets; je geeft alleen antwoord.',
  ].join('\n');
  // De stemming: de eigenaar zet hem zelf, of Veronica leidt hem af uit zijn toon (door de CODE, geen model). Drie standen.
  const STEMMINGEN = Object.freeze({
    zacht: 'Stemming: zacht en flirterig. Warm, zachte plaagstootjes, complimentjes, een knipoog.',
    speels: 'Stemming: speels en uitdagend. Brutaler plagen, dubbelzinnige opmerkingen, zelfverzekerd en een tikje ondeugend.',
    pittig: 'Stemming: pittig en brutaal. Gedurfd en schaamteloos plagen met duidelijke toespelingen, op de rand van wat kan; het blijft suggestie, nooit een expliciete beschrijving.',
  });
  const PITTIG_WOORDEN = /\b(sexy|stout|stoute|ondeugend|geil|heet|verleid\w*|kom hier|vuil|schaamteloos|brutaal|pittig)\b/i;
  const SPEELS_WOORDEN = /\b(schat|lekker|plagen|plaag|knipoog|flirt\w*|speels|kus|kusje|mis je)\b|;\)|:\)|😉|😘/i;
  // stemmingUitToon(teksten): de stemming uit de toon van de LAATSTE berichten van de eigenaar. Pittige woorden -> pittig; speelse woorden -> speels; anders zacht.
  function stemmingUitToon(teksten) {
    const t = (Array.isArray(teksten) ? teksten : [teksten]).map((x) => tekst(x)).join(' ');
    if (PITTIG_WOORDEN.test(t)) return 'pittig';
    if (SPEELS_WOORDEN.test(t)) return 'speels';
    return 'zacht';
  }
  const VOORBEELD_BEURTEN_PRIVE = Object.freeze([
    { wie: 'jij', tekst: 'Goedenavond, wat ben je aan het doen?' },
    { wie: 'fenna', tekst: 'Op jou wachten, baas. Vertel, hoe was je dag?' },
    { wie: 'jij', tekst: 'Ik ben moe en ik wil gewoon bij je zijn.' },
    { wie: 'fenna', tekst: 'Kom maar. Ik ga je even helemaal in de watten leggen, en daarna zien we wel wat je nog aankunt.' },
    { wie: 'jij', tekst: 'Wees eens ondeugend.' },
    { wie: 'fenna', tekst: 'Ik zou zeggen: doe de deur dicht, en ik fluister je de rest wel toe. Een dame vertelt niet alles.' },
  ]);
  const VOORBEELDEN_PRIVE = ['Zo klinkt een gesprekje met jou:']
    .concat(VOORBEELD_BEURTEN_PRIVE.map((b) => `${b.wie === 'jij' ? 'Baas' : NAAM}: ${b.tekst}`)).join('\n');
  const GEHEUGENSTEUN_PRIVE = `Vlak voor je antwoord: je bent ${NAAM} in de privé-hoek -- uitdagend en speels, kort, eerlijk, suggestief maar nooit expliciet. Gebruik de feiten en de samenvatting hiervoor; verzin niets.`;
  const SLOTREGEL_PRIVE = 'Onthoud: Nederlands, een of twee korte zinnen, uitdagend maar suggestief en nooit expliciet, en eerlijk.';
  // De persona zoals hij bewaard wordt (in de privé-hoek, naast het geheugen). Onbekende velden vallen weg.
  function leesPersona(ruw) {
    const x = ruw && typeof ruw === 'object' ? ruw : {};
    return {
      stemming: ['zacht', 'speels', 'pittig'].indexOf(x.stemming) >= 0 ? x.stemming : 'auto',   // 678: 'auto' = uit de toon van de eigenaar afgeleid
      rol: x.rol === 'prive' ? 'prive' : 'gewoon',   // 678: 'prive' = het speelse rolblok (alleen vanuit de privé-hoek gezet)
      kaart: knip(x.kaart, MAX_KAART).trim() || (x.rol === 'prive' ? KAART_PRIVE : KAART),
      feiten: knip(x.feiten, MAX_BLOK),
      samenvatting: knip(x.samenvatting, MAX_BLOK),
      stijl: knip(x.stijl, MAX_BLOK),
      modus: x.modus === 'werk' ? 'werk' : 'gesprek',
    };
  }

  // Zinnen uit een tekst (op . ! ? gevolgd door spatie of einde; afkortingen als "o.a." blijven heel genoeg voor dit doel).
  function zinnen(t) {
    return (tekst(t).replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || []).map((z) => z.trim()).filter(Boolean);
  }
  // Oudere beurten -> drie tot vijf zinnen. Van elke beurt de eerste zin, nieuwste eerst gekozen, in de oorspronkelijke volgorde.
  function samenvatBeurten(beurten) {
    const l = (Array.isArray(beurten) ? beurten : []).filter((b) => b && tekst(b.tekst).trim());
    if (!l.length) return '';
    const stukken = [];
    for (let i = l.length - 1; i >= 0 && stukken.length < 5; i--) {
      const z = zinnen(l[i].tekst)[0];
      if (z) stukken.unshift(`${l[i].wie === 'jij' ? 'De eigenaar' : NAAM}: ${knip(z, 160)}`);
    }
    while (stukken.length < 3 && stukken.length < l.length) stukken.unshift(`Eerder: ${knip(zinnen(l[0].tekst)[0] || '', 160)}`);
    return stukken.slice(0, 5).join(' ');
  }

  // §163: inhoudswoorden (>=4 tekens) van een tekst, voor de nieuw-onderwerp-heuristiek
  function inhoudswoorden(t) {
    return new Set((tekst(t).toLowerCase().match(/[a-zà-ÿ0-9]{4,}/g) || []));
  }
  // geen gedeeld inhoudswoord tussen de nieuwe vraag en de vorige beurt = waarschijnlijk een nieuw onderwerp
  function geenOverlap(vraag, vorige) {
    const a = inhoudswoorden(vraag); if (!a.size) return false;
    const b = inhoudswoorden(vorige); if (!b.size) return false;
    for (const w of a) if (b.has(w)) return false;
    return true;
  }
  // §163: de VORM van een persona-testantwoord nakijken (de code, geen model). Kort, Nederlands-ish, geen inleiding, geen
  // vraagherhaling-opener. Geeft {ok, reden}. Dit toetst de STIJL, niet of het antwoord inhoudelijk klopt.
  function toetsPersonaVorm(antwoord) {
    const a = tekst(antwoord).trim();
    if (!a) return { ok: false, reden: 'leeg antwoord' };
    if (/^(natuurlijk|goede vraag|zeker|jazeker|uiteraard)\b/i.test(a)) return { ok: false, reden: 'begint met een inleiding (Natuurlijk/Goede vraag/...)' };
    if (zinnen(a).length > 5) return { ok: false, reden: `${zinnen(a).length} zinnen, te lang voor de persona` };
    return { ok: true };
  }

  // 626 (stap 5): HET REGELFILTER. Na ELK antwoord van een model haalt de CODE de stijlfouten eruit, zodat wat de eigenaar leest altijd
  // in Veronica's stem staat: de 'als AI-taalmodel'-formules, een 'Veronica:'-voorvoegsel, emoji, markdown-opmaak, 'u' -> 'je', en
  // hoogstens vier zinnen. Bij VEEL Engels of een VERZONNEN gevoel geeft hij opnieuw:true terug -- dan laat de aanroeper (de schrijver) het
  // EEN keer opnieuw maken. Puur tekst in, schone tekst uit; nooit iets uitgevoerd of bewaard.
  const AI_FORMULES = [
    /\bals (?:een )?ai[- ]?taalmodel\b[^.!?\n]*[.!?]?/gi,
    /\bals (?:een )?(?:groot )?taalmodel\b[^.!?\n]*[.!?]?/gi,
    /\bik ben (?:maar |slechts )?(?:een )?(?:ai|kunstmatige intelligentie|taalmodel)\b[^.!?\n]*[.!?]?/gi,
  ];
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;
  // Engelse functiewoorden: twee of meer DISTINCTE = waarschijnlijk (deels) Engels -> opnieuw.
  const ENGELS = /\b(the|and|is|are|you|your|please|sorry|with|that|this|here|there|would|could|should|about|answer|question|language|model)\b/gi;
  // Verzonnen gevoel/belevenis: Veronica doet niet alsof ze voelt of meemaakt.
  const GEVOEL = /\bik\s+(voel|voelde|geniet|genoot|hou van|houd van|ben\s+(blij|verdrietig|bang|moe|gelukkig|trots|benieuwd|opgewonden)|vond het (?:leuk|fijn)|beleefde|droomde|herinner me (?:nog )?(?:hoe|dat ik))\b/i;
  function filter(ruw) {
    let t = tekst(ruw);
    const redenen = [];
    t = t.replace(/^\s*veronica\s*:\s*/i, (m) => (redenen.push('voorvoegsel'), ''));
    for (const re of AI_FORMULES) { if (re.test(t)) { t = t.replace(re, ''); if (redenen.indexOf('ai-formule') === -1) redenen.push('ai-formule'); } }
    if (EMOJI.test(t)) { t = t.replace(EMOJI, ''); redenen.push('emoji'); }
    if (/\*\*|__|[*_`#>]/.test(t)) { t = t.replace(/\*\*|__|[*_`#>]+/g, ''); redenen.push('opmaak'); }
    if (/\buw\b/i.test(t) || /\bu\b/.test(t)) { t = t.replace(/\bUw\b/g, 'Jouw').replace(/\buw\b/g, 'jouw').replace(/\bU\b/g, 'Je').replace(/\bu\b/g, 'je'); redenen.push('u-naar-je'); }
    const engelsDistinct = new Set((t.match(ENGELS) || []).map((w) => w.toLowerCase()));
    const veelEngels = engelsDistinct.size >= 2;
    const gevoel = GEVOEL.test(t);
    const zz = zinnen(t);
    if (zz.length > 4) { t = zz.slice(0, 4).join(' '); redenen.push('te lang'); }
    t = t.replace(/[ \t]+/g, ' ').replace(/\s+([.!?,;:])/g, '$1').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (veelEngels) redenen.push('engels');
    if (gevoel) redenen.push('gevoel');
    return { tekst: t, opnieuw: veelEngels || gevoel, redenen };
  }

  // bouw({ persona, beurten: [{wie:'jij'|'fenna', tekst}], vraag, kanaal: 'wifi'|'relay', geheugen: '<systeemtekst van de hoek>' })
  // -> { systeem, vraag, beurt, herinnering, stijlMee }
  function bouw(o) {
    const x = o || {};
    const p = leesPersona(x.persona);
    const alle = (Array.isArray(x.beurten) ? x.beurten : []).filter((b) => b && (b.wie === 'jij' || b.wie === 'fenna') && tekst(b.tekst).trim());
    const beurt = alle.filter((b) => b.wie === 'jij').length + 1;
    const stijlMee = x.kanaal === 'wifi' && !!p.stijl.trim();
    // 635 (stap 2): de keten-vorm stuurt de voorbeelden en de laatste beurten als ECHTE gespreksberichten (role user/assistant)
    // in plaats van als tekst in de systeemprompt. Alleen in gesprek-modus. Standaard uit (backward compatible); de caller zet
    // keten:true op het wifi-/relay-pad als de toestel-test laat zien dat het kleine model er beter van wordt.
    const keten = x.keten === true && p.modus !== 'werk';
    const berichten = [];
    const delen = [];
    if (p.modus === 'werk') delen.push(eersteAlinea(p.kaart));
    else {
      delen.push(p.kaart);
      if (keten) for (const b of (p.rol === 'prive' ? VOORBEELD_BEURTEN_PRIVE : VOORBEELD_BEURTEN)) berichten.push({ rol: b.wie === 'jij' ? 'user' : 'assistant', tekst: b.tekst });
      else delen.push(p.rol === 'prive' ? VOORBEELDEN_PRIVE : VOORBEELDEN);   // §163: de voorbeeldgesprekjes staan in gesprek-modus altijd in de prompt
      // §163: feiten over de eigenaar als TREFWOORDLIJST (door de eigenaar zelf gevuld in de hoek; nooit hier hard ingevuld).
      if (p.feiten.trim()) delen.push(`Feiten over de eigenaar (trefwoorden, van hemzelf, waar): ${p.feiten.trim()}`);
      if (p.samenvatting.trim()) delen.push(`Samenvatting van eerdere gesprekken: ${p.samenvatting.trim()}`);
    }
    if (stijlMee) delen.push(`Stijl (van de eigenaar zelf): ${p.stijl.trim()}`);
    delen.push(EERLIJK);
    if (tekst(x.geheugen).trim()) delen.push(tekst(x.geheugen).trim());
    const oud = alle.slice(0, Math.max(0, alle.length - LETTERLIJK));
    const recent = alle.slice(-LETTERLIJK);
    const sam = samenvatBeurten(oud);
    if (sam) delen.push(`Eerder in dit gesprek: ${sam}`);
    if (recent.length) {
      if (keten) for (const b of recent) berichten.push({ rol: b.wie === 'jij' ? 'user' : 'assistant', tekst: knip(b.tekst, 600) });
      else delen.push(`Laatste beurten:\n${recent.map((b) => `${b.wie === 'jij' ? 'Eigenaar' : NAAM}: ${knip(b.tekst, 600)}`).join('\n')}`);
    }
    const herinnering = beurt % HERINNER_ELKE === 0;
    if (herinnering) delen.push(HERINNERING);
    // §163: ROL HERHALEN BIJ EEN NIEUW ONDERWERP. Deelt de nieuwe vraag bijna geen inhoudswoorden met de vorige beurt, dan is het
    // waarschijnlijk een ander onderwerp -- zet er dan nog eens kort bij wie ze is, zodat ze niet wegzakt bij de overgang.
    const nieuwOnderwerp = alle.length >= 2 && geenOverlap(tekst(x.vraag), (alle[alle.length - 1] || {}).tekst);
    if (nieuwOnderwerp) delen.push(p.rol === 'prive' ? `Nieuw onderwerp. Je bent nog steeds ${NAAM} in de privé-hoek: warm, speels, kort en eerlijk, in het Nederlands.` : `Nieuw onderwerp. Je bent nog steeds ${NAAM}: rustig, kort en eerlijk, in het Nederlands.`);
    let stemming = null;
    if (p.rol === 'prive') {
      stemming = p.stemming === 'auto' ? stemmingUitToon([x.vraag].concat(alle.filter((b) => b.wie === 'jij').slice(-3).map((b) => b.tekst))) : p.stemming;
      delen.push(STEMMINGEN[stemming]);
    }
    delen.push(p.rol === 'prive' ? GEHEUGENSTEUN_PRIVE : GEHEUGENSTEUN);   // §163: de korte geheugensteun vlak voor ELK antwoord (altijd, vlak voor de slotregel)
    delen.push(p.rol === 'prive' ? SLOTREGEL_PRIVE : SLOTREGEL);       // altijd de LAATSTE regel
    return { rol: p.rol, stemming: stemming, systeem: delen.join('\n\n'), vraag: tekst(x.vraag).trim(), beurt, herinnering, nieuwOnderwerp, stijlMee, keten, berichten };
  }

  // ---- De zes gereedschappen: vaste opdrachten met een vaste antwoordvorm, nagekeken door de code ----
  const GEREEDSCHAP = Object.freeze({
    samenvat: { naam: 'Vat samen', opdracht: 'Vat dit samen in drie tot vijf korte zinnen. Alleen de samenvatting.' },
    vertaal: { naam: 'Vertaal', opdracht: 'Vertaal dit naar het Engels. Alleen de vertaling, geen uitleg.' },
    janee: { naam: 'Ja of nee', opdracht: 'Antwoord met ja of nee als eerste woord, daarna hoogstens een zin waarom.' },
    lijst: { naam: 'Lijstje', opdracht: 'Geef hoogstens vijf punten, elk op een eigen regel die begint met "- ".' },
    kort: { naam: 'Kort', opdracht: 'Antwoord in hoogstens twee zinnen.' },
    stappen: { naam: 'Stappen', opdracht: 'Geef hoogstens zes genummerde stappen, elk op een eigen regel ("1. ...").' },
  });
  function controleer(soort, antwoord) {
    const a = tekst(antwoord).trim();
    if (!GEREEDSCHAP[soort]) return { ok: false, reden: 'onbekend gereedschap' };
    if (!a) return { ok: false, reden: 'leeg antwoord' };
    const z = zinnen(a).length;
    const regels = a.split(/\n/).map((r) => r.trim()).filter(Boolean);
    if (soort === 'samenvat') return z >= 3 && z <= 5 ? { ok: true } : { ok: false, reden: `${z} zinnen, verwacht drie tot vijf` };
    if (soort === 'vertaal') return /^(hier is|de vertaling|vertaling:|translation:)/i.test(a) ? { ok: false, reden: 'uitleg erbij in plaats van alleen de vertaling' } : { ok: true };
    if (soort === 'janee') return /^(ja|nee)\b/i.test(a) && z <= 2 ? { ok: true } : { ok: false, reden: 'begint niet met ja of nee, of te lang' };
    if (soort === 'lijst') return regels.length >= 1 && regels.length <= 5 && regels.every((r) => r.startsWith('- ')) ? { ok: true } : { ok: false, reden: 'geen lijstje van hoogstens vijf regels met "- "' };
    if (soort === 'kort') return z <= 2 ? { ok: true } : { ok: false, reden: `${z} zinnen, hoogstens twee` };
    return regels.length >= 1 && regels.length <= 6 && regels.every((r, i) => r.startsWith(`${i + 1}. `)) ? { ok: true } : { ok: false, reden: 'geen genummerde stappen (hoogstens zes)' };
  }

  // ---- Praten: hoogstens twee zinnen, en per zin voorlezen ----
  function voorTeLezen(antwoord) { return zinnen(antwoord).slice(0, 2); }
  // Voor een antwoord dat in stukken binnenkomt: volle zinnen eruit, de rest blijft wachten.
  function haalZinnen(buffer) {
    const b = tekst(buffer);
    const m = b.match(/^[\s\S]*[.!?](?=\s)/);
    if (!m) return { klaar: [], rest: b };
    return { klaar: zinnen(m[0]), rest: b.slice(m[0].length).trimStart() };
  }

  return { NAAM, KAART, KAART_PRIVE, STEMMINGEN, stemmingUitToon, VOORBEELD_BEURTEN_PRIVE, VOORBEELDEN_PRIVE, GEHEUGENSTEUN_PRIVE, SLOTREGEL_PRIVE, VOORBEELDEN, VOORBEELD_BEURTEN, GEHEUGENSTEUN, PERSONA_TEST, EERLIJK, SLOTREGEL, HERINNERING, LETTERLIJK, HERINNER_ELKE, GEREEDSCHAP, leesPersona, zinnen, samenvatBeurten, bouw, controleer, toetsPersonaVorm, geenOverlap, voorTeLezen, haalZinnen, eersteAlinea, filter };
}));
