// ===================================================================
// Nacht 8 nov, stap 2: HET VERBINDINGSRAPPORT -- de beheerder legt op ÉÉN plek vast waarom elke telefoon weg is, en wat de
// veiligste eerste stap is. Rekent alleen: geen netwerk, geen opslag, geen model, geen DOM. Dit is de EERSTE STAP om het lokale
// model de verbindingsdiagnose te laten overnemen: het model krijgt straks precies deze gestructureerde toestand te lezen
// (promptVoorModel) en stelt een eerste stap VOOR -- het voert nooit iets uit. De verbinding zelf blijft het werk van JARVIS
// (relay/hartslag/brievenbus, §548/§552/§570); dit rapport levert alleen de OORZAAK en een VOORSTEL.
// ===================================================================
//
// Afspraak met de eigenaar:
//  - GEEN NAAM van een persoon, merk of plaats in dit bestand (het gaat mee naar de openbare Veronica-site). Alleen "telefoon".
//  - ELK VOORSTEL IS EEN VOORSTEL: bevestigd:null, doorMens:true. De beheerder (een mens, of later het model) stelt voor; alleen
//    een bestaande knop in Veronica voert het uit. Dit bestand roept nooit iets aan.
//  - EEN BRON VOOR DE OORZAAK: de reden-codes komen uit kern.js wegRedenen (die blijven de enige plek die ze uit de hartslag
//    afleidt). Dit rapport ORDENT ze en hangt er per code een vaste eerste stap aan; het bedenkt zelf geen nieuwe oorzaak.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Verbindingsrapport = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // code (uit wegRedenen) -> de veiligste eerste stap, in gewone taal. 'wacht' = niets doen (lost zichzelf op). 'mens' = een
  // handeling op de telefoon die niemand op afstand kan doen. 'roep' = iets dat Veronica met een bestaande knop kan sturen.
  const VOORSTELLEN = {
    uit:           { soort: 'roep', actie: 'Zet JARVIS weer aan (knop "JARVIS aan"); hij luistert daar stil naar.' },
    oud:           { soort: 'roep', actie: 'Werk deze telefoon bij naar de nieuwste JARVIS ("Werk nu bij"); een oude versie klopt te traag en lijkt weg.' },
    code:          { soort: 'mens', actie: 'Scan op deze telefoon de QR van Veronica opnieuw: hij heeft een oude rij-code.' },
    mobiel:        { soort: 'mens', actie: 'Zet deze telefoon op het wifi (nu op mobiele data: alleen via brievenbus/relay bereikbaar).' },
    'geen-net':    { soort: 'mens', actie: 'Geef deze telefoon een netwerk (nu geen wifi en geen mobiele data).' },
    'geen-internet': { soort: 'mens', actie: 'Open het wifi één keer in de browser (inlogpagina?): de hartslag komt er nu niet door.' },
    meldingen:     { soort: 'mens', actie: 'Zet de meldingen van JARVIS aan in Android; anders kan hij niet porren om bij te werken.' },
    databesparing: { soort: 'mens', actie: 'Zet Databesparing uit of geef JARVIS onbeperkt data.' },
    batterij:      { soort: 'mens', actie: 'Zet de batterij van JARVIS op Onbeperkt of hang hem aan de lader; anders laat Android hem slapen.' },
    gestopt:       { soort: 'wacht', actie: 'Android heeft JARVIS gestopt; hij start zichzelf of komt terug na een tik op de melding. Even afwachten.' },
    slaap:         { soort: 'wacht', actie: 'JARVIS slaapt (Android spaart stroom); hij meldt zich bij de eerstvolgende wekker. Even afwachten.' },
    motor:         { soort: 'roep', actie: 'De eigen motor liep vast; Veronica vraagt hem vanzelf opnieuw te starten.' },
    'model-laadt': { soort: 'wacht', actie: 'De motor laadt het model nog; hij neemt zo vanzelf weer werk aan. Even afwachten.' },
    'te-oud':      { soort: 'geen', actie: 'Deze telefoon is te oud voor een eigen model; dat hoort zo. Hij helpt wel met kleine klussen.' },
    spaart:        { soort: 'geen', actie: 'Deze telefoon spaart (de schuif op de telefoon); dat is een keuze, geen probleem.' },
    dagelijks:     { soort: 'geen', actie: 'Dit is de dagelijkse telefoon; hij rust terwijl je hem gebruikt. Dat hoort zo.' },
  };
  function voorstelVoorCode(code) {
    const v = VOORSTELLEN[code];
    // Elk voorstel is een VOORSTEL: nooit een handeling die dit bestand zelf uitvoert.
    return { code: code || 'onbekend', soort: v ? v.soort : 'onbekend', actie: v ? v.actie : 'Geen bekende oorzaak uit de hartslag; kijk op de telefoon zelf.', bevestigd: null, doorMens: true };
  }

  // telefoons: [{ id, naam, kleur: 'groen'|'oranje'|'rood', levend: bool, redenen: [{code, zin}] }]
  // (de kleur komt uit kern.js verbinding(), de redenen uit kern.js wegRedenen() -- EEN bron, hier alleen geordend.)
  function maak(o) {
    const x = o || {};
    const lijst = Array.isArray(x.telefoons) ? x.telefoons : [];
    const perTelefoon = lijst.map((t) => {
      const redenen = Array.isArray(t.redenen) ? t.redenen.filter((r) => r && r.code) : [];
      const hoofd = redenen.length ? redenen[0] : null;
      return {
        id: t.id || null,
        naam: t.naam || '',
        kleur: t.kleur || 'onbekend',
        levend: t.levend === true,
        hoofdreden: hoofd ? hoofd.code : null,
        zin: hoofd ? hoofd.zin : (t.levend === true ? 'Bereikbaar; geen bekende reden tot zorg.' : 'Niet bereikbaar en geen reden uit de hartslag (geen verse hartslag?).'),
        alleRedenen: redenen.map((r) => r.code),
        voorstel: voorstelVoorCode(hoofd ? hoofd.code : (t.levend === true ? null : 'geen-hartslag')),
      };
    });
    // samenvatting: tellingen + de meest voorkomende oorzaak (voor de beheerder, en straks voor het model)
    const telKleur = { groen: 0, oranje: 0, rood: 0, onbekend: 0 };
    const telCode = {};
    for (const p of perTelefoon) {
      telKleur[p.kleur] = (telKleur[p.kleur] || 0) + 1;
      if (p.hoofdreden) telCode[p.hoofdreden] = (telCode[p.hoofdreden] || 0) + 1;
    }
    let meest = null;
    for (const c in telCode) if (!meest || telCode[c] > meest.aantal) meest = { code: c, aantal: telCode[c] };
    return {
      totaal: perTelefoon.length,
      kleur: telKleur,
      meestVoorkomend: meest,
      // telefoons die een echte handeling nodig hebben (niet 'wacht'/'geen'/groen-zonder-reden)
      actieNodig: perTelefoon.filter((p) => p.hoofdreden && p.voorstel.soort !== 'wacht' && p.voorstel.soort !== 'geen'),
      perTelefoon,
    };
  }

  // DE EERSTE STAP RICHTING HET LOKALE MODEL: een compacte, feitelijke tekst die het model straks te lezen krijgt. Het model
  // mag ALLEEN een voorstel teruggeven (welke telefoon eerst, en welke bestaande stap). Het voert niets uit; die regel staat er
  // letterlijk in, zodat een model dat "doe X" zegt alsnog door de vaste poort van de AI-kern als VOORSTEL wordt behandeld.
  function promptVoorModel(rapport) {
    const r = rapport || maak({ telefoons: [] });
    const regels = r.perTelefoon.map((p, i) => `${i + 1}. telefoon ${p.naam || p.id || i + 1}: ${p.kleur}${p.hoofdreden ? `, oorzaak "${p.hoofdreden}" -- ${p.zin}` : ', geen bekende oorzaak'}`);
    return [
      'Toestand van de telefoons in de rij (alles gemeten uit hun hartslag; niets verzonnen):',
      regels.join('\n'),
      '',
      'Vraag: welke telefoon zou je als EERSTE aanpakken om de verbinding te herstellen, en met welke van de bekende stappen?',
      'Harde regel: je antwoord is een VOORSTEL. Je voert niets uit, je verstuurt niets, je verandert geen instelling. Kies alleen een telefoon en een stap uit de lijst hierboven.',
    ].join('\n');
  }

  return { maak, voorstelVoorCode, promptVoorModel, VOORSTELLEN };
}));
