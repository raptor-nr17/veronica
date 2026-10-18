// ===================================================================
// TAKENVERDELING (469) -- wie van de telefoons doet wat, en wat de eigenaar daarover mag kiezen
// ===================================================================
//
// Gewone code, geen model. Dit bestand REKENT alleen: uit de klasse (pool.js), de rol (baas of werker), de eigen motor
// en de keuzes van de eigenaar komt per telefoon een lijstje: deze soort werk wel of niet, en waarom. Er wordt hier
// niets gestuurd, niets gestart en niets opgeslagen; veronica.js bewaart de keuzes (alleen in deze browser) en de
// verkeersagent (pool.js) krijgt via `uitgesloten` te horen welke telefoon een klus NIET mag krijgen.
//
// De soorten:
//  - claude    Claudes klussen via de rekenbrug (voorrang 2). Alleen met een geladen model. De eigenaar mag een telefoon uitsluiten.
//  - veronica  Veronica's eigen vragen en spraak (voorrang 1). Idem.
//  - postbus   gids-werk (vertalen, keuren = lastig; ja/nee = simpel). Regelt de TELEFOON ZELF, via zijn klasse en de
//              postbus van de baas (367). Veronica kan dat alleen laten zien, niet omzetten.
//  - zoeken    deelvragen van het multizoeken (462). Verdeelt de BAAS zelf via de kassa; Veronica laat het alleen zien.
//  - bewaker   let op de andere telefoons (temperatuur, accu, bereikbaar). Kan elke telefoon, ook een te oude.
//
// 481: DE ROLLEN (17 oktober). Per telefoon EEN rol, uitgerekend uit wat de telefoon meldt:
//  - gespaard  de schuif Sparen op de telefoon zelf staat aan: geen werk, alleen de eigen vragen van de eigenaar. Veronica kan
//              dat niet omzetten.
//  - denker    maakt het plan en deelt het werk in. De ZWAARSTE telefoon die niet spaart (12 GB met E4B, anders 6-8 GB met E2B).
//              Spaart de zware telefoon, of valt hij weg, dan wordt het vanzelf de volgende.
//  - geheugen  draait het geheugenmodel (EmbeddingGemma), als een telefoon meldt dat het klaar staat.
//  - werker    vertaalt en controleert met zijn eigen model (E2B).
//  - handjes   te oud voor een model (te weinig geheugen, of Android 9 of ouder): alleen taken in de browser, zonder model.
//
// EEN REGEL DIE HIER NIET OMGEZET KAN WORDEN: een te oude telefoon (geen model) krijgt nooit model-werk, ook niet als de
// eigenaar dat aanzet. Een keuze kan een telefoon alleen UITSLUITEN, nooit iets mogelijk maken dat de telefoon niet kan.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Takenverdeling = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SOORTEN = Object.freeze([
    { soort: 'claude', naam: 'Claude-klussen', kiesbaar: true },
    { soort: 'veronica', naam: 'Vragen van Veronica', kiesbaar: true },
    { soort: 'postbus', naam: 'Gids-werk (postbus)', kiesbaar: false },
    { soort: 'zoeken', naam: 'Zoeken (deelvragen)', kiesbaar: false },
    { soort: 'bewaker', naam: 'Bewaker', kiesbaar: false },
  ]);
  const KIESBAAR = SOORTEN.filter((s) => s.kiesbaar).map((s) => s.soort);

  // keuzes: { [adres]: { claude: false, veronica: false } } -- alleen een letterlijk false sluit uit; al het andere is "mag".
  function magVan(keuzes, adres, soort) {
    if (!KIESBAAR.includes(soort)) return true;
    const k = keuzes && typeof keuzes === 'object' && keuzes[adres] && typeof keuzes[adres] === 'object' ? keuzes[adres] : null;
    return !(k && k[soort] === false);
  }

  // Een nette, begrensde kopie van de keuzes (voor opslag): alleen bekende adressen en soorten, alleen false wordt bewaard.
  function schoonKeuzes(keuzes, adressen) {
    const uit = {};
    if (!keuzes || typeof keuzes !== 'object') return uit;
    for (const adres of adressen || []) {
      const k = keuzes[adres];
      if (!k || typeof k !== 'object') continue;
      const rij = {};
      for (const soort of KIESBAAR) if (k[soort] === false) rij[soort] = false;
      if (Object.keys(rij).length) uit[adres] = rij;
    }
    return uit;
  }

  // telefoon: { naam, adres, kern, rol ('baas'|'werker'|null), klasse, klasseReden, modelGeladen, motorKlaar, bereikbaar, vervangen, hitteStand, rust, magRekenen }
  function regelsVoor(t, keuzes) {
    // 481: gespaard (de schuif op de telefoon) = geen enkel werk; vast, want alleen de telefoon zelf zet hem om.
    // 495: de dagelijkse telefoon die rust: hetzelfde, met zijn eigen reden.
    if (t.gespaard === true || t.dagelijks === true) {
      const r = t.dagelijks === true && t.gespaard !== true ? 'dagelijkse telefoon, rust: rekent alleen aan de lader met het scherm uit, als dat op de telefoon aan staat' : 'gespaard: de schuif Sparen op de telefoon staat aan (alleen jouw eigen vragen)';
      return SOORTEN.map((x) => ({ soort: x.soort, naam: x.naam, mag: x.soort === 'bewaker', vast: true, reden: x.soort === 'bewaker' ? 'let op temperatuur en accu; geen model nodig' : r }));
    }
    const teOud = t.klasse === 'te-oud';
    const model = t.modelGeladen === true || t.motorKlaar === true;
    const weg = t.vervangen ? 'vervangen: krijgt geen werk' : t.bereikbaar === false ? 'geen antwoord' : null;
    const stil = t.rust === true ? 'in rust tot de zon' : t.magRekenen === false ? 'onder de accu-reserve' : (t.hitteStand === 'oranje' || t.hitteStand === 'rood') ? 'te warm' : null;
    const modelRegel = (soort, naam) => {
      if (weg) return { soort, naam, mag: false, vast: true, reden: weg };
      if (teOud) return { soort, naam, mag: false, vast: true, reden: t.klasseReden ? `geen model: ${t.klasseReden}` : 'te oud voor een model' };
      if (!magVan(keuzes, t.adres, soort)) return { soort, naam, mag: false, vast: false, reden: 'door jou uitgezet' };
      if (!model) return { soort, naam, mag: false, vast: true, reden: 'nog geen model geladen (OlliteRT of de eigen motor)' };
      if (stil) return { soort, naam, mag: false, vast: true, reden: stil };
      if (soort === 'claude' && t.kern) return { soort, naam, mag: true, vast: false, reden: 'de baas: alleen aan de lader en niet in gebruik, of met de schakelaar "baas mag meerekenen"' };
      return { soort, naam, mag: true, vast: false, reden: t.klasse === 'zwaar' ? 'zwaar werk eerst, dan de rest' : t.klasse === 'midden' ? 'licht en midden werk, zwaar als het moet' : t.klasse === 'licht' ? 'alleen korte klussen' : 'klasse nog niet gemeten' };
    };
    const regels = [modelRegel('claude', 'Claude-klussen'), modelRegel('veronica', 'Vragen van Veronica')];
    // Postbus: de telefoon zelf. Lastig werk (vertalen, keuren) alleen met E4B; simpel (ja/nee, buurtpin) ook met E2B.
    if (weg) regels.push({ soort: 'postbus', naam: 'Gids-werk (postbus)', mag: false, vast: true, reden: weg });
    else if (teOud || !model) regels.push({ soort: 'postbus', naam: 'Gids-werk (postbus)', mag: false, vast: true, reden: teOud ? 'geen model' : 'nog geen model geladen' });
    else regels.push({ soort: 'postbus', naam: 'Gids-werk (postbus)', mag: true, vast: true, reden: t.klasse === 'zwaar' ? 'lastig en simpel werk (de telefoon kiest zelf uit de postbus)' : 'simpel werk; lastig werk alleen met een groot model (de telefoon kiest zelf)' });
    // Zoeken: de baas verdeelt. Een werker met JARVIS en wifi kan een deelvraag ophalen; de baas zelf ook.
    regels.push(weg ? { soort: 'zoeken', naam: 'Zoeken (deelvragen)', mag: false, vast: true, reden: weg }
      : { soort: 'zoeken', naam: 'Zoeken (deelvragen)', mag: true, vast: true, reden: t.kern ? 'de baas verdeelt de deelvragen en bewaakt de rem' : 'haalt een deelvraag op via zijn eigen wifi; de baas verdeelt' });
    regels.push({ soort: 'bewaker', naam: 'Bewaker', mag: !weg, vast: true, reden: weg || 'let op temperatuur, accu en bereikbaarheid; geen model nodig' });
    return regels;
  }

  // 481: per telefoon EEN rol (zie bovenaan). Een te oude, een vervangen of een onbereikbare telefoon wordt nooit denker.
  const ROL_NAAM = Object.freeze({ gespaard: 'Gespaard', dagelijks: 'Dagelijkse telefoon, rust', denker: 'Denker', geheugen: 'Geheugen', werker: 'Werker', handjes: 'Handjes (alleen browser)', weg: 'Weg' });
  const KLASSE_RANG = { zwaar: 0, midden: 1, licht: 2 };
  function rollen(telefoons) {
    const lijst = Array.isArray(telefoons) ? telefoons : [];
    const uit = {};
    const weg = (t) => t.vervangen || t.bereikbaar === false;
    const model = (t) => t.modelGeladen === true || t.motorKlaar === true;
    const kanDenken = lijst.filter((t) => !weg(t) && t.gespaard !== true && t.dagelijks !== true && t.klasse !== 'te-oud' && model(t) && t.klasse in KLASSE_RANG);
    kanDenken.sort((a, b) => KLASSE_RANG[a.klasse] - KLASSE_RANG[b.klasse] || String(a.naam).localeCompare(String(b.naam)));
    const denker = kanDenken[0] || null;
    const geheugen = lijst.find((t) => !weg(t) && t.gespaard !== true && t.dagelijks !== true && t.geheugenKlaar === true && t !== denker) || null;
    for (const t of lijst) {
      let rol;
      if (weg(t)) rol = 'weg';
      else if (t.gespaard === true) rol = 'gespaard';
      else if (t.dagelijks === true) rol = 'dagelijks';   // 495
      else if (t === denker) rol = 'denker';
      else if (t === geheugen) rol = 'geheugen';
      else if (t.klasse === 'te-oud' || (typeof t.sdk === 'number' && t.sdk < 29)) rol = 'handjes';
      else rol = 'werker';
      uit[t.adres] = { rol, naam: ROL_NAAM[rol] };
    }
    return { per: uit, denker: denker ? denker.naam : null, geheugen: geheugen ? geheugen.naam : null };
  }

  function verdeel(telefoons, keuzes) {
    const rl = rollen(telefoons);
    const lijst = (Array.isArray(telefoons) ? telefoons : []).map((t) => ({ naam: t.naam, adres: t.adres, kern: !!t.kern, rol: t.rol || null, klasse: t.klasse || null, taak: rl.per[t.adres], regels: regelsVoor(t, keuzes) }));
    const kan = (soort) => lijst.filter((t) => t.regels.find((r) => r.soort === soort).mag);
    const waarschuwingen = [];
    if (lijst.length && !kan('claude').length) waarschuwingen.push('Geen enkele telefoon kan nu Claude-klussen doen.');
    if (lijst.length && !kan('veronica').length) waarschuwingen.push('Geen enkele telefoon kan nu vragen van Veronica doen; Veronica valt dan terug op Chrome (online).');
    if (lijst.length && !rl.denker) waarschuwingen.push('Er is nu geen denker: geen telefoon met een geladen model die niet spaart.');
    if (lijst.length && !lijst.some((t) => t.klasse === 'zwaar' && t.regels.find((r) => r.soort === 'postbus').mag)) waarschuwingen.push('Geen zware telefoon beschikbaar: lastig gids-werk (vertalen, keuren) blijft liggen in de postbus.');
    const uitgezet = lijst.flatMap((t) => t.regels.filter((r) => !r.vast && !r.mag).map((r) => `${t.naam}: ${r.naam}`));
    const samenvatting = [`Denker: ${rl.denker || 'nog niemand (geen telefoon met een geladen model die niet spaart)'}`, `Geheugen: ${rl.geheugen || 'nog niemand (geheugenmodel niet geladen)'}`]
      .concat(SOORTEN.map((s) => `${s.naam}: ${kan(s.soort).map((t) => t.naam).join(', ') || 'niemand'}`));
    return { telefoons: lijst, samenvatting, waarschuwingen, uitgezet };
  }

  // De adressen die voor deze klussoort NIET mogen (voor taak.uitgesloten in pool.js). Alleen keuzes van de eigenaar:
  // de rest (te oud, rust, warm) beslist pool.js zelf, uit de staten.
  function uitgeslotenVoor(telefoons, keuzes, soort) {
    return (Array.isArray(telefoons) ? telefoons : []).filter((t) => !magVan(keuzes, t.adres, soort)).map((t) => t.adres);
  }

  return Object.freeze({ SOORTEN, KIESBAAR, ROL_NAAM, magVan, schoonKeuzes, regelsVoor, rollen, verdeel, uitgeslotenVoor });
}));
