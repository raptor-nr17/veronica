// ===================================================================
// VERONICA -- het commandostation (scherm en netwerk)
// ===================================================================
//
// Wat Veronica doet:
//  - LIVE MODUS (het startscherm): een tegel per vertrouwde telefoon, met wat die telefoon
//    NU doet en alle metingen. Elk getal draagt zijn bron en zijn leeftijd (kern.js).
//  - Een eigen WACHTRIJ (IndexedDB) die vragen verdeelt over de vertrouwde telefoons. Valt
//    er een uit, dan gaat zijn stukje terug in de wachtrij en pakt een ander het op.
//  - Pantser aan/uit, Vervang onderdeel, en een grote NOODSTOP.
//  - Ze praat RECHTSTREEKS met elke telefoon (CORS staat open in OlliteRT), niet via de
//    hoofdtelefoon. Chrome vraagt daar een keer toestemming voor (Local Network Access).
//
// Alles wat Veronica onthoudt (telefoons, codes, wachtrij, uitkomsten) staat ALLEEN in
// IndexedDB op deze computer. Er gaat niets naar internet.
(function () {
  'use strict';
  const K = window.VeronicaKern;
  const $ = (id) => document.getElementById(id);
  function el(tag, klasse, tekst) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (tekst !== undefined) e.textContent = tekst;
    return e;
  }
  const nu = () => Date.now();

  // ---- Opslag: IndexedDB, alleen op deze computer ----
  const Opslag = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((klaar, mis) => {
        const r = indexedDB.open('veronica', 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('instellingen')) db.createObjectStore('instellingen');
          if (!db.objectStoreNames.contains('wachtrij')) db.createObjectStore('wachtrij', { keyPath: 'id' });
        };
        r.onsuccess = () => { this.db = r.result; klaar(this.db); };
        r.onerror = () => mis(r.error);
      });
    },
    async doe(winkel, modus, f) {
      const db = await this.open();
      return new Promise((klaar, mis) => {
        const tx = db.transaction(winkel, modus);
        const uit = f(tx.objectStore(winkel));
        tx.oncomplete = () => klaar(uit && 'result' in uit ? uit.result : undefined);
        tx.onerror = () => mis(tx.error);
      });
    },
    lees(sleutel) { return this.doe('instellingen', 'readonly', (s) => s.get(sleutel)); },
    schrijf(sleutel, waarde) { return this.doe('instellingen', 'readwrite', (s) => s.put(waarde, sleutel)); },
    alleTaken() { return this.doe('wachtrij', 'readonly', (s) => s.getAll()); },
    taak(t) { return this.doe('wachtrij', 'readwrite', (s) => s.put(t)); },
    weg(id) { return this.doe('wachtrij', 'readwrite', (s) => s.delete(id)); },
  };

  // ---- De toestand ----
  const S = {
    telefoons: [],          // [{ naam, adres, jarvis, kern, sleutel }]
    stekkers: [],           // [{ naam, ip, rol }] (alleen lezen)
    stekkerMeting: {},      // ip -> { aan, watt, kwh, vandaag } (metingen met bron en tijd)
    kern: null, code: null, // de hoofdtelefoon (zijn JARVIS-adres) en zijn koppelcode
    metingen: {},           // adres -> { health: {...}, status: {...}, gezien, jarvisNietTot }
    staten: {},             // adres -> { bereikbaar, bezig, uitTot, vervangen, hitteStand, laatstGebruikt }
    kernActiviteit: {},     // naam -> { tekst, label, t } (uit stand.json van de hoofdtelefoon)
    zonStroom: null,        // { rijen, staaf } (uit stand.json; Veronica rekent de zon niet zelf)
    taken: [],
    aan: false,
    stromen: new Map(),     // adres -> { ctrl, taakId, reden }
    live: {},               // adres -> tekst die nu binnenkomt (van Veronica's eigen werk)
    scherm: {},             // adres -> { code, url, aan }
    log: [],
    wakeLock: null,
  };
  const staat = (adres) => (S.staten[adres] = S.staten[adres] || {});
  const meet = (adres) => (S.metingen[adres] = S.metingen[adres] || {});
  function logRegel(zin) {
    S.log.unshift({ t: nu(), zin });
    S.log = S.log.slice(0, 50);
    tekenLog();
  }

  // ---- Netwerk: altijd met een tijdslimiet, en met targetAddressSpace voor Chrome ----
  async function haal(url, init, ms) {
    const ctrl = new AbortController();
    const klok = setTimeout(() => ctrl.abort(), ms || 3000);
    try {
      return await fetch(url, Object.assign({ cache: 'no-store', signal: ctrl.signal }, K.lnaOpties(url), init || {}));
    } finally { clearTimeout(klok); }
  }
  const kop = (t) => (t.sleutel ? { Authorization: `Bearer ${t.sleutel}` } : {});

  // ---- Meten ----
  async function meetTelefoon(t) {
    const m = meet(t.adres);
    const s = staat(t.adres);
    try {
      const r = await haal(`${t.adres}/health?metrics=true`, { headers: kop(t) }, 2500);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      m.health = K.leesHealth(await r.json(), nu());
      m.gezien = nu();
      s.bereikbaar = true;
    } catch (e) {
      s.bereikbaar = false;   // de oude metingen blijven staan en worden vanzelf grijs
    }
    if (!(m.jarvisNietTot > nu())) {
      try {
        const r = await haal(`${t.jarvis}/jarvis/status`, {}, 2000);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        m.status = K.leesStatus(await r.json(), nu());
      } catch (e) { m.jarvisNietTot = nu() + 60000; }   // geen JARVIS (of even weg): een minuut niet vragen
    }
    const st = m.status || {};
    const vers = (x) => (x && nu() - x.t <= K.MAX_LEEFTIJD_MS ? x.waarde : null);
    s.hitteStand = K.ruweStand({ headroom: vers(st.headroom), temperatuur: vers(st.temperatuur), hitte: vers(st.hitte) });
  }
  async function meetKern() {
    if (!S.kern || !S.code) return;
    try {
      const r = await haal(`${S.kern}/stand.json`, { headers: { 'X-Koppelcode': S.code } }, 2500);
      if (!r.ok) return;
      const d = await r.json();
      const act = {};
      for (const a of Array.isArray(d.activiteit) ? d.activiteit : []) {
        if (a && a.telefoon && !a.klaar) act[a.telefoon] = { tekst: String(a.tekst || ''), label: String(a.label || ''), t: nu() };
      }
      S.kernActiviteit = act;
      const zs = K.leesZonStroom(d.zonStroom, nu());
      if (zs) S.zonStroom = zs;
    } catch (e) { /* de hoofdtelefoon is weg: Veronica gaat gewoon door */ }
  }
  async function meetStekker(k) {
    try {
      const [a, b] = await Promise.all([haal(`http://${k.ip}/cm?cmnd=Status%208`, {}, 2500), haal(`http://${k.ip}/cm?cmnd=Power`, {}, 2500)]);
      if (!a.ok || !b.ok) throw new Error('geen antwoord');
      S.stekkerMeting[k.ip] = K.leesStekker(await a.json(), await b.json(), nu());
    } catch (e) { /* de oude meting blijft en wordt vanzelf grijs */ }
  }
  let meetBezig = false;
  async function meetRonde() {
    if (meetBezig) return;
    meetBezig = true;
    try {
      await Promise.all(S.telefoons.map(meetTelefoon).concat([meetKern()], S.stekkers.map(meetStekker)));
      tekenLive();
      werkTik();
    } finally { meetBezig = false; }
  }

  // ---- Live modus: een tegel per telefoon ----
  const RIJEN = [
    ['Model', (m) => m.health && m.health.model],
    ['Versneller', (m) => m.health && m.health.versneller],
    ['Bezig', (m) => m.health && m.health.bezig, (v) => (v ? 'ja' : 'nee')],
    ['Snelheid', (m) => m.health && m.health.tps, (v) => `${String(Math.round(v * 10) / 10).replace('.', ',')} tok/s`],
    ['Piek', (m) => m.health && m.health.tpsPiek, (v) => `${String(Math.round(v * 10) / 10).replace('.', ',')} tok/s`],
    ['Benutting', (m) => m.health && m.health.benutting, (v) => `${v}% (geen echte CPU/GPU-%)`],
    ['Context', (m) => m.health && m.health.context, (v) => `${Math.round(v)}% vol`],
    ['Batterij', (m) => m.status && m.status.batterij, (v) => `${v}%`],
    ['Laadt', (m) => m.status && m.status.laadt, (v) => (v ? 'ja' : 'nee')],
    ['Temperatuur', (m) => m.status && m.status.temperatuur, (v) => `${String(Math.round(v * 10) / 10).replace('.', ',')} °C`],
    ['Hittestand', (m) => m.status && m.status.hitte, (v) => K.hitteNaam(v)],
    ['Headroom', (m) => m.status && m.status.headroom, (v) => String(v).replace('.', ',')],
    ['Stroomstand', (m) => m.status && m.status.stroom],
    ['Mag rekenen', (m) => m.status && m.status.magRekenen, (v) => (v ? 'ja' : 'nee')],
  ];
  const KLEUR = { groen: '#2fbf71', geel: '#e6c229', oranje: '#f08a24', rood: '#e5484d' };
  // ---- De meters (meters.js, hetzelfde bestand als in JARVIS) ----
  // Snelheid en benutting uit OlliteRT, temperatuur en batterij uit JARVIS op die telefoon.
  // Rekent hij niet, dan is de snelheid echt 0. Geen meting = grijze meter met "geen meting".
  const Mt = window.Meters;
  function meterStand(m, s, tijd) {
    const h = m.health || {}; const st = m.status || {};
    const vers = (x) => (x ? tijd - x.t : null);
    const tps = h.tps ? { waarde: h.bezig && h.bezig.waarde === false ? 0 : h.tps.waarde, ms: vers(h.tps) } : { waarde: null, ms: null };
    return {
      snelheid: tps,
      benutting: h.benutting ? { waarde: h.benutting.waarde, ms: vers(h.benutting) } : { waarde: null, ms: null },
      temperatuur: st.temperatuur ? { waarde: st.temperatuur.waarde, ms: vers(st.temperatuur), stand: s.hitteStand || 'groen' } : { waarde: null, ms: null, stand: 'groen' },
      batterij: st.batterij ? { waarde: st.batterij.waarde, ms: vers(st.batterij), laadt: st.laadt ? st.laadt.waarde === true : false } : { waarde: null, ms: null, laadt: false },
    };
  }
  function meterRij(t, m, s, tijd) {
    const d = meterStand(m, s, tijd);
    const OUD = K.MAX_LEEFTIJD_MS;
    const vak = (soort, svg, wat, ms) => {
      const v = el('div', `vMeter v-${soort}`);
      const h = document.createElement('div');
      h.innerHTML = svg;      // alleen uit meters.js: getallen en vaste woorden, door schoon()
      v.append(h.firstChild, el('div', 'vWat', wat), el('div', 'vOud', ms === null ? 'geen meting' : Mt.leeftijd(ms)));
      return v;
    };
    const rij = el('div', 'vMeters');
    rij.append(
      vak('snelheid', Mt.meter({ waarde: d.snelheid.waarde, max: 30, eenheid: 'tok/s', decimalen: 1, oud: d.snelheid.ms > OUD, kleur: 'blauw' }), 'Snelheid', d.snelheid.waarde === null ? null : d.snelheid.ms),
      vak('benutting', Mt.meter({ waarde: d.benutting.waarde, max: 100, eenheid: '%', oud: d.benutting.ms > OUD, kleur: 'groen' }), 'Benutting', d.benutting.waarde === null ? null : d.benutting.ms),
      vak('temperatuur', Mt.thermometer({ temp: d.temperatuur.waarde, stand: d.temperatuur.stand, oud: d.temperatuur.ms > OUD }), 'Temperatuur', d.temperatuur.waarde === null ? null : d.temperatuur.ms),
      vak('batterij', Mt.batterij({ procent: d.batterij.waarde, laadt: d.batterij.laadt, oud: d.batterij.ms > OUD }), 'Batterij', d.batterij.waarde === null ? null : d.batterij.ms),
    );
    const accu = S.zonStroom && S.zonStroom.accuPer ? S.zonStroom.accuPer[t.naam] : null;
    const wrap = el('div', 'vMeterVak');
    wrap.append(rij, el('div', `vAccu${!accu || /^Nog aan het leren/.test(accu) ? ' leert' : ''}`,
      accu ? `🔋 ${/^Nog aan het leren/.test(accu) ? 'Accu: leert nog' : accu.replace(/^Nog ca\. (.+?) rekenen op de accu.*$/, 'Nog $1 op de accu')}` : '🔋 Accu: geen meting'));
    return wrap;
  }
  // De samenvatting bovenaan de Live modus.
  function tekenSamen(tijd) {
    const OUD = 60000;
    const st = S.telefoons.map((t) => ({ t, d: meterStand(meet(t.adres), staat(t.adres), tijd) }));
    const snel = st.filter((x) => x.d.snelheid.waarde !== null && x.d.snelheid.ms <= OUD);
    const warm = st.filter((x) => x.d.temperatuur.waarde !== null && x.d.temperatuur.ms <= OUD).sort((a, b) => b.d.temperatuur.waarde - a.d.temperatuur.waarde)[0];
    const bereik = S.telefoons.filter((t) => staat(t.adres).bereikbaar).length;
    const stek = S.stekkers.map((k) => { const m = S.stekkerMeting[k.ip] || {}; return { naam: k.naam, aan: m.aan && tijd - m.aan.t <= OUD ? m.aan.waarde : null }; });
    const z = S.zonStroom && S.zonStroom.zon;
    const duur = (ms) => { const mm = Math.round(ms / 60000); return mm >= 60 ? `${Math.floor(mm / 60)} u ${mm % 60} min` : `${mm} min`; };
    const tegel = (icoon, getal, wat, sleutel) => { const v = el('div', 'vSamen'); v.dataset.samen = sleutel; v.append(el('div', 'vIcoon', icoon), el('div', 'vGetal', getal), el('div', 'vWat2', wat)); return v; };
    $('vSamen').replaceChildren(
      tegel('📱', String(S.telefoons.length), `telefoons · ${bereik} bereikbaar`, 'telefoons'),
      tegel('⚡', snel.length ? String(Math.round(snel.reduce((a, x) => a + x.d.snelheid.waarde, 0) * 10) / 10).replace('.', ',') : 'geen meting', 'tokens/s samen', 'snelheid'),
      tegel('🌡️', warm ? `${String(Math.round(warm.d.temperatuur.waarde * 10) / 10).replace('.', ',')} °C` : 'geen meting', warm ? `warmste: ${warm.t.naam}` : 'warmste telefoon', 'warmste'),
      tegel('🔌', stek.length ? stek.map((x) => (x.aan === true ? 'aan' : x.aan === false ? 'uit' : '?')).join(' · ') : 'geen', stek.length ? stek.map((x) => x.naam).join(' · ') : 'geen stekker', 'stekkers'),
      tegel('☀️', !z ? 'onbekend' : z.geen ? 'geen zon' : z.open ? 'open' : 'dicht', !z || z.geen ? 'zonvenster' : z.open ? `zonvenster · nog ${duur(z.nogMs || 0)}` : (z.totOpenMs ? `zonvenster · opent over ${duur(z.totOpenMs)}` : 'zonvenster'), 'zon'),
    );
  }
  function tekenLive() {
    const vak = $('tegels');
    $('leeg').hidden = S.telefoons.length > 0;
    const n = S.telefoons.filter((t) => staat(t.adres).bereikbaar && !staat(t.adres).vervangen).length;
    $('pantserZin').textContent = `${S.aan ? 'Pantser aan' : 'Pantser uit'} · ${n} van ${S.telefoons.length} bereikbaar · wachtrij ${S.taken.filter((x) => x.status === 'wacht').length}`;
    const tijd = nu();
    vak.replaceChildren(...S.telefoons.map((t) => {
      const m = meet(t.adres);
      const s = staat(t.adres);
      const tegel = el('section', 'tegel');
      tegel.dataset.adres = t.adres;
      if (s.hitteStand) tegel.style.borderColor = KLEUR[s.hitteStand];
      const kopRij = el('div', 'tKop');
      kopRij.append(el('h2', '', t.naam), el('span', 'tAdres', t.adres.replace('http://', '')));
      if (t.kern) kopRij.appendChild(el('span', 'badge', 'kern'));
      if (t.plek) kopRij.appendChild(el('span', `badge plek-${t.plek}`, t.plek === 'mobiel' ? '👖 mobiel' : '🧊🔌 rek'));
      tegel.appendChild(kopRij);
      tegel.appendChild(meterRij(t, m, s, tijd));
      const bereik = s.vervangen ? 'vervangen: krijgt geen werk' : s.bereikbaar ? 'bereikbaar' : (m.gezien ? `geen antwoord · laatst gezien ${K.klokZin(m.gezien)}` : 'nog niet bereikt');
      tegel.appendChild(el('div', `tBereik${s.bereikbaar ? '' : ' oud'}`, bereik));
      // De taak, en de tekst die NU binnenkomt (eigen werk, of wat de hoofdtelefoon meldt).
      const eigen = S.stromen.get(t.adres);
      const taak = eigen ? S.taken.find((x) => x.id === eigen.taakId) : null;
      const kernAct = S.kernActiviteit[t.naam];
      let taakZin = 'wacht';
      let live = '';
      let liveBron = '';
      if (taak) { taakZin = `Veronica: ${taak.tekst.slice(0, 60)}`; live = S.live[t.adres] || ''; liveBron = 'eigen stroom van deze telefoon'; }
      else if (kernAct) { taakZin = `hoofdtelefoon: ${kernAct.label}`; live = kernAct.tekst; liveBron = `stand.json van de hoofdtelefoon · ${K.leeftijdZin(tijd - kernAct.t)}`; }
      else if (m.health && m.health.bezig && m.health.bezig.waarde && tijd - m.health.bezig.t <= K.MAX_LEEFTIJD_MS) taakZin = 'rekent (voor iets buiten Veronica)';
      tegel.appendChild(el('div', 'tTaak', taakZin));
      const lv = el('pre', 'tLive', live.slice(-600));
      lv.hidden = !live;
      tegel.appendChild(lv);
      if (live) tegel.appendChild(el('div', 'tBron', liveBron));
      // Alle getallen (met bron) staan eronder, ingeklapt: de meters zijn het hoofdbeeld.
      const meer = el('details', 'tMeer');
      meer.appendChild(el('summary', '', 'Alle getallen'));
      const dl = el('dl', 'tCijfers');
      for (const [label, haalM, opmaak] of RIJEN) {
        const v = K.vakje(haalM(m) || null, tijd, opmaak);
        const dd = el('dd', v.onbekend ? 'onbekend' : (v.oud ? 'oud' : ''));
        dd.appendChild(el('span', 'waarde', v.tekst));
        if (v.bron) dd.appendChild(el('span', 'bron', v.bron));
        dl.append(el('dt', '', label), dd);
      }
      meer.appendChild(dl);
      tegel.appendChild(meer);
      // Scherm meekijken (alleen telefoons met JARVIS, met hun eigen code).
      const sch = S.scherm[t.adres] || {};
      const knoppen = el('div', 'tKnoppen');
      const kb = el('button', 'klein-knop', sch.aan ? 'Scherm meekijken: aan' : 'Scherm meekijken: uit');
      kb.addEventListener('click', () => schermWissel(t));
      knoppen.appendChild(kb);
      if (s.vervangen) { const w = el('button', 'klein-knop', 'Weer erbij'); w.addEventListener('click', () => { s.vervangen = false; logRegel(`${t.naam} doet weer mee.`); tekenLive(); werkTik(); }); knoppen.appendChild(w); }
      tegel.appendChild(knoppen);
      if (sch.aan) {
        const img = el('img', 'tScherm');
        img.alt = `Scherm van ${t.naam}`;
        if (sch.url) img.src = sch.url;
        tegel.appendChild(img);
        tegel.appendChild(el('div', 'tBron', sch.zin || ''));
      }
      return tegel;
    }));
    // De stekkers (alleen lezen): aan/uit, watt en kWh, elk met bron en leeftijd.
    $('stekkerTegels').replaceChildren(...S.stekkers.map((k) => {
      const m = S.stekkerMeting[k.ip] || {};
      const tegel = el('section', 'tegel stekker');
      tegel.dataset.ip = k.ip;
      tegel.appendChild(el('h2', '', `${k.naam} · ${k.rol === 'laden' ? 'laden' : 'ventilator'}`));
      const dl = el('dl', 'tCijfers');
      for (const [label, x, opmaak] of [['Aan', m.aan, (v) => (v ? 'aan' : 'uit')], ['Vermogen', m.watt, (v) => `${Math.round(v)} W`],
        ['Totaal', m.kwh, (v) => `${String(Math.round(v * 100) / 100).replace('.', ',')} kWh`], ['Vandaag', m.vandaag, (v) => `${String(Math.round(v * 100) / 100).replace('.', ',')} kWh`]]) {
        const v = K.vakje(x || null, tijd, opmaak);
        const dd = el('dd', v.onbekend ? 'onbekend' : (v.oud ? 'oud' : ''));
        dd.appendChild(el('span', 'waarde', v.tekst));
        if (v.bron) dd.appendChild(el('span', 'bron', v.bron));
        dl.append(el('dt', '', label), dd);
      }
      tegel.appendChild(dl);
      return tegel;
    }));
    $('stekkerKop').hidden = !S.stekkers.length;
    tekenSamen(tijd);
    tekenZonStroom(tijd);
    tekenWachtrij();
  }

  // ZON EN STROOM: wat de hoofdtelefoon meldt, met bron en leeftijd. Nooit zelf gerekend.
  const kwhZin = (x) => `${String(Math.round(x * 100) / 100).replace('.', ',')} kWh`;
  function tekenZonStroom(tijd) {
    const vak = $('zonStroom');
    const zs = S.zonStroom;
    if (!zs) { vak.replaceChildren(el('p', 'eerlijk', 'Zon en stroom: onbekend. Dat komt van de hoofdtelefoon (koppelen met de code).')); return; }
    const dl = el('dl', 'tCijfers');
    for (const r of zs.rijen) {
      const v = K.vakje(r.m, tijd);
      const dd = el('dd', v.onbekend ? 'onbekend' : (v.oud ? 'oud' : ''));
      dd.appendChild(el('span', 'waarde', v.tekst));
      if (v.bron) dd.appendChild(el('span', 'bron', v.bron));
      dl.append(el('dt', '', r.label), dd);
    }
    const delen = [dl];
    const v = K.vakje(zs.staaf, tijd, (x) => `Vandaag laden: ${kwhZin(x.zon)} in het zonvenster, ${kwhZin(x.buiten)} erbuiten${x.onbekend ? `, ${kwhZin(x.onbekend)} onbekend` : ''}`);
    if (zs.staaf) {
      const x = zs.staaf.waarde;
      const tot = x.zon + x.buiten + x.onbekend;
      const balk = el('div', `zsBalk${v.oud ? ' oud' : ''}`);
      for (const [k, kl] of [['zon', 'zsZon'], ['buiten', 'zsBuiten'], ['onbekend', 'zsOnbekend']]) {
        const b = el('span', kl);
        b.style.width = `${tot > 0 ? Math.round((x[k] / tot) * 100) : 0}%`;
        balk.appendChild(b);
      }
      delen.push(balk);
    }
    const st = el('div', `zsStaaf${v.oud ? ' oud' : ''}`, v.onbekend ? 'Dagstaaf: onbekend' : v.tekst);
    if (v.bron) st.appendChild(el('span', 'bron', ` · ${v.bron}`));
    delen.push(st);
    vak.replaceChildren(...delen);
  }

  // ---- Scherm meekijken: ongeveer een beeld per seconde, met de code van DIE telefoon ----
  async function schermWissel(t) {
    const sch = S.scherm[t.adres] = S.scherm[t.adres] || {};
    if (sch.aan) { sch.aan = false; if (sch.url) URL.revokeObjectURL(sch.url); sch.url = null; tekenLive(); return; }
    if (!sch.code) {
      const c = window.prompt(`De code van ${t.naam} (staat op die telefoon bij Apparaten, Veronica):`, '');
      if (!/^\d{6}$/.test(String(c || '').trim())) return;
      sch.code = String(c).trim();
    }
    sch.aan = true;
    tekenLive();
  }
  async function schermTik() {
    for (const t of S.telefoons) {
      const sch = S.scherm[t.adres];
      if (!sch || !sch.aan) continue;
      try {
        const r = await haal(`${t.jarvis}/jarvis/scherm.jpg`, { headers: { 'X-Koppelcode': sch.code } }, 2000);
        if (r.status === 401) { sch.aan = false; sch.code = null; logRegel(`De code van ${t.naam} klopt niet.`); continue; }
        if (!r.ok) { sch.zin = 'Scherm meekijken staat uit op de telefoon (of geen nieuw beeld).'; continue; }
        const blob = await r.blob();
        if (sch.url) URL.revokeObjectURL(sch.url);
        sch.url = URL.createObjectURL(blob);
        sch.zin = `JARVIS /jarvis/scherm.jpg · ${K.klokZin(nu())}`;
      } catch (e) { sch.zin = 'Geen beeld (telefoon niet bereikbaar).'; }
    }
    if (S.telefoons.some((t) => S.scherm[t.adres] && S.scherm[t.adres].aan)) tekenLive();
  }

  // ---- De wachtrij ----
  const nieuwId = () => `v${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
  async function voegTakenToe(tekst) {
    const regels = String(tekst || '').split('\n').map((r) => r.trim()).filter(Boolean).slice(0, 100);
    for (const r of regels) {
      const taak = { id: nieuwId(), tekst: r.slice(0, 20000), status: 'wacht', pogingen: 0, sinds: nu(), telefoon: null, uitkomst: null };
      S.taken.push(taak);
      await Opslag.taak(taak);
    }
    logRegel(`${regels.length} ${regels.length === 1 ? 'vraag' : 'vragen'} in de wachtrij.`);
    tekenWachtrij();
    werkTik();
  }
  function werkTik() {
    if (!S.aan) return;
    for (;;) {
      const taak = S.taken.find((x) => x.status === 'wacht');
      if (!taak) return;
      const t = K.kiesTelefoon(S.telefoons, S.staten, nu());
      if (!t) return;
      draai(taak, t);
    }
  }
  async function draai(taak, t) {
    const s = staat(t.adres);
    s.bezig = true;
    s.laatstGebruikt = nu();
    taak.status = 'bezig';
    taak.telefoon = t.naam;
    Opslag.taak(taak);
    const ctrl = new AbortController();
    const stroom = { ctrl, taakId: taak.id, reden: null };
    S.stromen.set(t.adres, stroom);
    S.live[t.adres] = '';
    tekenLive();
    const m = meet(t.adres);
    const model = m.health && m.health.model ? m.health.model.waarde : undefined;
    try {
      const r = await fetch(`${t.adres}/v1/chat/completions`, Object.assign({
        method: 'POST', signal: ctrl.signal,
        headers: Object.assign({ 'Content-Type': 'application/json' }, kop(t)),
        body: JSON.stringify({ model, stream: true, max_tokens: 600, messages: [{ role: 'user', content: taak.tekst }] }),
      }, K.lnaOpties(t.adres)));
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const lezer = K.maakSseLezer();
      const rd = r.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        if (lezer.voeg(dec.decode(value, { stream: true })).length) { S.live[t.adres] = K.zonderDenken(lezer.tekst()); tekenLive(); }
      }
      taak.status = 'klaar';
      taak.uitkomst = K.zonderDenken(lezer.tekst());
      taak.klaar = nu();
      logRegel(`${t.naam} is klaar: ${taak.tekst.slice(0, 40)}`);
    } catch (fout) {
      // Uitgevallen (of vervangen, of noodstop): het stukje gaat terug in de wachtrij.
      taak.status = 'wacht';
      taak.telefoon = null;
      if (stroom.reden === 'noodstop') { /* blijft wachten tot het pantser weer aan gaat */ }
      else if (stroom.reden === 'vervangen') logRegel(`Onderdeel vervangen: ${t.naam}. Het werk gaat naar een ander.`);
      else {
        taak.pogingen += 1;
        s.uitTot = nu() + 30000;
        logRegel(`${t.naam} viel uit (${(fout && fout.message) || 'geen antwoord'}). Het werk gaat naar een ander.`);
        if (taak.pogingen >= 3) { taak.status = 'fout'; taak.uitkomst = 'Drie keer mislukt.'; }
      }
    } finally {
      s.bezig = false;
      S.stromen.delete(t.adres);
      S.live[t.adres] = '';
      await Opslag.taak(taak);
      tekenLive();
      werkTik();
    }
  }
  function tekenWachtrij() {
    const lijst = $('takenLijst');
    lijst.replaceChildren(...S.taken.slice().reverse().slice(0, 50).map((x) => {
      const d = el('div', `taak ${x.status}`);
      d.dataset.id = x.id;
      d.appendChild(el('div', 'taakKop', `${x.status === 'klaar' ? '✓' : x.status === 'bezig' ? '…' : x.status === 'fout' ? '✗' : '·'} ${x.tekst.slice(0, 80)}${x.telefoon ? ` (${x.telefoon})` : ''}`));
      if (x.uitkomst) d.appendChild(el('div', 'taakUit', x.uitkomst));
      return d;
    }));
  }

  // ---- Pantser, Vervang onderdeel, NOODSTOP ----
  function zetPantser(aan) {
    S.aan = !!aan;
    $('pantserKnop').textContent = S.aan ? 'Pantser aan' : 'Pantser uit';
    $('pantserKnop').setAttribute('aria-pressed', String(S.aan));
    logRegel(S.aan ? 'Pantser aan: de wachtrij loopt.' : 'Pantser uit: de wachtrij staat stil.');
    tekenLive();
    werkTik();
  }
  function vervang(adres) {
    const t = S.telefoons.find((x) => x.adres === adres);
    if (!t) return;
    staat(adres).vervangen = true;
    const st = S.stromen.get(adres);
    if (st) { st.reden = 'vervangen'; st.ctrl.abort(); } else logRegel(`Onderdeel vervangen: ${t.naam} krijgt geen werk meer.`);
    tekenLive();
  }
  async function noodstop() {
    S.aan = false;
    $('pantserKnop').textContent = 'Pantser uit';
    $('pantserKnop').setAttribute('aria-pressed', 'false');
    for (const st of S.stromen.values()) { st.reden = 'noodstop'; st.ctrl.abort(); }
    logRegel('NOODSTOP: alles stilgezet.');
    const uitslag = await Promise.all(S.telefoons.map(async (t) => {
      try {
        const r = await haal(`${t.adres}/v1/server/stop`, { method: 'POST', headers: kop(t) }, 3000);
        return r.ok ? `${t.naam}: gestopt` : r.status === 404 ? `${t.naam}: kon niet (REST API Integration staat uit)` : `${t.naam}: kon niet (${r.status})`;
      } catch (e) { return `${t.naam}: geen antwoord`; }
    }));
    for (const z of uitslag) logRegel(z);
    logRegel('Weer aanzetten: op elke telefoon OlliteRT openen en Start Server tikken.');
    tekenLive();
  }

  // ---- Koppelen: de vertrouwde lijst EEN keer overnemen van de hoofdtelefoon ----
  async function bewaarLijst(l) {
    S.telefoons = l.telefoons;
    S.stekkers = l.stekkers || [];
    await Opslag.schrijf('stekkers', S.stekkers);
    if (l.kern) S.kern = l.kern;
    if (l.code) S.code = l.code;
    await Opslag.schrijf('telefoons', S.telefoons);
    await Opslag.schrijf('kern', S.kern);
    await Opslag.schrijf('code', S.code);
    logRegel(`${S.telefoons.length} vertrouwde ${S.telefoons.length === 1 ? 'telefoon' : 'telefoons'} overgenomen.`);
    tekenLive();
    meetRonde();
  }
  async function koppelMetCode() {
    const kern = K.normaalAdres($('kernAdres').value, K.JARVIS_POORT);
    const code = String($('kernCode').value || '').replace(/\D/g, '');
    const vak = $('koppelMelding');
    if (!kern) { vak.textContent = 'Dat adres ken ik niet. Typ het adres dat de hoofdtelefoon bij Apparaten, Veronica toont.'; return; }
    if (!/^\d{6}$/.test(code)) { vak.textContent = 'De code is zes cijfers.'; return; }
    vak.textContent = 'Even kijken…';
    try {
      const r = await haal(`${kern}/jarvis/vertrouwd`, { headers: { 'X-Koppelcode': code } }, 4000);
      if (r.status === 401) { vak.textContent = 'Die code klopt niet.'; return; }
      if (r.status === 429) { vak.textContent = 'Te vaak een foute code. Wacht een minuut.'; return; }
      if (!r.ok) { vak.textContent = `De hoofdtelefoon gaf ${r.status}. Is JARVIS daar 1.9.0 of nieuwer?`; return; }
      const l = K.leesVertrouwd(await r.json());
      l.kern = kern; l.code = code;
      if (!l.telefoons.length) { vak.textContent = 'Er staan nog geen vertrouwde telefoons op de hoofdtelefoon.'; return; }
      await bewaarLijst(l);
      vak.textContent = `Klaar: ${l.telefoons.length} ${l.telefoons.length === 1 ? 'telefoon' : 'telefoons'}.`;
      toonScherm('live');
    } catch (e) {
      vak.textContent = 'Geen antwoord. Zit deze computer op hetzelfde netwerk, en heeft Chrome toegang tot het lokale netwerk gekregen?';
    }
  }
  async function koppelMetQrTekst(tekst) {
    const l = K.leesQr(tekst);
    if (!l || !l.telefoons.length) { $('koppelMelding').textContent = 'Dat is geen QR van JARVIS voor Veronica.'; return false; }
    await bewaarLijst(l);
    $('koppelMelding').textContent = `Klaar: ${l.telefoons.length} ${l.telefoons.length === 1 ? 'telefoon' : 'telefoons'}.`;
    toonScherm('live');
    return true;
  }
  async function scanQr() {
    const vak = $('koppelMelding');
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices) { vak.textContent = 'Deze browser kan hier geen QR lezen. Gebruik het adres en de code.'; return; }
    let stroom;
    try { stroom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch (e) { vak.textContent = 'Geen camera (of geen toestemming).'; return; }
    const video = $('qrVideo');
    video.hidden = false;
    video.srcObject = stroom;
    await video.play();
    const lezer = new window.BarcodeDetector({ formats: ['qr_code'] });
    const stop = () => { stroom.getTracks().forEach((x) => x.stop()); video.hidden = true; };
    const eind = nu() + 60000;
    while (nu() < eind) {
      try {
        const codes = await lezer.detect(video);
        if (codes.length && await koppelMetQrTekst(codes[0].rawValue)) { stop(); return; }
      } catch (e) { /* volgende beeld */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    stop();
    vak.textContent = 'Geen QR gezien.';
  }

  // ---- Wakker blijven, volledig scherm ----
  async function wakker() {
    if (S.wakeLock) { try { await S.wakeLock.release(); } catch (e) { /* al los */ } S.wakeLock = null; tekenWakker(); return; }
    if (!('wakeLock' in navigator)) { $('wakkerZin').textContent = 'Deze browser kan het scherm niet aan houden. Zet slapen uit in de instellingen van de Chromebook.'; return; }
    try {
      S.wakeLock = await navigator.wakeLock.request('screen');
      S.wakeLock.addEventListener('release', () => { S.wakeLock = null; tekenWakker(); });
    } catch (e) { S.wakeLock = null; }
    tekenWakker();
  }
  function tekenWakker() {
    $('wakkerKnop').textContent = S.wakeLock ? 'Scherm blijft aan' : 'Houd het scherm aan';
    $('wakkerKnop').setAttribute('aria-pressed', String(!!S.wakeLock));
  }
  function tekenLog() {
    const v = $('log');
    if (v) v.replaceChildren(...S.log.slice(0, 12).map((x) => el('div', '', `${K.klokZin(x.t)} · ${x.zin}`)));
  }
  function toonScherm(naam) {
    for (const s of ['live', 'wachtrij', 'koppel']) { $(`scherm-${s}`).hidden = s !== naam; $(`tab-${s}`).setAttribute('aria-pressed', String(s === naam)); }
  }

  // ---- Start ----
  async function start() {
    try {
      S.telefoons = (await Opslag.lees('telefoons')) || [];
      S.stekkers = (await Opslag.lees('stekkers')) || [];
      S.kern = (await Opslag.lees('kern')) || null;
      S.code = (await Opslag.lees('code')) || null;
      S.taken = ((await Opslag.alleTaken()) || []).sort((a, b) => a.sinds - b.sinds);
      // Wat bezig was toen Veronica dichtging, gaat terug in de wachtrij.
      for (const x of S.taken) if (x.status === 'bezig') { x.status = 'wacht'; x.telefoon = null; await Opslag.taak(x); }
    } catch (e) { logRegel('De opslag van deze browser is niet te lezen.'); }
    $('pantserKnop').addEventListener('click', () => zetPantser(!S.aan));
    $('noodstop').addEventListener('click', noodstop);
    $('vervangKnop').addEventListener('click', () => { const a = $('vervangKeus').value; if (a) vervang(a); });
    $('wakkerKnop').addEventListener('click', wakker);
    $('volKnop').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); });
    $('koppelKnop').addEventListener('click', koppelMetCode);
    $('qrKnop').addEventListener('click', scanQr);
    $('qrPlakKnop').addEventListener('click', () => koppelMetQrTekst($('qrTekst').value));
    $('taakKnop').addEventListener('click', () => { voegTakenToe($('taakTekst').value); $('taakTekst').value = ''; });
    for (const s of ['live', 'wachtrij', 'koppel']) $(`tab-${s}`).addEventListener('click', () => toonScherm(s));
    toonScherm('live');   // de Live modus is altijd het startscherm
    tekenWakker();
    tekenLive();
    vulVervang();
    meetRonde();
    // Elke 2 s met het scherm aan, elke 10 s als het verborgen is.
    let laatst = 0;
    setInterval(() => {
      const wacht = document.visibilityState === 'visible' ? 2000 : 10000;
      if (nu() - laatst >= wacht) { laatst = nu(); meetRonde(); vulVervang(); }
    }, 1000);
    setInterval(schermTik, 1000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  function vulVervang() {
    const keus = $('vervangKeus');
    const voor = keus.value;
    keus.replaceChildren(el('option', '', 'Kies een onderdeel'), ...S.telefoons.map((t) => { const o = el('option', '', t.naam); o.value = t.adres; return o; }));
    keus.firstChild.value = '';
    keus.value = voor;
  }
  window.__veronica = { S, K, meetRonde, werkTik, zetPantser, vervang, noodstop, voegTakenToe, koppelMetQrTekst, bewaarLijst, Opslag, tekenLive };
  start();
}());
