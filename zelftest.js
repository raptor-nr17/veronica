/*
 * 492 (18 oktober): DE ZELFTEST. Wat alleen op een echte telefoon te toetsen is, meet de telefoon zelf: elke zes uur, na het
 * opstarten en op een tik in Veronica. Naar buiten gaan ALLEEN codes per punt (ok / nee / info), nooit een adres, sleutel of
 * tekst van de telefoon; de zin maakt Veronica zelf uit deze vaste tabel. Hetzelfde bestand staat byte-gelijk in JARVIS en Veronica.
 * Niets hier verandert iets op de telefoon: de zelftest kijkt alleen.
 */
(function (wereld) {
  'use strict';
  const UITSLAGEN = ['ok', 'nee', 'info'];
  // Per punt: de titel en de zin per uitslag. "nee" zegt altijd wat er moet gebeuren, in gewone woorden.
  const PUNTEN = {
    wifi: { titel: 'Wifi', ok: 'Op wifi.', nee: 'Niet op wifi. Zet wifi aan, op het netwerk van de Chromebook.' },
    postbus: { titel: 'Postbus', ok: 'Het adres van de postbus is geldig.', nee: 'Het adres van de postbus is verlopen of ontbreekt. Plak de verse code in Veronica (tegel van deze telefoon).' },
    bijwerken: { titel: 'Bijwerken', ok: 'Kijkt zelf naar nieuwe versies en vindt ze.', nee: 'Kan niet kijken of er een nieuwe versie is.', info: 'Nog niet gekeken sinds het opstarten.' },
    motor: { titel: 'Eigen motor', ok: 'Draait en heeft vragen beantwoord.', nee: 'Staat aan maar meldt een fout. Zet hem in JARVIS (Instellingen, Eigen motor) uit en weer aan.',
      info: 'Staat uit, haalt het model nog binnen, of is nog niet gebruikt.' },
    olliteRt: { titel: 'OlliteRT', ok: 'Antwoordt.', nee: 'Antwoordt niet, en de eigen motor is nog niet klaar: deze telefoon kan nu niet rekenen.', info: 'Antwoordt niet, maar de eigen motor rekent.' },
    bluetooth: { titel: 'Bluetooth', ok: 'Werkt (de telefoons vinden elkaar ook zonder QR).', nee: 'Bluetooth staat uit of JARVIS heeft geen toestemming. Zet Bluetooth aan in het snelmenu.',
      info: 'Uitgezet in JARVIS, of deze telefoon kan het niet.' },
    zelfOpenen: { titel: 'Vanzelf openen', ok: 'JARVIS mag zichzelf openen na een herstart of update.', nee: 'JARVIS mag zichzelf niet openen. Zet "Boven andere apps weergeven" aan voor JARVIS (Instellingen, Apps).' },
    batterij: { titel: 'Batterij', ok: 'Batterij onbeperkt: Android zet JARVIS niet stil.', nee: 'Android mag JARVIS stilzetten. Zet de batterij van JARVIS op Onbeperkt (Instellingen, Apps, JARVIS, Batterij).',
      info: 'Batterij beperkt, maar de eigen motor staat uit: dat is nu geen probleem.' },
    // 548: de eenmalige stap per SYSTEEM (de fabrikant zet JARVIS anders zelf stil: "door het systeem gestopt (fabrikant)"). Android
    // kan niet zeggen of die schakelaars om staan; ok = de stap is op de telefoon met "Gedaan" bevestigd EN het systeem heeft JARVIS
    // het afgelopen etmaal niet stilgezet. Een punt per systeem, zodat de zin precies zegt waar je moet tikken.
    systeemHyper: { titel: 'Systeem (HyperOS)', ok: 'Autostart, Geen beperkingen en het slotje staan goed: het systeem zet JARVIS niet stil.',
      nee: 'Het systeem zet JARVIS stil. Eenmalig: Instellingen, Apps, JARVIS: Autostart aan en Batterijbesparing op "Geen beperkingen". Dan Recente apps: JARVIS ingedrukt houden of omlaag vegen en het slotje aanzetten. Tik daarna in JARVIS op Gedaan.' },
    systeemOneUi: { titel: 'Systeem (One UI)', ok: 'Nooit in slaapstand, Onbeperkt en Openhouden staan goed: het systeem zet JARVIS niet stil.',
      nee: 'Het systeem zet JARVIS stil. Eenmalig: Instellingen, Batterij, Limieten achtergrondgebruik: JARVIS bij "Apps die nooit in slaapstand gaan". Apps, JARVIS, Batterij: Onbeperkt. Dan Recente apps: op het icoon van JARVIS tikken en "Openhouden". Tik daarna in JARVIS op Gedaan.' },
    systeemOverig: { titel: 'Systeem', ok: 'Batterij onbeperkt: het systeem zet JARVIS niet stil.',
      nee: 'Het systeem zet JARVIS stil. Eenmalig: Instellingen, Apps, JARVIS, Batterij: Onbeperkt (of "Niet optimaliseren"). Tik daarna in JARVIS op Gedaan.' },
    // 548b: het gast-brein (alleen op de dagelijkse telefoon die het is). ok = rekent mee; info = rust nu om een gewone reden (in
    // gebruik, accu onder 30%, niet thuis, te warm); nee = de server van OlliteRT staat uit, en dat moet een mens aanzetten.
    gastBrein: { titel: 'Gast-brein', ok: 'Rekent mee aan het zware werk.', info: 'Rust nu: in gebruik, accu onder 30%, niet thuis of te warm. Dat is gewoon zo.',
      nee: 'De server van OlliteRT staat uit: open OlliteRT, kies Gemma-4-E4B-it als standaardmodel en zet Start on Boot aan.' },
  };
  const SYSTEEM_PUNT = { hyper: 'systeemHyper', oneui: 'systeemOneUi', overig: 'systeemOverig' };
  const VOLGORDE = Object.keys(PUNTEN);

  // Uit ruwe metingen (alleen ja/nee en vaste woorden) de uitslag per punt. Onbekend = het punt valt weg (niet gokken).
  function beoordeel(m, nu) {
    const x = m || {};
    const p = {};
    if (typeof x.wifi === 'boolean') p.wifi = x.wifi ? 'ok' : 'nee';
    if (x.postbus) p.postbus = x.postbus.gekoppeld && !x.postbus.verlopen ? 'ok' : 'nee';
    if (x.bijwerken === 'actueel' || x.bijwerken === 'nieuwer') p.bijwerken = 'ok';
    else if (x.bijwerken === 'fout') p.bijwerken = 'nee';
    else if (x.bijwerken === null) p.bijwerken = 'info';
    const mo = x.motor;
    const motorRekent = !!(mo && mo.aan && mo.klaar);
    if (mo) p.motor = !mo.aan ? 'info' : mo.fase === 'fout' ? 'nee' : mo.klaar && mo.klussen > 0 ? 'ok' : 'info';
    if (typeof x.olliteRt === 'boolean') p.olliteRt = x.olliteRt ? 'ok' : motorRekent ? 'info' : 'nee';
    const b = x.bluetooth;
    if (b) p.bluetooth = !b.inJarvis || b.kan === false ? 'info' : b.toestemming === false || b.adapterUit ? 'nee' : b.kan === true ? 'ok' : undefined;
    if (p.bluetooth === undefined) delete p.bluetooth;
    if (typeof x.zelfOpenen === 'boolean') p.zelfOpenen = x.zelfOpenen ? 'ok' : 'nee';
    if (typeof x.batterijVrij === 'boolean') p.batterij = x.batterijVrij ? 'ok' : mo && mo.aan ? 'nee' : 'info';
    if (x.gast && typeof x.gast === 'object') p.gastBrein = x.gast.mag === true ? 'ok' : x.gast.reden === 'server-uit' ? 'nee' : 'info';
    const sy = x.systeem;
    if (sy && SYSTEEM_PUNT[sy.soort] && typeof sy.gedaan === 'boolean') p[SYSTEEM_PUNT[sy.soort]] = sy.gedaan && !(Number(sy.stops24) > 0) ? 'ok' : 'nee';
    return { t: Number.isFinite(nu) ? nu : Date.now(), p };
  }
  // Voor Veronica: alleen bekende punten met een bekende uitslag; al het andere valt weg.
  function lees(z) {
    if (!z || typeof z !== 'object' || !Number.isFinite(z.t) || !z.p || typeof z.p !== 'object') return null;
    const p = {};
    for (const id of VOLGORDE) if (UITSLAGEN.includes(z.p[id])) p[id] = z.p[id];
    return { t: z.t, p };
  }
  function regels(z) {
    const x = lees(z);
    if (!x) return [];
    return VOLGORDE.filter((id) => x.p[id]).map((id) => ({ id, titel: PUNTEN[id].titel, uitslag: x.p[id], zin: PUNTEN[id][x.p[id]] || '' }));
  }
  function samenvatting(z) {
    const r = regels(z);
    if (!r.length) return null;
    const nee = r.filter((x) => x.uitslag === 'nee');
    const ok = r.filter((x) => x.uitslag === 'ok').length;
    return nee.length ? `${ok} goed, ${nee.length} niet goed: ${nee.map((x) => x.titel).join(', ')}.` : `Alles goed (${ok} punten).`;
  }
  // 557: DE STAPPEN PER SYSTEEM, elk met EEN tik op OK (de telefoon opent dan het juiste scherm; omzetten doe je zelf, dat laat
  // Android een app niet doen). "Onbeperkt" kan Android uitlezen: staat hij goed (vrij), dan valt die stap weg. De rest kan het
  // systeem niet zeggen; die stap is klaar zodra je hem met OK hebt geopend. o: { vrij: true|false|null, gedaan: ['slaap', ...] }.
  const SYSTEEM_STAPPEN = {
    hyper: [['onbeperkt', 'Stap {i} van {n}: zet de batterij van JARVIS op Onbeperkt. Tik OK, dan vraagt Android het; kies Toestaan.'],
      ['autostart', 'Stap {i} van {n}: zet Autostart aan voor JARVIS. Tik OK, dan open ik die lijst; zet het schuifje bij JARVIS aan.'],
      ['beperkingen', 'Stap {i} van {n}: batterijbesparing op "Geen beperkingen". Tik OK, dan open ik het scherm van JARVIS; kies "Geen beperkingen".']],
    oneui: [['onbeperkt', 'Stap {i} van {n}: zet de batterij van JARVIS op Onbeperkt. Tik OK, dan vraagt Android het; kies Toestaan.'],
      ['slaap', 'Stap {i} van {n}: JARVIS bij "Apps die nooit in slaapstand gaan". Tik OK, dan open ik het batterijscherm; kies Limieten achtergrondgebruik en voeg JARVIS toe.']],
    overig: [['onbeperkt', 'Stap {i} van {n}: zet de batterij van JARVIS op Onbeperkt. Tik OK, dan vraagt Android het; kies Toestaan.']],
  };
  function systeemStappen(soort, o) {
    const x = o || {};
    const gedaan = Array.isArray(x.gedaan) ? x.gedaan : [];
    const lijst = (SYSTEEM_STAPPEN[soort] || SYSTEEM_STAPPEN.overig).filter(([stap]) => (stap === 'onbeperkt' ? x.vrij !== true : true));
    const n = lijst.length;
    return lijst.map(([stap, zin], i) => ({ stap, zin: zin.replace('{i}', String(i + 1)).replace('{n}', String(n)), klaar: stap === 'onbeperkt' ? x.vrij === true : gedaan.includes(stap) }))
      .filter((s) => !s.klaar);
  }
  const uit = { PUNTEN, SYSTEEM_PUNT, VOLGORDE, UITSLAGEN, beoordeel, lees, regels, samenvatting, SYSTEEM_STAPPEN, systeemStappen };
  if (typeof module !== 'undefined' && module.exports) module.exports = uit;
  else wereld.Zelftest = uit;
})(typeof window !== 'undefined' ? window : globalThis);
