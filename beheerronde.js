// ===================================================================
// 1.9.82 (B, lokale AI): DE BEHEERDER-RONDE -- de beheerder regelt de rij, assemble is de gewone stand
// ===================================================================
//
// Opdracht van de eigenaar (4 nov, netto besluit):
//  - De rektelefoons staan ALTIJD aan en doen ALTIJD mee; het pantser staat standaard aan.
//  - 'Assemble' is de GEWONE stand: elke klus wordt over ALLE beschikbare telefoons verdeeld.
//  - De beheerder (de geheugen-telefoon, met de denker-telefoon erbij) kijkt ELK KWARTIER naar alle telefoons, lost bekende
//    problemen op met VASTE REGELS, en schrijft de oplossing in het kennisboek.
//  - Een telefoon gaat alleen TIJDELIJK op pauze bij een echte reden: boven 42 °C of accu leeg / van de lader. Dat doet de
//    telefoon ZELF (sparen.js/het vangnet); de beheerder dwingt dat niet af met een roep (er bestaat geen roep om sparen te
//    zetten -- bewust, §481). De beheerder zorgt alleen dat een GEZONDE telefoon zijn motor AAN heeft (roep motor-aan).
//  - De F8 doet mee bij assemble ALS hij thuis op het wifi is, volgens zijn gast-brein-regels (accu > 30%, pauze boven 38 °C,
//    nooit baas, NOOIT via adb/ARTEMIS bestuurd). Valt hij weg, dan gaat het rek door zonder hem.
//  - Altijd zichtbaar in Veronica WIE meedoet / gepauzeerd is en WAAROM. De NOODSTOP van de eigenaar wint ALTIJD (de aanroeper
//    slaat de ronde over als de noodstop aan staat). Nooit bank-/kluis-apps; de F8 nooit via adb.
//
// GEWONE CODE, GEEN MODEL. De "vaste regels" zijn een lijst; de ronde VERZINT niets en VOERT zelf niets uit: hij levert een
// lijst roepen (die de bestaande weg roepNaarId/roepOp uitvoert, alleen motor-aan), een beeld "wie doet wat en waarom", en
// hoogstens drie korte kennisboek-notities. Byte-gelijk in tools/veronica/ en tools/gemma-telefoonrij/app/www/.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Beheerronde = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RONDE_MS = 15 * 60 * 1000;     // elk kwartier
  const MAX_NOTITIES_PER_DAG = 3;      // hoogstens drie "vandaag geleerd" per nacht
  const VERS_MS = 6 * 60 * 1000;       // een hartslag jonger dan dit telt als "nu"
  const NOTITIE_MAX = 160;
  // De grenzen staan gelijk aan sparen.js (rek) en gastbrein.js (F8). Verander je ze daar, verander ze hier mee.
  const REK_TEMP_MAX = 42;             // boven 42 °C pauzeert een gekoelde rektelefoon (1.9.81 #2)
  const REK_ACCU_MIN = 50;             // onder 50% zonder lader neemt hij geen werk aan (sparen.js)
  const F8_TEMP_MAX = 38;              // de F8 (gast-brein) pauzeert boven 38 °C
  const F8_ACCU_MIN = 30;              // de F8 doet mee vanaf 30% (gast-brein, §548b)

  const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const schoon = (t) => String(t == null ? '' : t).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTITIE_MAX);
  function dagVan(nu) { return new Date(nu).toISOString().slice(0, 10); }
  const aanLader = (h) => h && (h.laadt === true || h.laadt === 'ja' || h.laadt === 1);

  function magSchrijven(zelfId, geheugenId) {
    return !!(zelfId && geheugenId && String(zelfId) === String(geheugenId));
  }
  function magRonde(laatstMs, nu) {
    const l = getal(laatstMs);
    return l === null || (nu - l) >= RONDE_MS;
  }
  const vers = (h, nu) => { const t = getal(h && h.t); return t === null || (nu - t) <= VERS_MS; };

  // Een telefoon: is het de F8 (gast-brein)? Dan gelden de gast-brein-regels. Anders een gewone rektelefoon.
  function isF8(h, f8Id) { return !!(f8Id && h && String(h.id) === String(f8Id)); }

  // Mag deze telefoon NU meedoen, en zo niet, waarom? -> { mee: bool, waarom: '' }
  // f8Thuis: is de F8 op het eigen wifi (thuis)? Alleen dan mag de F8 mee.
  function doetMee(h, f8Id, f8Thuis) {
    const temp = getal(h && h.temp);
    const accu = getal(h && h.accu);
    if (isF8(h, f8Id)) {
      if (h && h.rol === 'baas') return { mee: false, waarom: 'de F8 is nu de baas en wordt niet ingezet' };
      if (!f8Thuis) return { mee: false, waarom: 'de F8 is niet thuis op het wifi' };
      if (temp !== null && temp > F8_TEMP_MAX) return { mee: false, waarom: `te warm (${Math.round(temp)} °C)` };
      if (accu !== null && accu < F8_ACCU_MIN && !aanLader(h)) return { mee: false, waarom: `accu te laag (${Math.round(accu)}%)` };
      return { mee: true, waarom: 'gast-brein, thuis' };
    }
    // Een gewone rektelefoon: altijd mee, behalve bij een echte reden (hitte of accu leeg/van de lader).
    if (temp !== null && temp > REK_TEMP_MAX) return { mee: false, waarom: `te warm (${Math.round(temp)} °C)` };
    if (accu !== null && accu < REK_ACCU_MIN && !aanLader(h)) return { mee: false, waarom: `accu leeg (${Math.round(accu)}%) en van de lader` };
    return { mee: true, waarom: '' };
  }

  // Heeft een telefoon die MEE mag een zetje nodig om zijn motor aan te zetten (pantser aan)? Alleen een roep motor-aan;
  // nooit de dagelijkse telefoon, nooit een te oude telefoon (die kan geen eigen motor), nooit de F8 via adb (motor-aan is
  // een gewone roep over de brievenbus/relay, geen adb).
  function heeftMotorZetje(h) {
    if (!h) return false;
    if (h.dagelijks === true) return false;
    const m = h.motor || {};
    if (m.aan === true) return false;          // motor staat al aan
    if (m.soort === 'te-oud' || m.fase === 'te-oud') return false;
    return true;
  }

  // DE VASTE REGELS voor het kennisboek: bekende gebeurtenissen uit de hartslag, elk met een korte "geleerd"-zin.
  const KENNIS_REGELS = [
    { code: 'stop', past: (h) => Array.isArray(h.stops) && h.stops.some((s) => s && (s.reden === 5 || s.reden === 6)),
      zin: (h) => `${h.naam || 'Een telefoon'} sloot zich onlangs zelf af (crash/signaal); de motor is opnieuw gestart.` },
    { code: 'warm', past: (h) => getal(h.temp) !== null && h.temp > REK_TEMP_MAX,
      zin: (h) => `${h.naam || 'Een telefoon'} werd te warm (${Math.round(h.temp)} °C) en nam even geen werk aan.` },
    { code: 'leeg', past: (h) => getal(h.accu) !== null && h.accu < REK_ACCU_MIN && !aanLader(h),
      zin: (h) => `${h.naam || 'Een telefoon'} zat laag (${Math.round(h.accu)}%) zonder lader en deed even niet mee.` },
  ];

  // DE RONDE. o: { harten:[hartslag], zelfId, geheugenId, f8Id, f8Thuis, laatstMs, dagNotities:{dag,n}, nu }
  // -> { gedraaid, roepen:[{soort:'motor-aan', id}], mee:[{id,naam,waarom}], gepauzeerd:[{id,naam,waarom}],
  //      schrijf:[zin], dagNotities, laatstMs }
  function ronde(o) {
    const x = o || {};
    const nu = getal(x.nu) || Date.now();
    const leeg = { gedraaid: false, roepen: [], mee: [], gepauzeerd: [], schrijf: [], dagNotities: x.dagNotities || { dag: dagVan(nu), n: 0 }, laatstMs: getal(x.laatstMs) };
    if (!magRonde(x.laatstMs, nu)) return leeg;
    const harten = (Array.isArray(x.harten) ? x.harten : []).filter((h) => h && h.id && vers(h, nu));
    const roepen = [];
    const mee = [];
    const gepauzeerd = [];
    const zinnen = [];
    for (const h of harten) {
      const d = doetMee(h, x.f8Id, x.f8Thuis === true);
      if (d.mee) {
        mee.push({ id: h.id, naam: h.naam || 'Een telefoon', waarom: d.waarom });
        // Assemble = gewone stand: een gezonde telefoon die meedoet hoort zijn motor aan te hebben (pantser). Een zetje mag
        // de eigen telefoon (de beheerder) overslaan -- die regelt zichzelf; roepen naar jezelf heeft geen zin.
        if (String(h.id) !== String(x.zelfId) && heeftMotorZetje(h)) roepen.push({ soort: 'motor-aan', id: h.id });
      } else {
        gepauzeerd.push({ id: h.id, naam: h.naam || 'Een telefoon', waarom: d.waarom });
      }
      for (const r of KENNIS_REGELS) {
        let raak = false;
        try { raak = !!r.past(h); } catch (e) { raak = false; }
        if (raak) { const z = schoon(r.zin(h)); if (z) zinnen.push(z); }
      }
    }
    // Het kennisboek schrijven mag ALLEEN de geheugen-telefoon, en hoogstens drie per kalenderdag.
    let dn = x.dagNotities && x.dagNotities.dag === dagVan(nu) ? { dag: dagVan(nu), n: getal(x.dagNotities.n) || 0 } : { dag: dagVan(nu), n: 0 };
    let schrijf = [];
    if (magSchrijven(x.zelfId, x.geheugenId)) {
      const ruimte = Math.max(0, MAX_NOTITIES_PER_DAG - dn.n);
      const uniek = [];
      for (const z of zinnen) if (!uniek.includes(z)) uniek.push(z);
      schrijf = uniek.slice(0, ruimte);
      dn = { dag: dn.dag, n: dn.n + schrijf.length };
    }
    return { gedraaid: true, roepen, mee, gepauzeerd, schrijf, dagNotities: dn, laatstMs: nu };
  }

  // Een korte zin voor Veronica: wie doet mee, wie is gepauzeerd en waarom.
  function zin(uit) {
    if (!uit || !uit.gedraaid) return '';
    const meeN = (uit.mee || []).map((m) => m.naam).join(', ');
    const pauze = (uit.gepauzeerd || []).map((p) => `${p.naam} (${p.waarom})`).join(', ');
    const delen = [];
    if (meeN) delen.push(`Meedoen: ${meeN}`);
    if (pauze) delen.push(`Pauze: ${pauze}`);
    if ((uit.roepen || []).length) delen.push(`${uit.roepen.length} keer motor-aan gestuurd`);
    return delen.join('. ');
  }

  return { RONDE_MS, MAX_NOTITIES_PER_DAG, VERS_MS, REK_TEMP_MAX, REK_ACCU_MIN, F8_TEMP_MAX, F8_ACCU_MIN, KENNIS_REGELS,
    magSchrijven, magRonde, doetMee, heeftMotorZetje, isF8, dagVan, ronde, zin };
}));
