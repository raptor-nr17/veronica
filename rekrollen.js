// ===================================================================
// 678 (stap 4 "nog te doen"): de rol PER TELEFOON vastleggen en tonen. PUUR rekenen in CODE -- geen model, geen netwerk, geen DOM.
// Dit is de "rollen vastzetten na de meting"-machinerie: de abstracte rol-tabel staat in rollen.js (brein/bibliothecaris/
// verdeler/groot-brein); HIER staat de koppeling TOESTEL-ID -> ROL, net als de SSID->plek-tabel van 570 en de rek-vast-keuze:
//   - LOKAAL in de opslag (sleutel `jarvis-rek-rollen`), NOOIT in de code en nooit in een hartslag/log/ntfy -- een toestel-id is
//     geen merk- of persoonsnaam, maar de KOPPELING is een keuze van de eigenaar en hoort lokaal.
//   - GEMETEN WINT VAN DE GOK: `passend()` kijkt alleen of de KLASSE van de telefoon het model van de rol aankan (via
//     rollen.modelVoor) -- het verzint GEEN tok/s-drempel (dat zou zelf een gok zijn; §678: elke keuze gemeten, niet gegokt). De
//     gemeten tg128 wordt ernaast getoond (`regel`), de eigenaar beslist. Een rol toewijzen die de klasse niet trekt geeft een
//     waarschuwing, geen blokkade.
//   - De module WIJST NIET ZELF TOE. Welke telefoon welke rol krijgt is een ontwerpkeuze (twee breinen, een bibliothecaris, een
//     verdeler; de F8 is het grote brein, alleen thuis) -- geen sortering op snelheid. `zet()` legt de keuze van de eigenaar vast.
// Het TONEN van de rol per telefoon in veronica.js blijft de volgende stap (deze module is er de bron voor, als window.Rekrollen).
//
// Afspraak: geen naam van een persoon/merk/plaats (dit gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  const Rollen = (typeof require === 'function')
    ? require('./rollen.js')
    : (wortel.Rollen || null);
  if (typeof module === 'object' && module.exports) module.exports = fabriek(Rollen);
  else wortel.Rekrollen = fabriek(wortel.Rollen);
}(typeof self !== 'undefined' ? self : this, function (Rollen) {
  'use strict';

  const SLEUTEL = 'jarvis-rek-rollen';

  function namen() { return Rollen && Array.isArray(Rollen.NAMEN) ? Rollen.NAMEN : []; }
  function geldigeRol(rol) { return typeof rol === 'string' && namen().indexOf(rol) !== -1; }

  // lees(ruw): de opgeslagen koppeling toestel-id -> rol, als object. Neemt een JSON-string of een object; gooit onbekende rollen
  // en lege id's eruit (een koppeling naar een rol die niet (meer) bestaat telt niet). Nooit een fout -- een kapotte opslag = {}.
  function lees(ruw) {
    let obj = ruw;
    if (typeof ruw === 'string') { try { obj = JSON.parse(ruw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') return {};
    const uit = {};
    for (const id of Object.keys(obj)) {
      if (id && geldigeRol(obj[id])) uit[String(id)] = obj[id];
    }
    return uit;
  }

  // zet(map, toestelId, rol): leg de rol van EEN telefoon vast (de "lock"). rol leeg/null = de koppeling wissen. Een onbekende rol
  // wordt geweigerd (fout gegooid) -- liever hard dan een rol die nergens op slaat. Puur; nieuwe map.
  function zet(map, toestelId, rol) {
    const id = String(toestelId == null ? '' : toestelId).trim();
    if (!id) throw new Error('zet: een leeg toestel-id');
    const uit = Object.assign({}, lees(map));
    if (rol == null || rol === '') { delete uit[id]; return uit; }
    if (!geldigeRol(rol)) throw new Error('zet: onbekende rol ' + rol + ' (kies uit ' + namen().join('/') + ')');
    uit[id] = rol;
    return uit;
  }

  // rolVan(map, toestelId): de vastgelegde rol van die telefoon, of null.
  function rolVan(map, toestelId) {
    const m = lees(map); const id = String(toestelId == null ? '' : toestelId).trim();
    return (id && m[id]) ? m[id] : null;
  }

  // passend(rol, klasse): kan een telefoon van deze KLASSE (zwaar/midden/licht/te-oud) het model van deze rol draaien? Puur uit
  // rollen.modelVoor -- geen verzonnen tok/s-drempel. Geeft {ok, model, reden, alleenThuis}. Een te-oud toestel of een te lichte
  // telefoon voor het grote brein -> ok:false met de reden; de eigenaar ziet het en kiest.
  function passend(rol, klasse) {
    if (!geldigeRol(rol) || !Rollen) return { ok: false, model: null, reden: 'onbekende rol', alleenThuis: false };
    const mk = Rollen.modelVoor(rol, klasse);
    const r = Rollen.rol(rol);
    return {
      ok: mk.model !== null,
      model: mk.model,
      reden: mk.reden,
      alleenThuis: !!(r && r.alleenThuis),
    };
  }

  // regel(rol, klasse, opties): een menselijke regel om de rol per telefoon te TONEN. Zet de titel (uit rollen.js), het model voor
  // de klasse, en -- als meegegeven -- de GEMETEN tg128 (tok/s). Een niet-passende combinatie krijgt een waarschuwing. Nooit een
  // getal verzinnen: zonder `tps` staat er geen snelheid.
  function regel(rol, klasse, opties) {
    const o = opties || {};
    if (!geldigeRol(rol) || !Rollen) return 'geen rol';
    const b = Rollen.beslis(rol, { klasse: klasse, thuis: o.thuis });
    let s = b.titel;
    if (b.model) s += ' · ' + b.model;
    if (typeof o.tps === 'number' && isFinite(o.tps)) s += ' · ' + o.tps.toFixed(1) + ' tok/s (gemeten)';
    else if (klasse) s += ' · ' + (b.model ? 'nog niet gemeten' : 'geen eigen model');
    if (!passend(rol, klasse).ok && klasse) s += ' — let op: deze telefoon trekt dit model niet';
    if (b.alleenThuis) s += ' — alleen thuis';
    return s;
  }

  return { SLEUTEL: SLEUTEL, geldigeRol: geldigeRol, lees: lees, zet: zet, rolVan: rolVan, passend: passend, regel: regel };
}));
