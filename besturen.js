// 521: Telefoon besturen. Een rektelefoon aan de USB-kabel van deze computer: scherm zien en tikken,
// via WebUSB (ya-webadb/Tango, MIT, gebundeld in besturen-adb.js) en het scrcpy-servertje
// (Apache 2.0) naast deze pagina. Geen netwerk, geen externe site, geen tekstinvoer.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NOOIT = 'veronica-besturen-nooit';   // vingerafdrukken van telefoons die "dagelijks" zijn

  function zeg(t, slecht) { const m = $('bMelding'); m.textContent = t || ''; m.classList.toggle('slecht', !!slecht); }

  // Het serienummer gaat niet de opslag in, alleen een vingerafdruk ervan.
  async function vinger(s) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('veronica-besturen:' + s));
    return Array.from(new Uint8Array(b).slice(0, 8), (x) => x.toString(16).padStart(2, '0')).join('');
  }
  function nooitLijst() { try { return JSON.parse(localStorage.getItem(NOOIT) || '[]'); } catch (e) { return []; } }
  function zetNooit(l) { try { localStorage.setItem(NOOIT, JSON.stringify(l.slice(-20))); } catch (e) { /* geen opslag: dan vraagt hij het opnieuw */ } }

  // De foutzin is altijd een gewone zin met wat je kunt doen, nooit een foutcode.
  function foutZin(e) {
    const t = String((e && (e.code || e.name)) || '') + ' ' + String((e && e.message) || '');
    if (/bezet|claimInterface|Unable to claim|busy/i.test(t)) return 'De telefoon is al in gebruik door een ander programma (bijvoorbeeld Linux op deze computer of een ander tabblad). Sluit dat, trek de kabel eruit en steek hem terug.';
    if (/NotFoundError|No device selected/i.test(t)) return 'Geen telefoon gekozen. Staat de telefoon niet in het lijstje: is het een datakabel, en staat USB-foutopsporing aan?';
    if (/auth|AbortError|timeout/i.test(t)) return 'De telefoon heeft nog geen toestemming gegeven. Kijk op de telefoon en tik Toestaan, dan nog eens "Kies de telefoon".';
    if (/INJECT_EVENTS|SecurityException/i.test(t)) return 'Kijken lukt, tikken nog niet: zet op de telefoon "USB-foutopsporing (Beveiligingsinstellingen)" aan en herstart hem.';
    if (/SecurityError|Access denied/i.test(t)) return 'Chrome mag de telefoon niet openen. Trek de kabel eruit, steek hem terug en probeer opnieuw.';
    return 'Dat lukte niet. Trek de kabel eruit, steek hem terug en tik nog eens op "Kies de telefoon".';
  }

  // 540: MEER TELEFOONS TEGELIJK. Elke gekozen telefoon krijgt een eigen paneel (beeld, toetsen, stop) in het raster #bSchermen.
  // Elke sessie is los: een eigen verbinding, een eigen scrcpy-servertje, een eigen beeld. De bibliotheek houdt zelf niets vast.
  const S = { sessies: [] };   // [{ paneel, toestel, vinger, adb, sessie }]
  const vind = (paneel, k) => paneel.querySelector(k);

  function zegIn(sx, t, slecht) { const m = vind(sx.paneel, '.bZin'); m.textContent = t || ''; m.classList.toggle('slecht', !!slecht); }
  function tekenKnoppen() { $('bStop').hidden = !S.sessies.length; }

  function nieuwPaneel(naam) {
    const paneel = $('bPaneel').content.firstElementChild.cloneNode(true);
    vind(paneel, '.bNaam').textContent = naam || 'Telefoon';
    $('bSchermen').appendChild(paneel);
    const sx = { paneel, toestel: null, vinger: null, adb: null, sessie: null };
    S.sessies.push(sx);
    vind(paneel, '.bLos').addEventListener('click', () => { stopSessie(sx); zeg('Gestopt. Je kunt die kabel eruit trekken.'); });
    vind(paneel, '.bJa').addEventListener('click', () => ja(sx));
    vind(paneel, '.bNee').addEventListener('click', () => nee(sx));
    vind(paneel, '.bTerug').addEventListener('click', () => sx.sessie && sx.sessie.terug());
    vind(paneel, '.bThuis').addEventListener('click', () => sx.sessie && sx.sessie.thuis());
    vind(paneel, '.bApps').addEventListener('click', () => sx.sessie && sx.sessie.apps());
    koppelScherm(sx);
    tekenKnoppen();
    return sx;
  }

  async function stopSessie(sx) {
    if (sx.sessie) await sx.sessie.stop(); else if (sx.adb) { try { await sx.adb.close(); } catch (e) { /* al dicht */ } }
    sx.sessie = null; sx.adb = null; sx.toestel = null;
    sx.paneel.remove();
    S.sessies = S.sessies.filter((x) => x !== sx);
    tekenKnoppen();
  }
  async function stopAlles() { for (const sx of S.sessies.slice()) await stopSessie(sx); }

  async function kies() {
    zeg('');
    let t;
    try { t = await window.BesturenAdb.kies(); } catch (e) { zeg(foutZin(e), true); return; }
    if (!t) { zeg('Geen telefoon gekozen. Staat hij niet in het lijstje: is het een datakabel, en staat USB-foutopsporing aan?', true); return; }
    if (S.sessies.some((x) => x.toestel && x.toestel.raw === t.raw)) { zeg('Die telefoon staat er al naast. Kies een andere.', true); return; }
    const v = await vinger(t.serial || '');
    if (nooitLijst().includes(v)) { zeg('Dit is de dagelijkse telefoon. Die bestuur ik niet. Kies een rektelefoon.', true); return; }
    const sx = nieuwPaneel('Verbinden...');
    sx.toestel = t; sx.vinger = v;
    zegIn(sx, 'Kijk op deze telefoon en tik Toestaan als hij erom vraagt.');
    try {
      sx.adb = await window.BesturenAdb.verbind(t);
      const m = await window.BesturenAdb.model(sx.adb);
      const naam = m.naam || m.model || 'Een telefoon';
      vind(sx.paneel, '.bNaam').textContent = naam;
      zegIn(sx, '');
      vind(sx.paneel, '.bVraagZin').textContent = `${naam} (Android ${m.android || '?'}). Is dit een rektelefoon?`;
      vind(sx.paneel, '.bVraag').hidden = false;
    } catch (e) { zeg(foutZin(e), true); await stopSessie(sx); }
  }

  async function ja(sx) {
    vind(sx.paneel, '.bVraag').hidden = true;
    zegIn(sx, 'Het scherm komt eraan...');
    try {
      const r = await fetch('scrcpy-server.bin');
      if (!r.ok || !r.body) throw new Error('server');
      vind(sx.paneel, '.bScherm').hidden = false; vind(sx.paneel, '.bToetsen').hidden = false;
      sx.sessie = await window.BesturenAdb.start(sx.adb, r.body, vind(sx.paneel, '.bScherm'));
      zegIn(sx, '');
    } catch (e) { zeg(foutZin(e), true); await stopSessie(sx); }
  }

  async function nee(sx) {
    if (sx.vinger) { const l = nooitLijst(); if (!l.includes(sx.vinger)) l.push(sx.vinger); zetNooit(l); }
    zeg('Goed, die telefoon bestuur ik nooit. Trek de kabel eruit.');
    await stopSessie(sx);
  }

  // Muis of vinger op een beeld -> een tik op DIE telefoon, in verhouding tot het beeld.
  function plek(ev, canvas) {
    const c = canvas || document.querySelector('.bScherm'), r = c.getBoundingClientRect();
    // object-fit: contain: het beeld zelf kan smaller of lager zijn dan het vak.
    const bw = c.width || 1, bh = c.height || 1, s = Math.min(r.width / bw, r.height / bh);
    const w = bw * s, h = bh * s, x0 = r.left + (r.width - w) / 2, y0 = r.top + (r.height - h) / 2;
    return { x: Math.min(1, Math.max(0, (ev.clientX - x0) / w)), y: Math.min(1, Math.max(0, (ev.clientY - y0) / h)) };
  }
  function koppelScherm(sx) {
    const c = vind(sx.paneel, '.bScherm');
    let neer = false;
    c.addEventListener('pointerdown', (ev) => { if (!sx.sessie) return; neer = true; c.setPointerCapture(ev.pointerId); const p = plek(ev, c); sx.sessie.neer(p.x, p.y).catch((e) => zegIn(sx, foutZin(e), true)); });
    c.addEventListener('pointermove', (ev) => { if (!sx.sessie || !neer) return; const p = plek(ev, c); sx.sessie.schuif(p.x, p.y).catch(() => {}); });
    const los = (ev) => { if (!sx.sessie || !neer) return; neer = false; const p = plek(ev, c); sx.sessie.op(p.x, p.y).catch(() => {}); };
    c.addEventListener('pointerup', los); c.addEventListener('pointercancel', los);
    c.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  function soort(o) {
    $('bSoortH').setAttribute('aria-pressed', String(!o)); $('bSoortO').setAttribute('aria-pressed', String(!!o));
    $('bStappenH').hidden = !!o; $('bStappenO').hidden = !o;
  }

  function begin() {
    $('bSoortH').addEventListener('click', () => soort(false));
    $('bSoortO').addEventListener('click', () => soort(true));
    $('bKies').addEventListener('click', kies);
    $('bStop').addEventListener('click', () => { stopAlles(); zeg('Gestopt. Je kunt de kabels eruit trekken.'); });
    const B = window.BesturenAdb;
    if (!B || !B.kan()) {
      $('bKanNiet').textContent = 'Deze browser kan geen telefoon via USB openen. Gebruik Chrome op de Chromebook (geen Linux nodig).';
      $('bKanNiet').hidden = false; $('bKies').disabled = true;
    } else if (!B.beeldKan()) {
      $('bKanNiet').textContent = 'Deze browser kan het beeld van de telefoon niet tonen. Werk Chrome bij.';
      $('bKanNiet').hidden = false;
    }
    if (navigator.usb) navigator.usb.addEventListener('disconnect', (ev) => {
      const sx = S.sessies.find((x) => x.toestel && ev.device === x.toestel.raw);
      if (sx) { const naam = vind(sx.paneel, '.bNaam').textContent; stopSessie(sx); zeg(`De kabel van ${naam} is los. Steek hem terug en tik op "Kies een telefoon".`); }
    });
  }
  window.__besturen = { foutZin, vinger, plek, S, nieuwPaneel, stopSessie };
  begin();
})();
