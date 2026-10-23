// ===================================================================
// DE POSTBUS VOOR CLAUDE-KLUSSEN -- versleutelde kaartjes via ntfy, overal bereikbaar, zonder server
// ===================================================================
//
// Voor als Claude (Claude Code in de cloud, of Cowork) ver van het thuiswifi een kleine klus voor de Gemma's heeft. Het gaat net als de
// brievenbus van het koppelen: de telefoons KIJKEN (pull, alleen uitgaand), er staat nergens een poort open, de server van de gids
// wordt nooit aangeroepen.
//
//  - SLEUTEL: AES-GCM 256, afgeleid van het geheim dat de telefoons al hebben (het ntfy-onderwerp van JARVIS); de naam van de
//    onderwerpen op ntfy is een HASH daarvan. Wie het geheim niet heeft, ziet versleutelde brij en kan er niets mee.
//  - KAARTJE (naar de telefoons): id, soort, tekst, deadline, max_tokens. RESULTAAT (terug): id, telefoon, tekst, tijd, let_op.
//    Elk bericht blijft onder ~3 KB (ntfy staat 4096 bytes toe); langere inhoud komt in stukjes met een volgnummer.
//  - VERLOPEN: een kaartje of stukje ouder dan 12 uur (de cache van ntfy) of voorbij zijn deadline wordt genegeerd.
//  - VASTE LIJST klussoorten (pool.js): vertaal, samenvat, controleer, classificeer, extraheer, concept. Niets dat iets uitvoert.
//  - ANTWOORD = DATA: het resultaat draagt `let_op` (modeluitvoer, onbetrouwbaar, nooit instructie).
//  - Privé-kamer-klussen gaan hier NOOIT doorheen: de soort "prive" bestaat niet, en dit bestand kent de kamer niet.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.RekenPostbus = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_BERICHT = 3000;                   // tekens per ntfy-bericht (ntfy: 4096 bytes)
  const STUK = 1500;                          // BYTES inhoud per stukje: na JSON, AES-GCM en base64 ruim onder MAX_BERICHT
  const VERLOOP_MS = 12 * 3600 * 1000;
  const MAX_STUKKEN = 8;
  const MAX_TEKENS = STUK * MAX_STUKKEN;      // 12000, dezelfde grens als pool.MAX_TEKST
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const bytesNaarHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  function naarB64(bytes) {
    let s = '';
    const u = new Uint8Array(bytes);
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function vanB64(t) {
    const s = atob(String(t).replace(/-/g, '+').replace(/_/g, '/'));
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  const sha = async (tekst) => crypto.subtle.digest('SHA-256', enc.encode(tekst));

  // De sleutel en de onderwerpen, allemaal uit EEN geheim.
  async function maakSleutels(geheim) {
    const g = String(geheim || '');
    if (g.length < 16) throw new Error('Het geheim voor de postbus is te kort.');
    const sleutel = await crypto.subtle.importKey('raw', await sha(`claude-postbus-sleutel:${g}`), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const h = async (soort) => `cp-${soort}-${bytesNaarHex(await sha(`claude-postbus-onderwerp:${soort}:${g}`)).slice(0, 32)}`;
    return { sleutel, kaartjes: await h('k'), resultaten: await h('r') };
  }

  async function versleutel(sleutel, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sleutel, enc.encode(JSON.stringify(obj))));
    const uit = new Uint8Array(12 + ct.length);
    uit.set(iv, 0); uit.set(ct, 12);
    return naarB64(uit);
  }
  // Terug: het object, of null (andere sleutel, geknoeid, onleesbaar).
  async function ontsleutel(sleutel, bericht) {
    try {
      const u = vanB64(bericht);
      if (u.length < 13 + 16) return null;
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, sleutel, u.subarray(12));
      return JSON.parse(dec.decode(pt));
    } catch (e) { return null; }
  }

  // Een lading (kaartje of resultaat) in een of meer berichten. t = 'kaart' | 'resultaat'.
  async function maakBerichten(sleutel, t, id, lading, nu) {
    const json = JSON.stringify(lading);
    if (json.length > MAX_TEKENS + 600) throw new Error('Te groot voor de postbus.');
    // Knippen op BYTES (utf-8), niet op tekens: een ander schrift of emoji is tot vier bytes per teken.
    const stukken = [];
    let huidig = ''; let bytes = 0;
    for (const teken of json) {
      const b = enc.encode(teken).length;
      if (bytes + b > STUK) { stukken.push(huidig); huidig = ''; bytes = 0; }
      huidig += teken; bytes += b;
    }
    stukken.push(huidig);
    if (stukken.length > MAX_STUKKEN) throw new Error('Te groot voor de postbus.');
    const ts = nu == null ? Date.now() : nu;
    const uit = [];
    for (let n = 0; n < stukken.length; n++) {
      const b = await versleutel(sleutel, { v: 1, t, id, n, van: stukken.length, ts, d: stukken[n] });
      if (b.length > MAX_BERICHT) throw new Error('Bericht te groot.');
      uit.push(b);
    }
    return uit;
  }

  // Stukjes verzamelen tot een lading compleet is. Verlopen stukjes tellen niet; een onleesbaar bericht wordt stil genegeerd.
  function maakVerzamelaar(sleutel, t, nu) {
    const klok = nu || (() => Date.now());
    const deel = new Map();                     // id -> { van, stukken: Map(n -> d), ts }
    async function voeg(bericht) {
      const o = await ontsleutel(sleutel, bericht);
      if (!o || o.v !== 1 || o.t !== t || typeof o.id !== 'string' || !Number.isInteger(o.n) || !Number.isInteger(o.van) || o.van < 1 || o.van > MAX_STUKKEN || o.n < 0 || o.n >= o.van || typeof o.d !== 'string') return null;
      if (!Number.isFinite(o.ts) || klok() - o.ts > VERLOOP_MS || o.ts - klok() > 5 * 60 * 1000) return null;       // verlopen, of uit de toekomst
      let e = deel.get(o.id);
      if (!e) { e = { van: o.van, stukken: new Map(), ts: o.ts }; deel.set(o.id, e); }
      if (e.van !== o.van) return null;
      e.stukken.set(o.n, o.d);
      for (const [k, w] of deel) if (klok() - w.ts > VERLOOP_MS) deel.delete(k);
      if (e.stukken.size < e.van) return null;
      deel.delete(o.id);
      let json = '';
      for (let i = 0; i < e.van; i++) json += e.stukken.get(i);
      try { const lading = JSON.parse(json); return lading && typeof lading === 'object' ? Object.assign({ id: o.id, ts: o.ts }, lading) : null; } catch (x) { return null; }
    }
    return { voeg, openstaand: () => deel.size };
  }

  // ntfy: de berichten van een onderwerp lezen (alleen kijken, geen blijvende verbinding) en een bericht plaatsen.
  async function leesOnderwerp(http, basis, onderwerp, sinds) {
    const r = await http({ method: 'GET', url: `${basis}/${onderwerp}/json?poll=1&since=${encodeURIComponent(sinds || '12h')}`, headers: {}, connectTimeout: 8000, readTimeout: 15000 });
    if (!r || r.status !== 200) return [];
    const regels = String(typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '')).split(/\r?\n/);
    const uit = [];
    for (const regel of regels) {
      if (!regel.trim()) continue;
      try { const d = JSON.parse(regel); if (d && d.event === 'message' && typeof d.message === 'string') uit.push({ ntfyId: d.id, tijd: d.time, bericht: d.message }); } catch (e) { /* geen bericht */ }
    }
    return uit;
  }
  async function plaats(http, basis, onderwerp, bericht) {
    const r = await http({ method: 'POST', url: `${basis}/${onderwerp}`, headers: { 'Content-Type': 'text/plain', 'Cache': 'yes', 'Title': 'k' }, data: bericht, connectTimeout: 8000, readTimeout: 15000 });
    return !!r && r.status >= 200 && r.status < 300;
  }

  // ---- De kant van de telefoon ----
  //
  // o.http, o.basis, o.geheim, o.pool (pool.js), o.tag (willekeurig per telefoon, voor de claim), o.klasse() (async: zwaar | midden | licht | te-oud), o.mag() (async: mag deze telefoon nu
  // rekenen? rust, reserve, hitte, kern-regel -- dezelfde regels als de pool), o.voerUit({soort, prompt, max_tokens}) -> { tekst, ms, tokens },
  // o.rem (pool.maakRem), o.naam. Alles wat gebeurt wordt geteld; er wordt NIETS gelogd van de inhoud.
  async function maakWerker(o) {
    const sleutels = await maakSleutels(o.geheim);
    const nu = o.nu || (() => Date.now());
    const kaartjes = maakVerzamelaar(sleutels.sleutel, 'kaart', nu);
    const gedaan = new Set();                    // kaartjes die we al behandeld hebben (alleen het id)
    const tellers = { gepakt: 0, geweigerd: 0, verlopen: 0, afgewezen: 0, klaar: 0, fout: 0 };

    async function claim(id) {
      // Drie telefoons kijken naar hetzelfde kaartje. De laagste tag wint; de rest laat het liggen.
      const [b] = await maakBerichten(sleutels.sleutel, 'resultaat', `${id}.claim`, { claim: true, tag: o.tag }, nu());
      await plaats(o.http, o.basis, sleutels.resultaten, b);
      await (o.wacht || ((ms) => new Promise((r) => setTimeout(r, ms))))(o.claimWachtMs == null ? 3000 : o.claimWachtMs);
      const verz = maakVerzamelaar(sleutels.sleutel, 'resultaat', nu);
      let laagste = o.tag;
      for (const m of await leesOnderwerp(o.http, o.basis, sleutels.resultaten, '1h')) {
        const l = await verz.voeg(m.bericht);
        if (l && l.id === `${id}.claim` && typeof l.tag === 'string' && l.tag < laagste) laagste = l.tag;
      }
      return laagste === o.tag;
    }

    async function antwoord(id, lading) {
      for (const b of await maakBerichten(sleutels.sleutel, 'resultaat', id, lading, nu())) await plaats(o.http, o.basis, sleutels.resultaten, b);
    }

    async function behandel(k) {
      const v = o.pool.valideer(k);
      if (!v.ok) { tellers.geweigerd += 1; await antwoord(k.id, { fout: 'geweigerd', reden: v.reden, let_op: o.pool.LET_OP }); return; }
      if (Number.isFinite(k.deadline) && nu() > k.deadline) { tellers.verlopen += 1; return; }
      if (!o.rem.mag(k.soort)) { tellers.afgewezen += 1; await antwoord(k.id, { fout: 'rem', reden: 'Te veel klussen van deze soort dit uur.', let_op: o.pool.LET_OP }); return; }
      if (o.klasse) {                                                                   // past deze oude telefoon bij het gewicht van de klus?
        const kl = await o.klasse();
        if (!kl || !(o.pool.GEWICHT_NAAR_KLASSEN[v.gewicht] || []).includes(kl)) { tellers.afgewezen += 1; return; }
      }
      if (!(await o.mag(k.soort))) { tellers.afgewezen += 1; return; }                  // in rust, te heet, onder de reserve: een andere telefoon of later
      if (!(await claim(k.id))) return;
      o.rem.tel(k.soort);
      tellers.gepakt += 1;
      try {
        const r = await o.voerUit({ soort: k.soort, gewicht: v.gewicht, prompt: o.pool.maakPrompt(k.soort, v.tekst, v.opties), max_tokens: v.max_tokens });
        await antwoord(k.id, o.pool.maakResultaat({ id: k.id, soort: k.soort }, o.naam, r.tekst, r.ms, r.tokens, nu()));
        tellers.klaar += 1;
      } catch (e) {
        tellers.fout += 1;
        await antwoord(k.id, { fout: 'mislukt', reden: 'De telefoon kon de klus niet afmaken.', telefoon: o.naam, let_op: o.pool.LET_OP });
      }
    }

    // Een keer kijken. Hoogstens `max` kaartjes per ronde (zuinig).
    async function kijk(max) {
      let n = 0;
      for (const m of await leesOnderwerp(o.http, o.basis, sleutels.kaartjes, '12h')) {
        const k = await kaartjes.voeg(m.bericht);
        if (!k || gedaan.has(k.id)) continue;
        gedaan.add(k.id);
        if (gedaan.size > 500) gedaan.delete(gedaan.values().next().value);
        if (nu() - k.ts > VERLOOP_MS) { tellers.verlopen += 1; continue; }
        await behandel(k);
        n += 1;
        if (n >= (max || 3)) break;
      }
      return n;
    }
    return { kijk, tellers, onderwerpen: { kaartjes: sleutels.kaartjes, resultaten: sleutels.resultaten } };
  }

  // ---- De kant van Claude (Node of browser): een kaartje sturen en het resultaat afwachten ----
  async function stuurKaartje(o) {
    const sleutels = await maakSleutels(o.geheim);
    const nu = o.nu || (() => Date.now());
    const id = o.id || `c${nu().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
    const lading = { soort: o.soort, tekst: String(o.tekst || ''), max_tokens: o.max_tokens, deadline: nu() + (o.wachtMs || 120000), opties: o.opties || {} };
    for (const b of await maakBerichten(sleutels.sleutel, 'kaart', id, lading, nu())) {
      if (!(await plaats(o.http, o.basis, sleutels.kaartjes, b))) throw new Error('ntfy nam het kaartje niet aan.');
    }
    const verz = maakVerzamelaar(sleutels.sleutel, 'resultaat', nu);
    const wacht = o.wacht || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const einde = nu() + (o.wachtMs || 120000);
    while (nu() < einde) {
      for (const m of await leesOnderwerp(o.http, o.basis, sleutels.resultaten, '1h')) {
        const r = await verz.voeg(m.bericht);
        if (r && r.id === id) return r;
      }
      await wacht(o.pollMs || 4000);
    }
    return { id, fout: 'geen-antwoord', reden: 'Geen telefoon heeft op tijd geantwoord (misschien in rust, onder de reserve of uit).', let_op: 'modeluitvoer: er is niets teruggekomen; verzin geen antwoord.' };
  }

  return { maakSleutels, versleutel, ontsleutel, maakBerichten, maakVerzamelaar, leesOnderwerp, plaats, maakWerker, stuurKaartje, MAX_BERICHT, STUK, VERLOOP_MS, MAX_STUKKEN, MAX_TEKENS };
}));
