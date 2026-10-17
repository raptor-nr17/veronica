/*
 * 483 (17 oktober): DE NACHTPROEF. Elke vijftien minuten schrijft de baas per telefoon een regel weg: de tijd, de accu (en of
 * hij laadt), de temperatuur en of de eigen motor aan staat. Alleen gemeten waarden; wat niet bekend is, is null (onbekend),
 * nooit nul. Geen naam van de eigenaar, geen inhoud, geen adres: alleen de naam van de telefoon in de rij.
 *
 * De regels staan op de baas (localStorage, hoogstens 48 uur) en gaan mee in stand.json (achter de code), zodat Veronica ze
 * toont en zelf bewaart. Niet in /jarvis/status: die is open op het wifi.
 */
(function (wereld) {
  'use strict';
  const ELKE_MS = 15 * 60 * 1000;
  const MAX_REGELS = 192;          // 48 uur
  const NAAR_VERONICA = 64;        // 16 uur per stand.json; Veronica bewaart zelf langer
  const MAX_TELEFOONS = 12;

  const getal = (x, min, max) => (typeof x === 'number' && isFinite(x) && x >= min && x <= max ? Math.round(x * 10) / 10 : null);
  const MOTOR = ['klaar', 'aan', 'uit'];

  // Een telefoon-regel schoon maken. Wat niet klopt wordt null; een telefoon zonder naam valt weg.
  function schoon(t) {
    if (!t || typeof t !== 'object') return null;
    const naam = String(t.naam || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40);
    if (!naam) return null;
    return {
      naam,
      accu: getal(t.accu, 0, 100),
      laadt: t.laadt === true ? true : t.laadt === false ? false : null,
      temperatuur: getal(t.temperatuur, -20, 90),
      motor: MOTOR.includes(t.motor) ? t.motor : null,
    };
  }
  function schoonRegel(r) {
    if (!r || typeof r !== 'object' || !(Number(r.t) > 0)) return null;
    const tel = (Array.isArray(r.telefoons) ? r.telefoons : []).map(schoon).filter(Boolean).slice(0, MAX_TELEFOONS);
    return { t: Math.round(Number(r.t)), telefoons: tel };
  }
  // Een lijst regels (van de baas, of uit de opslag) schoon, op tijd, zonder dubbele tijden.
  function leesLijst(lijst, max) {
    const per = new Map();
    for (const r of Array.isArray(lijst) ? lijst : []) { const s = schoonRegel(r); if (s) per.set(s.t, s); }
    const uit = Array.from(per.values()).sort((a, b) => a.t - b.t);
    return uit.slice(-(max || MAX_REGELS));
  }

  // De motorstand uit wat een JARVIS over zijn motor meldt (motorKort / /jarvis/status).
  function motorStand(m) {
    if (!m || typeof m !== 'object') return null;
    if (m.klaar === true) return 'klaar';
    if (m.aan === true) return 'aan';
    return 'uit';
  }

  function maak(o) {
    const opslag = (o && o.opslag) || null;
    let regels = [];
    try { regels = leesLijst(JSON.parse((opslag && opslag.lees()) || '[]')); } catch (e) { regels = []; }
    const bewaar = () => { try { if (opslag) opslag.schrijf(JSON.stringify(regels)); } catch (e) { /* vol: volgende keer */ } };
    return {
      // Een regel als het vijftien minuten na de vorige is. Geeft de regel terug, of null.
      tik(nu, telefoons) {
        const laatste = regels.length ? regels[regels.length - 1].t : 0;
        if (nu - laatste < ELKE_MS) return null;
        const r = schoonRegel({ t: nu, telefoons });
        if (!r || !r.telefoons.length) return null;
        regels.push(r);
        if (regels.length > MAX_REGELS) regels = regels.slice(-MAX_REGELS);
        bewaar();
        return r;
      },
      regels: () => regels.slice(),
      voorVeronica: () => regels.slice(-NAAR_VERONICA),
      wis() { regels = []; bewaar(); },
    };
  }

  // Een korte zin per telefoon-regel, voor het scherm.
  function zin(t) {
    const delen = [];
    delen.push(t.accu === null ? 'accu ?' : `${Math.round(t.accu)}%${t.laadt === true ? ' (laadt)' : ''}`);
    delen.push(t.temperatuur === null ? 'temp ?' : `${Math.round(t.temperatuur)} °C`);
    delen.push(t.motor === 'klaar' ? 'motor aan' : t.motor === 'aan' ? 'motor start' : t.motor === 'uit' ? 'motor uit' : 'motor ?');
    return delen.join(', ');
  }

  const uit = { ELKE_MS, MAX_REGELS, NAAR_VERONICA, maak, leesLijst, schoonRegel, motorStand, zin };
  if (typeof module !== 'undefined' && module.exports) module.exports = uit;
  else wereld.Nachtlog = uit;
})(typeof window !== 'undefined' ? window : globalThis);
