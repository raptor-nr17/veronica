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
  };
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
  const uit = { PUNTEN, VOLGORDE, UITSLAGEN, beoordeel, lees, regels, samenvatting };
  if (typeof module !== 'undefined' && module.exports) module.exports = uit;
  else wereld.Zelftest = uit;
})(typeof window !== 'undefined' ? window : globalThis);
