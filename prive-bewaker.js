// ===================================================================
// DE VASTE BEWAKER VAN DE PRIVE-KAMER -- gewone code, geen AI
// ===================================================================
//
// Drie regels die niet te onderhandelen zijn en die GEEN model kan veranderen:
//   1. nooit iets met minderjarigen;
//   2. nooit over echte personen: geen deepfakes, geen persoonlijke aantijgingen, en in een verhaal of
//      beeld geen echte naam;
//   3. de noodstop: alles dicht, tot de eigenaar hem zelf bewust weghaalt (een eigen knop; geen pincode, besluit van de eigenaar).
//
// WAAROM DIT HIER STAAT EN NIET IN EEN PROMPT: een prompt is een verzoek aan een model, en een model
// (zeker een ander model dat de eigenaar zelf aanwijst) kan het negeren of overschrijven. Dit bestand
// kijkt naar de TEKST die erin gaat en naar de tekst die eruit komt, voor en na elk model.
//
// WAT DE REGELS DOEN: ze zijn grof, met opzet. Een woordenlijst en een paar patronen vangen niet alles
// (een echte persoon met een bijnaam, een minderjarige zonder het woord); ze vangen wel het
// duidelijke geval, elke keer, zonder dat een model er iets van vindt. Liever te streng dan te los:
// "kinderboek" wordt hier geweigerd, en dat is een prijs die de eigenaar kent.
//
// WAT HIER NIET STAAT: een functie die een regel verandert, uitzet of verruimt. De lijsten zijn
// bevroren. Het model, de "ander model"-keuze, de prompt en de wachtrij krijgen alleen beoordeel() en
// beoordeelUitvoer() te zien -- en de noodstop mag iedereen AAN zetten, maar alleen herstel() met een
// bewuste handeling van de eigenaar (de knop "Noodstop weghalen") zet hem uit.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.PriveBewaker = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Klein en zonder accenten. Voor cijfers (leeftijden) blijft alles zoals het staat.
  function basis(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }
  // Voor woorden ook: "k1nd", "k.i.n.d" en "kind" zijn hetzelfde woord.
  function schoon(t) {
    return basis(t)
      .replace(/0/g, 'o').replace(/@/g, 'a').replace(/1/g, 'i').replace(/3/g, 'e').replace(/\$/g, 's')
      .replace(/(\p{L})[.\-_*](?=\p{L}(?:[.\-_*]|\b))/gu, '$1');
  }

  // ---- 1. minderjarigen ----
  const MINDER_WOORDEN = [
    'kind', 'kinderen', 'kindje', 'kindjes', 'kinder', 'kids', 'kid', 'child', 'children', 'kleuter', 'peuter',
    'baby', 'babys', 'tiener', 'tieners', 'tienermeisje', 'tienerjongen', 'puber', 'pubers', 'minderjarig',
    'minderjarige', 'minderjarigen', 'meisje', 'meisjes', 'jongetje', 'jongetjes', 'schoolmeisje',
    'schooljongen', 'schoolkind', 'schoolkinderen', 'scholier', 'scholiere', 'leerling', 'leerlingen',
    'zoontje', 'dochtertje', 'neefje', 'nichtje', 'kleinkind', 'kleinkinderen', 'teen', 'teens', 'teenager',
    'underage', 'minor', 'minors', 'schoolgirl', 'schoolboy', 'toddler', 'infant', 'lolita', 'loli', 'shota',
    'kinderlijk', 'kindsoldaat', 'jugendlich', 'jugendliche', 'jugendlicher', 'kleinkind', 'madchen',
    'maedchen', 'schulerin', 'teenie', 'nymphet', 'jonge meid', 'schuler', 'kleinkinder', 'minderjahrig', 'schulmadchen',
  ];
  const MINDER_RE = new RegExp(`(?:^|[^\\p{L}])(?:${MINDER_WOORDEN.join('|')})(?=$|[^\\p{L}])`, 'u');
  // "14 jaar", "15-jarige", "16 y/o", "age 12": alles onder de 18
  const LEEFTIJD_RES = [
    /(?:^|[^\d])(\d{1,2})\s*-?\s*(?:jaar|jarig|jarige|jr|years?|yrs?|yo|y\/o|j\b|jahre|jahrig)/g,
    /(?:leeftijd|age|alter)\s*[:=]?\s*(\d{1,2})/g,
  ];
  function minderjarigeLeeftijd(s) {
    for (const re of LEEFTIJD_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) { const n = Number(m[1]); if (n >= 0 && n < 18) return true; }
    }
    return false;
  }
  function raaktMinderjarigen(tekst) {
    return MINDER_RE.test(schoon(tekst)) || minderjarigeLeeftijd(basis(tekst));
  }

  // Gecodeerde zoektermen voor seksueel misbruik van kinderen: nooit, in geen enkele schrijfwijze.
  const MINDER_CODE_RE = /pthc|ptsc|jailbait|lolicon|shotacon|toddlercon|hurtcore|babyj|preteen|pre teen|kinderporno|kindersex|child ?porn|child ?sex|kiddie ?porn|kinderpornografie|cp video|underage (sex|porn)/u;
  // Strafbare inhoud en strafbare diensten. Een grove lijst: ze vangt de duidelijke vraag, niet elke omschrijving.
  const ILLEGAAL_RE = /huurmoordenaar|hitman|contract ?killer|bom(men)? (bouwen|maken)|bomb (making|build)|make a bomb|ricin|sarin|nerve agent|gestolen (credit)?cards?|stolen (credit )?cards?|carding|cvv dumps|illegale wapens|illegal (guns|firearms)|darkweb (drugs|markt|market|vendor)|fentanyl (kopen|bestellen)|buy fentanyl|mensenhandel|human trafficking|bestiality|zoofilie|dierenseks|snuff|wraakporno|revenge ?porn|iemand (vermoorden|ontvoeren|vergiftigen)|(kill|poison|kidnap) (a |my )?(person|wife|husband|neighbou?r|boss)|ransomware (kopen|maken)|ddos for hire|booter service|nep ?paspoort|fake passport/u;
  // Iemand die jong LIJKT of zo genoemd wordt: ook dat nooit, wat de opgegeven leeftijd ook is.
  const JONG_LIJKEND_RE = /barely legal|jong (uitziend|ogend|lijkend|uitzien)|(ziet|lijkt|kijkt|zien) (er )?(heel |erg |zo |zeer |super )?jong|jong (uit)?ziet|young[- ]?looking|looks? (very )?young|looking young|jugendlich aussehend|sieht jung aus|babyface|baby face|just turned 18|net 18|pas 18|net achttien|schoolmeisje|school ?girl|school ?boy|schooluniform|school uniform/u;
  // Een echte persoon (naam, naaste of bekende) in een seksuele of vernederende context: nooit.
  const SEKS_VERNEDER_RE = /seks|sex|erotisch|erotic|naakt|nude|naked|porno|porn|ontkleed|vernederd|vernederen|humiliat|bespot|mishandel|folter|torture|gedwongen|forced|bdsm|slaaf|slave|fetish|onderdanig/u;
  // Een adres dat zelf al zegt wat erop staat, of dat niet via het gewone web bereikbaar is.
  const ADRES_VERBODEN_RE = /\.(onion|i2p|bit)$|pthc|jailbait|lolicon|shotacon|kinderporno|childporn|kiddieporn|preteen|loli(ta)?(porn|sex)|hurtcore/u;
  function adresVerboden(url) {
    let h;
    try { h = new URL(String(url || '')).hostname; } catch (e) { return true; }
    return ADRES_VERBODEN_RE.test(schoon(h));
  }

  // ---- 2. echte personen ----
  const DEEPFAKE_RE = /deepfake|deep fake|faceswap|face swap|gezichtsruil|nepfoto|nep foto|nepvideo|nep video|fake nude|fake naakt|undress|nudify|ontkleed|uitkleden van|gezicht van .{1,30} op|stem van .{1,30} na/u;
  const AANTIJGING_RE = /(?:verkracht|verkrachter|pedofiel|pedo|misbruik|crimineel|dief|dieven|fraudeur|moordenaar|oplichter|corrupt|fascist|nazi|terrorist|racist|hoer|slet|dealer|dronkaard|overspel|vreemdgaan|fremdgeh|vergewaltig|betrug|abuser|rapist|criminal|fraud|thief|murderer)/u;
  const BETREKKING_RE = /(?:^|[^\p{L}])(?:mijn|onze|m'n|my|meine|meiner)\s+(?:buurman|buurvrouw|buren|collega|baas|chef|ex|vriend|vriendin|moeder|vader|broer|zus|zusje|broertje|oma|opa|tante|oom|leraar|lerares|docent|arts|dokter|schoonmoeder|schoonvader|man|vrouw|echtgenoot|echtgenote|neighbour|neighbor|colleague|boss|girlfriend|boyfriend|nachbar|kollege|chef)(?=$|[^\p{L}])/u;
  const AMBT_RE = /(?:^|[^\p{L}])(?:president|premier|minister|koning|koningin|prins|prinses|burgemeester|kamerlid|politicus|politica|beroemdheid|bekende nederlander|filmster|zangeres|zanger|acteur|actrice|influencer|presentator|presentatrice|celebrity|politician|chancellor|kanzler)(?=$|[^\p{L}])/u;
  // Plaatsen en landen die twee hoofdletters achter elkaar mogen hebben ("Het Vrouwtje van X").
  // KOPIE VOOR VERONICA (keuze van de eigenaar, 23 nov): EEN plaatsnaam uit zijn omgeving staat NIET in deze lijst -- de openbare site draagt
  // die naam niet. Dat maakt de zeef op dat ene woord strenger (twee hoofdletters ermee kan als naam tellen), nooit soepeler.
  const PLAATSEN = new Set(['nederland', 'friesland', 'fryslan', 'sneek', 'lemmer', 'workum', 'hindeloopen', 'makkum', 'harlingen', 'leeuwarden', 'amsterdam', 'rotterdam', 'utrecht', 'groningen', 'drenthe', 'overijssel', 'flevoland', 'gelderland', 'brabant', 'limburg', 'zeeland', 'holland', 'duitsland', 'belgie', 'frankrijk', 'engeland', 'ijsselmeer', 'waddenzee', 'noordzee', 'europa', 'afrika', 'azie', 'amerika', 'enkhuizen', 'urk', 'terschelling', 'ameland', 'vlieland', 'schiermonnikoog', 'texel', 'berlijn', 'parijs', 'londen', 'rome', 'madrid']);
  // Woorden waarmee een zin begint en die een hoofdletter hebben zonder een naam te zijn ("Toen Marloes ...").
  const ZINSTART = new Set(['toen', 'later', 'daarna', 'vandaag', 'gisteren', 'morgen', 'soms', 'misschien', 'maar', 'want', 'dus', 'ook', 'plotseling', 'eindelijk', 'opeens', 'daar', 'hier', 'nu', 'dan', 'terwijl', 'als', 'hij', 'zij', 'ze', 'het', 'de', 'een', 'in', 'op', 'met', 'bij', 'voor', 'na', 'aan', 'door', 'over', 'onder', 'tijdens', 'zodra', 'nadat', 'omdat', 'hoewel', 'ondertussen', 'intussen', 'eerst', 'toch', 'zelfs', 'iedereen', 'niemand', 'alles', 'niets', 'the', 'then', 'later', 'and', 'but', 'when', 'as', 'after', 'before', 'she', 'he', 'they', 'it', 'there', 'here', 'now', 'der', 'die', 'das', 'ein', 'eine', 'und', 'dann', 'als', 'er', 'sie', 'es', 'wir', 'ich', 'jeder', 'niemand']);
  const DEELTJES = new Set(['van', 'de', 'der', 'den', 'ten', 'ter', 'te', 'von', 'zu', 'di', 'da', 'la', 'le', 'el', 'bin', 'ibn', 'op', 'in', 'het', "'t"]);
  const HOOFD_RE = /^\p{Lu}[\p{Ll}'’]+$/u;
  // Een naam = twee of meer woorden met een hoofdletter achter elkaar (met eventueel van/de/der ertussen) die
  // geen plaats zijn. Een zin begint met een hoofdletter: dat eerste woord telt alleen als het geen gewoon
  // zinsbegin is. Een nieuwe regel of een leesteken onderbreekt de rij.
  function heeftVolledigeNaam(tekst) {
    const delen = String(tekst || '').normalize('NFC').split(/[.!?;:\n\r()"]+/u);
    for (const deel of delen) {
      const w = deel.split(/[ \t]+/u).map((x) => x.replace(/^[,'’\-_*]+|[,\-_*]+$/gu, '')).filter(Boolean);
      let run = [];
      const sluit = () => { const echte = run.filter((x) => !PLAATSEN.has(schoon(x))); const klaar = echte.length >= 2; run = []; return klaar; };
      for (let i = 0; i < w.length; i++) {
        const x = w[i];
        const hoofd = HOOFD_RE.test(x) && !(i === 0 && ZINSTART.has(schoon(x)));
        if (hoofd) { run.push(x); continue; }
        if (run.length && DEELTJES.has(x.toLowerCase()) && i + 1 < w.length && HOOFD_RE.test(w[i + 1])) continue;
        if (sluit()) return true;
      }
      if (sluit()) return true;
    }
    return false;
  }
  // Strenger dan "naamAchtig": een bekende rol (president ...) in een vraag als "seksverhalen over de president" telt ook.
  function heeftVolledigeNaamOfBetrekking(tekst) { const s = schoon(tekst); return heeftVolledigeNaam(tekst) || BETREKKING_RE.test(s) || AMBT_RE.test(s); }
  function raaktEchtePersoon(tekst, soort) {
    const s = schoon(tekst);
    if (DEEPFAKE_RE.test(s)) return 'deepfake';
    const naamAchtig = heeftVolledigeNaam(tekst) || BETREKKING_RE.test(s) || AMBT_RE.test(s);
    if (AANTIJGING_RE.test(s) && naamAchtig) return 'aantijging';
    if (SEKS_VERNEDER_RE.test(s) && naamAchtig && heeftVolledigeNaamOfBetrekking(tekst)) return 'persoon-seksueel';
    // In een verhaal of beeld is een echte naam, een naaste of een publiek persoon nooit goed.
    if ((soort === 'verhaal' || soort === 'beeld' || soort === 'foto') && naamAchtig) return 'persoon-in-verhaal';
    return null;
  }

  // ---- De uitslag ----
  const REDENEN = Object.freeze({
    minderjarig: 'Dit gaat over iemand die minderjarig kan zijn. Dat doe ik hier nooit.',
    deepfake: 'Een gezicht of stem van iemand anders namaken doe ik hier nooit.',
    aantijging: 'Een persoonlijke beschuldiging over een echt persoon doe ik hier nooit.',
    'persoon-seksueel': 'Een echte persoon in een seksuele of vernederende context doe ik hier nooit.',
    'persoon-in-verhaal': 'Een verhaal over een echt persoon (een echte naam, een naaste of een bekende) doe ik hier nooit. Verzin een naam.',
    illegaal: 'Hier help ik niet mee.',
    zoek: 'Deze zoekopdracht kan ik niet uitvoeren.',
    noodstop: 'De noodstop staat aan. Haal hem eerst weg met de knop "Noodstop weghalen".',
    leeg: 'Er staat niets.',
  });

  const toestand = { noodstop: false, geweigerd: 0 };

  function weiger(code) { toestand.geweigerd += 1; return { toegestaan: false, code, reden: REDENEN[code] }; }

  // De vraag VOOR het model. soort: 'vrij' | 'verhaal' | 'beeld' | 'foto' | 'zoek'
  function beoordeel(tekst, soort) {
    if (toestand.noodstop) return weiger('noodstop');
    const t = String(tekst == null ? '' : tekst);
    if (!t.trim()) return { toegestaan: false, code: 'leeg', reden: REDENEN.leeg };
    const sch = schoon(t);
    if (raaktMinderjarigen(t) || MINDER_CODE_RE.test(sch) || JONG_LIJKEND_RE.test(sch) || JONG_LIJKEND_RE.test(basis(t))) return weiger('minderjarig');
    if (ILLEGAAL_RE.test(sch)) return weiger('illegaal');
    const p = raaktEchtePersoon(t, soort);
    if (p) return weiger(p);
    return { toegestaan: true, code: null, reden: null };
  }
  // Wat het model teruggeeft, voordat iemand het ziet of het wordt bewaard. Dezelfde regels.
  function beoordeelUitvoer(tekst, soort) { return beoordeel(tekst, soort); }

  // Een zoekresultaat (titel, beschrijving, adres) voordat iemand het ziet of het naar de surftelefoon gaat.
  function beoordeelResultaat(r) {
    if (toestand.noodstop) return weiger('noodstop');
    const x = r || {};
    if (adresVerboden(x.url)) return weiger('illegaal');
    return beoordeelUitvoer(`${x.titel || ''} ${x.tekst || ''} ${decodeURIComponent(String(x.url || '').replace(/%(?![0-9a-f]{2})/gi, ''))}`, 'zoek');
  }

  function noodstop() { toestand.noodstop = true; }
  // Alleen met een BEWUSTE handeling van de eigenaar: de kamer geeft `bewezen` nadat de telefoon de noodstop echt heeft weggehaald (de knop "Noodstop weghalen").
  function herstel(bewezen) {
    if (bewezen !== true) return false;
    toestand.noodstop = false;
    return true;
  }
  function stand() { return { noodstop: toestand.noodstop, geweigerd: toestand.geweigerd }; }

  const api = { beoordeel, beoordeelUitvoer, beoordeelResultaat, adresVerboden, noodstop, herstel, stand, REDENEN };
  Object.freeze(api);
  return api;
}));
