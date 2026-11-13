// ===================================================================
// 678 stap 4: DE ROL-TABEL PER TELEFOON + het model per rol en per RAM-klasse. Rekent alleen: geen netwerk, geen opslag, geen model.
// Welke telefoon in het rek welke rol vervult (denken, zoeken/samenvatten, verdelen, groot brein), en welk model daarbij past
// gegeven de klasse (zwaar/midden/licht uit pool.capaciteit). veronica.js toont het; ARTEMIS zet de modelbestanden per serienummer neer.
// ===================================================================
//
// Afspraak met de eigenaar (8 november):
//  - GEEN TOESTEL-, MERK- OF SERIENUMMER IN DIT BESTAND. De koppeling toestel-id -> rol staat LOKAAL (jarvis-rek-rollen in de
//    opslag), nooit in de code -- zelfde regel als de SSID->plek-tabel van 570 en de Veronica-privacyscan. Hier alleen de pure
//    logica: rol -> taken -> model per RAM-klasse, en de harde grenzen.
//  - VIER ROLLEN, abstract (geen toestelnaam): brein (denken + spraak-in + de denker voor ARTEMIS), bibliothecaris (zoeken +
//    samenvatten + spraak-uit + betekenis/embedding), verdeler (vragen indelen + zoekresultaten voorsorteren), groot-brein
//    (ALLEEN THUIS, voor moeilijke vragen en het bekijken van een schermbeeld).
//  - HET GROTE BREIN WORDT NOOIT BESTUURD EN IS NOOIT BAAS, en is alleen bereikbaar als hij THUIS is. Die grenzen staan hard in de
//    rol (alleenThuis / nooitBaas / nooitBestuurd); beschikbaar() laat hem buitenshuis nooit toe.
//  - NOOIT TWEE GROTE MODELLEN TEGELIJK OP ÉÉN TELEFOON (magModellenSamen). Een telefoon = één model tegelijk.
//  - ELKE MODELKEUZE HIER IS EEN GOK (gok:true), afgeleid van de klasse. Een GEMETEN keuze wint altijd: dit is het uitgangspunt
//    vóór de meting, nooit een getal dat als gemeten wordt gepresenteerd.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Rollen = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // De vier rollen (machinevorm) -> titel, taken, modelfamilie en de harde grenzen.
  //  modelFamilie: 'extra-groot' (alleen een zware telefoon, alleen thuis), 'groot' (zwaar->E4B, midden->E2B, licht->klein),
  //                'klein' (overal een klein model -- de verdeler hoeft niet groot).
  const ROLLEN = Object.freeze({
    brein: {
      titel: 'Brein', modelFamilie: 'groot',
      taken: Object.freeze(['denken', 'spraak-in', 'artemis-denker']),
    },
    bibliothecaris: {
      titel: 'Bibliothecaris', modelFamilie: 'groot', embedding: true,
      taken: Object.freeze(['zoek-samenvatten', 'spraak-uit', 'betekenis']),
    },
    verdeler: {
      titel: 'Verdeler', modelFamilie: 'klein',
      taken: Object.freeze(['verdelen', 'zoek-voorsorteren']),
    },
    // 678 (13 nov): de HELPER -- nakijken (keurmeester) en licht werk; een klein model, nooit een lang antwoord maken (de trap laat alleen brein en
    // bibliothecaris antwoorden maken). Voor de telefoon met weinig grote kernen (gemeten ~10 tok/s op 2 draden).
    helper: {
      titel: 'Helper (nakijken)', modelFamilie: 'klein',
      taken: Object.freeze(['nakijken', 'licht-werk']),
    },
    'groot-brein': {
      titel: 'Groot brein (alleen thuis)', modelFamilie: 'extra-groot',
      alleenThuis: true, nooitBaas: true, nooitBestuurd: true,
      taken: Object.freeze(['moeilijke-vragen', 'schermbeeld-bekijken']),
    },
  });
  const NAMEN = Object.freeze(Object.keys(ROLLEN));

  function rol(naam) { return (naam && Object.prototype.hasOwnProperty.call(ROLLEN, naam)) ? ROLLEN[naam] : null; }
  function titel(naam) { const r = rol(naam); return r ? r.titel : null; }
  function taken(naam) { const r = rol(naam); return r ? r.taken.slice() : []; }
  function kan(naam, taak) { return taken(naam).indexOf(taak) !== -1; }

  // De harde grenzen van een rol. Een onbekende rol heeft geen grens (maar krijgt ook geen model).
  function alleenThuis(naam) { const r = rol(naam); return !!(r && r.alleenThuis); }
  function nooitBaas(naam) { const r = rol(naam); return !!(r && r.nooitBaas); }
  function nooitBestuurd(naam) { const r = rol(naam); return !!(r && r.nooitBestuurd); }

  // Is deze rol nu bruikbaar? Het grote brein alleen als hij THUIS is; de rest altijd.
  function beschikbaar(naam, stand) {
    const r = rol(naam);
    if (!r) return false;
    const thuis = !!(stand && stand.thuis);
    if (r.alleenThuis && !thuis) return false;
    return true;
  }

  // Model per rol EN per klasse. GEMETEN wint altijd: elke uitkomst draagt gok:true.
  //  klasse is de uitkomst van pool.capaciteit (zwaar/midden/licht/te-oud).
  function modelVoor(naam, klasse) {
    const r = rol(naam);
    if (!r) return { model: null, gok: true, reden: 'onbekende rol' };
    if (klasse === 'te-oud') return { model: null, gok: true, reden: 'te oud voor een eigen model' };
    const fam = r.modelFamilie;
    if (fam === 'extra-groot') {
      if (klasse === 'zwaar') return { model: 'E4B', gok: true, reden: 'zware telefoon, alleen thuis' };
      return { model: null, gok: true, reden: 'te licht voor het grote brein' };
    }
    if (fam === 'groot') {
      if (klasse === 'zwaar') return { model: 'E4B', gok: true, reden: 'zware telefoon' };
      if (klasse === 'midden') return { model: 'E2B', gok: true, reden: 'middentelefoon' };
      return { model: 'klein', gok: true, reden: 'lichte telefoon, een klein model' };
    }
    // klein (de verdeler, de helper): een klein model, ook op een zware telefoon.
    return { model: 'klein', gok: true, reden: naam === 'helper' ? 'nakijken lukt met een klein model' : 'de verdeler heeft genoeg aan een klein model' };
  }

  // NOOIT TWEE GROTE MODELLEN TEGELIJK OP ÉÉN TELEFOON. 'klein' telt niet als groot; null (geen model) telt niet mee.
  const GROOT = Object.freeze(['E4B', 'E2B']);
  function isGroot(model) { return GROOT.indexOf(model) !== -1; }
  function magModellenSamen(modellen) {
    const lijst = Array.isArray(modellen) ? modellen : [];
    let groot = 0;
    for (const m of lijst) if (isGroot(m)) groot += 1;
    return groot <= 1;
  }

  // De lokaal bewaarde koppeling toestel-id -> rol. config is een object { <toestel-id>: <rolnaam> } uit de OPSLAG (nooit uit de code).
  // Een onbekende rol of een leeg id geeft null -- er wordt niets geraden.
  function rolVanConfig(config, toestelId) {
    if (!config || typeof config !== 'object' || !toestelId) return null;
    const naam = config[toestelId];
    return rol(naam) ? naam : null;
  }

  // De volledige beslissing voor één telefoon: rol, taken, grenzen, model (gok) en of hij nu bruikbaar is.
  // c = { klasse, thuis }. Geen rol -> alles null, zonder te raden.
  function beslis(naam, c) {
    const x = c && typeof c === 'object' ? c : {};
    const r = rol(naam);
    if (!r) return { rol: null, titel: null, taken: [], model: null, gok: true, bruikbaar: false, alleenThuis: false, nooitBaas: false, nooitBestuurd: false, reden: 'onbekende rol' };
    const mk = modelVoor(naam, x.klasse);
    return {
      rol: naam, titel: r.titel, taken: r.taken.slice(),
      model: mk.model, gok: mk.gok, reden: mk.reden,
      bruikbaar: beschikbaar(naam, { thuis: x.thuis }),
      alleenThuis: !!r.alleenThuis, nooitBaas: !!r.nooitBaas, nooitBestuurd: !!r.nooitBestuurd,
    };
  }

  return {
    ROLLEN, NAMEN,
    rol, titel, taken, kan,
    alleenThuis, nooitBaas, nooitBestuurd, beschikbaar,
    modelVoor, isGroot, magModellenSamen,
    rolVanConfig, beslis,
  };
}));
