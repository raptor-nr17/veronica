// ===================================================================
// 678 (21 punten, deel van punt 9 / stap 15 "brief"): een brieffoto wordt op de F8 uitgelezen (OCR -> tekst). VÓÓR die tekst
// ergens wordt bewaard, haalt deze PURE sanitizer de gevoeligste nummers eruit: IBAN's (rekeningnummers) en BSN-achtige nummers
// (8-9 cijfers). Geen model, geen netwerk, geen opslag, geen DOM -- alleen tekst in, schonere tekst uit.
//
// PRIVACY-EERST: liever een onschuldig lang getal te veel weggehaald dan een BSN of rekeningnummer in de opslag. Een los getal
// van 8-9 cijfers (ook met punten/spaties als 123.45.678) telt als BSN-achtig en gaat eruit; een jaartal, bedrag, postcode of
// een tiencijferig telefoonnummer blijft staan. De code OORDEELT niet over de inhoud -- het is een zeef, geen lezer.
//
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Briefschoon = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const IBAN_WEG = '«rekeningnummer verwijderd»';
  const NUM_WEG = '«persoonsnummer verwijderd»';
  // IBAN: 2 letters + 2 controlecijfers + 11..30 letters/cijfers, eventueel in groepjes met spaties. NL = NL00 BANK 0123456789.
  const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g;
  // BSN-achtig: een los blok van 8 of 9 cijfers, ook geschreven met punten/spaties (123.45.678 / 12 345 678). Niet midden in een
  // langer cijferblok (dan is het geen los nummer maar bv. een IBAN-rest of een lang kenmerk -- die vangt IBAN of blijft staan).
  const BSN_GEGROEPEERD = /(?<![\d.])\d{3}[ .]\d{2}[ .]\d{3}(?![\d.])/g;        // 9 cijfers in 3-2-3
  const BSN_SOLIDE = /(?<!\d)\d{8,9}(?!\d)/g;                                     // 8-9 cijfers aaneen

  // schoon(tekst): IBAN's en BSN-achtige nummers eruit. IBAN EERST (die bevat ook cijfers), dan de losse nummers.
  function schoon(tekst) {
    let t = String(tekst == null ? '' : tekst);
    t = t.replace(IBAN, IBAN_WEG);
    t = t.replace(BSN_GEGROEPEERD, NUM_WEG);
    t = t.replace(BSN_SOLIDE, NUM_WEG);
    return t;
  }

  // bevatGevoelig(tekst): stond er een IBAN of BSN-achtig nummer in? (handig om te melden dat er iets is weggehaald.)
  function bevatGevoelig(tekst) {
    return schoon(tekst) !== String(tekst == null ? '' : tekst);
  }

  return { IBAN_WEG: IBAN_WEG, NUM_WEG: NUM_WEG, schoon: schoon, bevatGevoelig: bevatGevoelig };
}));
