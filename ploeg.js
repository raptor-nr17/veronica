// ===================================================================
// 624 (2 november): HET PLOEGBORD -- de drie besturingen (lokale AI, ARTEMIS, Claude Code) als team, maar ook apart
// ===================================================================
//
// De opdracht van de eigenaar (1 nov): de telefoons besturen met de lokale AI, ARTEMIS en Claude Code als team, maar elk ook
// los. Volledig ontwerp: docs/team-besturing.md. Dit is de eerste bouwsteen: een PURE module (geen netwerk, geen opslag), net als
// ontmoet.js/hartslag.js.
//
// STAND: nog NIET gewiред. De module staat met opzet in tools/ploeg/ en nog niet in tools/veronica/ -- zolang niets hem importeert
// hoort hij niet in de live Veronica-bundel (dat zou een versiebump + sw.js-vingerafdruk voor ongebruikte code vragen). Bij het
// wiren (stap 2, na de steer van de eigenaar) verhuist hij byte-gelijk naar tools/veronica/ EN naar JARVIS www/, met een plek in
// sw.js BESTANDEN. Tot dan is dit de referentie-implementatie met zijn test (check_ploeg.js).
//
// HET BORD IS EEN PRIKBORD, GEEN SLOT. Een lid kondigt aan "ik doe nu X op telefoon Y"; een ander lid kijkt vóór het iets doet of
// de telefoon al bezet is (botst), en wijkt dan beleefd uit. Het houdt niets tegen: botst() is een VRAAG, geen poort. Zo blijft
// "apart" altijd de terugval -- valt een lid weg (geen verse claim), dan vervallen zijn claims vanzelf en gaan de anderen door.
// Een noodstop negeert het bord altijd.
//
// VEILIGHEID (zelfde regel voor alle drie, niet onderhandelbaar, en NIET in deze module afdwingbaar -- hij kent geen toestellen):
// nooit de F8, nooit een bank-/kluis-/DigiD-app. De AANROEPER zeeft de F8 er met zijn eigen bestaande regel uit (is_f8 in ARTEMIS,
// de F8-uitsluiting in Veronica/JARVIS) -- EEN plek per kanaal, geen tweede zeef hier (dat was de fout van 118). Een effect is
// alleen 'kijken'/'rekenen'/'besturen'/'voorstel': niets wat onomkeerbaar de echte wereld raakt. 'besturen' = adb-tikken, het
// bestaande, al-veilige vermogen van ARTEMIS; deze module voegt daar geen nieuw vermogen aan toe.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Ploeg = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Meer leden bestaan niet. Een id buiten deze drie wordt geweigerd -- het bord is voor de BESTURINGEN, niet voor de telefoons
  // (die coördineren via Avengers/ontmoet). 'lokale-ai' = Veronica + de modellen op de telefoons.
  const LEDEN = ['lokale-ai', 'artemis', 'claude'];
  // Hetzelfde idee als Avengers' geen/voorstel: niets wat onomkeerbaar de echte wereld raakt.
  const EFFECTEN = ['kijken', 'rekenen', 'besturen', 'voorstel'];
  const TTL_MS = 2 * 60 * 1000;   // een claim die niet ververst wordt, vervalt -- een weggevallen lid blokkeert nooit
  // ---- 624 stap 2 (keuze B): OVERDRAGEN OP VERZOEK ----
  // Een lid mag een DEELTAAK aan een ander lid geven. Elke overdracht is een VOORSTEL; er wordt pas op gehandeld als hij is
  // goedgekeurd (bevestigd === true). "Zo autonoom mogelijk" (de eigenaar): de ongevaarlijke soorten keuren ZICHZELF goed (lezen,
  // rekenen, zoeken, diagnose raken niets onomkeerbaar), en alleen 'besturen' (adb-tikken) en 'voorstel' wachten op een mens.
  // Niets wat onomkeerbaar de echte wereld raakt (versturen/kopen/publiceren/wissen) bestaat als soort -- geef() weigert dat.
  const OVERDRACHT_SOORTEN = ['kijken', 'rekenen', 'zoeken', 'diagnose', 'besturen', 'voorstel'];
  const VANZELF = ['kijken', 'rekenen', 'zoeken', 'diagnose'];   // deze keuren zichzelf goed; de rest wacht op goedkeuring
  const OVERDRACHT_TTL_MS = 30 * 60 * 1000;   // een voorstel dat niemand oppakt of keurt, vervalt na een half uur

  const tekst = (x) => (typeof x === 'string' ? x : '');
  const getal = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);

  function maak() { return { claims: [], overdrachten: [], volg: 0 }; }
  // Een bord kan van een oudere vorm komen (alleen claims); lees de velden altijd defensief en draag ze alledrie mee.
  function claimsVan(bord) { return (bord && Array.isArray(bord.claims)) ? bord.claims : []; }
  function overVan(bord) { return (bord && Array.isArray(bord.overdrachten)) ? bord.overdrachten : []; }
  function magVanzelf(soort) { return VANZELF.indexOf(soort) !== -1; }

  function geldigLid(lid) { return LEDEN.indexOf(lid) !== -1; }
  // Een toestel-id zoals de rest van het systeem het kent (ontmoet/hartslag): kleine letters/cijfers, 12-40. De module zeeft de
  // F8 NIET (hij kent geen namen); dat doet de aanroeper. Een lege/foute telefoon wordt geweigerd zodat het bord schoon blijft.
  function geldigeTelefoon(t) { return /^[a-z0-9]{12,40}$/.test(tekst(t)); }
  function geldigEffect(e) { return EFFECTEN.indexOf(e) !== -1; }

  function levend(c, nu) { return c && getal(c.t) > 0 && (getal(nu) - getal(c.t)) < (getal(c.ttl) || TTL_MS); }

  // Zet of ververs de claim van EEN lid op EEN telefoon (één claim per lid+telefoon). Geeft het bijgewerkte bord of null bij
  // ongeldige invoer (dan verandert er niets -- de aanroeper doet gewoon wat hij al deed, "apart" als terugval).
  function claim(bord, c, nu, ttl) {
    if (!bord || !Array.isArray(bord.claims)) return null;
    const lid = tekst(c && c.lid), telefoon = tekst(c && c.telefoon), effect = tekst(c && c.effect);
    if (!geldigLid(lid) || !geldigeTelefoon(telefoon) || !geldigEffect(effect)) return null;
    const nieuw = { lid, telefoon, wat: tekst(c && c.wat).slice(0, 80), effect, t: getal(nu), ttl: getal(ttl) || TTL_MS };
    const claims = bord.claims.filter((x) => !(x.lid === lid && x.telefoon === telefoon));
    claims.push(nieuw);
    return { claims, overdrachten: overVan(bord), volg: getal(bord.volg) };
  }

  // De VRAAG die een lid stelt vóór het iets doet: claimt een ANDER, nog levend lid deze telefoon? Geeft dat lid (string) of null.
  // Dit houdt niets tegen -- de aanroeper mag altijd door (bij een noodstop MOET hij); het is er om te kunnen uitwijken.
  function botst(bord, w, nu) {
    if (!bord || !Array.isArray(bord.claims)) return null;
    const lid = tekst(w && w.lid), telefoon = tekst(w && w.telefoon);
    if (!geldigeTelefoon(telefoon)) return null;
    const b = bord.claims.find((x) => x.telefoon === telefoon && x.lid !== lid && levend(x, nu));
    return b ? b.lid : null;
  }

  // Klaar met een telefoon: haal de eigen claim weg (hoeft niet -- hij vervalt anders vanzelf via de ttl).
  function vrij(bord, lid, telefoon, nu) {
    if (!bord || !Array.isArray(bord.claims)) return bord;
    return { claims: bord.claims.filter((x) => !(x.lid === tekst(lid) && x.telefoon === tekst(telefoon))), overdrachten: overVan(bord), volg: getal(bord.volg) };
  }

  // Passief opruimen: gooi vervallen claims EN vervallen overdrachten weg. Geen timer -- de aanroeper roept dit aan wanneer hij
  // het bord toch al leest. De volg-teller blijft staan zodat id's uniek blijven.
  function ruimOp(bord, nu) {
    if (!bord) return maak();
    return { claims: claimsVan(bord).filter((x) => levend(x, nu)), overdrachten: overVan(bord).filter((x) => levend(x, nu)), volg: getal(bord.volg) };
  }

  // ---- 624 stap 2 (B): de overdracht ----
  // Een lid GEEFT een deeltaak aan een ander lid. Geeft het bijgewerkte bord of null bij ongeldige invoer (dan verandert niets).
  // bevestigd: true (keurt zichzelf goed, ongevaarlijke soort), null (wacht op een mens). van != naar; beide moeten een lid zijn.
  function geef(bord, o, nu, ttl) {
    if (!bord) return null;
    const van = tekst(o && o.van), naar = tekst(o && o.naar), soort = tekst(o && o.soort);
    if (!geldigLid(van) || !geldigLid(naar) || van === naar) return null;
    if (OVERDRACHT_SOORTEN.indexOf(soort) === -1) return null;   // een soort die iets onomkeerbaar doet bestaat niet
    const volg = getal(bord.volg) + 1;
    const nieuw = { id: String(volg), van, naar, wat: tekst(o && o.wat).slice(0, 200), soort,
      bevestigd: magVanzelf(soort) ? true : null, t: getal(nu), ttl: getal(ttl) || OVERDRACHT_TTL_MS };
    return { claims: claimsVan(bord), overdrachten: overVan(bord).concat([nieuw]), volg };
  }

  // Een mens (of een vaste regel) keurt een wachtend voorstel goed (besluit true) of af (false). Alleen een nog wachtend
  // (bevestigd === null), nog levend voorstel verandert -- een al goedgekeurde of afgekeurde overdracht blijft zoals hij is.
  function keur(bord, id, besluit, nu) {
    if (!bord) return null;
    const over = overVan(bord).map((x) => (x.id === String(id) && x.bevestigd === null && levend(x, nu))
      ? Object.assign({}, x, { bevestigd: besluit === true }) : x);
    return { claims: claimsVan(bord), overdrachten: over, volg: getal(bord.volg) };
  }

  // Wat MAG een lid nu echt doen: de aan hem gerichte, GOEDGEKEURDE (bevestigd === true), nog levende overdrachten. Een voorstel
  // dat niet (of nog niet) is goedgekeurd komt hier NOOIT uit -- dat is de hele veiligheid van keuze B.
  function teDoen(bord, lid, nu) {
    return overVan(bord).filter((x) => x.naar === tekst(lid) && x.bevestigd === true && levend(x, nu))
      .map((x) => ({ id: x.id, van: x.van, wat: x.wat, soort: x.soort, sinds: getal(nu) - getal(x.t) }));
  }

  // De voorstellen die nog op een mens wachten (bevestigd === null, nog levend) -- voor "keuren" in Veronica.
  function openVoorstellen(bord, nu) {
    return overVan(bord).filter((x) => x.bevestigd === null && levend(x, nu))
      .map((x) => ({ id: x.id, van: x.van, naar: x.naar, wat: x.wat, soort: x.soort, sinds: getal(nu) - getal(x.t) }));
  }

  // Wie doet nu wat -- per lid de levende claims, voor "Wie doet wat" in Veronica en voor de ARTEMIS-console.
  function status(bord, nu) {
    const uit = {};
    for (const lid of LEDEN) uit[lid] = [];
    if (!bord || !Array.isArray(bord.claims)) return uit;
    for (const c of bord.claims) {
      if (!levend(c, nu) || !geldigLid(c.lid)) continue;
      uit[c.lid].push({ telefoon: c.telefoon, wat: c.wat, effect: c.effect, sinds: getal(nu) - getal(c.t) });
    }
    return uit;
  }

  return { LEDEN, EFFECTEN, TTL_MS, OVERDRACHT_SOORTEN, VANZELF, OVERDRACHT_TTL_MS,
    maak, claim, botst, vrij, ruimOp, status, levend, geldigeTelefoon,
    magVanzelf, geef, keur, teDoen, openVoorstellen };
}));
