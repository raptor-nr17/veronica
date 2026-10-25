// gastbudget.js (572) -- ZUINIG OP HET GASTNETWERK. Byte-gelijk in JARVIS en Veronica. Pure logica, geen netwerk, geen opslag.
//
// Op een GASTNETWERK (locatie.js, soort 'gast') telt elke byte: de schoonouders hebben een datalimiet, en het rek deelt EEN
// publiek IP. Daarom een DAGPLAFOND in MB (`GAST_MB_PER_DAG`). Boven het plafond pauzeert ALLES behalve de hartslag -- die is
// klein (~3 KB) en de enige lijn waarlangs Veronica nog ziet dat een telefoon leeft. Op het hoofdwifi (soort 'hoofd') of een
// onbekende plek geldt GEEN plafond.
//
// De MB zijn een SCHATTING uit vaste kosten per soort verkeer (we meten geen echte bytes; dat kan Android/JS niet betrouwbaar).
// Eerlijk zo genoemd in Veronica ("± ... MB vandaag").
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Gastbudget = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GAST_MB_PER_DAG = 50;   // schatting; genoeg voor een dag werk, weinig genoeg om een datalimiet te sparen
  // De geschatte kosten per soort verkeer, in MB. Een hartslag is piepklein; een model-download is groot (die staat los, via
  // het downloadvenster). Onbekend soort = 0,05 MB (voorzichtig, telt wel mee).
  const KOSTEN = { hartslag: 0.003, postbus: 0.02, roep: 0.02, zoeken: 0.4, artemis: 0.25, gezond: 0.02, melding: 0.01 };
  const kost = (soort) => (Object.prototype.hasOwnProperty.call(KOSTEN, soort) ? KOSTEN[soort] : 0.05);

  const vandaag = (nu) => new Date(typeof nu === 'number' ? nu : Date.now()).toISOString().slice(0, 10);

  // De dagstand: { dag: 'JJJJ-MM-DD', mb: <getal> }. Bij een nieuwe dag begint hij op nul.
  function verversStand(stand, nu) {
    const d = vandaag(nu);
    if (!stand || stand.dag !== d) return { dag: d, mb: 0 };
    return { dag: d, mb: Number(stand.mb) || 0 };
  }
  // Tel verbruik erbij (alleen op een gastnetwerk zinvol, maar de teller telt altijd -- de poort beslist of het mag).
  function tel(stand, soort, nu) {
    const s = verversStand(stand, nu);
    return { dag: s.dag, mb: Math.round((s.mb + kost(soort)) * 1000) / 1000 };
  }

  const plafondBereikt = (stand, nu) => verversStand(stand, nu).mb >= GAST_MB_PER_DAG;

  // DE POORT. Mag dit verkeer NU? Een hartslag mag ALTIJD (de lijn naar Veronica). Buiten een gastnetwerk mag alles. Op een
  // gastnetwerk: tot het plafond mag alles; boven het plafond mag alleen de hartslag. Geeft { mag, reden }.
  function mag(soort, plek, stand, nu) {
    if (soort === 'hartslag') return { mag: true, reden: '' };
    if (!plek || plek.soort !== 'gast') return { mag: true, reden: '' };
    if (plafondBereikt(stand, nu)) return { mag: false, reden: 'dagplafond van het gastnetwerk bereikt -- alleen de hartslag loopt nog door tot morgen' };
    return { mag: true, reden: '' };
  }

  // Een zin voor Veronica: hoeveel MB vandaag (schatting), het plafond, en of het plafond bereikt is. Buiten een gastnetwerk:
  // geen plafond.
  function zin(plek, stand, nu) {
    const s = verversStand(stand, nu);
    if (!plek || plek.soort !== 'gast') return `± ${s.mb.toFixed(1)} MB vandaag (geen dagplafond buiten het gastnetwerk).`;
    const mb = s.mb.toFixed(1);
    if (s.mb >= GAST_MB_PER_DAG) return `± ${mb} van ${GAST_MB_PER_DAG} MB vandaag: dagplafond bereikt. Alles behalve de hartslag pauzeert tot morgen.`;
    return `± ${mb} van ${GAST_MB_PER_DAG} MB vandaag (gastnetwerk, zuinig).`;
  }

  return { GAST_MB_PER_DAG, KOSTEN, kost, verversStand, tel, plafondBereikt, mag, zin, vandaag };
}));
