// ===================================================================
// Nacht 8/9 nov, verbindingsbeheer STAP 3: DE METING. "Pas NA een meetbare bevinding de cadans van herstelZoek bijstellen; niet
// op gevoel" (docs/lokaal-verbindingsbeheer.md). Dit telt, over de tijd, HOE VAAK en HOE LANG welke oorzaak voorkomt -- per
// telefoon en in totaal -- zodat stap 2 (het lokale model stelt voor) en stap 3 (de cadans bijstellen) op CIJFERS kunnen i.p.v.
// op gevoel. Verandert NIETS aan de live-verbindingscode (herstelZoek/cadans/relay/hartslag blijven ongemoeid): dit is PUUR
// waarnemen -- geen netwerk, geen model, geen DOM. De oorzaak-codes komen van buiten (het verbindingsrapport, dat ze uit kern.js
// wegRedenen haalt -- EEN bron); dit bestand telt ze alleen.
// ===================================================================
//
// Afspraak met de eigenaar: GEEN naam van een persoon, merk of plaats in dit bestand (het gaat mee naar de openbare Veronica-site).
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Verbindingsmeting = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_GAT_MS = 2 * 60 * 60 * 1000;   // een gat > 2 uur (Chromebook dicht, verhuizing) telt niet als verblijftijd
  const MAX_TELEFOONS = 64;                // het eigen rek is klein; nooit onbeperkt groeien
  const BEWAAR_MS = 30 * 24 * 60 * 60 * 1000;   // een telefoon die 30 dagen niet gezien is valt uit de meting
  const GOED = 'goed';                     // bereikbaar, geen reden tot zorg (de basislijn)

  function leeg(nu) { return { sinds: nu || 0, laatst: nu || 0, codes: {}, perTelefoon: {} }; }

  function zorgCode(st, code) {
    if (!st.codes[code]) st.codes[code] = { episodes: 0, waarnemingen: 0, seconden: 0 };
    return st.codes[code];
  }

  // Noteer EEN momentopname. snapshot = [{ id, code }] -- code null/'' betekent "bereikbaar, geen zorg" (de basislijn).
  // Een NIEUW episode telt wanneer een telefoon van oorzaak WISSELT (of voor het eerst gezien wordt); de verblijftijd (seconden)
  // wordt per oorzaak opgeteld uit de tijd tussen twee opnamen (een te groot gat telt niet mee). Muterend én teruggegeven.
  function noteer(state, snapshot, nu) {
    const st = state && state.codes ? state : leeg(nu);
    if (!st.sinds) st.sinds = nu;
    const lijst = Array.isArray(snapshot) ? snapshot : [];
    const gezien = {};
    for (const e of lijst) {
      if (!e || e.id == null) continue;
      const id = String(e.id);
      gezien[id] = true;
      const code = e.code ? String(e.code) : GOED;
      const prev = st.perTelefoon[id];
      const c = zorgCode(st, code);
      c.waarnemingen++;
      if (!prev) {
        // eerste keer dat we deze telefoon zien: een episode van deze oorzaak
        c.episodes++;
        st.perTelefoon[id] = { code: code, sinds: nu, laatst: nu, episodes: 1 };
      } else {
        const delta = (nu > prev.laatst && nu - prev.laatst <= MAX_GAT_MS) ? (nu - prev.laatst) : 0;
        if (prev.code !== code) {
          // de vorige oorzaak krijgt nog zijn laatste verblijftijd, dan een nieuw episode
          zorgCode(st, prev.code).seconden += Math.round(delta / 1000);
          c.episodes++;
          prev.code = code; prev.sinds = nu; prev.episodes++;
        } else {
          c.seconden += Math.round(delta / 1000);
        }
        prev.laatst = nu;
      }
    }
    st.laatst = nu;
    // opruimen: te veel of te oude telefoons
    const ids = Object.keys(st.perTelefoon);
    for (const id of ids) if (nu - st.perTelefoon[id].laatst > BEWAAR_MS) delete st.perTelefoon[id];
    const over = Object.keys(st.perTelefoon);
    if (over.length > MAX_TELEFOONS) {
      over.sort((a, b) => st.perTelefoon[a].laatst - st.perTelefoon[b].laatst);
      for (let i = 0; i < over.length - MAX_TELEFOONS; i++) delete st.perTelefoon[over[i]];
    }
    return st;
  }

  // De meetbare bevinding: per oorzaak hoe vaak (episodes), hoe vaak gezien (waarnemingen) en hoe lang (minuten); de meest
  // voorkomende ECHTE oorzaak (niet de basislijn 'goed'); en per telefoon de huidige oorzaak. Dit is wat stap 2 het model geeft.
  function samenvatting(state) {
    const st = state && state.codes ? state : leeg(0);
    const perCode = Object.keys(st.codes).map((code) => {
      const c = st.codes[code];
      return { code: code, episodes: c.episodes, waarnemingen: c.waarnemingen, seconden: c.seconden, minuten: Math.round(c.seconden / 60) };
    }).sort((a, b) => b.episodes - a.episodes || b.seconden - a.seconden);
    let meestProbleem = null;
    for (const r of perCode) if (r.code !== GOED && (!meestProbleem || r.episodes > meestProbleem.episodes)) meestProbleem = { code: r.code, episodes: r.episodes, minuten: r.minuten };
    const perTelefoon = Object.keys(st.perTelefoon).map((id) => {
      const p = st.perTelefoon[id];
      return { id: id, code: p.code, episodes: p.episodes, sinds: p.sinds };
    });
    let totaalWaarnemingen = 0;
    for (const r of perCode) totaalWaarnemingen += r.waarnemingen;
    return {
      sinds: st.sinds, laatst: st.laatst,
      duurMinuten: st.laatst > st.sinds ? Math.round((st.laatst - st.sinds) / 60000) : 0,
      totaalWaarnemingen: totaalWaarnemingen,
      perCode: perCode,
      meestProbleem: meestProbleem,
      perTelefoon: perTelefoon,
    };
  }

  // Een compacte, feitelijke regel voor een mens (en straks, via het rapport, voor het model). Geen oordeel, alleen cijfers.
  function zin(state) {
    const s = samenvatting(state);
    if (!s.totaalWaarnemingen) return 'Nog niets gemeten.';
    if (!s.meestProbleem) return `Gemeten over ${s.duurMinuten} min: geen terugkerende verbindingsoorzaak.`;
    return `Gemeten over ${s.duurMinuten} min: vaakst "${s.meestProbleem.code}" (${s.meestProbleem.episodes}x, samen ${s.meestProbleem.minuten} min).`;
  }

  // opslag (door veronica.js in localStorage gezet): compact en begrensd, nooit meer dan het nodige.
  function serialiseer(state) { try { return JSON.stringify(state && state.codes ? state : leeg(0)); } catch (e) { return '{}'; } }
  function lees(json) {
    try { const o = JSON.parse(json || '{}'); return o && o.codes && o.perTelefoon ? o : leeg(0); } catch (e) { return leeg(0); }
  }

  return { leeg: leeg, noteer: noteer, samenvatting: samenvatting, zin: zin, serialiseer: serialiseer, lees: lees, MAX_GAT_MS: MAX_GAT_MS };
}));
