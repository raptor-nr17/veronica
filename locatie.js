// locatie.js (570) -- PLEK HERKENNEN. Byte-gelijk in JARVIS en Veronica. Pure logica, geen netwerk, geen opslag.
//
// De SSID->plek-tabel staat LOKAAL op elke telefoon, nooit in de code: een merk- of plaatsnaam hoort niet in een bestand
// (zelfde regel als 476 en de Veronica-privacyscan). Een regel in de tabel: { ssid, net, naam, soort }.
//  - ssid: de wifi-naam (Android geeft die alleen met locatietoestemming en locatie aan; vaak niet beschikbaar);
//  - net:  het /24 (bijv. "192.168.178") -- de betrouwbare, toestemmingsVRIJE terugval die JARVIS toch al kent;
//  - naam: het etiket dat de eigenaar zelf koos (blijft lokaal; reist alleen in zijn eigen versleutelde hartslag);
//  - soort: 'gast' (een gastnetwerk: zuinig, telefoons zien elkaar niet over wifi, mDNS geblokkeerd), 'hoofd' (het hoofdwifi:
//    geen beperkingen) of 'hotspot' (de F8-hotspot als reserve).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Locatie = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SOORTEN = ['gast', 'hoofd', 'hotspot'];
  const schoon = (s) => String(s == null ? '' : s).trim();
  const schoonSoort = (s) => (SOORTEN.includes(s) ? s : 'gast');

  // Kies de plek die bij deze SSID of dit /24 hoort. Eerst op SSID (als die bekend is), dan op net. Hoofdletterongevoelig
  // voor de SSID. Geen match = null (een onbekende plek: JARVIS doet dan niets bijzonders).
  function kiesPlek(ssid, net, tabel) {
    const s = schoon(ssid).toLowerCase();
    const n = schoon(net).toLowerCase();
    const lijst = Array.isArray(tabel) ? tabel : [];
    let opNet = null;
    for (const r of lijst) {
      if (!r) continue;
      if (s && schoon(r.ssid).toLowerCase() === s) return maak(r);
      if (!opNet && n && schoon(r.net).toLowerCase() === n) opNet = r;
    }
    return opNet ? maak(opNet) : null;
  }
  function maak(r) {
    return { ssid: schoon(r.ssid), net: schoon(r.net), naam: schoon(r.naam).slice(0, 40), soort: schoonSoort(r.soort) };
  }

  // De regels per plek-soort.
  //  gast:   geen eerste netwerk, geen mDNS, geen ARTEMIS zonder kabel; grote downloads alleen 's nachts (01-06); de
  //          F8-hotspot als reserve; zuinig (aanhaken via de postbus/brievenbus).
  //  hoofd:  DIT is het eerste netwerk; mDNS werkt; ARTEMIS zonder kabel; grote downloads mogen dit weekend; hotspot als reserve.
  //  hotspot: de reserve zelf -- zuinig, niets groots.
  function regelsVoor(soort) {
    const s = schoonSoort(soort);
    if (s === 'hoofd') return { eersteNetwerk: true, mdns: true, artemisZonderKabel: true, grootVenster: 'weekend', hotspotReserve: true, zuinig: false };
    if (s === 'hotspot') return { eersteNetwerk: false, mdns: false, artemisZonderKabel: false, grootVenster: 'nooit', hotspotReserve: false, zuinig: true };
    return { eersteNetwerk: false, mdns: false, artemisZonderKabel: false, grootVenster: 'nacht', hotspotReserve: true, zuinig: true };
  }

  // Mag een GROOT bestand (een model, een APK) nu gedownload worden, gegeven de plek en de tijd? Een onbekende plek (null)
  // is voorzichtig: ja alleen 's nachts, zoals een gastnetwerk -- je weet niet of je op een zuinige verbinding zit.
  function magGrootNu(plek, datum) {
    const venster = plek ? regelsVoor(plek.soort).grootVenster : 'nacht';
    const d = datum instanceof Date ? datum : new Date(typeof datum === 'number' ? datum : Date.now());
    if (venster === 'weekend') { const dag = d.getDay(); return dag === 6 || dag === 0; }
    if (venster === 'nacht') { const u = d.getHours(); return u >= 1 && u < 6; }
    if (venster === 'nooit') return false;
    return true;
  }

  // Een korte zin voor Veronica/JARVIS: waar de telefoon is en de belangrijkste regel. Nooit zelf een merk- of plaatsnaam
  // verzinnen: de naam komt uit de lokale tabel van de eigenaar (of een neutraal woord als die leeg is).
  function zin(plek) {
    if (!plek) return 'Plek onbekend.';
    const naam = plek.naam || (plek.soort === 'hotspot' ? 'de hotspot' : plek.soort === 'hoofd' ? 'het hoofdwifi' : 'een gastnetwerk');
    const r = regelsVoor(plek.soort);
    if (plek.soort === 'hoofd') return `${naam}: hoofdwifi, geen beperkingen; grote downloads dit weekend.`;
    if (plek.soort === 'hotspot') return `${naam}: reserve (hotspot), zuinig.`;
    return `${naam}: gastnetwerk, zuinig; aanhaken via de postbus, grote downloads 's nachts.`;
  }

  // Alleen het deel dat in een hartslag mag: soort, naam (etiket van de eigenaar) en het /24. Nooit de SSID zelf -- die kan
  // op het hoofdwifi een gezinsnaam dragen, en hij hoeft niet mee.
  function voorHartslag(plek) {
    if (!plek) return null;
    return { soort: schoonSoort(plek.soort), naam: schoon(plek.naam).slice(0, 40), net: schoon(plek.net).slice(0, 15) };
  }

  return { SOORTEN, kiesPlek, regelsVoor, magGrootNu, zin, voorHartslag, schoon };
}));
