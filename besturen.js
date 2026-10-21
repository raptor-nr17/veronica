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

  const S = { adb: null, sessie: null, toestel: null, vinger: null };

  async function stop() {
    if (S.sessie) await S.sessie.stop(); else if (S.adb) { try { await S.adb.close(); } catch (e) { /* al dicht */ } }
    S.sessie = null; S.adb = null; S.toestel = null;
    $('bWerk').hidden = true; $('bVraag').hidden = true; $('bStop').hidden = true; $('bKies').hidden = false;
  }

  async function kies() {
    zeg('');
    try {
      const t = await window.BesturenAdb.kies();
      if (!t) { zeg('Geen telefoon gekozen. Staat hij niet in het lijstje: is het een datakabel, en staat USB-foutopsporing aan?', true); return; }
      zeg('Verbinden... kijk op de telefoon en tik Toestaan als hij erom vraagt.');
      S.toestel = t;
      S.vinger = await vinger(t.serial || '');
      if (nooitLijst().includes(S.vinger)) { zeg('Dit is de dagelijkse telefoon. Die bestuur ik niet. Kies een rektelefoon.', true); S.toestel = null; return; }
      S.adb = await window.BesturenAdb.verbind(t);
      const m = await window.BesturenAdb.model(S.adb);
      zeg('');
      $('bVraagZin').textContent = `Verbonden met ${m.naam || m.model || 'een telefoon'} (Android ${m.android || '?'}). Is dit een rektelefoon?`;
      $('bVraag').hidden = false; $('bKies').hidden = true; $('bStop').hidden = false;
    } catch (e) { zeg(foutZin(e), true); await stop(); }
  }

  async function ja() {
    $('bVraag').hidden = true;
    zeg('Het scherm komt eraan...');
    try {
      const r = await fetch('scrcpy-server.bin');
      if (!r.ok || !r.body) throw new Error('server');
      $('bWerk').hidden = false;
      S.sessie = await window.BesturenAdb.start(S.adb, r.body, $('bScherm'));
      zeg('');
    } catch (e) { zeg(foutZin(e), true); await stop(); }
  }

  async function nee() {
    if (S.vinger) { const l = nooitLijst(); if (!l.includes(S.vinger)) l.push(S.vinger); zetNooit(l); }
    zeg('Goed, deze telefoon bestuur ik nooit. Trek de kabel eruit.');
    await stop();
  }

  // Muis of vinger op het beeld -> een tik op de telefoon, in verhouding tot het beeld.
  function plek(ev) {
    const c = $('bScherm'), r = c.getBoundingClientRect();
    // object-fit: contain: het beeld zelf kan smaller of lager zijn dan het vak.
    const bw = c.width || 1, bh = c.height || 1, s = Math.min(r.width / bw, r.height / bh);
    const w = bw * s, h = bh * s, x0 = r.left + (r.width - w) / 2, y0 = r.top + (r.height - h) / 2;
    return { x: Math.min(1, Math.max(0, (ev.clientX - x0) / w)), y: Math.min(1, Math.max(0, (ev.clientY - y0) / h)) };
  }
  let neer = false;
  function koppelScherm() {
    const c = $('bScherm');
    c.addEventListener('pointerdown', (ev) => { if (!S.sessie) return; neer = true; c.setPointerCapture(ev.pointerId); const p = plek(ev); S.sessie.neer(p.x, p.y).catch((e) => zeg(foutZin(e), true)); });
    c.addEventListener('pointermove', (ev) => { if (!S.sessie || !neer) return; const p = plek(ev); S.sessie.schuif(p.x, p.y).catch(() => {}); });
    const los = (ev) => { if (!S.sessie || !neer) return; neer = false; const p = plek(ev); S.sessie.op(p.x, p.y).catch(() => {}); };
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
    $('bStop').addEventListener('click', () => { stop(); zeg('Gestopt. Je kunt de kabel eruit trekken.'); });
    $('bJa').addEventListener('click', ja);
    $('bNee').addEventListener('click', nee);
    $('bTerug').addEventListener('click', () => S.sessie && S.sessie.terug());
    $('bThuis').addEventListener('click', () => S.sessie && S.sessie.thuis());
    $('bApps').addEventListener('click', () => S.sessie && S.sessie.apps());
    koppelScherm();
    const B = window.BesturenAdb;
    if (!B || !B.kan()) {
      $('bKanNiet').textContent = 'Deze browser kan geen telefoon via USB openen. Gebruik Chrome op de Chromebook (geen Linux nodig).';
      $('bKanNiet').hidden = false; $('bKies').disabled = true;
    } else if (!B.beeldKan()) {
      $('bKanNiet').textContent = 'Deze browser kan het beeld van de telefoon niet tonen. Werk Chrome bij.';
      $('bKanNiet').hidden = false;
    }
    if (navigator.usb) navigator.usb.addEventListener('disconnect', (ev) => { if (S.toestel && ev.device === S.toestel.raw) { stop(); zeg('De kabel is los. Steek hem terug en tik op "Kies de telefoon".'); } });
  }
  window.__besturen = { foutZin, vinger, plek, S };
  begin();
})();
