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
  const tekst = (x) => (typeof x === 'string' ? x : '');
  const knip = (x, n) => tekst(x).replace(/\u0000/g, '').slice(0, n);
  const DAG_RE = /^\d{4}-\d{2}-\d{2}$/;

  function leeg() { return { v: 1, feiten: '', onthoud: [], samenvattingen: [], stijl: '', t: 0 }; }
  function lees(ruw) {
    const x = ruw && typeof ruw === 'object' ? ruw : {};
    const g = leeg();
    g.feiten = knip(x.feiten, MAX_TEKST);
    g.stijl = knip(x.stijl, MAX_TEKST);
    g.t = Number.isFinite(x.t) ? x.t : 0;
    for (const o of (Array.isArray(x.onthoud) ? x.onthoud : []).slice(-MAX_ONTHOUD)) if (o && tekst(o.tekst).trim()) g.onthoud.push({ t: Number.isFinite(o.t) ? o.t : 0, tekst: knip(o.tekst, 300) });
    for (const s of (Array.isArray(x.samenvattingen) ? x.samenvattingen : []).slice(-MAX_SAMENVATTINGEN)) if (s && DAG_RE.test(tekst(s.dag)) && tekst(s.tekst).trim()) g.samenvattingen.push({ dag: s.dag, tekst: knip(s.tekst, 800) });
    return g;
  }
  // Een wijziging: { op: 'onthoud', t, tekst } | { op: 'samenvatting', dag, tekst } | { op: 'feiten', tekst } | { op: 'stijl', tekst }
  function geldigeOp(o) {
    if (!o || typeof o !== 'object') return null;
    if (o.op === 'onthoud' && tekst(o.tekst).trim()) return { op: 'onthoud', t: Number.isFinite(o.t) ? o.t : 0, tekst: knip(o.tekst, 300) };
    if (o.op === 'samenvatting' && DAG_RE.test(tekst(o.dag)) && tekst(o.tekst).trim()) return { op: 'samenvatting', dag: o.dag, tekst: knip(o.tekst, 800) };
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
      if (o.op === 'onthoud') { if (!g.onthoud.some((x) => x.tekst === o.tekst)) g.onthoud.push({ t: o.t, tekst: o.tekst }); }
      else if (o.op === 'samenvatting') { g.samenvattingen = g.samenvattingen.filter((s) => s.dag !== o.dag); g.samenvattingen.push({ dag: o.dag, tekst: o.tekst }); g.samenvattingen.sort((a, b) => a.dag.localeCompare(b.dag)); }
      else g[o.op] = o.tekst;
    }
    g.onthoud = g.onthoud.slice(-MAX_ONTHOUD);
    g.samenvattingen = g.samenvattingen.slice(-MAX_SAMENVATTINGEN);
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
    return { feiten: regels + x.onthoud.length, samenvattingen: x.samenvattingen.length };
  }
  // Wat Fenna te zien krijgt (fenna.js bouw): de feiten met de nieuwste "onthoud"-regels, de laatste drie samenvattingen, en de stijl
  // (die fenna.js alleen bij kanaal 'wifi' meeneemt).
  function voorFenna(g) {
    const x = lees(g);
    const onthoud = x.onthoud.slice(-40).map((o) => `- ${o.tekst}`).join('\n');
    const feiten = [x.feiten.trim(), onthoud].filter(Boolean).join('\n').slice(-MAX_TEKST);
    const samenvatting = x.samenvattingen.slice(-3).map((s) => `${s.dag}: ${s.tekst}`).join(' ').slice(-MAX_TEKST);
    return { feiten, samenvatting, stijl: x.stijl };
  }
  function zin(t, bron) {
    const w = bron === 'telefoon' ? '' : bron === 'kopie' ? ' (laatste kopie; de geheugen-telefoon is weg)' : '';
    return `Fenna: ${t.feiten} ${t.feiten === 1 ? 'feit' : 'feiten'}, ${t.samenvattingen} ${t.samenvattingen === 1 ? 'samenvatting' : 'samenvattingen'}${w}`;
  }

  return { BESTAND, MAX_WACHTRIJ, leeg, lees, geldigeOp, pasToe, wachtrijErbij, tellingen, voorFenna, zin };
}));
