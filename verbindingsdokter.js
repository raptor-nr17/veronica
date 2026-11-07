// ===================================================================
// 662: DE VERBINDINGSDOKTER. Draait altijd thuis (de leider / de Chromebook-kant). Geen scherm, geen netwerk, geen opslag -- alleen de
// REGELS. veronica.js laat hem elke minuut per telefoon kijken, voert de vaste oplossingen uit met de BESTAANDE roepen/herstel-functies,
// schrijft elke oplossing in het kennisboek, en toont de eigenaar ALLEEN nog één duidelijke Nederlandse regel als er echt een tik of kabel
// van hem nodig is. Het lokale model wordt alleen gebruikt om een ONBEKENDE melding uit te leggen -- niet om te beslissen.
//
// Wens van de eigenaar (7 november): "ik word heel moe van het connectie-verhaal." Daarom: de dokter lost bekende dingen zelf op en valt
// de eigenaar alleen lastig als het niet anders kan, met precies: welke telefoon, welke knop.
//
// diagnose(telefoon, context) -> lijst problemen, elk: { code, ernst ('auto'|'mens'|'uitleg'), fix (een vaste-regel-id, bij 'auto'),
//   mensRegel (één duidelijke zin, bij 'mens'), melding (de ruwe tekst, bij 'uitleg') }.
// telefoon: { id, naam, adres, versHart, direct, versie, rolGemeld, rolGewenst, postbusOk, adbOk, dagelijks, vastWerker, melding }.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.VerbindingsDokter = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // De vaste oplossingen (de leider voert ze uit met bestaande functies; hier alleen het id + wat het in het kennisboek schrijft).
  const FIXES = Object.freeze({
    'postbus-opnieuw': 'postbus opnieuw gekoppeld (vers adres via de brievenbus)',
    'herstelzoek': 'de telefoons opnieuw gezocht na een wifi-wissel',
    'rij-code-herstellen': 'de oude rij-code teruggezet',
    'adb-opnieuw': 'adb opnieuw verbonden (poort 5555)',
    'bijwerken-klaarzetten': 'een nieuwe versie klaargezet om bij te werken',
    'rol-rechtzetten': 'de rol rechtgezet (werker/beheerder)',
  });

  const laag = (s) => String(s == null ? '' : s).toLowerCase();
  // Een mobiel-data-adres (10.x of een carrier-net) in plaats van het thuis-wifi (192.168.x / 10.0.0.x van een thuisrouter).
  function mobielAdres(adres) {
    const m = /(\d+)\.(\d+)\.(\d+)\.(\d+)/.exec(String(adres || ''));
    if (!m) return false;
    const a = Number(m[1]), b = Number(m[2]);
    if (a === 192 && b === 168) return false;            // thuis-wifi
    if (a === 10 && (b === 0)) return false;              // veel thuisrouters: 10.0.0.x
    if (a === 100 && b >= 64 && b <= 127) return true;    // CGNAT (mobiel)
    if (a === 10) return true;                            // ander 10.x = vaak mobiel/gast
    return false;
  }

  function ouderDan(versie, nieuwste) {
    if (!versie || !nieuwste) return false;
    const p = (v) => String(v).split('.').map((x) => Number(x) || 0);
    const a = p(versie), b = p(nieuwste);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) { if ((a[i] || 0) < (b[i] || 0)) return true; if ((a[i] || 0) > (b[i] || 0)) return false; }
    return false;
  }

  function diagnose(telefoon, context) {
    const t = telefoon || {}; const c = context || {};
    const uit = [];
    const naam = t.naam || t.id || 'een telefoon';

    // 1. Helemaal stil EN niet direct bereikbaar: eerst de bekende, zelf-oplosbare oorzaken; pas als die er niet zijn, een mensregel.
    if (!t.versHart && !t.direct) {
      if (t.adres && mobielAdres(t.adres)) uit.push({ code: 'mobiel-adres', ernst: 'auto', fix: 'postbus-herkoppelen' in FIXES ? 'postbus-herkoppelen' : 'postbus-opnieuw' });
      else if (c.wifiGewisseld) uit.push({ code: 'wifi-gewisseld', ernst: 'auto', fix: 'herstelzoek' });
      else if (t.postbusOk === false) uit.push({ code: 'postbus-stuk', ernst: 'auto', fix: 'postbus-opnieuw' });
      else uit.push({ code: 'stil', ernst: 'mens', mensRegel: `${naam} geeft geen teken van leven. Kijk of hij aan staat en op het wifi zit; sluit hem anders even met de kabel aan.` });
      return uit;   // als hij stil is, eerst dát oplossen; de rest heeft nu geen zin
    }

    // 2. Mobiel adres terwijl hij wél een hartslag geeft: via de brievenbus herkoppelen zodat het thuis-wifi-adres terugkomt.
    if (t.adres && mobielAdres(t.adres)) uit.push({ code: 'mobiel-adres', ernst: 'auto', fix: 'postbus-opnieuw' });
    // 3. Postbus stuk.
    if (t.postbusOk === false) uit.push({ code: 'postbus-stuk', ernst: 'auto', fix: 'postbus-opnieuw' });
    // 4. Oude rij-code (de telefoon hoort bij een oude code): herstellen.
    if (t.oudeRijCode === true) uit.push({ code: 'oude-rij-code', ernst: 'auto', fix: 'rij-code-herstellen' });
    // 5. adb niet bereikbaar (voor de schermen/ARTEMIS): opnieuw verbinden.
    if (t.adbOk === false) uit.push({ code: 'adb-weg', ernst: 'auto', fix: 'adb-opnieuw' });
    // 6. Oude versie: bijwerken klaarzetten (stil; geen tik nodig zolang de keten loopt).
    if (ouderDan(t.versie, c.nieuwste)) uit.push({ code: 'oude-versie', ernst: 'auto', fix: 'bijwerken-klaarzetten' });
    // 7. Rol verkeerd: een vaste werker die als beheerder staat, of de dagelijkse telefoon die als werker staat.
    if (t.rolGemeld && t.rolGewenst && laag(t.rolGemeld) !== laag(t.rolGewenst)) uit.push({ code: 'rol-verkeerd', ernst: 'auto', fix: 'rol-rechtzetten' });
    // 8. Een melding die de dokter niet kent: laat het lokale model hem uitleggen (beslist niets).
    if (t.melding && !uit.length) uit.push({ code: 'onbekend', ernst: 'uitleg', melding: String(t.melding).slice(0, 400) });

    return uit;
  }

  // De kennisboek-regel voor een uitgevoerde fix.
  function kennisregel(naam, fix, tijd) {
    const wat = FIXES[fix] || fix;
    return { tijd: tijd || null, telefoon: naam || 'een telefoon', fix, zin: `${naam || 'Een telefoon'}: ${wat}.` };
  }

  // EEN regel voor de eigenaar. Volgorde:
  //  1. Is er een mensregel (een telefoon die ECHT een tik/kabel vraagt): die, de dringendste eerst, met het aantal erbij.
  //  2. Geen mensregel, maar NIETS is bereikbaar terwijl er wél telefoons gekoppeld zijn (context.gekoppeld>0 && context.bereikbaar===0):
  //     dan zwijgt de dokter NIET -- anders staat de eigenaar na een verhuizing naar een leeg scherm te kijken zonder te weten wat
  //     er aan de hand is (de per-telefoon-mensregels zijn er niet, want een telefoon die al lang weg is telt niet als "recent
  //     levend" en nagt dus niet apart). Net gewisseld van wifi -> geruststellend "ik zoek ze opnieuw"; anders -> "staan ze aan?".
  //  3. Anders leeg (de dokter heeft alles zelf gedaan). De 'uitleg'-regels komen apart (van het model), niet hier.
  function eenRegelVoorEigenaar(perTelefoon, context) {
    const c = context || {};
    const mens = [];
    for (const p of (Array.isArray(perTelefoon) ? perTelefoon : [])) for (const d of (p.problemen || [])) if (d.ernst === 'mens' && d.mensRegel) mens.push(d.mensRegel);
    if (mens.length) return mens.length === 1 ? mens[0] : `${mens[0]} (en nog ${mens.length - 1} ${mens.length - 1 === 1 ? 'telefoon' : 'telefoons'} die aandacht vragen)`;
    if ((c.gekoppeld || 0) > 0 && (c.bereikbaar || 0) === 0) {
      // Eerst eerlijk zijn als IK zelf niet kan horen: de brievenbus en de relay lopen allebei over het geheime ntfy-onderwerp, los
      // van het wifi. Mist dat onderwerp, of staat "Vol lokaal" aan, dan hoor ik de telefoons op GEEN enkel netwerk -- dan helpt
      // "open JARVIS" niet en moet de eigenaar dát eerst rechtzetten.
      if (c.luisterReden === 'vol-lokaal') return '"Vol lokaal" staat aan, dus ik mag niet naar buiten en hoor de telefoons niet (ook niet via de relay). Zet "Vol lokaal" uit.';
      if (c.luisterReden === 'geen-onderwerp') return 'Ik ben nog niet aan de rij gekoppeld (geen brievenbus), dus ik hoor de telefoons op geen enkel netwerk. Scan de koppelcode opnieuw met de baas-telefoon.';
      if (c.wifiGewisseld) return 'Je zit op een nieuw wifi. Ik zoek de telefoons nu zelf opnieuw -- zet ze aan op dit wifi en open JARVIS; binnen een paar minuten verschijnen ze hier.';
      return 'Geen van de telefoons geeft nu teken van leven. Kijk of ze aan staan en op dit wifi zitten en open JARVIS; ik blijf ze zelf opnieuw zoeken (ook via de relay en de brievenbus).';
    }
    return '';
  }

  return { FIXES, mobielAdres, ouderDan, diagnose, kennisregel, eenRegelVoorEigenaar };
}));
