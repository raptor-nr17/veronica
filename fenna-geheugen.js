// ===================================================================
// 547: HET LANGE GEHEUGEN VAN FENNA, op de geheugen-telefoon -- de regels, zonder scherm, zonder netwerk en zonder opslag
// ===================================================================
//
// Besluit van de eigenaar (24 oktober): Fenna's lange geheugen woont op de geheugen-telefoon (de rektelefoon met de grote opslag):
// de feiten, de samenvattingen van gesprekken, de "onthoud dat"-regels en het blok Stijl. Niet op een andere rektelefoon.
// Veronica leest het bij elk gesprek en schrijft erin bij "onthoud dat" en na een antwoord, alleen over het EIGEN wifi en alleen
// VERSLEUTELD met de sleutel van de privé-hoek (het bestand draagt het merkteken van geheugentel.js). Valt die telefoon weg, dan werkt
// Fenna door met de laatste kopie in deze browser, en gaat elke nieuwe regel in een WACHTRIJ die naar de telefoon gaat zodra hij er
// weer is. Dit bestand rekent alleen: wat er staat, hoe een wachtrij erop past, en wat Fenna ervan te zien krijgt.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.FennaGeheugen = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BESTAND = 'fenna-lang.enc';
  const MAX_ONTHOUD = 300;
  const MAX_SAMENVATTINGEN = 60;
  const MAX_TEKST = 2000;
  const MAX_WACHTRIJ = 200;
  const MAX_GEBEURTENISSEN = 100;
  const MAX_METINGEN = 200;         // 550: de slimheidsmeter (alleen getallen en waar ze vandaan komen)   // 549: wat er in de rij gebeurde (Avengers assemble), een regel per keer
  const tekst = (x) => (typeof x === 'string' ? x : '');
  const knip = (x, n) => tekst(x).replace(/\u0000/g, '').slice(0, n);
  const DAG_RE = /^\d{4}-\d{2}-\d{2}$/;

  // Een vaste id uit de tekst en het tijdstip (FNV-1a), zodat dezelfde regel op elke plek dezelfde id heeft.
  function regelId(t, tijd) {
    let h = 0x811c9dc5;
    for (const c of `${t}|${tijd}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return `r-${h.toString(36)}`;
  }
  const vergelijkbaar = (x) => tekst(x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  function leeg() { return { v: 1, versie: 0, feiten: '', onthoud: [], samenvattingen: [], gebeurtenissen: [], metingen: [], stijl: '', t: 0 }; }
  function lees(ruw) {
    const x = ruw && typeof ruw === 'object' ? ruw : {};
    const g = leeg();
    g.feiten = knip(x.feiten, MAX_TEKST);
    g.stijl = knip(x.stijl, MAX_TEKST);
    g.t = Number.isFinite(x.t) ? x.t : 0;
    g.versie = Number.isInteger(x.versie) && x.versie >= 0 ? x.versie : 0;
    // 551: een "onthoud dat"-regel heeft een vaste id, een eigen versienummer en kan VERWIJDERD zijn ("vergeet dat"); dan blijft hij als
    // grafsteen staan (met zijn versie), zodat een oudere kopie hem niet terugbrengt.
    for (const o of (Array.isArray(x.onthoud) ? x.onthoud : []).slice(-MAX_ONTHOUD)) {
      if (!o || !tekst(o.tekst).trim()) continue;
      const t = Number.isFinite(o.t) ? o.t : 0;
      const tk = knip(o.tekst, 300);
      g.onthoud.push({ t, tekst: tk, id: /^[a-z0-9-]{4,40}$/.test(tekst(o.id)) ? o.id : regelId(tk, t), versie: Number.isInteger(o.versie) && o.versie > 0 ? o.versie : 1, verwijderd: o.verwijderd === true });
    }
    for (const s of (Array.isArray(x.samenvattingen) ? x.samenvattingen : []).slice(-MAX_SAMENVATTINGEN)) if (s && DAG_RE.test(tekst(s.dag)) && tekst(s.tekst).trim()) g.samenvattingen.push({ dag: s.dag, tekst: knip(s.tekst, 800) });
    for (const e of (Array.isArray(x.gebeurtenissen) ? x.gebeurtenissen : []).slice(-MAX_GEBEURTENISSEN)) if (e && DAG_RE.test(tekst(e.dag)) && tekst(e.tekst).trim()) g.gebeurtenissen.push({ dag: e.dag, tekst: knip(e.tekst, 300) });
    for (const m of (Array.isArray(x.metingen) ? x.metingen : []).slice(-MAX_METINGEN)) { const s = schoonMeting(m); if (s) g.metingen.push(s); }
    return g;
  }
  // 550: een meting van de slimheidsmeter (slimheid.js meting()): alleen getallen, namen en de dag; al het andere valt weg.
  function schoonMeting(m) {
    if (!m || typeof m !== 'object' || !DAG_RE.test(tekst(m.dag))) return null;
    const getal = (x, max) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max ? x : null);
    const groepen = {};
    for (const [k, v] of Object.entries(m.groepen && typeof m.groepen === 'object' ? m.groepen : {}).slice(0, 12)) {
      if (/^[a-z]{2,20}$/.test(k) && v && typeof v === 'object') groepen[k] = { goed: getal(v.goed, 100) || 0, van: getal(v.van, 100) || 0 };
    }
    return { dag: m.dag, t: getal(m.t, 9e15) || 0, telefoon: knip(m.telefoon, 40), model: knip(m.model, 40), versie: knip(m.versie, 12), nakijker: knip(m.nakijker, 40),
      set: getal(m.set, 1000) || 0, totaal: getal(m.totaal, 100), groepen, nietNagekeken: getal(m.nietNagekeken, 100) || 0 };
  }
  // Een wijziging: { op: 'onthoud', t, tekst } | { op: 'samenvatting', dag, tekst } | { op: 'feiten', tekst } | { op: 'stijl', tekst }
  function geldigeOp(o) {
    if (!o || typeof o !== 'object') return null;
    if (o.op === 'onthoud' && tekst(o.tekst).trim()) return { op: 'onthoud', t: Number.isFinite(o.t) ? o.t : 0, tekst: knip(o.tekst, 300) };
    if (o.op === 'samenvatting' && DAG_RE.test(tekst(o.dag)) && tekst(o.tekst).trim()) return { op: 'samenvatting', dag: o.dag, tekst: knip(o.tekst, 800) };
    if (o.op === 'vergeet' && tekst(o.tekst).trim()) return { op: 'vergeet', t: Number.isFinite(o.t) ? o.t : 0, tekst: knip(o.tekst, 300) };
    if (o.op === 'meting') { const m = schoonMeting(o); return m ? Object.assign({ op: 'meting' }, m) : null; }
    if (o.op === 'gebeurtenis' && DAG_RE.test(tekst(o.dag)) && tekst(o.tekst).trim()) return { op: 'gebeurtenis', dag: o.dag, tekst: knip(o.tekst, 300) };
    if (o.op === 'feiten' || o.op === 'stijl') return { op: o.op, tekst: knip(o.tekst, MAX_TEKST) };
    return null;
  }
  // De wachtrij op een geheugen zetten (in volgorde). Dubbel "onthoud" (zelfde tekst) komt er een keer in; een samenvatting van
  // dezelfde dag vervangt de vorige; feiten en stijl zijn het hele blok.
  function pasToe(basis, ops) {
    const g = lees(basis);
    for (const ruw of Array.isArray(ops) ? ops : []) {
      const o = geldigeOp(ruw);
      if (!o) continue;
      if (o.op === 'onthoud') {
        const al = g.onthoud.find((x) => x.tekst === o.tekst);
        if (!al) { g.onthoud.push({ t: o.t, tekst: o.tekst, id: regelId(o.tekst, o.t), versie: 1, verwijderd: false }); g.versie += 1; }
        else if (al.verwijderd) { al.verwijderd = false; al.versie += 1; al.t = o.t; g.versie += 1; }   // weer onthouden
      } else if (o.op === 'vergeet') {
        // 551: "vergeet dat ...": elke levende regel die de tekst bevat wordt een grafsteen (versie omhoog), nooit stil gewist.
        const z = vergelijkbaar(o.tekst);
        for (const x of g.onthoud) if (!x.verwijderd && z && vergelijkbaar(x.tekst).includes(z)) { x.verwijderd = true; x.versie += 1; x.t = o.t || x.t; g.versie += 1; }
      }
      else if (o.op === 'samenvatting') { g.samenvattingen = g.samenvattingen.filter((s) => s.dag !== o.dag); g.samenvattingen.push({ dag: o.dag, tekst: o.tekst }); g.samenvattingen.sort((a, b) => a.dag.localeCompare(b.dag)); }
      else if (o.op === 'gebeurtenis') g.gebeurtenissen.push({ dag: o.dag, tekst: o.tekst });
      else if (o.op === 'meting') { const m = Object.assign({}, o); delete m.op; if (!g.metingen.some((x) => x.t === m.t && x.telefoon === m.telefoon)) g.metingen.push(m); }
      else g[o.op] = o.tekst;
    }
    g.onthoud = g.onthoud.slice(-MAX_ONTHOUD);
    g.samenvattingen = g.samenvattingen.slice(-MAX_SAMENVATTINGEN);
    g.gebeurtenissen = g.gebeurtenissen.slice(-MAX_GEBEURTENISSEN);
    g.metingen = g.metingen.slice(-MAX_METINGEN);
    return g;
  }
  function wachtrijErbij(rij, op) {
    const o = geldigeOp(op);
    const l = Array.isArray(rij) ? rij.slice() : [];
    if (o) l.push(o);
    return l.slice(-MAX_WACHTRIJ);
  }
  // Hoeveel feiten en samenvattingen er staan (voor de kaart in Veronica): een feit is een regel in het blok Feiten of een
  // "onthoud dat"-regel.
  function tellingen(g) {
    const x = lees(g);
    const regels = x.feiten.split(/\n/).map((r) => r.trim()).filter(Boolean).length;
    return { feiten: regels + x.onthoud.filter((o) => !o.verwijderd).length, samenvattingen: x.samenvattingen.length };
  }
  // Wat Fenna te zien krijgt (fenna.js bouw): de feiten met de nieuwste "onthoud"-regels, de laatste drie samenvattingen, en de stijl
  // (die fenna.js alleen bij kanaal 'wifi' meeneemt).
  function voorFenna(g) {
    const x = lees(g);
    const onthoud = x.onthoud.filter((o) => !o.verwijderd).slice(-40).map((o) => `- ${o.tekst}`).join('\n');
    const recent = x.gebeurtenissen.slice(-3).map((e) => `- ${e.dag}: ${e.tekst}`).join('\n');   // 549: wat er in de rij gebeurde
    const feiten = [x.feiten.trim(), onthoud, recent ? `Recent in de rij:\n${recent}` : ''].filter(Boolean).join('\n').slice(-MAX_TEKST);
    const samenvatting = x.samenvattingen.slice(-3).map((s) => `${s.dag}: ${s.tekst}`).join(' ').slice(-MAX_TEKST);
    return { feiten, samenvatting, stijl: x.stijl };
  }
  function zin(t, bron) {
    const w = bron === 'telefoon' ? '' : bron === 'kopie' ? ' (laatste kopie; de geheugen-telefoon is weg)' : '';
    return `Fenna: ${t.feiten} ${t.feiten === 1 ? 'feit' : 'feiten'}, ${t.samenvattingen} ${t.samenvattingen === 1 ? 'samenvatting' : 'samenvattingen'}${w}`;
  }

  // 551: DE BESTANDEN zoals ze in de kluis gaan (en zoals een mens ze kan lezen): feiten.jsonl (een regel per feit: id, tekst, tijd,
  // bron, versie, verwijderd), regels.md (het blok Stijl), samenvattingen.jsonl, gebeurtenissen.jsonl en metingen.jsonl. Afgeleid uit
  // het ene werkbestand op de geheugen-telefoon; een zoekindex komt later (en is altijd opnieuw te maken).
  function naarBestanden(g) {
    const x = lees(g);
    const regel = (o) => JSON.stringify(o);
    const blok = x.feiten.split(/\n/).map((r) => r.trim()).filter(Boolean).map((r, i) => ({ id: `blok-${i + 1}`, tekst: r, tijd: x.t, bron: 'eigenaar', versie: x.versie, verwijderd: false }));
    const ont = x.onthoud.map((o) => ({ id: o.id, tekst: o.tekst, tijd: o.t, bron: 'onthoud', versie: o.versie, verwijderd: o.verwijderd }));
    return {
      'feiten.jsonl': blok.concat(ont).map(regel).join('\n') + '\n',
      'regels.md': `# Stijl van Fenna\n\n${x.stijl.trim() || '(nog leeg)'}\n`,
      'samenvattingen.jsonl': x.samenvattingen.map(regel).join('\n') + (x.samenvattingen.length ? '\n' : ''),
      'gebeurtenissen.jsonl': x.gebeurtenissen.map(regel).join('\n') + (x.gebeurtenissen.length ? '\n' : ''),
      'metingen.jsonl': x.metingen.map(regel).join('\n') + (x.metingen.length ? '\n' : ''),
    };
  }
  return { BESTAND, MAX_WACHTRIJ, schoonMeting, regelId, naarBestanden, leeg, lees, geldigeOp, pasToe, wachtrijErbij, tellingen, voorFenna, zin };
}));
