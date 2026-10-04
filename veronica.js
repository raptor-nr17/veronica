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
    kernActiviteit: {},     // naam -> { tekst, label, t } (uit stand.json van de hoofdtelefoon)
    zonStroom: null,        // { rijen, staaf } (uit stand.json; Veronica rekent de zon niet zelf)
    karakter: 'hulpdienst', // haar karakter (kern.js: veronicaZin); 'zakelijk' = zonder
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
    if (adres === S.kern) S.kernGezien = nu();
    if (adres === S.kern && S.actieveKern && S.actieveKern !== S.kern) logRegel(K.veronicaZin(S.karakter, 'kernTerug'));
    else if (via && S.actieveKern !== adres) logRegel(K.veronicaZin(S.karakter, 'volgt', { naam: via }) || `Baas nu: ${via}.`);
    S.actieveKern = adres;
    const act = {};
    for (const a of Array.isArray(d.activiteit) ? d.activiteit : []) {
      if (a && a.telefoon && !a.klaar) act[a.telefoon] = { tekst: String(a.tekst || ''), label: String(a.label || ''), t: nu() };
    }
    S.kernActiviteit = act;
    const zs = K.leesZonStroom(d.zonStroom, nu());
    if (zs) S.zonStroom = zs;
  }
  // RONDVRAGEN (na een netwerkwissel, of als de hoofdtelefoon en de baas zwijgen): elk adres dat
  // ze kent, tot er iemand antwoordt. Die geeft (met de code) de lijst van nu: telefoons, leden en
  // hun adressen. Hoogstens eens per vijftien seconden, vier tegelijk.
  let rondT = 0;
  let stilSinds = nu();
  async function rondvragen(dwing) {
    if (!S.code || (!dwing && nu() - rondT < 15000)) return;
    rondT = nu();
    const lijst = K.rondvraagLijst(S);
    let gevonden = null;
    for (let i = 0; i < lijst.length && !gevonden; i += 4) {
      const uit = await Promise.all(lijst.slice(i, i + 4).map(async (a) => {
        try { const r = await haal(`${a}/jarvis/vertrouwd`, { headers: { 'X-Koppelcode': S.code } }, 2000); return r.ok ? { a, d: await r.json() } : null; } catch (e) { return null; }
      }));
      gevonden = uit.find(Boolean) || null;
    }
    const v = $('vindUitleg');
    if (!gevonden) {
      const u = K.vindUitleg({ gekoppeld: !!S.code, bereikbaar: 0, stilMs: nu() - stilSinds, geprobeerd: lijst.length });
      if (v) { v.textContent = u; v.hidden = !u; }
      return;
    }
    stilSinds = nu();
    if (v) v.hidden = true;
    const l = K.leesVertrouwd(gevonden.d);
    if (l.telefoons.length) {
      S.telefoons = l.telefoons;
      await Opslag.schrijf('telefoons', S.telefoons);
      // De hoofdtelefoon kan een nieuw adres hebben (een hotspot kiest vaak een ander subnet).
      const kern = l.telefoons.find((t) => t.kern);
      if (kern && kern.jarvis !== S.kern) { S.kern = kern.jarvis; await Opslag.schrijf('kern', S.kern); }
    }
    S.bekend = K.voegBekendToe(S.bekend, [gevonden.a].concat(l.bekend, l.kern ? [l.kern] : []));
    await Opslag.schrijf('bekend', S.bekend);
    if (l.ntfy) { S.ntfy = l.ntfy; await Opslag.schrijf('ntfy', S.ntfy); }
    if (S.actieveKern !== gevonden.a) logRegel(`Gevonden via ${gevonden.a.slice(7)}. Ik kijk weer mee.`);
    S.actieveKern = gevonden.a;
    vulVervang();
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
      await lnaTik();
      karakterTik();
      tekenLive();
      werkTik();
    } finally { meetBezig = false; }
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
    const u = K.lnaUitleg({ toestemming: lnaToestemming, online: navigator.onLine !== false, aantal: S.telefoons.length, bereikbaar, stilMs: nu() - laatstBereikt });
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
  function tekenNtfy() {
    const v = $('ntfyStand');
    if (!v) return;
    const n = S.ntfy;
    v.textContent = !n ? 'Waarschuwingen naar je telefoon: nog niet ingesteld (dat doe je op de hoofdtelefoon, Beheer).'
      : `Waarschuwingen naar je telefoon: ${n.aan ? 'aan' : 'uit'}. Stille uren: ${n.stil === 'uit' ? 'geen' : n.stil}. Thuis gaat het via de hoofdtelefoon zelf.`;
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
    const ja = new Set();
    const nee = new Set();
    for (let i = 0; i < lijst.length; i += 4) {
      await Promise.all(lijst.slice(i, i + 4).map(async (a) => {
        try {
          const r = await haal(`${a}/jarvis/roep`, { method: 'POST', headers: { 'X-Koppelcode': S.code }, body: JSON.stringify({ soort: 'roep', van: 'veronica' }) }, 2500);
          if (!r.ok) { nee.add(naamVan(a)); return; }
          ja.add(naamVan(a));
          const v = await haal(`${a}/jarvis/vertrouwd`, { headers: { 'X-Koppelcode': S.code } }, 2500);
          if (v.ok) {
            const l = K.leesVertrouwd(await v.json());
            S.bekend = K.voegBekendToe(S.bekend, [a].concat(l.bekend));
            if (l.ntfy) S.ntfy = l.ntfy;
          }
        } catch (e) { nee.add(naamVan(a)); }
      }));
    }
    for (const n of ja) nee.delete(n);
    await Opslag.schrijf('bekend', S.bekend);
    if (S.ntfy) await Opslag.schrijf('ntfy', S.ntfy);
    const zin = `Rij opgeroepen: ${ja.size} ${ja.size === 1 ? 'meldde zich' : 'meldden zich'}${nee.size ? `; geen antwoord van ${[...nee].slice(0, 5).join(', ')}` : ''}.`;
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
    const t = K.kiesTelefoon(S.telefoons, S.staten, nu());
    if (t && navigator.mediaDevices && window.MediaRecorder) {
      const tekst = await luisterViaGemma(t);
      if (tekst !== null) return verwerkSpraak(tekst, 'Gemma');
    }
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
    morphKinderen($('vSamen'), [
      tegel('📱', String(S.telefoons.length), `telefoons · ${bereik} bereikbaar`, 'telefoons'),
      tegel('⚡', snel.length ? String(Math.round(snel.reduce((a, x) => a + x.d.snelheid.waarde, 0) * 10) / 10).replace('.', ',') : 'geen meting', 'tokens/s samen', 'snelheid'),
      tegel('🌡️', warm ? `${String(Math.round(warm.d.temperatuur.waarde * 10) / 10).replace('.', ',')} °C` : 'geen meting', warm ? `warmste: ${warm.t.naam}` : 'warmste telefoon', 'warmste'),
      tegel('🔌', stek.length ? stek.map((x) => (x.aan === true ? 'aan' : x.aan === false ? 'uit' : '?')).join(' · ') : 'geen', stek.length ? stek.map((x) => x.naam).join(' · ') : 'geen stekker', 'stekkers'),
      tegel('☀️', !z ? 'onbekend' : z.geen ? 'geen zon' : z.open ? 'open' : 'dicht', !z || z.geen ? 'zonvenster' : z.open ? `zonvenster · nog ${duur(z.nogMs || 0)}` : (z.totOpenMs ? `zonvenster · opent over ${duur(z.totOpenMs)}` : 'zonvenster'), 'zon'),
    ]);
  }
  function tekenLive() {
    const vak = $('tegels');
    $('leeg').hidden = S.telefoons.length > 0;
    const n = S.telefoons.filter((t) => staat(t.adres).bereikbaar && !staat(t.adres).vervangen).length;
    $('pantserZin').textContent = `${S.aan ? 'Pantser aan' : 'Pantser uit'} · ${n} van ${S.telefoons.length} bereikbaar · wachtrij ${S.taken.filter((x) => x.status === 'wacht').length}`;
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
      kopRij.append(el('h2', '', t.naam), el('span', 'tAdres', t.adres.replace('http://', '')));
      tegel.appendChild(kopRij);
      tegel.appendChild(el('div', 'tRol', K.rolZin(t, m.status, tijd)));
      tegel.appendChild(meterRij(t, m, s, tijd));
      const bereik = s.vervangen ? 'vervangen: krijgt geen werk' : s.bereikbaar && !oud ? 'bereikbaar' : `${s.bereikbaar ? '' : 'geen antwoord · '}${oud}`;
      tegel.appendChild(el('div', `tBereik${s.bereikbaar && !oud ? '' : ' oud'}`, bereik));
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
      kb.dataset.actie = 'scherm';
      knoppen.appendChild(kb);
      if (s.vervangen) { const w = el('button', 'klein-knop', 'Weer erbij'); w.dataset.actie = 'weer'; knoppen.appendChild(w); }
      tegel.appendChild(knoppen);
      if (sch.aan) {
        const img = el('img', 'tScherm');
        img.alt = `Scherm van ${t.naam}`;
        if (sch.url) img.src = sch.url;
        tegel.appendChild(img);
        tegel.appendChild(el('div', 'tBron', sch.zin || ''));
      }
      return tegel;
    })));
    // De stekkers (alleen lezen): aan/uit, watt en kWh, elk met bron en leeftijd.
    metScroll(() => morphKinderen($('stekkerTegels'), S.stekkers.map((k) => {
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
    })));
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
  const Bijwerk = { wacht: false };
  function herlaadAlsRustig() {
    if (S.stromen.size === 0) { location.reload(); return; }
    Bijwerk.wacht = true;
    logRegel('Er staat een nieuwe Veronica klaar. Ik herlaad zodra het lopende werk klaar is.');
  }
  function zelfBijwerken() {
    let eerder = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      const kijk = () => { try { reg.update(); } catch (e) { /* offline: later */ } };
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
    morphKinderen(lijst, S.taken.slice().reverse().slice(0, 50).map((x) => {
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

  // ---- Koppelen: de vertrouwde lijst EEN keer overnemen van de hoofdtelefoon ----
  async function bewaarLijst(l) {
    S.telefoons = l.telefoons;
    S.stekkers = l.stekkers || [];
    await Opslag.schrijf('stekkers', S.stekkers);
    if (l.kern) S.kern = l.kern;
    if (l.code) S.code = l.code;
    S.bekend = K.voegBekendToe(S.bekend, [l.kern].concat(l.alt || [], l.bekend || [], l.telefoons.map((t) => t.jarvis)));
    await Opslag.schrijf('bekend', S.bekend);
    if (l.ntfy) { S.ntfy = l.ntfy; await Opslag.schrijf('ntfy', S.ntfy); tekenNtfy(); }
    if (l.eigenaar && !S.eigenaarZelf) { S.eigenaar = l.eigenaar; await Opslag.schrijf('eigenaar', S.eigenaar); }
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
    let l = K.leesQr(tekst);
    if (l && l.token) l = await koppelMetToken(l);
    if (!l || !l.telefoons.length) { if (!$('koppelMelding').textContent || /Even/.test($('koppelMelding').textContent)) $('koppelMelding').textContent = 'Dat is geen QR van JARVIS voor Veronica.'; return false; }
    await bewaarLijst(l);
    $('koppelMelding').textContent = `Klaar: ${l.telefoons.length} ${l.telefoons.length === 1 ? 'telefoon' : 'telefoons'}.`;
    toonScherm('live');
    return true;
  }
  // Het eenmalige token uit de QR terugsturen; dan komen de code en de lijst EEN keer mee.
  async function koppelMetToken(q) {
    const vak = $('koppelMelding');
    vak.textContent = 'Even…';
    // Eerst het adres uit de QR, dan de andere adressen erin (hetzelfde toestel op het andere netwerk).
    for (const adres of [q.kern].concat(q.alt || [])) {
      try {
        const r = await haal(`${adres}/jarvis/koppel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: q.token, ik: { soort: 'veronica' } }) }, 5000);
        if (r.status === 403 || r.status === 429) { vak.textContent = 'Deze QR is verlopen of al gebruikt. Laat JARVIS een nieuwe tonen.'; return null; }
        if (!r.ok) { vak.textContent = `De hoofdtelefoon gaf ${r.status}.`; return null; }
        const l = K.leesPakket(await r.json());
        if (!l) { vak.textContent = 'Het antwoord klopt niet.'; return null; }
        l.kern = adres;
        l.alt = (q.alt || []).concat(q.kern);
        return l;
      } catch (e) { /* dit adres niet: het volgende */ }
    }
    vak.textContent = 'Geen antwoord van de hoofdtelefoon. Zelfde netwerk, en toegang tot het lokale netwerk?';
    return null;
  }
  // VERONICA LAAT EEN QR ZIEN voor een nieuwe telefoon: eenmalig, vijf minuten. Daarvoor vraagt
  // ze met de code een token bij de hoofdtelefoon; de code zelf staat NIET in de QR.
  let qrKlok = null;
  async function toonNieuweTelefoonQr() {
    const vak = $('nieuwQrBeeld');
    $('nieuwQrPaneel').hidden = false;
    vak.textContent = 'Even…';
    $('nieuwQrTijd').textContent = '';
    if (!S.kern || !S.code) { vak.textContent = 'Koppel Veronica eerst met de hoofdtelefoon (Koppelen).'; return; }
    let t = null;
    try {
      const r = await haal(`${kernNu()}/jarvis/koppeltoken`, { method: 'POST', headers: { 'X-Koppelcode': S.code } }, 4000);
      if (r.ok) t = (await r.json()).t;
    } catch (e) { t = null; }
    const tekst = K.koppelQrTekst(kernNu(), t);
    if (!tekst || typeof window.qrcode !== 'function') { vak.textContent = 'Nu geen QR: de hoofdtelefoon antwoordt niet.'; return; }
    const q = window.qrcode(0, 'M');
    q.addData(tekst);
    q.make();
    vak.innerHTML = q.createSvgTag(8, 16);   // alleen uit de QR-bibliotheek: vierkantjes, geen tekst van buiten
    const tot = nu() + 5 * 60 * 1000;
    clearInterval(qrKlok);
    const zet = () => {
      const rest = Math.max(0, Math.ceil((tot - nu()) / 1000));
      $('nieuwQrTijd').textContent = rest > 0 ? `Nog ${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')} geldig. Werkt een keer.` : 'Verlopen. Tik nog eens voor een nieuwe.';
      if (!rest) { vak.replaceChildren(); clearInterval(qrKlok); }
    };
    zet();
    qrKlok = setInterval(zet, 1000);
    logRegel('QR voor een nieuwe telefoon getoond (vijf minuten, een keer).');
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
      S.bekend = (await Opslag.lees('bekend')) || [];
      S.ntfy = K.leesNtfy(await Opslag.lees('ntfy'));
      Wand.auto = (await Opslag.lees('wandAuto')) !== false;
      S.spraak = Object.assign(S.spraak, (await Opslag.lees('spraak')) || {});
      S.eigenaar = K.leesEigenaar(await Opslag.lees('eigenaar'));
      S.eigenaarZelf = (await Opslag.lees('eigenaarZelf')) === true;
      S.karakter = (await Opslag.lees('karakter')) === 'zakelijk' ? 'zakelijk' : 'hulpdienst';
      S.wilWakker = (await Opslag.lees('wakker')) === true;
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
    $('ntfyProef').addEventListener('click', async () => {
      const r = await waarschuw('proef', K.veronicaZin('hulpdienst', 'proef'));
      logRegel(r.gestuurd ? 'Proefmelding verstuurd. Kijk op je telefoon.' : `Proefmelding niet verstuurd: ${r.reden}.`);
    });
    $('nieuwQrKnop').addEventListener('click', toonNieuweTelefoonQr);
    $('nieuwQrSluit').addEventListener('click', () => { $('nieuwQrPaneel').hidden = true; clearInterval(qrKlok); $('nieuwQrBeeld').replaceChildren(); });
    $('qrPlakKnop').addEventListener('click', () => koppelMetQrTekst($('qrTekst').value));
    $('taakKnop').addEventListener('click', () => { voegTakenToe($('taakTekst').value); $('taakTekst').value = ''; });
    for (const s of ['live', 'wachtrij', 'koppel']) $(`tab-${s}`).addEventListener('click', () => toonScherm(s));
    toonScherm('live');   // de Live modus is altijd het startscherm
    tekenKarakter();
    tekenNtfy();
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
  window.__veronica = { Spr, spreek, luister, verwerkSpraak, transcribeer, naarWav, statusNu, antwoordTik, tekenSpraak, Wand, zetWand, wandTik, roepOp, waarschuw, NtS, rondvragen, kernNu, meetKern, vraagWakker, wisselKarakter, S, K, meetRonde, werkTik, zetPantser, vervang, noodstop, voegTakenToe, koppelMetQrTekst, bewaarLijst, Opslag, tekenLive };
  start();
}());
