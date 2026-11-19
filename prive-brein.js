// ===================================================================
// 678 (19 nov): HET BREIN IN DE PRIVÉ-HOEK -- de regels voor de KNOPPEN, zonder scherm, zonder netwerk en zonder opslag.
// ===================================================================
//
// De eigenaar praat in de privé-hoek met het brein (de lokale AI via ARTEMIS op deze Chromebook: het brein, de kennisbank, de controle
// en de verdeler). Het brein mag een paar knoppen van de hoek bedienen. Dit bestand zegt WELKE en WANNEER; veronica.js voert ze uit met
// de functies die er al waren (de gezamenlijke zoekbalk, de eigen motor aan of uit over het eigen wifi, de live schermen, Stop,
// NOODSTOP, Alles uit). Vier regels, en de CODE kijkt ze na -- niet het model:
//
//  - EEN VASTE LIJST KNOPPEN (KNOPPEN). Een andere naam bestaat niet. Het brein zet hoogstens EEN opdracht op een eigen regel
//    ("KNOP: zoek | ..."); de rest van zijn antwoord is gewone tekst.
//  - ALLEEN ALS DE EIGENAAR ER ZELF OM VROEG. De woorden van de knop moeten in ZIJN vraag staan (bij een telefoon ook de naam of de rol
//    van die telefoon). Stelt het brein een knop voor waar niet om gevraagd is, dan gebeurt er niets en staat dat er eerlijk bij.
//  - STOP, NOODSTOP EN ALLES UIT VRAGEN ALTIJD EERST ZIJN BEVESTIGING (in de pagina, nooit window.confirm).
//  - DE DAGELIJKSE TELEFOON EN EEN TELEFOON MET EEN BANK- OF KLUIS-APP BESTUURT HET BREIN NOOIT (Hoek.aiMagBesturen), en de
//    brein-telefoon krijgt geen eigen motor (zijn geheugen is voor het brein).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.PriveBrein = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // woorden = wat er in de vraag van de EIGENAAR moet staan; bevestig = eerst zijn ja; arg = wat erachter hoort.
  const KNOPPEN = Object.freeze({
    zoek: { arg: 'tekst', bevestig: false, woorden: /\bzoek|\bopzoek|uitzoek|op internet|\bwikipedia\b/i, uitleg: 'zoeken met de telefoons (de gezamenlijke zoekbalk)' },
    telefoon_aan: { arg: 'telefoon', bevestig: false, woorden: /\baan\b|\bstart|\bopstart|\bwakker/i, uitleg: 'de eigen motor van een telefoon aanzetten' },
    telefoon_uit: { arg: 'telefoon', bevestig: false, woorden: /\buit\b|\brust\b|\bslapen\b|\bstil\b/i, uitleg: 'de eigen motor van een telefoon uitzetten' },
    schermen_toon: { arg: null, bevestig: false, woorden: /scherm/i, uitleg: 'de live schermen tonen' },
    schermen_verberg: { arg: null, bevestig: false, woorden: /scherm/i, uitleg: 'de live schermen verbergen' },
    stop: { arg: null, bevestig: true, woorden: /\bstop\b|\bstoppen\b|pantser/i, uitleg: 'Stop: het pantser uit (geen nieuwe klussen)' },
    noodstop: { arg: null, bevestig: true, woorden: /nood/i, uitleg: 'NOODSTOP: alles stopt meteen' },
    alles_uit: { arg: null, bevestig: true, woorden: /\balles\b.*\buit\b|\ballemaal\b.*\buit\b|\balle\b.*\buit\b/i, uitleg: 'Alles uit: alle motoren uit' },
  });
  const NAMEN = Object.freeze(Object.keys(KNOPPEN));
  const KNOP_RE = /^\s*\**\s*KNOP\s*:\s*([a-z_]{2,20})\s*(?:\|\s*(.*?))?\s*\**\s*$/i;

  const schoon = (t, max) => String(t === undefined || t === null ? '' : t).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const klein = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // De systeemtekst voor het brein: de knoppen, de vorm en de telefoons die het mag besturen (alleen naam en rol, nooit een adres).
  function systeem(telefoons) {
    const tels = (Array.isArray(telefoons) ? telefoons : []).filter((t) => t && t.magBesturen).map((t) => `${schoon(t.naam, 40)}${t.rol ? ` (${schoon(t.rol, 20)})` : ''}`);
    return [
      'Je praat met de eigenaar in zijn privé-hoek. Antwoord in het Nederlands, kort en eerlijk. Verzin niets.',
      'Je kunt een paar knoppen van de hoek bedienen, maar ALLEEN als de eigenaar daar zelf om vraagt. Zet dan op de LAATSTE regel precies een opdracht, in deze vorm:',
      'KNOP: zoek | <wat er gezocht moet worden>',
      'KNOP: telefoon_aan | <naam van de telefoon>',
      'KNOP: telefoon_uit | <naam van de telefoon>',
      'KNOP: schermen_toon',
      'KNOP: schermen_verberg',
      'KNOP: stop',
      'KNOP: noodstop',
      'KNOP: alles_uit',
      'Vraagt hij niets daarvan, schrijf dan GEEN KNOP-regel. Stop, noodstop en alles_uit doen pas iets na zijn bevestiging; dat vraagt Veronica.',
      'Voorbeeld: "Zoek eens op wanneer de Afsluitdijk klaar was" -> een korte zin, en als laatste regel: KNOP: zoek | Afsluitdijk gesloten',
      'Voorbeeld: "Wat vind jij van het weer?" -> alleen een antwoord, geen KNOP-regel.',
      tels.length ? `De telefoons die je mag aan- of uitzetten: ${tels.join(', ')}. De dagelijkse telefoon en een telefoon met een bank- of kluis-app bestuur je nooit.`
        : 'Er is nu geen telefoon die je mag aan- of uitzetten.',
    ].join('\n');
  }

  // Uit het antwoord van het brein: de tekst zonder KNOP-regels, en de LAATSTE knop (of null). Een onbekende naam telt niet als knop.
  function leesKnop(antwoord) {
    const regels = String(antwoord || '').split('\n');
    let knop = null;
    const rest = [];
    for (const r of regels) {
      const m = KNOP_RE.exec(r);
      if (m) { const naam = m[1].toLowerCase(); knop = { naam, arg: schoon(m[2] || '', 200), bekend: NAMEN.includes(naam) }; continue; }
      rest.push(r);
    }
    return { tekst: rest.join('\n').trim(), knop };
  }

  // De telefoon die bij een naam of rol hoort (zonder hoofdletters en accenten). Eerst precies, dan een deel.
  function vindTelefoon(arg, telefoons) {
    const a = klein(arg).replace(/^de\s+/, '').trim();
    if (!a) return null;
    const lijst = Array.isArray(telefoons) ? telefoons : [];
    return lijst.find((t) => klein(t.naam) === a || klein(t.rol) === a)
      || lijst.find((t) => (klein(t.naam) && (klein(t.naam).includes(a) || a.includes(klein(t.naam)))) || (klein(t.rol) && a.includes(klein(t.rol)))) || null;
  }
  // Noemde de eigenaar deze telefoon zelf? De naam, een duidelijk deel ervan (3+ tekens met een cijfer of letters), of de rol.
  function genoemd(vraag, t) {
    const v = klein(vraag);
    if (!t) return false;
    if (t.rol && v.includes(klein(t.rol))) return true;
    const n = klein(t.naam);
    if (n && v.includes(n)) return true;
    return n.split(/[^a-z0-9.]+/).filter((w) => w.length >= 3 && !/^(telefoon|rektelefoon|een|de)$/.test(w)).some((w) => v.includes(w));
  }

  // Het besluit over een knop: { doe: 'direct' | 'bevestig' | 'niets', knop, arg, telefoon, zin }. 'niets' heeft altijd een zin.
  function besluit(knop, vraag, telefoons, o) {
    const opt = o || {};
    if (!knop) return null;
    if (!knop.bekend || !KNOPPEN[knop.naam]) return { doe: 'niets', knop: knop.naam, zin: `Het brein noemde een knop die niet bestaat ("${schoon(knop.naam, 20)}"); ik heb niets gedaan.` };
    const k = KNOPPEN[knop.naam];
    if (!k.woorden.test(String(vraag || ''))) return { doe: 'niets', knop: knop.naam, zin: `Het brein wilde ${k.uitleg}, maar daar vroeg je niet om. Ik heb niets gedaan.` };
    if (k.arg === 'tekst') {
      const arg = schoon(knop.arg, 200);
      if (arg.length < 2) return { doe: 'niets', knop: knop.naam, zin: 'Het brein gaf geen zoekvraag mee; ik heb niets gezocht.' };
      return { doe: 'direct', knop: knop.naam, arg, zin: '' };
    }
    if (k.arg === 'telefoon') {
      const t = vindTelefoon(knop.arg, telefoons);
      if (!t) return { doe: 'niets', knop: knop.naam, zin: `Ik ken geen telefoon "${schoon(knop.arg, 40)}". Ik heb niets gedaan.` };
      if (!genoemd(vraag, t)) return { doe: 'niets', knop: knop.naam, zin: `Het brein koos ${schoon(t.naam, 40)}, maar die noemde je niet. Ik heb niets gedaan.` };
      if (!t.magBesturen) return { doe: 'niets', knop: knop.naam, zin: `${schoon(t.naam, 40)} bestuur ik nooit (de dagelijkse telefoon, of er staat een bank- of kluis-app op). Ik heb niets gedaan.` };
      if (knop.naam === 'telefoon_aan' && t.brein) return { doe: 'niets', knop: knop.naam, zin: `${schoon(t.naam, 40)} is de brein-telefoon: zijn geheugen is voor het brein, daar zet ik geen eigen motor aan.` };
      return { doe: 'direct', knop: knop.naam, telefoon: t.id || t.naam, naam: schoon(t.naam, 40), zin: '' };
    }
    return { doe: k.bevestig ? 'bevestig' : 'direct', knop: knop.naam, zin: k.bevestig ? bevestigVraag(knop.naam, opt) : '' };
  }
  function bevestigVraag(naam, o) {
    if (naam === 'noodstop') return 'NOODSTOP: alles stopt meteen (pantser uit, lopend werk afgebroken, de motoren stil). Doorgaan?';
    if (naam === 'stop') return 'Stop: het pantser uit. Er komen geen nieuwe klussen; wat loopt maakt zijn klus af. Doorgaan?';
    if (naam === 'alles_uit') return 'Alles uit: de motoren van de telefoons uitzetten. Er wordt niets gewist. Doorgaan?';
    return 'Doorgaan?';
  }

  return { KNOPPEN, NAMEN, systeem, leesKnop, vindTelefoon, genoemd, besluit, bevestigVraag };
}));
