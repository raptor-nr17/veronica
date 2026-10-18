// ===================================================================
// 497: OPSLAG OP KAARTJE -- een map op de geheugenkaart van de Chromebook (18 oktober)
// ===================================================================
//
// De eigenaar kiest EEN keer een map op het kaartje (File System Access API). Chrome onthoudt die keuze; de toestemming kan
// verlopen, en dan vraagt Veronica het opnieuw met een tik (een browser vraagt toestemming alleen na een tik).
//
// WAT ER WEL OP MAG: niet-gevoelige gegevens -- het logboek van Veronica, de nachtproef, een overzicht van de telefoons, het
// verbruik en vertalingen van de verhalengids. WAT ER NIET OP MAG: de privé-hoek (Mijn-AI), wachtwoorden, codes, tokens,
// ondertekende adressen, het ntfy-onderwerp. Elke schrijfactie gaat langs controleer(): een onbekende soort, een tekst met een
// geheim of een exacte waarde uit de lijst `verboden` (de koppelcode, het onderwerp, het postbus-adres) wordt geweigerd.
// Wat nodig is voor snelheid blijft op de Chromebook zelf; het kaartje is alleen een plek voor kopieën en exports.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Kaartje = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SOORTEN = Object.freeze(['logboek', 'nachtproef', 'overzicht', 'verbruik', 'vertalingen', 'export']);
  const MAP = 'veronica';
  const MAX_BYTES = 50 * 1024 * 1024;
  // Een geheim herken je aan zijn veldnaam of zijn vorm. Liever een export te veel geweigerd dan een sleutel op een kaartje.
  const GEHEIM_RE = /X-Amz-(Signature|Credential)|\bBearer\s|"(code|koppelcode|sleutel|token|wachtwoord|password|geheim|onderwerp|ntfy|priveSleutel|rijCode)"\s*:|LRWERK1\s/i;
  const NAAM_RE = /^veronica-(logboek|nachtproef|overzicht|verbruik|vertalingen|export)-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;

  function bestandsnaam(soort, nu) {
    const d = new Date(Number.isFinite(nu) ? nu : Date.now());
    const p = (n) => String(n).padStart(2, '0');
    return `veronica-${soort}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
  }
  // { ok, fout } -- de ENE poort voor alles wat naar het kaartje gaat.
  function controleer(soort, tekst, verboden) {
    if (!SOORTEN.includes(soort)) return { ok: false, fout: 'soort' };
    if (typeof tekst !== 'string' || !tekst) return { ok: false, fout: 'leeg' };
    if (tekst.length > MAX_BYTES) return { ok: false, fout: 'te-groot' };
    if (GEHEIM_RE.test(tekst)) return { ok: false, fout: 'geheim' };
    for (const v of Array.isArray(verboden) ? verboden : []) if (typeof v === 'string' && v.length >= 4 && tekst.includes(v)) return { ok: false, fout: 'geheim' };
    return { ok: true };
  }
  const FOUTZIN = Object.freeze({
    soort: 'Dit soort gegevens gaat niet naar het kaartje.',
    leeg: 'Er is niets om te bewaren.',
    'te-groot': 'Dit is te groot voor een bestand (meer dan 50 MB).',
    geheim: 'Hier staat een code of sleutel in. Die gaat nooit naar het kaartje.',
    'geen-api': 'Deze browser kan geen map kiezen. Gebruik Chrome op de Chromebook.',
    'niet-gekozen': 'Kies eerst een map op het kaartje.',
    'toestemming-nodig': 'Chrome vraagt opnieuw toestemming voor de map. Tik op "Toestemming geven".',
    weg: 'Het kaartje is er niet (eruit gehaald?). Steek het terug en tik op "Kijk opnieuw".',
    'niet-gevonden': 'Dat bestand staat niet (meer) op het kaartje.',
  });
  const STATUSZIN = Object.freeze({
    'geen-api': 'Deze browser kan geen map op het kaartje gebruiken.',
    'niet-gekozen': 'Nog geen map op het kaartje gekozen.',
    'toestemming-nodig': 'Kaartje: toestemming nodig (tik op "Toestemming geven").',
    weg: 'Kaartje niet aanwezig.',
    aanwezig: 'Kaartje aanwezig.',
  });

  // ---- de browser-kant. `omgeving` = { venster, idb } (in de test: nagemaakt).
  function maak(omgeving) {
    const venster = (omgeving && omgeving.venster) || (typeof window !== 'undefined' ? window : null);
    const idb = (omgeving && omgeving.idb) || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    // `opslag` = { lees(), bewaar(h) } voor het handvat; zonder: een eigen IndexedDB (veronica-kaartje), los van de privé-hoek.
    const opslag = omgeving && omgeving.opslag;
    let handvat = null;
    function db() {
      return new Promise((klaar, mis) => {
        const r = idb.open('veronica-kaartje', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('h');
        r.onsuccess = () => klaar(r.result); r.onerror = () => mis(r.error);
      });
    }
    async function bewaarHandvat(h) { if (opslag) return opslag.bewaar(h); const d = await db(); await new Promise((k, m) => { const t = d.transaction('h', 'readwrite'); t.objectStore('h').put(h, 'map'); t.oncomplete = k; t.onerror = () => m(t.error); }); }
    async function leesHandvat() {
      if (handvat) return handvat;
      if (opslag) { handvat = (await opslag.lees()) || null; return handvat; }
      if (!idb) return null;
      const d = await db();
      handvat = await new Promise((k) => { const t = d.transaction('h', 'readonly'); const r = t.objectStore('h').get('map'); r.onsuccess = () => k(r.result || null); r.onerror = () => k(null); });
      return handvat;
    }
    const kanKiezen = () => !!(venster && typeof venster.showDirectoryPicker === 'function' && (idb || opslag));
    async function eigenMap(h) { return h.getDirectoryHandle(MAP, { create: true }); }
    // Status zonder iets te vragen (geen venster): mag ALTIJD, ook in een tik van een timer.
    async function status() {
      if (!kanKiezen()) return 'geen-api';
      const h = await leesHandvat();
      if (!h) return 'niet-gekozen';
      let p = 'prompt';
      try { p = await h.queryPermission({ mode: 'readwrite' }); } catch (e) { p = 'prompt'; }
      if (p !== 'granted') return 'toestemming-nodig';
      try { const m = await eigenMap(h); for await (const x of m.values()) { void x; break; } return 'aanwezig'; } catch (e) { return 'weg'; }
    }
    // Alleen na een tik.
    async function kies() {
      if (!kanKiezen()) return { ok: false, fout: 'geen-api' };
      let h;
      try { h = await venster.showDirectoryPicker({ id: 'veronica-kaartje', mode: 'readwrite' }); } catch (e) { return { ok: false, fout: 'niet-gekozen' }; }
      handvat = h; await bewaarHandvat(h);
      return { ok: true, status: await status() };
    }
    async function vraagToestemming() {
      const h = await leesHandvat();
      if (!h) return { ok: false, fout: 'niet-gekozen' };
      let p = 'denied';
      try { p = await h.requestPermission({ mode: 'readwrite' }); } catch (e) { p = 'denied'; }
      return p === 'granted' ? { ok: true, status: await status() } : { ok: false, fout: 'toestemming-nodig' };
    }
    async function schrijf(soort, gegevens, verboden, nu) {
      const tekst = typeof gegevens === 'string' ? gegevens : JSON.stringify(gegevens, null, 2);
      const c = controleer(soort, tekst, verboden);
      if (!c.ok) return c;
      const st = await status();
      if (st !== 'aanwezig') return { ok: false, fout: st };
      const naam = bestandsnaam(soort, nu);
      try {
        const m = await eigenMap(await leesHandvat());
        const f = await m.getFileHandle(naam, { create: true });
        const w = await f.createWritable();
        await w.write(tekst); await w.close();
        return { ok: true, naam, bytes: tekst.length };
      } catch (e) { return { ok: false, fout: 'weg' }; }
    }
    async function lijst() {
      const st = await status();
      if (st !== 'aanwezig') return { ok: false, fout: st, namen: [] };
      const namen = [];
      try { const m = await eigenMap(await leesHandvat()); for await (const x of m.values()) if (x.kind === 'file' && NAAM_RE.test(x.name)) namen.push(x.name); } catch (e) { return { ok: false, fout: 'weg', namen: [] }; }
      return { ok: true, namen: namen.sort().reverse() };
    }
    async function lees(naam) {
      if (!NAAM_RE.test(String(naam))) return { ok: false, fout: 'niet-gevonden' };
      const st = await status();
      if (st !== 'aanwezig') return { ok: false, fout: st };
      try { const m = await eigenMap(await leesHandvat()); const f = await (await m.getFileHandle(naam)).getFile(); return { ok: true, tekst: await f.text() }; } catch (e) { return { ok: false, fout: 'niet-gevonden' }; }
    }
    return { status, kies, vraagToestemming, schrijf, lijst, lees, kanKiezen };
  }

  return { SOORTEN, MAP, MAX_BYTES, GEHEIM_RE, NAAM_RE, bestandsnaam, controleer, FOUTZIN, STATUSZIN, maak };
}));
