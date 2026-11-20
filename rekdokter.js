// ===================================================================
// 678 (15 nov, eigenaar: "de lokale AI moet de problemen managen"): DE REKDOKTER. Je typt in Veronica ("wat is er mis met het rek?"),
// en de lokale AI kijkt de rektelefoons na, zegt wat er mis is en stelt een herstel voor. Een mens tikt "Doe het"; pas dan gebeurt er iets.
//
// De verdeling is vast, dezelfde als bij het storingsadvies (punt 14) en de taalcontrole:
//  - de DIAGNOSE is gewone code (deze module): uit de feiten die Veronica al heeft (hartslag, verbinding, de redenen van kern.wegRedenen,
//    de vinger van de rij-code, de versie, de stops van Android). Niets geraden: wat er niet is, is er niet.
//  - de ACTIES komen uit een vaste lijst (ACTIES): alleen knoppen die Veronica al heeft en die terug te draaien zijn. Nooit iets voor de
//    dagelijkse telefoon; nooit de rol of de code van de beheerder.
//  - het MODEL mag de uitleg schrijven en per probleem hoogstens EEN actie uit die lijst kiezen. De code leest dat streng (leesAntwoord):
//    een actie die niet bij dat probleem hoort, of een getal dat nergens in de feiten staat, en het hele modelantwoord vervalt -- dan geldt
//    codeAntwoord. Zo werkt de rekdokter ook zonder model.
// PUUR: geen netwerk, geen opslag, geen DOM. Afspraak: geen merk, persoon of plaats in dit bestand (het gaat mee naar de openbare site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Rekdokter = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // De vaste lijst. "wie" zegt welke bestaande functie in veronica.js het doet; "nooit" = rollen waarvoor de actie nooit mag.
  const ACTIES = Object.freeze({
    'code-herstel': { label: 'Stuur hem de rij-code van Veronica', wat: 'de telefoon neemt de rij-code van Veronica over; zijn rol blijft hetzelfde', nooit: ['kern', 'dagelijks'] },
    'jarvis-aan': { label: 'Zet JARVIS weer aan', wat: 'JARVIS gaat weer aan (hij stond uit of in de noodstop)', nooit: ['dagelijks'] },
    'motor-herstel': { label: 'Start de eigen motor opnieuw', wat: 'de eigen motor van de telefoon start opnieuw', nooit: ['dagelijks'] },
    'bijwerk-nu': { label: 'Werk JARVIS bij', wat: 'JARVIS haalt de vrijgegeven versie; op de telefoon komt een melding om op Installeren te tikken', nooit: ['dagelijks'] },
    'maak-werker': { label: 'Maak er een werker van', wat: 'de telefoon wordt een werker van de rij van Veronica (neemt haar rij-code over)', nooit: ['kern', 'dagelijks'] },
    'rij-oproepen': { label: 'Roep de rij op', wat: 'Veronica roept alle telefoons op en kijkt wie er antwoordt', nooit: [] },
    // Via ARTEMIS (de console op deze computer, via adb op kabel of Tailscale). Alleen aangeboden als ARTEMIS hier draait. ARTEMIS slaat de dagelijkse telefoon
    // zelf over en raakt alleen het JARVIS-pakket aan. Deze handelingen gaan over ALLE rektelefoons die ARTEMIS ziet, niet over een.
    'artemis-waak': { label: 'Laat ARTEMIS JARVIS nakijken en herstarten', wat: 'ARTEMIS kijkt via adb of JARVIS draait, start hem zo nodig opnieuw en zet zijn batterij op Onbeperkt (op elke rektelefoon die hij ziet)', nooit: ['dagelijks'], artemis: 'jarvis-waak' },
    'artemis-terugval': { label: 'Zet de vrijgegeven JARVIS terug (proeftelefoon)', wat: 'ARTEMIS zet op de proeftelefoon de bewaarde vrijgegeven JARVIS terug; de gegevens blijven staan', nooit: ['dagelijks', 'kern'], artemis: 'jarvis-terugval', bevestig: true },
    'artemis-rijcode': { label: 'Laat ARTEMIS de rij-code via de kabel zetten', wat: 'ARTEMIS geeft elke rektelefoon aan de kabel of Tailscale de rij-code van Veronica, zonder QR en zonder tik op de telefoon', nooit: ['dagelijks', 'kern'], artemis: 'rijcode-zet' },
    'artemis-meld': { label: 'Laat ARTEMIS de meldingen nakijken', wat: 'ARTEMIS kijkt per rektelefoon of hij zich bij de relay meldt, en waarom niet (alleen lezen)', nooit: [], artemis: 'meld-status' },
  });

  // De redenen van kern.wegRedenen (code) -> hoe erg en welke acties. Zonder actie = alleen een advies (de zin van wegRedenen zegt al wat te doen).
  const REDEN = Object.freeze({
    uit: { ernst: 3, acties: ['jarvis-aan'] },
    motor: { ernst: 2, acties: ['motor-herstel'] },
    code: { ernst: 2, acties: [] },
    gestopt: { ernst: 1, acties: [] },
    slaap: { ernst: 1, acties: [] },
    oud: { ernst: 1, acties: ['bijwerk-nu'] },
    batterij: { ernst: 1, acties: [] },
    'geen-net': { ernst: 2, acties: [] },
    'geen-internet': { ernst: 2, acties: [] },
    mobiel: { ernst: 1, acties: [] },
    meldingen: { ernst: 1, acties: [] },
    databesparing: { ernst: 1, acties: [] },
    'model-laadt': { ernst: 0, acties: [] },
    'te-oud': { ernst: 0, acties: [] },
    spaart: { ernst: 0, acties: [] },
    dagelijks: { ernst: 0, acties: [] },
  });

  function nieuwer(a, b) {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
    return false;
  }
  // 678 (20 nov): een telefoon met een AI-rol in het rek (t.rek) is een REKTELEFOON, ook als hij een eigen rij leidt (voorkeur kern): die krijgt
  // gewoon de code van Veronica. Alleen de echte beheerder (kern, geen rektelefoon) en de dagelijkse telefoon blijven met rust.
  const rolVan = (t) => (t.dagelijks ? 'dagelijks' : (t.voorkeur === 'kern' && t.rek !== true) ? 'kern' : 'rek');
  const magActie = (actie, t) => !!ACTIES[actie] && ACTIES[actie].nooit.indexOf(rolVan(t)) === -1;
  const naamVan = (t) => String(t.naam || 'Een telefoon').replace(/[\u0000-\u001f]/g, ' ').slice(0, 40);

  // telefoon: { id, naam, voorkeur, dagelijks, verbinding: {kleur, zin} | null, redenen: [{code, zin}], codeOud: bool, versie, nieuwste,
  //            versieOud: bool, crashes: aantal keer vastgelopen in 24 uur (reden 4/5 van Android) }
  // o.artemis = ARTEMIS draait op deze computer (dan komen de ARTEMIS-acties erbij). Zonder: alleen wat Veronica zelf kan.
  // o.artemisLijst = wat ARTEMIS via adb ziet (rekaanwezig.lees: model, via, toestel, jarvis, meldt, temp). Een telefoon die ARTEMIS ziet maar die
  // zich niet bij Veronica meldt, is juist het geval waar ARTEMIS kan helpen; en ziet ARTEMIS een stille telefoon wel, dan staat hij in elk geval aan.
  const VIA_ZIN = { kabel: 'aan de kabel', wifi: 'over het wifi', tailscale: 'via Tailscale' };
  function diagnose(telefoons, o) {
    const metArtemis = !!(o && o.artemis);
    const ar = metArtemis && Array.isArray(o.artemisLijst) ? o.artemisLijst.filter((x) => x && typeof x === 'object') : [];
    const arVan = (id) => ar.find((x) => x.toestel && x.toestel === id) || null;
    const uit = [];
    let n = 0;
    const ids = new Set();
    for (const t of Array.isArray(telefoons) ? telefoons : []) {
      if (!t || !t.id) continue;
      ids.add(t.id);
      const naam = naamVan(t);
      const a = arVan(t.id);
      const voeg = (soort, ernst, zin, acties) => {
        n += 1;
        uit.push({ id: `p${n}`, telefoon: t.id, naam, soort, ernst, zin, acties: (acties || []).filter((a) => magActie(a, t) && (metArtemis || !ACTIES[a].artemis)) });
      };
      const kleur = t.verbinding && t.verbinding.kleur;
      if (kleur === 'rood') voeg('stil', 3, `${naam}: ${t.verbinding.zin}${a ? ` ARTEMIS ziet hem wel (${VIA_ZIN[a.via] || a.via}), dus hij staat aan; het zit in JARVIS of in de verbinding.` : ''}`, ['rij-oproepen', 'jarvis-aan', 'artemis-waak', 'artemis-meld']);
      if (a && typeof a.temp === 'number' && a.temp >= 42) voeg('warm', 2, `${naam} is warm: de batterij is ${String(a.temp).replace('.', ',')} graden. Laat hem afkoelen (van de lader, uit de zon) voor hij weer zwaar werk krijgt.`, []);
      if (t.codeOud === true) {
        if (rolVan(t) === 'rek') voeg('code-oud', 3, `${naam} gebruikt een andere rij-code dan Veronica: Veronica en de andere telefoons kunnen hem dan niets vragen (de motor en de stem zeggen "verkeerde sleutel"). Dat is zonder QR op te lossen.`, ['code-herstel', 'artemis-rijcode']);
        else if (rolVan(t) === 'kern') voeg('code-oud', 2, `${naam} is de beheerder, maar zijn rij-code wijkt af van die van Veronica. Dat zet ik niet zelf om: scan de koppel-QR opnieuw als dat niet de bedoeling is.`, []);
      }
      if (typeof t.crashes === 'number' && t.crashes >= 1) {
        // een PROEFVERSIE (nieuwer dan de vrijgegeven) die vastloopt: terug naar de vrijgegeven versie; anders: laten nakijken en herstarten
        const proef = !!(t.versie && t.nieuwste && nieuwer(t.versie, t.nieuwste));
        voeg('crash', t.crashes >= 2 ? 3 : 2, `${naam}: JARVIS liep ${t.crashes === 1 ? 'een keer' : `${t.crashes} keer`} vast in het laatste etmaal (een fout in de app zelf, niet in de verbinding).${t.versie ? ` Hij draait JARVIS ${t.versie}${proef ? `, een proefversie (de vrijgegeven is ${t.nieuwste})` : ''}.` : ''}${proef ? ' Herhaalt dit zich, zet dan de vrijgegeven versie terug.' : ''}`, proef ? ['artemis-terugval'] : ['artemis-waak']);
      }
      for (const r of Array.isArray(t.redenen) ? t.redenen : []) {
        if (!r || !REDEN[r.code]) continue;
        if (r.code === 'gestopt' && typeof t.crashes === 'number' && t.crashes >= 1) continue;   // al genoemd als vastgelopen
        if (r.code === 'oud' && t.versieOud) continue;                                            // hieronder, met de versie erbij
        voeg(r.code, REDEN[r.code].ernst, `${naam}: ${String(r.zin || '').slice(0, 300)}`, REDEN[r.code].acties);
      }
      if (t.versieOud === true && t.versie && t.nieuwste) voeg('versie', 1, `${naam} draait JARVIS ${t.versie}; de vrijgegeven versie is ${t.nieuwste}.`, ['bijwerk-nu']);
    }
    // Wat ARTEMIS ziet maar zich NIET bij Veronica meldt (geen hartslag van het laatste etmaal, of geen JARVIS die antwoordt).
    for (const a of ar) {
      if (a.toestel && ids.has(a.toestel)) continue;
      const naam = String(a.model || 'Een telefoon').replace(/[\u0000-\u001f]/g, ' ').slice(0, 40);
      const via = VIA_ZIN[a.via] || a.via || 'via adb';
      const t = { id: a.toestel || `artemis-${a.sleutel || n}`, naam, voorkeur: 'rek', dagelijks: false };
      const voeg = (soort, ernst, zin, acties) => { n += 1; uit.push({ id: `p${n}`, telefoon: t.id, naam, soort, ernst, zin, acties: acties.filter((x) => magActie(x, t)) }); };
      if (!a.toestel) voeg('jarvis-weg', 3, `${naam}: ARTEMIS ziet de telefoon (${via}), maar JARVIS antwoordt er niet. Draait JARVIS daar nog?`, ['artemis-waak']);
      else if (a.meldt === false) voeg('meldt-niet', 3, `${naam}: ARTEMIS ziet hem (${via})${a.jarvis ? ` en JARVIS ${a.jarvis} draait` : ''}, maar hij meldt zich niet bij Veronica. Meestal mist hij het onderwerp of het relay-adres.`, ['artemis-meld', 'artemis-waak']);
      else voeg('meldt-niet', 2, `${naam}: ARTEMIS ziet hem (${via})${a.jarvis ? ` en JARVIS ${a.jarvis} draait` : ''}, maar Veronica heeft het laatste etmaal geen hartslag van hem.`, ['artemis-meld', 'artemis-waak']);
    }
    return uit.sort((a, b) => b.ernst - a.ernst);
  }

  // Een vraag over het rek? Een rek-woord (of de naam van een eigen telefoon) EN een diagnose-woord, of de vraag begint met "rekdokter".
  const REKWOORD = /\b(rek|rektelefoons?|telefoons?|toestellen|jarvis|werkers?|beheerder|motor|rij|hartslag)\b/i;
  const DIAGWOORD = /\b(mis|probleem|problemen|kapot|stuk|werkt niet|doet het niet|nakijken|kijk .{0,30}na|controleer|status|stand|hoe gaat|gaat het|waarom|weg|wegvalt|valt weg|stil|crash\w*|vast|fout\w*|herstel\w*|repareer|maak .{0,20}goed|oplossen|los .{0,20}op|gezond|401|sleutel)\b/i;
  function isRekVraag(tekst, namen) {
    const t = String(tekst || '').trim();
    if (!t) return false;
    if (/^(reke?dokter|dokter)\b/i.test(t)) return true;
    const naam = (Array.isArray(namen) ? namen : []).some((n) => n && n.length >= 2 && new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(t));
    return (REKWOORD.test(t) || naam) && DIAGWOORD.test(t);
  }

  // codeAntwoord: het antwoord zonder model -- kort, eerlijk, uit de diagnose.
  function codeAntwoord(problemen, aantal) {
    const p = Array.isArray(problemen) ? problemen : [];
    const ernstig = p.filter((x) => x.ernst >= 2);
    const tel = Number(aantal) || 0;
    if (!tel) return 'Ik zie nog geen enkele rektelefoon: er is geen verse hartslag. Staat de relay aan, en draait JARVIS op de telefoons?';
    if (!ernstig.length) return `Ik heb ${tel === 1 ? 'een telefoon' : `${tel} telefoons`} nagekeken: niets ernstigs.${p.filter((x) => x.ernst === 1).length ? ' Er zijn wel een paar kleine punten; die staan hieronder.' : ''}`;
    const eerste = ernstig.slice(0, 2).map((x) => x.zin.replace(/\s+/g, ' ').split(/(?<=[.!?])\s/)[0]);
    return `Ik heb ${tel === 1 ? 'een telefoon' : `${tel} telefoons`} nagekeken: ${ernstig.length === 1 ? 'een punt vraagt' : `${ernstig.length} punten vragen`} aandacht. ${eerste.join(' ')}${ernstig.some((x) => x.acties.length) ? ' Hieronder staat wat ik kan doen; tik op een knop, dan doe ik het.' : ''}`;
  }

  // maakPrompt: het model krijgt de vraag en de diagnose, en mag alleen kiezen uit de acties die bij elk probleem staan.
  function maakPrompt(vraag, problemen) {
    const p = (Array.isArray(problemen) ? problemen : []).slice(0, 12);
    const regels = p.map((x) => `${x.id} [ernst ${x.ernst}] ${x.zin}${x.acties.length ? ` (mogelijke acties: ${x.acties.join(', ')})` : ' (geen actie, alleen advies)'}`);
    return [
      'Je bent de rekdokter van een rij oude telefoons die samen een lokale AI vormen. Je antwoordt in het Nederlands, kort en eerlijk.',
      'Hieronder staat wat de code heeft nagekeken. Verzin niets: gebruik alleen deze feiten en noem geen getal dat er niet in staat.',
      `Vraag van de eigenaar: ${String(vraag || '').slice(0, 300)}`,
      'Nagekeken:',
      regels.length ? regels.join('\n') : '(geen problemen gevonden)',
      'Geef ALLEEN deze JSON terug, niets anders:',
      '{"uitleg":"hoogstens drie zinnen voor de eigenaar","doe":[{"probleem":"p1","actie":"een actie uit de lijst bij dat probleem"}]}',
      'Kies per probleem hoogstens een actie, en alleen een actie die bij dat probleem staat. Geen actie nodig = een lege lijst.',
    ].join('\n');
  }

  function getallen(t) { return (String(t || '').match(/\d+(?:[.,]\d+)?/g) || []).map((x) => x.replace(',', '.')); }
  // leesAntwoord: { uitleg, doe: [{probleem, actie}] } of null. Streng: geldige JSON, een uitleg van hoogstens vier zinnen zonder verzonnen
  // getal, en elk voorstel een bestaand probleem met een actie die DAAR bij staat. Een fout = het hele antwoord vervalt (geen half vertrouwen).
  function leesAntwoord(tekst, problemen) {
    const p = Array.isArray(problemen) ? problemen : [];
    let d = null;
    const m = /\{[\s\S]*\}/.exec(String(tekst || ''));
    if (!m) return null;
    try { d = JSON.parse(m[0]); } catch (e) { return null; }
    if (!d || typeof d.uitleg !== 'string') return null;
    const uitleg = d.uitleg.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!uitleg || uitleg.length > 600 || (uitleg.match(/[.!?](\s|$)/g) || []).length > 4) return null;
    const bekend = new Set(getallen(p.map((x) => x.zin).join(' ')));
    if (getallen(uitleg).some((g) => !bekend.has(g))) return null;
    const doe = [];
    for (const x of Array.isArray(d.doe) ? d.doe : []) {
      const pr = p.find((y) => x && y.id === x.probleem);
      if (!pr || pr.acties.indexOf(x.actie) === -1) return null;
      if (!doe.some((y) => y.probleem === pr.id)) doe.push({ probleem: pr.id, actie: x.actie });
    }
    return { uitleg, doe };
  }

  // De samenvatting voor de regel onder het vraagveld (zonder vraag, elke paar minuten): alleen de ernstige punten tellen.
  function regel(problemen, aantal) {
    const p = (Array.isArray(problemen) ? problemen : []).filter((x) => x.ernst >= 2);
    if (!aantal) return '';
    if (!p.length) return `Rekdokter: ${aantal === 1 ? 'de telefoon is' : `alle ${aantal} telefoons zijn`} in orde.`;
    return `Rekdokter: ${p.length === 1 ? 'een punt vraagt' : `${p.length} punten vragen`} aandacht (${p.slice(0, 2).map((x) => x.naam).filter((v, i, l) => l.indexOf(v) === i).join(', ')}). Typ "wat is er mis met het rek?".`;
  }

  return { ACTIES, REDEN, diagnose, isRekVraag, codeAntwoord, maakPrompt, leesAntwoord, regel, magActie };
}));
