// ===================================================================
// 624 stap 2b: HET PLOEGBORD OVER DE RELAY -- de drie besturingen delen EEN bord via losse gebeurtenissen
// ===================================================================
//
// De relay (en ntfy) is een append-only brievenbus: je legt berichten neer en leest ze terug, je muteert geen gedeelde staat. Het
// ploegbord (ploeg.js) is wel gedeelde staat. Daarom schrijft elk lid alleen losse GEBEURTENISSEN op de relay (een claim, een
// overdracht geven, een voorstel keuren), en bouwt elke lezer het bord opnieuw op door ze op volgorde in te vouwen met precies de
// functies van ploeg.js. Zo is er geen tweede waarheid: het bord is altijd de som van de gebeurtenissen (zelfde idee als §119).
//
// PUUR: geen netwerk, geen opslag, geen crypto hier. De aanroeper (Veronica, ARTEMIS, Claude) leest/schrijft de relay met zijn
// EIGEN bestaande versleuteling (dezelfde AES-GCM als de hartslag) en geeft de ontsleutelde gebeurtenissen aan vouwIn(). De
// topic-/sleutelafleiding staat hier alleen als STRING (zodat alle drie dezelfde relay-topic gebruiken), niet als crypto.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek(require('./ploeg.js'));
  else wortel.Ploegpost = fabriek(wortel.Ploeg);
}(typeof self !== 'undefined' ? self : this, function (Ploeg) {
  'use strict';

  // Een EIGEN relay-topic voor het ploegbord, afgeleid uit hetzelfde geheime onderwerp als de hartslag -- maar met een ander
  // voorvoegsel, zodat het ploeg-verkeer niet met de hartslag botst. De crypto-sleutel leidt de aanroeper af met dezelfde vorm
  // (veronica-ploeg-sleutel:<O>) via zijn bestaande sha256; hier staat alleen de AFSPRAAK als string.
  const TOPIC_PREFIX = 'veronica-ploeg:';
  const SLEUTEL_PREFIX = 'veronica-ploeg-sleutel:';
  const GELDIGE_OPS = ['claim', 'vrij', 'geef', 'keur'];
  const MAX_GEBEURTENISSEN = 500;   // een lezer vouwt hoogstens zoveel recente gebeurtenissen in (de relay bewaart er toch al maar ~100)

  const getal = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);
  const tekst = (x) => (typeof x === 'string' ? x : '');

  // De payload die een lid op de relay legt voor EEN gebeurtenis. De aanroeper versleutelt dit en post het; `t` is de klok van de
  // schrijver maar vouwIn sorteert erop, dus een losse klok tussen toestellen is geen ramp (de relay stempelt ook zelf).
  function gebeurtenis(op, data, nu) {
    if (GELDIGE_OPS.indexOf(op) === -1) return null;
    return Object.assign({ op: op, t: getal(nu) }, (data && typeof data === 'object') ? data : {});
  }

  // Vouw een lijst ontsleutelde gebeurtenissen in tot EEN bord. Op volgorde van tijd (gelijkspel: de volgorde waarin ze binnenkwamen).
  // Onbekende of kapotte gebeurtenissen worden stil overgeslagen -- een lezer mag nooit omvallen op rommel van de relay.
  function vouwIn(gebeurtenissen, nu) {
    let bord = Ploeg.maak();
    if (!Array.isArray(gebeurtenissen)) return bord;
    const lijst = gebeurtenissen
      .filter((g) => g && typeof g === 'object' && GELDIGE_OPS.indexOf(g.op) !== -1)
      .slice(-MAX_GEBEURTENISSEN)
      .map((g, i) => ({ g: g, i: i }))
      .sort((a, b) => (getal(a.g.t) - getal(b.g.t)) || (a.i - b.i));
    for (const { g } of lijst) {
      const t = getal(g.t) || getal(nu);
      let volgend = null;
      if (g.op === 'claim') volgend = Ploeg.claim(bord, { lid: g.lid, telefoon: g.telefoon, wat: g.wat, effect: g.effect }, t, g.ttl);
      else if (g.op === 'vrij') volgend = Ploeg.vrij(bord, tekst(g.lid), tekst(g.telefoon), t);
      else if (g.op === 'geef') volgend = Ploeg.geef(bord, { van: g.van, naar: g.naar, wat: g.wat, soort: g.soort }, t, g.ttl);
      else if (g.op === 'keur') volgend = Ploeg.keur(bord, tekst(g.id), g.besluit === true, t);
      if (volgend) bord = volgend;   // een geweigerde (ongeldige) gebeurtenis laat het bord zoals het was
    }
    return bord;
  }

  return { TOPIC_PREFIX, SLEUTEL_PREFIX, GELDIGE_OPS, MAX_GEBEURTENISSEN, gebeurtenis, vouwIn };
}));
