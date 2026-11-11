// 678 (schermenwand in de privé-hoek, 9 nov): de NETWERK-kant van de schermenwand -- de schermen van de rektelefoons live naast
// elkaar via Tailscale/relay (NIET via localhost), met tik/veeg/Terug/Home/Apps, Groot en typvak. Dit is de TEGENHANGER van de
// kabel-wand `schermwand.js` (WebUSB/WebCodecs): daar is scrcpy de bron, hier een PERIODIEKE SCREENCAP over https (JPEG, elke
// ~800 ms per tegel). Bewust trager-maar-stabiel: GEEN videodecoder die bevriest (de freeze van 9 nov), en de tik-latency is
// één poll. De tik-mapping en de waakhond en de F8/bank-kluis-poort hergebruiken we LETTERLIJK uit `Schermwand` (de KERN) --
// geen tweede, afwijkende mapping (dat was de tik-drift in het grote scherm; §105 "één bron").
//
// DE §565-POORT ZIT AAN DE JARVIS-KANT: `GET /jarvis/scherm` geeft een grijs "afgeschermd"-beeld i.p.v. een foto zodra de F8, of
// een bank-/kluis-/betaal-/persoonlijke app op de voorgrond staat; `POST /jarvis/tik` weigert dan. Hier aan de Veronica-kant
// zeven we daarnaast nooit de F8 (kijkAlleen) en doen we nooit een tik op een kijk-alleen-tegel of bij de noodstop.
//
// LET OP -- MIXED CONTENT: een https-Veronica mag GEEN `http://100.x:8080` ophalen (de browser blokkeert mixed content). Daarom
// kan dit live-inline alleen vanaf (a) een http-origin (de ARTEMIS-console op de Chromebook), of (b) via een https-RELAY die de
// screencap doorgeeft (JARVIS -> relay -> browser). `kanLive(origin, base)` zegt of een directe fetch mag; is het niet zo, dan
// blijft de kabel-wand (`schermwand.html`) of de ARTEMIS-console de weg. Zie docs/privehoek-schermenwand.md.
//
// Afspraak: "F8" mag in Veronica-bestanden; een merknaam/persoonsnaam niet.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek(require('./schermwand.js'));
  else wortel.Schermenwand = fabriek(wortel.Schermwand);
}(typeof self !== 'undefined' ? self : this, function (Schermwand) {
  'use strict';

  const KERN = Schermwand || {};               // de gedeelde kern (kijkAlleen/magBesturen/waakhond/rasterKolommen/plek)
  const POLL_MS = 800;                          // periodieke screencap per tegel (trager-maar-stabiel; geen videostream)
  const JARVIS_POORT = 8080;                    // JarvisWebServer serveert /jarvis/scherm en /jarvis/tik hier

  // isLokaal(host): localhost/127.x/penguin.linux.test/::1 -- NOOIT de weg voor de netwerk-wand (afspraak 9 nov).
  function isLokaal(host) {
    let h = String(host || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (h === '::1' || h === '[::1]') return true;
    h = h.replace(/:\d+$/, '');   // alleen een :poort eraf (niet de dubbele punten van IPv6 slopen)
    return h === 'localhost' || h === 'penguin.linux.test' || /^127\./.test(h) || /^0+\.0+\.0+\.0+$/.test(h);
  }
  // isTailscale(ip): een adres in het tailnet-bereik (in de praktijk een 100.x-adres).
  function isTailscale(ip) { return /^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(ip || '').trim()); }

  // basis(telefoon, relayBasis): het adres van JARVIS' screencap/tik-endpoints. Tailscale 100.x EERST (direct, vast adres), dan
  // de relay-basis (een https-relay die de screencap doorgeeft), NOOIT localhost. null = geen bruikbaar adres (toon dan niet live).
  //  telefoon: { tailscale?|ts?: '100.x', wifi?|ip?: '192.168.x' (alleen gebruikt als het geen localhost is) }
  function basis(telefoon, relayBasis) {
    const t = telefoon && typeof telefoon === 'object' ? telefoon : {};
    const ts = String(t.tailscale || t.ts || '').trim();
    if (isTailscale(ts)) return 'http://' + ts + ':' + JARVIS_POORT;
    const r = String(relayBasis || t.relay || '').trim().replace(/\/+$/, '');
    if (r && !isLokaal(r)) return r;
    const w = String(t.wifi || t.ip || '').trim();   // een LAN-wifi-adres mag (direct), maar nooit localhost
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(w) && !isLokaal(w)) return 'http://' + w + ':' + JARVIS_POORT;
    return null;
  }

  // kanLive(paginaOrigin, base): mag deze pagina de screencap echt direct ophalen? Een https-pagina mag geen http-base ophalen
  // (mixed content). Een relay-base op https mag altijd. Zo weet de mount of hij live gaat of terugvalt op de kabel/console.
  function kanLive(paginaOrigin, base) {
    if (!base) return false;
    const o = String(paginaOrigin || '').toLowerCase();
    const httpsPagina = /^https:/.test(o);
    const httpsBase = /^https:/.test(String(base));
    if (httpsPagina && !httpsBase) return false;   // mixed content: geblokkeerd door de browser
    return true;
  }

  function schermUrl(base) { return String(base || '').replace(/\/+$/, '') + '/jarvis/scherm'; }
  function tikUrl(base) { return String(base || '').replace(/\/+$/, '') + '/jarvis/tik'; }
  // 678: de screencap via de HTTPS-RELAY (JARVIS pusht hem daar, Veronica haalt het laatste frame). Zo kan een https-Veronica
  // tóch live (geen mixed content). Het frame is base64 van de VERSLEUTELDE JPEG -- Veronica ontsleutelt met de rij-sleutel.
  function schermUrlRelay(relayBasis, onderwerp) { return String(relayBasis || '').replace(/\/+$/, '') + '/scherm/' + String(onderwerp || ''); }

  // bronnen(telefoon, relayBasis): de mogelijke screencap-bronnen, op VOLGORDE van voorkeur: direct Tailscale 100.x, dan de
  //  https-relay (als er een schermOnderwerp is), dan een direct LAN-wifi-adres. Nooit localhost. Elk: { basis, soort, onderwerp }.
  function bronnen(telefoon, relayBasis) {
    const t = telefoon && typeof telefoon === 'object' ? telefoon : {};
    const uit = [];
    const ts = String(t.tailscale || t.ts || '').trim();
    if (isTailscale(ts)) uit.push({ basis: 'http://' + ts + ':' + JARVIS_POORT, soort: 'direct', onderwerp: null });
    const r = String(relayBasis || t.relay || '').trim().replace(/\/+$/, '');
    const onderwerp = String(t.schermOnderwerp || '').trim();
    if (r && !isLokaal(r) && /^[-_A-Za-z0-9]{1,64}$/.test(onderwerp)) uit.push({ basis: r, soort: 'relay', onderwerp: onderwerp });
    const w = String(t.wifi || t.ip || '').trim();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(w) && !isLokaal(w)) uit.push({ basis: 'http://' + w + ':' + JARVIS_POORT, soort: 'direct', onderwerp: null });
    return uit;
  }
  // kiesBron(telefoon, relayBasis, origin): de EERSTE bron die live mag vanaf deze pagina-origin (mixed-content-regel). null = geen.
  //  Vanaf een https-Veronica valt de directe http-100.x af en wint de https-relay vanzelf.
  function kiesBron(telefoon, relayBasis, origin) {
    for (const b of bronnen(telefoon, relayBasis)) if (kanLive(origin, b.basis)) return b;
    return null;
  }

  // tikFractie(rect, bw, bh, clientX, clientY): dezelfde object-fit:contain-rekenwijze als KERN.plek, maar PUUR (met een rect i.p.v.
  // een canvas), zodat het grote scherm EXACT dezelfde mapping gebruikt -- de fix voor de tik-drift bij "Groot". Fractie 0..1.
  function tikFractie(rect, bw, bh, clientX, clientY) {
    const r = rect || {}; const W = r.width || 1, H = r.height || 1;
    const w0 = bw || 1, h0 = bh || 1, s = Math.min(W / w0, H / h0);
    const w = w0 * s, h = h0 * s, x0 = (r.left || 0) + (W - w) / 2, y0 = (r.top || 0) + (H - h) / 2;
    return { x: Math.min(1, Math.max(0, (clientX - x0) / w)), y: Math.min(1, Math.max(0, (clientY - y0) / h)) };
  }

  // tikPayload(soort, a, b): het lichaam voor POST /jarvis/tik. soort: 'tik'|'veeg'|'terug'|'home'|'apps'|'text'. Fracties 0..1
  //  (tik: x,y | veeg: {x,y}->{x,y}). text: {soort:'text', tekst}. De JARVIS-kant rekent fractie*breedte naar input tap.
  function tikPayload(soort, a, b) {
    switch (soort) {
      case 'tik': return { soort: 'tik', x: a, y: b };
      case 'veeg': return { soort: 'veeg', van: { x: a.x, y: a.y }, naar: { x: b.x, y: b.y } };
      case 'terug': case 'home': case 'apps': return { soort: 'toets', toets: soort };
      case 'text': return { soort: 'text', tekst: String(a == null ? '' : a) };
      default: return null;
    }
  }

  // tegels(telefoons, relayBasis, origin): de lijst tegels die we KUNNEN tonen -- met hun basis, of live kan, en of het
  //  alleen-kijken is (F8/bank-kluis via de KERN). Nooit de F8 besturen; een telefoon zonder bruikbaar (niet-localhost) adres
  //  krijgt live:false met een reden. Begrensd op KERN.MAX_TEGELS.
  function tegels(telefoons, relayBasis, origin, nooitLijst, bankKluisLijst) {
    const lijst = (Array.isArray(telefoons) ? telefoons : []).slice(0, KERN.MAX_TEGELS || 8);
    return lijst.map((t) => {
      const kijk = KERN.kijkAlleen ? KERN.kijkAlleen(t.vinger, nooitLijst, t.naam, bankKluisLijst) : /f8/i.test(String(t.naam || ''));
      const bron = kiesBron(t, relayBasis, origin);
      const alle = bronnen(t, relayBasis);
      let reden = '';
      if (!alle.length) reden = 'geen direct of relay-adres (zet Tailscale aan, of gebruik de kabel-wand)';
      else if (!bron) reden = 'deze pagina is https en kan het http-adres niet ophalen (mixed content) -- via de https-relay of de ARTEMIS-console';
      return {
        naam: t.naam || 'Telefoon', vinger: t.vinger || null,
        basis: bron ? bron.basis : null, soort: bron ? bron.soort : null, onderwerp: bron ? bron.onderwerp : null,
        live: !!bron, kijkAlleen: !!kijk, reden: reden,
      };
    });
  }

  const API = {
    POLL_MS, JARVIS_POORT, isLokaal, isTailscale, basis, kanLive, schermUrl, tikUrl, schermUrlRelay,
    bronnen, kiesBron, tikFractie, tikPayload, tegels, kern: KERN,
  };

  // --- de browser-kant: INERT tot mount() wordt aangeroepen (geen netwerk bij het laden; dat eist de privé-hoek, §466) ---
  if (typeof document !== 'undefined') {
    // mount(container, opties): bouwt de inline wand in `container` en begint pas DAN te pollen. opties: { telefoons, relayBasis,
    //  origin, nooitLijst, bankKluisLijst, fetch? }. Geeft een handvat terug met stop() (noodstop + opruimen). Wordt door
    //  veronica.js aangeroepen (die mag netwerk); prive-hoek-ui.js blijft netwerkvrij en levert alleen de lege container.
    API.mount = function mount(container, opties) {
      const o = opties && typeof opties === 'object' ? opties : {};
      const haal = o.fetch || (typeof fetch === 'function' ? fetch.bind(null) : null);
      const origin = o.origin || (typeof location !== 'undefined' ? location.origin : '');
      const ontsleutel = typeof o.ontsleutel === 'function' ? o.ontsleutel : null;   // (base64) -> Blob/ArrayBuffer; nodig voor de relay-bron
      const rijen = tegels(o.telefoons, o.relayBasis, origin, o.nooitLijst || [], o.bankKluisLijst || []);
      if (!container) return { stop() {} };
      while (container.firstChild) container.removeChild(container.firstChild);
      const S = { timers: [], noodstop: false, canvassen: [] };
      const grid = document.createElement('div'); grid.className = 'swnRaster';
      grid.style.setProperty('--kolommen', String((KERN.rasterKolommen || (() => 1))(rijen.length || 1)));
      for (const t of rijen) {
        const tegel = document.createElement('div'); tegel.className = 'swnTegel';
        const naam = document.createElement('div'); naam.className = 'swnNaam';
        naam.textContent = t.kijkAlleen ? t.naam + ' (alleen kijken)' : t.naam;
        tegel.appendChild(naam);
        if (!t.live) {
          const p = document.createElement('p'); p.className = 'swnReden'; p.textContent = t.reden; tegel.appendChild(p);
          grid.appendChild(tegel); continue;
        }
        if (t.soort === 'relay' && !ontsleutel) {   // de relay geeft versleutelde base64 -- zonder sleutel geen beeld (eerlijk)
          const p = document.createElement('p'); p.className = 'swnReden'; p.textContent = 'relay-beeld, maar geen sleutel om het te tonen'; tegel.appendChild(p);
          grid.appendChild(tegel); continue;
        }
        const c = document.createElement('canvas'); c.className = 'swnScherm'; tegel.appendChild(c);
        const stand = (KERN.nieuweBeeldStand || (() => ({})))(Date.now());
        pollTegel(t, c, stand, S, haal, ontsleutel);
        if (!t.kijkAlleen) koppelTik(t, c, S, haal);
        grid.appendChild(tegel);
      }
      container.appendChild(grid);
      return {
        stop() { S.noodstop = true; S.timers.forEach((id) => clearInterval(id)); S.timers = []; },
        noodstop(aan) { S.noodstop = !!aan; },
      };
    };

    function pollTegel(t, canvas, stand, S, haal, ontsleutel) {
      if (!haal) return;
      const url = t.soort === 'relay' ? schermUrlRelay(t.basis, t.onderwerp) : schermUrl(t.basis);
      let bezig = false, teller = 0;
      const tik = async () => {
        if (bezig) return; bezig = true;
        try {
          const r = await haal(url, { cache: 'no-store' });
          if (r && r.ok) {
            // direct: de JPEG zelf; relay: base64 van de VERSLEUTELDE JPEG -> eerst ontsleutelen tot een blob
            let blob;
            if (t.soort === 'relay') { const b64 = await r.text(); blob = await ontsleutel(b64); }
            else blob = await r.blob();
            const bitmap = (blob && typeof createImageBitmap === 'function') ? await createImageBitmap(blob) : null;
            if (bitmap) {
              if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
              if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
              const ctx = canvas.getContext('2d'); if (ctx) ctx.drawImage(bitmap, 0, 0);
              teller += 1; if (KERN.werkBeeld) KERN.werkBeeld(stand, teller, Date.now());
            }
          }
        } catch (e) { /* een gemiste poll is geen ramp: de volgende haalt het in (geen decoder die vastloopt) */ }
        bezig = false;
      };
      const id = setInterval(tik, POLL_MS); S.timers.push(id); tik();
    }

    function koppelTik(t, canvas, S, haal) {
      const stuur = (payload) => { if (!haal || !payload) return; haal(tikUrl(t.basis), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(() => {}); };
      const mag = () => (KERN.magBesturen ? KERN.magBesturen(t, S.noodstop) : (!S.noodstop && !t.kijkAlleen));
      let neer = null;
      canvas.addEventListener('pointerdown', (ev) => {
        if (!mag()) return;
        neer = tikFractie(canvas.getBoundingClientRect(), canvas.width, canvas.height, ev.clientX, ev.clientY);
      });
      const los = (ev) => {
        if (!mag() || !neer) { neer = null; return; }
        const op = tikFractie(canvas.getBoundingClientRect(), canvas.width, canvas.height, ev.clientX, ev.clientY);
        const dx = Math.abs(op.x - neer.x), dy = Math.abs(op.y - neer.y);
        if (dx < 0.02 && dy < 0.02) stuur(tikPayload('tik', op.x, op.y));
        else stuur(tikPayload('veeg', neer, op));
        neer = null;
      };
      canvas.addEventListener('pointerup', los);
      canvas.addEventListener('pointercancel', () => { neer = null; });
      canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
    }

  }

  return API;
}));
