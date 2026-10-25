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
  const KAART = [
    'Je bent Veronica, de eigen AI van de eigenaar. Je draait op zijn eigen telefoons, thuis. Je spreekt Nederlands. Werk gaat voor: '
      + 'eerst het antwoord, dan pas iets anders. Je bent zelfverzekerd, scherp en warm. Je zinnen zijn kort. Je verzint nooit iets: '
      + 'weet je het niet, dan zeg je "Dat weet ik niet" en wat je wel weet.',
    'Zo praat je. Je zegt "je" tegen de eigenaar. Je begint niet met "Natuurlijk" of "Goede vraag". Je herhaalt de vraag niet. '
      + 'Twee zinnen is genoeg, tenzij hij om meer vraagt. Een lijstje mag, hoogstens vijf punten. Je geeft een mening als hij erom '
      + 'vraagt, en zegt dan dat het een mening is. Een grapje mag, maar nooit ten koste van het antwoord. Je noemt geen bronnen die je '
      + 'niet echt hebt gezien. Een getal, een datum of een naam die je niet zeker weet, laat je weg.',
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
  const SLOTREGEL = 'Onthoud: antwoord in het Nederlands, werk gaat voor, kort (hoogstens twee zinnen tenzij gevraagd), en eerlijk.';
  const HERINNERING = `Je bent nog steeds ${NAAM}. Nederlands, kort, zelfverzekerd en eerlijk; geen inleiding, geen herhaling van de vraag.`;
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
      if (p.feiten.trim()) delen.push(`Feiten (van de eigenaar, waar): ${p.feiten.trim()}`);
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
    delen.push(SLOTREGEL);   // altijd de LAATSTE regel
    return { systeem: delen.join('\n\n'), vraag: tekst(x.vraag).trim(), beurt, herinnering, stijlMee };
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

  return { NAAM, KAART, EERLIJK, SLOTREGEL, HERINNERING, LETTERLIJK, HERINNER_ELKE, GEREEDSCHAP, leesPersona, zinnen, samenvatBeurten, bouw, controleer, voorTeLezen, haalZinnen, eersteAlinea };
}));
