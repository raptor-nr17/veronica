// ===================================================================
// 500 (18 oktober): DE HARTSLAG EN DE ROEP VIA DE BRIEVENBUS -- byte-gelijk in JARVIS (www/) en Veronica (tools/veronica/)
// ===================================================================
//
// Wat het oplost: Veronica (een https-pagina op de Chromebook) kon de telefoons alleen over het eigen wifi bereiken. Zit de
// Chromebook op een ander net (een gastnetwerk houdt toestellen uit elkaar), of kreeg een telefoon een nieuw adres, dan zag
// Veronica "geen antwoord" en wist niet waarom. Nu:
//  - HARTSLAG: elke telefoon legt hoogstens eens per tien minuten (bij een verandering) en anders eens per uur een korte,
//    versleutelde regel op ntfy.sh: versie, adres op het wifi, rol, eigen motor (aan, model binnen, tempo), accu en warmte.
//    Zo weet Veronica OOK zonder wifi wanneer elke telefoon voor het laatst leefde en waarom hij niet antwoordt.
//  - ROEP: kan Veronica een telefoon niet over het wifi bereiken, dan legt ze de opdracht (dezelfde soorten als
//    /jarvis/roep) versleuteld op ntfy; de telefoon haalt hem zelf op (eens per minuut) en verwerkt hem op precies dezelfde
//    manier, NA dezelfde controle op de koppelcode.
// Geen server van ons: het onderwerp en de sleutel zijn een hash van het GEHEIME ntfy-onderwerp van de rij (jv + 30 tekens,
// zoals de ledenbrief van 482), nooit van de code van zes cijfers. Een roep draagt bovendien de koppelcode (binnen de
// versleuteling), een tijd (hoogstens vijftien minuten oud) en een eenmalig nummer: een oude roep opnieuw afspelen doet niets.
// ntfy.sh telt berichten per huis (een publiek IP): daarom geen hartslag per minuut.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Hartslag = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SERVER = 'https://ntfy.sh';
  const ONDERWERP_RE = /^jv[a-z0-9]{30}$/;
  const ID_RE = /^[a-z0-9]{12,40}$/;
  const IP_RE = /^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/;
  const MIN_MS = 10 * 60 * 1000;      // bij een verandering hoogstens zo vaak
  const VERS_MS = 60 * 60 * 1000;     // zonder verandering toch eens per uur
  const ROEP_GELDIG_MS = 15 * 60 * 1000;
  // Soorten die naar ALLE telefoons mogen (naar: '*'); de rest moet een toestel bij naam (id) noemen.
  const VOOR_IEDEREEN = ['roep', 'zelftest'];

  const tekstBytes = (t) => new TextEncoder().encode(t);
  const naarHex = (b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
  const hexNaar = (h) => new Uint8Array(String(h).match(/../g).map((x) => parseInt(x, 16)));
  const cryptoNu = (c) => c || (typeof crypto !== 'undefined' ? crypto : null);
  const schoon = (t, n) => String(t === null || t === undefined ? '' : t).replace(/[^\p{L}\p{N} .,:%()·_/-]/gu, '').slice(0, n);
  const getal = (x, min, max) => (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : null);

  async function onderwerp(o, soort, c) {
    if (!ONDERWERP_RE.test(String(o || ''))) return null;
    const voor = soort === 'roep' ? 'veronica-roep:' : 'veronica-hartslag:';
    return (soort === 'roep' ? 'vr' : 'vh') + naarHex(await cryptoNu(c).subtle.digest('SHA-256', tekstBytes(voor + o))).slice(0, 30);
  }
  async function sleutel(o, soort, gebruik, c) {
    const sub = cryptoNu(c).subtle;
    const raw = await sub.digest('SHA-256', tekstBytes((soort === 'roep' ? 'veronica-roep-sleutel:' : 'veronica-hartslag-sleutel:') + o));
    return sub.importKey('raw', raw, { name: 'AES-GCM' }, false, [gebruik]);
  }
  async function sluit(o, soort, d, c) {
    const iv = new Uint8Array(12);
    cryptoNu(c).getRandomValues(iv);
    const data = await cryptoNu(c).subtle.encrypt({ name: 'AES-GCM', iv }, await sleutel(o, soort, 'encrypt', c), tekstBytes(JSON.stringify(d)));
    return JSON.stringify({ iv: naarHex(iv), data: naarHex(data) });
  }
  async function open(o, soort, regel, c) {
    let m, b;
    try { m = JSON.parse(regel); } catch (e) { return null; }
    if (!m || (m.event && m.event !== 'message') || typeof m.message !== 'string') return null;
    try {
      b = JSON.parse(m.message);
      const tekst = await cryptoNu(c).subtle.decrypt({ name: 'AES-GCM', iv: hexNaar(b.iv) }, await sleutel(o, soort, 'decrypt', c), hexNaar(b.data));
      return { d: JSON.parse(new TextDecoder().decode(tekst)), id: typeof m.id === 'string' ? m.id : null };
    } catch (e) { return null; }
  }

  // ---- De hartslag ----
  // Alleen wat Veronica nodig heeft om te zeggen hoe het met een telefoon gaat. Geen code, geen sleutel, geen model-tekst.
  function schoonHartslag(h) {
    const x = h || {};
    const m = x.motor && typeof x.motor === 'object' ? x.motor : null;
    const p = m && m.proef && typeof m.proef === 'object' ? m.proef : null;
    const i = x.instel && typeof x.instel === 'object' ? x.instel : null;
    return {
      v: 1,
      t: Math.floor(Number(x.t) || 0),
      id: ID_RE.test(String(x.id || '')) ? String(x.id) : '',
      naam: schoon(x.naam, 40),
      rol: x.rol === 'baas' ? 'baas' : 'werker',
      versie: /^\d+\.\d+\.\d+$/.test(String(x.versie || '')) ? String(x.versie) : '',
      adressen: (Array.isArray(x.adressen) ? x.adressen : []).map(String).filter((a) => IP_RE.test(a)).filter((a, i, l) => l.indexOf(a) === i).slice(0, 4),
      poort: Number.isInteger(x.poort) && x.poort > 0 && x.poort < 65536 ? x.poort : 8080,
      dagelijks: x.dagelijks === true,
      sparen: x.sparen === true,
      accu: getal(x.accu, 0, 100),
      laadt: x.laadt === true,
      temp: getal(x.temp, -20, 90),
      motor: m ? {
        aan: m.aan === true,
        fase: schoon(m.fase, 20),
        procent: getal(m.procent, 0, 100),
        klaar: m.klaar === true,
        backend: schoon(m.backend, 10),
        tps: getal(m.tps, 0, 1000),
        teOud: m.teOud === true,
        proef: p ? { ok: p.ok === true, tps: getal(p.tps, 0, 1000), ms: getal(p.ms, 0, 600000), t: Math.floor(Number(p.t) || 0), temp: getal(p.temp, -20, 90), zin: schoon(p.zin, 120) } : null,
      } : null,
      // 501: de motor-instellingen die nu gelden (motorinstel.js), en of de motor draden en temperatuur aannam
      instel: i ? {
        bron: i.bron === 'veronica' ? 'veronica' : 'standaard', model: ['auto', 'E2B', 'E4B'].includes(i.model) ? i.model : 'auto', gpu: i.gpu === true,
        draden: getal(i.draden, 1, 8), context: getal(i.context, 256, 8192), temp: getal(i.temp, 0, 1.5), denk: getal(i.denk, 0, 4096),
        accuMin: getal(i.accuMin, 0, 100), tempMax: getal(i.tempMax, 0, 90), alleenLader: i.alleenLader === true,
        geladen: i.geladen === true, dradenToegepast: i.dradenToegepast === true, temperatuurToegepast: i.temperatuurToegepast === true,
      } : null,
    };
  }
  async function hartslagVerzoek(o, h, c) {
    const topic = await onderwerp(o, 'hartslag', c);
    if (!topic) return null;
    const d = schoonHartslag(h);
    if (!d.id) return null;
    return { method: 'POST', url: SERVER, data: JSON.stringify({ topic, message: await sluit(o, 'hartslag', d, c) }) };
  }
  // Wat er in een hartslag verandert telt (niet de tijd en niet het precieze accuprocent); anders eens per uur.
  function hartslagSleutel(h) {
    const d = schoonHartslag(h);
    const m = d.motor || {};
    const i = d.instel || {};
    return [d.versie, d.rol, d.adressen.join(','), d.dagelijks, d.sparen, d.laadt, m.aan, m.fase, m.klaar, m.proef ? m.proef.t : 0,
      i.bron, i.model, i.gpu, i.draden, i.context, i.temp, i.accuMin, i.tempMax, i.alleenLader, i.geladen, i.dradenToegepast, i.temperatuurToegepast].join('|');
  }
  function hartslagNodig(o) {
    const x = o || {};
    const sinds = (x.nu || 0) - (x.laatstT || 0);
    if (x.sleutel !== x.laatstSleutel) return sinds >= MIN_MS;
    return sinds >= VERS_MS;
  }
  async function leesHartslag(o, regel, c) {
    const r = await open(o, 'hartslag', regel, c);
    if (!r || !r.d || r.d.v !== 1) return null;
    const d = schoonHartslag(r.d);
    return d.id && d.t ? d : null;
  }

  // ---- De roep ----
  // { naar: <toestel-id> of '*', soort, ...velden }. De code reist mee BINNEN de versleuteling.
  async function roepVerzoek(o, roep, code, nu, c) {
    const topic = await onderwerp(o, 'roep', c);
    if (!topic || !/^\d{6}$/.test(String(code || '')) || !roep || typeof roep.soort !== 'string') return null;
    const naar = roep.naar === '*' ? '*' : (ID_RE.test(String(roep.naar || '')) ? String(roep.naar) : null);
    if (!naar || (naar === '*' && !VOOR_IEDEREEN.includes(roep.soort))) return null;
    const n = new Uint8Array(8);
    cryptoNu(c).getRandomValues(n);
    const d = Object.assign({}, roep, { naar, code: String(code), t: Math.floor(nu), n: naarHex(n), van: 'veronica' });
    const tekst = JSON.stringify(d);
    if (tekst.length > 2048) return null;   // zelfde grens als /jarvis/roep
    return { method: 'POST', url: SERVER, data: JSON.stringify({ topic, message: await sluit(o, 'roep', d, c) }) };
  }
  // Een regel van ntfy -> de roep (ZONDER code, als tekst zoals /jarvis/roep hem geeft), of null. `gezien` is een Set van
  // eenmalige nummers die deze telefoon al deed.
  async function leesRoep(o, regel, x, c) {
    const r = await open(o, 'roep', regel, c);
    const d = r && r.d;
    if (!d || typeof d !== 'object' || typeof d.soort !== 'string') return null;
    if (!/^\d{6}$/.test(String(x.code || '')) || String(d.code) !== String(x.code)) return null;
    if (!(d.naar === x.id || (d.naar === '*' && VOOR_IEDEREEN.includes(d.soort)))) return null;
    const t = Number(d.t) || 0;
    if (Math.abs((x.nu || 0) - t) > ROEP_GELDIG_MS) return null;
    if (!/^[0-9a-f]{16}$/.test(String(d.n || '')) || (x.gezien && x.gezien.has(d.n))) return null;
    if (x.gezien) x.gezien.add(d.n);
    const uit = Object.assign({}, d);
    delete uit.code; delete uit.naar; delete uit.n; delete uit.t;
    uit.van = 'veronica';
    return JSON.stringify(uit);
  }

  // Ophalen (de telefoon, eens per minuut) en luisteren (Veronica, een doorlopende verbinding).
  function pollUrl(topic, sinds) { return `${SERVER}/${topic}/json?poll=1&since=${encodeURIComponent(String(sinds || '15m'))}`; }

  // ---- De diagnose in gewone taal (Veronica) ----
  // h = de laatste hartslag of null; wifi = { antwoordt: true/false/null }; nuMs.
  function minutenZin(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 2) return 'net';
    if (m < 90) return `${m} minuten geleden`;
    const u = Math.round(m / 60);
    return u < 48 ? `${u} uur geleden` : `${Math.round(u / 24)} dagen geleden`;
  }
  function diagnose(h, wifi, nuMs) {
    const w = wifi || {};
    if (!h) {
      if (w.antwoordt === true) return 'Antwoordt over het wifi. (Nog geen hartslag via de brievenbus: dat kan pas vanaf JARVIS 1.9.46.)';
      return 'Nog geen hartslag via de brievenbus. Draait JARVIS op deze telefoon (en is hij bijgewerkt naar 1.9.46)? Open JARVIS een keer.';
    }
    const oud = nuMs - h.t;
    const delen = [`Laatst gezien ${minutenZin(oud)}`, h.versie ? `JARVIS ${h.versie}` : null, h.adressen.length ? `adres ${h.adressen[0]}` : null].filter(Boolean);
    let waarom = '';
    if (oud > 3 * VERS_MS) waarom = 'Al lang geen hartslag: staat de telefoon uit, of is JARVIS dicht? Open JARVIS een keer.';
    // 503: een gastnetwerk houdt toestellen uit elkaar; dat is GEEN fout. De brievenbus is de hoofdweg, het wifi een bonus.
    else if (w.antwoordt === false) waarom = 'Geen directe wifi-verbinding (op een gastnetwerk zien toestellen elkaar niet; dat is goed zo). Opdrachten en de hartslag gaan via de brievenbus.';
    return `${delen.join(' · ')}.${waarom ? ` ${waarom}` : ''}`;
  }
  // Motor en model in een regel (Veronica): "motor aan · model binnen · 4,2 tokens/s · 31 °C".
  function motorZin(h) {
    const m = h && h.motor;
    if (!m) return 'eigen motor: onbekend';
    if (m.teOud) return 'te oud voor de eigen motor';
    const delen = [m.aan ? 'motor aan' : 'motor uit'];
    // 505: per fase een zin, zodat je ziet waar hij op wacht (de reden zelf reist niet mee in de hartslag).
    if (m.klaar) delen.push(`model binnen${m.backend ? ` (${m.backend})` : ''}`);
    else if (m.fase === 'downloaden') delen.push(`model ophalen: ${m.procent || 0}%`);
    else if (m.fase === 'zoeken') delen.push('zoekt het model op');
    else if (m.fase === 'laden') delen.push('model wordt geladen');
    else if (m.fase === 'gepauzeerd') delen.push('gepauzeerd');
    else if (m.fase === 'fout') delen.push('liep vast (wordt opnieuw geprobeerd)');
    else if (m.aan) delen.push('model nog niet binnen (komt op wifi aan de lader)');
    const p = m.proef;
    if (p && p.ok && p.tps) delen.push(`${String(p.tps).replace('.', ',')} tokens/s`);
    else if (m.tps) delen.push(`${String(m.tps).replace('.', ',')} tokens/s`);
    const temp = p && p.temp !== null && p.temp !== undefined ? p.temp : h.temp;
    if (temp !== null && temp !== undefined) delen.push(`${Math.round(temp)} °C`);
    return delen.join(' · ');
  }

  return { SERVER, MIN_MS, VERS_MS, ROEP_GELDIG_MS, VOOR_IEDEREEN, onderwerp, schoonHartslag, hartslagVerzoek, hartslagSleutel, hartslagNodig, leesHartslag, roepVerzoek, leesRoep, pollUrl, diagnose, motorZin, minutenZin };
}));
