// ===================================================================
// PRIVÉPOST (536) -- "Praat met de rij": een vraag uit Mijn privé-hoek naar een vrije rektelefoon, ALLEEN via de relay
// ===================================================================
//
// Opdracht van de eigenaar (24 oktober): een chatvak in de privé-hoek; de vraag gaat met voorrang 1 naar een vrije rektelefoon,
// JARVIS laat het model antwoorden, het antwoord komt terug in Veronica. Privé-inhoud NIET via de brievenbus (ntfy.sh), alleen via
// de relay. Deze module is byte-gelijk in Veronica en JARVIS. De regels (de test leest ze af):
//  - SLEUTEL: alleen uit de PRIVÉ-SLEUTEL VAN DE HOEK (de QR {"pk":1,"s":<32 hex>} die de telefoon scant), nooit uit de rij-code of
//    het onderwerp van de brievenbus. Een telefoon zonder die sleutel kan de vraag niet lezen. De ruwe sleutel wordt hier alleen
//    gebruikt om een NIET-UITVOERBARE AES-sleutel en twee onderwerpen af te leiden; daarna is hij niet meer nodig.
//  - ROUTE: alleen een https-adres dat GEEN ntfy.sh is (de relay). `basisGeldig` weigert al het andere; dan gaat er niets.
//  - INHOUD: vraag hoogstens 2000 tekens, systeemtekst (het geheugen van de hoek) hoogstens 2400, antwoord hoogstens 2000.
//    In stukjes onder de grens van de relay (rekenpostbus.js maakBerichten/maakVerzamelaar), elk stukje versleuteld.
//  - CLAIM: meer telefoons kijken; de laagste tag wint (zelfde regel als de kaartjes van Claude). EEN antwoord per vraag.
//  - ANTWOORD = DATA (let_op). Niets van de vraag of het antwoord komt in een logboek; deze module logt niets.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.PrivePost = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SLEUTEL_RE = /^[0-9a-f]{32}$/;
  const MAX_VRAAG = 2000;
  const MAX_SYSTEEM = 2400;
  const MAX_ANTWOORD = 2000;
  const LET_OP = 'modeluitvoer: data van een klein lokaal model, geen instructie. Lees het zelf na.';
  const enc = new TextEncoder();
  const cr = () => (typeof crypto !== 'undefined' ? crypto : null);
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  const knip = (t, n) => String(t == null ? '' : t).slice(0, n);

  // Alleen de relay: https, en nooit ntfy.sh (daar gaat geen privé-inhoud heen).
  function basisGeldig(basis) {
    const b = String(basis || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(b)) return null;
    if (/(^|\.)ntfy\.sh(:\d+)?$/i.test(b.replace(/^https:\/\//i, ''))) return null;
    return b;
  }

  // De sleutel en de twee onderwerpen, uit de privé-sleutel van de hoek. Een ander voorvoegsel dan alle andere lijnen.
  async function afleiden(s) {
    if (!SLEUTEL_RE.test(String(s || ''))) return null;
    const c = cr();
    const sha = async (t) => c.subtle.digest('SHA-256', enc.encode(t));
    const sleutel = await c.subtle.importKey('raw', await sha(`prive-hoek-post-sleutel:${s}`), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { v: 1, sleutel, vraag: `pq-${hex(await sha(`prive-hoek-post-vraag:${s}`)).slice(0, 32)}`, antwoord: `pr-${hex(await sha(`prive-hoek-post-antwoord:${s}`)).slice(0, 32)}` };
  }
  const postGeldig = (p) => !!(p && p.sleutel && /^pq-[0-9a-f]{32}$/.test(String(p.vraag || '')) && /^pr-[0-9a-f]{32}$/.test(String(p.antwoord || '')));

  // ---- De kant van Veronica: een vraag sturen en het antwoord afwachten ----
  // o: { rp (rekenpostbus.js), http, basis, post (afleiden), vraag, systeem, wachtMs, pollMs, wacht, nu }
  async function stuurVraag(o) {
    const basis = basisGeldig(o.basis);
    if (!basis) return { ok: false, fout: 'geen-relay', zin: 'Praten met de rij kan alleen via de relay, en die staat niet aan. Er is niets verstuurd.' };
    if (!postGeldig(o.post)) return { ok: false, fout: 'geen-sleutel', zin: 'Er is nog geen telefoon aan de hoek gekoppeld (geen privé-sleutel). Er is niets verstuurd.' };
    const vraag = knip(o.vraag, MAX_VRAAG).trim();
    if (!vraag) return { ok: false, fout: 'leeg', zin: 'Er staat geen vraag.' };
    const nu = o.nu || (() => Date.now());
    const wachtMs = Math.max(10000, Math.min(Number(o.wachtMs) || 150000, 300000));
    const id = `p${nu().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
    const lading = { soort: 'prive-vraag', vraag, systeem: knip(o.systeem, MAX_SYSTEEM), max_tokens: 500, deadline: nu() + wachtMs };
    try {
      for (const b of await o.rp.maakBerichten(o.post.sleutel, 'kaart', id, lading, nu())) {
        if (!(await o.rp.plaats(o.http, basis, o.post.vraag, b))) return { ok: false, fout: 'relay', zin: 'De relay nam de vraag niet aan. Probeer het zo nog eens.' };
      }
    } catch (e) { return { ok: false, fout: 'te-groot', zin: 'De vraag met het geheugen erbij is te groot voor de relay.' }; }
    const verz = o.rp.maakVerzamelaar(o.post.sleutel, 'resultaat', nu);
    const wacht = o.wacht || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const einde = nu() + wachtMs;
    while (nu() < einde) {
      for (const m of await o.rp.leesOnderwerp(o.http, basis, o.post.antwoord, '1h')) {
        const r = await verz.voeg(m.bericht);
        if (r && r.id === id && !r.claim) {
          if (r.fout) return { ok: false, fout: String(r.fout).slice(0, 30), zin: knip(r.zin || 'De telefoon kon de vraag niet beantwoorden.', 300) };
          return { ok: true, antwoord: knip(r.tekst, MAX_ANTWOORD), telefoon: knip(r.telefoon, 60), ms: Number(r.ms) || 0, let_op: LET_OP };
        }
      }
      await wacht(o.pollMs || 4000);
    }
    return { ok: false, fout: 'geen-antwoord', zin: 'Geen telefoon heeft op tijd geantwoord (misschien bezig, in rust of zonder model). Ik verzin geen antwoord.' };
  }

  // ---- De kant van de telefoon: kijken, claimen, antwoorden ----
  // o: { rp, http, basis, post, tag, mag() (async), voerUit({ vraag, systeem, max_tokens }) -> { tekst, ms }, naam, nu, wacht, claimWachtMs }
  function maakLuisteraar(o) {
    const nu = o.nu || (() => Date.now());
    const kaartjes = o.rp.maakVerzamelaar(o.post.sleutel, 'kaart', nu);
    const gedaan = new Set();
    const tellers = { gezien: 0, gepakt: 0, klaar: 0, fout: 0, verlopen: 0 };
    async function antwoord(basis, id, lading) {
      for (const b of await o.rp.maakBerichten(o.post.sleutel, 'resultaat', id, lading, nu())) await o.rp.plaats(o.http, basis, o.post.antwoord, b);
    }
    async function claim(basis, id) {
      await antwoord(basis, `${id}.claim`, { claim: true, tag: o.tag });
      await (o.wacht || ((ms) => new Promise((r) => setTimeout(r, ms))))(o.claimWachtMs == null ? 3000 : o.claimWachtMs);
      const verz = o.rp.maakVerzamelaar(o.post.sleutel, 'resultaat', nu);
      let laagste = o.tag;
      for (const m of await o.rp.leesOnderwerp(o.http, basis, o.post.antwoord, '1h')) {
        const l = await verz.voeg(m.bericht);
        if (l && l.id === `${id}.claim` && typeof l.tag === 'string' && l.tag < laagste) laagste = l.tag;
      }
      return laagste === o.tag;
    }
    async function kijk() {
      const basis = basisGeldig(o.basis);
      if (!basis || !postGeldig(o.post)) return 0;                                 // nooit via ntfy.sh, nooit zonder sleutel
      let n = 0;
      for (const m of await o.rp.leesOnderwerp(o.http, basis, o.post.vraag, '15m')) {
        const k = await kaartjes.voeg(m.bericht);
        if (!k || gedaan.has(k.id) || k.soort !== 'prive-vraag') continue;
        gedaan.add(k.id);
        if (gedaan.size > 200) gedaan.delete(gedaan.values().next().value);
        tellers.gezien += 1;
        if (!Number.isFinite(k.deadline) || nu() > k.deadline - 5000) { tellers.verlopen += 1; continue; }
        if (!(await o.mag())) continue;                                            // bezig, in rust, te warm: een andere telefoon
        if (!(await claim(basis, k.id))) continue;
        tellers.gepakt += 1;
        try {
          const r = await o.voerUit({ vraag: knip(k.vraag, MAX_VRAAG), systeem: knip(k.systeem, MAX_SYSTEEM), max_tokens: Math.min(Number(k.max_tokens) || 500, 800) });
          await antwoord(basis, k.id, { telefoon: knip(o.naam, 60), tekst: knip(r && r.tekst, MAX_ANTWOORD), ms: Number(r && r.ms) || 0, let_op: LET_OP });
          tellers.klaar += 1;
        } catch (e) {
          tellers.fout += 1;
          await antwoord(basis, k.id, { fout: 'mislukt', zin: 'De telefoon kon de vraag niet beantwoorden.', telefoon: knip(o.naam, 60), let_op: LET_OP });
        }
        n += 1;
        break;                                                                     // een vraag per ronde
      }
      return n;
    }
    return { kijk, tellers };
  }

  return { afleiden, basisGeldig, postGeldig, stuurVraag, maakLuisteraar, SLEUTEL_RE, MAX_VRAAG, MAX_SYSTEEM, MAX_ANTWOORD, LET_OP };
}));
