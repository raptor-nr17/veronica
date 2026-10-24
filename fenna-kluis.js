// ===================================================================
// 551: DE KLUIS VAN FENNA OP HET KAARTJE -- het lange geheugen van de geheugen-telefoon als versleutelde kopie op het kaartje van
// de Chromebook. Rekent en versleutelt; schrijft en leest niets zelf (dat doet veronica.js via kaartje.js).
// ===================================================================
//
// Afspraak met de eigenaar (24 oktober): de geheugen-telefoon is de WERKPLEK, het kaartje is de KLUIS. Een richting: telefoon -> kaartje;
// bij verschil wint de telefoon. Hele bestanden, hoogstens een keer per nacht (geen database met een logbestand op het kaartje).
// Versleuteld met een WACHTWOORD (uit de wachtwoordkluis van de eigenaar): PBKDF2-SHA-256 (600.000 rondes) -> AES-256-GCM. Het
// wachtwoord wordt nergens bewaard; de afgeleide sleutel leeft alleen in het geheugen van dit tabblad. Zo is een kluisbestand ook op
// een andere computer te openen, met alleen het wachtwoord. Elk bestand draagt een MANIFEST met de SHA-256 van elk onderdeel; na het
// schrijven wordt het teruggelezen, geopend en nagerekend. Bewaard: zeven dagelijkse en vier wekelijkse kopieen.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.FennaKluis = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORMAAT = 'veronica-fenna-kluis';
  const ROND = 600000;
  const NAAM_RE = /^fenna-kluis-(\d{4})-(\d{2})-(\d{2})\.vkl$/;
  const DAGEN = 7;
  const WEKEN = 4;
  const sub = () => (typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null);
  const naarB64 = (b) => { let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const vanB64 = (t) => Uint8Array.from(atob(String(t)), (c) => c.charCodeAt(0));
  const hex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
  const dagVan = (nu) => { const d = new Date(nu); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  function naam(nu) { return `fenna-kluis-${dagVan(nu)}.vkl`; }
  async function sha256(tekst) { return hex(await sub().digest('SHA-256', new TextEncoder().encode(String(tekst)))); }

  // De sleutel uit het wachtwoord: een keer per tabblad (met een vers zout), daarna alleen in het geheugen. Niet uitvoerbaar.
  async function sleutel(wachtwoord, zout, rondes) {
    const w = String(wachtwoord || '');
    if (w.length < 8) throw new Error('kort');
    const z = zout || crypto.getRandomValues(new Uint8Array(16));
    const basis = await sub().importKey('raw', new TextEncoder().encode(w), 'PBKDF2', false, ['deriveKey']);
    const k = await sub().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: z, iterations: rondes || ROND }, basis, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { k, zout: z, rondes: rondes || ROND };
  }
  // bestanden = { 'feiten.jsonl': tekst, ... } -> de tekst van een kluisbestand (JSON), met het manifest IN de versleuteling.
  async function sluit(bestanden, sl, nu) {
    const namen = Object.keys(bestanden || {}).sort();
    const manifest = { gemaakt: dagVan(nu), bestanden: [] };
    for (const n of namen) manifest.bestanden.push({ naam: n, bytes: new TextEncoder().encode(bestanden[n]).length, sha256: await sha256(bestanden[n]) });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const inhoud = new TextEncoder().encode(JSON.stringify({ manifest, bestanden }));
    const data = await sub().encrypt({ name: 'AES-GCM', iv }, sl.k, inhoud);
    return JSON.stringify({ formaat: FORMAAT, versie: 1, gemaakt: manifest.gemaakt, kdf: { naam: 'PBKDF2-SHA-256', rondes: sl.rondes, zout: naarB64(sl.zout) },
      versleuteling: { naam: 'AES-256-GCM', iv: naarB64(iv) }, data: naarB64(data) });
  }
  // Openen: met een sleutel (dit tabblad) of met het wachtwoord (een andere computer). -> { manifest, bestanden } of null.
  async function open(tekst, sl, wachtwoord) {
    let b;
    try { b = JSON.parse(String(tekst)); } catch (e) { return null; }
    if (!b || b.formaat !== FORMAAT || !b.kdf || !b.versleuteling) return null;
    try {
      const zout = vanB64(b.kdf.zout);
      const k = sl && sl.zout && naarB64(sl.zout) === b.kdf.zout && sl.rondes === b.kdf.rondes ? sl.k : (await sleutel(wachtwoord, zout, b.kdf.rondes)).k;
      const uit = await sub().decrypt({ name: 'AES-GCM', iv: vanB64(b.versleuteling.iv) }, k, vanB64(b.data));
      const x = JSON.parse(new TextDecoder().decode(uit));
      return x && x.manifest && x.bestanden ? x : null;
    } catch (e) { return null; }
  }
  // Rekent elk onderdeel na tegen het manifest (en tegen wat er geschreven moest worden). -> { ok, fouten: [naam] }
  async function controleer(geopend, verwacht) {
    if (!geopend) return { ok: false, fouten: ['openen'] };
    const fouten = [];
    for (const m of geopend.manifest.bestanden) {
      const t = geopend.bestanden[m.naam];
      if (typeof t !== 'string' || await sha256(t) !== m.sha256) fouten.push(m.naam);
      else if (verwacht && verwacht[m.naam] !== t) fouten.push(m.naam);
    }
    if (verwacht) for (const n of Object.keys(verwacht)) if (!geopend.manifest.bestanden.some((m) => m.naam === n)) fouten.push(n);
    return { ok: !fouten.length, fouten };
  }
  // Welke kluisbestanden blijven: de nieuwste per dag van de laatste zeven dagen met een kopie, en de nieuwste per ISO-week van de
  // vier weken daarvoor. Alleen namen van de vorm fenna-kluis-JJJJ-MM-DD.vkl; al het andere wordt NOOIT aangeraakt.
  function weekVan(j, m, d) {
    const t = new Date(Date.UTC(j, m - 1, d));
    const dag = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dag);
    const jaarBegin = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - jaarBegin) / 86400000 + 1) / 7)).padStart(2, '0')}`;
  }
  function bewaren(namen) {
    const eigen = (Array.isArray(namen) ? namen : []).filter((n) => NAAM_RE.test(n)).sort().reverse();
    const houden = new Set(eigen.slice(0, DAGEN));
    const weken = new Set();
    for (const n of eigen.slice(DAGEN)) {
      const [, j, m, d] = NAAM_RE.exec(n);
      const w = weekVan(+j, +m, +d);
      if (weken.size >= WEKEN || weken.has(w)) continue;
      weken.add(w); houden.add(n);
    }
    return { houden: eigen.filter((n) => houden.has(n)), weg: eigen.filter((n) => !houden.has(n)) };
  }
  function nachtNu(nu, laatsteDag) { const d = new Date(nu); return { nu: d.getHours() >= 3 && d.getHours() < 6 && laatsteDag !== dagVan(nu), dag: dagVan(nu) }; }

  return { FORMAAT, ROND, NAAM_RE, DAGEN, WEKEN, naam, sha256, sleutel, sluit, open, controleer, bewaren, weekVan, nachtNu };
}));
