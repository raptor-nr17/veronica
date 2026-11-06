// 642: DE SCHERMENWAND (Chrome-kant). De schermen van de rektelefoons live naast elkaar in Chrome, via de kabel --
// Tango/ya-webadb (WebUSB) + WebCodecs, per serienummer. Hergebruikt window.BesturenAdb (besturen-adb.js, MIT) en het
// scrcpy-servertje (Apache 2.0) naast de pagina. GEEN netwerk, GEEN externe site, GEEN tekstinvoer.
//
// Drie dingen die deze wand anders doet dan "Telefoon besturen" (besturen.html):
//  1. De F8 (de dagelijkse telefoon) mag je WEL ZIEN maar NOOIT BESTUREN -- een eigen "alleen kijken"-tegel, geen tikken,
//     geen Terug/Home/Apps. (besturen.html weigert de dagelijkse telefoon helemaal; de wand toont hem, kijken mag.)
//  2. Een NOODSTOP zet in een keer alle besturen stil (kijken blijft); daarna weer aan met een knop.
//  3. Een waakhond per tegel: loopt EEN beeld vast, dan herstart alleen DIE tegel, nooit de hele wand. Een beveiligd
//     scherm (DRM) toont scrcpy vanzelf zwart; dat is GEEN vastloper (de frames lopen door), dus wordt niet herstart.
//
// De F8 herkennen we aan de vingerafdruk van zijn serienummer in dezelfde "nooit"-lijst als besturen.html
// (veronica-besturen-nooit). Het serienummer zelf gaat nooit de opslag in.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.Schermwand = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- de zuivere kern (zonder DOM/WebUSB, zo los te toetsen) ---
  const GRACE_MS = 5000;   // na de start krijgt een tegel even de tijd om het eerste beeld te laten komen
  const STIL_MS = 6000;    // zo lang geen nieuw frame = vastgelopen -> die ene tegel herstarten
  const WAAK_MS = 2500;    // hoe vaak de waakhond kijkt
  const MAX_TEGELS = 8;    // meer dan dit naast elkaar heeft op een Chromebook geen zin

  // De F8 herkennen aan zijn naam -- dezelfde vaste regel als magScherm in veronica.js. Zo is de F8 ALTIJD alleen-kijken, ook als
  // zijn vingerafdruk (nog) niet in de nooit-lijst staat of zijn "dagelijks"-rol tijdelijk kwijt is (651: de F8 stond even als
  // gewone rektelefoon in Veronica). "F8" mag in Veronica-bestanden; een merknaam niet.
  function isF8Naam(naam) { return /(^|[^a-z])f8([^a-z]|$)/i.test(String(naam || '')); }
  // Een telefoon is "alleen kijken" als zijn vingerafdruk in de nooit-lijst staat (door de eigenaar gemarkeerd als dagelijkse
  // telefoon) OF als zijn naam hem als de F8 aanwijst OF (657) als hij op de bank-/kluis-lijst staat (ING, Revolut, Bybit,
  // Bitwarden, App-kluis: nooit besturen). Dan tonen we hem wel, maar sturen we er NOOIT iets heen.
  function kijkAlleen(vinger, nooitLijst, naam, bankKluisLijst) {
    if (isF8Naam(naam)) return true;
    if (!!vinger && Array.isArray(bankKluisLijst) && bankKluisLijst.includes(vinger)) return true;
    return !!vinger && Array.isArray(nooitLijst) && nooitLijst.includes(vinger);
  }

  // DE ENE poort voor besturen: alleen als het GEEN kijk-alleen-tegel is EN de noodstop niet aan staat.
  function magBesturen(tegel, noodstop) {
    return !noodstop && !!tegel && !tegel.kijkAlleen;
  }

  function nieuweBeeldStand(nu) { return { frames: 0, sinds: nu, start: nu }; }
  // Elk nieuw frame zet de klok terug; blijft het aantal staan, dan loopt de "stil"-tijd op.
  function werkBeeld(stand, frames, nu) {
    if (!stand) return stand;
    if (typeof frames === 'number' && frames > stand.frames) { stand.frames = frames; stand.sinds = nu; }
    return stand;
  }
  function moetHerstarten(stand, nu) {
    return !!stand && (nu - stand.start) > GRACE_MS && (nu - stand.sinds) > STIL_MS;
  }

  // Hoeveel kolommen voor n tegels (vierkant-achtig raster).
  function rasterKolommen(n) {
    if (n <= 1) return 1;
    if (n <= 4) return 2;
    if (n <= 9) return 3;
    return 4;
  }

  // Vingerafdruk van een serienummer (zelfde recept als besturen.js, zodat de twee schermen het eens zijn).
  async function vinger(serial) {
    const c = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
    if (!c) return '';
    const b = await c.digest('SHA-256', new TextEncoder().encode('veronica-besturen:' + serial));
    return Array.from(new Uint8Array(b).slice(0, 8), (x) => x.toString(16).padStart(2, '0')).join('');
  }

  // Een gewone zin met wat je kunt doen, nooit een foutcode (zelfde regel als besturen.js).
  function foutZin(e) {
    const t = String((e && (e.code || e.name)) || '') + ' ' + String((e && e.message) || '');
    if (/bezet|claimInterface|Unable to claim|busy/i.test(t)) return 'De telefoon is al in gebruik door een ander programma. Sluit dat, trek de kabel eruit en steek hem terug.';
    if (/NotFoundError|No device selected/i.test(t)) return 'Geen telefoon gekozen. Staat hij niet in het lijstje: is het een datakabel, en staat USB-foutopsporing aan?';
    if (/auth|AbortError|timeout/i.test(t)) return 'De telefoon heeft nog geen toestemming gegeven. Kijk op de telefoon en tik Toestaan, dan nog eens "Telefoon toevoegen".';
    if (/INJECT_EVENTS|SecurityException/i.test(t)) return 'Kijken lukt, tikken nog niet: zet op de telefoon "USB-foutopsporing (Beveiligingsinstellingen)" aan en herstart hem.';
    return 'Dat lukte niet. Trek de kabel eruit, steek hem terug en tik nog eens op "Telefoon toevoegen".';
  }

  const KERN = { GRACE_MS, STIL_MS, WAAK_MS, MAX_TEGELS, kijkAlleen, isF8Naam, magBesturen, nieuweBeeldStand, werkBeeld, moetHerstarten, rasterKolommen, vinger, foutZin };

  // --- de browser-kant (alleen op de wand-pagina; node ziet dit nooit) ---
  if (typeof document !== 'undefined') {
    const NOOIT = 'veronica-besturen-nooit';
    const nooitLijst = () => { try { return JSON.parse(localStorage.getItem(NOOIT) || '[]'); } catch (e) { return []; } };
    // 657: telefoons met een bank- of kluis-app (ING, Revolut, Bybit, Bitwarden, App-kluis) -- NOOIT besturen, ook niet na een ja.
    const BANKKLUIS = 'veronica-besturen-bankkluis';
    const bankKluisLijst = () => { try { return JSON.parse(localStorage.getItem(BANKKLUIS) || '[]'); } catch (e) { return []; } };
    const $ = (id) => document.getElementById(id);

    const S = { tegels: [], noodstop: false, waak: 0 };

    function begin() {
      const raster = $('swRaster');
      if (!raster) return;   // niet de wand-pagina
      const B = window.BesturenAdb;
      if (!B || !B.kan()) {
        if ($('swKanNiet')) { $('swKanNiet').textContent = 'Deze browser kan geen telefoon via USB openen. Gebruik Chrome op de Chromebook.'; $('swKanNiet').hidden = false; }
        if ($('swToevoegen')) $('swToevoegen').disabled = true;
      } else if (!B.beeldKan() && $('swKanNiet')) {
        $('swKanNiet').textContent = 'Deze browser kan het beeld van de telefoon niet tonen. Werk Chrome bij.'; $('swKanNiet').hidden = false;
      }
      if ($('swToevoegen')) $('swToevoegen').addEventListener('click', toevoegen);
      if ($('swNoodstop')) $('swNoodstop').addEventListener('click', () => zetNoodstop(true));
      if ($('swNoodstopUit')) $('swNoodstopUit').addEventListener('click', () => zetNoodstop(false));
      tekenKnoppen();
      if (navigator.usb) navigator.usb.addEventListener('disconnect', (ev) => {
        const t = S.tegels.find((x) => x.toestel && ev.device === x.toestel.raw);
        if (t) { melding(`De kabel van ${t.naam} is los. Steek hem terug en tik op "Telefoon toevoegen".`); stopTegel(t); }
      });
      S.waak = setInterval(waakhond, WAAK_MS);
    }

    function melding(t, slecht) { const m = $('swMelding'); if (!m) return; m.textContent = t || ''; m.classList.toggle('slecht', !!slecht); }
    function tekenKnoppen() {
      if ($('swNoodstop')) $('swNoodstop').hidden = !S.tegels.length || S.noodstop;
      if ($('swNoodstopUit')) $('swNoodstopUit').hidden = !S.noodstop;
      const raster = $('swRaster');
      if (raster) raster.style.setProperty('--kolommen', String(rasterKolommen(S.tegels.length || 1)));
    }

    function zetNoodstop(aan) {
      S.noodstop = !!aan;
      melding(aan ? 'Besturen gestopt. Kijken mag nog. Tik "Weer besturen" om verder te gaan.' : '');
      for (const t of S.tegels) werkTegelStand(t);
      tekenKnoppen();
    }

    const vind = (t, k) => t.el.querySelector(k);

    function nieuweTegel(naam, kijk) {
      const el = $('swTegelSjabloon').content.firstElementChild.cloneNode(true);
      vind({ el }, '.swNaam').textContent = naam || 'Telefoon';
      $('swRaster').appendChild(el);
      const t = { el, toestel: null, vinger: null, naam: naam || 'Telefoon', adb: null, sessie: null, beeldStand: null, kijkAlleen: !!kijk };
      S.tegels.push(t);
      vind(t, '.swLos').addEventListener('click', () => { stopTegel(t); melding('Gestopt. Je kunt die kabel eruit trekken.'); });
      vind(t, '.swHerstart').addEventListener('click', () => herstartTegel(t, true));
      const groot = vind(t, '.swGroot');
      if (groot) groot.addEventListener('click', () => t.el.classList.toggle('groot'));
      vind(t, '.swTerug').addEventListener('click', () => t.sessie && magBesturen(t, S.noodstop) && t.sessie.terug());
      vind(t, '.swThuis').addEventListener('click', () => t.sessie && magBesturen(t, S.noodstop) && t.sessie.thuis());
      vind(t, '.swApps').addEventListener('click', () => t.sessie && magBesturen(t, S.noodstop) && t.sessie.apps());
      koppelScherm(t);
      werkTegelStand(t);
      tekenKnoppen();
      return t;
    }

    // Toont per tegel of besturen mag (F8 of noodstop = alleen kijken).
    function werkTegelStand(t) {
      const kijk = t.kijkAlleen || S.noodstop;
      const badge = vind(t, '.swBadge'); if (badge) { badge.hidden = !kijk; badge.textContent = t.kijkAlleen ? 'alleen kijken' : 'besturen gestopt'; }
      const kn = vind(t, '.swKnoppen'); if (kn) kn.hidden = kijk;
      t.el.classList.toggle('kijk', kijk);
    }

    async function toevoegen() {
      melding('');
      const B = window.BesturenAdb;
      let toestel;
      try { toestel = await B.kies(); } catch (e) { melding(foutZin(e), true); return; }
      if (!toestel) { melding('Geen telefoon gekozen. Is het een datakabel, en staat USB-foutopsporing aan?', true); return; }
      if (S.tegels.some((x) => x.toestel && x.toestel.raw === toestel.raw)) { melding('Die telefoon staat er al. Kies een andere.', true); return; }
      if (S.tegels.length >= MAX_TEGELS) { melding('Er staan er al genoeg naast elkaar. Stop er eerst een.', true); return; }
      const v = await vinger(toestel.serial || '');
      const kijk = kijkAlleen(v, nooitLijst(), '', bankKluisLijst());
      const t = nieuweTegel('Verbinden...', kijk);
      t.toestel = toestel; t.vinger = v;
      try {
        t.adb = await B.verbind(toestel);
        const m = await B.model(t.adb);
        t.naam = m.naam || m.model || 'Een telefoon';
        // 651: nu de naam bekend is, nog eens beoordelen -- een F8 is ALTIJD alleen-kijken, ook als zijn vingerafdruk niet in de
        // nooit-lijst staat. De naam komt van de telefoon zelf (adb-model), niet van Veronica's rij.
        if (!t.kijkAlleen && kijkAlleen(t.vinger, nooitLijst(), t.naam, bankKluisLijst())) { t.kijkAlleen = true; werkTegelStand(t); }
        vind(t, '.swNaam').textContent = t.kijkAlleen ? `${t.naam} (alleen kijken)` : t.naam;
        await startBeeld(t);
      } catch (e) { melding(foutZin(e), true); await stopTegel(t); }
    }

    async function startBeeld(t) {
      const r = await fetch('scrcpy-server.bin');
      if (!r.ok || !r.body) throw new Error('server');
      const scherm = vind(t, '.swScherm'); scherm.hidden = false;
      t.sessie = await window.BesturenAdb.start(t.adb, r.body, scherm, { kijk: t.kijkAlleen });
      t.beeldStand = nieuweBeeldStand(Date.now());
      werkTegelStand(t);
    }

    async function herstartTegel(t, metZin) {
      if (!t.adb) return;
      if (metZin) melding(`${t.naam} opnieuw starten...`);
      try { if (t.sessie) await t.sessie.stop(); } catch (e) { /* al dicht */ }
      t.sessie = null;
      try { await startBeeld(t); if (metZin) melding(''); } catch (e) { melding(foutZin(e), true); }
    }

    async function stopTegel(t) {
      if (t.sessie) { try { await t.sessie.stop(); } catch (e) { /* al dicht */ } } else if (t.adb) { try { await t.adb.close(); } catch (e) { /* idem */ } }
      t.sessie = null; t.adb = null; t.toestel = null;
      t.el.remove();
      S.tegels = S.tegels.filter((x) => x !== t);
      tekenKnoppen();
    }

    // De waakhond: alleen een tegel waarvan het beeld echt is vastgelopen wordt herstart (frames staan stil, voorbij de
    // genadetijd). Een beveiligd/zwart scherm telt NIET als vastgelopen: scrcpy levert dan nog steeds frames.
    function waakhond() {
      const nu = Date.now();
      for (const t of S.tegels) {
        if (!t.sessie || !t.sessie.beeld || !t.beeldStand) continue;   // oude bundel zonder beeld(): geen auto-herstart
        let b; try { b = t.sessie.beeld(); } catch (e) { continue; }
        werkBeeld(t.beeldStand, b && b.frames, nu);
        if (moetHerstarten(t.beeldStand, nu)) { t.beeldStand = null; herstartTegel(t, false); }
      }
    }

    // Tik op een beeld -> een tik op DIE telefoon (alleen als besturen mag). object-fit: contain, dus reken op het echte beeld.
    function plek(ev, canvas) {
      const c = canvas, r = c.getBoundingClientRect();
      const bw = c.width || 1, bh = c.height || 1, s = Math.min(r.width / bw, r.height / bh);
      const w = bw * s, h = bh * s, x0 = r.left + (r.width - w) / 2, y0 = r.top + (r.height - h) / 2;
      return { x: Math.min(1, Math.max(0, (ev.clientX - x0) / w)), y: Math.min(1, Math.max(0, (ev.clientY - y0) / h)) };
    }
    function koppelScherm(t) {
      const c = vind(t, '.swScherm');
      let neer = false;
      c.addEventListener('pointerdown', (ev) => { if (!t.sessie || !magBesturen(t, S.noodstop)) return; neer = true; c.setPointerCapture(ev.pointerId); const p = plek(ev, c); t.sessie.neer(p.x, p.y).catch(() => {}); });
      c.addEventListener('pointermove', (ev) => { if (!t.sessie || !neer || !magBesturen(t, S.noodstop)) return; const p = plek(ev, c); t.sessie.schuif(p.x, p.y).catch(() => {}); });
      const los = (ev) => { if (!t.sessie || !neer) return; neer = false; if (!magBesturen(t, S.noodstop)) return; const p = plek(ev, c); t.sessie.op(p.x, p.y).catch(() => {}); };
      c.addEventListener('pointerup', los); c.addEventListener('pointercancel', los);
      c.addEventListener('contextmenu', (ev) => ev.preventDefault());
    }

    window.__schermwand = { S, plek, nieuweTegel, stopTegel, zetNoodstop, werkTegelStand, kern: KERN };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', begin); else begin();
  }

  return KERN;
}));
