// ===================================================================
// 678 (21 punten, stap 15 -> punt 10 "herinneringen met stem"): van een gesproken wens naar een Android-WEKKER of een AGENDA-
// afspraak. Het model (Granite kiest het label, E2B vult {wat, wanneer_tekst}); DEZE code maakt er de harde datum van (via de
// datumparser) en bouwt de intent-BESCHRIJVING. PUUR rekenen: geen netwerk, geen model, geen opslag, geen DOM. De intent wordt
// pas OP HET TOESTEL afgevuurd (JARVIS/Android AlarmClock SET_ALARM of Calendar INSERT) -- hier staat alleen WAT er gezet wordt,
// nooit het afvuren zelf. Een model verzint NOOIT zelf een tijdstip: de code leest het uit `wanneer_tekst` (§320-discipline).
//
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Herinnering = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_WAT = 200;
  const DAG_MS = 24 * 60 * 60 * 1000;
  const WEEKDAG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  const MAAND = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  // labels die het model (Granite) kan kiezen; sturen de keuze wekker vs agenda. Onbekend label = de code beslist op de tijd.
  const ALARM_LABELS = ['wekker', 'alarm', 'herinnering', 'pillen', 'medicijn'];
  const AGENDA_LABELS = ['afspraak', 'agenda', 'vergadering', 'bezoek', 'verjaardag'];

  function parser(dp) {
    if (dp && typeof dp.parse === 'function') return dp;
    if (typeof self !== 'undefined' && self.Datumparser) return self.Datumparser;
    if (typeof window !== 'undefined' && window.Datumparser) return window.Datumparser;
    return null;
  }

  // maak({wat, wanneer_tekst, label}, nu, dp) -> {ok, ...} of {ok:false, reden}.
  //   soort: 'alarm'  -> SET_ALARM (een kloktijd binnen een etmaal; Android zet hem op de eerstvolgende hh:mm)
  //          'agenda' -> Calendar INSERT (een afspraak op een datum; begin = ms, duur 1 uur)
  //   intent: de velden die het toestel nodig heeft (actie + extra's). Hier wordt NIETS afgevuurd.
  function maak(invoer, nu, dp) {
    const x = invoer || {};
    const d = parser(dp);
    if (!d) return { ok: false, reden: 'geen datumparser' };
    nu = typeof nu === 'number' ? nu : Date.now();
    let wat = typeof x.wat === 'string' ? x.wat.trim() : '';
    if (!wat) return { ok: false, reden: 'geen onderwerp (wat)' };
    if (wat.length > MAX_WAT) wat = wat.slice(0, MAX_WAT);
    const wanneer = typeof x.wanneer_tekst === 'string' ? x.wanneer_tekst : '';
    const t = d.parse(wanneer, nu);
    if (!t || typeof t.ms !== 'number') return { ok: false, reden: 'tijd onduidelijk', wat: wat };
    if (t.ms <= nu) return { ok: false, reden: 'tijd ligt in het verleden', wat: wat };

    const label = typeof x.label === 'string' ? x.label.toLowerCase().trim() : '';
    const binnenEtmaal = t.ms - nu <= DAG_MS;
    let soort;
    if (AGENDA_LABELS.indexOf(label) >= 0) soort = 'agenda';
    else if (ALARM_LABELS.indexOf(label) >= 0 && t.heeftTijd) soort = 'alarm';
    else soort = (t.heeftTijd && binnenEtmaal) ? 'alarm' : 'agenda';   // kloktijd binnen een etmaal = wekker; anders agenda

    const dt = new Date(t.ms);
    let intent;
    if (soort === 'alarm') {
      intent = { actie: 'android.intent.action.SET_ALARM', uur: dt.getHours(), minuut: dt.getMinutes(), bericht: wat, skipUi: true };
    } else {
      intent = { actie: 'android.intent.action.INSERT', mime: 'vnd.android.cursor.item/event', titel: wat, begin: t.ms, eind: t.ms + 60 * 60 * 1000, allDay: !t.heeftTijd };
    }
    return { ok: true, wat: wat, ms: t.ms, heeftTijd: t.heeftTijd, zeker: t.zeker, soort: soort, intent: intent, leesbaar: leesbaar(t.ms, nu, t.heeftTijd) };
  }

  // Een leesbare NL-tijd voor de bevestiging: "vandaag om 15:00", "morgen om 9:00", "dinsdag 17 november om 14:30",
  // of zonder tijd "op dinsdag 17 november".
  function leesbaar(ms, nu, heeftTijd) {
    const d = new Date(ms), n = new Date(nu);
    const kaal = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dagen = Math.round((kaal(d) - kaal(n)) / DAG_MS);
    const klok = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    let dagtekst;
    if (dagen === 0) dagtekst = 'vandaag';
    else if (dagen === 1) dagtekst = 'morgen';
    else if (dagen === 2) dagtekst = 'overmorgen';
    else if (dagen > 2 && dagen < 7) dagtekst = WEEKDAG[d.getDay()];
    else dagtekst = `${WEEKDAG[d.getDay()]} ${d.getDate()} ${MAAND[d.getMonth()]}`;
    return heeftTijd ? `${dagtekst} om ${klok}` : `op ${dagtekst}`;
  }

  function bevestigZin(r) {
    if (!r || !r.ok) return 'Dat verstond ik niet; wanneer moet de herinnering zijn?';
    const soort = r.soort === 'alarm' ? 'wekker' : 'afspraak';
    return `Ik zet een ${soort}: "${r.wat}" ${r.leesbaar}. Klopt dat?`;
  }

  return { maak: maak, leesbaar: leesbaar, bevestigZin: bevestigZin, ALARM_LABELS: ALARM_LABELS, AGENDA_LABELS: AGENDA_LABELS, MAX_WAT: MAX_WAT };
}));
