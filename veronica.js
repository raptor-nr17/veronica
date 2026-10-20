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
  const Pool = window.VeronicaPool;
  const $ = (id) => document.getElementById(id);
  // 483: VOL LOKAAL (schakelaar in de privé-hoek, standaard UIT). EEN poort voor elk verzoek van deze pagina: window.fetch zelf.
  // Aan = alleen de eigen telefoons en Veronica's eigen bestanden (K.magNaarBuiten); de rest wordt geweigerd voor hij vertrekt.
  const VOL_SLEUTEL = 'veronica-vol-lokaal';
  const VolL = { aan: (() => { try { return K.leesVolLokaal(localStorage.getItem(VOL_SLEUTEL)); } catch (e) { return false; } })(), geweigerd: 0 };
  const volLokaal = () => VolL.aan;
  {
    const echt = window.fetch.bind(window);
    window.fetch = (u, o) => {
      const url = typeof u === 'string' ? u : (u && u.url) || String(u);
      if (!K.magNaarBuiten(url, { volLokaal: VolL.aan, basis: location.href })) {
        VolL.geweigerd += 1;
        return Promise.reject(new TypeError('Vol lokaal staat aan: niets gaat naar buiten.'));
      }
      return echt(u, o);
    };
  }
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

  // ---- DE KLUIS (1.9.7): de leessleutel van de privé updateplek van JARVIS ----
  // Versleuteld in IndexedDB: AES-GCM met een sleutel die de browser zelf maakt en NIET kan
  // uitvoeren (extractable: false). Wie de opslag kopieert, heeft alleen versleutelde bytes.
  // Hij komt met de lijst van de baas (alleen met de code); Veronica gebruikt hem om te zien welke
  // JARVIS-versie de nieuwste is, en bewaart hem zodat hij er ook is als de baas opnieuw begint.
  const Kluis = {
    async sleutel() {
      let k = await Opslag.lees('kluis-sleutel');
      if (!k) {
        k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await Opslag.schrijf('kluis-sleutel', k);
      }
      return k;
    },
    async zet(naam, tekst) {
      if (!tekst) { await Opslag.schrijf(naam, null); return; }
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.sleutel(), new TextEncoder().encode(tekst));
      await Opslag.schrijf(naam, { iv, data });
    },
    async lees(naam) {
      const v = await Opslag.lees(naam);
      if (!v || !v.iv || !v.data) return null;
      try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: v.iv }, await this.sleutel(), v.data)); } catch (e) { return null; }
    },
  };

  // ---- De toestand ----
  const S = {
    telefoons: [],          // [{ naam, adres, jarvis, kern, sleutel }]
    stekkers: [],           // [{ naam, ip, rol }] (alleen lezen)
    stekkersGevonden: [],   // [{ naam, ip, mac }] gevonden door JARVIS, nog niet vertrouwd (452b)
    stekkerScan: null,      // 463b: wat de laatste zoekronde van de baas deed
    stekkerMeting: {},      // ip -> { aan, watt, kwh, vandaag } (metingen met bron en tijd)
    kern: null, code: null, // de hoofdtelefoon (zijn JARVIS-adres) en zijn koppelcode
    actieveKern: null,      // wie ze NU volgt: de hoofdtelefoon, of de waarnemend baas als die weg is
    bekend: [],             // alle JARVIS-adressen die ze ooit hoorde (de vindladder), nieuwste eerst
    ntfy: null,             // { onderwerp, aan, stil } van de hoofdtelefoon (alleen met de code)
    kernGezien: 0,          // wanneer de hoofdtelefoon zelf voor het laatst antwoordde (thuis = lokaal melden)
    stilSinds: null,        // sinds wanneer er werk wacht zonder dat iemand het oppakt
    spraak: { aan: true, stem: '', tempo: 1, volume: 1 },   // voorlezen (speechSynthesis)
    eigenaar: null,         // hoe ze je aanspreekt (de naam uit JARVIS, of zelf ingevuld)
    wilWakker: false,       // scherm aan gevraagd: na slaapstand vraagt ze het zelf opnieuw
    metingen: {},           // adres -> { health: {...}, status: {...}, gezien, jarvisNietTot }
    staten: {},             // adres -> { bereikbaar, bezig, uitTot, vervangen, hitteStand, laatstGebruikt }
    kernActiviteit: {},
    postbusVers: null,      // 487: het nieuwste postbus-adres van de baas, ALLEEN in het geheugen
    samen: null,            // 485: { trede, voorstellen, kennisboek } van de baas
    afnemers: null,         // 485: wie gebruikt de rekenkracht (getallen)
    nalees: null,           // 483: { lijst, t, verstuurd } van de baas (concepten om na te lezen), of null
    nachtlog: [],           // 483: de nachtproef van de baas (regels van een kwartier), ook in de opslag van deze computer
    denkerPlan: null,       // 481: { telefoon, tekst, t } uit stand.json van de baas     // naam -> { tekst, label, t } (uit stand.json van de hoofdtelefoon)
    zonStroom: null,        // { rijen, staaf } (uit stand.json; Veronica rekent de zon niet zelf)
    karakter: 'hulpdienst', // haar karakter (kern.js: veronicaZin); 'zakelijk' = zonder
    taken: [],
    aan: false,
    bureau: true,           // Claude-bureau (de rekenbrug) aan/uit; standaard aan. Pantser moet daarnaast aan staan.
    snelheid: {},           // adres -> gemeten tokens per seconde (voortschrijdend)
    klusMs: {},             // adres -> hoe lang de laatste klus duurde
    snelheidProef: {},      // adres -> wanneer de korte snelheidstest voor het laatst liep
    beloften: new Map(),    // taakId -> { resolve, reject } (alleen Claude-klussen; nooit opgeslagen)
    rem: Pool.maakRem(() => Date.now()),
    tellers: { klussen: 0, gelukt: 0, mislukt: 0, verdrongen: 0, tokens: 0, ms: 0, soort: {} },
    stromen: new Map(),     // adres -> { ctrl, taakId, reden }
    live: {},               // adres -> tekst die nu binnenkomt (van Veronica's eigen werk)
    scherm: {},             // adres -> { code, url, aan }
    log: [],
    testUitslag: {},
    nulmeting: {},          // 462: adres -> { loopt, zin, uitslag }
    installQr: {},
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
    let r = null, fout = null;
    try {
      r = await fetch(url, Object.assign({ cache: 'no-store', signal: ctrl.signal }, K.lnaOpties(url), init || {}));
    } catch (e) { fout = e; } finally { clearTimeout(klok); }
    // 500: een ROEP die over het wifi niet aankwam (geen antwoord) gaat via de brievenbus naar diezelfde telefoon.
    // 514: eerst via de POSTBUS (een telefoon die wel antwoordt legt hem in de opdrachtenbak van de ander); de brievenbus is de terugval.
    if (fout && /\/jarvis\/roep$/.test(String(url)) && init && init.method === 'POST') {
      const pb = await roepViaPostbus(url, init.body);
      if (pb) return pb;
      const via = await roepViaBrievenbus(url, init.body);
      if (via) return via;
    }
    if (fout) throw fout;
    return r;
  }
  // ---- 500: DE HARTSLAG EN DE ROEP VIA DE BRIEVENBUS (hartslag.js, byte-gelijk met JARVIS) ----
  // HB: per toestel-id de laatste hartslag. Komt via dezelfde ene verbinding als de ledenbrief (ledenStroom).
  const HB = { per: {}, viaPost: 0 };
  const NtfyGeefV = { per: {}, mijn: null, mijnVan: '' };   // 508: wie kreeg wanneer de brievenbus van Veronica (zie geefNtfy)
  function hartslagVoorAdres(adres) {
    let host = '';
    try { host = new URL(adres).hostname; } catch (e) { return null; }
    let beste = null;
    for (const h of Object.values(HB.per)) if (h.adressen.includes(host) && (!beste || h.t > beste.t)) beste = h;
    if (beste) return beste;
    const lid = LB.brief && LB.brief.leden.find((l) => l.host === host);
    return lid && lid.id && HB.per[lid.id] ? HB.per[lid.id] : (lid && lid.id ? { id: lid.id, naam: lid.naam } : null);
  }
  async function roepViaBrievenbus(url, lijf) {
    const o = S.ntfy && S.ntfy.onderwerp;
    if (!o || !S.code || !window.Hartslag || volLokaal()) return null;
    let d;
    try { d = JSON.parse(String(lijf || '{}')); } catch (e) { return null; }
    const h = hartslagVoorAdres(url);
    const naar = h && h.id ? h.id : (window.Hartslag.VOOR_IEDEREEN.includes(d.soort) ? '*' : null);
    if (!naar) return null;
    const v = await window.Hartslag.roepVerzoek(o, Object.assign({}, d, { naar }), S.code, nu());
    if (!v) return null;
    try {
      const r = await fetch(v.url, { method: 'POST', body: v.data, cache: 'no-store' });
      if (!r.ok) return null;
    } catch (e) { return null; }
    HB.viaPost += 1;
    logRegel(`Over het wifi kwam ${d.soort} niet aan bij ${h && h.naam ? h.naam : 'de telefoons'}; ik legde het in de brievenbus. De telefoon haalt het binnen een minuut op.`);
    const antwoord = { ok: true, brievenbus: true, zin: 'Via de brievenbus: de telefoon haalt het binnen een minuut op.' };
    return { ok: true, status: 202, brievenbus: true, json: async () => antwoord, text: async () => JSON.stringify(antwoord) };
  }
  // ---- 514: DE POSTBUS ALS ONTMOETINGSPLEK (ontmoet.js, byte-gelijk met JARVIS) ----
  // Veronica leest de postbus NIET zelf (geen CORS op de opslag, 483): ze ziet de plekken via een telefoon die ze wel bereikt (zijn
  // stand.json, achter de code) en laat een roep voor een telefoon die ze niet bereikt door die telefoon in de opdrachtenbak leggen
  // (roep 'doorgeef'). Alleen in het geheugen; geen adres van de postbus.
  const OM = { per: {}, door: {}, t: 0 };   // per toestel-id: zijn hart; door: via welke telefoon (adres) en wanneer
  function neemOntmoetOver(o, adres) {
    if (!o || typeof o !== 'object' || !window.Ontmoet || !Array.isArray(o.harten)) return;
    const tijd = nu();
    for (const ruw of o.harten.slice(0, window.Ontmoet.AANTAL)) {
      const h = window.Ontmoet.leesHart(Object.assign({}, ruw, { v: 1 }));
      if (!h || h.soort !== 'jarvis') continue;
      const oud = OM.per[h.id];
      if (!oud || oud.t <= h.t) OM.per[h.id] = h;
      OM.door[h.id] = { adres, t: tijd };
    }
    OM.t = tijd;
  }
  function ontmoetVoorAdres(adres) {
    let host = '';
    try { host = new URL(adres).hostname; } catch (e) { return null; }
    let beste = null;
    for (const h of Object.values(OM.per)) if (h.adressen.includes(host) && (!beste || h.t > beste.t)) beste = h;
    return beste;
  }
  // Een levend hart in de postbus voor deze telefoon (op id, anders op adres).
  function ontmoetLevend(t) {
    const h = (t && t.id && OM.per[t.id]) || (t ? ontmoetVoorAdres(t.adres) : null);
    return h && window.Ontmoet && window.Ontmoet.levend(h, nu()) ? h : null;
  }
  // Een roep voor toestel `naar` via een ANDERE telefoon die nu wel antwoordt en de ander in de postbus ziet.
  async function doorgeefNaarId(naar, roep) {
    if (!naar || !S.code || !roep || roep.soort === 'doorgeef' || !OM.per[naar] || volLokaal()) return false;
    const doel = OM.per[naar];
    const via = S.telefoons.filter((t) => t.jarvis && staat(t.adres).bereikbaar === true && t.id !== naar
      && !doel.adressen.some((a) => { try { return new URL(t.adres).hostname === a; } catch (e) { return false; } }));
    via.sort((a, b) => (OM.door[naar] && OM.door[naar].adres === b.adres ? 1 : 0) - (OM.door[naar] && OM.door[naar].adres === a.adres ? 1 : 0));
    for (const t of via.slice(0, 3)) {
      try {
        const r = await fetch(`${t.jarvis}/jarvis/roep`, Object.assign({ method: 'POST', headers: { 'X-Koppelcode': S.code }, cache: 'no-store',
          body: JSON.stringify({ soort: 'doorgeef', van: 'veronica', naar, roep: Object.assign({}, roep, { van: 'veronica' }) }) }, K.lnaOpties(t.jarvis)));
        if (r.ok) return true;
      } catch (e) { /* de volgende */ }
    }
    return false;
  }
  async function roepViaPostbus(url, lijf) {
    let d;
    try { d = JSON.parse(String(lijf || '{}')); } catch (e) { return null; }
    const h = ontmoetVoorAdres(url) || (() => { const x = hartslagVoorAdres(url); return x && x.id && OM.per[x.id] ? OM.per[x.id] : null; })();
    if (!h || !(await doorgeefNaarId(h.id, d))) return null;
    OM.viaPost = (OM.viaPost || 0) + 1;
    logRegel(`Over het wifi kwam ${d.soort} niet aan bij ${h.naam || 'de telefoon'}; een andere telefoon legde het in de postbus. Hij neemt het binnen drie minuten over.`);
    const antwoord = { ok: true, postbus: true, zin: 'Via de postbus: de telefoon neemt het binnen drie minuten over.' };
    return { ok: true, status: 202, postbus: true, json: async () => antwoord, text: async () => JSON.stringify(antwoord) };
  }
  function hartslagVers(t) {
    const h = (t && t.id && HB.per[t.id]) || (t ? hartslagVoorAdres(t.adres) : null);
    return !!(h && h.t && nu() - h.t <= K.HARTSLAG_VERS_MS);
  }
  async function hartslagRegel(o, regel) {
    if (!window.Hartslag) return false;
    const h = await window.Hartslag.leesHartslag(o, regel);
    if (!h) return false;
    const oud = HB.per[h.id];
    if (oud && oud.t >= h.t) return true;
    HB.per[h.id] = h;
    await Opslag.schrijf('hartslagen', HB.per);
    geefPostbusViaBrievenbus(h).catch(() => {});   // 504: een telefoon die zich meldt krijgt de verse code (een keer)
    herstelMotor(h).catch(() => {});   // 505: een vastgelopen motor weer op gang
    try { tekenLive(); } catch (e) { /* de volgende keer */ }
    return true;
  }
  const kop = (t) => (t.sleutel ? { Authorization: `Bearer ${t.sleutel}` } : {});
  // 1.9.13 (punt 7): een vraag die misging, en dan nakijken WAT er mis is: is de telefoon er wel?
  // t0 = wanneer de vraag begon, ms = hoe lang hij mocht duren.
  async function waaromGeenAntwoord(adres, t0, ms) {
    const hoofd = nu() - t0 >= ms - 250 ? 'traag' : 'snel';
    let proef = 'traag';
    const p = K.proefAdres(adres);
    if (p) {
      const t1 = nu();
      try { await haal(p, { mode: 'no-cors' }, 2500); proef = 'snel'; } catch (e) { proef = nu() - t1 < 2000 ? 'snel' : 'traag'; }
    }
    return K.geenAntwoordZin(hoofd, proef);
  }
  function zegKoppel(tekst, slecht) {
    // 1.9.14: dezelfde zin ook in de eerste kaart, waar je kijkt terwijl je scant.
    for (const vak of [$('koppelMelding'), $('scanMelding')]) {
      vak.textContent = tekst;
      vak.classList.toggle('slecht', !!slecht);
    }
  }

  // ---- Meten ----
  // 457: gevonden andere adressen onthouden we per telefoon-naam, zodat het logboek niet bij elke lijst van de baas opnieuw hetzelfde meldt.
  const adresGelogd = new Set();
  async function gezondAdres(t, adres, motor) {
    try {
      // 460b: de eigen motor van JARVIS praat met de rij-code als Bearer-token; OlliteRT met zijn eigen sleutel (als die er is).
      const r = await haal(`${adres}/health?metrics=true`, { headers: motor ? { Authorization: `Bearer ${S.code}` } : kop(t) }, 2500);
      if (!r.ok) return null;
      return K.leesHealth(await r.json(), nu(), motor ? 'JARVIS-motor /health (tokens per seconde geschat)' : undefined);
    } catch (e) { return null; }
  }
  // 460: is er een VERSE melding van JARVIS op die telefoon? Een oude melding bewijst niets: de telefoon kan er sindsdien uit zijn.
  const jarvisVers = (st, tijd) => !!st && Object.values(st).some((x) => x && typeof x.t === 'number' && tijd - x.t <= K.MAX_LEEFTIJD_MS);
  // 460: een JARVIS van voor 1.9.25 kan niet zeggen WELKE van de drie het is (niet geinstalleerd / server niet gestart / geen model).
  function oudeJarvisZin(status) {
    const v = status && status.versie && status.versie.waarde;
    const oud = typeof v === 'string' && K.vergelijkVersie(v, '1.9.25') < 0;
    const gem = status && status.gemma && status.gemma.waarde && status.gemma.waarde.ollite;
    if (gem && gem.zin) return gem.zin;
    return oud ? `Deze JARVIS (versie ${v}) kan nog niet zeggen welke van de drie het is: OlliteRT niet geïnstalleerd, de server niet gestart, of geen model geladen. Na de update naar 1.9.25 (aan de lader, scherm uit) staat hier precies wat het is.` : 'Is OlliteRT geïnstalleerd, staat de server aan en is er een model geladen?';
  }
  async function meetTelefoon(t) {
    let m = meet(t.adres);
    let s = staat(t.adres);
    const eerderBereikbaar = s.bereikbaar === true;
    const h = await gezondAdres(t, t.adres, t.motor === true);
    if (h) { m.health = h; m.gezien = nu(); s.bereikbaar = true; }
    else s.bereikbaar = false;   // de oude metingen blijven staan en worden vanzelf grijs
    if (!(m.jarvisNietTot > nu())) {
      try {
        const r = await haal(`${t.jarvis}/jarvis/status`, {}, 2000);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        m.status = K.leesStatus(await r.json(), nu());
      } catch (e) { m.jarvisNietTot = nu() + 60000; }   // geen JARVIS (of even weg): een minuut niet vragen
      geefNtfy(t, m.status).catch(() => {});   // 508: een andere of geen brievenbus = de hare geven
      rekVanzelf(t, m.status).catch(() => {});   // 515: achterlopen = laten kijken; werker zonder motor = motor aan
    }
    // 460b: OlliteRT zwijgt maar de EIGEN MOTOR van JARVIS is klaar -> dan gaat deze telefoon voortaan via de motor (poort uit de melding,
    // de rij-code als sleutel). Een telefoon die al op zijn motor staat wordt gewoon via de motor gemeten.
    if (s.bereikbaar === false && S.code && jarvisVers(m.status, nu())) {
      const ma = K.motorAdres(t, m.status);
      if (ma && ma !== t.adres) {
        const hm = await gezondAdres(t, ma, true);
        if (hm) {
          const oud = t.adres;
          S.metingen[ma] = Object.assign(S.metingen[ma] || {}, m, { health: hm, gezien: nu() });
          S.staten[ma] = Object.assign(S.staten[ma] || {}, s, { bereikbaar: true });
          t.adres = ma; t.sleutel = S.code; t.motor = true;
          m = S.metingen[ma]; s = S.staten[ma];
          const sl = `${t.naam}|motor|${ma}`;
          if (!adresGelogd.has(sl)) { adresGelogd.add(sl); logRegel(`${t.naam}: rekent met de eigen motor van JARVIS (${ma.slice(7)}). OlliteRT is niet nodig.`); }
          try { await Opslag.schrijf('telefoons', S.telefoons); } catch (e) { /* volgende keer */ }
          void oud;
        }
      }
    }
    // 457: het adres zwijgt maar JARVIS antwoordt -> de andere adressen proberen, hoogstens vier tegelijk.
    if (s.bereikbaar === false && jarvisVers(m.status, nu())) {
      const kand = K.alternatieveAdressen(t, m.status);
      for (let i = 0; i < kand.length && s.bereikbaar === false; i += 3) {
        const uit = await Promise.all(kand.slice(i, i + 3).map(async (a) => ({ a, h: await gezondAdres(t, a) })));
        const goed = uit.find((x) => x.h);
        if (!goed) continue;
        const oud = t.adres;
        const sleutelOud = `${oud}`;
        // De metingen verhuizen mee met het adres.
        S.metingen[goed.a] = Object.assign(S.metingen[goed.a] || {}, m, { health: goed.h, gezien: nu() });
        S.staten[goed.a] = Object.assign(S.staten[goed.a] || {}, s, { bereikbaar: true });
        t.adres = goed.a;
        m = S.metingen[goed.a]; s = S.staten[goed.a];
        const sl = `${t.naam}|${sleutelOud}|${goed.a}`;
        if (!adresGelogd.has(sl)) {
          adresGelogd.add(sl);
          logRegel(`${t.naam}: het doorgegeven adres gaf geen antwoord. Ik heb het gevonden op ${goed.a.slice(7)} en gebruik dat nu.`);
        }
        try { await Opslag.schrijf('telefoons', S.telefoons); } catch (e) { /* volgende keer */ }
      }
      if (s.bereikbaar === false) {
        const sl = `${t.naam}|zwijgt`;
        if (!adresGelogd.has(sl)) { adresGelogd.add(sl); logRegel(`${t.naam}: JARVIS antwoordt wel, maar OlliteRT niet op ${kand.length ? 'de adressen die ik probeerde' : 'dit adres'}. ${oudeJarvisZin(m.status)}`); }
      } else adresGelogd.delete(`${t.naam}|zwijgt`);
    }
    const st = m.status || {};
    const vers = (x) => (x && nu() - x.t <= K.MAX_LEEFTIJD_MS ? x.waarde : null);
    s.hitteStand = K.ruweStand({ headroom: vers(st.headroom), temperatuur: vers(st.temperatuur), hitte: vers(st.hitte) });
    // 456b: zodra een telefoon (weer) antwoordt: temperatuur en accu in het logboek, zodat je later kunt zien hoe warm hij was.
    if (!eerderBereikbaar && s.bereikbaar === true) {
      const tp = vers(st.temperatuur), ac = vers(st.batterij);
      logRegel(`${t.naam} antwoordt${tp !== null || ac !== null ? ':' : '.'}${tp !== null ? ` ${String(Math.round(tp * 10) / 10).replace('.', ',')} °C` : ''}${tp !== null && ac !== null ? ',' : ''}${ac !== null ? ` accu ${Math.round(ac)}%` : ''}${tp !== null || ac !== null ? '.' : ''}`);
    }
  }
  // Het JARVIS-adres dat ze nu volgt (stand.json, koppeltoken, het adres in de QR).
  const kernNu = () => S.actieveKern || S.kern;
  async function leesStand(adres) {
    try {
      const r = await haal(`${adres}/stand.json`, { headers: { 'X-Koppelcode': S.code } }, 2500);
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }
  async function meetKern() {
    if (!S.kern || !S.code) return;
    let adres = S.kern;
    let d = await leesStand(S.kern);
    let via = null;
    // De hoofdtelefoon is weg (hij is de deur uit): eerst wie ze al volgde, dan de rek-telefoon
    // die ZELF zegt dat hij baas is. Die kent de code van de hoofdtelefoon ook (de rij-code).
    if (!d && S.actieveKern && S.actieveKern !== S.kern) { d = await leesStand(S.actieveKern); if (d) adres = S.actieveKern; }
    if (!d) {
      const b = K.baasUitStatus(S.telefoons, S.metingen, nu(), S.kern);
      if (b) { d = await leesStand(b.adres); if (d) { adres = b.adres; via = b.naam; } }
    }
    if (!d) { await rondvragen(); return; }   // niemand antwoordt: rondvragen, en doorgaan met wat ze weet
    stilSinds = nu();
    S.baasGezien = nu();   // 450: de baas antwoordt (voor de uitleg als zijn telefoons niet antwoorden)
    await lijstTik(adres);
    if (adres === S.kern) S.kernGezien = nu();
    if (adres === S.kern && S.actieveKern && S.actieveKern !== S.kern) logRegel(K.veronicaZin(S.karakter, 'kernTerug'));
    else if (via && S.actieveKern !== adres) logRegel(K.veronicaZin(S.karakter, 'volgt', { naam: via }) || `Baas nu: ${via}.`);
    S.actieveKern = adres;
    const act = {};
    for (const a of Array.isArray(d.activiteit) ? d.activiteit : []) {
      if (a && a.telefoon && !a.klaar) act[a.telefoon] = { tekst: String(a.tekst || ''), label: String(a.label || ''), t: nu() };
    }
    S.kernActiviteit = act;
    // 481 (stap C): het laatste plan van de denker (alleen tekst, hoogstens 600 tekens), voor onder zijn tegel.
    S.denkerPlan = d.plan && typeof d.plan === 'object' && typeof d.plan.tekst === 'string' && d.plan.tekst.trim()
      ? { telefoon: String(d.plan.telefoon || '').slice(0, 60), tekst: d.plan.tekst.slice(0, 600), t: Number(d.plan.t) || nu() } : null;
    const zs = K.leesZonStroom(d.zonStroom, nu());
    if (zs) S.zonStroom = zs;
    if (Array.isArray(d.nachtlog)) neemNachtlogOver(d.nachtlog);   // 483
    S.nalees = K.leesNalees(d.nalees); tekenNalees();   // 483
    S.afnemers = window.Afnemers ? window.Afnemers.lees(d.afnemers) : null; S.samen = K.leesSamenwerken(d.samenwerken); tekenSamenwerken();   // 485
    S.nieuwKoppel = K.leesNieuwKoppel(d.nieuwKoppel); tekenNieuwKoppel();   // 494
    neemOntmoetOver(d.ontmoet, adres);   // 514
  }
  // 482 (17 oktober): DE LEDENBRIEF. De baas legt de leden met hun adressen versleuteld klaar op de brievenbus (ntfy), met het
  // geheime ntfy-onderwerp van de rij als sleutel (kern.js, leesLedenBrief). EEN doorlopende verbinding (449: nooit vragen in
  // een lus). Een nieuwe brief = meteen rondvragen op die adressen. Veronica luistert zelf NIET op Bluetooth.
  const LB = { brief: null, stroom: null, onderwerp: '', wachtTot: 0, fouten: 0 };
  async function ledenStroom() {
    if (volLokaal()) return;   // 483: de ledenbrief komt via internet (ntfy)
    const o = S.ntfy && S.ntfy.onderwerp;
    if (!o || typeof fetch !== 'function') return;
    if (LB.stroom && LB.stroom.loopt && LB.onderwerp === o) return;
    if (nu() < LB.wachtTot && LB.onderwerp === o) return;
    if (LB.stroom && LB.stroom.loopt) LB.stroom.ctrl.abort();
    LB.onderwerp = o;
    const st = LB.stroom = { loopt: true, ctrl: new AbortController() };
    let fout = false;
    try {
      const topic = await K.ledenOnderwerp(o);
      if (!topic) return;
      const hartTopic = window.Hartslag ? await window.Hartslag.onderwerp(o, 'hartslag') : null;   // 500: de hartslagen op dezelfde verbinding
      const sinds = Math.floor(nu() / 1000) - 12 * 3600;
      const r = await fetch(K.briefStroomUrl(hartTopic ? [topic, hartTopic] : [topic], sinds), { signal: st.ctrl.signal, cache: 'no-store' });
      if (!r.ok) fout = true;
      else if (r.body && r.body.getReader) {
        const lezer = r.body.getReader(), dec = new TextDecoder();
        let rest = '';
        for (;;) {
          const { value, done } = await lezer.read();
          if (done) break;
          rest += dec.decode(value, { stream: true });
          const regels = rest.split('\n');
          rest = regels.pop();
          for (const regel of regels) await ledenRegel(o, regel);
        }
        if (rest.trim()) await ledenRegel(o, rest);
      } else for (const regel of (await r.text()).split('\n')) await ledenRegel(o, regel);
    } catch (e) { if (!st.ctrl.signal.aborted) fout = true; }
    finally {
      st.loopt = false;
      if (!st.ctrl.signal.aborted) { LB.fouten = fout ? LB.fouten + 1 : 0; LB.wachtTot = nu() + (fout ? Math.min(300000, 10000 * 2 ** Math.min(5, LB.fouten)) : 2000); }
    }
  }
  async function ledenRegel(o, regel) {
    if (await hartslagRegel(o, regel)) return;   // 500
    const b = await K.leesLedenBrief(o, regel);
    if (!b || (LB.brief && b.t <= LB.brief.t)) return;
    LB.brief = b;
    await Opslag.schrijf('ledenbrief', b);
    logRegel(`De baas meldde waar de telefoons zitten (${b.leden.length}). Ik kijk daar, en zoek niets af.`);
    if (!S.telefoons.some((t) => staat(t.adres).bereikbaar === true)) rondvragen(true);
  }
  // RONDVRAGEN (na een netwerkwissel, of als de hoofdtelefoon en de baas zwijgen): elk adres dat
  // ze kent, tot er iemand antwoordt. Die geeft (met de code) de lijst van nu: telefoons, leden en
  // hun adressen. Hoogstens eens per vijftien seconden, vier tegelijk.
  let rondT = 0;
  let stilSinds = nu();
  async function rondvragen(dwing) {
    if (!S.code || (!dwing && nu() - rondT < 15000)) return;
    rondT = nu();
    const lijst = K.metHartslagen(K.metLedenBrief(K.rondvraagLijst(S), LB.brief, nu()), HB.per, nu());   // 482: de ledenbrief eerst; 500: verse hartslagen nog daarvoor
    let gevonden = null;
    for (let i = 0; i < lijst.length && !gevonden; i += 4) {
      const uit = await Promise.all(lijst.slice(i, i + 4).map(async (a) => {
        try { const r = await haal(`${a}/jarvis/vertrouwd`, { headers: { 'X-Koppelcode': S.code } }, 2000); return r.ok ? { a, d: await r.json() } : null; } catch (e) { return null; }
      }));
      gevonden = uit.find(Boolean) || null;
    }
    const v = $('vindUitleg');
    if (!gevonden) {
      // 476: na twee stille rondes (ruim 20 s) zoekt Veronica de telefoons ZELF opnieuw op het netwerk (ander wifi).
      // Die zoeker zet zijn eigen zin in hetzelfde vak; zolang hij loopt blijft die staan.
      // 482: met een VERSE ledenbrief zoekt ze niets af: de baas zei net waar iedereen zit. Antwoordt dan niemand, dan zit
      // deze computer op een ander netwerk; afzoeken helpt daar niet.
      if (gekoppeld() && !HZ.bezig && !K.ledenBriefVers(LB.brief, nu()) && nu() - stilSinds >= HZ.NA_MS && nu() - HZ.laatst >= HZ.TUSSEN_MS && !K.hartslagVers(HB.per, nu())) { herstelZoek(); return; }
      if (HZ.bezig) return;
      const u = K.vindUitleg({ gekoppeld: !!S.code, bereikbaar: 0, stilMs: nu() - stilSinds, geprobeerd: lijst.length });
      if (v) { v.textContent = u; v.hidden = !u; }
      return;
    }
    await verwerkGevonden(gevonden);
  }
  // Iemand antwoordde met de code (rondvragen of de herstelzoeker): zijn lijst overnemen.
  async function verwerkGevonden(gevonden) {
    const v = $('vindUitleg');
    stilSinds = nu();
    if (v) v.hidden = true;
    const l = K.leesVertrouwd(gevonden.d);
    // 450: antwoordde de baas zelf (zijn oude adres), dan is DAT zijn adres -- niet wat hij over zichzelf zegt.
    const kernOud = l.telefoons.find((t) => t.kern);
    if (kernOud && S.kern && gevonden.a === S.kern) l.telefoons = K.herstelKernAdres(l.telefoons, gevonden.a);
    // 452b: de stekkers komen ALLEEN van de baas. Antwoordt een werker (de baas is weg), dan is zijn lijst van stekkers leeg
    // en zou Veronica ze allemaal vergeten.
    if (l.rol === 'baas') await neemStekkersOver(l);
    if (l.telefoons.length) {
      S.telefoons = l.telefoons;
      await Opslag.schrijf('telefoons', S.telefoons);
      // De hoofdtelefoon kan een nieuw adres hebben (een hotspot kiest vaak een ander subnet).
      const kern = l.telefoons.find((t) => t.kern);
      if (kern && kern.jarvis !== S.kern) { S.kern = kern.jarvis; await Opslag.schrijf('kern', S.kern); }
    }
    S.bekend = K.voegBekendToe(S.bekend, [gevonden.a].concat(l.bekend, l.kern ? [l.kern] : []));
    await Opslag.schrijf('bekend', S.bekend);
    if (l.ntfy) { S.ntfy = l.ntfy; await Opslag.schrijf('ntfy', S.ntfy); tekenNtfy(); }
    await neemUpdateSleutelOver(l.updateSleutel, l.updateRepo);
    if (S.actieveKern !== gevonden.a) logRegel(`Gevonden via ${gevonden.a.slice(7)}. Ik kijk weer mee.`);
    S.actieveKern = gevonden.a;
    vulVervang();
  }
  // ---- 476: DE HERSTELZOEKER (ander wifi) ----
  // Antwoordt geen enkel onthouden adres meer, dan zoekt Veronica de telefoons opnieuw: /jarvis/vertrouwd met de code op
  // elk adres van het eigen net, dan de gangbare thuisnetten, het oude net als laatste (K.herstelPlan). Acht tegelijk,
  // 1,2 s per adres, de eerste treffer geeft de hele lijst (met de nieuwe adressen). Hoogstens eens per drie minuten.
  // HZ.proefAdressen: alleen voor de test (een lijst in plaats van het echte zoekplan).
  const HZ = { bezig: false, jarvis: 0, laatst: 0, NA_MS: 20000, TUSSEN_MS: 180000, proefAdressen: null, gescand: 0, laatsteUitslag: null };
  function toonVind(tekst) { const v = $('vindUitleg'); if (v) { v.textContent = tekst; v.hidden = !tekst; } }
  async function herstelZoek() {
    if (HZ.bezig || !gekoppeld()) return null;
    HZ.bezig = true; HZ.laatst = nu(); HZ.gescand = 0;
    try {
      let eigen = [];
      try { eigen = await eigenAdressen(); } catch (e) { eigen = []; }
      const plan = K.herstelPlan({ eigen, bekend: K.rondvraagLijst(S) });
      const adressen = Array.isArray(HZ.proefAdressen) ? HZ.proefAdressen.slice() : plan.adressen;
      const zinZoekt = K.herstelZin('zoekt', plan);
      toonVind(zinZoekt); logRegel(zinZoekt);
      // 480 (17 oktober, het echte huis na een andere router): in TWEE stappen. Eerst /jarvis/status ZONDER kop: een "eenvoudig"
      // verzoek, dus zonder OPTIONS-voorvraag (die bleef in 449 hangen) en de helft van het verkeer. Alleen een adres dat
      // als JARVIS antwoordt krijgt daarna de vraag MET de code. Zestien tegelijk: een leeg adres kost alleen wachten.
      let i = 0, gevonden = null;
      const probeer = async (a) => {
        try {
          const s = await haal(`${a}/jarvis/status`, {}, 1200);
          if (!s.ok) return;
        } catch (e) { return; }   // geen JARVIS op dit adres
        HZ.jarvis += 1;
        try {
          const r = await haal(`${a}/jarvis/vertrouwd`, { headers: { 'X-Koppelcode': S.code } }, 3000);
          if (r.ok && !gevonden) gevonden = { a, d: await r.json() };
        } catch (e) { /* een JARVIS, maar niet van ons (of hij zweeg) */ }
      };
      const werker = async () => {
        while (!gevonden && i < adressen.length && !Bijwerk.nieuw) {
          const a = adressen[i++];
          HZ.gescand += 1;
          await probeer(a);
        }
      };
      HZ.jarvis = 0;
      await Promise.all(Array.from({ length: 16 }, werker));
      if (!gevonden) {
        const zin = K.herstelZin('niets', { aantal: HZ.gescand, jarvis: HZ.jarvis });
        toonVind(zin); logRegel(zin);
        HZ.laatsteUitslag = { gevonden: false, gescand: HZ.gescand, t: nu() };
        return null;
      }
      await verwerkGevonden(gevonden);
      const zin = K.herstelZin('gevonden', { net: K.netVan(gevonden.a), namen: S.telefoons.map((t) => t.naam) });
      logRegel(zin); toonVind(zin);
      setTimeout(() => { if ($('vindUitleg') && $('vindUitleg').textContent === zin) toonVind(''); }, 60000);
      HZ.laatsteUitslag = { gevonden: true, adres: gevonden.a, gescand: HZ.gescand, t: nu() };
      if (VQ.herstel) {
        const waar = VQ.herstelWaar;
        VQ.herstel = false; VQ.herstelReden = ''; VQ.herstelWaar = 'koppel';
        if (waar === 'nieuw' && !$('nieuwQrPaneel').hidden) { $('nieuwQrBeeld').replaceChildren(); toonNieuweTelefoonQr('nieuw'); }
        else if (!$('scherm-koppel').hidden) { $('koppelQrBeeld').replaceChildren(); toonNieuweTelefoonQr('koppel'); }
      }
      meetRonde();
      return gevonden.a;
    } finally { HZ.bezig = false; }
  }
  // ---- 476c: ZOEKEN OVER DE TELEFOONS ----
  // De telefoons die nu een deelvraag mogen doen: bereikbaar (of JARVIS meldde zich vers) en met een JARVIS-adres.
  let zoeker = null;
  function zoekTelefoons() {
    return S.telefoons.filter((t) => t.jarvis && (staat(t.adres).bereikbaar === true || jarvisVers(meet(t.adres).status, nu())))
      .map((t) => ({ id: t.adres, naam: t.naam, host: (/^http:\/\/([^:/]+)/.exec(t.jarvis) || [])[1] || '' })).filter((t) => t.host);
  }
  // 481 (stap D): een telefoon met het geheugenmodel klaar (en niet gespaard) rekent de vectoren. Alleen met de rij-code;
  // er gaat alleen tekst heen die al in het zoekgeheugen staat (openbare zoekuitslagen) of de zoekvraag zelf.
  function geheugenTelefoon() {
    const tijd = nu();
    return S.telefoons.find((t) => {
      const st = meet(t.adres).status || {};
      const mo = st.motor && tijd - st.motor.t <= K.MAX_LEEFTIJD_MS ? st.motor.waarde : null;
      return mo && mo.geheugen && mo.geheugen.klaar === true && !gespaardNu(t) && K.motorAdres(t, st);
    }) || null;
  }
  async function geheugenVanTelefoon(teksten) {
    const t = geheugenTelefoon();
    if (!t || !S.code) return null;
    const adres = K.motorAdres(t, meet(t.adres).status);
    const r = await haal(`${adres}/v1/embeddings`, { method: 'POST', headers: { Authorization: `Bearer ${S.code}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: teksten }) }, 20000);
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d && d.data) ? d.data.slice().sort((a, b) => a.index - b.index).map((x) => x.embedding) : null;
  }
  let zoekGebonden = false;
  let zoekGeheugen = null;
  function geheugenTel() {
    if (!zoekGeheugen || !$('zoekGeheugenTel')) return;
    zoekGeheugen.telling().then((n) => { $('zoekGeheugenTel').textContent = n ? `${n} eerdere resultaten onthouden, alleen op deze computer.` : 'Nog niets onthouden.'; }).catch(() => {});
  }
  function zoekBlokStart() {
    if (!window.VeronicaZoek || !$('zoekKnop')) return;
    zoeker = window.VeronicaZoek.maak({ haal, telefoons: zoekTelefoons, code: () => S.code });
    if (zoekGebonden) return;   // de knoppen krijgen hun luisteraars hoogstens een keer (anders loopt een vraag dubbel)
    zoekGebonden = true;
    // 477: het zoekgeheugen (eerdere uitslagen, alleen in deze browser). Zonder het bestand werkt het zoeken gewoon.
    // 481 (stap D): het geheugenmodel van een telefoon (EmbeddingGemma op de eigen motor) als die er is; anders de woorddelen.
    zoekGeheugen = window.ZoekGeheugen ? window.ZoekGeheugen.maak({ opslag: { lees: () => Opslag.lees('zoekgeheugen'), schrijf: (t) => Opslag.schrijf('zoekgeheugen', t) },
      bron: { naam: 'embeddinggemma-256', embed: geheugenVanTelefoon } }) : null;
    geheugenTel();
    const doe = async () => {
      const knop = $('zoekKnop'), stand = $('zoekStand'), uit = $('zoekUitslag');
      knop.disabled = true; stand.textContent = 'Even zoeken…'; uit.replaceChildren();
      let u = null;
      if (volLokaal()) { knop.disabled = false; stand.textContent = 'Vol lokaal staat aan: zoeken op internet doe ik nu niet. Zet het uit in Mijn privé-hoek.'; return; }
      try { u = await zoeker.zoek($('zoekVraag').value, { soort: $('zoekSoort') ? $('zoekSoort').value : 'algemeen' }); } catch (e) { u = { ok: false, zin: 'Zoeken lukte niet. Probeer het zo nog eens.' }; }
      knop.disabled = false;
      if (zoekGeheugen && u && u.ok && u.samengevoegd && u.samengevoegd.length) { try { await zoekGeheugen.onthoud(u); geheugenTel(); } catch (e) { /* het geheugen is een gemak */ } }
      tekenZoekUitslag(u);
      // Lukte het zoeken niet (geen telefoon bereikbaar, oude JARVIS): kijk dan toch in wat eerder is gevonden.
      if (zoekGeheugen && (!u || !u.ok || !u.samengevoegd.length) && !(u && u.geweigerd)) await toonGeheugen(true);
    };
    const toonGeheugen = async (alsAanvulling) => {
      const stand = $('zoekStand'), uit = $('zoekUitslag');
      if (!zoekGeheugen) return;
      let lijst = [];
      try { lijst = await zoekGeheugen.zoek($('zoekVraag').value, 8); } catch (e) { lijst = []; }
      if (!alsAanvulling) { uit.replaceChildren(); stand.textContent = lijst.length ? `${lijst.length} eerdere ${lijst.length === 1 ? 'resultaat' : 'resultaten'} gevonden in het geheugen.` : 'Hier staat nog niets over in het geheugen.'; }
      else if (lijst.length) { const e = document.createElement('p'); e.className = 'klein'; e.textContent = 'Wat eerder is gevonden (uit het geheugen):'; uit.appendChild(e); }
      for (const r of lijst) {
        const kaart = document.createElement('div'); kaart.className = 'zoekRes';
        const k = document.createElement('b'); k.textContent = r.titel; kaart.appendChild(k);
        if (r.tekst) { const t = document.createElement('div'); t.textContent = r.tekst; kaart.appendChild(t); }
        const b = document.createElement('div'); b.className = 'klein';
        const dag = r.t ? new Date(r.t).toLocaleDateString('nl-NL') : 'eerder';
        b.textContent = `Uit het geheugen, gevonden op ${dag} bij "${r.term}" · Bron: ${r.bronnen.join(', ')} · ${r.url}`; kaart.appendChild(b);
        uit.appendChild(kaart);
      }
    };
    $('zoekKnop').addEventListener('click', () => { doe(); });
    $('zoekVraag').addEventListener('keydown', (e) => { if (e.key === 'Enter') doe(); });
    if ($('zoekGeheugenKnop')) $('zoekGeheugenKnop').addEventListener('click', () => { toonGeheugen(false); });
    if ($('zoekGeheugenWis')) $('zoekGeheugenWis').addEventListener('click', async () => {
      if (!zoekGeheugen) return;
      if (!window.confirm('Alles wissen wat Veronica onthouden heeft van eerdere zoekvragen? Dit staat alleen op deze computer.')) return;
      await zoekGeheugen.wisAlles(); geheugenTel(); $('zoekUitslag').replaceChildren(); $('zoekStand').textContent = 'Het zoekgeheugen is leeg.';
    });
  }
  // Alles als PLATTE TEKST (textContent): geen aanklikbare adressen, niets wordt geopend.
  function tekenZoekUitslag(u) {
    const stand = $('zoekStand'), uit = $('zoekUitslag');
    uit.replaceChildren();
    const p = (tekst, klasse) => { const e = document.createElement('p'); if (klasse) e.className = klasse; e.textContent = tekst; uit.appendChild(e); return e; };
    if (!u || !u.ok) { stand.textContent = (u && u.zin) || 'Zoeken lukte niet.'; return; }
    stand.textContent = u.samengevoegd.length ? `${u.aantal} ${u.aantal === 1 ? 'resultaat' : 'resultaten'} voor "${u.term}".` : (u.zin || 'Ik vond niets.');
    for (const d of u.delen) {
      p(`${d.naam}: ${d.ok && !d.reden ? `${d.aantal} gevonden${d.telefoon ? `, opgehaald door ${d.telefoon}` : ''}${d.uitGeheugen ? ' (uit het geheugen)' : ''}` : (d.zin || 'niet gelukt')}`, 'klein');
    }
    for (const r of u.samengevoegd) {
      const kaart = document.createElement('div'); kaart.className = 'zoekRes';
      const k = document.createElement('b'); k.textContent = r.titel; kaart.appendChild(k);
      if (r.tekst) { const t = document.createElement('div'); t.textContent = r.tekst; kaart.appendChild(t); }
      const b = document.createElement('div'); b.className = 'klein'; b.textContent = `Bron: ${r.bronnen.join(', ')}${r.telefonen.length ? ` · via ${r.telefonen.join(', ')}` : ''} · ${r.url}`; kaart.appendChild(b);
      uit.appendChild(kaart);
    }
    for (const m of u.meldingen || []) if (typeof m === 'string') p(m, 'klein');
    if (u.vermeldingen && u.vermeldingen.length) p(`Bronnen: ${u.vermeldingen.join(' · ')}`, 'klein');
    p(u.let_op, 'klein');
  }
  async function meetStekker(k) {
    try {
      const [a, b] = await Promise.all([haal(`http://${k.ip}/cm?cmnd=Status%208`, {}, 2500), haal(`http://${k.ip}/cm?cmnd=Power`, {}, 2500)]);
      if (!a.ok || !b.ok) throw new Error('geen antwoord');
      S.stekkerMeting[k.ip] = K.leesStekker(await a.json(), await b.json(), nu());
    } catch (e) {
      // 463b: Veronica mag een stekker alleen lezen als die CORS toestaat. Lukt het niet, dan geldt wat de BAAS meet (met zijn leeftijd).
      const b = S.zonStroom && S.zonStroom.stekkerPer ? S.zonStroom.stekkerPer[k.naam] : null;
      if (b) {
        const bron = (w) => ({ waarde: w, bron: 'Tasmota Status 8, via de hoofdtelefoon', t: b.t });
        const vorig = S.stekkerMeting[k.ip];
        if (!vorig || (vorig.watt && vorig.watt.t < b.t) || !vorig.watt) {
          S.stekkerMeting[k.ip] = { aan: b.aan === null ? null : bron(b.aan), watt: b.watt === null ? null : bron(b.watt), kwh: b.kwh === null ? null : bron(b.kwh), vandaag: b.vandaag === null ? null : bron(b.vandaag), spanning: b.spanning === null ? null : bron(b.spanning), meet: b.meet };
        }
      }
    }
  }
  let meetBezig = false;
  async function meetRonde() {
    if (meetBezig) return;
    meetBezig = true;
    try {
      await Promise.all(S.telefoons.map(meetTelefoon).concat([meetKern()], S.stekkers.map(meetStekker)));
      await lnaTik();
      karakterTik();
      tekenLive();
      werkTik();
      snelheidTik();
    } finally { meetBezig = false; }
  }

  // 450: DE LIJST VAN DE BAAS, ook op Live. Een telefoon die bij de baas is aangemeld (met zijn koppel-QR, niet die
  // van Veronica) kwam vroeger pas in Veronica als die lijst opnieuw werd opgehaald -- alleen op Koppelen, of als niemand
  // antwoordde. Nu hoogstens eens per minuut, alleen als de baas toch al antwoordt (een verzoek).
  let lijstT = 0;
  let zwareLijstT = 0;
  async function lijstTik(adres) {
    if (!S.code || nu() - lijstT < 15000) return;
    lijstT = nu();
    let l = null;
    try {
      const r = await haal(`${adres}/jarvis/vertrouwd`, { headers: { 'X-Koppelcode': S.code } }, 3000);
      if (r.ok) l = K.leesVertrouwd(await r.json());
    } catch (e) { return; }
    if (!l) return;
    // 455: alleen "er loopt een privé-klus" (een ja/nee), elke 15 s; de rest van de lijst hoogstens eens per minuut.
    if (l.rol === 'baas' && S.priveBezig !== l.priveBezig) { S.priveBezig = l.priveBezig; $('priveBezig').hidden = !l.priveBezig; }
    if (nu() - zwareLijstT < 60000) return;
    zwareLijstT = nu();
    if (l.rol === 'baas' && await neemStekkersOver(l)) tekenLive();
    if (!l.telefoons.length) return;
    l.telefoons = K.herstelKernAdres(l.telefoons, adres);
    const namen = K.nieuweNamen(S.telefoons, l.telefoons);
    const oud = JSON.stringify(S.telefoons.map((t) => [t.naam, t.adres]));
    if (oud === JSON.stringify(l.telefoons.map((t) => [t.naam, t.adres]))) return;
    S.telefoons = l.telefoons;
    await Opslag.schrijf('telefoons', S.telefoons);
    if (namen.length) logRegel(`Nieuw bij de baas: ${namen.join(', ')}.`);
    tekenLive();
  }

  // ---- Toegang tot het lokale netwerk (Chrome) ----
  let laatstBereikt = nu();
  let lnaToestemming = null;
  let lnaGevraagd = 0;
  async function lnaTik() {
    const bereikbaar = S.telefoons.filter((t) => staat(t.adres).bereikbaar).length;
    if (bereikbaar) laatstBereikt = nu();
    if (navigator.permissions && nu() - lnaGevraagd > 30000) {
      lnaGevraagd = nu();
      try { lnaToestemming = (await navigator.permissions.query({ name: 'local-network-access' })).state; } catch (e) { lnaToestemming = null; }   // oudere Chrome: kent deze naam niet
    }
    const u = K.lnaUitleg({ toestemming: lnaToestemming, online: navigator.onLine !== false, aantal: S.telefoons.length, bereikbaar, stilMs: nu() - laatstBereikt,
      baasMs: S.baasGezien ? nu() - S.baasGezien : null });
    const vak = $('lnaUitleg');
    if (vak.textContent !== u) vak.textContent = u;
    vak.hidden = !u;
  }

  // ---- WAARSCHUWEN: thuis lokaal via JARVIS, anders via ntfy (kern.js: Ntfy) ----
  // Thuis (de hoofdtelefoon antwoordde de laatste 30 s): een melding van Android op de
  // hoofdtelefoon zelf, via /jarvis/roep. Anders (hij is onderweg, op mobiele data): ntfy.
  // Hoogstens een melding per soort per vijftien minuten; gedeeld met de rek-baas via de
  // geschiedenis van het onderwerp. Geen IP-adressen in de tekst (Ntfy.schoon).
  const NtS = { laatst: {} };
  async function waarschuw(soort, tekst, dringend) {
    const tijd = nu();
    const schone = K.Ntfy.schoon(tekst);
    if (!schone) return { gestuurd: false, reden: 'leeg' };
    if (soort !== 'proef' && typeof NtS.laatst[soort] === 'number' && tijd - NtS.laatst[soort] < K.Ntfy.REM_MS) return { gestuurd: false, reden: 'rem' };
    if (soort !== 'proef' && S.kern && S.code && tijd - S.kernGezien < 30000) {
      try {
        const r = await haal(`${S.kern}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'melding', van: 'veronica', tekst: schone }) }, 3000);
        if (r.ok) { NtS.laatst[soort] = tijd; logRegel(`Gemeld op de hoofdtelefoon (thuis): ${schone}`); return { gestuurd: true, manier: 'thuis' }; }
      } catch (e) { /* dan via ntfy */ }
    }
    if (volLokaal()) return { gestuurd: false, reden: 'vol lokaal staat aan (niets naar buiten)' };
    const n = S.ntfy || {};
    const basis = { onderwerp: n.onderwerp, uit: n.aan === false, soort, nu: tijd, laatst: NtS.laatst };
    let m = K.Ntfy.magSturen(basis);
    if (!m.mag) return { gestuurd: false, reden: m.reden };
    if (soort !== 'proef') {
      let recent = new Set();
      try { const r = await haal(K.Ntfy.pollUrl(n.onderwerp), {}, 5000); if (r.ok) recent = K.Ntfy.leesRecent(await r.text()); } catch (e) { /* alleen de eigen rem */ }
      m = K.Ntfy.magSturen(Object.assign({}, basis, { recent }));
      if (!m.mag) return { gestuurd: false, reden: m.reden };
    }
    const v = K.Ntfy.verzoek({ onderwerp: n.onderwerp, soort, tekst: schone, titel: 'Veronica', dringend: !!dringend, stil: K.Ntfy.inStilleUren(new Date(tijd), n.stil) });
    try {
      const r = await haal(v.url, { method: 'POST', body: v.data }, 8000);
      if (!r.ok) return { gestuurd: false, reden: `ntfy gaf ${r.status}` };
      NtS.laatst[soort] = tijd;
      logRegel(`Waarschuwing naar je telefoon: ${schone}`);
      return { gestuurd: true, manier: 'ntfy' };
    } catch (e) { return { gestuurd: false, reden: 'geen internet' }; }
  }
  // 483: de naam (onderwerp) maakt de baas zelf aan, willekeurig (waarschuw.js, maakOnderwerp). Veronica toont hem met een QR
  // en een knop, en stuurt EEN proefmelding zodra ze een nieuwe naam leert (een keer per naam, onthouden op deze computer).
  const NtfyV = { qrVoor: '', proefBezig: false };
  function tekenNtfy() {
    const v = $('ntfyStand');
    if (!v) return;
    const n = S.ntfy;
    v.textContent = !n ? 'Waarschuwingen naar je telefoon: nog niet ingesteld. De baas-telefoon maakt de naam vanzelf aan; koppel Veronica met de baas, dan staat hij hier.'
      : `Waarschuwingen naar je telefoon: ${n.aan ? 'aan' : 'uit'}. Stille uren: ${n.stil === 'uit' ? 'geen' : n.stil}. Thuis gaat het via de hoofdtelefoon zelf.`;
    const vak = $('ntfyVak');
    if (!vak) return;
    vak.hidden = !n;
    if (!n) return;
    $('ntfyNaam').textContent = n.onderwerp;
    const link = K.Ntfy.abonneerLink(n.onderwerp);
    $('ntfyOpen').href = link || '#';
    if (NtfyV.qrVoor !== n.onderwerp && typeof window.qrcode === 'function' && link) {
      const q = window.qrcode(0, 'M'); q.addData(link); q.make();
      $('ntfyQr').src = q.createDataURL(5, 8);
      NtfyV.qrVoor = n.onderwerp;
    }
    ntfyEersteProef();
  }
  async function ntfyEersteProef() {
    const n = S.ntfy;
    if (!n || n.aan === false || NtfyV.proefBezig) return;
    NtfyV.proefBezig = true;
    try {
      if ((await Opslag.lees('ntfyProefVoor')) === n.onderwerp) return;
      const r = await waarschuw('proef', K.veronicaZin('hulpdienst', 'proef') || 'Dit is een proef. Zo ziet een waarschuwing eruit.');
      if (r && r.gestuurd) { await Opslag.schrijf('ntfyProefVoor', n.onderwerp); logRegel('Eerste proefmelding verstuurd naar de nieuwe naam. Kijk op je telefoon.'); }
    } catch (e) { /* de volgende keer */ } finally { NtfyV.proefBezig = false; }
  }

  // ---- ROEP DE RIJ OP: elk bekend adres, "meld je", en de ledenlijst ----
  // Een browser kan niet roepen op het netwerk (geen UDP, geen mDNS) en geen slapende of
  // gesloten app wakker maken. Wel: elk adres dat ze kent vragen (fetch, met targetAddressSpace),
  // en een JARVIS die draait vragen zich te melden (/jarvis/roep): die zoekt dan opnieuw, roept
  // zelf, en zet zijn OlliteRT aan als die uit stond.
  let roepT = 0;
  async function roepOp(handmatig) {
    if (!S.code) { if (handmatig) logRegel('Koppel eerst met de hoofdtelefoon.'); return null; }
    roepT = nu();
    const lijst = K.rondvraagLijst(S);
    const naamVan = (a) => (S.telefoons.find((t) => t.jarvis === a) || {}).naam || a.slice(7);
    // 452: een adres dat bij GEEN bekende telefoon hoort (een oud adres uit het geheugen, zoals het tweede netwerk van
    // een telefoon) mag niet als "geen antwoord van <telefoon>" klinken. Dat telt apart als "oud adres".
    const isTelefoon = (a) => S.telefoons.some((t) => t.jarvis === a);
    const ja = new Set();
    const nee = new Set();
    const oud = new Set();
    const oudAdres = [];
    for (let i = 0; i < lijst.length; i += 4) {
      await Promise.all(lijst.slice(i, i + 4).map(async (a) => {
        try {
          const r = await haal(`${a}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'roep', van: 'veronica', handmatig: handmatig === true }) }, 2500);
          if (!r.ok) { if (!isTelefoon(a)) oudAdres.push(a); (isTelefoon(a) ? nee : oud).add(naamVan(a)); return; }
          ja.add(naamVan(a));
          const v = await haal(`${a}/jarvis/vertrouwd`, { headers: { 'X-Koppelcode': S.code } }, 2500);
          if (v.ok) {
            const l = K.leesVertrouwd(await v.json());
            S.bekend = K.voegBekendToe(S.bekend, [a].concat(l.bekend));
            if (l.ntfy) S.ntfy = l.ntfy;
          }
        } catch (e) { if (!isTelefoon(a)) oudAdres.push(a); (isTelefoon(a) ? nee : oud).add(naamVan(a)); }
      }));
    }
    for (const n of ja) nee.delete(n);
    // Een telefoon die ergens anders WEL antwoordde, is niet "weg" omdat een oud adres van hem stil bleef.
    if (ja.size && S.telefoons.length && !nee.size) {
      // Alles bekend antwoordt: de oude adressen uit het geheugen opruimen, dan kost het volgende roepen geen 2,5 s per stuk.
      S.bekend = S.bekend.filter((a) => !oudAdres.includes(a) || a === S.kern);
      oud.clear();
    }
    await Opslag.schrijf('bekend', S.bekend);
    if (S.ntfy) await Opslag.schrijf('ntfy', S.ntfy);
    const zin = `Rij opgeroepen: ${ja.size} ${ja.size === 1 ? 'meldde zich' : 'meldden zich'}${nee.size ? `; geen antwoord van ${[...nee].slice(0, 5).join(', ')}` : ''}${oud.size ? `; ${oud.size} oud adres${oud.size === 1 ? '' : 'sen'} uit het geheugen gaf geen antwoord (dat is meestal een tweede netwerk van een telefoon en niet erg)` : ''}.`;
    logRegel(zin);
    tekenNtfy();
    meetRonde();
    return { ja: [...ja], nee: [...nee] };
  }

  // ---- SPRAAK UIT: voorlezen (speechSynthesis, nl-NL) ----
  // Chrome laat een pagina pas praten na de eerste tik; wat daarvoor komt (de begroeting) wacht
  // tot dan. In de stille uren (dezelfde als ntfy) alleen een noodstop of ROOD.
  const Spr = { wacht: [], vraagId: null, noodstopT: 0, luistert: false, opname: null };
  const kanSpreken = () => !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
  function stemmen() { return kanSpreken() ? window.speechSynthesis.getVoices().filter((v) => /^nl/i.test(v.lang)) : []; }
  function spreek(zin, soort) {
    const tekst = String(zin || '').trim();
    if (!tekst || !kanSpreken()) return false;
    const stil = !!(S.ntfy && K.Ntfy.inStilleUren(new Date(), S.ntfy.stil));
    if (!K.magSpreken({ aan: S.spraak.aan, stil, soort })) return false;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) { Spr.wacht.push([tekst, soort]); return false; }
    const u = new window.SpeechSynthesisUtterance(tekst.slice(0, 600));
    u.lang = 'nl-NL';
    u.rate = S.spraak.tempo;
    u.volume = S.spraak.volume;
    const stem = stemmen().find((v) => v.name === S.spraak.stem);
    if (stem) u.voice = stem;
    window.speechSynthesis.speak(u);
    $('spraakZin').textContent = `🔊 ${tekst}`;
    return true;
  }
  function statusNu() {
    const tijd = nu();
    const bereik = S.telefoons.filter((t) => staat(t.adres).bereikbaar).length;
    const heet = S.telefoons.filter((t) => ['oranje', 'rood'].includes(staat(t.adres).hitteStand)).length;
    const warm = S.telefoons.map((t) => ({ naam: t.naam, d: meterStand(meet(t.adres), staat(t.adres), tijd) }))
      .filter((x) => x.d.temperatuur.waarde !== null && x.d.temperatuur.ms <= 60000).sort((a, b) => b.d.temperatuur.waarde - a.d.temperatuur.waarde)[0];
    const feiten = K.statusFeiten({ bereikbaar: bereik, totaal: S.telefoons.length, warmste: warm ? { naam: warm.naam, temp: warm.d.temperatuur.waarde } : null,
      wacht: S.taken.filter((x) => x.status === 'wacht').length, heet });
    return { feiten, rustig: bereik === S.telefoons.length && !heet };
  }
  async function bewaarSpraak() { await Opslag.schrijf('spraak', S.spraak); tekenSpraak(); }
  function tekenSpraak() {
    $('spraakKnop').textContent = `Spraak: ${S.spraak.aan ? 'aan' : 'uit'}`;
    $('spraakKnop').setAttribute('aria-pressed', String(S.spraak.aan));
    $('spraakVolume').value = String(S.spraak.volume);
    $('spraakTempo').value = String(S.spraak.tempo);
    const keus = $('stemKeus');
    const lijst = stemmen();
    const namen = lijst.map((v) => v.name).join('|');
    if (keus.dataset.namen !== namen) {
      keus.dataset.namen = namen;
      keus.replaceChildren(el('option', '', lijst.length ? 'Standaard Nederlandse stem' : 'Geen Nederlandse stem gevonden'), ...lijst.map((v) => { const o = el('option', '', v.name); o.value = v.name; return o; }));
      keus.firstChild.value = '';
    }
    keus.value = S.spraak.stem;
    $('eigenaarNaam').value = S.eigenaar || '';
  }

  // ---- SPRAAK IN: luisteren ----
  // Eerst OFFLINE via de Gemma op een telefoon (OlliteRT /v1/audio/transcriptions, 16 kHz WAV,
  // language=nl). Lukt dat niet (geen telefoon vrij, of OlliteRT kent het niet), dan de spraak-
  // herkenning van Chrome. Die gaat ONLINE via Google: dat staat er dan ook bij.
  async function luister(hey) {
    if (Spr.luistert) { if (Spr.opname) Spr.opname.stop(); return; }   // tweede tik = klaar met praten
    if (hey) spreek(K.veronicaZin(S.karakter, 'luister'), 'luister');
    const uitK = uitgeslotenDoorKeuze('veronica');
    const t = K.kiesTelefoon(S.telefoons.filter((x) => !uitK.includes(x.adres)), S.staten, nu());
    if (t && navigator.mediaDevices && window.MediaRecorder) {
      const tekst = await luisterViaGemma(t);
      if (tekst !== null) return verwerkSpraak(tekst, 'Gemma');
    }
    if (volLokaal()) { $('spraakZin').textContent = 'Vol lokaal staat aan: luisteren via Google doe ik niet. Een Gemma op een telefoon moet vrij zijn.'; return null; }
    return luisterViaChrome();
  }
  async function neemOp(maxMs) {
    const stroom = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new window.MediaRecorder(stroom);
    const stukken = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) stukken.push(e.data); };
    Spr.luistert = true; Spr.opname = rec;
    $('micKnop').setAttribute('aria-pressed', 'true');
    $('spraakZin').textContent = '🎤 Ik luister… (tik nog eens als je klaar bent)';
    const klaar = new Promise((r) => { rec.onstop = r; });
    rec.start();
    const klok = setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, maxMs);
    await klaar;
    clearTimeout(klok);
    stroom.getTracks().forEach((x) => x.stop());
    Spr.luistert = false; Spr.opname = null;
    $('micKnop').setAttribute('aria-pressed', 'false');
    return new Blob(stukken, { type: rec.mimeType || 'audio/webm' });
  }
  // Opname -> 16 kHz mono -> WAV (kern.js: wavVan).
  async function naarWav(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close && ctx.close();
    const off = new window.OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000);
    const bron = off.createBufferSource();
    bron.buffer = buf; bron.connect(off.destination); bron.start();
    const uit = await off.startRendering();
    return K.wavVan(uit.getChannelData(0), 16000);
  }
  async function luisterViaGemma(t) {
    let wav;
    try { wav = await naarWav(await neemOp(8000)); } catch (e) { $('spraakZin').textContent = 'Geen microfoon (of geen toestemming).'; return null; }
    return transcribeer(t, wav);
  }
  async function transcribeer(t, wav) {
    const fd = new FormData();
    fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'spraak.wav');
    const m = meet(t.adres);
    fd.append('model', (m.health && m.health.model && m.health.model.waarde) || 'gemma');
    fd.append('language', 'nl');
    fd.append('response_format', 'json');
    try {
      const r = await haal(`${t.adres}/v1/audio/transcriptions`, { method: 'POST', headers: kop(t), body: fd }, 30000);
      if (!r.ok) return null;
      const d = await r.json();
      return typeof (d && d.text) === 'string' ? d.text : null;
    } catch (e) { return null; }
  }
  function luisterViaChrome() {
    const Herken = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Herken) { $('spraakZin').textContent = 'Luisteren kan hier niet: geen Gemma vrij en deze browser kent geen spraakherkenning.'; return null; }
    spreek(K.veronicaZin(S.karakter, 'online'), 'luister');
    $('spraakZin').textContent = '🎤 Ik luister via Google (online)…';
    return new Promise((klaar) => {
      // Altijd een einde: een resultaat, een fout, het einde van de herkenning, of na 12 s.
      let klaarAl = false;
      const eind = (w) => { if (klaarAl) return; klaarAl = true; clearTimeout(klok); klaar(w); };
      const niets = () => { $('spraakZin').textContent = 'Luisteren lukte niet. Tik nog eens op de microfoon.'; eind(null); };
      const klok = setTimeout(() => { try { h.abort && h.abort(); } catch (e) { /* al klaar */ } niets(); }, 12000);
      const h = new Herken();
      h.lang = 'nl-NL'; h.interimResults = false; h.maxAlternatives = 1;
      h.onresult = (e) => { const tekst = e.results && e.results[0] && e.results[0][0] ? e.results[0][0].transcript : ''; if (!klaarAl) { klaarAl = true; clearTimeout(klok); klaar(verwerkSpraak(tekst, 'Google (online)')); } };
      h.onerror = niets;
      h.onend = () => { if (!klaarAl) niets(); };
      try { h.start(); } catch (e) { niets(); }
    });
  }
  // Wat er gezegd is: een vaste opdracht (zonder AI), of een vraag voor de rij.
  async function verwerkSpraak(tekst, via) {
    const b = K.begrijp(tekst);
    $('spraakZin').textContent = `🎤 ${via ? `(${via}) ` : ''}Ik hoorde: "${String(tekst || '').slice(0, 120)}"`;
    const zeg = (wat, d, soort) => spreek(K.veronicaZin(S.karakter, wat, Object.assign({ naam: S.eigenaar }, d || {})), soort || wat);
    // Een noodstop wacht op ja (vijftien seconden).
    if (Spr.noodstopT && nu() - Spr.noodstopT < 15000 && (b.soort === 'ja' || b.soort === 'nee')) {
      Spr.noodstopT = 0; $('noodstopBevestig').hidden = true;
      if (b.soort === 'ja') { await noodstop(); return 'noodstop'; }
      zeg('noodstopAf'); return 'noodstop-af';
    }
    switch (b.soort) {
      case 'leeg': case 'ja': case 'nee': zeg('nietVerstaan'); return 'niet-verstaan';
      case 'status': { const st = statusNu(); zeg('status', st); return 'status'; }
      case 'roep': { const r = await roepOp(true); zeg('roepOp', { ja: r ? r.ja.length : 0, nee: r ? r.nee.length : 0 }); return 'roep'; }
      case 'wand-aan': zetWand(true, 'knop'); zeg('wandAan'); return 'wand-aan';
      case 'wand-uit': zetWand(false); zeg('wandUit'); return 'wand-uit';
      case 'noodstop':
        Spr.noodstopT = nu();
        $('noodstopBevestig').hidden = false;
        setTimeout(() => { if (nu() - Spr.noodstopT >= 15000) $('noodstopBevestig').hidden = true; }, 15100);
        zeg('noodstopVraag', null, 'noodstop');
        return 'noodstop-vraag';
      default: {
        await voegTakenToe(b.tekst);
        const taak = S.taken[S.taken.length - 1];
        Spr.vraagId = taak ? taak.id : null;
        zeg(S.aan ? 'vraagInRij' : 'vraagWacht');
        return 'vraag';
      }
    }
  }
  // Het antwoord op een gesproken vraag: letterlijk wat de Gemma zei, zonder karakter.
  function antwoordTik() {
    if (!Spr.vraagId) return;
    const taak = S.taken.find((x) => x.id === Spr.vraagId);
    if (!taak || (taak.status !== 'klaar' && taak.status !== 'fout')) return;
    Spr.vraagId = null;
    if (taak.status === 'klaar' && taak.uitkomst) spreek(String(taak.uitkomst).replace(/[#*_`>]+/g, ' ').slice(0, 600), 'antwoord');
  }

  // ---- Wat Veronica zegt (kern.js: veronicaZin) ----
  // Alleen bij een VERANDERING: een telefoon valt weg of komt terug, wordt te warm of weer koel.
  // De eerste meting is de beginstand en geen nieuws.
  function karakterTik() {
    const tijd = nu();
    const ventAan = S.stekkers.some((k) => k.rol === 'ventilator' && S.stekkerMeting[k.ip] && S.stekkerMeting[k.ip].aan
      && S.stekkerMeting[k.ip].aan.waarde === true && tijd - S.stekkerMeting[k.ip].aan.t <= K.MAX_LEEFTIJD_MS);
    for (const t of S.telefoons) {
      const s = staat(t.adres);
      const b = !!s.bereikbaar;
      if (s.vorigB === undefined) s.vorigB = b;
      else if (b !== s.vorigB) {
        s.vorigB = b;
        const anderen = S.telefoons.filter((x) => x !== t && staat(x.adres).bereikbaar && !staat(x.adres).vervangen).length;
        const zin = K.veronicaZin(S.karakter, b ? 'terug' : 'weg', { naam: t.naam, anderen });
        logRegel(zin);
        // De hoofdtelefoon die de deur uit gaat is geen nieuws voor de man die hem bij zich heeft.
        if (!b && !t.kern) { waarschuw('weg', K.veronicaZin('hulpdienst', 'weg', { naam: t.naam, anderen })); spreek(zin, 'weg'); }
      }
      const heet = s.hitteStand === 'oranje' || s.hitteStand === 'rood';
      if (s.vorigHeet === undefined) s.vorigHeet = heet;
      else if (heet !== s.vorigHeet) {
        s.vorigHeet = heet;
        const st = meet(t.adres).status || {};
        const temp = st.temperatuur && tijd - st.temperatuur.t <= K.MAX_LEEFTIJD_MS ? st.temperatuur.waarde : null;
        logRegel(K.veronicaZin(S.karakter, heet ? 'heet' : 'koel', { naam: t.naam, temperatuur: temp, stand: s.hitteStand, ventilator: ventAan }));
        if (heet) {
          waarschuw('heet', K.veronicaZin('hulpdienst', 'heet', { naam: t.naam, temperatuur: temp, stand: s.hitteStand, ventilator: ventAan }), s.hitteStand === 'rood');
          spreek(K.veronicaZin(S.karakter, 'heet', { naam: t.naam, temperatuur: temp, stand: s.hitteStand, ventilator: ventAan }), s.hitteStand === 'rood' ? 'rood' : 'heet');
        }
      }
      // Accu laag en hij laadt niet (alleen een verse meting telt).
      const st2 = meet(t.adres).status || {};
      const vers = (x) => (x && tijd - x.t <= K.MAX_LEEFTIJD_MS ? x.waarde : null);
      const pct = vers(st2.batterij);
      const laag = typeof pct === 'number' && pct <= 15 && vers(st2.laadt) === false;
      if (s.vorigLaag === undefined) s.vorigLaag = laag;
      else if (laag !== s.vorigLaag) {
        s.vorigLaag = laag;
        if (laag) { logRegel(K.veronicaZin(S.karakter, 'accu', { naam: t.naam, procent: pct })); waarschuw('accu', K.veronicaZin('hulpdienst', 'accu', { naam: t.naam, procent: pct })); }
      }
    }
    // De rij ligt stil: er wacht werk, het pantser staat aan, en niemand pakt het op.
    const wacht = S.taken.some((x) => x.status === 'wacht');
    const bezig = S.taken.some((x) => x.status === 'bezig');
    if (!S.aan || !wacht || bezig) S.stilSinds = null;
    else if (S.stilSinds === null) S.stilSinds = tijd;
    else if (tijd - S.stilSinds >= 10 * 60 * 1000) { S.stilSinds = tijd; logRegel(K.veronicaZin(S.karakter, 'stil')); waarschuw('stil', K.veronicaZin('hulpdienst', 'stil')); }
    const rustig = S.telefoons.length && S.telefoons.every((t) => staat(t.adres).bereikbaar && !['oranje', 'rood'].includes(staat(t.adres).hitteStand));
    $('veronicaZegt').textContent = rustig ? K.veronicaZin(S.karakter, 'rustig') : (S.log[0] ? S.log[0].zin : '');
  }
  async function wisselKarakter() {
    S.karakter = S.karakter === 'zakelijk' ? 'hulpdienst' : 'zakelijk';
    await Opslag.schrijf('karakter', S.karakter);
    tekenKarakter();
    karakterTik();
  }
  function tekenKarakter() {
    $('karakterKnop').textContent = `Karakter: ${S.karakter === 'zakelijk' ? 'zakelijk' : 'aan'}`;
    $('karakterKnop').setAttribute('aria-pressed', String(S.karakter !== 'zakelijk'));
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
  // ---- BIJWERKEN OP DE PLEK (1.9.4) ----
  // Vroeger werd elke 2 s alles vervangen (replaceChildren): opengeklapte "Alle getallen" klapten
  // dicht en een schermbeeld laadde opnieuw, de pagina werd even korter en de scrollpositie sprong
  // terug. Nu blijft elk element staan; alleen tekst, attributen en wat er echt anders is,
  // veranderen. Kinderen met een sleutel (data-adres, data-ip, data-samen) worden op sleutel
  // gekoppeld, de rest op volgorde. Een opengeklapt <details> blijft open.
  const SLEUTELS = ['adres', 'ip', 'samen', 'sleutel'];
  const sleutelVan = (n) => { if (n.nodeType !== 1) return null; for (const k of SLEUTELS) if (n.dataset && n.dataset[k]) return `${k}:${n.dataset[k]}`; return null; };
  function morph(oud, nieuw) {
    if (oud.nodeType !== nieuw.nodeType || oud.nodeName !== nieuw.nodeName) { oud.replaceWith(nieuw); return nieuw; }
    if (oud.nodeType === 3) { if (oud.nodeValue !== nieuw.nodeValue) oud.nodeValue = nieuw.nodeValue; return oud; }
    if (oud.nodeType !== 1) return oud;
    for (const a of [...oud.attributes]) if (!nieuw.hasAttribute(a.name) && !(oud.nodeName === 'DETAILS' && a.name === 'open')) oud.removeAttribute(a.name);
    for (const a of [...nieuw.attributes]) if (oud.getAttribute(a.name) !== a.value) oud.setAttribute(a.name, a.value);
    morphKinderen(oud, [...nieuw.childNodes]);
    return oud;
  }
  function morphKinderen(vak, nieuwe) {
    const oude = [...vak.childNodes];
    const opSleutel = new Map();
    for (const n of oude) { const k = sleutelVan(n); if (k) opSleutel.set(k, n); }
    const gebruikt = new Set();
    let vrij = 0;
    const plek = [];
    for (const n of nieuwe) {
      const k = sleutelVan(n);
      let oud = k ? opSleutel.get(k) : null;
      if (!k) { while (vrij < oude.length && (sleutelVan(oude[vrij]) || gebruikt.has(oude[vrij]))) vrij++; oud = vrij < oude.length ? oude[vrij++] : null; }
      if (oud) { gebruikt.add(oud); plek.push(morph(oud, n)); } else plek.push(n);
    }
    for (const n of oude) if (!gebruikt.has(n) && n.parentNode === vak) n.remove();
    // In de juiste volgorde zetten; een knoop die al op zijn plek staat, blijft staan.
    plek.forEach((n, i) => { if (vak.childNodes[i] !== n) vak.insertBefore(n, vak.childNodes[i] || null); });
  }
  // En voor de zekerheid: de scrollpositie houden, wat er ook gebeurt.
  function metScroll(fn) {
    const x = window.scrollX; const y = window.scrollY;
    fn();
    if (window.scrollY !== y) window.scrollTo(x, y);
  }

  // 1.9.14 (stap a): het rek, per rektelefoon temperatuur en accu, en of de ventilator genoeg koelt.
  function tekenRek(st) {
    const rustPer = (S.zonStroom && S.zonStroom.rustPer) || {};
    const o = K.rekOverzicht(st.map((x) => ({ naam: x.t.naam, plek: x.t.plek, temp: x.d.temperatuur.waarde, tempMs: x.d.temperatuur.ms,
      accu: x.d.batterij.waarde, accuMs: x.d.batterij.ms, laadt: x.d.batterij.laadt, rust: rustPer[x.t.naam],
      versie: ((meet(x.t.adres).status || {}).versie || {}).waarde })), 60000);
    const blok = $('rekBlok');
    blok.hidden = !o;
    if (!o) return;
    blok.className = o.stand;
    $('rekZin').textContent = o.zin;
    morphKinderen($('rekRegels'), o.regels.map((r) => { const li = el('li', `rek-${r.stand}`, r.tekst); li.dataset.sleutel = r.naam; return li; }));
    tekenReserve();
  }
  // 1.9.14: DE RESERVE-SCHUIF. Wat de baas zegt geldt (S.zonStroom.reserve); net getikt = de keuze tot de baas
  // het bevestigt. Veronica stuurt alleen het verzoek (/jarvis/roep, met de code); de baas zet het en geeft het
  // aan de rektelefoons door.
  const ResV = { gekozen: null, t: 0 };
  // 1.9.15: de handknop van een stekker, net getikt (tot de baas het bevestigt, of twee minuten).
  const HandV = { gekozen: {}, t: {} };
  async function kiesHand(naam, stand) {
    if (!S.code || !['auto', 'aan', 'uit'].includes(stand)) return;
    HandV.gekozen[naam] = stand; HandV.t[naam] = nu();
    tekenLive();
    try {
      const a = await haal(`${kernNu()}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'stekker', naam, stand, van: 'veronica' }) }, 3000);
      if (!a.ok) throw new Error(String(a.status));
      logRegel(`${naam}: ${stand === 'auto' ? 'automatisch' : `met de hand ${stand}`} doorgegeven aan de baas.`);
    } catch (e) {
      delete HandV.gekozen[naam];
      logRegel(`${naam}: de handknop kon niet naar de baas (geen antwoord). Probeer het zo nog eens.`);
      tekenLive();
    }
  }
  function ruimHandOp() {
    for (const naam of Object.keys(HandV.gekozen)) {
      const vanBaas = S.zonStroom && S.zonStroom.handPer ? S.zonStroom.handPer[naam] : null;
      if (vanBaas === HandV.gekozen[naam] || nu() - HandV.t[naam] > 120000) delete HandV.gekozen[naam];
    }
  }
  function reserveNu() {
    const vanBaas = S.zonStroom && K.RESERVES.includes(S.zonStroom.reserve) ? S.zonStroom.reserve : null;
    if (ResV.gekozen !== null && (vanBaas === ResV.gekozen || nu() - ResV.t > 120000)) ResV.gekozen = null;
    return ResV.gekozen !== null ? ResV.gekozen : vanBaas !== null ? vanBaas : 50;
  }
  function tekenReserve() {
    const r = reserveNu();
    document.querySelectorAll('#reserveSchuif [data-reserve]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.reserve) === r)));
    const wacht = ResV.gekozen !== null ? ' (doorgegeven, de baas neemt het over)' : '';
    $('reserveZin').textContent = `${K.reserveZin(r)}${wacht}${S.zonStroom && S.zonStroom.geenZon ? ' Vandaag geen zon: wie rust, blijft rusten.' : ''}`;
  }
  async function kiesReserve(r) {
    if (!K.RESERVES.includes(r) || !S.code) return;
    ResV.gekozen = r; ResV.t = nu();
    tekenReserve();
    try {
      const a = await haal(`${kernNu()}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'reserve', waarde: r, van: 'veronica' }) }, 3000);
      if (!a.ok) throw new Error(String(a.status));
      logRegel(`Reserve ${r}% doorgegeven aan de baas.`);
    } catch (e) {
      ResV.gekozen = null;
      logRegel('De reserve kon niet naar de baas: geen antwoord. Probeer het zo nog eens.');
      tekenReserve();
    }
  }
  function tekenSamen(tijd) {
    const OUD = 60000;
    const st = S.telefoons.map((t) => ({ t, d: meterStand(meet(t.adres), staat(t.adres), tijd) }));
    const snel = st.filter((x) => x.d.snelheid.waarde !== null && x.d.snelheid.ms <= OUD);
    const warm = st.filter((x) => x.d.temperatuur.waarde !== null && x.d.temperatuur.ms <= OUD).sort((a, b) => b.d.temperatuur.waarde - a.d.temperatuur.waarde)[0];
    const bereik = S.telefoons.filter((t) => staat(t.adres).bereikbaar).length;
    // 502: een telefoon die via de brievenbus een verse hartslag gaf LEEFT, ook als het wifi hem niet bij Veronica brengt.
    const viaPost = S.telefoons.filter((t) => !staat(t.adres).bereikbaar && !ontmoetLevend(t) && hartslagVers(t)).length;
    const viaPb = S.telefoons.filter((t) => !staat(t.adres).bereikbaar && ontmoetLevend(t)).length;   // 514: levend in de postbus
    const stek = S.stekkers.map((k) => { const m = S.stekkerMeting[k.ip] || {}; return { naam: k.naam, aan: m.aan && tijd - m.aan.t <= OUD ? m.aan.waarde : null }; });
    const z = S.zonStroom && S.zonStroom.zon;
    const duur = (ms) => { const mm = Math.round(ms / 60000); return mm >= 60 ? `${Math.floor(mm / 60)} u ${mm % 60} min` : `${mm} min`; };
    const tegel = (icoon, getal, wat, sleutel) => { const v = el('div', 'vSamen'); v.dataset.samen = sleutel; v.append(el('div', 'vIcoon', icoon), el('div', 'vGetal', getal), el('div', 'vWat2', wat)); return v; };
    tekenRek(st);
    morphKinderen($('vSamen'), [
      tegel('📱', String(S.telefoons.length), viaPost || viaPb ? `telefoons · ${bereik + viaPost + viaPb} leven (${[bereik ? `${bereik} rechtstreeks` : '', viaPb ? `${viaPb} via de postbus` : '', viaPost ? `${viaPost} via de brievenbus` : ''].filter(Boolean).join(', ')})` : `telefoons · ${bereik} bereikbaar`, 'telefoons'),
      tegel('⚡', snel.length ? String(Math.round(snel.reduce((a, x) => a + x.d.snelheid.waarde, 0) * 10) / 10).replace('.', ',') : 'geen meting', 'tokens/s samen', 'snelheid'),
      tegel('🌡️', warm ? `${String(Math.round(warm.d.temperatuur.waarde * 10) / 10).replace('.', ',')} °C` : 'geen meting', warm ? `warmste: ${warm.t.naam}` : 'warmste telefoon', 'warmste'),
      tegel('🔌', stek.length ? stek.map((x) => (x.aan === true ? 'aan' : x.aan === false ? 'uit' : '?')).join(' · ') : 'geen', stek.length ? stek.map((x) => x.naam).join(' · ') : 'geen stekker', 'stekkers'),
      tegel('☀️', !z ? 'onbekend' : z.geen ? 'geen zon' : z.open ? 'open' : 'dicht', !z || z.geen ? 'zonvenster' : z.open ? `zonvenster · nog ${duur(z.nogMs || 0)}` : (z.totOpenMs ? `zonvenster · opent over ${duur(z.totOpenMs)}` : 'zonvenster'), 'zon'),
    ]);
  }
  // 1.9.21 (451): DE BAAS WISSELEN MET EEN KNOP. Eerst de nieuwe baas roepen ('word-baas'); antwoordt die niet, dan
  // verandert er niets. Daarna de oude ('word-werker'). Beide met de code van de rij: een werker laat die ook binnen.
  // De nieuwe baas neemt die code over als zijn eigen code, dus Veronica hoeft niets opnieuw te koppelen.
  // 456b: "Ruim op" -- JARVIS wist ALLEEN zijn eigen dubbele modelkopie op die telefoon (nooit een app, nooit het laatste exemplaar).
  async function ruimGemmaOp(t) {
    if (!S.code || !t || !t.jarvis) return;
    const gm = (meet(t.adres).status || {}).gemma;
    const g = gm && gm.waarde;
    if (!g || !g.kanOpruimen) return;
    if (typeof window.confirm === 'function' && !window.confirm(`${t.naam}: de dubbele kopie van het model wissen (${String(Math.round(g.opruimbaarMb / 100) / 10).replace('.', ',')} GB)? Alleen de kopie in JARVIS. Je Gemma-apps blijven staan.`)) return;
    let ok = false;
    try { ok = (await haal(`${t.jarvis}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'ruim-gemma-op', van: 'veronica' }) }, 3000)).ok; } catch (e) { ok = false; }
    logRegel(ok ? `${t.naam}: opruimen gevraagd. Binnen een halve minuut staat hier het resultaat.` : `${t.naam} antwoordt niet. Er is niets gewist.`);
    (meet(t.adres)).jarvisNietTot = 0;
  }
  // 458: "Open OlliteRT" -- JARVIS op die telefoon opent de app. Lukt dat niet (Android), dan zegt JARVIS dat in zijn eigen logboek.
  async function startOlliteVanuitVeronica(t) {
    if (!S.code || !t || !t.jarvis) return;
    let ok = false;
    try { ok = (await haal(`${t.jarvis}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'start-ollite', van: 'veronica' }) }, 3000)).ok; } catch (e) { ok = false; }
    logRegel(ok ? `${t.naam}: gevraagd om OlliteRT te openen. Over een halve minuut zie je hier of de server aan staat.` : `${t.naam} antwoordt niet. Er is niets gevraagd.`);
    (meet(t.adres)).jarvisNietTot = 0;
  }
  // 460b: de eigen motor aan of uit zetten op die telefoon. Er opent daar GEEN venster (de eenmalige toestemming voor 'batterij onbeperkt' vraagt de telefoon alleen als je hem zelf aanzet).
  function motorKandidaten() {
    const tijd = nu();
    return S.telefoons.filter((t) => { const ps = poolStaat(t); return !ps.vervangen && K.motorKandidaat(t, meet(t.adres).status, { laadt: ps.laadt, modelGeladen: ps.modelGeladen }, tijd); });
  }
  async function motorAlleAan() {
    const kand = motorKandidaten();
    if (!kand.length) return 0;
    logRegel(`Eigen motor aanzetten op ${kand.map((t) => t.naam).join(', ')}. Het model komt er alleen op wifi en aan de lader; op de tegel zie je de voortgang.`);
    for (const t of kand) await motorVanuitVeronica(t, true);
    tekenLive();
    return kand.length;
  }
  async function motorVanuitVeronica(t, aan) {
    if (!S.code || !t || !t.jarvis) return;
    let ok = false;
    try { ok = (await haal(`${t.jarvis}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: aan ? 'motor-aan' : 'motor-uit', van: 'veronica' }) }, 3000)).ok; } catch (e) { ok = false; }
    logRegel(ok ? `${t.naam}: eigen motor ${aan ? 'aangezet' : 'uitgezet'}. ${aan ? 'Het model komt er alleen op wifi en aan de lader; hier zie je de voortgang.' : ''}`.trim() : `${t.naam} antwoordt niet. Er is niets veranderd.`);
    (meet(t.adres)).jarvisNietTot = 0;
  }
  // 458: TEST DEZE TELEFOON -- een korte vraag, het antwoord en de tijd. Niet tijdens werk van de pool op die telefoon.
  async function testTelefoon(t) {
    const s = staat(t.adres);
    if (s.bezig) { S.testUitslag[t.adres] = { zin: 'Test: deze telefoon is nu bezig. Probeer het zo nog eens.' }; tekenLive(); return; }
    s.bezig = true;
    S.testUitslag[t.adres] = { zin: 'Test loopt...' }; tekenLive();
    const ctrl = new AbortController();
    const klok = setTimeout(() => ctrl.abort(), 30000);
    const t0 = nu();
    let zin;
    try {
      const model = modelNaamVan(meet(t.adres));
      const r = await fetch(`${t.adres}/v1/chat/completions`, Object.assign({
        method: 'POST', signal: ctrl.signal, headers: Object.assign({ 'Content-Type': 'application/json' }, kop(t)),
        body: JSON.stringify({ model: model || undefined, stream: false, max_tokens: 20, temperature: 0, messages: [{ role: 'user', content: 'Zeg alleen het woord: klaar.' }] }),
      }, K.lnaOpties(t.adres)));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const tekst = String(d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80);
      const sec = String(Math.round((nu() - t0) / 100) / 10).replace('.', ',');
      zin = tekst ? `Test gelukt in ${sec} seconden. Antwoord: "${tekst}".` : `Test: de telefoon antwoordde na ${sec} seconden, maar zonder tekst. Is er een model geladen?`;
    } catch (e) {
      const snel = nu() - t0 < 4000;
      zin = ctrl.signal.aborted ? 'Test mislukt: na 30 seconden nog geen antwoord. Het model laadt misschien nog, of de telefoon is te traag.'
        : snel ? (t.motor ? 'Test mislukt: de eigen motor weigert de verbinding. Is het model al geladen?' : 'Test mislukt: OlliteRT weigert de verbinding. Staat de server aan op die telefoon?') : (t.motor ? 'Test mislukt: geen antwoord van de eigen motor.' : 'Test mislukt: geen antwoord van OlliteRT.');
    } finally { clearTimeout(klok); s.bezig = false; }
    S.testUitslag[t.adres] = { zin };
    logRegel(`${t.naam}: ${zin}`);
    tekenLive();
  }
  // 462: DE NULMETING -- twintig minuten per telefoon (nulmeting.js). Tien vragen, elke minuut accu en temperatuur, en een eigen noodstop.
  // De telefoon is al die tijd "bezig": de pool geeft hem geen werk. Blijf op dit tabblad; sluiten of herladen breekt de meting af.
  const NulS = { stop: false, versnel: 1 };       // versnel: ALLEEN voor de test (een minuut duurt dan 60000 x versnel ms)
  async function startNulmeting(t) {
    const Nm = window.Nulmeting;
    if (!Nm || !t) return;
    const s = staat(t.adres);
    const nul = S.nulmeting[t.adres] = S.nulmeting[t.adres] || {};
    if (nul.loopt) { nul.zin = 'Nulmeting: loopt al.'; tekenLive(); return; }
    if (s.bezig || !s.bereikbaar) { nul.zin = 'Nulmeting: deze telefoon is nu niet vrij of niet bereikbaar. Probeer het zo nog eens.'; tekenLive(); return; }
    if (typeof window.confirm === 'function' && !window.confirm(`${t.naam} twintig minuten meten? Hij krijgt in die tijd geen ander werk. Laat hem aan de lader liggen en laat dit tabblad open.`)) return;
    NulS.stop = false; nul.loopt = true; nul.uitslag = null; nul.zin = 'Nulmeting loopt: nog ongeveer twintig minuten.';
    s.bezig = true; tekenLive();
    const begin = nu();
    const io = {
      wacht: (ms) => new Promise((r) => setTimeout(r, ms * NulS.versnel)),
      status: async () => {
        const st = meet(t.adres).status || {};
        const vers2 = (v) => (v && nu() - v.t <= K.MAX_LEEFTIJD_MS ? v.waarde : null);
        return { temp: vers2(st.temperatuur), accu: vers2(st.batterij), laadt: vers2(st.laadt) === true };
      },
      vraag: async (v) => {
        const ctrl = new AbortController();
        const klok = setTimeout(() => ctrl.abort(), 120000);
        const t0 = nu();
        try {
          const model = modelNaamVan(meet(t.adres));
          const r = await fetch(`${t.adres}/v1/chat/completions`, Object.assign({
            method: 'POST', signal: ctrl.signal, headers: Object.assign({ 'Content-Type': 'application/json' }, kop(t)),
            body: JSON.stringify({ model: model || undefined, stream: false, max_tokens: v.max_tokens, temperature: 0, messages: [{ role: 'user', content: v.prompt }] }),
          }, K.lnaOpties(t.adres)));
          if (!r.ok) return { ok: false };
          const d = await r.json();
          const tekst = String(d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '').trim();
          if (!tekst) return { ok: false };
          const gemeld = d && d.usage && Number(d.usage.completion_tokens);
          return { ok: true, ms: Math.max(1, nu() - t0), tokens: gemeld > 0 ? gemeld : Math.max(1, Math.ceil(tekst.length / 4)) };   // zonder opgave van de telefoon: vier tekens tellen als een token
        } catch (e) { return { ok: false }; } finally { clearTimeout(klok); }
      },
    };
    try {
      const metingen = await Nm.voerUit(io, { stop: () => NulS.stop });
      const uitslag = Nm.beoordeel(metingen);
      nul.uitslag = uitslag;
      nul.zin = `Nulmeting ${uitslag.ok ? 'geslaagd' : 'niet geslaagd'}: ${uitslag.redenen.join(' ')} Past bij: ${uitslag.advies.toUpperCase()}.`;
      logRegel(`${t.naam}: ${nul.zin}`);
    } catch (e) {
      nul.zin = 'Nulmeting: er ging iets mis. Er is niets veranderd op de telefoon.';
      logRegel(`${t.naam}: ${nul.zin}`);
    } finally { nul.loopt = false; s.bezig = false; nul.minuten = Math.round((nu() - begin) / 60000); tekenLive(); }
  }
  async function maakBaas(t) {
    if (!S.code || !t || !t.jarvis || t.kern) return;
    if (typeof window.confirm === 'function' && !window.confirm(`${t.naam} de baas maken?`)) return;
    const oud = S.telefoons.find((x) => x.kern) || null;
    let ok = false;
    try {
      const r = await haal(`${t.jarvis}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'word-baas', van: 'veronica' }) }, 3000);
      ok = r.ok;
    } catch (e) { ok = false; }
    if (!ok) { logRegel(`${t.naam} antwoordt niet. ${oud ? `${oud.naam} blijft de baas.` : 'Er verandert niets.'}`); return; }
    if (oud && oud.jarvis) {
      try { await haal(`${oud.jarvis}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'word-werker', baas: t.naam, van: 'veronica' }) }, 3000); } catch (e) { /* de verkeersleider regelt het ook */ }
    }
    S.telefoons = K.wisselKern(S.telefoons, t.adres);
    S.kern = t.jarvis;
    await Opslag.schrijf('telefoons', S.telefoons);
    await Opslag.schrijf('kern', S.kern);
    logRegel(`${t.naam} is nu de baas.${oud ? ` ${oud.naam} doet mee als werker.` : ''}`);
    tekenLive();
    tekenKoppelStand();
  }
  function tekenLive() {
    const vak = $('tegels');
    $('leeg').hidden = S.telefoons.length > 0;
    const n = S.telefoons.filter((t) => staat(t.adres).bereikbaar && !staat(t.adres).vervangen).length;
    const ps = pantserStand();
    $('pantserZin').textContent = `${ps.regel}${S.aan ? ` · wachtrij ${S.taken.filter((x) => x.status === 'wacht').length}` : ''}`;
    morphKinderen($('pantserHelp'), S.aan ? ps.helpen.map((h) => { const d = el('div', 'pantserHelpRegel', h.zin); d.dataset.sleutel = h.adres; return d; }) : []);
    {
      // 484: ALLES KOPPELEN. Met Pantser aan: de telefoons die de eigen motor kunnen draaien maar hem nog niet aan hebben, met EEN tik.
      const kand = motorKandidaten();
      const k = $('motorAlleKnop');
      k.hidden = !S.aan || !kand.length;
      k.textContent = `Zet de eigen motor aan op ${kand.length === 1 ? kand[0].naam : `${kand.length} telefoons (${kand.map((t) => t.naam).join(', ')})`}`;
    }
    $('bureauKnop').textContent = `Claude-bureau: ${S.bureau ? 'aan' : 'uit'}`;
    $('bureauKnop').setAttribute('aria-pressed', String(S.bureau));
    $('bureauZin').textContent = S.bureau ? `${S.tellers.klussen} ${S.tellers.klussen === 1 ? 'klus' : 'klussen'}${S.tellers.ms > 0 && S.tellers.tokens > 0 ? ` · ±${Math.round(S.tellers.tokens * 1000 / S.tellers.ms * 10) / 10} tokens/s` : ''}` : '';
    const tijd = nu();
    metScroll(() => morphKinderen(vak, S.telefoons.map((t) => {
      const m = meet(t.adres);
      const s = staat(t.adres);
      // De PRESTATIEKAART, zoals op de telefoon: naam, rol, vier meters, de accu. Is de nieuwste
      // meting ouder dan 10 s, dan wordt de hele kaart grijs, met hoe oud.
      const oud = K.oudZin(K.jongsteMeting(m), tijd);
      const tegel = el('section', `tegel${oud ? ' oud' : ''}`);
      tegel.dataset.adres = t.adres;
      if (s.hitteStand && !oud) tegel.style.borderColor = KLEUR[s.hitteStand];
      const kopRij = el('div', 'tKop');
      // 502: een adres is geen bewijs van verbonden. Antwoordt hij niet over het wifi, dan staat er "laatst bekend adres".
      kopRij.append(el('h2', '', t.naam), el('span', 'tAdres', staat(t.adres).bereikbaar ? t.adres.replace('http://', '') : `laatst bekend adres ${t.adres.replace('http://', '')}`));
      tegel.appendChild(kopRij);
      {
        // 490: EEN regel overzicht: versie, motor, model %, bezig of rustig (alleen verse meldingen).
        const vers = (x) => (x && tijd - x.t <= K.MAX_LEEFTIJD_MS ? x.waarde : null);
        const st = m.status || {};
        const hb = vers(m.health && m.health.bezig);
        const bezig = s.bezig || S.taken.some((x) => x.status === 'bezig' && x.telefoon === t.naam) || hb === true ? true
          : (s.bereikbaar && (hb === false || vers(st.versie) !== null) ? false : null);
        const ov = K.overzicht({ bereikbaar: s.bereikbaar === false ? false : undefined,
          versie: vers(st.versie), nieuwste: K.nieuwsteVersie(S.telefoons.map((y) => ((meet(y.adres).status || {}).versie || {}).waarde)),
          motor: vers(st.motor), bezig, dagelijks: vers(st.dagelijks) });
        tegel.appendChild(el('div', 'tOverzicht', ov.tekst));
      }
      if (window.Hartslag) {
        // 500: wat de telefoon ZELF via de brievenbus meldde (ook als het wifi hem niet bij Veronica brengt): laatst gezien,
        // versie, adres, en waarom hij niet antwoordt; plus motor, model, tempo en warmte.
        const h = (t.id && HB.per[t.id]) || hartslagVoorAdres(t.adres);
        const echt = h && h.t ? h : null;
        // 508: JARVIS die vers antwoordt op /jarvis/status IS over het wifi bereikbaar, ook als zijn model (nog) zwijgt
        const wifiJ = jarvisVers(meet(t.adres).status, tijd);
        const bb = ((meet(t.adres).status || {}).brievenbus || {}).waarde || null;
        tegel.appendChild(el('div', 'tHartslag', window.Hartslag.diagnose(echt, { antwoordt: s.bereikbaar === true || wifiJ ? true : (s.bereikbaar === false ? false : null), uitleg: K.brievenbusUitleg(bb, NtfyGeefV.mijn) }, tijd)));
        if (echt) tegel.appendChild(el('div', 'tMotorRegel', window.Hartslag.motorZin(echt)));
        // 501: de motor-instellingen die nu gelden, in gewone taal, en een knop om ze voor deze telefoon aan te passen
        if (echt && echt.instel && window.MotorInstel) {
          const i = echt.instel;
          tegel.appendChild(el('div', 'tInstel', window.MotorInstel.zin(i, i.geladen ? { draden: i.dradenToegepast, temperatuur: i.temperatuurToegepast } : {})));
        }
        if (echt && echt.id && !echt.dagelijks) { const b = el('button', '', 'Motor instellen'); b.dataset.instelId = echt.id; b.dataset.instelAdres = t.adres; tegel.appendChild(b); }
      }
      tegel.appendChild(el('div', 'tRol', K.rolZin(t, m.status, tijd)));
      // 452: welke JARVIS draait er, en loopt hij achter? Alleen als de telefoon zijn versie vers meldde.
      const vz = m.status && m.status.versie && tijd - m.status.versie.t <= K.MAX_LEEFTIJD_MS
        ? K.versieZin(m.status.versie.waarde, K.nieuwsteVersie(S.telefoons.map((x) => ((meet(x.adres).status || {}).versie || {}).waarde)), m.status.rol && m.status.rol.waarde) : null;
      if (vz) tegel.appendChild(el('div', `tVersie${vz.achter ? ' achter' : ''}`, vz.tekst));
      {
        // 515: de telefoon zegt ZELF waarom hij (nog) niet bijwerkt (bijvoorbeeld: Android wacht op een tik op Installeren).
        const stap = m.status && m.status.bijwerkStap && tijd - m.status.bijwerkStap.t <= K.MAX_LEEFTIJD_MS ? m.status.bijwerkStap.waarde : null;
        if (stap && vz && vz.achter) tegel.appendChild(el('div', 'tBron', `De telefoon zegt: ${stap}`));
        // 515: beheerder die als dagelijkse telefoon rust: een knop om hem te laten meerekenen (een tik, nooit vanzelf).
        if (K.rekWerkerKnop(m.status, tijd)) {
          const b = el('button', '', 'Laat meerekenen (maak werker)');
          b.dataset.rekWerker = t.adres;
          tegel.appendChild(el('div', 'tBron', 'Deze telefoon is beheerder en rust daarom (dagelijkse telefoon): geen motor, geen werk. Is dit een rektelefoon, tik dan hieronder.'));
          tegel.appendChild(b);
        }
      }
      {
        // 487: zit hij vast op een oude versie (verlopen postbus-adres)? Dan een tik (nieuwe JARVIS) of een QR (oude JARVIS).
        const fout = m.status && m.status.bijwerkFout && tijd - m.status.bijwerkFout.t <= K.MAX_LEEFTIJD_MS ? m.status.bijwerkFout.waarde : null;
        const h = vz && vz.achter ? K.bijwerkHulp(m.status.versie.waarde, K.nieuwsteVersie(S.telefoons.map((x) => ((meet(x.adres).status || {}).versie || {}).waarde)), fout) : null;
        if (h) {
          const vak = el('div', 'tBijwerk');
          vak.appendChild(el('div', '', h.zin));
          if (!K.adresVers(S.postbusVers, tijd)) {
            // 488: geen of een VERLOPEN adres bij de baas. Geen dode QR tonen: een verse code plakken (uit de mail).
            vak.appendChild(el('div', 'tBron', S.postbusVers
              ? 'Ook het adres van de baas is verlopen. Plak hier de verse code uit de mail (begint met LRWERK1).'
              : 'Veronica heeft nog geen geldig adres. Plak hier de verse code uit de mail (begint met LRWERK1).'));
            const veld = el('textarea', 'tPlak'); veld.rows = 2; veld.placeholder = 'LRWERK1 …'; veld.dataset.versPlak = '1'; vak.appendChild(veld);
            const b = el('button', '', 'Gebruik deze code'); b.dataset.versPlakKnop = t.adres; vak.appendChild(b);
          }
          else if (h.tik) { const b = el('button', '', 'Geef een vers adres'); b.dataset.versAdres = t.adres; vak.appendChild(b); }
          else { const b = el('button', '', 'Toon de QR'); b.dataset.versQr = t.adres; vak.appendChild(b); }
          tegel.appendChild(vak);
        }
      }
      {
        // 492: DE ZELFTEST van de telefoon: een regel met de samenvatting, de punten eronder, en een knop om hem nu te laten kijken.
        const zt = m.status && m.status.zelftest && m.status.zelftest.waarde;
        const vak = el('div', 'tZelftest');
        const sv = zt ? Zelftest.samenvatting(zt) : null;
        const uur = zt ? new Date(zt.t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '';
        vak.appendChild(el('div', 'tZelftestKop', sv ? `Zelftest (${uur}): ${sv}` : 'Zelftest: nog geen uitslag van deze telefoon.'));
        if (zt) {
          const lijst = el('details', 'tZelftestLijst');
          if (Zelftest.regels(zt).some((r) => r.uitslag === 'nee')) lijst.open = true;
          lijst.appendChild(el('summary', '', 'Alle punten'));
          for (const r of Zelftest.regels(zt)) lijst.appendChild(el('div', `zt-${r.uitslag}`, `${r.uitslag === 'ok' ? '✓' : r.uitslag === 'nee' ? '✗' : '·'} ${r.titel}: ${r.zin}`));
          vak.appendChild(lijst);
        }
        if (t.jarvis && S.code) { const b = el('button', '', 'Zelftest nu'); b.dataset.zelftest = t.adres; vak.appendChild(b); }
        tegel.appendChild(vak);
      }
      {
        // 496: de zandbak (veilig browsen). Alleen een werker; de beheerder nooit.
        const st = m.status || {};
        const isWerker = !t.kern && st.rol && tijd - st.rol.t <= K.MAX_LEEFTIJD_MS && st.rol.waarde === 'werker' && !(st.dagelijks && st.dagelijks.waarde);
        if (zandbakNu(t)) {
          const vak = el('div', 'tZandbak', '🧪 Zandbak voor veilig browsen. Doet niet mee, kent geen sleutel van het systeem. ');
          const b = el('button', '', 'Zandbak klaar'); b.dataset.zandbak = t.adres; b.dataset.zandbakDoe = 'klaar'; vak.appendChild(b);
          tegel.appendChild(vak);
        } else if (isWerker && t.jarvis && S.code) {
          const vak = el('div', 'tZandbak');
          const b = el('button', '', 'Maak zandbak'); b.dataset.zandbak = t.adres; b.dataset.zandbakDoe = 'maak'; vak.appendChild(b);
          tegel.appendChild(vak);
        }
      }
      // 481: geheugen en Android-versie (alleen als de telefoon ze vers meldde).
      { const cp = m.status && m.status.capaciteit && tijd - m.status.capaciteit.t <= K.MAX_LEEFTIJD_MS ? K.toestelZin(m.status.capaciteit.waarde) : null; if (cp) tegel.appendChild(el('div', 'tToestel', cp)); }
      {
        const ps = poolStaat(t);
        const klasseNaam = { zwaar: 'ZWAAR', midden: 'MIDDEN', licht: 'LICHT', 'te-oud': 'TE OUD VOOR MODEL' }[ps.klasse];
        const snel = ps.tps ? `±${String(Math.round(ps.tps * 10) / 10).replace('.', ',')} tokens/s` : 'snelheid nog niet gemeten';
        const model = ps.klasse === 'te-oud' ? ps.klasseReden : `${ps.model || 'nog geen model'}${ps.aanbevolenModel && ps.model && !ps.model.toUpperCase().includes(ps.aanbevolenModel) ? ` (aanbevolen: ${ps.aanbevolenModel})` : ''}`;
        tegel.appendChild(el('div', `tKlasse k-${ps.klasse}`, `${klasseNaam} · ${model} · ${snel} · ${ps.bezig ? 'bezig' : 'vrij'}`));
      }
      {
        // 456b: dubbele Gemma-apps of modelkopieen op deze telefoon (de zin komt van JARVIS en wordt alleen als TEKST getoond).
        const gm = m.status && m.status.gemma && tijd - m.status.gemma.t <= K.MAX_LEEFTIJD_MS ? m.status.gemma.waarde : null;
        if (gm && gm.melding) tegel.appendChild(el('div', 'tGemma', gm.melding));
      }
      {
        // 460b: de eigen motor van JARVIS (fase, voortgang, tokens/s). De zin maakt Veronica zelf uit een vaste fase en getallen.
        const mo = m.status && m.status.motor && tijd - m.status.motor.t <= K.MAX_LEEFTIJD_MS ? m.status.motor.waarde : null;
        const mz = K.motorZin(mo);
        if (mz) tegel.appendChild(el('div', 'tGemma', mz));
        // 468: klaar voor de eigen motor? Alleen zolang hij niet al draait; de zin zegt wat er nog moet gebeuren.
        if (!mo || !mo.klaar) {
          const ps = poolStaat(t);
          const capM = m.status && m.status.capaciteit && tijd - m.status.capaciteit.t <= K.MAX_LEEFTIJD_MS ? m.status.capaciteit.waarde : null;
          // Pas als de telefoon zijn getallen gemeld heeft: anders springt de tegel van hoogte zodra ze binnenkomen (scrolregel 1.9.4).
          if (capM) {
            const mk = K.motorKlaarZin(capM, { laadt: ps.laadt, modelGeladen: ps.modelGeladen });
            tegel.appendChild(el('div', `tMotorKlaar${mk.klaar ? ' klaar' : mk.kan ? '' : ' kanNiet'}`, mk.tekst));
          }
        }
      }
      {
        // 457: de AI-kern (alleen getallen; de zin maakt Veronica zelf).
        const ak = m.status && m.status.aikern && tijd - m.status.aikern.t <= K.MAX_LEEFTIJD_MS ? m.status.aikern.waarde : null;
        const zin = K.kernZin(ak);
        if (zin) tegel.appendChild(el('div', 'tGemma', zin));
      }
      tegel.appendChild(meterRij(t, m, s, tijd));
      // 458: weet JARVIS op die telefoon wat er met OlliteRT is, dan zegt Veronica dat, in plaats van "geen antwoord".
      const olGm = m.status && m.status.gemma && tijd - m.status.gemma.t <= K.MAX_LEEFTIJD_MS ? m.status.gemma.waarde : null;
      const olZin = olGm && olGm.ollite && olGm.ollite.toestand !== 'klaar' && olGm.ollite.toestand !== 'onbekend' ? olGm.ollite.zin : null;
      const jarvisOnbekendeReden = !s.bereikbaar && !olZin && jarvisVers(m.status, tijd) ? `JARVIS antwoordt wel, maar OlliteRT niet. ${oudeJarvisZin(m.status)}` : null;
      const hsT = (() => { const h = (t.id && HB.per[t.id]) || hartslagVoorAdres(t.adres); return h && h.t ? h.t : 0; })();
      const jarvisWifi = jarvisVers(m.status, tijd);   // 508: JARVIS antwoordt over het wifi; alleen het model (nog) niet
      const omH = ontmoetLevend(t);   // 514: levend in de postbus (gezien via een telefoon die wel antwoordt)
      const nietHier = !s.bereikbaar && jarvisWifi ? 'JARVIS antwoordt over het wifi; het model nog niet'
        : !s.bereikbaar && omH ? `geen directe wifi-verbinding · via de postbus · laatst gezien ${window.Hartslag ? window.Hartslag.minutenZin(tijd - omH.t) : ''}`
          : !s.bereikbaar && hsT ? `geen directe wifi-verbinding · laatst gezien ${window.Hartslag ? window.Hartslag.minutenZin(tijd - hsT) : ''} via de brievenbus` : null;   // 502/503
      const bereik = s.vervangen ? 'vervangen: krijgt geen werk' : s.bereikbaar && !oud ? 'bereikbaar · rechtstreeks' : (!s.bereikbaar && olZin ? olZin : (jarvisOnbekendeReden || nietHier || `${s.bereikbaar ? '' : 'geen antwoord · '}${oud}`));
      const installeerKans = !s.bereikbaar && (!olGm || !olGm.ollite || olGm.ollite.toestand === 'niet-geinstalleerd' || olGm.ollite.toestand === 'onbekend');
      tegel.appendChild(el('div', `tBereik${s.bereikbaar && !oud ? '' : ' oud'}`, bereik));
      // De taak, en de tekst die NU binnenkomt (eigen werk, of wat de hoofdtelefoon meldt).
      const eigen = S.stromen.get(t.adres);
      const taak = eigen ? S.taken.find((x) => x.id === eigen.taakId) : null;
      const kernAct = S.kernActiviteit[t.naam];
      let taakZin = 'wacht';
      let live = '';
      let liveBron = '';
      if (taak && taak.claude) { taakZin = `Claude-klus (${taak.soort})`; }
      else if (taak) { taakZin = `Veronica: ${taak.tekst.slice(0, 60)}`; live = S.live[t.adres] || ''; liveBron = 'eigen stroom van deze telefoon'; }
      else if (kernAct) { taakZin = `hoofdtelefoon: ${kernAct.label}`; live = kernAct.tekst; liveBron = `stand.json van de hoofdtelefoon · ${K.leeftijdZin(tijd - kernAct.t)}`; }
      else if (m.health && m.health.bezig && m.health.bezig.waarde && tijd - m.health.bezig.t <= K.MAX_LEEFTIJD_MS) taakZin = 'rekent (voor iets buiten Veronica)';
      tegel.appendChild(el('div', 'tTaak', taakZin));
      const lv = el('pre', 'tLive', live.slice(-600));
      lv.hidden = !live;
      tegel.appendChild(lv);
      if (live) tegel.appendChild(el('div', 'tBron', liveBron));
      // 481 (stap C): het PLAN van de denker apart (ingeklapt), los van het antwoord. Alleen onder de telefoon die het maakte.
      if (S.denkerPlan && S.denkerPlan.telefoon === t.naam && tijd - S.denkerPlan.t <= 60 * 60 * 1000) {
        const pl = el('details', 'tPlan');
        pl.appendChild(el('summary', '', `Plan (${K.leeftijdZin(tijd - S.denkerPlan.t)})`));
        pl.appendChild(el('pre', 'tPlanTekst', S.denkerPlan.tekst));
        tegel.appendChild(pl);
      }
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
      kb.dataset.actie = 'scherm';
      knoppen.appendChild(kb);
      if (s.vervangen) { const w = el('button', 'klein-knop', 'Weer erbij'); w.dataset.actie = 'weer'; knoppen.appendChild(w); }
      // 1.9.21 (451): van baas wisselen. Koppelen regelt het vanzelf (de eerste telefoon is de baas); dit is voor later.
      if (t.jarvis && !t.kern) { const b = el('button', 'klein-knop', 'Maak dit de baas'); b.dataset.actie = 'baas'; knoppen.appendChild(b); }
      {
        const gm = m.status && m.status.gemma && tijd - m.status.gemma.t <= K.MAX_LEEFTIJD_MS ? m.status.gemma.waarde : null;
        if (t.jarvis && gm && gm.kanOpruimen) { const b = el('button', 'klein-knop', 'Ruim op'); b.dataset.actie = 'ruim'; b.title = 'Wist alleen de dubbele kopie van het model in JARVIS zelf'; knoppen.appendChild(b); }
      }
      {
        const gm2 = m.status && m.status.gemma && tijd - m.status.gemma.t <= K.MAX_LEEFTIJD_MS ? m.status.gemma.waarde : null;
        if (t.jarvis && gm2 && gm2.ollite && gm2.ollite.kanStarten) { const b = el('button', 'klein-knop', 'Open OlliteRT'); b.dataset.actie = 'olliteStart'; b.title = 'JARVIS opent de OlliteRT-app op die telefoon. De server aanzetten doe je daar zelf, tenzij OlliteRT hem vanzelf start.'; knoppen.appendChild(b); }
        if (installeerKans && t.jarvis) { const ib = el('button', 'klein-knop', S.installQr[t.adres] ? 'OlliteRT installeren: verberg' : 'OlliteRT installeren'); ib.dataset.actie = 'installeer'; ib.title = 'Laat een QR zien naar de officiële pagina van OlliteRT. Jij downloadt zelf; Veronica en JARVIS downloaden niets.'; knoppen.appendChild(ib); }
        {
          const mo = m.status && m.status.motor && tijd - m.status.motor.t <= K.MAX_LEEFTIJD_MS ? m.status.motor.waarde : null;
          if (t.jarvis && mo && mo.fase !== 'te-oud') {
            const mb = el('button', 'klein-knop', mo.aan ? 'Eigen motor: uit' : 'Eigen motor: aan');
            mb.dataset.actie = 'motor'; mb.dataset.aan = mo.aan ? '0' : '1';
            mb.title = mo.aan ? 'Zet de eigen motor van JARVIS op die telefoon uit' : 'JARVIS op die telefoon haalt het model binnen (alleen op wifi en aan de lader, ca. 2,6 GB) en rekent dan zelf';
            knoppen.appendChild(mb);
          }
        }
        const tb = el('button', 'klein-knop', 'Test deze telefoon'); tb.dataset.actie = 'test'; tb.title = 'Stuurt een korte vraag en laat het antwoord en de tijd zien'; knoppen.appendChild(tb);
        const nb = el('button', 'klein-knop', S.nulmeting[t.adres] && S.nulmeting[t.adres].loopt ? 'Nulmeting loopt...' : 'Nulmeting (20 min)'); nb.dataset.actie = 'nulmeting'; nb.title = 'Meet twintig minuten wat deze telefoon echt kan: snelheid, warmte en accu. Een keer per telefoon.'; knoppen.appendChild(nb);
      }
      tegel.appendChild(knoppen);
      if (S.testUitslag[t.adres]) tegel.appendChild(el('div', 'tBron', S.testUitslag[t.adres].zin));
      if (S.nulmeting[t.adres] && S.nulmeting[t.adres].zin) tegel.appendChild(el('div', 'tBron', S.nulmeting[t.adres].zin));
      if (S.installQr[t.adres] && window.qrcode) {
        // 460: een QR naar de OFFICIELE pagina van OlliteRT. Geen download, geen eigen kopie: jij scant, kiest de nieuwste versie en installeert zelf.
        const blok = el('div', 'tInstall');
        const vak = el('div', 'qr-vak');
        const q = window.qrcode(0, 'M'); q.addData(K.OLLITERT_PAGINA); q.make();
        vak.innerHTML = q.createSvgTag(5, 12);   // alleen uit de QR-bibliotheek: vierkantjes, geen tekst van buiten
        const svg = vak.querySelector('svg');
        if (svg) { svg.classList.add('qr-plaatje'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR-code naar de officiële pagina van OlliteRT'); }
        blok.appendChild(vak);
        blok.appendChild(el('div', 'tBron', `Scan met ${t.naam}. Dit is de officiële pagina van OlliteRT (gratis, Apache 2.0): ${K.OLLITERT_PAGINA}. Download daar het nieuwste .apk-bestand, installeer het, open OlliteRT, download een Gemma-model en tik Start Server. Zet in OlliteRT ook Start on Boot aan en de batterij op Onbeperkt.`));
        tegel.appendChild(blok);
      }
      if (sch.aan) {
        const img = el('img', 'tScherm');
        img.alt = `Scherm van ${t.naam}`;
        if (sch.url) img.src = sch.url;
        tegel.appendChild(img);
        tegel.appendChild(el('div', 'tBron', sch.zin || ''));
      }
      return tegel;
    })));
    // De stekkers: aan/uit, watt en kWh, elk met bron en leeftijd, en (1.9.15) de handknop.
    ruimHandOp();
    metScroll(() => morphKinderen($('stekkerTegels'), S.stekkers.map((k) => {
      const m = S.stekkerMeting[k.ip] || {};
      const tegel = el('section', 'tegel stekker');
      tegel.dataset.ip = k.ip;
      tegel.appendChild(el('h2', '', `${k.naam} · ${k.rol === 'laden' ? 'lader' : k.rol === 'meter' ? 'meter' : 'ventilator'}`));
      const dl = el('dl', 'tCijfers');
      for (const [label, x, opmaak] of [['Aan', m.aan, (v) => (v ? 'aan' : 'uit')], ['Vermogen', m.watt, (v) => `${Math.round(v)} W`],
        ['Spanning', m.spanning, (v) => `${Math.round(v)} V`], ['Totaal', m.kwh, (v) => `${String(Math.round(v * 100) / 100).replace('.', ',')} kWh`], ['Vandaag', m.vandaag, (v) => `${String(Math.round(v * 100) / 100).replace('.', ',')} kWh`]]) {
        const v = K.vakje(x || null, tijd, opmaak);
        const dd = el('dd', v.onbekend ? 'onbekend' : (v.oud ? 'oud' : ''));
        dd.appendChild(el('span', 'waarde', v.tekst));
        if (v.bron) dd.appendChild(el('span', 'bron', v.bron));
        dl.append(el('dt', '', label), dd);
      }
      tegel.appendChild(dl);
      if (m.meet === false) tegel.appendChild(el('div', 'tBron', 'Deze stekker meet niet (geen energie in Tasmota Status 8).'));
      // 463b: de rol zetten (lader, meter of ventilator). De baas doet het; een meter schakelt nooit.
      const rolRij = el('div', 'tKnoppen vRol');
      for (const [rol, tekst] of [['laden', 'Lader'], ['meter', 'Meter'], ['ventilator', 'Ventilator']]) {
        const b = el('button', `vRol-${rol}`, tekst);
        b.dataset.rolNaam = k.naam; b.dataset.nieuweRol = rol;
        b.setAttribute('aria-pressed', String(k.rol === rol));
        rolRij.appendChild(b);
      }
      tegel.appendChild(rolRij);
      if (k.rol === 'meter') { tegel.appendChild(el('div', 'tBron', 'Meter: alleen lezen. Deze stekker schakelt nooit.')); return tegel; }
      // 1.9.15: DE HANDKNOP. Automatisch, Aan of Uit; met de hand gaat altijd voor. Veronica stuurt het verzoek naar
      // de baas (/jarvis/roep, met de code); de baas schakelt. De stand hier is wat de baas zegt.
      const hand = HandV.gekozen[k.naam] || (S.zonStroom && S.zonStroom.handPer && S.zonStroom.handPer[k.naam]) || null;
      const rij = el('div', 'tKnoppen vHand');
      for (const [stand, tekst] of [['auto', 'Automatisch'], ['aan', 'Aan'], ['uit', 'Uit']]) {
        const b = el('button', `vHand-${stand}`, tekst);
        b.dataset.hand = stand;
        b.dataset.stekker = k.naam;
        b.setAttribute('aria-pressed', String(hand === stand));
        rij.appendChild(b);
      }
      tegel.appendChild(rij);
      tegel.appendChild(el('div', 'tBron', hand === null ? 'Handknop: onbekend (de baas meldt het nog niet).'
        : hand === 'auto' ? (k.rol === 'laden' ? "Automatisch: in de zonuren aan, daarbuiten uit; zakt een telefoon onder de reserve, dan toch aan." : 'Automatisch: aan vanaf 35 °C, uit als alles 33 °C of koeler is.')
          : `Met de hand ${hand}: dat gaat voor, tot je Automatisch kiest.${HandV.gekozen[k.naam] ? ' (doorgegeven)' : ''}`));
      return tegel;
    })));
    $('stekkerKop').hidden = !S.stekkers.length;
    tekenStekkerNieuw();
    tekenSamen(tijd);
    tekenZonStroom(tijd);
    tekenVerbruik(tijd);
    tekenWachtrij();
    tekenTakenverdeling(false);
  }

  // 452b: NIEUWE STEKKERS. JARVIS (de baas) zoekt zelf Tasmota-stekkers op het wifi; hier staat wat hij vond, met twee
  // knoppen. Veronica zoekt NIET zelf (een webpagina kan geen mDNS en mag het lokale netwerk niet afzoeken).
  function tekenStekkerNieuw() {
    const heeft = (rol) => S.stekkers.some((k) => k.rol === rol);
    const mist = [heeft('ventilator') ? null : 'de ventilator', heeft('laden') ? null : 'de lader'].filter(Boolean);
    const kaarten = S.stekkersGevonden.map((g) => {
      const t = el('section', 'tegel stekker nieuw');
      t.dataset.sleutel = g.mac;
      t.append(el('h2', '', `🔌 Nieuwe stekker: ${g.naam}`), el('div', 'tRol', `Gevonden op het wifi (…${g.ip.split('.').pop()}). Wat doet hij?`));
      const rij = el('div', 'tKnoppen');
      for (const [rol, tekst] of [['ventilator', 'Dit is de ventilator'], ['laden', 'Dit is de lader'], ['meter', 'Dit is de meter']]) {
        const b = el('button', 'klein-knop', tekst);
        b.dataset.mac = g.mac; b.dataset.stekkerRol = rol;
        rij.appendChild(b);
      }
      t.appendChild(rij);
      return t;
    });
    const hint = (!kaarten.length && S.code && mist.length)
      ? [(() => { const p = el('p', 'eerlijk', `Nog geen stekker voor ${mist.join(' en ')}. Zet een Tasmota-stekker in het stopcontact en op je wifi (2,4 GHz): JARVIS zoekt hem zelf, en hij verschijnt dan hier met twee knoppen.`); p.dataset.sleutel = 'hint'; return p; })()] : [];
    morphKinderen($('stekkerNieuw'), kaarten.concat(hint));
    // 463b: het beheer-blokje (zoek nu, adres toevoegen, wat er gescand is) staat er zodra Veronica gekoppeld is.
    $('stekkerBeheer').hidden = !S.code;
    $('stekkerScanZin').textContent = K.scanZin(S.stekkerScan);
  }

  // 483: de schakelaar en de balk. De balk staat bovenaan op ELK scherm zolang Vol lokaal aan staat.
  function zetVolLokaal(aan) {
    VolL.aan = !!aan;
    try { localStorage.setItem(VOL_SLEUTEL, VolL.aan ? '1' : '0'); } catch (e) { /* alleen voor nu */ }
    logRegel(VolL.aan ? 'Vol lokaal AAN: niets gaat naar buiten, alleen je eigen telefoons.' : 'Vol lokaal UIT: meldingen, zoeken en de postbus mogen weer.');
    tekenVolLokaal();
  }
  function tekenVolLokaal() {
    const balk = $('volLokaalBalk');
    if (balk) balk.hidden = !VolL.aan;
    const knop = $('volLokaalKnop');
    if (knop) { knop.textContent = `Vol lokaal: ${VolL.aan ? 'AAN' : 'UIT'}`; knop.setAttribute('aria-pressed', String(VolL.aan)); }
    const zin = $('volLokaalZin');
    if (zin) zin.textContent = VolL.aan
      ? 'AAN. Veronica praat alleen met je eigen telefoons (hun eigen motor). Geen meldingen via internet, geen zoeken, geen Claude, geen postbus, geen Google.'
      : 'UIT. Meldingen (ntfy), zoeken via de telefoons, het Claude-bureau en de postbus mogen naar buiten.';
  }
  document.addEventListener('click', (e) => { if (e.target && e.target.id === 'volLokaalKnop') zetVolLokaal(!VolL.aan); });

  // 487: EEN VERS POSTBUS-ADRES voor een telefoon die vastzit. Alleen in het geheugen van deze pagina (nooit in de opslag of een
  // logboek). Nieuwe JARVIS: een roep 'postbus' met de code (een tik). Oude JARVIS: de QR "LRWERK1 <adres>", een keer scannen.
  function neemPostbusVers(a) {
    const x = K.leesPostbusAdres(a);
    if (x && K.adresGetekend(x) > K.adresGetekend(S.postbusVers || '')) { S.postbusVers = x; try { if (VastV.apk || VastV.klok) tekenVast(); } catch (e) { /* nog niet geladen */ } }
  }
  async function geefVersAdres(adres) {
    const t = S.telefoons.find((x) => x.adres === adres);
    if (!t || !t.jarvis || !S.code || !K.adresVers(S.postbusVers)) return false;
    let ok = false;
    try { ok = (await haal(`${t.jarvis}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'postbus', van: 'veronica', adres: S.postbusVers }) }, 3000)).ok; } catch (e) { ok = false; }
    logRegel(ok ? `${t.naam}: vers postbus-adres gegeven. Hij kijkt nu zelf of er een nieuwe versie is.` : `${t.naam} antwoordt niet. Probeer het zo nog eens.`);
    return ok;
  }
  // 488: een geplakte verse code (uit de mail). Alleen in het geheugen, net als het adres van de baas.
  function plakVersCode(veld) {
    const a = K.leesPlakCode(veld && veld.value);
    if (!a || !K.adresVers(a)) { logRegel(a ? 'Deze code is ook al verlopen. Vraag een nieuwe.' : 'Dat is geen koppelcode. Hij begint met LRWERK1.'); return false; }
    neemPostbusVers(a);
    if (veld) veld.value = '';
    logRegel('Verse code ontvangen. Tik nu bij de telefoon op de knop.');
    try { tekenLive(); } catch (e) { /* de volgende ronde tekent */ }
    return true;
  }
  function toonVersQr(adres) {
    const t = S.telefoons.find((x) => x.adres === adres);
    if (!K.adresVers(S.postbusVers)) return false;
    const tekst = K.postbusQrTekst(S.postbusVers);
    const vak = $('versQrPaneel');
    if (!t || !tekst || !vak || typeof window.qrcode !== 'function') return false;
    const q = window.qrcode(0, 'M'); q.addData(tekst); q.make();
    $('versQrBeeld').src = q.createDataURL(6, 16);
    $('versQrNaam').textContent = t.naam;
    vak.hidden = false;
    return true;
  }
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button[data-vers-adres],button[data-vers-qr]') : null;
    const pk = e.target && e.target.closest ? e.target.closest('button[data-vers-plak-knop]') : null;
    if (pk) plakVersCode(pk.parentNode.querySelector('textarea[data-vers-plak]'));
    if (b && b.dataset.versAdres) geefVersAdres(b.dataset.versAdres).catch(() => {});
    else if (b && b.dataset.versQr) toonVersQr(b.dataset.versQr);
    if (e.target && e.target.id === 'versQrSluit') { $('versQrPaneel').hidden = true; $('versQrBeeld').removeAttribute('src'); }
  });

  // ---- 504: TELEFOON ZIT VAST (gastnetwerk, oude JARVIS met een verlopen postbus-adres). De mail "JARVIS weer bijwerken" plakken:
  // de downloadlink van jarvis.apk en de koppelcode komen als QR op Koppelen, met tot wanneer ze gelden. ALLEEN in het geheugen
  // (Veronica is openbaar; een ondertekend adres hoort nergens bewaard). Veronica kan zelf GEEN nieuwe link maken: de sleutel
  // daarvoor staat alleen op de server. Wel neemt ze een nieuwer adres van de baas vanzelf over (neemPostbusVers), en stuurt ze de
  // code via de brievenbus naar elke telefoon die zich meldt, een keer per telefoon per adres.
  const VastV = { apk: null, gestuurd: {}, klok: null };
  function qrPlaatje(img, tekst) {
    if (!img || !tekst || typeof window.qrcode !== 'function') return false;
    try { const q = window.qrcode(0, 'L'); q.addData(tekst); q.make(); img.src = q.createDataURL(5, 16); return true; } catch (e) { return false; }
  }
  function tekenVast() {
    const t = nu();
    const apkGoed = VastV.apk && K.nogGeldig(VastV.apk, t);
    if (VastV.apk && !apkGoed) VastV.apk = null;
    const code = K.adresVers(S.postbusVers, t) && K.nogGeldig(S.postbusVers, t) ? S.postbusVers : null;
    const ab = $('vastApkBlok'), cb = $('vastCodeBlok');
    if (ab) {
      ab.hidden = !(apkGoed && qrPlaatje($('vastApkQr'), VastV.apk));
      if (ab.hidden) { if ($('vastApkQr')) $('vastApkQr').removeAttribute('src'); }
      else $('vastApkTijd').textContent = `Deze downloadlink werkt tot ${K.totZin(K.geldigTot(VastV.apk))}. Hij haalt altijd de nieuwste JARVIS.`;
    }
    if (cb) {
      cb.hidden = !(code && qrPlaatje($('vastCodeQr'), K.postbusQrTekst(code)));
      if (cb.hidden) { if ($('vastCodeQr')) $('vastCodeQr').removeAttribute('src'); }
      else $('vastCodeTijd').textContent = `Deze koppelcode werkt tot ${K.totZin(K.geldigTot(code))}.`;
    }
    const st = $('vastStand');
    if (st && (VastV.apk || code)) st.textContent = 'Klaar. Scan per telefoon de eerste QR met de camera.';
    else if (st && st.dataset.geweest) st.textContent = 'De link uit de mail is verlopen. Vraag een nieuwe mail.';
    return !!(apkGoed || code);
  }
  function plakMail(tekst) {
    const m = K.leesMail(tekst);
    const t = nu();
    const st = $('vastStand');
    if (m.code && K.adresVers(m.code, t)) neemPostbusVers(m.code);
    if (m.apk && K.nogGeldig(m.apk, t) && (!VastV.apk || K.adresGetekend(m.apk) > K.adresGetekend(VastV.apk))) VastV.apk = m.apk;
    if ($('mailPlak')) $('mailPlak').value = '';
    if (!m.apk && !m.code) { if (st) st.textContent = 'Ik vond geen downloadlink en geen koppelcode in deze tekst. Plak de hele mail.'; return false; }
    if (st) st.dataset.geweest = '1';
    const goed = tekenVast();
    if (!goed && st) st.textContent = 'De link en de code uit deze mail zijn al verlopen. Vraag een nieuwe mail.';
    if (goed) { Object.keys(HB.per).forEach((id) => geefPostbusViaBrievenbus(HB.per[id]).catch(() => {})); }
    if (!VastV.klok) VastV.klok = setInterval(tekenVast, 60000);
    try { if (goed) $('kaartVast').scrollIntoView({ block: 'start' }); } catch (e) { /* geen scherm */ }
    return goed;
  }
  // 508: GEEN HARTSLAG TERWIJL JARVIS WEL ANTWOORDT. Een telefoon die de beheerder niet ziet (gastnetwerk) maakt als waarnemend baas
  // een EIGEN brievenbus-onderwerp; een telefoon die voor de brievenbus gekoppeld werd kent er geen. Dan gaat zijn hartslag ergens heen
  // waar Veronica niet luistert. JARVIS 1.9.48 meldt een vingerafdruk; wijkt die af (of is er geen), dan geeft Veronica EEN keer per
  // half uur haar onderwerp, met de code, over het wifi (roep 'ntfy'). Het onderwerp zelf staat nooit open in /jarvis/status.
  // 515: REK VANZELF (kern.js rekBesluit). Staat standaard AAN (opdracht van de eigenaar, 20 oktober: "rekenkracht delen laten
  // werken"); de knop op Live zet hem uit. De rem per telefoon staat in deze browser (alleen tijden, geen sleutel), zodat een
  // herlaadbeurt de telefoons niet opnieuw bestookt.
  const RekV = { per: (() => { try { return JSON.parse(localStorage.getItem('veronica-rek-rem') || '{}') || {}; } catch (e) { return {}; } })() };
  const rekAan = () => { try { return localStorage.getItem('veronica-rek-vanzelf') !== 'uit'; } catch (e) { return true; } };
  async function rekVanzelf(t, st) {
    if (!rekAan() || !t || !t.jarvis || !S.code || !st || volLokaal()) return [];
    const tijd = nu();
    const sleutel = t.id || t.adres;
    const eerder = RekV.per[sleutel] || {};
    const nieuwste = K.nieuwsteVersie(S.telefoons.map((x) => { const v = (meet(x.adres).status || {}).versie; return v && v.waarde; }));
    const besluit = K.rekBesluit(st, tijd, eerder, nieuwste);
    const gedaan = [];
    for (const b of besluit) {
      eerder[b.wat] = tijd;   // ook als het misgaat: de rem geldt, anders elke meting opnieuw
      let ok = false; let code = 0;
      try { const r = await haal(`${t.jarvis}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify(b.roep) }, 3000); ok = r.ok; code = r.status; } catch (e) { ok = false; }
      if (ok) gedaan.push(b.wat);
      const waarom = code === 401 || code === 403 ? 'deze telefoon kent de code van de rij niet (een keer de QR van Veronica scannen op die telefoon lost dat op)' : 'geen antwoord';
      logRegel(b.wat === 'kijk'
        ? (ok ? `${t.naam} loopt achter (${(st.versie || {}).waarde || '?'}); ik vroeg hem nu te kijken of er een nieuwe versie is.` : `${t.naam} loopt achter, maar de vraag om te kijken kwam niet aan: ${waarom}.`)
        : (ok ? `${t.naam} is werker en zijn eigen motor stond uit; ik zette hem aan. Het model komt vanzelf binnen (wifi en lader).` : `${t.naam}: motor aanzetten kwam niet aan: ${waarom}.`));
    }
    if (besluit.length) {
      RekV.per[sleutel] = eerder;
      try { localStorage.setItem('veronica-rek-rem', JSON.stringify(RekV.per)); } catch (e) { /* alleen voor nu */ }
    }
    return gedaan;
  }
  // De knop "Laat meerekenen" bij een telefoon die beheerder is en als dagelijkse telefoon rust: hij wordt werker ('word-werker',
  // met de code), en rekent daarna mee. Een tik van een mens, nooit vanzelf (495).
  async function rekWerkerMaken(adres) {
    const t = S.telefoons.find((x) => x.adres === adres);
    if (!t || !t.jarvis || !S.code) return false;
    let ok = false; let code = 0;
    try { const r = await haal(`${t.jarvis}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'word-werker', van: 'veronica' }) }, 3000); ok = r.ok; code = r.status; } catch (e) { ok = false; }
    logRegel(ok ? `${t.naam} is nu werker en rekent mee. Zijn eigen motor gaat zo vanzelf aan.`
      : code === 401 || code === 403 ? `${t.naam} kent de code van de rij niet. Scan op die telefoon een keer de QR van Veronica (Koppelen); daarna kan het met deze knop.`
        : `${t.naam} antwoordt niet. Probeer het zo nog eens.`);
    if (ok) { delete (RekV.per[t.id || t.adres] || {}).motor; }
    return ok;
  }
  document.addEventListener('click', (e) => {
    const b = e.target;
    if (b && b.dataset && b.dataset.rekWerker) rekWerkerMaken(b.dataset.rekWerker);
    if (b && b.id === 'rekVanzelfKnop') {
      try { localStorage.setItem('veronica-rek-vanzelf', rekAan() ? 'uit' : 'aan'); } catch (x) { /* alleen voor nu */ }
      b.textContent = `Rek vanzelf: ${rekAan() ? 'aan' : 'uit'}`;
      logRegel(rekAan() ? 'Rek vanzelf staat aan: telefoons die achterlopen kijken naar een nieuwe versie, werkers krijgen hun motor aan.' : 'Rek vanzelf staat uit.');
    }
  });
  if ($('rekVanzelfKnop')) $('rekVanzelfKnop').textContent = `Rek vanzelf: ${rekAan() ? 'aan' : 'uit'}`;
  async function geefNtfy(t, st) {
    const b = st && st.brievenbus && st.brievenbus.waarde;
    const o = S.ntfy && S.ntfy.onderwerp;
    if (!b || !o || !S.code || !t || !t.jarvis || !window.Hartslag) return false;
    if (NtfyGeefV.mijnVan !== o) { NtfyGeefV.mijn = await window.Hartslag.vinger(o); NtfyGeefV.mijnVan = o; }
    if (b.onderwerp && b.vinger === NtfyGeefV.mijn) return false;
    if (nu() - (NtfyGeefV.per[t.adres] || 0) < 30 * 60000) return false;
    NtfyGeefV.per[t.adres] = nu();
    let ok = false;
    try {
      ok = (await haal(`${t.jarvis}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code },
        body: JSON.stringify({ soort: 'ntfy', van: 'veronica', ntfy: { onderwerp: o, aan: S.ntfy.aan !== false, stil: S.ntfy.stil } }) }, 3000)).ok;
    } catch (e) { ok = false; }
    if (ok) logRegel(`${t.naam} ${b.onderwerp ? 'gebruikte een andere brievenbus' : 'kende de brievenbus nog niet'}; ik gaf hem de mijne. Zijn hartslag komt nu bij mij aan.`);
    return ok;
  }
  // Een roep naar EEN telefoon (op zijn id) via de brievenbus. true = afgeleverd bij ntfy.
  async function roepNaarId(id, roep) {
    if (await doorgeefNaarId(id, roep)) return true;   // 514: eerst de postbus via een telefoon die wel antwoordt
    const o = S.ntfy && S.ntfy.onderwerp;
    if (!id || !o || !S.code || !window.Hartslag || volLokaal()) return false;
    const v = await window.Hartslag.roepVerzoek(o, Object.assign({}, roep, { naar: id }), S.code, nu());
    if (!v) return false;
    try { return (await fetch(v.url, { method: 'POST', body: v.data, cache: 'no-store' })).ok; } catch (e) { return false; }
  }
  async function geefPostbusViaBrievenbus(h) {
    const a = S.postbusVers;
    if (!h || !h.id || !K.adresVers(a) || !K.nogGeldig(a)) return false;
    if (VastV.gestuurd[h.id] === a) return false;
    if (!(await roepNaarId(h.id, { soort: 'postbus', adres: a }))) return false;
    VastV.gestuurd[h.id] = a;
    logRegel(`${h.naam || 'Een telefoon'} kreeg de verse koppelcode via de brievenbus. Hij kijkt nu zelf of er een nieuwe versie is.`);
    return true;
  }
  // 505: EEN MOTOR DIE VASTLIEP ZELF WEER OP GANG. JARVIS 1.9.47 probeert een mislukte download vanzelf opnieuw, maar een model dat
  // niet LAADT blijft op "fout" staan tot de motor uit en weer aan gaat. Ziet Veronica dat in een verse hartslag, dan stuurt ze
  // EEN roep "motor-aan" (die zet de motor opnieuw aan en wist de fout), hoogstens eens per drie uur per telefoon. Niet bij de
  // dagelijkse telefoon, niet als de motor uit staat (dan koos een mens of de telefoon zelf), en niet bij "te oud".
  const MotorHerstelV = { per: {}, ELKE_MS: 3 * 3600 * 1000 };
  function motorHerstelNodig(h, t) {
    const m = h && h.motor;
    if (!h || !h.id || h.dagelijks || !m || !m.aan || m.klaar || m.teOud || m.fase !== 'fout') return false;
    if (!h.t || (t || nu()) - h.t > K.HARTSLAG_VERS_MS) return false;
    return (t || nu()) - (MotorHerstelV.per[h.id] || 0) >= MotorHerstelV.ELKE_MS;
  }
  async function herstelMotor(h) {
    if (!motorHerstelNodig(h)) return false;
    MotorHerstelV.per[h.id] = nu();
    const ok = await roepNaarId(h.id, { soort: 'motor-aan', van: 'veronica' });
    logRegel(ok ? `${h.naam || 'Een telefoon'}: de eigen motor liep vast; ik heb hem opnieuw aangezet (via de brievenbus).`
      : `${h.naam || 'Een telefoon'}: de eigen motor liep vast, maar de brievenbus was niet te bereiken. Ik probeer het later.`);
    if (!ok) MotorHerstelV.per[h.id] = 0;
    return ok;
  }
  document.addEventListener('click', (e) => { if (e.target && e.target.id === 'mailPlakKnop') plakMail(($('mailPlak') || {}).value); });

  // ---- 501: DE MOTOR-INSTELLINGEN OP AFSTAND (motorinstel.js, byte-gelijk met JARVIS). Een paneel buiten de tegels (die worden
  // steeds opnieuw getekend). Bewaren = EEN roep 'motor-instel' met de code; lukt het wifi niet, dan gaat hij via de brievenbus (haal).
  // De dagelijkse telefoon krijgt hier geen knop: zijn eigen harde regels (495) gaan altijd voor.
  const InstV = { id: '', adres: '' };
  function openInstel(id, adres) {
    const h = HB.per[id];
    if (!h || !window.MotorInstel) return false;
    InstV.id = id; InstV.adres = adres;
    const i = window.MotorInstel.schoon(h.instel || {}, {});
    $('instelNaam').textContent = h.naam || 'deze telefoon';
    $('instelModel').value = i.model; $('instelGpu').checked = i.gpu; $('instelDraden').value = i.draden; $('instelContext').value = i.context;
    $('instelTemp').value = i.temp; $('instelDenk').value = i.denk; $('instelAccu').value = i.accuMin; $('instelWarmte').value = i.tempMax; $('instelLader').checked = i.alleenLader;
    $('instelStand').textContent = window.MotorInstel.zin(h.instel ? i : null);
    $('instelPaneel').hidden = false;
    return true;
  }
  function instelUitPaneel() {
    const n = (id) => Number($(id).value);
    return { model: $('instelModel').value, gpu: $('instelGpu').checked, draden: n('instelDraden'), context: n('instelContext'), temp: n('instelTemp'), denk: n('instelDenk'),
      accuMin: n('instelAccu'), tempMax: n('instelWarmte'), alleenLader: $('instelLader').checked };
  }
  async function stuurInstel(standaard) {
    const t = S.telefoons.find((x) => x.adres === InstV.adres);
    const doel = t && t.jarvis ? t.jarvis : InstV.adres;
    if (!S.code || !doel) { $('instelStand').textContent = 'Nog niet gekoppeld.'; return false; }
    const lijf = standaard ? { soort: 'motor-instel', standaard: true, van: 'veronica' } : { soort: 'motor-instel', instel: window.MotorInstel.schoon(instelUitPaneel(), {}), van: 'veronica' };
    let r = null;
    // 505: over het wifi alleen als de telefoon daar nu antwoordt; anders (gastnetwerk, oud adres) meteen via de brievenbus, op
    // zijn toestel-id. Zo hangt het niet aan een adres dat niets meer zegt.
    if (staat(InstV.adres).bereikbaar) {
      try { r = await haal(`${doel}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify(lijf) }, 3000); } catch (e) { r = null; }
    }
    if (!(r && r.ok) && InstV.id && await roepNaarId(InstV.id, lijf)) r = { ok: true, brievenbus: true };
    $('instelStand').textContent = r && r.ok ? (r.brievenbus ? 'Verstuurd via de brievenbus: de telefoon neemt het binnen een minuut over. Bij de volgende hartslag zie je het op de tegel.'
      : 'Verstuurd. Bij de volgende hartslag zie je het op de tegel.') : 'Dit kwam niet aan (geen wifi en geen brievenbus). Probeer het straks nog eens.';
    if (r && r.ok) logRegel(`Motor-instellingen ${standaard ? 'terug naar standaard' : 'verstuurd'} (${(HB.per[InstV.id] || {}).naam || 'telefoon'}).`);
    return !!(r && r.ok);
  }
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button[data-instel-id]') : null;
    if (b) openInstel(b.dataset.instelId, b.dataset.instelAdres);
    const id = e.target && e.target.id;
    if (id === 'instelBewaar') stuurInstel(false).catch(() => {});
    if (id === 'instelStandaard') stuurInstel(true).catch(() => {});
    if (id === 'instelSluit') $('instelPaneel').hidden = true;
  });

  // 492: "Zelftest nu": EEN roep 'zelftest' met de code. De telefoon kijkt alleen; de uitslag komt met de volgende meting.
  // 496: DE ZANDBAK (Veilig browsen, docs/veilig-browsen.md). Veronica onthoudt alleen WELKE telefoon de zandbak is (het adres, in
  // deze browser). Aanwijzen = EEN roep 'zandbak' met de code; de telefoon wist daarna zelf al zijn sleutels. Nooit de beheerder.
  const Zandbak = {
    SLEUTEL: 'veronica-zandbak',
    lijst() { try { const l = JSON.parse(localStorage.getItem(this.SLEUTEL) || '[]'); return Array.isArray(l) ? l.filter((a) => typeof a === 'string').slice(0, 8) : []; } catch (e) { return []; } },
    zet(l) { try { localStorage.setItem(this.SLEUTEL, JSON.stringify(l.slice(0, 8))); } catch (e) { /* alleen voor nu */ } },
  };
  async function maakZandbak(adres) {
    const t = S.telefoons.find((x) => x.adres === adres);
    if (!t || !t.jarvis || !S.code) return false;
    const st = meet(t.adres).status || {};
    if (t.kern || (st.rol && st.rol.waarde === 'baas') || (st.dagelijks && st.dagelijks.waarde)) { logRegel(`${t.naam} is een beheerder en wordt geen zandbak.`); return false; }
    let ok = false;
    try { ok = (await haal(`${t.jarvis}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'zandbak', van: 'veronica' }) }, 3000)).ok; } catch (e) { ok = false; }
    if (ok) { Zandbak.zet(Zandbak.lijst().filter((a) => a !== adres).concat([adres])); }
    logRegel(ok ? `${t.naam} is nu de zandbak. Hij doet niet meer mee en heeft alle sleutels van het systeem gewist.` : `${t.naam} antwoordt niet. Probeer het zo nog eens.`);
    tekenLive();
    return ok;
  }
  function zandbakKlaar(adres) {
    Zandbak.zet(Zandbak.lijst().filter((a) => a !== adres));
    logRegel('Zandbak uit de lijst. Tik op die telefoon in JARVIS op "Zandbak wissen"; daarna vraagt hij zelf om weer mee te doen.');
    tekenLive();
  }
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button[data-zandbak]') : null;
    if (!b) return;
    if (b.dataset.zandbakDoe === 'maak') { if (window.confirm('Deze telefoon als zandbak gebruiken? Hij stopt met rekenen en wist alle sleutels van het systeem.')) maakZandbak(b.dataset.zandbak).catch(() => {}); }
    else zandbakKlaar(b.dataset.zandbak);
  });
  // 497: OPSLAG OP KAARTJE (kaartje.js). Alleen niet-gevoelige kopieën; de koppelcode, het ntfy-onderwerp en het postbus-adres staan
  // in de lijst `verboden`, en de privé-hoek heeft hier geen knop. Een status-tik vraagt nooit om toestemming (dat kan alleen na een tik).
  const KaartjeL = window.Kaartje ? window.Kaartje.maak() : null;
  const kaartjeVerboden = () => [S.code, S.ntfy && S.ntfy.onderwerp, S.postbusVers, VastV.apk].filter((x) => typeof x === 'string' && x);
  function kaartjeGegevens(soort) {
    if (soort === 'logboek') return { soort, regels: S.log.map((x) => ({ t: x.t, zin: x.zin })) };
    if (soort === 'nachtproef') return { soort, regels: S.nachtlog };
    if (soort === 'overzicht') {
      const tijd = nu();
      return { soort, t: tijd, telefoons: S.telefoons.map((t) => ({ naam: t.naam, rol: K.rolZin(t, meet(t.adres).status, tijd) })), afnemers: S.afnemers };
    }
    if (soort === 'vertalingen') return { soort, concepten: S.nalees && Array.isArray(S.nalees.lijst) ? S.nalees.lijst.map((x) => ({ taakId: x.taakId, soort: x.soort, taal: x.taal, naam: x.naam, bron: x.bron, concept: x.concept })) : [] };
    return null;
  }
  async function tekenKaartje() {
    if (!KaartjeL || !$('kaartjeStatus')) return;
    const st = await KaartjeL.status();
    $('kaartjeStatus').textContent = window.Kaartje.STATUSZIN[st] || st;
    try { $('kaartjeRuimte').textContent = window.Kaartje.ruimteZin(await KaartjeL.ruimte()); } catch (e) { $('kaartjeRuimte').textContent = ''; }
    if ($('kaartjeKast')) $('kaartjeKast').textContent = KastV.zin;
    $('kaartjeToestemming').hidden = st !== 'toestemming-nodig';
    $('kaartjeKies').hidden = st === 'geen-api';
    $('kaartjeBewaar').hidden = st !== 'aanwezig';
    const l = st === 'aanwezig' ? await KaartjeL.lijst() : { namen: [] };
    $('kaartjeLijst').replaceChildren(...l.namen.slice(0, 20).map((n) => el('li', '', n)));
  }
  const kaartjeZin = (r) => (r.ok ? '' : window.Kaartje.FOUTZIN[r.fout] || 'Dat lukte niet.');
  document.addEventListener('click', async (e) => {
    const t = e.target;
    if (!t || !KaartjeL) return;
    if (t.id === 'kaartjeKies') { const r = await KaartjeL.kies(); $('kaartjeMelding').textContent = r.ok ? 'Map gekozen.' : kaartjeZin(r); await tekenKaartje(); }
    else if (t.id === 'kaartjeToestemming') { const r = await KaartjeL.vraagToestemming(); $('kaartjeMelding').textContent = r.ok ? 'Toestemming gegeven.' : kaartjeZin(r); await tekenKaartje(); }
    else if (t.id === 'kaartjeKijk') { await tekenKaartje(); }
    else if (t.dataset && t.dataset.kaartje) {
      const r = await KaartjeL.schrijf(t.dataset.kaartje, kaartjeGegevens(t.dataset.kaartje), kaartjeVerboden(), nu());
      $('kaartjeMelding').textContent = r.ok ? (r.plek === 'kaartje' ? `Bewaard op het kaartje: ${r.naam}.` : `Bewaard (intern): ${r.naam}. ${r.zin || ''}`.trim()) : kaartjeZin(r);
      await tekenKaartje();
    }
  });
  setTimeout(() => { tekenKaartje().catch(() => {}); }, 1500);
  // 498: NUL HANDELINGEN. Is de toestemming verlopen, dan vraagt Veronica hem bij de EERSTVOLGENDE tik ergens op de pagina (een
  // browser vraagt het alleen na een tik); een geinstalleerde Veronica krijgt hem zo meestal blijvend.
  document.addEventListener('pointerdown', () => {
    if (!KaartjeL) return;
    KaartjeL.status().then((st) => { if (st === 'toestemming-nodig') return KaartjeL.vraagToestemming().then(() => tekenKaartje()); return null; }).catch(() => {});
  }, { capture: true });
  // 498: elke dag vanzelf een kopie van het logboek en de nachtproef (op het kaartje, of intern als het er niet is).
  const KAARTJE_DAG = 'veronica-kaartje-dag';
  async function kaartjeDagTik() {
    if (!KaartjeL) return;
    const vandaag = new Date(nu()).toISOString().slice(0, 10);
    let laatste = null;
    try { laatste = localStorage.getItem(KAARTJE_DAG); } catch (e) { laatste = null; }
    if (laatste === vandaag) return;
    const a = await KaartjeL.schrijf('logboek', kaartjeGegevens('logboek'), kaartjeVerboden(), nu());
    if (S.nachtlog.length) await KaartjeL.schrijf('nachtproef', kaartjeGegevens('nachtproef'), kaartjeVerboden(), nu());
    if (a.ok) { try { localStorage.setItem(KAARTJE_DAG, vandaag); } catch (e) { /* morgen opnieuw */ } }
  }
  // 498: DE UITDEELKAST. Telefoons kunnen het kaartje niet zelf lezen; Veronica deelt uit over het EIGEN wifi (poort 8080, met de
  // code). Een model dat een werker vraagt: van het kaartje naar die telefoon, of eerst van een telefoon die hem al heeft naar het
  // kaartje. Wat een telefoon aanbiedt (een logboek): naar het kaartje (of intern), daarna mag de telefoon zijn kopie wissen.
  // Een ding tegelijk. Grote bestanden ALLEEN met het kaartje; geen server, geen postbus, geen internet.
  const KastV = { bezig: false, zin: '' };
  const kastVan = (t) => { const k = (meet(t.adres).status || {}).kast; return k && k.waarde && nu() - k.t <= K.MAX_LEEFTIJD_MS * 6 ? k.waarde : null; };
  async function kastTik() {
    if (!KaartjeL || KastV.bezig || !S.code) return;
    KastV.bezig = true;
    try {
      const kaartje = await KaartjeL.status() === 'aanwezig';
      for (const t of S.telefoons) {
        const k = kastVan(t);
        // 503: de kast werkt ALLEEN als Veronica de telefoon direct over het wifi bereikt. Op een gastnetwerk niet: dan zeggen we dat,
        // en een model haalt de telefoon gewoon zelf (op wifi, aan de lader). Logboeken blijven dan op de telefoon.
        if (!k && !staat(t.adres).bereikbaar && hartslagVers(t)) { KastV.zin = `Geen directe wifi-verbinding met ${t.naam}: de kast slaat hem over. Een model haalt hij zelf (wifi en lader); zijn logboeken blijven op de telefoon.`; continue; }
        if (!k || !t.jarvis || zandbakNu(t)) continue;
        // 1. het aanbod (klein: een logboek): naar het kaartje of intern, dan "klaar".
        for (const a of k.aanbod) {
          if (a.bytes > 20e6) continue;
          let tekst = null;
          try { const res = await haal(`${t.jarvis}/jarvis/kast/uit/${encodeURIComponent(a.naam)}`, { headers: { 'X-Koppelcode': S.code } }, 30000); if (res.ok) tekst = await res.text(); } catch (e) { tekst = null; }
          if (tekst === null) { KastV.zin = `Geen directe wifi-verbinding met ${t.naam}; de kast probeert het later. Een model haalt hij zelf.`; continue; }
          const w = await KaartjeL.schrijf('jarvis-logboek', tekst, kaartjeVerboden(), nu(), S.telefoons.indexOf(t) + 1);
          if (w.ok) { try { await haal(`${t.jarvis}/jarvis/kast/klaar?naam=${encodeURIComponent(a.naam)}`, { method: 'POST', headers: { 'X-Koppelcode': S.code } }, 5000); } catch (e) { /* volgende keer */ } }
          KastV.zin = w.ok ? `Logboek van ${t.naam} bewaard (${w.plek === 'kaartje' ? 'op het kaartje' : 'intern'}).` : kaartjeZin(w);
        }
        // 2. een model dat deze telefoon vraagt.
        for (const v of k.vraag) {
          if (!kaartje) { KastV.zin = `${t.naam} zoekt een model; zonder kaartje haalt hij het zelf.`; continue; }
          if (!(await KaartjeL.kastHeeft(v.naam, v.bytes))) {
            const bron = S.telefoons.find((x) => x !== t && x.jarvis && (kastVan(x) || { heeft: [] }).heeft.some((h) => h.naam === v.naam && h.sha256 === v.sha256));
            if (!bron) { KastV.zin = `${t.naam} zoekt een model dat nog niemand in huis heeft; hij haalt het zelf.`; continue; }
            KastV.zin = `Het model van ${bron.naam} gaat naar het kaartje (${window.Kaartje.grootte(v.bytes)}).`;
            let res = null;
            try { res = await haal(`${bron.jarvis}/jarvis/kast/uit/${encodeURIComponent(v.naam)}`, { headers: { 'X-Koppelcode': S.code } }, 60 * 60 * 1000); } catch (e) { res = null; }
            if (!res || !res.ok || !res.body) { KastV.zin = `${bron.naam} gaf het model niet; later nog eens.`; continue; }
            const w = await KaartjeL.kastSchrijfStroom(v.naam, res.body, v.bytes);
            if (!w.ok) { KastV.zin = kaartjeZin(w); continue; }
          }
          const f = await KaartjeL.kastBestand(v.naam);
          if (!f) continue;
          KastV.zin = `Het model gaat van het kaartje naar ${t.naam} (${window.Kaartje.grootte(v.bytes)}).`;
          let ok = false;
          try { const res = await haal(`${t.jarvis}/jarvis/kast/in?soort=model&naam=${encodeURIComponent(v.naam)}&sha256=${v.sha256}`, { method: 'POST', headers: { 'X-Koppelcode': S.code, 'Content-Type': 'application/octet-stream' }, body: f }, 60 * 60 * 1000); ok = res.ok; } catch (e) { ok = false; }
          KastV.zin = ok ? `${t.naam} heeft het model van het kaartje gekregen; hij rekent het zelf na.` : `Geen directe wifi-verbinding met ${t.naam}: het model gaat niet via de kast. Hij haalt het zelf (wifi en lader).`;
          logRegel(KastV.zin);
        }
      }
    } finally { KastV.bezig = false; tekenKaartje().catch(() => {}); }
  }
  setInterval(() => { kaartjeDagTik().catch(() => {}); kastTik().catch(() => {}); }, 2 * 60 * 1000);
  setTimeout(() => { kaartjeDagTik().catch(() => {}); }, 20 * 1000);
  async function vraagZelftest(adres) {
    const t = S.telefoons.find((x) => x.adres === adres);
    if (!t || !t.jarvis || !S.code) return false;
    let ok = false;
    try { ok = (await haal(`${t.jarvis}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'zelftest', van: 'veronica' }) }, 3000)).ok; } catch (e) { ok = false; }
    logRegel(ok ? `${t.naam} doet de zelftest. Over een halve minuut staat de uitslag op de tegel.` : `${t.naam} antwoordt niet. Probeer het zo nog eens.`);
    return ok;
  }
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button[data-zelftest]') : null;
    if (b) vraagZelftest(b.dataset.zelftest).catch(() => {});
  });

  // 485: SAMENWERKEN op trede 1. De voorstellen van de AI-kern op de baas; een tik stuurt EEN oordeel (/jarvis/roep, soort 'voorstel',
  // met de code). Goedkeuren legt het alleen vast: er wordt niets vanzelf uitgevoerd (dat is trede 2, en die staat dicht).
  const SamenV = { verstuurd: {} };
  const TOKENPRIJS_SLEUTEL = 'veronica-tokenprijs';
  function leesTokenprijsOpslag() { try { return localStorage.getItem(TOKENPRIJS_SLEUTEL); } catch (e) { return null; } }
  function tekenSamenwerken() {
    const blok = $('samenBlok');
    if (!blok) return;
    const s = S.samen;
    blok.hidden = !s && !S.afnemers;
    if (blok.hidden) return;
    $('samenTrede').textContent = s ? K.TREDE_ZIN[s.trede] : '';
    $('samenAfnemers').textContent = S.afnemers && window.Afnemers ? window.Afnemers.zin(S.afnemers) : '';
    // 495: LOKAAL EERST -- hoeveel er op de Gemma's in huis gedaan is, en wat dat ongeveer scheelt (prijs: zelf instellen).
    $('samenLokaal').textContent = S.afnemers && window.Afnemers ? window.Afnemers.bespaardZin(S.afnemers, K.leesTokenprijs(leesTokenprijsOpslag())) : '';
    const tpv = $('tokenprijsVeld');
    if (tpv && document.activeElement !== tpv) tpv.value = String(K.leesTokenprijs(leesTokenprijsOpslag())).replace('.', ',');
    $('samenKennis').textContent = s && s.kennisboek !== null ? `Kennisboek: ${s.kennisboek} ${s.kennisboek === 1 ? 'regel' : 'regels'} (de vaste woorden en regels die elke telefoon meekrijgt).` : '';
    const lijst = (s ? s.voorstellen : []).filter((v) => !SamenV.verstuurd[v.id]);
    const vak = $('samenLijst');
    const nieuw = new Set(lijst.map((v) => v.id));
    for (const k of [...vak.querySelectorAll('[data-voorstel]')]) if (!nieuw.has(k.dataset.voorstel)) k.remove();
    const er = new Set([...vak.querySelectorAll('[data-voorstel]')].map((k) => k.dataset.voorstel));
    for (const v of lijst) {
      if (er.has(v.id)) continue;
      const kaart = el('div', 'zsPaneel'); kaart.dataset.voorstel = v.id;
      kaart.appendChild(el('h3', '', `Voorstel van ${v.klant}: ${v.titel || '(zonder titel)'}`));
      kaart.appendChild(el('p', '', v.tekst));
      const ja = el('button', '', 'Goedkeuren'); ja.dataset.samen = 'goed';
      const nee = el('button', '', 'Afwijzen'); nee.dataset.samen = 'af';
      kaart.append(ja, nee, el('p', 'klein'));
      vak.appendChild(kaart);
    }
    if (!lijst.length && !vak.querySelector('.samenLeeg')) vak.appendChild(el('p', 'tBron samenLeeg', 'Geen voorstellen die op jou wachten.'));
    if (lijst.length) for (const x of [...vak.querySelectorAll('.samenLeeg')]) x.remove();
  }
  // 494: EEN NIEUWE TELEFOON TOELATEN vanaf de Chromebook. De nieuwe telefoon vroeg het zelf via Bluetooth; hier staat dezelfde vraag
  // als op de baas, met het getal. "Laat toe" = EEN roep 'nieuw-koppel' met de code; de baas geeft dan pas het koppelpakket.
  const NkV = { verstuurd: {} };
  function tekenNieuwKoppel() {
    const vak = $('nieuwKoppelBlok');
    if (!vak) return;
    const lijst = (S.nieuwKoppel || []).filter((w) => !NkV.verstuurd[w.id]);
    vak.hidden = !lijst.length;
    morphKinderen($('nieuwKoppelLijst'), lijst.map((w) => {
      const k = el('div', 'nkKaart');
      k.dataset.nk = w.id;
      k.appendChild(el('p', '', `${w.wie} wil meedoen. Staat op die telefoon het getal ${w.getal}? Dan: Laat toe.`));
      const ja = el('button', '', 'Laat toe'); ja.dataset.nkBesluit = 'ja';
      const nee = el('button', 'tweede', 'Niet'); nee.dataset.nkBesluit = 'nee';
      k.append(ja, nee, el('p', 'klein', ''));
      return k;
    }));
  }
  async function stuurNieuwKoppel(kaart, besluit) {
    const id = kaart.dataset.nk;
    const zin = kaart.querySelector('p.klein');
    const kern = kernNu();
    if (!kern || !S.code) { zin.textContent = 'Geen baas-telefoon bereikbaar. Tik op de baas zelf op OK.'; return; }
    zin.textContent = 'Even...';
    try {
      const r = await haal(`${kern}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'nieuw-koppel', van: 'veronica', id, besluit }) }, 4000);
      if (!r.ok) { zin.textContent = `De baas-telefoon gaf ${r.status}. Probeer het nog eens.`; return; }
      NkV.verstuurd[id] = besluit;
      logRegel(besluit === 'ja' ? 'Nieuwe telefoon toegelaten. Hij koppelt nu zelf en richt zich in.' : 'Nieuwe telefoon niet toegelaten.');
      tekenNieuwKoppel();
    } catch (e) { zin.textContent = 'De baas-telefoon antwoordt niet. Tik op de baas zelf op OK.'; }
  }
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button[data-nk-besluit]') : null;
    if (b) stuurNieuwKoppel(b.closest('[data-nk]'), b.dataset.nkBesluit).catch(() => {});
  });
  async function stuurVoorstelOordeel(kaart, besluit) {
    const id = kaart.dataset.voorstel;
    const zin = kaart.querySelector('p.klein');
    const kern = kernNu();
    if (!kern || !S.code) { zin.textContent = 'Geen baas-telefoon bereikbaar. Probeer het straks nog eens.'; return; }
    zin.textContent = 'Even...';
    try {
      const r = await haal(`${kern}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'voorstel', van: 'veronica', id, besluit }) }, 4000);
      if (!r.ok) { zin.textContent = `De baas-telefoon gaf ${r.status}. Probeer het nog eens.`; return; }
      SamenV.verstuurd[id] = besluit;
      logRegel(`Voorstel ${besluit === 'goed' ? 'goedgekeurd' : 'afgewezen'}. Er wordt niets vanzelf uitgevoerd.`);
      kaart.remove();
      tekenSamenwerken();
    } catch (e) { zin.textContent = 'De baas-telefoon antwoordt niet. Probeer het straks nog eens.'; }
  }
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button[data-samen]') : null;
    if (b) stuurVoorstelOordeel(b.closest('[data-voorstel]'), b.dataset.samen);
  });

  // 483: NALEZEN. De baas leest de concepten uit de postbus (stand.json, achter de code); een tik hier stuurt EEN oordeel naar de
  // baas (/jarvis/roep, soort 'oordeel', met de code). De baas legt het in de brievenbus; de server beslist als hij wakker is.
  const NaleesV = { verstuurd: {} };
  const SOORT_NAAM = { vertaal: 'Vertaling', keuring: 'Tekstkeuring', bord: 'Bordfoto', buurtpin: 'Buurtpin' };
  const TAAL_NAAM = { en: 'Engels', de: 'Duits' };
  function tekenNalees() {
    const blok = $('naleesBlok');
    if (!blok) return;
    const n = S.nalees;
    blok.hidden = !n;
    if (!n) return;
    const lijst = n.lijst.filter((x) => !NaleesV.verstuurd[x.taakId]);
    $('naleesZin').textContent = lijst.length ? `${lijst.length} ${lijst.length === 1 ? 'concept wacht' : 'concepten wachten'} op jou.`
      : `Niets om na te lezen.${n.verstuurd ? ` ${n.verstuurd} ${n.verstuurd === 1 ? 'oordeel ligt' : 'oordelen liggen'} klaar voor de server.` : ''}`;
    const vak = $('naleesLijst');
    const open = new Set([...vak.querySelectorAll('[data-taak]')].map((k) => k.dataset.taak));
    const nieuw = new Set(lijst.map((x) => x.taakId));
    for (const k of [...vak.querySelectorAll('[data-taak]')]) if (!nieuw.has(k.dataset.taak)) k.remove();
    for (const x of lijst) {
      if (open.has(x.taakId)) continue;   // een kaart waar je misschien in typt, laten staan
      const kaart = el('div', 'zsPaneel'); kaart.dataset.taak = x.taakId;
      kaart.appendChild(el('h3', '', `${SOORT_NAAM[x.soort] || x.soort}${x.taal ? ` naar het ${TAAL_NAAM[x.taal]}` : ''}: ${x.naam}`));
      const bron = el('details'); bron.appendChild(el('summary', '', 'De Nederlandse tekst')); bron.appendChild(el('p', '', x.bron)); kaart.appendChild(bron);
      if (x.soort === 'vertaal') { const t = el('textarea'); t.rows = 6; t.style.width = '100%'; t.value = x.concept; t.dataset.tekst = '1'; kaart.appendChild(t); }
      else kaart.appendChild(el('pre', '', x.concept));
      if (x.meldingen.length) kaart.appendChild(el('p', 'eerlijk', `Controle: ${x.meldingen.join('; ')}`));
      kaart.appendChild(el('p', 'tBron', `Gemaakt door ${x.telefoon || 'een telefoon'}.`));
      const goed = el('button', '', 'Goedkeuren'); goed.dataset.nalees = 'goed';
      const af = el('button', '', 'Afkeuren'); af.dataset.nalees = 'af';
      kaart.append(goed, af, el('p', 'klein'));
      vak.appendChild(kaart);
    }
  }
  async function stuurNaleesOordeel(kaart, besluit) {
    const id = kaart.dataset.taak;
    const x = S.nalees && S.nalees.lijst.find((y) => y.taakId === id);
    const zin = kaart.querySelector('p.klein');
    if (!x) { zin.textContent = 'Dit concept staat niet meer in de lijst.'; return; }
    if (volLokaal()) { zin.textContent = 'Vol lokaal staat aan: een oordeel gaat via de postbus naar buiten. Zet het eerst uit in Mijn privé-hoek.'; return; }
    const kern = kernNu();
    if (!kern || !S.code) { zin.textContent = 'Geen baas-telefoon bereikbaar. Probeer het straks nog eens.'; return; }
    const veld = kaart.querySelector('[data-tekst]');
    const lijf = { soort: 'oordeel', van: 'veronica', taakId: id, besluit };
    if (besluit === 'goed' && veld && veld.value.trim() !== x.concept.trim()) {
      if (new TextEncoder().encode(veld.value).length > 1500) { zin.textContent = 'Je wijziging is te lang om via de telefoon te sturen. Keur goed zonder wijziging, of wijzig op de beheerpagina.'; return; }
      lijf.tekst = veld.value;
    }
    zin.textContent = 'Even...';
    try {
      const r = await haal(`${kern}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify(lijf) }, 4000);
      if (!r.ok) { zin.textContent = `De baas-telefoon gaf ${r.status}. Probeer het nog eens.`; return; }
      NaleesV.verstuurd[id] = besluit;
      logRegel(`${besluit === 'goed' ? 'Goedgekeurd' : 'Afgekeurd'}: ${x.naam}. De baas legt het in de postbus.`);
      kaart.remove();
      tekenNalees();
    } catch (e) { zin.textContent = 'De baas-telefoon antwoordt niet. Probeer het straks nog eens.'; }
  }
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button[data-nalees]') : null;
    if (b) stuurNaleesOordeel(b.closest('[data-taak]'), b.dataset.nalees);
  });

  // 483: DE NACHTPROEF. De baas schrijft elk kwartier een regel (nachtlog.js); deze computer bewaart ze een week en toont
  // de laatste twaalf uur. Alleen wat de telefoons maten: een vraagteken is "niet gemeten", nooit nul.
  const NACHT_MAX = 7 * 24 * 4;
  function neemNachtlogOver(lijst) {
    if (!window.Nachtlog) return;
    const voor = S.nachtlog.length ? S.nachtlog[S.nachtlog.length - 1].t : 0;
    S.nachtlog = window.Nachtlog.leesLijst(S.nachtlog.concat(lijst), NACHT_MAX);
    const na = S.nachtlog.length ? S.nachtlog[S.nachtlog.length - 1].t : 0;
    if (na !== voor) { Opslag.schrijf('nachtlog', S.nachtlog).catch(() => {}); tekenNachtlog(); }
  }
  function tekenNachtlog() {
    const blok = $('nachtBlok');
    if (!blok || !window.Nachtlog) return;
    const tijd = nu();
    const recent = S.nachtlog.filter((r) => tijd - r.t <= 12 * 60 * 60 * 1000);
    blok.hidden = !S.nachtlog.length;
    if (blok.hidden) return;
    const klok = (t) => new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    const laatste = S.nachtlog[S.nachtlog.length - 1];
    $('nachtZin').textContent = recent.length
      ? `${recent.length} metingen in de laatste 12 uur. Laatste om ${klok(laatste.t)}${tijd - laatste.t > 30 * 60 * 1000 ? ` (${K.leeftijdZin(tijd - laatste.t)}: de baas schrijft nu niet)` : ''}.`
      : `Geen metingen in de laatste 12 uur. De laatste was om ${klok(laatste.t)}.`;
    const tabel = $('nachtTabel');
    tabel.replaceChildren();
    const namen = [];
    for (const r of recent) for (const t of r.telefoons) if (!namen.includes(t.naam)) namen.push(t.naam);
    const kop = el('tr');
    kop.appendChild(el('th', '', 'Tijd'));
    for (const n of namen) kop.appendChild(el('th', '', n));
    tabel.appendChild(kop);
    for (const r of recent.slice().reverse()) {
      const rij = el('tr');
      rij.appendChild(el('td', '', klok(r.t)));
      for (const n of namen) { const t = r.telefoons.find((x) => x.naam === n); rij.appendChild(el('td', '', t ? window.Nachtlog.zin(t) : '-')); }
      tabel.appendChild(rij);
    }
  }

  // 467: verbruik en kosten van de meter-stekker, met een tarief dat de mens zelf instelt (alleen in deze browser).
  const TARIEF_SLEUTEL = 'veronica-tarief';
  function leesTariefOpslag() { try { return localStorage.getItem(TARIEF_SLEUTEL); } catch (e) { return null; } }
  function tekenVerbruik(tijd) {
    const meter = S.stekkers.find((k) => k.rol === 'meter');
    const blok = $('verbruikBlok');
    blok.hidden = !meter;
    tekenVerslag();
    tekenNachtlog();
    if (!meter) return;
    const veld = $('tariefVeld');
    if (document.activeElement !== veld) veld.value = String(K.leesTarief(leesTariefOpslag())).replace('.', ',');
    const m = S.stekkerMeting[meter.ip] || {};
    if (m.meet === false) { $('verbruikRegel').textContent = 'Deze stekker meet niet (geen energie in Tasmota Status 8).'; return; }
    const w = (x) => (x && typeof x.waarde === 'number' ? x.waarde : null);
    const eerste = [m.watt, m.vandaag, m.kwh].find(Boolean);
    const bron = eerste ? K.vakje(eerste, tijd) : null;
    $('verbruikRegel').textContent = K.verbruikRegel({ watt: w(m.watt), vandaag: w(m.vandaag), kwh: w(m.kwh) }, leesTariefOpslag())
      + (bron ? ` Bron: ${bron.bron}${bron.oud ? ' (oude meting)' : ''}.` : '');
  }
  // 478: het verbruiksverslag (dagboek in deze browser; zie verslag.js).
  let dagboek = null;
  let verslagBezig = false;
  async function tekenVerslag() {
    const blok = $('verslagBlok');
    if (!blok || !window.Verslag || verslagBezig) return;
    verslagBezig = true;
    try {
      if (!dagboek) dagboek = window.Verslag.maakDagboek({ opslag: { lees: () => Opslag.lees('verbruiksdagboek'), schrijf: (t) => Opslag.schrijf('verbruiksdagboek', t) } });
      const meter = S.stekkers.find((k) => k.rol === 'meter');
      if (meter) {
        const m = S.stekkerMeting[meter.ip] || {};
        const w = (x) => (x && typeof x.waarde === 'number' ? x.waarde : null);
        const sf = S.zonStroom && S.zonStroom.staaf && S.zonStroom.staaf.waarde;
        await dagboek.noteer({ kwh: w(m.kwh), vandaag: w(m.vandaag), zon: sf && typeof sf.zon === 'number' ? sf.zon : null, buiten: sf && typeof sf.buiten === 'number' ? sf.buiten : null });
      }
      const dagen = (await dagboek.aantalDagen()) > 0;
      blok.hidden = !meter && !dagen;
      if (blok.hidden) return;
      const v = await dagboek.verslag(Number($('verslagDagen').value) || 7, leesTariefOpslag());
      $('verslagTekst').textContent = v.tekst;
    } catch (e) { /* het verslag is een gemak */ } finally { verslagBezig = false; }
  }
  document.addEventListener('change', (e) => { if (e.target && e.target.id === 'verslagDagen') tekenVerslag(); });
  document.addEventListener('click', async (e) => {
    const id = e.target && e.target.id;
    if (id === 'verslagKopieer') {
      let gelukt = false;
      try { await Promise.race([navigator.clipboard.writeText($('verslagTekst').textContent), new Promise((_, mis) => setTimeout(() => mis(new Error('te lang')), 2500))]); gelukt = true; } catch (x) { gelukt = false; }
      $('verslagMelding').textContent = gelukt ? 'Gekopieerd. Je kunt het nu plakken in een bericht of mail.' : 'Kopieren lukte niet. Selecteer de tekst van het verslag en kopieer met Ctrl+C.';
    } else if (id === 'nachtWis') {
      if (!window.confirm('De nachtproef op deze computer wissen? De baas houdt zijn eigen regels.')) return;
      S.nachtlog = []; await Opslag.schrijf('nachtlog', []); tekenNachtlog();
    } else if (id === 'verslagWis') {
      if (!dagboek || !window.confirm('Het hele verbruiksdagboek wissen? Dit staat alleen op deze computer.')) return;
      await dagboek.wisAlles(); $('verslagMelding').textContent = 'Het dagboek is leeg.'; tekenVerslag();
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'tokenprijsVeld') {   // 495
      try { localStorage.setItem(TOKENPRIJS_SLEUTEL, String(K.leesTokenprijs(e.target.value))); } catch (x) { /* alleen voor nu */ }
      tekenSamenwerken();
    }
    if (e.target && e.target.id === 'tariefVeld') {
      try { localStorage.setItem(TARIEF_SLEUTEL, String(K.leesTarief(e.target.value))); } catch (x) { /* alleen voor nu */ }
      tekenVerbruik(nu());
    }
  });

  // 469: WIE DOET WAT. De keuzes van de eigenaar (alleen uitsluiten) staan in deze browser; de regels staan in takenverdeling.js.
  const TAKEN_SLEUTEL = 'veronica-taken';
  function leesTakenKeuzes() { try { return Takenverdeling.schoonKeuzes(JSON.parse(localStorage.getItem(TAKEN_SLEUTEL) || '{}'), S.telefoons.map((t) => t.adres)); } catch (e) { return {}; } }
  function bewaarTakenKeuzes(k) { try { localStorage.setItem(TAKEN_SLEUTEL, JSON.stringify(Takenverdeling.schoonKeuzes(k, S.telefoons.map((t) => t.adres)))); } catch (e) { /* alleen voor nu */ } }
  function takenTelefoons() {
    const tijd = nu();
    return S.telefoons.map((t) => {
      const ps = poolStaat(t);
      const m = meet(t.adres);
      const mo = m.status && m.status.motor && tijd - m.status.motor.t <= K.MAX_LEEFTIJD_MS ? m.status.motor.waarde : null;
      const rol = m.status && m.status.rol && tijd - m.status.rol.t <= K.MAX_LEEFTIJD_MS ? m.status.rol.waarde : null;
      const cp = m.status && m.status.capaciteit && tijd - m.status.capaciteit.t <= K.MAX_LEEFTIJD_MS ? m.status.capaciteit.waarde : null;
      // 505: geen wifi maar wel een verse hartslag = via de brievenbus. Wat de wifi-meting niet weet, komt dan uit de hartslag.
      const h = hartslagVers(t) ? ((t.id && HB.per[t.id]) || hartslagVoorAdres(t.adres)) : null;
      const brief = !!h && !staat(t.adres).bereikbaar;   // zelfde vraag als de kop van Live (1249)
      const hm = brief && h.motor ? h.motor : null;
      return { naam: t.naam, adres: t.adres, kern: !!t.kern, rol: rol || (brief ? h.rol : null), klasse: ps.klasse, klasseReden: ps.klasseReden, modelGeladen: ps.modelGeladen, motorKlaar: !!((mo && mo.klaar) || (hm && hm.klaar)), bereikbaar: brief ? false : ps.bereikbaar, viaBrievenbus: brief, vervangen: ps.vervangen, hitteStand: ps.hitteStand, rust: ps.rust, magRekenen: ps.magRekenen,
        gespaard: schuifNu(t) || !!(brief && h.sparen), dagelijks: dagelijksRustNu(t) || !!(brief && h.dagelijks), geheugenKlaar: !!(mo && mo.geheugen && mo.geheugen.klaar), sdk: cp && typeof cp.sdk === 'number' ? cp.sdk : null };   // 481
    });
  }
  // 481: gespaard = de schuif Sparen op de telefoon zelf (alleen een verse melding telt). Veronica geeft hem dan niets.
  // 495: de dagelijkse telefoon die rust telt hier net zo: Veronica geeft hem niets.
  function schuifNu(t) { const g = (meet(t.adres).status || {}).gespaard; return !!(g && g.waarde === true && nu() - g.t <= K.MAX_LEEFTIJD_MS); }
  function dagelijksRustNu(t) { const g = (meet(t.adres).status || {}).dagelijks; return !!(g && g.waarde === 'rust' && nu() - g.t <= K.MAX_LEEFTIJD_MS); }
  // Ook als hij "meedoen" meldt: Veronica stuurt hem niets. Alleen de rij op de beheerder-telefoon zelf mag hem inzetten, en dan
  // pas als er geen werker vrij is (rij.js, zetBeheerder).
  function dagelijksNu(t) { const g = (meet(t.adres).status || {}).dagelijks; return !!(g && g.waarde && nu() - g.t <= K.MAX_LEEFTIJD_MS); }
  // 496: de zandbak (veilig browsen) krijgt ook nooit werk: in de lijst van deze computer, of zelf gemeld.
  function zandbakNu(t) { const g = (meet(t.adres).status || {}).zandbak; return Zandbak.lijst().includes(t.adres) || !!(g && g.waarde === true); }
  function gespaardNu(t) { return schuifNu(t) || dagelijksNu(t) || zandbakNu(t); }
  const uitgeslotenDoorKeuze = (soort) => Takenverdeling.uitgeslotenVoor(S.telefoons, leesTakenKeuzes(), soort)
    .concat(S.telefoons.filter((t) => gespaardNu(t)).map((t) => t.adres));
  let takenHandtekening = '';
  function tekenTakenverdeling(forceer) {
    const vak = $('takenVerdeling');
    if (!vak || ($('scherm-wachtrij').hidden && !forceer)) return;
    const keuzes = leesTakenKeuzes();
    const r = Takenverdeling.verdeel(takenTelefoons(), keuzes);
    const hand = JSON.stringify([r, S.nalees && Array.isArray(S.nalees.lijst) ? S.nalees.lijst.map((x) => [x.taakId, x.telefoon, x.duurMs]) : null]);   // 515: ook de proef
    if (hand === takenHandtekening && !forceer) return;
    takenHandtekening = hand;
    const delen = [];
    if (!r.telefoons.length) delen.push(el('p', 'eerlijk', 'Nog geen telefoons gekoppeld.'));
    for (const t of r.telefoons) {
      const kaart = el('section', 'tegel taakTegel');
      kaart.appendChild(el('h2', '', `${t.naam}${t.rol === 'baas' ? ' · 🛠 Beheerder' : t.rol === 'werker' ? ' · Werker' : ''}${t.klasse ? ` · ${t.klasse === 'te-oud' ? 'te oud voor model' : t.klasse}` : ''}`));
      if (t.taak) kaart.appendChild(el('div', `taakRol rol-${t.taak.rol}`, `Rol: ${t.taak.naam}`));   // 481
      for (const regel of t.regels) {
        const rij = el('div', `taakRegel ${regel.mag ? 'mag' : 'magNiet'}`);
        if (!regel.vast || Takenverdeling.KIESBAAR.includes(regel.soort)) {
          const lab = el('label', 'taakSchakel');
          const box = document.createElement('input'); box.type = 'checkbox';
          box.checked = Takenverdeling.magVan(keuzes, t.adres, regel.soort);
          box.dataset.adres = t.adres; box.dataset.soort = regel.soort;
          lab.appendChild(box); lab.appendChild(el('span', '', regel.naam));
          rij.appendChild(lab);
        } else rij.appendChild(el('span', 'taakNaam', regel.naam));
        rij.appendChild(el('span', 'taakUitleg', `${regel.mag ? 'ja' : 'nee'} · ${regel.reden}`));
        kaart.appendChild(rij);
      }
      delen.push(kaart);
    }
    // 515: WIE DEED WAT. De proefverhalen (concepten in de postbus) per telefoon, met de tijd per verhaal als de telefoon die meldt,
    // en het tempo van zijn eigen motor. Alleen wat er staat; geen concept = nog niets gedaan.
    {
      const tempo = {};
      for (const t of S.telefoons) {
        const mo = (meet(t.adres).status || {}).motor;
        if (mo && mo.waarde && nu() - mo.t <= K.MAX_LEEFTIJD_MS && mo.waarde.tokensPerSeconde > 0) tempo[t.naam] = mo.waarde.tokensPerSeconde;
      }
      const proef = K.proefPerTelefoon(S.nalees, tempo);
      const blok = el('section', 'tegel taakTegel');
      blok.dataset.proef = '1';
      blok.appendChild(el('h2', '', 'Wie deed wat (de verhalen van de gids)'));
      if (!proef.length) blok.appendChild(el('p', 'eerlijk', 'Nog geen verhaal klaar. Een telefoon begint vanzelf zodra zijn eigen motor een model heeft en hij aan de lader ligt.'));
      for (const p of proef) blok.appendChild(el('div', 'taakRegel mag', p.zin));
      delen.push(blok);
    }
    const sam = el('div', 'taakSamen');
    for (const z of r.samenvatting) sam.appendChild(el('div', '', z));
    delen.push(sam);
    for (const w of r.waarschuwingen) delen.push(el('p', 'eerlijk waarschuwing', w));
    vak.replaceChildren(...delen);
  }
  document.addEventListener('change', (e) => {
    const b = e.target;
    if (!b || !b.dataset || !b.dataset.soort || !b.dataset.adres || !Takenverdeling.KIESBAAR.includes(b.dataset.soort)) return;
    const k = leesTakenKeuzes();
    k[b.dataset.adres] = Object.assign({}, k[b.dataset.adres]);
    if (b.checked) delete k[b.dataset.adres][b.dataset.soort]; else k[b.dataset.adres][b.dataset.soort] = false;
    bewaarTakenKeuzes(k);
    logRegel(`${(S.telefoons.find((t) => t.adres === b.dataset.adres) || {}).naam || b.dataset.adres}: ${b.dataset.soort === 'claude' ? 'Claude-klussen' : 'vragen van Veronica'} ${b.checked ? 'weer aan' : 'uitgezet'}.`);
    tekenTakenverdeling(true);
  });

  // ZON EN STROOM: wat de hoofdtelefoon meldt, met bron en leeftijd. Nooit zelf gerekend.
  const kwhZin = (x) => `${String(Math.round(x * 100) / 100).replace('.', ',')} kWh`;
  function tekenZonStroom(tijd) {
    const vak = $('zonStroom');
    const zs = S.zonStroom;
    if (!zs) { morphKinderen(vak, [el('p', 'eerlijk', 'Zon en stroom: onbekend. Dat komt van de hoofdtelefoon (koppelen met de code).')]); return; }
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
    metScroll(() => morphKinderen(vak, delen));
  }

  // ---- ZELF BIJWERKEN: altijd de nieuwste Veronica ----
  // De service worker kijkt bij elke start, elk half uur en als je terugkomt naar het scherm of er
  // een nieuwe versie op GitHub Pages staat. Is die er, dan neemt hij het meteen over; de pagina
  // herlaadt ZODRA er niets loopt (de wachtrij staat in IndexedDB en blijft gewoon staan).
  const Bijwerk = { wacht: false, nieuw: false };
  function herlaadAlsRustig() {
    if (S.stromen.size === 0) { location.reload(); return; }
    Bijwerk.wacht = true;
    logRegel('Er staat een nieuwe Veronica klaar. Ik herlaad zodra het lopende werk klaar is.');
  }
  function zelfBijwerken() {
    if (!navigator.serviceWorker) return;   // geen service worker (gewone http-pagina): dan ook geen bijwerken
    let eerder = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      const kijk = () => { try { reg.update(); } catch (e) { /* offline: later */ } };
      // Een nieuwe versie neemt pas over als de oude even NIETS doet. Het zoeken naar een telefoon (honderden
      // verzoeken) houdt hem anders eindeloos bezig: dan pauzeert het zoeken (zoekRonde) tot de herlaadbeurt.
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!navigator.serviceWorker.controller || !w) return;
        Bijwerk.nieuw = true;
        w.addEventListener('statechange', () => { if (w.state === 'redundant') Bijwerk.nieuw = false; });   // mislukt: gewoon verder zoeken
      });
      setInterval(kijk, 30 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kijk(); });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // De eerste keer (nog geen versie) is geen update.
      if (!eerder) { eerder = true; return; }
      herlaadAlsRustig();
    });
    setInterval(() => { if (Bijwerk.wacht && S.stromen.size === 0) location.reload(); }, 5000);
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

  // ---- De rekenpool: wat de verkeersagent (pool.js) per telefoon moet weten ----
  const modelNaamVan = (m) => (m.health && m.health.model && nu() - m.health.model.t <= K.MAX_LEEFTIJD_MS ? m.health.model.waarde : null);
  function poolStaat(t) {
    const s = staat(t.adres);
    const m = meet(t.adres);
    const vers = (x) => x && nu() - x.t <= K.MAX_LEEFTIJD_MS;
    const modelNaam = modelNaamVan(m);
    const st = m.status || {};
    const rustPer = (S.zonStroom && S.zonStroom.rustPer) || {};
    const tps = S.snelheid[t.adres] || (m.health && m.health.tps && vers(m.health.tps) && m.health.tps.waarde > 0 ? m.health.tps.waarde : undefined);
    const cap = st.capaciteit && vers(st.capaciteit) && st.capaciteit.waarde ? st.capaciteit.waarde : {};
    const c = Pool.capaciteit({ ramGb: cap.ramGb, sdk: cap.sdk, arm64: cap.arm64, vrijGb: cap.vrijGb, tps, modelGeladen: modelNaam ? true : undefined, model: modelNaam });
    return {
      bereikbaar: s.bereikbaar, bezig: s.bezig, vervangen: s.vervangen, uitTot: s.uitTot, hitteStand: s.hitteStand, laatstGebruikt: s.laatstGebruikt,
      rust: rustPer[t.naam] ? true : undefined,
      // 481: een gespaarde telefoon (de schuif op de telefoon) telt als "mag niet rekenen": de pool geeft hem niets.
      magRekenen: (st.magRekenen && vers(st.magRekenen) && st.magRekenen.waarde === false) || gespaardNu(t) ? false : undefined,
      modelGeladen: m.health && m.health.model && vers(m.health.model) ? !!modelNaam : undefined,
      klasse: c.klasse, klasseReden: c.reden, aanbevolenModel: c.model, model: modelNaam,
      tps,
      laadt: st.laadt && vers(st.laadt) ? st.laadt.waarde : undefined,
      inGebruik: st.inGebruik && vers(st.inGebruik) ? st.inGebruik.waarde : undefined,
      kernMeerekenen: st.kernMeerekenen && vers(st.kernMeerekenen) ? st.kernMeerekenen.waarde === true : undefined,
    };
  }
  const poolStaten = () => { const u = {}; for (const t of S.telefoons) u[t.adres] = poolStaat(t); return u; };
  const pantserStand = () => Pool.pantserRegel(S.telefoons, poolStaten(), S.aan);

  // Een korte snelheidstest per telefoon (een klein verzoek van ~24 tokens): zo weet de verdeler de klasse en de tijdslimiet.
  // Alleen als de telefoon vrij en bereikbaar is, hoogstens eens per tien minuten, en nooit tegelijk met werk.
  async function meetSnelheid(t) {
    const s = staat(t.adres);
    if (s.bezig || !s.bereikbaar || s.vervangen || nu() - (S.snelheidProef[t.adres] || 0) < 10 * 60 * 1000) return;
    if (poolStaat(t).klasse === 'te-oud') return;                // te oud voor een model: ook geen speedtest
    S.snelheidProef[t.adres] = nu();
    s.bezig = true;
    const ctrl = new AbortController();
    const klok = setTimeout(() => ctrl.abort(), 20000);
    const t0 = nu();
    let stukjes = 0;
    try {
      const model = modelNaamVan(meet(t.adres));
      const r = await fetch(`${t.adres}/v1/chat/completions`, Object.assign({
        method: 'POST', signal: ctrl.signal, headers: Object.assign({ 'Content-Type': 'application/json' }, kop(t)),
        body: JSON.stringify({ model: model || undefined, stream: true, max_tokens: 24, temperature: 0, messages: [{ role: 'user', content: 'Tel van een tot twintig, met komma\'s ertussen.' }] }),
      }, K.lnaOpties(t.adres)));
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const lezer = K.maakSseLezer();
      const rd = r.body.getReader();
      const dec = new TextDecoder();
      let eerste = null;
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        const n = lezer.voeg(dec.decode(value, { stream: true })).length;
        if (n && eerste === null) eerste = nu();
        stukjes += n;
      }
      // De eerste stukjes tellen niet mee: het model "wordt wakker". Gemeten vanaf het eerste stukje.
      if (stukjes > 3 && eerste !== null && nu() > eerste) S.snelheid[t.adres] = Pool.bijwerkSnelheid(S.snelheid[t.adres], stukjes - 1, nu() - eerste);
    } catch (e) { /* geen meting: de klasse blijft op RAM en model staan */ } finally {
      clearTimeout(klok);
      s.bezig = false;
      tekenLive();
      werkTik();
    }
  }
  function snelheidTik() { if (S.aan) for (const t of S.telefoons) meetSnelheid(t); }


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
      const staten = poolStaten();
      const wachtend = Pool.wachtrijVolgorde(S.taken);
      if (!wachtend.length) return;
      // De eerste klus waar een telefoon voor vrij is. Een zware klus die nog wacht houdt de lichte klussen daarachter niet op.
      let gedaan = false;
      for (const taak of wachtend) {
        // 469: telefoons die de eigenaar voor deze soort heeft uitgezet (alleen uitsluiten; pool.js beslist de rest).
        for (const a of uitgeslotenDoorKeuze(taak.claude ? 'claude' : 'veronica')) if (!(taak.uitgesloten = taak.uitgesloten || []).includes(a)) taak.uitgesloten.push(a);
        const t = Pool.kiesTelefoon(S.telefoons, staten, taak, nu());
        if (t) { draai(taak, t); gedaan = true; break; }
      }
      if (gedaan) continue;
      // Niemand vrij voor de belangrijkste klus: mag een LAGERE voorrang worden afgebroken? Die klus gaat dan opnieuw de wachtrij in.
      const lopend = [...S.stromen.entries()].map(([adres, st]) => ({ adres, voorrang: Pool.rangVan(S.taken.find((x) => x.id === st.taakId)), sinds: st.sinds || 0 }));
      const weg = Pool.verdring(wachtend[0], lopend, S.telefoons, staten, nu());
      if (weg) { const st = S.stromen.get(weg); st.reden = 'verdrongen'; st.ctrl.abort(); }
      return;
    }
  }
  async function draai(taak, t) {
    const s = staat(t.adres);
    s.bezig = true;
    s.laatstGebruikt = nu();
    taak.status = 'bezig';
    taak.telefoon = t.naam;
    if (!taak.claude) Opslag.taak(taak);            // Claude-klussen staan NIET in de opslag van deze browser
    const ctrl = new AbortController();
    const stroom = { ctrl, taakId: taak.id, reden: null, sinds: nu() };
    S.stromen.set(t.adres, stroom);
    if (!taak.claude) S.live[t.adres] = '';
    tekenLive();
    const m = meet(t.adres);
    const model = m.health && m.health.model ? m.health.model.waarde : undefined;
    const t0 = nu();
    let stukjes = 0;
    // Te langzaam? Dan gaat de klus naar de volgende telefoon (zie de tijdslimiet in pool.js).
    const limiet = Pool.tijdslimiet(taak.max_tokens || 600, S.snelheid[t.adres]);
    const klok = taak.claude ? setTimeout(() => { stroom.reden = 'traag'; ctrl.abort(); }, limiet) : null;
    try {
      const r = await fetch(`${t.adres}/v1/chat/completions`, Object.assign({
        method: 'POST', signal: ctrl.signal,
        headers: Object.assign({ 'Content-Type': 'application/json' }, kop(t)),
        body: JSON.stringify({ model, stream: true, max_tokens: taak.max_tokens || 600, messages: [{ role: 'user', content: taak.tekst }] }),
      }, K.lnaOpties(t.adres)));
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const lezer = K.maakSseLezer();
      const rd = r.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        const n = lezer.voeg(dec.decode(value, { stream: true })).length;
        stukjes += n;
        // De tekst die binnenkomt is van Veronica's eigen werk; die van Claude-klussen laat ze NIET op het scherm zien.
        if (n && !taak.claude) { S.live[t.adres] = K.zonderDenken(lezer.tekst()); tekenLive(); }
      }
      const ms = nu() - t0;
      taak.status = 'klaar';
      taak.uitkomst = K.zonderDenken(lezer.tekst());
      taak.klaar = nu();
      if (stukjes > 2) S.snelheid[t.adres] = Pool.bijwerkSnelheid(S.snelheid[t.adres], stukjes, ms);
      S.klusMs[t.adres] = ms;
      S.tellers.klussen += 1; S.tellers.gelukt += 1; S.tellers.tokens += stukjes; S.tellers.ms += ms;
      if (taak.claude) {
        S.tellers.soort[taak.soort] = (S.tellers.soort[taak.soort] || 0) + 1;
        const b = S.beloften.get(taak.id);
        if (b) { S.beloften.delete(taak.id); b.resolve(Pool.maakResultaat(taak, t.naam, taak.uitkomst, ms, stukjes, nu())); }
        taak.tekst = ''; taak.uitkomst = '';                                    // niets van Claude's inhoud blijft liggen
        logRegel(`Claude-klus (${taak.soort}) klaar op ${t.naam}: ${Math.round(ms / 100) / 10} s`);   // GEEN inhoud in het logboek
      } else logRegel(`${t.naam} is klaar: ${taak.tekst.slice(0, 40)}`);
    } catch (fout) {
      if (taak.status === 'fout') return;        // een Claude-klus die al is afgehandeld (deadline, stop, noodstop): niets terugzetten
      // Uitgevallen, vervangen, verdrongen, te traag of noodstop: het stukje gaat terug in de wachtrij.
      taak.status = 'wacht';
      taak.telefoon = null;
      if (stroom.reden === 'noodstop') { /* blijft wachten tot het pantser weer aan gaat */ }
      else if (stroom.reden === 'vervangen') logRegel(`Onderdeel vervangen: ${t.naam}. Het werk gaat naar een ander.`);
      else if (stroom.reden === 'verdrongen') { S.tellers.verdrongen += 1; logRegel(`${t.naam}: een klus met lagere voorrang is opnieuw in de wachtrij gezet voor een met hogere voorrang.`); }
      else if (stroom.reden === 'traag') {
        (taak.uitgesloten = taak.uitgesloten || []).push(t.adres);
        taak.pogingen += 1;
        logRegel(`${t.naam} was te langzaam voor deze klus. Hij gaat naar een andere telefoon.`);
        if (!S.telefoons.some((x) => !taak.uitgesloten.includes(x.adres))) afgebroken(taak, 'tijd', 'Alle telefoons waren te langzaam voor deze klus.');
      } else {
        taak.pogingen += 1;
        s.uitTot = nu() + 30000;
        logRegel(`${t.naam} viel uit (${(fout && fout.message) || 'geen antwoord'}). Het werk gaat naar een ander.`);
        if (taak.pogingen >= 3) { afgebroken(taak, 'mislukt', 'Drie keer mislukt.'); }
      }
      if (taak.status === 'wacht' && taak.pogingen >= 3) afgebroken(taak, 'mislukt', 'Drie keer mislukt.');
    } finally {
      if (klok) clearTimeout(klok);
      s.bezig = false;
      S.stromen.delete(t.adres);
      if (!taak.claude) S.live[t.adres] = '';
      if (!taak.claude) await Opslag.taak(taak);
      tekenLive();
      werkTik();
    }
  }
  // Een klus die niet meer verder kan: de gebruiker (of Claude) krijgt een eerlijke uitslag.
  function afgebroken(taak, fout, reden) {
    taak.status = 'fout';
    taak.uitkomst = reden;
    if (taak.claude) {
      S.tellers.mislukt += 1;
      const b = S.beloften.get(taak.id);
      if (b) { S.beloften.delete(taak.id); b.reject({ fout, reden, let_op: Pool.LET_OP }); }
      taak.tekst = '';
    }
  }
  function tekenWachtrij() {
    const lijst = $('takenLijst');
    S.taken = S.taken.filter((x) => !(x.claude && (x.status === 'klaar' || x.status === 'fout')));       // Claude-klussen blijven niet staan
    morphKinderen(lijst, S.taken.slice().reverse().slice(0, 50).map((x) => {
      const d = el('div', `taak ${x.status}`);
      d.dataset.id = x.id;
      d.appendChild(el('div', 'taakKop', `${x.status === 'klaar' ? '✓' : x.status === 'bezig' ? '…' : x.status === 'fout' ? '✗' : '·'} ${x.claude ? `Claude-klus (${x.soort})` : x.tekst.slice(0, 80)}${x.telefoon ? ` (${x.telefoon})` : ''}`));
      if (x.uitkomst && !x.claude) d.appendChild(el('div', 'taakUit', x.uitkomst));
      return d;
    }));
  }


  // ---- De REKENBRUG: Claude (Cowork in Chrome, of een script in de Veronica-tab) stuurt kleine klussen naar de telefoons ----
  //
  // window.rekenbrug.taak({ soort, tekst, max_tokens, opties }) -> belofte met { id, soort, telefoon, tekst, ms, tokens, tokens_per_s, let_op }.
  // Alleen de vaste klussoorten (pool.js). Het antwoord is DATA van een klein model: het veld let_op zegt dat. Privé-kamer-klussen gaan hier NOOIT
  // doorheen (de kamer staat in JARVIS en kent deze brug niet). Voorrang 2: de eigen vragen van de eigenaar en de privé-kamer gaan voor.
  function brugTaak(inv) {
    if (volLokaal()) return Promise.reject({ fout: 'vol-lokaal', reden: 'Vol lokaal staat aan in Veronica: geen klussen van of voor Claude.', let_op: Pool.LET_OP });
    if (!S.bureau) return Promise.reject({ fout: 'bureau-uit', reden: 'Het Claude-bureau staat uit in Veronica.', let_op: Pool.LET_OP });
    if (!S.aan) return Promise.reject({ fout: 'pantser-uit', reden: 'Pantser staat uit. Zet in Veronica Pantser aan.', let_op: Pool.LET_OP });
    const v = Pool.valideer(inv);
    if (!v.ok) return Promise.reject({ fout: 'ongeldig', reden: v.reden, let_op: Pool.LET_OP });
    if (!S.rem.mag(v.soort)) return Promise.reject({ fout: 'rem', reden: `Te veel klussen van de soort ${v.soort} dit uur (hoogstens ${Pool.SOORTEN[v.soort].limiet}).`, let_op: Pool.LET_OP });
    S.rem.tel(v.soort);
    const id = nieuwId();
    const taak = {
      id, claude: true, soort: v.soort, tekst: Pool.maakPrompt(v.soort, v.tekst, v.opties), max_tokens: v.max_tokens, gewicht: v.gewicht, maat: undefined,
      voorrang: Pool.VOORRANG.claude, status: 'wacht', pogingen: 0, sinds: nu(), telefoon: null, uitkomst: null, uitgesloten: [],
    };
    return new Promise((resolve, reject) => {
      S.beloften.set(id, { resolve, reject });
      S.taken.push(taak);
      // Een eigen deadline: een klus die zo lang niets oplevert krijgt een eerlijke tijdsuitslag (nooit eeuwig wachten).
      const wacht = Math.min(Number(inv && inv.wacht_s) > 0 ? Number(inv.wacht_s) * 1000 : 180000, 600000);
      setTimeout(() => {
        if (S.beloften.has(id) && (taak.status === 'wacht' || taak.status === 'bezig')) {
          const st = [...S.stromen.entries()].find(([, x]) => x.taakId === id);
          if (st) { st[1].reden = 'tijd'; st[1].ctrl.abort(); }
          afgebroken(taak, 'tijd', 'De klus duurde te lang.');
          tekenWachtrij();
        }
      }, wacht);
      tekenWachtrij();
      werkTik();
    });
  }
  function brugStatus() {
    const ps = pantserStand();
    const staten = poolStaten();
    return {
      versie: 1, bureau: S.bureau, pantser: S.aan, regel: ps.regel, klaar: ps.klaar, totaal: ps.totaal, klussenTegelijk: ps.tegelijk,
      telefoons: S.telefoons.map((t) => ({ naam: t.naam, klasse: staten[t.adres].klasse, model: staten[t.adres].model || null, tokens_per_s: staten[t.adres].tps || null, bezig: !!staten[t.adres].bezig, klaar: Pool.pantserRegel([t], staten, true).klaar === 1, laatste_klus_ms: S.klusMs[t.adres] || null })),
      wachtrij: S.taken.filter((x) => x.claude && x.status === 'wacht').length,
      bezig: S.taken.filter((x) => x.claude && x.status === 'bezig').length,
      tellers: JSON.parse(JSON.stringify(S.tellers)),
      soorten: Object.keys(Pool.SOORTEN),
      let_op: Pool.LET_OP,
    };
  }
  function brugStop() {
    let n = 0;
    for (const x of S.taken) if (x.claude && (x.status === 'wacht' || x.status === 'bezig')) { afgebroken(x, 'gestopt', 'Gestopt via rekenbrug.stop().'); n += 1; }
    for (const st of S.stromen.values()) { const x = S.taken.find((k) => k.id === st.taakId); if (x && x.claude) { st.reden = 'gestopt'; st.ctrl.abort(); } }
    tekenWachtrij();
    return n;
  }
  function zetBureau(aan) {
    S.bureau = !!aan;
    Opslag.schrijf('bureau', S.bureau).catch(() => {});
    if (!S.bureau) brugStop();
    logRegel(S.bureau ? 'Claude-bureau aan.' : 'Claude-bureau uit: klussen van Claude worden geweigerd.');
    tekenLive();
  }
  window.rekenbrug = Object.freeze({ taak: brugTaak, status: brugStatus, stop: brugStop, versie: 1 });

  // ---- Pantser, Vervang onderdeel, NOODSTOP ----
  // 456: de ene knop. De baas (JARVIS) opent of sluit zijn rekenpool (het OpenAI-adres); dit hoeft niet te lukken om hier te werken.
  async function pantserNaarBaas(aan) {
    if (!S.code || !kernNu()) return;
    try { await haal(`${kernNu()}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'pantser', aan: !!aan, van: 'veronica' }) }, 3000); } catch (e) { /* de baas is er niet: Veronica rekent zelf door */ }
  }
  function zetPantser(aan) {
    S.aan = !!aan;
    pantserNaarBaas(S.aan);
    $('pantserKnop').textContent = S.aan ? 'Pantser aan' : 'Pantser uit';
    $('pantserKnop').setAttribute('aria-pressed', String(S.aan));
    logRegel(S.aan ? 'Pantser aan: de telefoons worden opgeroepen en de wachtrij loopt.' : 'Pantser uit: geen nieuwe klussen; de telefoons rusten.');
    if (S.aan) {
      // Een knop: de baas roept alle telefoons op (ze melden zich zelf aan), dan meten we en testen we de snelheid.
      roepOp(true).then(() => meetRonde()).then(() => snelheidTik()).catch(() => {});
    } else {
      // Wat nog wacht op een telefoon krijgt een eerlijke uitslag; wat al loopt maakt zijn klus af, daarna rust de telefoon.
      for (const x of S.taken) if (x.claude && x.status === 'wacht') afgebroken(x, 'pantser-uit', 'Pantser staat uit.');
    }
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
    NulS.stop = true;                              // 462: ook een lopende nulmeting stopt
    $('pantserKnop').textContent = 'Pantser uit';
    $('pantserKnop').setAttribute('aria-pressed', 'false');
    for (const st of S.stromen.values()) { st.reden = 'noodstop'; st.ctrl.abort(); }
    for (const x of S.taken) if (x.claude && (x.status === 'wacht' || x.status === 'bezig')) afgebroken(x, 'noodstop', 'NOODSTOP in Veronica.');
    pantserNaarBaas(false);                       // ook de rekenpool van de baas dicht
    logRegel(K.veronicaZin(S.karakter, 'noodstop'));
    spreek(K.veronicaZin(S.karakter, 'noodstop'), 'noodstop');
    waarschuw('noodstop', K.veronicaZin('hulpdienst', 'noodstop'), true);
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

  // 452b: de stekkers van de baas overnemen, ELKE keer dat Veronica de lijst leest (niet alleen bij het koppelen):
  // een stekker die later wordt toegevoegd of gevonden moet vanzelf verschijnen. true = er veranderde iets.
  async function neemStekkersOver(l) {
    const nieuw = l.stekkers || [];
    const gevonden = l.stekkersGevonden || [];
    // 463b: een nieuwe zoekronde van de baas komt als logregel in Veronica (wat er gescand is).
    const sc = l.stekkerScan || null;
    if (sc && (!S.stekkerScan || sc.leeftijdMs < S.stekkerScan.leeftijdMs)) logRegel(K.scanZin(sc));
    S.stekkerScan = sc || S.stekkerScan;
    const veranderd = JSON.stringify(nieuw) !== JSON.stringify(S.stekkers) || JSON.stringify(gevonden) !== JSON.stringify(S.stekkersGevonden);
    if (!veranderd) return false;
    S.stekkers = nieuw;
    S.stekkersGevonden = gevonden;
    await Opslag.schrijf('stekkers', S.stekkers);
    return true;
  }
  // 452b: "Dit is de ventilator" / "Dit is de lader". Veronica stuurt alleen de keuze (mac + rol, met de code); de baas
  // zoekt de stekker in wat hij zelf vond en vertrouwt hem. Een onbekende mac doet niets.
  // 463b: "Zoek nu", "Stekker toevoegen op adres" en de rol van een bestaande stekker. Alles gaat via de baas (met de code).
  async function stekkerRoep(lijf, goed, fout) {
    if (!S.code) { logRegel('Dit kan pas na het koppelen met de hoofdtelefoon.'); return false; }
    try {
      const a = await haal(`${kernNu()}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify(Object.assign({ van: 'veronica' }, lijf)) }, 5000);
      if (!a.ok) throw new Error(String(a.status));
      logRegel(goed);
      return true;
    } catch (e) { logRegel(fout); return false; }
  }
  const zoekStekkersNu = () => stekkerRoep({ soort: 'stekker-zoek' }, 'Zoek nu doorgegeven aan de baas. Binnen een minuut staat hier wat hij vond.', 'Het zoeken kon niet naar de baas (geen antwoord). Probeer het zo nog eens.');
  async function voegStekkerOpAdresToe(ip, rol) {
    const schoon = String(ip || '').trim();
    const m = /^(\d{1,3}(?:\.\d{1,3}){3})$/.exec(schoon);
    if (!m || !K.isEigenNet(m[1])) { logRegel('Dat adres hoort niet bij je eigen wifi. Kijk het adres na in je router of in de Tasmota-pagina.'); return; }
    if (!['laden', 'meter', 'ventilator'].includes(rol)) return;
    await stekkerRoep({ soort: 'stekker-adres', ip: m[1], rol }, `Stekker op ${m[1]} doorgegeven aan de baas als ${rol === 'laden' ? 'lader' : rol === 'meter' ? 'meter' : 'ventilator'}. Hij kijkt of het Tasmota is en voegt hem toe.`, `Het adres ${m[1]} kon niet naar de baas (geen antwoord). Probeer het zo nog eens.`);
  }
  const kiesStekkerNieuweRol = (naam, rol) => stekkerRoep({ soort: 'stekker-rol', naam, rol }, `${naam}: nieuwe rol (${rol === 'laden' ? 'lader' : rol === 'meter' ? 'meter' : 'ventilator'}) doorgegeven aan de baas.`, `${naam}: de nieuwe rol kon niet naar de baas. Probeer het zo nog eens.`);
  async function kiesStekkerRol(mac, rol) {
    if (!S.code || !['ventilator', 'laden', 'meter'].includes(rol) || !/^[0-9A-F:]{12,17}$/.test(mac)) return;
    const g = S.stekkersGevonden.find((x) => x.mac === mac);
    try {
      const a = await haal(`${kernNu()}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'stekker-kies', mac, rol, van: 'veronica' }) }, 4000);
      if (!a.ok) throw new Error(String(a.status));
      S.stekkersGevonden = S.stekkersGevonden.filter((x) => x.mac !== mac);
      logRegel(`${g ? g.naam : 'Stekker'}: doorgegeven aan de baas als ${rol === 'laden' ? 'lader' : rol === 'meter' ? 'meter' : 'ventilator'}. Binnen een minuut staat hij bij de stekkers.`);
    } catch (e) {
      logRegel('De keuze kon niet naar de baas (geen antwoord). Probeer het zo nog eens.');
    }
    tekenLive();
  }

  // ---- Koppelen: de vertrouwde lijst EEN keer overnemen van de hoofdtelefoon ----
  async function bewaarLijst(l) {
    if (l.kern) l.telefoons = K.herstelKernAdres(l.telefoons, l.kern);   // 450: het adres dat antwoordde
    S.telefoons = l.telefoons;
    await neemStekkersOver(l);
    if (l.kern) S.kern = l.kern;
    if (l.code) S.code = l.code;
    S.bekend = K.voegBekendToe(S.bekend, [l.kern].concat(l.alt || [], l.bekend || [], l.telefoons.map((t) => t.jarvis)));
    await Opslag.schrijf('bekend', S.bekend);
    if (l.ntfy) { S.ntfy = l.ntfy; await Opslag.schrijf('ntfy', S.ntfy); tekenNtfy(); ledenStroom(); }
    if (l.nieuweTelefoon) { S.download = l.nieuweTelefoon; await Opslag.schrijf('download', S.download); }
    neemPostbusVers(l.postbusAdres);   // 487: alleen in het geheugen
    await neemUpdateSleutelOver(l.updateSleutel, l.updateRepo);
    if (l.eigenaar && !S.eigenaarZelf) { S.eigenaar = l.eigenaar; await Opslag.schrijf('eigenaar', S.eigenaar); }
    await Opslag.schrijf('telefoons', S.telefoons);
    await Opslag.schrijf('kern', S.kern);
    await Opslag.schrijf('code', S.code);
    tekenKoppelStand();
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
    const t0 = nu();
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
      zegKoppel(await waaromGeenAntwoord(kern, t0, 4000), true);
    }
  }
  async function koppelMetQrTekst(tekst) {
    let l = K.leesQr(tekst);
    if (l && l.token) l = await koppelMetToken(l);
    if (!l || !l.telefoons.length) { if (!$('koppelMelding').textContent || /Even/.test($('koppelMelding').textContent)) $('koppelMelding').textContent = 'Dat is geen QR van JARVIS voor Veronica.'; return false; }
    await bewaarLijst(l);
    zegKoppel(`Klaar: ${l.telefoons.length} ${l.telefoons.length === 1 ? 'telefoon' : 'telefoons'}.`, false);
    toonScherm('live');
    return true;
  }
  // Het eenmalige token uit de QR terugsturen; dan komen de code en de lijst EEN keer mee.
  async function koppelMetToken(q) {
    const vak = $('koppelMelding');
    vak.textContent = 'Even…';
    // Eerst het adres uit de QR, dan de andere adressen erin (hetzelfde toestel op het andere netwerk).
    for (const adres of [q.kern].concat(q.alt || [])) {
      const t0 = nu();
      try {
        const r = await haal(`${adres}/jarvis/koppel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: q.token, ik: { soort: 'veronica' } }) }, 5000);
        if (r.status === 403 || r.status === 429) { zegKoppel('Deze QR is verlopen of al gebruikt. Tik in JARVIS op "Nieuwe koppelcode voor Veronica" en scan opnieuw.', true); return null; }
        if (!r.ok) { vak.textContent = `De hoofdtelefoon gaf ${r.status}.`; return null; }
        const l = K.leesPakket(await r.json());
        if (!l) { vak.textContent = 'Het antwoord klopt niet.'; return null; }
        l.kern = adres;
        l.alt = (q.alt || []).concat(q.kern);
        return l;
      } catch (e) { if (adres === q.kern) q.eersteDuur = nu() - t0; /* dit adres niet: het volgende */ }
    }
    zegKoppel(await waaromGeenAntwoord(q.kern, nu() - (q.eersteDuur || 0), 5000), true);
    return null;
  }
  // ---- 1.9.14: VERONICA TOONT ZELF DE QR (12 oktober: "Veronica moet een QR code laten zien") ----
  // Niet gekoppeld: meteen een grote QR met een EENMALIGE sleutel (vijf minuten, een keer). JARVIS scant hem en
  // vertrouwt de sleutel op zijn eigen server. Veronica zoekt de telefoon dan zelf: haar eigen adres (een
  // WebRTC-kandidaat) en de adressen in hetzelfde net op poort 8080, een paar tegelijk. Ze stuurt NOOIT de sleutel,
  // alleen een bewijs (HMAC), en het antwoord komt versleuteld terug. Lukt het eigen adres niet: een veld voor het
  // adres van de telefoon. De code staat nooit in de QR.
  const VQ = { sleutel: null, vorige: null, tot: 0, klok: null, zoekt: false, eigen: undefined, extra: [], zoekKlok: null, briefSinds: 0, briefLaatst: 0, briefBezig: false, briefGezien: new Set(), briefEerst: 0, briefFouten: 0, briefStand: null, stroom: null, zelfZoeken: false,
    // 449: wat Veronica ziet, voor het blok "Wat zie ik" (een schermfoto zegt dan alles).
    diag: { kandidaten: [], eigenBron: null, briefLaatst: 0, poging: null, gescand: 0 } };
  // 1.9.17: ALLE kandidaten verzamelen (niet de eerste), en alleen echte thuisnetten houden: op een Chromebook is
  // de eerste vaak 100.115.92.x, het interne net van ChromeOS (de eerste echte proef, 13 oktober).
  // 449 (het echte huis, 13 oktober): de kandidaten komen niet altijd allemaal in een ronde (de ene keer wel
  // 192.168.68.x, de andere keer niet). Nu tot drie rondes, ALLE kandidaten samen, en het laatst gevonden thuisnet
  // ONTHOUDEN voor als het een keer niet lukt.
  const EIGEN_SLEUTEL = 'veronica.eigenNet';
  function iceRonde(ms) {
    return new Promise((klaar) => {
      let pc = null, klaarGemeld = false;
      const regels = [];
      const eind = () => { if (klaarGemeld) return; klaarGemeld = true; try { if (pc) pc.close(); } catch (e) { /* al dicht */ } klaar(regels); };
      const wacht = setTimeout(eind, ms);
      try {
        pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('veronica');
        pc.onicecandidate = (e) => { if (e && e.candidate) regels.push(e.candidate.candidate); else { clearTimeout(wacht); eind(); } };
        pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => { clearTimeout(wacht); eind(); });
      } catch (e) { clearTimeout(wacht); eind(); }
    });
  }
  async function eigenAdressen() {
    const regels = [];
    for (let ronde = 0; ronde < 3; ronde++) {
      regels.push(...await iceRonde(3500));
      if (K.thuisAdressenUitKandidaten(regels).length) break;
    }
    VQ.diag.kandidaten = Array.from(new Set(regels.map((r) => (/ ([0-9a-f.:]+|[0-9a-z-]+\.local) \d+ typ/i.exec(r) || [])[1]).filter(Boolean)));
    let uit = K.thuisAdressenUitKandidaten(regels);
    VQ.diag.eigenBron = uit.length ? 'gevonden' : null;
    if (uit.length) {
      try { localStorage.setItem(EIGEN_SLEUTEL, JSON.stringify({ t: Date.now(), adressen: uit })); } catch (e) { /* alleen voor nu */ }
    } else {
      try {
        const o = JSON.parse(localStorage.getItem(EIGEN_SLEUTEL) || 'null');
        if (o && Array.isArray(o.adressen)) { uit = o.adressen.filter((a) => K.isThuisNet(String(a))); if (uit.length) VQ.diag.eigenBron = 'onthouden'; }
      } catch (e) { /* niets onthouden */ }
    }
    return uit;
  }
  // 476: de baas is weg (ander wifi): de QR van Veronica zelf in de kaart, met de reden erbij, en zelf zoeken.
  function herstelQr(reden, waar) {
    VQ.herstel = true;
    VQ.herstelWaar = waar === 'nieuw' ? 'nieuw' : 'koppel';   // 480: ook in het paneel "QR voor een nieuwe telefoon"
    if (VQ.herstelWaar === 'nieuw') $('nieuwQrPaneel').hidden = false;
    VQ.herstelReden = `Ik kan de baas niet bereiken. ${String(reden || '').trim()} Ander wifi? Scan deze QR met de BAAS-telefoon (JARVIS, Koppel met Veronica): dan geeft hij zijn nieuwe adres door. Net bijgewerkt? Open JARVIS dan eerst een keer op de telefoon. Ondertussen zoek ik zelf op het netwerk.`.replace(/\s+/g, ' ');
    tekenVeronicaQr(herstelVak());
    logRegel('Koppelen: de baas antwoordt niet; ik toon de QR van Veronica zelf en zoek de telefoons opnieuw.');
    zoekTelefoon();
    herstelZoek();
  }
  // 513 (19 oktober): DE RIJBRIEF (kern.js, rijBriefVerzoek). Bij elke nieuwe QR legt Veronica haar brievenbus en de code van de
  // rij versleuteld klaar onder een onderwerp dat alleen de scanner van DEZE QR kent. Zo begint een vers geinstalleerde telefoon
  // geen eigen brievenbus meer, en wordt hij werker als er al een baas is. Een keer per QR; zonder brievenbus niets.
  async function legRijBrief(s) {
    const o = S.ntfy && S.ntfy.onderwerp;
    if (!o || volLokaal()) return false;
    const baas = (S.telefoons || []).find((t) => t.adres === S.kern);
    try {
      const v = await K.rijBriefVerzoek(s, { onderwerp: o, code: S.code, werker: gekoppeld(), baasNaam: baas ? baas.naam : '' }, Date.now());
      if (!v) return false;
      const r = await fetch(v.url, { method: v.method, headers: v.headers, body: v.data });
      return r.ok;
    } catch (e) { return false; }
  }
  const herstelVak = () => $(VQ.herstelWaar === 'nieuw' ? 'nieuwQrBeeld' : 'koppelQrBeeld');
  function tekenVeronicaQr(doel) {
    VQ.vorige = VQ.sleutel;
    VQ.sleutel = K.nieuweSleutel();
    VQ.tot = nu() + K.VERONICA_QR_MS;
    legRijBrief(VQ.sleutel);   // 513: wie deze QR scant, krijgt haar brievenbus en de rij (via de brievenbus, zonder wifi)
    if (!VQ.vorige) VQ.briefSinds = Math.floor(Date.now() / 1000) - 60;
    const vak = doel || (VQ.herstel ? herstelVak() : $('veronicaQrBeeld')), tekst = K.veronicaQrTekst(VQ.sleutel);
    if (typeof window.qrcode !== 'function') { vak.textContent = 'De QR-maker ontbreekt. Herlaad Veronica (Ctrl+Shift+R).'; return; }
    const q = window.qrcode(0, 'M');
    q.addData(tekst);
    q.make();
    vak.innerHTML = q.createSvgTag(10, 16);   // alleen uit de QR-bibliotheek: vierkantjes, geen tekst van buiten
    const svg = vak.querySelector('svg');
    if (svg) { svg.classList.add('qr-plaatje'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR-code: scan mij met JARVIS'); }
    clearInterval(VQ.klok);
    const zet = () => {
      if (gekoppeld() && !VQ.herstel) { clearInterval(VQ.klok); return; }
      const rest = Math.max(0, Math.ceil((VQ.tot - nu()) / 1000));
      const tel = `Nog ${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')} geldig. Werkt een keer.`;
      // 476: in de herstelstand staat de reden erbij, in het vak van de koppelkaart.
      if (VQ.herstel) $(VQ.herstelWaar === 'nieuw' ? 'nieuwQrTijd' : 'koppelQrTijd').textContent = `${VQ.herstelReden} ${tel}`;
      else $('veronicaQrTijd').textContent = tel;
      if (!rest) tekenVeronicaQr();   // vanzelf een nieuwe
    };
    zet();
    VQ.klok = setInterval(zet, 1000);
  }
  // Een adres proberen met een sleutel: het bewijs erheen, het versleutelde antwoord openen.
  async function probeerVeronica(adres, s) {
    const n = K.nieuweSleutel();
    const p = await K.veronicaBewijs(s, n);
    // 449: text/plain = een "eenvoudig" verzoek, ZONDER OPTIONS-voorvraag. Die voorvraag bleef in het echte huis
    // hangen (pending) en hield de zoekronde op. JARVIS leest het lijf toch zonder naar het soort te kijken.
    const r = await haal(`${adres}/jarvis/veronica`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ n, p }) }, VQ.briefGezien.has(adres) ? 4000 : 1500);
    if (r.status !== 200) return { status: r.status };
    const d = await r.json();
    const l = K.leesPakket(JSON.parse(await K.veronicaOpen(s, d.iv, d.data)));
    if (!l) return { status: 'onleesbaar' };
    l.kern = adres;
    return { lijst: l };
  }
  async function zoekRonde(adressen) {
    let i = 0, gevonden = null;
    const werker = async () => {
      while (!gevonden && !Bijwerk.nieuw && (VQ.extra.length || i < adressen.length)) {
        const adres = VQ.extra.length ? VQ.extra.shift() : adressen[i++];   // een ingevuld adres gaat voor
        const belangrijk = VQ.briefGezien.has(adres) || adres === K.normaalAdres($('veronicaAdres').value, K.JARVIS_POORT);
        VQ.diag.gescand += 1;
        try {
          let u = await probeerVeronica(adres, VQ.sleutel);
          // Net een nieuwe QR, en de telefoon kent de vorige nog: die mag ook (een keer, dezelfde vijf minuten).
          if (u.status === 403 && VQ.vorige) u = await probeerVeronica(adres, VQ.vorige);
          if (u.lijst) gevonden = u.lijst;
          if (belangrijk) VQ.diag.poging = { adres, t: nu(), uitkomst: u.lijst ? 'gekoppeld' : `antwoord ${u.status}` };
        } catch (e) {
          /* geen telefoon op dit adres */
          if (belangrijk) VQ.diag.poging = { adres, t: nu(), uitkomst: e && e.name === 'AbortError' ? 'geen antwoord (te lang gewacht)' : 'geen verbinding (netwerkfout)' };
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, werker));   // 449: hoogstens zes tegelijk (Chrome heeft een grens)
    return gevonden;
  }
  // DE BRIEVENBUS (13 oktober): na de scan legt JARVIS zijn adres versleuteld klaar (kern.js, leesBrief).
  // 449: EEN doorlopende verbinding voor de huidige en de vorige sleutel samen, in plaats van elke vier seconden een
  // vraag. Met vragen kreeg Veronica in het echte huis na een paar minuten "429" van ntfy.sh (ongeveer twaalf vragen
  // per minuut per internetadres), noemde dat "niet te bereiken", en de telefoon -- zelfde internetadres -- kon zijn
  // eigen brief er niet meer in kwijt. Nu: een verbinding per vijf minuten (bij een nieuwe QR). Een 429 heet "druk".
  function briefStroom() {
    if (!VQ.sleutel) return;
    const sleutels = [VQ.sleutel, VQ.vorige].filter(Boolean);
    const sleutelTekst = sleutels.join('|');
    const oud = VQ.stroom;
    if (oud && oud.sleutelTekst === sleutelTekst && (oud.loopt || nu() < oud.wachtTot)) return;
    if (oud && oud.loopt) oud.ctrl.abort();
    const st = VQ.stroom = { sleutelTekst, loopt: true, ctrl: new AbortController(), wachtTot: 0 };
    (async () => {
      let fout = null;
      try {
        const onderwerpen = await Promise.all(sleutels.map((x) => K.briefOnderwerp(x)));
        const r = await fetch(K.briefStroomUrl(onderwerpen, VQ.briefSinds), { signal: st.ctrl.signal, cache: 'no-store' });
        if (r.status === 429) fout = 'druk';
        else if (!r.ok) fout = 'weg';
        else {
          VQ.briefStand = 'verbonden'; VQ.briefFouten = 0;
          if (r.body && r.body.getReader) {
            const lezer = r.body.getReader(), dec = new TextDecoder();
            let rest = '';
            for (;;) {
              const { value, done } = await lezer.read();
              if (done) break;
              rest += dec.decode(value, { stream: true });
              const regels = rest.split('\n');
              rest = regels.pop();
              for (const regel of regels) await briefRegel(regel, sleutels);
            }
            if (rest.trim()) await briefRegel(rest, sleutels);
          } else {
            for (const regel of (await r.text()).split('\n')) await briefRegel(regel, sleutels);
          }
        }
      } catch (e) { if (!st.ctrl.signal.aborted) fout = 'weg'; }
      st.loopt = false;
      if (st.ctrl.signal.aborted) return;
      if (fout === 'druk') { VQ.briefStand = 'druk'; st.wachtTot = nu() + 30000; }
      else if (fout) { VQ.briefFouten += 1; VQ.briefStand = 'weg'; st.wachtTot = nu() + 10000; }
      else st.wachtTot = nu() + 1000;   // de verbinding ging dicht (zelden bij ntfy): over een seconde weer open
    })();
  }
  function stopBriefStroom() { if (VQ.stroom && VQ.stroom.loopt) VQ.stroom.ctrl.abort(); VQ.stroom = null; }
  async function briefRegel(regel, sleutels) {
    let m;
    try { m = JSON.parse(regel); } catch (e) { return; }
    if (!m || (m.event && m.event !== 'message')) return;   // open/keepalive: geen brief
    VQ.diag.briefLaatst = nu();
    for (const s of sleutels) {
      for (const a of await K.leesBrief(s, regel)) {
        if (VQ.briefGezien.has(a)) continue;
        VQ.briefGezien.add(a);
        VQ.extra.unshift(a);
        if (!VQ.briefEerst) VQ.briefEerst = nu();
      }
    }
  }
  // 13 oktober: de zin onder de QR komt uit EEN plek (kern.js, koppelStand), voor elke manier van vastlopen.
  function toonZoekStand(begin) {
    const st = K.koppelStand({ msSinds: nu() - begin, plan: VQ.plan, briefAdressen: [...VQ.briefGezien], briefMsSinds: VQ.briefEerst ? nu() - VQ.briefEerst : 0,
      briefFouten: VQ.briefFouten, briefStand: VQ.briefStand, zelfZoeken: !!VQ.zelfZoeken, eigenNetten: (VQ.eigen || []).map(K.netVan), online: navigator.onLine !== false, toestemming: lnaToestemming });
    tekenDiag();
    const vak = $('veronicaZoekStand');
    if (vak.textContent !== st.zin) vak.textContent = st.zin;
    $('veronicaAdresBlok').hidden = !st.adresVeld;
  }
  // 449: "Wat zie ik" -- alles wat Veronica weet, zonder geheimen (geen sleutel, geen inhoud van de brief).
  const klokTijd = (t) => (t ? new Date(t).toLocaleTimeString('nl-NL') : 'nog niets');
  function tekenDiag() {
    const vak = $('koppelDiagLijst');
    if (!vak) return;
    const d = VQ.diag, p = d.poging;
    const rijen = [
      ['Eigen adressen', (VQ.eigen && VQ.eigen.length ? VQ.eigen.join(', ') : 'geen thuisadres gevonden') + (d.eigenBron === 'onthouden' ? ' (onthouden van vorige keer)' : '')],
      ['Alle kandidaten', d.kandidaten.length ? d.kandidaten.join(', ') : 'geen'],
      ['Brievenbus', { verbonden: 'verbonden', druk: 'te druk (429), wacht even', weg: 'niet bereikbaar' }[VQ.briefStand] || 'nog niet verbonden'],
      ['Laatste bericht van de brievenbus', klokTijd(d.briefLaatst)],
      ['Adres dat de telefoon doorgaf', VQ.briefGezien.size ? [...VQ.briefGezien].map((a) => a.replace('http://', '')).join(', ') : 'nog geen'],
      ['Laatste verbindingspoging', p ? `${p.adres.replace('http://', '')}: ${p.uitkomst} (${klokTijd(p.t)})` : 'nog geen'],
      ['Adressen geprobeerd', String(d.gescand)],
    ];
    const sleutel = JSON.stringify(rijen);
    if (vak.dataset.stand === sleutel) return;
    vak.dataset.stand = sleutel;
    vak.replaceChildren(...rijen.flatMap((r) => [el('dt', '', r[0]), el('dd', '', r[1])]));   // alleen tekst, nooit html
  }
  // 449 (het echte huis, 13 oktober, gemeten door Cowork): Veronica zocht ZELF honderden adressen af terwijl de QR er
  // stond. Die hingen allemaal (adressen die niet bestaan), Chrome heeft een grens aan gelijktijdige verbindingen, en
  // daardoor kwam de brievenbus niet meer door -- "ntfy.sh is nu niet te bereiken". Nu, in deze volgorde:
  //  1. eerst het eigen adres, voordat er iets anders loopt;
  //  2. dan ALLEEN de brievenbus;
  //  3. komt er een adres binnen: alleen DAT adres (en een ingevuld adres);
  //  4. blind zoeken alleen na de knop "Zoek zelf", hoogstens zes tegelijk, het eigen net eerst.
  async function zoekTelefoon() {
    if (VQ.zoekt) return;
    VQ.zoekt = true;
    try {
      if (VQ.eigen === undefined || !VQ.eigen.length) VQ.eigen = await eigenAdressen();
      const begin = nu();
      VQ.extra = []; VQ.briefEerst = 0; VQ.briefFouten = 0; VQ.plan = null;
      briefStroom();
      let laatsteVeld = null;
      VQ.zoekKlok = setInterval(() => {
        briefStroom();
        if (!gekoppeld() && !VQ.herstel) toonZoekStand(begin);
        const v = K.normaalAdres($('veronicaAdres').value, K.JARVIS_POORT);
        if (v && v !== laatsteVeld) { laatsteVeld = v; VQ.extra.push(v); }
      }, 1000);
      while ((!gekoppeld() || VQ.herstel) && !$('scherm-koppel').hidden) {
        const veld = K.normaalAdres($('veronicaAdres').value, K.JARVIS_POORT);
        const plan = K.zoekPlan(VQ.eigen, S.bekend);
        if (veld) laatsteVeld = veld;
        VQ.plan = plan;
        // Wat er IS: een ingevuld adres en het adres uit de brief. Pas na "Zoek zelf" de rest.
        const voor = (veld ? [veld] : []).concat([...VQ.briefGezien]).filter((a, i, l) => l.indexOf(a) === i);
        const adressen = VQ.zelfZoeken ? voor.concat(plan.adressen.filter((a) => !voor.includes(a))) : voor;
        if (!VQ.herstel) toonZoekStand(begin);
        const l = adressen.length || VQ.extra.length ? await zoekRonde(adressen) : null;
        if (l) {
          const herstel = VQ.herstel;
          VQ.vorige = null; VQ.sleutel = null; VQ.herstel = false; VQ.herstelReden = ''; clearInterval(VQ.klok);
          await bewaarLijst(l);
          if (herstel) { logRegel('De baas gaf via de QR zijn nieuwe adres door. Ik kijk weer mee.'); $('koppelQrBeeld').replaceChildren(); $('koppelQrTijd').textContent = ''; }
          $('veronicaZoekStand').textContent = '';
          zegKoppel(`Klaar: ${l.telefoons.length} ${l.telefoons.length === 1 ? 'telefoon' : 'telefoons'}. Scan deze QR met de volgende telefoon.`, false);
          logRegel('Gekoppeld vanaf de QR van Veronica.');
          toonScherm('koppel');
          return;
        }
        await slaap(adressen.length ? 3000 : 1000);
      }
    } finally { VQ.zoekt = false; clearInterval(VQ.zoekKlok); stopBriefStroom(); }
  }
  const slaap = (ms) => new Promise((z) => setTimeout(z, ms));
  function startVeronicaQr() {
    if (gekoppeld() && !VQ.herstel) return;
    if (!VQ.sleutel || nu() >= VQ.tot) tekenVeronicaQr();
    zoekTelefoon();
  }

  // VERONICA LAAT EEN QR ZIEN voor een nieuwe telefoon: eenmalig, vijf minuten. Daarvoor vraagt
  // ze met de code een token bij de hoofdtelefoon; de code zelf staat NIET in de QR.
  // 1.9.6: OOK OP HET SCHERM KOPPELEN, meteen zichtbaar (daar stond eerst alleen een scan-knop).
  // Dezelfde functie tekent in het grote paneel (knop bovenaan) of in het vak op Koppelen.
  let qrKlok = null;
  async function toonNieuweTelefoonQr(waar) {
    const opKoppel = waar === 'koppel';
    const vak = $(opKoppel ? 'koppelQrBeeld' : 'nieuwQrBeeld');
    const tijd = $(opKoppel ? 'koppelQrTijd' : 'nieuwQrTijd');
    if (!opKoppel) $('nieuwQrPaneel').hidden = false;
    vak.textContent = 'Even… ik vraag de baas om een koppelcode.';
    tijd.textContent = '';
    if (!S.kern || !S.code) {
      vak.textContent = opKoppel
        ? 'Eerst Veronica koppelen: scan de QR van Veronica met JARVIS.'
        : 'Koppel Veronica eerst met de hoofdtelefoon (Koppelen).';
      return;
    }
    // 476: NOOIT op "Even..." blijven staan. Komt er binnen acht seconden niets, dan de terugval: de QR van Veronica zelf.
    let klaar = false;
    const wachter = setTimeout(() => { if (!klaar) herstelQr('De baas antwoordde niet binnen acht seconden.', opKoppel ? 'koppel' : 'nieuw'); }, 8000);
    let t = null, waarom = null;
    const t0 = nu();
    try {
      const r = await haal(`${kernNu()}/jarvis/koppeltoken`, { method: 'POST', headers: { 'X-Koppelcode': S.code } }, 4000);
      if (r.ok) t = (await r.json()).t;
    } catch (e) { t = null; try { waarom = await waaromGeenAntwoord(kernNu(), t0, 4000); } catch (x) { waarom = null; } }
    klaar = true;
    clearTimeout(wachter);
    const tekst = K.koppelQrTekst(kernNu(), t);
    if (typeof window.qrcode !== 'function') { vak.textContent = 'De QR-maker ontbreekt. Herlaad Veronica (Ctrl+Shift+R).'; return; }
    if (!tekst) {
      // 476: de baas is niet te bereiken (ander wifi?). Dan de QR van Veronica zelf: de baas scant hem en geeft zijn
      // nieuwe adres door (brievenbus), en Veronica zoekt ondertussen zelf. Een kaart zonder QR helpt niemand.
      // 480: OOK in het paneel bovenaan. "Nu geen QR" liet de eigenaar met lege handen staan: koppelen was helemaal dicht.
      herstelQr(waarom || 'De hoofdtelefoon gaf geen koppelcode.', opKoppel ? 'koppel' : 'nieuw');
      return;
    }
    VQ.herstel = false; VQ.herstelReden = '';
    const q = window.qrcode(0, 'M');
    q.addData(tekst);
    q.make();
    vak.innerHTML = q.createSvgTag(8, 16);   // alleen uit de QR-bibliotheek: vierkantjes, geen tekst van buiten
    const svg = vak.querySelector('svg');
    if (svg) { svg.classList.add('qr-plaatje'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR-code voor een nieuwe telefoon'); }
    const tot = nu() + 5 * 60 * 1000;
    clearInterval(qrKlok);
    const zet = () => {
      const rest = Math.max(0, Math.ceil((tot - nu()) / 1000));
      tijd.textContent = rest > 0 ? `Nog ${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')} geldig. Werkt een keer.` : 'Verlopen. Tik nog eens voor een nieuwe.';
      if (!rest) { vak.replaceChildren(); clearInterval(qrKlok); }
    };
    zet();
    qrKlok = setInterval(zet, 1000);
    logRegel('QR voor een nieuwe telefoon getoond (vijf minuten, een keer).');
  }
  // 1.9.12: TWEE LEZERS. De ingebouwde van Chrome (BarcodeDetector) bestaat alleen op ChromeOS, macOS
  // en Android. Daarbuiten -- of als hij faalt -- leest jsQR het beeld zelf. Vroeger stond er dan
  // "Deze browser kan hier geen QR lezen", en daarmee kon je Veronica niet koppelen.
  function maakQrLezer(video) {
    let ingebouwd = null;
    try { if ('BarcodeDetector' in window) ingebouwd = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { ingebouwd = null; }
    const doek = document.createElement('canvas');
    return async function lees() {
      if (ingebouwd) {
        try { const c = await ingebouwd.detect(video); return c.length ? c[0].rawValue : null; } catch (e) { ingebouwd = null; }
      }
      if (typeof window.jsQR !== 'function') return null;
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return null;
      doek.width = w; doek.height = h;
      const x = doek.getContext('2d', { willReadFrequently: true });
      x.drawImage(video, 0, 0, w, h);
      const r = window.jsQR(x.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      return r ? r.data : null;
    };
  }
  async function scanQr() {
    const vak = $('koppelMelding');
    if ((!('BarcodeDetector' in window) && typeof window.jsQR !== 'function') || !navigator.mediaDevices) { vak.textContent = 'Deze browser kan hier geen QR lezen. Gebruik het adres en de code.'; return; }
    let stroom;
    try { stroom = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch (e) { vak.textContent = 'Geen camera (of geen toestemming). Klik links van het adres op het slotje en zet Camera op Toestaan, of gebruik het adres en de code.'; return; }
    const video = $('qrVideo');
    video.hidden = false;
    video.srcObject = stroom;
    await video.play();
    vak.textContent = 'Houd de QR van JARVIS voor de camera.';
    const lees = maakQrLezer(video);
    const stop = () => { stroom.getTracks().forEach((x) => x.stop()); video.hidden = true; };
    const eind = nu() + 60000;
    // 1.9.13 (punt 6): ELKE GELEZEN QR MAAR EEN KEER VERSTUREN. De QR blijft in beeld, en elke 300 ms
    // werd hetzelfde eenmalige token opnieuw gestuurd; was het eerste al aangekomen, dan zei de tweede
    // "verlopen of al gebruikt". Een nieuwe QR (JARVIS: Nieuwe koppelcode) wordt wel weer gelezen.
    const gestuurd = new Set();
    while (nu() < eind) {
      try {
        const tekst = await lees();
        if (tekst && !gestuurd.has(tekst)) {
          gestuurd.add(tekst);
          if (await koppelMetQrTekst(tekst)) { stop(); return; }
        }
      } catch (e) { /* volgende beeld */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    stop();
    vak.textContent = 'Geen QR gezien. Houd de QR stil en dichterbij, of gebruik het adres en de code.';
  }

  // ---- DE WANDSTAND: alleen de prestatiekaarten, groot, volledig scherm ----
  // Met de knop, of VANZELF na twee minuten zonder muis of toetsen op het Live-scherm (de
  // thuispost naast het rek). Echt volledig scherm mag een browser alleen na een tik of toets;
  // die eerste tik doet het dan. "← Terug" (of Esc) gaat terug.
  const Wand = { aan: false, auto: true, stilT: nu() };
  function volScherm() {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }
  function zetWand(aan, waarom) {
    Wand.aan = !!aan;
    document.body.classList.toggle('wand', Wand.aan);
    $('wandKnop').setAttribute('aria-pressed', String(Wand.aan));
    if (Wand.aan) {
      toonScherm('live');
      if (waarom === 'knop') volScherm();
      vraagWakker();
      logRegel(waarom === 'vanzelf' ? 'Wandstand: twee minuten niets aangeraakt.' : 'Wandstand aan.');
    } else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    tekenWand();
  }
  function tekenWand() {
    if (!Wand.aan) return;
    $('wandKlok').textContent = K.klokZin(nu()).slice(0, 5);
    $('wandZin').textContent = $('veronicaZegt').textContent || $('pantserZin').textContent;
  }
  async function wisselWandAuto() {
    Wand.auto = !Wand.auto;
    await Opslag.schrijf('wandAuto', Wand.auto);
    $('wandAutoKnop').textContent = `Wandstand vanzelf: ${Wand.auto ? 'aan' : 'uit'}`;
    $('wandAutoKnop').setAttribute('aria-pressed', String(Wand.auto));
  }
  function wandTik() {
    if (Wand.aan) { tekenWand(); return; }
    if (Wand.auto && S.telefoons.length && !$('scherm-live').hidden && $('nieuwQrPaneel').hidden && nu() - Wand.stilT >= 120000) zetWand(true, 'vanzelf');
  }

  // ---- Wakker blijven, volledig scherm ----
  async function wakker() {
    if (S.wakeLock || S.wilWakker) {
      S.wilWakker = false; await Opslag.schrijf('wakker', false);
      if (S.wakeLock) { try { await S.wakeLock.release(); } catch (e) { /* al los */ } }
      S.wakeLock = null; tekenWakker(); return;
    }
    S.wilWakker = true; await Opslag.schrijf('wakker', true);
    await vraagWakker();
  }
  // Het scherm aan houden. Na een slaapstand of een herstart laat Chrome het slot los; zolang je
  // het gevraagd hebt, vraagt Veronica het zelf opnieuw zodra ze weer zichtbaar is.
  async function vraagWakker() {
    if (!S.wilWakker || S.wakeLock) { tekenWakker(); return; }
    if (!('wakeLock' in navigator)) { $('wakkerZin').textContent = 'Deze browser kan het scherm niet aan houden. Zet slapen uit in de instellingen van de Chromebook.'; return; }
    try {
      S.wakeLock = await navigator.wakeLock.request('screen');
      S.wakeLock.addEventListener('release', () => { S.wakeLock = null; tekenWakker(); });
    } catch (e) { S.wakeLock = null; }
    tekenWakker();
  }
  function tekenWakker() {
    $('wakkerKnop').textContent = S.wakeLock ? 'Scherm blijft aan' : (S.wilWakker ? 'Scherm aan (wacht op Chrome)' : 'Houd het scherm aan');
    $('wakkerKnop').setAttribute('aria-pressed', String(!!S.wakeLock));
  }
  function tekenLog() {
    const v = $('log');
    if (v) metScroll(() => morphKinderen(v, S.log.slice(0, 12).map((x) => el('div', '', `${K.klokZin(x.t)} · ${x.zin}`))));
  }
  // ---- De updateplek van JARVIS (1.9.7) ----
  // Geen sleutel = een zin, geen fout. Met sleutel: hoogstens eens per uur, alleen als je op
  // Koppelen kijkt, de nieuwste versie navragen (een verzoek naar api.github.com).
  const UpdV = { gekoppeld: false, nieuwste: null, gevraagd: 0 };
  async function neemUpdateSleutelOver(t, repo) {
    if (repo && repo !== S.updateRepo) { S.updateRepo = repo; await Opslag.schrijf('updateRepo', repo); }
    const geldig = K.leesUpdateSleutel(t);
    if (!geldig || geldig === await Kluis.lees('updateSleutel')) return;
    await Kluis.zet('updateSleutel', geldig);
    UpdV.gekoppeld = true;
    logRegel('Updateplek van JARVIS gekoppeld (van de baas).');
    tekenUpdatePlek();
  }
  async function tekenUpdatePlek() {
    const vak = $('updatePlekStand');
    if (!vak) return;
    const t = await Kluis.lees('updateSleutel');
    UpdV.gekoppeld = !!t;
    if (!t) { vak.textContent = 'Updateplek van JARVIS: niet gekoppeld. Die komt vanzelf mee als Veronica gekoppeld is met een baas die hem heeft.'; return; }
    vak.textContent = `Updateplek van JARVIS: gekoppeld.${UpdV.nieuwste ? ` Nieuwste versie: ${UpdV.nieuwste}.` : ''}`;
    if (nu() - UpdV.gevraagd < 60 * 60 * 1000 || !S.updateRepo) return;
    UpdV.gevraagd = nu();
    try {
      const r = await fetch(`https://api.github.com/repos/${S.updateRepo}/releases/latest`, { headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json' } });
      if (!r.ok) return;
      const j = await r.json();
      const v = /^v?(\d+\.\d+\.\d+)$/.exec(String(j.tag_name || ''));
      if (v) { UpdV.nieuwste = v[1]; vak.textContent = `Updateplek van JARVIS: gekoppeld. Nieuwste versie: ${v[1]}.`; }
    } catch (e) { /* geen internet: geen getal */ }
  }

  // 1.9.13: WAT ER TE ZIEN IS HANGT AF VAN OF VERONICA AL GEKOPPELD IS.
  //  - niet gekoppeld: geen knop "QR voor een nieuwe telefoon" bovenaan (die gaf een wit, doodlopend
  //    scherm zonder QR, en daar liep het op 11 oktober op vast); op Koppelen ALLEEN "Veronica
  //    koppelen", bovenaan, met de grote scanknop;
  //  - wel gekoppeld: de knop bovenaan, en op Koppelen eerst de QR voor een nieuwe telefoon.
  function gekoppeld() { return !!(S.kern && S.code); }
  function tekenKoppelStand() {
    const ja = gekoppeld();
    $('nieuwQrKnop').hidden = !ja;
    $('nieuwBlok').hidden = !ja;
    $('zelfQr').hidden = ja;   // 1.9.14: dezelfde kaart; zonder koppeling de QR van Veronica zelf
    $('gekoppeldTeller').textContent = ja ? K.gekoppeldZin(S.telefoons) : '';
    tekenDownload();
  }
  // 1.9.14: KAART 2, "JARVIS op een nieuwe telefoon zetten". De link komt van JARVIS (de ondertekende link uit
  // de postbus, privé, hoogstens zeven dagen). Geen link of verlopen = geen QR, en een eerlijke zin.
  function tekenDownload() {
    const vak = $('downloadQrBeeld'), stand = $('downloadStand');
    const d = S.download, vast = d && d.vast ? d.vast : null, verlopen = !vast && !!(d && d.tot && Date.parse(d.tot) < nu());
    const link = vast || (d && d.apk);
    if (!d || verlopen || typeof window.qrcode !== 'function') {
      vak.replaceChildren();
      vak.hidden = true;
      stand.textContent = !gekoppeld() ? 'Deze QR komt zodra Veronica een telefoon kent: de link komt van JARVIS.'
        : verlopen ? 'De downloadlink is verlopen. Open JARVIS op de baas-telefoon even: dan komt er vanzelf een nieuwe.'
          : !d ? 'Nog geen downloadlink. Koppel JARVIS eerst aan de postbus (scan in JARVIS de code van de beheerpagina); dan komt hij hier vanzelf.'
            : 'De QR-maker ontbreekt. Herlaad Veronica (Ctrl+Shift+R).';
      return;
    }
    if (vak.dataset.apk !== link) {
      const q = window.qrcode(0, 'L');
      q.addData(link);
      q.make();
      vak.innerHTML = q.createSvgTag(4, 16);   // alleen uit de QR-bibliotheek: vierkantjes, geen tekst van buiten
      const svg = vak.querySelector('svg');
      if (svg) { svg.classList.add('qr-plaatje'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'QR-code: JARVIS downloaden'); }
      vak.dataset.apk = link;
    }
    vak.hidden = false;
    // 499: de vaste link verloopt niet. Na het installeren vraagt JARVIS zelf om mee te doen (Bluetooth); dan is "Laat toe" genoeg.
    if (vast) { stand.textContent = 'Deze link verloopt niet en geeft altijd de nieuwste JARVIS. Na het installeren JARVIS openen; daarna is "Laat toe" genoeg. Alleen voor je eigen telefoons: deel hem niet.'; return; }
    stand.textContent = `${d.tot ? `Deze link werkt tot ${new Date(d.tot).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })}. ` : ''}Alleen voor je eigen telefoons: deel hem niet.`;
  }
  // 1.9.14: MEERDERE TELEFOONS ACHTER ELKAAR. Zolang Koppelen open staat kijkt Veronica elke vijf seconden bij
  // de baas of er een telefoon bij is gekomen. Zo ja: de naam in de teller, en meteen een verse QR (de oude is
  // gebruikt). Alleen op dit scherm, dus geen doorlopend verkeer.
  let volgKlok = null;
  async function volgNieuweTelefoons() {
    if ($('scherm-koppel').hidden || !gekoppeld()) { clearInterval(volgKlok); volgKlok = null; return; }
    let l = null;
    try {
      const r = await haal(`${kernNu()}/jarvis/vertrouwd`, { headers: { 'X-Koppelcode': S.code } }, 3000);
      if (r.ok) l = K.leesVertrouwd(await r.json());
    } catch (e) { return; }
    if (!l) return;
    l.telefoons = K.herstelKernAdres(l.telefoons, kernNu());   // 450
    if (l.nieuweTelefoon && (!S.download || S.download.apk !== l.nieuweTelefoon.apk || S.download.vast !== l.nieuweTelefoon.vast)) { S.download = l.nieuweTelefoon; await Opslag.schrijf('download', S.download); }
    neemPostbusVers(l.postbusAdres);   // 487: alleen in het geheugen
    const namen = l.telefoons.length ? K.nieuweNamen(S.telefoons, l.telefoons) : [];
    if (namen.length) {
      S.telefoons = l.telefoons;
      await Opslag.schrijf('telefoons', S.telefoons);
      zegKoppel(`Erbij: ${namen.join(', ')}. Scan de nieuwe QR met de volgende telefoon.`, false);
      logRegel(`Gekoppeld: ${namen.join(', ')}.`);
      tekenLive();
      toonNieuweTelefoonQr('koppel');
    }
    tekenKoppelStand();
  }
  function startVolgen() {
    if (volgKlok || !gekoppeld()) return;
    volgKlok = setInterval(volgNieuweTelefoons, 5000);
  }
  function toonScherm(naam) {
    for (const s of ['live', 'wachtrij', 'koppel', 'prive']) { $(`scherm-${s}`).hidden = s !== naam; $(`tab-${s}`).setAttribute('aria-pressed', String(s === naam)); }
    if (naam !== 'prive' && PriveUi && PriveUi.open) PriveUi.dicht();   // 466: de hoek gaat dicht zodra je weggaat
    if (naam === 'prive' && PriveUi) PriveUi.teken();
    // 1.9.6: op Koppelen staat de QR voor een nieuwe telefoon er meteen (geen extra tik).
    if (naam === 'wachtrij') tekenTakenverdeling(true);
    if (naam === 'koppel') tekenKoppelStand();
    if (naam === 'koppel' && gekoppeld() && !$('koppelQrBeeld').querySelector('svg')) toonNieuweTelefoonQr('koppel');
    if (naam === 'koppel' && (!gekoppeld() || VQ.herstel)) startVeronicaQr();   // 1.9.14; 476: ook in de herstelstand
    if (naam === 'koppel' && gekoppeld()) startVolgen();
    if (naam === 'koppel') tekenUpdatePlek();
  }

  // ---- Start ----

  // ---- 470: DE WEG VAN DE PRIVÉ-HOEK NAAR EEN MODEL (prive-model.js) ----
  // Het enige stukje rond de hoek dat het netwerk aanraakt, en alleen naar het lokale adres dat de eigenaar in de hoek koos,
  // met de schakelaar aan. Standaard uit. De regels en de test: prive-model.js, check_prive_model.js.
  function priveModelLaag() {
    if (typeof PriveModel === 'undefined' || typeof PriveHoek === 'undefined') return null;
    return PriveModel.maak({
      fetch: (u, o) => window.fetch(u, o), nu, isLokaal: PriveHoek.isLokaalAdres,
      instellingen: () => (PriveUi && PriveUi.store ? PriveUi.store.instellingen : null),
      inHoek: (adres) => { const r = priveRijen().find((x) => x.adres === adres || x.motorAdres === adres); return r ? r.priveSleutel === true : null; },
      sleutel: () => PriveMotorSleutel.waarde,   // 481: de eigen privé-sleutel van deze Chromebook (nooit de rij-code)
    });
  }
  // 481 (stap F): DE PRIVÉ-SLEUTEL VAN DEZE CHROMEBOOK voor de eigen motor van een telefoon. 32 hex uit crypto.getRandomValues, bewaard
  // in de eigen database van de hoek (veronica-prive), NOOIT in localStorage, een logboek of een verzoek naar iets anders dan de
  // gekozen telefoon. Een nieuwe QR = een nieuwe sleutel (de oude telefoon moet dan opnieuw scannen).
  const PriveMotorSleutel = { waarde: null, geladen: false };
  async function laadPriveMotorSleutel() {
    if (PriveMotorSleutel.geladen) return;
    PriveMotorSleutel.geladen = true;
    try { const w = await PriveOpslag.lees('motor-sleutel'); if (typeof w === 'string' && /^[0-9a-f]{32}$/.test(w)) PriveMotorSleutel.waarde = w; } catch (e) { /* geen sleutel */ }
  }
  async function maakPriveKoppelQr() {
    const b = new Uint8Array(16); window.crypto.getRandomValues(b);
    const s = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    try { await PriveOpslag.schrijf('motor-sleutel', s); } catch (e) { return { zin: 'De sleutel kon niet bewaard worden in deze browser.' }; }
    PriveMotorSleutel.waarde = s;
    const tekst = PriveModel.qrTekst(s);
    if (typeof window.qrcode !== 'function' || !tekst) return { zin: 'De QR-maker ontbreekt. Herlaad Veronica (Ctrl+Shift+R).' };
    const q = window.qrcode(0, 'M'); q.addData(tekst); q.make();
    return { beeld: q.createDataURL(8, 16) };
  }

  // ---- 466: MIJN PRIVÉ-HOEK ----
  // Eigen database in deze browser; geen netwerk. De inhoud (prive-hoek.js / prive-hoek-ui.js) komt nooit in logRegel, ntfy of een telefoon.
  const PriveOpslag = (() => {
    let db = null;
    const open = () => db ? Promise.resolve(db) : new Promise((klaar, mis) => { const r = indexedDB.open('veronica-prive', 1); r.onupgradeneeded = () => r.result.createObjectStore('hoek'); r.onsuccess = () => { db = r.result; klaar(db); }; r.onerror = () => mis(r.error); });
    const doe = async (modus, f) => { const d = await open(); return new Promise((klaar, mis) => { const tx = d.transaction('hoek', modus); const u = f(tx.objectStore('hoek')); tx.oncomplete = () => klaar(u && 'result' in u ? u.result : undefined); tx.onerror = () => mis(tx.error); }); };
    return { lees: (k) => doe('readonly', (s) => s.get(k)), schrijf: (k, w) => doe('readwrite', (s) => s.put(w, k)), wis: (k) => doe('readwrite', (s) => s.delete(k)) };
  })();
  const priveRijen = () => S.telefoons.map((t) => {
    const m = meet(t.adres); const st = m.status || {};
    const vers = (x) => x && nu() - x.t <= K.MAX_LEEFTIJD_MS;
    const ps = poolStaat(t);
    const bereikbaar = !!(st.versie && vers(st.versie));
    return {
      naam: t.naam,
      adres: t.adres,
      motorAdres: K.motorAdres(t, st),
      priveSleutel: st.priveSleutel && vers(st.priveSleutel) ? st.priveSleutel.waarde : null,
      versie: st.versie && vers(st.versie) ? st.versie.waarde : 'onbekend',
      accu: st.batterij && vers(st.batterij) && st.batterij.waarde !== null ? `${Math.round(st.batterij.waarde)}%${st.laadt && vers(st.laadt) && st.laadt.waarde ? ' (laadt)' : ''}` : 'onbekend',
      temp: st.temperatuur && vers(st.temperatuur) && st.temperatuur.waarde !== null ? `${String(Math.round(st.temperatuur.waarde * 10) / 10).replace('.', ',')} °C` : 'onbekend',
      model: !bereikbaar && !ps.model ? 'onbekend' : ps.model ? `ja (${ps.model})` : 'nee',
    };
  });
  const priveVerbruik = () => S.stekkers.filter((k) => k.rol === 'meter').map((k) => {
    const m = S.stekkerMeting[k.ip] || {}; const tijd = nu();
    if (m.meet === false) return { naam: k.naam, tekst: 'deze stekker meet niet', bron: 'Tasmota Status 8' };
    const w = K.vakje(m.watt || null, tijd, (v) => `${Math.round(v)} W`);
    const sp = K.vakje(m.spanning || null, tijd, (v) => `${Math.round(v)} V`);
    const tot = K.vakje(m.kwh || null, tijd, (v) => `totaal ${String(Math.round(v * 100) / 100).replace('.', ',')} kWh`);
    const vd = K.vakje(m.vandaag || null, tijd, (v) => `vandaag ${String(Math.round(v * 100) / 100).replace('.', ',')} kWh`);
    const delen = [w, sp, tot, vd].filter((x) => !x.onbekend);
    return { naam: k.naam, tekst: delen.length ? delen.map((x) => x.tekst).join(' · ') : 'onbekend', bron: delen.length ? delen[0].bron : 'nog niet gemeten' };
  });
  let PriveUi = null;
  function startPriveHoek() {
    if (typeof PriveHoek === 'undefined' || typeof PriveHoekUI === 'undefined') return;
    PriveUi = PriveHoekUI.maak(PriveHoek, {
      doc: document, nu, opslag: PriveOpslag, crypto: window.crypto,
      rijen: priveRijen, verbruik: priveVerbruik,
      noodstopKern: () => { for (const t of S.telefoons) { const a = (meet(t.adres).status || {}).aikern; if (a && a.waarde && nu() - a.t <= K.MAX_LEEFTIJD_MS) return a.waarde.noodstop === true; } return null; },
      noodstop: () => noodstop(), stop: () => { if (S.aan) $('pantserKnop').click(); }, pantserAan: () => S.aan === true,
      bevestig: (zin) => window.confirm(zin),
      koppelQr: maakPriveKoppelQr,   // 481: de telefoon koppelen aan de hoek (QR met de privé-sleutel)
      model: priveModelLaag(),   // 470: zie hierboven (buiten dit blok: het is het ENIGE stukje van de hoek dat het netwerk aanraakt)
      downloadBestand: (naam, tekst) => {
        // 498: de VERSLEUTELDE back-up van de privé-hoek gaat naar het kaartje als dat er is (soort 'backup' laat alleen die vorm door).
        if (KaartjeL && /^prive-hoek-/.test(naam)) { KaartjeL.status().then((st) => (st === 'aanwezig' ? KaartjeL.schrijf('backup', tekst, kaartjeVerboden(), nu()) : null)).catch(() => {}); }   // stil: dit blok schrijft nooit in het logboek
        const b = new Blob([tekst], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = naam; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); },
    });
    laadPriveMotorSleutel();
    PriveUi.start($('priveHoek')).catch(() => { $('priveHoek').textContent = 'De privé-hoek kon niet worden geladen in deze browser.'; });
    setInterval(() => PriveUi.tik(), 30000);
  }

  async function start() {
    try {
      S.telefoons = (await Opslag.lees('telefoons')) || [];
      S.stekkers = (await Opslag.lees('stekkers')) || [];
      S.kern = (await Opslag.lees('kern')) || null;
      // 450: een eerder bewaarde lijst met de baas op een fout adres (10.x): meteen goedzetten op het adres van de baas.
      if (S.kern) S.telefoons = K.herstelKernAdres(S.telefoons, S.kern);
      S.code = (await Opslag.lees('code')) || null;
      S.download = K.leesNieuweTelefoon(await Opslag.lees('download'));
      tekenKoppelStand();
      S.updateRepo = (await Opslag.lees('updateRepo')) || null;
      S.bekend = (await Opslag.lees('bekend')) || [];
      S.ntfy = K.leesNtfy(await Opslag.lees('ntfy'));
      { const b = await Opslag.lees('ledenbrief'); if (b && Array.isArray(b.leden)) LB.brief = b; }   // 482
      { const hs = await Opslag.lees('hartslagen'); if (hs && typeof hs === 'object') HB.per = hs; }   // 500
      if (window.Nachtlog) S.nachtlog = window.Nachtlog.leesLijst(await Opslag.lees('nachtlog'), NACHT_MAX);   // 483
      Wand.auto = (await Opslag.lees('wandAuto')) !== false;
      S.spraak = Object.assign(S.spraak, (await Opslag.lees('spraak')) || {});
      S.eigenaar = K.leesEigenaar(await Opslag.lees('eigenaar'));
      S.eigenaarZelf = (await Opslag.lees('eigenaarZelf')) === true;
      S.karakter = (await Opslag.lees('karakter')) === 'zakelijk' ? 'zakelijk' : 'hulpdienst';
      S.wilWakker = (await Opslag.lees('wakker')) === true;
      S.bureau = (await Opslag.lees('bureau')) !== false;
      S.taken = ((await Opslag.alleTaken()) || []).sort((a, b) => a.sinds - b.sinds);
      // Wat bezig was toen Veronica dichtging, gaat terug in de wachtrij.
      for (const x of S.taken) if (x.status === 'bezig') { x.status = 'wacht'; x.telefoon = null; await Opslag.taak(x); }
    } catch (e) { logRegel('De opslag van deze browser is niet te lezen.'); }
    $('pantserKnop').addEventListener('click', () => zetPantser(!S.aan));
    $('motorAlleKnop').addEventListener('click', () => { motorAlleAan().catch(() => {}); });
    $('bureauKnop').addEventListener('click', () => zetBureau(!S.bureau));
    $('noodstop').addEventListener('click', noodstop);
    $('vervangKnop').addEventListener('click', () => { const a = $('vervangKeus').value; if (a) vervang(a); });
    $('wakkerKnop').addEventListener('click', wakker);
    $('volKnop').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); });
    $('koppelKnop').addEventListener('click', koppelMetCode);
    $('qrKnop').addEventListener('click', scanQr);
    $('karakterKnop').addEventListener('click', wisselKarakter);
    $('roepKnop').addEventListener('click', () => roepOp(true));
    $('wandKnop').addEventListener('click', () => zetWand(!Wand.aan, 'knop'));
    // De knoppen op de tegels: een luisteraar voor allemaal (de tegels blijven staan, de
    // telefoon wordt bij de tik opgezocht).
    $('tegels').addEventListener('click', (e) => {
      const knop = e.target && e.target.closest ? e.target.closest('button[data-actie]') : null;
      const tegel = knop ? knop.closest('.tegel') : null;
      const t = tegel ? S.telefoons.find((x) => x.adres === tegel.dataset.adres) : null;
      if (!t) return;
      if (knop.dataset.actie === 'scherm') schermWissel(t);
      if (knop.dataset.actie === 'baas') maakBaas(t);
      if (knop.dataset.actie === 'ruim') ruimGemmaOp(t);
      if (knop.dataset.actie === 'test') testTelefoon(t);
      if (knop.dataset.actie === 'nulmeting') startNulmeting(t);
      if (knop.dataset.actie === 'installeer') { S.installQr[t.adres] = !S.installQr[t.adres]; tekenLive(); }
      if (knop.dataset.actie === 'olliteStart') startOlliteVanuitVeronica(t);
      if (knop.dataset.actie === 'motor') motorVanuitVeronica(t, knop.dataset.aan === '1');
      if (knop.dataset.actie === 'weer') { staat(t.adres).vervangen = false; logRegel(`${t.naam} doet weer mee.`); tekenLive(); werkTik(); }
    });
    $('wandUit').addEventListener('click', (e) => { e.stopPropagation(); Wand.stilT = nu(); zetWand(false); });
    $('wandAutoKnop').addEventListener('click', wisselWandAuto);
    $('micKnop').addEventListener('click', () => luister(false));
    $('heyKnop').addEventListener('click', () => luister(true));
    $('noodstopBevestig').addEventListener('click', () => { Spr.noodstopT = 0; $('noodstopBevestig').hidden = true; noodstop(); });
    $('spraakKnop').addEventListener('click', () => { S.spraak.aan = !S.spraak.aan; if (!S.spraak.aan && kanSpreken()) window.speechSynthesis.cancel(); bewaarSpraak(); });
    $('spraakVolume').addEventListener('input', () => { S.spraak.volume = Math.max(0, Math.min(1, Number($('spraakVolume').value) || 0)); bewaarSpraak(); });
    $('spraakTempo').addEventListener('change', () => { S.spraak.tempo = Number($('spraakTempo').value) || 1; bewaarSpraak(); });
    $('stemKeus').addEventListener('change', () => { S.spraak.stem = $('stemKeus').value; bewaarSpraak(); });
    $('spraakProef').addEventListener('click', () => { const st = statusNu(); spreek(K.veronicaZin(S.karakter, 'status', Object.assign({ naam: S.eigenaar }, st)), 'proef'); });
    $('eigenaarNaam').addEventListener('change', async () => {
      S.eigenaar = K.leesEigenaar($('eigenaarNaam').value);
      S.eigenaarZelf = !!S.eigenaar;
      await Opslag.schrijf('eigenaar', S.eigenaar); await Opslag.schrijf('eigenaarZelf', S.eigenaarZelf);
    });
    if (kanSpreken()) window.speechSynthesis.onvoiceschanged = tekenSpraak;
    // Wat moest wachten op de eerste tik (de begroeting), komt nu.
    document.addEventListener('pointerdown', () => { const w = Spr.wacht.splice(0); setTimeout(() => w.forEach(([z, s]) => spreek(z, s)), 50); }, { once: true });
    // Wie iets aanraakt, is er: de klok voor "vanzelf" begint opnieuw. In de wandstand maakt de
    // eerste tik het scherm echt vol (dat mag een browser alleen na een tik).
    // Ook scrollen telt als "er is iemand": anders springt de wandstand aan tijdens het lezen.
    window.addEventListener('scroll', () => { Wand.stilT = nu(); }, { passive: true });
    document.addEventListener('touchmove', () => { Wand.stilT = nu(); }, { passive: true });
    for (const soort of ['pointerdown', 'keydown', 'wheel']) {
      document.addEventListener(soort, (e) => {
        Wand.stilT = nu();
        if (Wand.aan && soort === 'pointerdown' && !(e.target && e.target.id === 'wandUit')) volScherm();
      }, { passive: true });
    }
    // 449: de noodweg, uitdrukkelijk. De brievenbus blijft gewoon open en houdt voorrang (hoogstens zes tegelijk).
    $('zoekZelfKnop').addEventListener('click', () => {
      VQ.zelfZoeken = true;
      $('zoekZelfKnop').disabled = true;
      $('zoekZelfKnop').textContent = 'Ik zoek zelf op het wifi...';
    });
    $('veronicaVersie').textContent = `Veronica ${K.VERONICA_VERSIE}`;
    $('ntfyKopieer').addEventListener('click', async () => {
      const naam = S.ntfy && S.ntfy.onderwerp;
      let gelukt = false;
      try { if (naam) { await Promise.race([navigator.clipboard.writeText(naam), new Promise((_, mis) => setTimeout(() => mis(new Error('te lang')), 2500))]); gelukt = true; } } catch (x) { gelukt = false; }
      $('ntfyKopieerZin').textContent = gelukt ? 'Gekopieerd. Plak de naam in ntfy bij Abonneren.' : 'Kopieren lukte niet. Selecteer de naam en kopieer met Ctrl+C.';
    });
    $('ntfyProef').addEventListener('click', async () => {
      const r = await waarschuw('proef', K.veronicaZin('hulpdienst', 'proef'));
      logRegel(r.gestuurd ? 'Proefmelding verstuurd. Kijk op je telefoon.' : `Proefmelding niet verstuurd: ${r.reden}.`);
    });
    $('nieuwQrKnop').addEventListener('click', () => { if (gekoppeld()) toonNieuweTelefoonQr('paneel'); else toonScherm('koppel'); });
    $('koppelQrNieuw').addEventListener('click', () => toonNieuweTelefoonQr('koppel'));
    $('stekkerNieuw').addEventListener('click', (e) => {   // 452b: ventilator of lader
      const b = e.target && e.target.closest ? e.target.closest('button[data-mac]') : null;
      if (b) kiesStekkerRol(b.dataset.mac, b.dataset.stekkerRol);
    });
    $('stekkerZoekNu').addEventListener('click', () => zoekStekkersNu());   // 463b
    document.querySelectorAll('#stekkerBeheer [data-adresrol]').forEach((b) => b.addEventListener('click', () => voegStekkerOpAdresToe($('stekkerAdres').value, b.dataset.adresrol)));
    $('stekkerTegels').addEventListener('click', (e) => {   // 463b: de rol van een stekker
      const b = e.target && e.target.closest ? e.target.closest('button[data-nieuwe-rol]') : null;
      if (b && b.getAttribute('aria-pressed') !== 'true') kiesStekkerNieuweRol(b.dataset.rolNaam, b.dataset.nieuweRol);
    });
    $('stekkerTegels').addEventListener('click', (e) => {   // 1.9.15: de handknop
      const b = e.target && e.target.closest ? e.target.closest('button[data-hand]') : null;
      if (b) kiesHand(b.dataset.stekker, b.dataset.hand);
    });
    document.querySelectorAll('#reserveSchuif [data-reserve]').forEach((b) => b.addEventListener('click', () => kiesReserve(Number(b.dataset.reserve))));   // 1.9.14
    $('nieuwQrSluit').addEventListener('click', () => { $('nieuwQrPaneel').hidden = true; clearInterval(qrKlok); $('nieuwQrBeeld').replaceChildren(); });
    $('qrPlakKnop').addEventListener('click', () => koppelMetQrTekst($('qrTekst').value));
    $('taakKnop').addEventListener('click', () => { voegTakenToe($('taakTekst').value); $('taakTekst').value = ''; });
    for (const s of ['live', 'wachtrij', 'koppel', 'prive']) $(`tab-${s}`).addEventListener('click', () => toonScherm(s));
    // De Live modus is het startscherm -- behalve als Veronica nog nergens mee gekoppeld is: dan meteen de QR (1.9.14).
    startPriveHoek();
    toonScherm(gekoppeld() ? 'live' : 'koppel');
    tekenKarakter();
    tekenNtfy();
    tekenVolLokaal();   // 483
    tekenSpraak();
    $('wandAutoKnop').textContent = `Wandstand vanzelf: ${Wand.auto ? 'aan' : 'uit'}`;
    $('wandAutoKnop').setAttribute('aria-pressed', String(Wand.auto));
    vraagWakker();
    tekenLive();
    vulVervang();
    meetRonde();
    // Elke 2 s met het scherm aan, elke 10 s als het verborgen is.
    let laatst = 0;
    setInterval(() => {
      const wacht = document.visibilityState === 'visible' ? 2000 : 10000;
      if (nu() - laatst >= wacht) { laatst = nu(); meetRonde(); vulVervang(); }
      // Automatisch de rij oproepen: elke tien minuten (en meteen als het wifi terug is).
      if (S.code && nu() - roepT > 10 * 60 * 1000) roepOp(false);
    }, 1000);
    zoekBlokStart();
    ledenStroom();   // 482: de ledenbrief van de baas (een verbinding; opnieuw na een fout, met wachten)
    setInterval(() => { ledenStroom(); }, 30000);
    setInterval(schermTik, 1000);
    setInterval(wandTik, 1000);
    setInterval(antwoordTik, 1000);
    // De begroeting: kort, met de stand (na de eerste meting).
    setTimeout(() => { const st = statusNu(); spreek(K.veronicaZin(S.karakter, 'begroeting', Object.assign({ naam: S.eigenaar, uur: new Date().getHours() }, st)), 'begroeting'); }, 4000);
    // VANZELF WEER VERBINDEN na een slaapstand of als het wifi terug is: alles staat in de opslag
    // van de browser (telefoons, code, wachtrij), dus ze hoeft alleen meteen weer te kijken.
    const weerWakker = () => {
      for (const m of Object.values(S.metingen)) m.jarvisNietTot = 0;
      rondT = 0;   // een ander netwerk: meteen rondvragen mag
      laatst = nu(); meetRonde(); vraagWakker();
    };
    window.addEventListener('online', () => { roepT = 0; weerWakker(); });
    window.addEventListener('pageshow', weerWakker);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') weerWakker(); });
    if ('serviceWorker' in navigator) zelfBijwerken();
  }
  function vulVervang() {
    const keus = $('vervangKeus');
    const voor = keus.value;
    keus.replaceChildren(el('option', '', 'Kies een onderdeel'), ...S.telefoons.map((t) => { const o = el('option', '', t.naam); o.value = t.adres; return o; }));
    keus.firstChild.value = '';
    keus.value = voor;
  }
  window.__veronica = { RekV, rekVanzelf, rekWerkerMaken, rekAan, OM, neemOntmoetOver, ontmoetLevend, doorgeefNaarId, roepViaPostbus, legRijBrief, NtfyGeefV, geefNtfy, MotorHerstelV, motorHerstelNodig, herstelMotor, roepNaarId, VastV, plakMail, tekenVast, geefPostbusViaBrievenbus, InstV, openInstel, stuurInstel, instelUitPaneel, HB, hartslagRegel, roepViaBrievenbus, hartslagVoorAdres, KastV, kastTik, kaartjeDagTik, KaartjeL, kaartjeGegevens, kaartjeVerboden, tekenKaartje, Zandbak, maakZandbak, zandbakKlaar, tekenNieuwKoppel, stuurNieuwKoppel, NkV, vraagZelftest, plakVersCode, neemPostbusVers, geefVersAdres, toonVersQr, SamenV, tekenSamenwerken, stuurVoorstelOordeel, motorKandidaten, motorAlleAan, VolL, zetVolLokaal, tekenVolLokaal, volLokaal, NaleesV, tekenNalees, stuurNaleesOordeel, NtfyV, tekenNtfy, ntfyEersteProef, neemNachtlogOver, tekenNachtlog, LB, ledenStroom, ledenRegel, tekenVerslag, tekenVerbruik, zoekBlokStart, zoekGeheugenNu: () => zoekGeheugen, zoekTelefoons, tekenZoekUitslag, HZ, herstelZoek, verwerkGevonden, VQ, herstelQr, zetStilSinds: (t) => { stilSinds = t; }, NulS, startNulmeting, nulmetingUitslag: (adres) => (S.nulmeting[adres] || {}).uitslag || null, motorVanuitVeronica, poolStaat, poolStaten, pantserStand, meetSnelheid, zetBureau, brugTaak, Kluis, UpdV, neemUpdateSleutelOver, tekenUpdatePlek, Spr, spreek, luister, verwerkSpraak, transcribeer, naarWav, statusNu, antwoordTik, tekenSpraak, Wand, zetWand, wandTik, roepOp, waarschuw, NtS, rondvragen, kernNu, meetKern, vraagWakker, wisselKarakter, S, K, meetRonde, werkTik, zetPantser, vervang, noodstop, voegTakenToe, koppelMetQrTekst, bewaarLijst, Opslag, tekenLive, testTelefoon, tekenTakenverdeling, takenTelefoons, leesTakenKeuzes };
  Object.defineProperty(window.__veronica, 'PriveUi', { get: () => PriveUi });   // 466: voor de test
  start();
}());
