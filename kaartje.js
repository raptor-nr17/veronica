// ===================================================================
// 497: OPSLAG OP KAARTJE -- een map op de geheugenkaart van de Chromebook (18 oktober)
// ===================================================================
//
// De eigenaar kiest EEN keer een map op het kaartje (File System Access API). Chrome onthoudt die keuze; de toestemming kan
// verlopen, en dan vraagt Veronica het opnieuw met een tik (een browser vraagt toestemming alleen na een tik).
//
// 498 (correctie van de eigenaar): de downloadmap van Chrome blijft zoals hij is; alleen Veronica gebruikt het kaartje. Is het
// kaartje er niet, dan valt alles wat klein is TERUG op het interne geheugen van Veronica (het eigen, private bestandssysteem van de
// browser), met een melding en nooit een fout. Grote dingen (modelbestanden voor de werkers) gaan ALLEEN naar het kaartje: zonder
// kaartje haalt een telefoon zijn model gewoon zelf. De KAST (veronica/kast) is de uitdeelkast voor de telefoons.
// De versleutelde back-up van Mijn-AI mag er WEL op (soort 'backup'), maar alleen in de versleutelde vorm.
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

  const SOORTEN = Object.freeze(['logboek', 'nachtproef', 'overzicht', 'verbruik', 'vertalingen', 'export', 'jarvis-logboek', 'backup']);
  const KAST = 'kast';
  const MAP = 'veronica';
  const MAX_BYTES = 50 * 1024 * 1024;
  // Een geheim herken je aan zijn veldnaam of zijn vorm. Liever een export te veel geweigerd dan een sleutel op een kaartje.
  const GEHEIM_RE = /X-Amz-(Signature|Credential)|\bBearer\s|"(code|koppelcode|sleutel|token|wachtwoord|password|geheim|onderwerp|ntfy|priveSleutel|rijCode)"\s*:|LRWERK1\s/i;
  const NAAM_RE = /^veronica-(logboek|nachtproef|overzicht|verbruik|vertalingen|export|jarvis-logboek|backup)-\d{4}-\d{2}-\d{2}-\d{4}(-\d{1,3})?\.json$/;
  const KAST_NAAM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
  const goedeKastNaam = (n) => typeof n === 'string' && KAST_NAAM_RE.test(n) && !n.includes('..');

  function bestandsnaam(soort, nu, volg) {
    const d = new Date(Number.isFinite(nu) ? nu : Date.now());
    const p = (n) => String(n).padStart(2, '0');
    const v = Number.isInteger(volg) && volg > 0 && volg < 1000 ? `-${volg}` : '';
    return `veronica-${soort}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${v}.json`;
  }
  // { ok, fout } -- de ENE poort voor alles wat naar het kaartje gaat.
  function controleer(soort, tekst, verboden) {
    if (!SOORTEN.includes(soort)) return { ok: false, fout: 'soort' };
    if (typeof tekst !== 'string' || !tekst) return { ok: false, fout: 'leeg' };
    if (tekst.length > MAX_BYTES) return { ok: false, fout: 'te-groot' };
    if (soort === 'backup') {
      // Alleen de VERSLEUTELDE back-up van de privé-hoek (AES-256-GCM, met een wachtwoord dat nergens bewaard wordt).
      let b = null;
      try { b = JSON.parse(tekst); } catch (e) { b = null; }
      const goed = b && b.formaat === 'veronica-prive-hoek' && b.versleuteling && b.versleuteling.naam === 'AES-256-GCM' && typeof b.data === 'string' && Object.keys(b).every((k) => ['formaat', 'versie', 'gemaakt', 'kdf', 'versleuteling', 'data'].includes(k));
      return goed ? { ok: true } : { ok: false, fout: 'niet-versleuteld' };
    }
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
    'niet-versleuteld': 'Van de privé-hoek gaat alleen de versleutelde back-up naar het kaartje.',
    'geen-kaartje': 'Zonder kaartje deel ik geen grote bestanden; de telefoon haalt het zelf.',
  });
  const STATUSZIN = Object.freeze({
    'geen-api': 'Deze browser kan geen map op het kaartje gebruiken.',
    'niet-gekozen': 'Nog geen map op het kaartje gekozen (tot dan bewaar ik intern).',
    'toestemming-nodig': 'Kaartje: toestemming nodig (tik op "Toestemming geven").',
    weg: 'Kaartje niet aanwezig: ik bewaar intern, op de Chromebook zelf.',
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
    // Het interne geheugen: het private bestandssysteem van deze browser (geen toestemming nodig, niet zichtbaar in Bestanden).
    async function internMap() {
      try {
        const nav = (omgeving && omgeving.intern) || (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.getDirectory === 'function' ? navigator.storage : null);
        if (!nav) return null;
        return (await nav.getDirectory()).getDirectoryHandle(MAP, { create: true });
      } catch (e) { return null; }
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
    async function schrijfIn(m, naam, tekst) {
      const f = await m.getFileHandle(naam, { create: true });
      const w = await f.createWritable();
      await w.write(tekst); await w.close();
    }
    // Op het kaartje als het er is; anders INTERN, met een zin. Nooit een fout voor de gebruiker.
    async function schrijf(soort, gegevens, verboden, nu, volg) {
      const tekst = typeof gegevens === 'string' ? gegevens : JSON.stringify(gegevens, null, 2);
      const c = controleer(soort, tekst, verboden);
      if (!c.ok) return c;
      const naam = bestandsnaam(soort, nu, volg);
      const st = await status();
      if (st === 'aanwezig') {
        try { await schrijfIn(await eigenMap(await leesHandvat()), naam, tekst); return { ok: true, naam, bytes: tekst.length, plek: 'kaartje' }; } catch (e) { /* eruit gehaald: intern */ }
      }
      const im = await internMap();
      if (!im) return { ok: false, fout: st === 'aanwezig' ? 'weg' : st };
      try { await schrijfIn(im, naam, tekst); } catch (e) { return { ok: false, fout: 'weg' }; }
      return { ok: true, naam, bytes: tekst.length, plek: 'intern', zin: st === 'aanwezig' ? STATUSZIN.weg : (STATUSZIN[st] || '') };
    }
    // ---- DE KAST (grote bestanden voor de telefoons). ALLEEN op het kaartje.
    async function kastMap() { return (await eigenMap(await leesHandvat())).getDirectoryHandle(KAST, { create: true }); }
    async function kastHeeft(naam, bytes) {
      if (!goedeKastNaam(naam) || await status() !== 'aanwezig') return false;
      try { const f = await (await (await kastMap()).getFileHandle(naam)).getFile(); return f.size === bytes; } catch (e) { return false; }
    }
    async function kastBestand(naam) {
      if (!goedeKastNaam(naam) || await status() !== 'aanwezig') return null;
      try { return await (await (await kastMap()).getFileHandle(naam)).getFile(); } catch (e) { return null; }
    }
    // Een stroom (het antwoord van een telefoon) op het kaartje; een half bestand gaat weer weg.
    async function kastSchrijfStroom(naam, stroom, bytes) {
      if (!goedeKastNaam(naam)) return { ok: false, fout: 'niet-gevonden' };
      if (await status() !== 'aanwezig') return { ok: false, fout: 'geen-kaartje' };
      const m = await kastMap();
      let geschreven = 0;
      try {
        const w = await (await m.getFileHandle(naam, { create: true })).createWritable();
        const rd = stroom.getReader();
        for (;;) { const { done, value } = await rd.read(); if (done) break; geschreven += value.byteLength; await w.write(value); }
        await w.close();
      } catch (e) { geschreven = -1; }
      if (geschreven !== bytes) { try { await m.removeEntry(naam); } catch (e) { /* al weg */ } return { ok: false, fout: 'weg' }; }
      return { ok: true, naam, bytes };
    }
    async function telMap(m) {
      let bytes = 0, n = 0;
      if (!m) return { bytes, n };
      for await (const x of m.values()) {
        if (x.kind === 'file') { try { bytes += (await x.getFile()).size; n += 1; } catch (e) { /* overslaan */ } }
        else if (x.kind === 'directory') { const d = await telMap(x); bytes += d.bytes; n += d.n; }
      }
      return { bytes, n };
    }
    // Hoeveel er op het kaartje staat (en dus NIET op de Chromebook zelf), en hoeveel intern als terugval.
    async function ruimte() {
      const st = await status();
      let kaartje = { bytes: 0, n: 0 }, intern = { bytes: 0, n: 0 };
      if (st === 'aanwezig') { try { kaartje = await telMap(await eigenMap(await leesHandvat())); } catch (e) { /* weg */ } }
      try { intern = await telMap(await internMap()); } catch (e) { /* geen */ }
      return { status: st, kaartje, intern };
    }
    async function lijst() {
      const st = await status();
      if (st !== 'aanwezig') {
        const im = await internMap(); const namen = [];
        try { if (im) for await (const x of im.values()) if (x.kind === 'file' && NAAM_RE.test(x.name)) namen.push(x.name); } catch (e) { /* geen */ }
        return { ok: false, fout: st, namen: namen.sort().reverse(), plek: 'intern' };
      }
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
    // 522: TERUG NAAR HET KAARTJE. Wat intern belandde toen het kaartje er niet was, gaat er vanzelf heen zodra het terug is:
    // eerst schrijven en teruglezen (zelfde lengte), pas dan intern wissen. Staat er op het kaartje al een bestand met die naam,
    // dan blijft dat staan en gaat alleen de interne kopie weg. Alleen bestanden met onze eigen naamvorm, en weer langs controleer().
    async function verhuisIntern() {
      if (await status() !== 'aanwezig') return { verhuisd: 0 };
      const im = await internMap();
      if (!im) return { verhuisd: 0 };
      let km;
      try { km = await eigenMap(await leesHandvat()); } catch (e) { return { verhuisd: 0 }; }
      const namen = [];
      try { for await (const x of im.values()) if (x.kind === 'file' && NAAM_RE.test(x.name)) namen.push(x.name); } catch (e) { return { verhuisd: 0 }; }
      let verhuisd = 0;
      for (const n of namen) {
        try {
          const tekst = await (await (await im.getFileHandle(n)).getFile()).text();
          if (!controleer(n.match(NAAM_RE)[1], tekst, []).ok) continue;
          let al = null;
          try { al = await (await (await km.getFileHandle(n)).getFile()).text(); } catch (e) { al = null; }
          if (al === null) {
            await schrijfIn(km, n, tekst);
            const terug = await (await (await km.getFileHandle(n)).getFile()).text();
            if (terug.length !== tekst.length) continue;
          }
          await im.removeEntry(n);
          verhuisd += 1;
        } catch (e) { /* het kaartje ging weer weg: de volgende keer */ }
      }
      return { verhuisd };
    }
    return { status, kies, vraagToestemming, schrijf, lijst, lees, kanKiezen, kastHeeft, kastBestand, kastSchrijfStroom, ruimte, verhuisIntern };
  }

  // Bytes in gewone taal.
  function grootte(b) {
    const n = Number(b) || 0;
    if (n >= 1e9) return `${String(Math.round(n / 1e8) / 10).replace('.', ',')} GB`;
    if (n >= 1e6) return `${String(Math.round(n / 1e5) / 10).replace('.', ',')} MB`;
    if (n >= 1e3) return `${Math.round(n / 1e3)} kB`;
    return `${n} bytes`;
  }
  function ruimteZin(r) {
    if (!r) return '';
    const k = r.kaartje, i = r.intern;
    const delen = [];
    if (r.status === 'aanwezig') delen.push(`Op het kaartje: ${grootte(k.bytes)} in ${k.n} ${k.n === 1 ? 'bestand' : 'bestanden'}. Dat staat dus niet op de Chromebook zelf.`);
    if (i.n) delen.push(`Intern (terugval): ${grootte(i.bytes)} in ${i.n} ${i.n === 1 ? 'bestand' : 'bestanden'}.`);
    return delen.join(' ') || 'Er staat nog niets.';
  }
  return { SOORTEN, MAP, KAST, grootte, ruimteZin, goedeKastNaam, MAX_BYTES, GEHEIM_RE, NAAM_RE, bestandsnaam, controleer, FOUTZIN, STATUSZIN, maak };
}));
