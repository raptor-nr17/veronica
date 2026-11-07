// ===================================================================
// 661 (stap 7 van "Lokale AI slimmer maken"): HET WERK VERDELEN. De leider is het apparaat dat altijd thuis is (nooit de F8). Dit bestand
// is de zuivere logica: het werk gaat naar de KOELSTE vrije telefoon, een te warme of te lege telefoon krijgt een melding en geen werk,
// elke taak heeft een tijdslimiet, en de Gemini-teller reset elke dag om 09:00 Nederlandse tijd. Geen scherm, geen netwerk, geen opslag.
//
// Waarom koelste-eerst (wens van de eigenaar): twee telefoons werden vannacht te warm en pauzeerden. Door het werk naar de koelste vrije
// telefoon te sturen blijft de warmte verdeeld en valt er niemand uit. De F8 (dagelijkse telefoon) doet NOOIT mee aan dit werk.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Leiderwerk = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_TEMP = 40;        // boven deze temperatuur geen werk (melding); verdeeld blijven ruim onder dit getal
  const MIN_ACCU = 30;        // onder deze accu zonder lader geen werk
  const TIJD_PER_TAAK_MS = { klein: 60000, midden: 180000, zwaar: 600000 };   // een taak die langer duurt wordt afgebroken

  const getal = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

  // Mag deze telefoon nu werk aannemen? Terug: { mag, reden }. Een te warme of te lege telefoon krijgt GEEN werk, met een reden
  // (de leider meldt dat). De F8 / dagelijkse telefoon doet nooit mee. Onbekende warmte/accu = voorzichtig (geen werk), behalve aan de lader.
  function magWerk(tel) {
    const t = tel || {};
    if (t.f8 === true || t.dagelijks === true) return { mag: false, reden: 'dagelijkse-telefoon' };
    if (t.bezig === true) return { mag: false, reden: 'bezig' };
    if (t.motorKlaar === false) return { mag: false, reden: 'model-niet-klaar' };
    const temp = getal(t.temp);
    if (temp != null && temp >= MAX_TEMP) return { mag: false, reden: 'te-warm' };
    const accu = getal(t.accu);
    if (!t.laadt && accu != null && accu < MIN_ACCU) return { mag: false, reden: 'accu-laag' };
    if (!t.laadt && accu == null && temp == null) return { mag: false, reden: 'onbekend' };
    return { mag: true, reden: 'ok' };
  }

  // Kies de KOELSTE vrije telefoon. Onder de telefoons die mogen werken: de laagste temperatuur eerst; bij gelijke/onbekende warmte de
  // hoogste accu; daarna op naam (stabiel). Terug: de gekozen telefoon of null (met een meldingslijst van wie en waarom niet meedoet).
  function kiesKoelsteVrij(telefoons) {
    const lijst = Array.isArray(telefoons) ? telefoons : [];
    const meldingen = [];
    const kandidaten = [];
    for (const t of lijst) {
      const m = magWerk(t);
      if (m.mag) kandidaten.push(t);
      else if (m.reden === 'te-warm' || m.reden === 'accu-laag') meldingen.push({ naam: t.naam || t.id, reden: m.reden });
    }
    kandidaten.sort((a, b) => {
      const ta = getal(a.temp), tb = getal(b.temp);
      if (ta != null && tb != null && ta !== tb) return ta - tb;         // koelste eerst
      if (ta != null && tb == null) return -1;
      if (ta == null && tb != null) return 1;
      const aa = getal(a.accu) || 0, ab = getal(b.accu) || 0;
      if (aa !== ab) return ab - aa;                                     // dan de volste accu
      return String(a.naam || a.id).localeCompare(String(b.naam || b.id));
    });
    return { telefoon: kandidaten[0] || null, meldingen };
  }

  function tijdslimiet(gewicht) { return TIJD_PER_TAAK_MS[gewicht] || TIJD_PER_TAAK_MS.midden; }

  // ---- De Gemini-teller, reset om 09:00 Nederlandse tijd ----
  // stand = { dag: '<de dag waarop geteld wordt>', n: <aantal> }. De "dag" loopt van 09:00 tot 09:00 NL: een aanroep om 02:00 hoort nog
  // bij de vorige kalenderdag. Zo ziet de eigenaar 's ochtends om 09:00 een verse teller. nu = ms (Date.now); tz-robuust via het uur in NL.
  function nlUur(nuMs) {
    try { return Number(new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false }).format(new Date(nuMs))); }
    catch (e) { return new Date(nuMs).getUTCHours() + 1; }   // terugval: NL ~ UTC+1
  }
  function telDag(nuMs) {
    // de "teldag" is de datum in NL, maar pas opgeschoven: vóór 09:00 telt als de vorige dag.
    const uur = nlUur(nuMs);
    const verschoven = uur < 9 ? nuMs - 12 * 3600 * 1000 : nuMs;   // 12 uur terug duwt een nacht-uur naar de vorige datum
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(verschoven)); }
    catch (e) { return new Date(verschoven).toISOString().slice(0, 10); }
  }
  function geminiTel(stand, nuMs) {
    const dag = telDag(nuMs);
    if (!stand || stand.dag !== dag) return { dag, n: 1 };   // nieuwe teldag -> reset en tel deze
    return { dag, n: (Number(stand.n) || 0) + 1 };
  }
  function geminiAantal(stand, nuMs) {
    if (!stand) return 0;
    return stand.dag === telDag(nuMs) ? (Number(stand.n) || 0) : 0;   // een oude stand leest als 0 (de dag is om)
  }

  return { MAX_TEMP, MIN_ACCU, TIJD_PER_TAAK_MS, magWerk, kiesKoelsteVrij, tijdslimiet, nlUur, telDag, geminiTel, geminiAantal };
}));
