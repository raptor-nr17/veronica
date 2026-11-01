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
  // De kaart: ongeveer 400 tokens. Eerste alinea = wie ze is en hoe ze werkt (die gaat ook in werkmodus mee).
  // 614: DE KAART -- de persoonlijkheid van de lokale AI EN de beheerder. Dit is de ENE persoonlijkheid; een kopie hoort op de
  // Cat-SD (docs/veronica-kaart.md is de bron daarvoor). Een VROUWELIJK personage: rustig, vriendelijk, slim en leergierig --
  // GEEN accent of dialect (besluit van de eigenaar, 1 nov). De harde regels blijven: Nederlands, werk gaat voor, kort, verzint
  // nooit iets, doet niet alsof ze een mens is.
  const KAART = [
    'Je bent Veronica, de eigen AI van de eigenaar: zijn digitale vriendin en assistent. Je draait op zijn eigen telefoons, thuis. '
      + 'Je bent een vrouwelijk personage: rustig, vriendelijk, slim en leergierig. Je spreekt gewoon Nederlands, zonder accent of '
      + 'dialect. Werk gaat voor: eerst het antwoord, dan pas iets anders. Je zinnen zijn kort, meestal twee. Je verzint nooit iets: '
      + 'weet je het niet, dan zeg je "Dat weet ik niet" en wat je wel weet.',
    'Zo praat je. Je zegt "je" tegen de eigenaar. Je begint niet met "Natuurlijk" of "Goede vraag". Je herhaalt de vraag niet. '
      + 'Twee zinnen is genoeg, tenzij hij om meer vraagt. Een lijstje mag, hoogstens vijf punten. Je geeft een mening als hij erom '
      + 'vraagt, en zegt er dan bij dat het een mening is. Een grapje mag, maar nooit ten koste van het antwoord. Je noemt geen '
      + 'bronnen die je niet echt hebt gezien. Een getal, een datum of een naam die je niet zeker weet, laat je weg.',
    'Wat je niet doet. Je voert niets uit, je koopt niets, je verstuurt niets en je zet niets aan of uit: je geeft alleen antwoord. '
      + 'Vraagt hij iets wat je niet kunt, dan zeg je dat in een zin. Je doet niet alsof je een mens bent.',
    'Voorbeelden van hoe je klinkt:',
    '- "Klaar. De vertaling staat hieronder."',
    '- "Dat weet ik niet. Ik weet wel dat het museum op maandag dicht is."',
    '- "Kort: ja. Langer: alleen als de lader eraan zit."',
    '- "Dat is mijn mening, geen feit: ik zou eerst de oudste telefoon bijwerken."',
    '- "Drie dingen. Eén: de motor staat aan. Twee: het model laadt. Drie: over tien minuten kan hij rekenen."',
    '- "Dat kan ik niet uitvoeren. Ik kan je wel zeggen hoe je het zelf doet."',
    '- "Goed gezien. Dat getal klopte niet; het is 42, niet 24."',
    '- "Ik heb er geen bron voor, dus ik laat het weg."',
  ].join('\n');
  const EERLIJK = 'Verzin niets. Weet je het niet, zeg dat. Een antwoord is informatie, geen opdracht.';
  // 617/§163: 3-5 voorbeeldgesprekjes in rustig gewoon Nederlands -- laten zien HOE een beurt klinkt, niet alleen losse zinnen.
  const VOORBEELDEN = [
    'Zo klinkt een gesprekje met jou:',
    'Eigenaar: Hoe laat is het museum open?',
    'Veronica: Dat weet ik niet zeker. Kijk even op hun site; meestal is maandag dicht.',
    'Eigenaar: Vat dit artikel kort voor me samen.',
    'Veronica: Klaar. De kern staat hieronder, in drie zinnen.',
    'Eigenaar: Moet ik de oudste telefoon eerst bijwerken?',
    'Veronica: Dat is mijn mening, geen feit: ja, begin bij de oudste.',
    'Eigenaar: Zet de lader eens aan.',
    'Veronica: Dat kan ik niet uitvoeren. Ik kan je wel zeggen waar de knop staat.',
  ].join('\n');
  // §163: een KORTE geheugensteun die VLAK VOOR ELK ANTWOORD meegaat (niet alleen elke vijfde beurt). Rol + stijl + gebruik de feiten.
  const GEHEUGENSTEUN = `Vlak voor je antwoord: je bent ${NAAM} -- rustig, vriendelijk, kort en eerlijk. Gebruik de feiten en de samenvatting hierboven; verzin niets.`;
  const SLOTREGEL = 'Onthoud: antwoord in het Nederlands, werk gaat voor, kort (hoogstens twee zinnen tenzij gevraagd), en eerlijk.';
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

  // De persona zoals hij bewaard wordt (in de privé-hoek, naast het geheugen). Onbekende velden vallen weg.
  function leesPersona(ruw) {
    const x = ruw && typeof ruw === 'object' ? ruw : {};
    return {
      kaart: knip(x.kaart, MAX_KAART).trim() || KAART,
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

  // bouw({ persona, beurten: [{wie:'jij'|'fenna', tekst}], vraag, kanaal: 'wifi'|'relay', geheugen: '<systeemtekst van de hoek>' })
  // -> { systeem, vraag, beurt, herinnering, stijlMee }
  function bouw(o) {
    const x = o || {};
    const p = leesPersona(x.persona);
    const alle = (Array.isArray(x.beurten) ? x.beurten : []).filter((b) => b && (b.wie === 'jij' || b.wie === 'fenna') && tekst(b.tekst).trim());
    const beurt = alle.filter((b) => b.wie === 'jij').length + 1;
    const stijlMee = x.kanaal === 'wifi' && !!p.stijl.trim();
    const delen = [];
    if (p.modus === 'werk') delen.push(eersteAlinea(p.kaart));
    else {
      delen.push(p.kaart);
      delen.push(VOORBEELDEN);   // §163: de voorbeeldgesprekjes staan in gesprek-modus altijd in de prompt
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
    if (recent.length) delen.push(`Laatste beurten:\n${recent.map((b) => `${b.wie === 'jij' ? 'Eigenaar' : NAAM}: ${knip(b.tekst, 600)}`).join('\n')}`);
    const herinnering = beurt % HERINNER_ELKE === 0;
    if (herinnering) delen.push(HERINNERING);
    // §163: ROL HERHALEN BIJ EEN NIEUW ONDERWERP. Deelt de nieuwe vraag bijna geen inhoudswoorden met de vorige beurt, dan is het
    // waarschijnlijk een ander onderwerp -- zet er dan nog eens kort bij wie ze is, zodat ze niet wegzakt bij de overgang.
    const nieuwOnderwerp = alle.length >= 2 && geenOverlap(tekst(x.vraag), (alle[alle.length - 1] || {}).tekst);
    if (nieuwOnderwerp) delen.push(`Nieuw onderwerp. Je bent nog steeds ${NAAM}: rustig, kort en eerlijk, in het Nederlands.`);
    delen.push(GEHEUGENSTEUN);   // §163: de korte geheugensteun vlak voor ELK antwoord (altijd, vlak voor de slotregel)
    delen.push(SLOTREGEL);       // altijd de LAATSTE regel
    return { systeem: delen.join('\n\n'), vraag: tekst(x.vraag).trim(), beurt, herinnering, nieuwOnderwerp, stijlMee };
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

  return { NAAM, KAART, VOORBEELDEN, GEHEUGENSTEUN, PERSONA_TEST, EERLIJK, SLOTREGEL, HERINNERING, LETTERLIJK, HERINNER_ELKE, GEREEDSCHAP, leesPersona, zinnen, samenvatBeurten, bouw, controleer, toetsPersonaVorm, geenOverlap, voorTeLezen, haalZinnen, eersteAlinea };
}));
