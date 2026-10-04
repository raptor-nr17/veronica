// ===================================================================
// VERONICA -- de kern (zonder scherm, zonder netwerk)
// ===================================================================
//
// Veronica is het commandostation op een computer met Chrome (een Chromebook). Ze praat
// rechtstreeks met elke vertrouwde telefoon met OlliteRT op het eigen netwerk, ook als
// de hoofdtelefoon weg is. Dit bestand bevat alleen de regels; veronica.js doet scherm
// en netwerk.
//
// DE VASTE REGEL: ALLEEN ECHTE METINGEN. Elk getal op het scherm is een meting met een
// BRON (welk eindpunt) en een TIJD (wanneer gemeten). Ouder dan 10 seconden = grijs, met
// "laatst gezien". Niet gemeten = "onbekend". Nooit een voorbeeld-, demo- of schatwaarde.
// Een test (check_veronica.js) bewaakt dat.
(function (wortel, fabriek) {
  if (typeof module === 'object' && module.exports) module.exports = fabriek();
  else wortel.VeronicaKern = fabriek();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_LEEFTIJD_MS = 10000;
  const JARVIS_POORT = 8080;
  const OLLITERT_POORT = 8000;

  // ---- Een meting: waarde + bron + tijd ----
  function meting(waarde, bron, t) {
    if (waarde === undefined || waarde === null || (typeof waarde === 'number' && !Number.isFinite(waarde))) return null;
    return { waarde, bron, t };
  }
  // Hoe oud, in gewone taal.
  function leeftijdZin(ms) {
    if (!(ms >= 0)) return '';
    const s = Math.round(ms / 1000);
    if (s < 2) return 'nu';
    if (s < 60) return `${s} s geleden`;
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min geleden` : `${Math.round(m / 60)} uur geleden`;
  }
  const klokZin = (t) => {
    const d = new Date(t);
    const tw = (n) => String(n).padStart(2, '0');
    return `${tw(d.getHours())}:${tw(d.getMinutes())}:${tw(d.getSeconds())}`;
  };
  // Wat er in een vakje komt. opmaak(waarde) maakt er tekst van.
  // Terug: { tekst, bron, oud, onbekend }.
  function vakje(m, nu, opmaak) {
    if (!m) return { tekst: 'onbekend', bron: '', oud: false, onbekend: true };
    const leeftijd = nu - m.t;
    const oud = leeftijd > MAX_LEEFTIJD_MS;
    const tekst = (opmaak || String)(m.waarde);
    return {
      tekst,
      bron: oud ? `${m.bron} · laatst gezien ${klokZin(m.t)}` : `${m.bron} · ${leeftijdZin(leeftijd)}`,
      oud,
      onbekend: false,
    };
  }

  // ---- Uit OlliteRT /health?metrics=true: alleen wat er staat ----
  function leesHealth(d, t) {
    const x = d && typeof d === 'object' ? d : {};
    const m = x.metrics && typeof x.metrics === 'object' ? x.metrics : {};
    const bron = 'OlliteRT /health';
    const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const uit = {
      model: meting(typeof (m.model || x.model) === 'string' ? (m.model || x.model) : null, bron, t),
      versneller: meting(typeof x.accelerator === 'string' ? x.accelerator.toUpperCase() : null, bron, t),
      bezig: meting(typeof m.is_inferring === 'boolean' ? m.is_inferring : null, bron, t),
      tps: meting(getal(m.decode_tokens_per_second), bron, t),
      tpsPiek: meting(getal(m.decode_tokens_per_second_peak), bron, t),
      context: meting(getal(m.context_utilization_percent), bron, t),
    };
    // Benutting = snelheid nu gedeeld door de piek, alleen tijdens rekenen (zelfde regel als
    // JARVIS). Geen echte CPU/GPU-%: dat kan niet zonder root op de telefoon.
    if (typeof m.is_inferring === 'boolean' && getal(m.decode_tokens_per_second_peak) > 0 && getal(m.decode_tokens_per_second) !== null) {
      const b = m.is_inferring ? Math.max(0, Math.min(100, Math.round((m.decode_tokens_per_second / m.decode_tokens_per_second_peak) * 100))) : 0;
      uit.benutting = meting(b, `${bron} (nu ÷ piek)`, t);
    } else uit.benutting = null;
    return uit;
  }

  // ---- Uit JARVIS /jarvis/status (alleen telefoons met JARVIS) ----
  const HITTE = ['geen', 'licht', 'matig', 'ernstig', 'kritiek', 'noodgeval', 'uitschakelen'];
  const STROOM = { altijd: 'Altijd', slim: 'Slim', zon: '100% zon' };
  function leesStatus(k, t) {
    const x = k && typeof k === 'object' ? k : {};
    const b = x.batterij && typeof x.batterij === 'object' ? x.batterij : {};
    const s = x.stroom && typeof x.stroom === 'object' ? x.stroom : {};
    const bron = 'JARVIS /jarvis/status';
    const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      batterij: meting(getal(b.procent), bron, t),
      laadt: meting(typeof b.laadt === 'boolean' ? b.laadt : null, bron, t),
      temperatuur: meting(getal(b.temperatuur), bron, t),
      hitte: meting(Number.isInteger(b.hitte) ? b.hitte : null, bron, t),
      headroom: meting(getal(b.headroom), bron, t),
      stroom: meting(typeof s.stand === 'string' ? (STROOM[s.stand] || s.stand) : null, bron, t),
      magRekenen: meting(typeof s.magRekenen === 'boolean' ? s.magRekenen : null, bron, t),
      rol: meting(x.rol === 'baas' || x.rol === 'werker' ? x.rol : null, bron, t),
    };
  }
  const hitteNaam = (n) => (Number.isInteger(n) && n >= 0 && n < HITTE.length ? HITTE[n] : 'onbekend');

  // De hittestand, met DEZELFDE grenzen als JARVIS (hitte.js): de test vergelijkt ze.
  function ruweStand(m) {
    const i = m || {};
    const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const head = getal(i.headroom);
    const temp = getal(i.temperatuur);
    const status = Number.isInteger(i.hitte) ? i.hitte : null;
    if (head === null && temp === null && status === null) return null;
    if ((status !== null && status >= 3) || (temp !== null && temp >= 40)) return 'rood';
    if ((head !== null && head > 0.95) || (temp !== null && temp >= 38)) return 'oranje';
    if ((head !== null && head >= 0.85) || (temp !== null && temp >= 35)) return 'geel';
    return 'groen';
  }

  // ---- De vertrouwde lijst (van de kern-telefoon: /jarvis/vertrouwd of de QR) ----
  // Alleen http-adressen op het eigen netwerk (of deze computer zelf). Een naam van
  // hoogstens 40 tekens. Wat niet klopt, valt eruit.
  function isEigenNet(host) {
    const d = String(host).split('.').map(Number);
    if (d.length !== 4 || d.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    return d[0] === 10 || d[0] === 127 || (d[0] === 192 && d[1] === 168) || (d[0] === 172 && d[1] >= 16 && d[1] <= 31) || (d[0] === 100 && d[1] >= 64 && d[1] <= 127);
  }
  function normaalAdres(tekst, poort) {
    const m = /^(?:http:\/\/)?(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?\/?$/.exec(String(tekst || '').trim());
    if (!m || !isEigenNet(m[1])) return null;
    const p = Number(m[2] || poort);
    return p > 0 && p < 65536 ? `http://${m[1]}:${p}` : null;
  }
  function leesVertrouwd(d) {
    const x = d && typeof d === 'object' ? d : {};
    const lijst = Array.isArray(x.telefoons) ? x.telefoons : [];
    const uit = [];
    for (const t of lijst) {
      const ruw = Array.isArray(t) ? { naam: t[0], adres: t[1] } : (t || {});
      const adres = normaalAdres(ruw.adres, OLLITERT_POORT);
      if (!adres || uit.some((u) => u.adres === adres)) continue;
      const naam = String(ruw.naam || '').trim().slice(0, 40) || `Telefoon ${adres.split('.')[3].split(':')[0]}`;
      const host = adres.slice(7).split(':')[0];
      const j = normaalAdres(ruw.jarvis, JARVIS_POORT);
      uit.push({
        naam, adres,
        jarvis: j || `http://${host}:${JARVIS_POORT}`,
        kern: ruw.kern === true,
        // De plek (1.9.0): mobiel (in je broekzak) of rek (koeler en stekker). Onbekend = null.
        plek: ruw.plek === 'mobiel' || ruw.plek === 'rek' ? ruw.plek : null,
        sleutel: typeof ruw.sleutel === 'string' ? ruw.sleutel.slice(0, 200) : '',
      });
    }
    // De stekkers (Tasmota): Veronica LEEST alleen (watt, kWh, aan/uit); sturen doet JARVIS.
    const stekkers = [];
    for (const k of Array.isArray(x.stekkers) ? x.stekkers : []) {
      const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/.exec(String((k && k.ip) || '').trim());
      if (!m || !isEigenNet(m[1]) || stekkers.some((s) => s.ip === m[0])) continue;
      stekkers.push({ naam: String(k.naam || 'Stekker').slice(0, 40), ip: m[0], rol: k.rol === 'laden' ? 'laden' : 'ventilator' });
    }
    return { telefoons: uit, stekkers, kern: normaalAdres(x.kern, JARVIS_POORT), code: /^\d{6}$/.test(String(x.code || '')) ? String(x.code) : null };
  }

  // Tasmota Status 8 (energie) en Power: alleen wat er staat.
  function leesStekker(status8, power, t) {
    const e = status8 && status8.StatusSNS && status8.StatusSNS.ENERGY ? status8.StatusSNS.ENERGY : {};
    const getal = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
      aan: meting(power && power.POWER === 'ON' ? true : power && power.POWER === 'OFF' ? false : null, 'Tasmota Power', t),
      watt: meting(getal(e.Power), 'Tasmota Status 8', t),
      kwh: meting(getal(e.Total), 'Tasmota Status 8', t),
      vandaag: meting(getal(e.Today), 'Tasmota Status 8', t),
    };
  }
  function leesQr(tekst) {
    let d;
    try { d = JSON.parse(String(tekst || '')); } catch (e) { return null; }
    if (!d || d.veronica !== 1) return null;
    // Sinds JARVIS 1.9.1: geen vaste code in de QR, alleen het adres en een EENMALIG token
    // (vijf minuten, een keer). Daarmee haalt Veronica de code en de lijst op.
    if (typeof d.t === 'string') {
      const kern = normaalAdres(d.kern, JARVIS_POORT);
      return kern && TOKEN_RE.test(d.t) ? { token: d.t, kern, telefoons: [], stekkers: [], code: null } : null;
    }
    return leesVertrouwd(d);
  }
  const TOKEN_RE = /^[0-9a-f]{32}$/;
  // Het antwoord op een token: { code, bundel }. Terug: de lijst MET de code, of null.
  function leesPakket(d) {
    if (!d || !/^\d{6}$/.test(String(d.code || '')) || !d.bundel || !Array.isArray(d.bundel.telefoons)) return null;
    const l = leesVertrouwd(d.bundel);
    l.code = String(d.code);
    return l;
  }
  // De QR die Veronica laat zien voor een NIEUWE telefoon (JARVIS: "Scan om te koppelen").
  function koppelQrTekst(kern, t) {
    const a = normaalAdres(kern, JARVIS_POORT);
    return a && TOKEN_RE.test(String(t || '')) ? JSON.stringify({ jk: 1, a, t }) : null;
  }

  // ---- Local Network Access (Chrome): zeg dat het verzoek naar het eigen netwerk gaat ----
  function lnaOpties(url) {
    let host = '';
    try { host = new URL(url).hostname; } catch (e) { return {}; }
    if (/^127\./.test(host) || host === 'localhost') return { targetAddressSpace: 'loopback' };
    return isEigenNet(host) ? { targetAddressSpace: 'local' } : {};
  }

  // Chrome (142+) vraagt een keer of deze pagina het lokale netwerk mag gebruiken. Is dat
  // geweigerd, of komt er van GEEN ENKELE telefoon antwoord terwijl de Chromebook wel online is,
  // dan zegt Veronica hoe je het terugzet. Terug: de uitleg, of '' als er niets mis lijkt.
  function lnaUitleg(i) {
    const o = i || {};
    const terug = 'Zet het terug: klik links van het adres op het slotje, dan Site-instellingen, en zet "Lokaal netwerk" op Toestaan. Laad de pagina daarna opnieuw.';
    if (o.toestemming === 'denied') return `Chrome laat Veronica de telefoons niet bereiken: toegang tot het lokale netwerk is geweigerd. ${terug}`;
    if (o.online && o.aantal > 0 && o.bereikbaar === 0 && o.stilMs >= 30000) {
      return `Geen enkele telefoon antwoordt. Staan ze aan en op hetzelfde wifi? Heeft Chrome gevraagd om het lokale netwerk en zei je nee, dan: ${terug}`;
    }
    return '';
  }

  // ---- Wie krijgt het volgende stukje werk? ----
  // staten: { adres: { bereikbaar, bezig, uitTot, vervangen, hitteStand } }. De kern
  // (de hoofdtelefoon) als laatste, zoals in het pantser. Heet (oranje/rood) = niets.
  function kiesTelefoon(telefoons, staten, nu) {
    const vrij = (telefoons || []).filter((t) => {
      const s = (staten && staten[t.adres]) || {};
      return s.bereikbaar === true && !s.bezig && !s.vervangen && !(s.uitTot > nu) && s.hitteStand !== 'oranje' && s.hitteStand !== 'rood';
    });
    if (!vrij.length) return null;
    const warm = (t) => ({ geel: 1 }[((staten || {})[t.adres] || {}).hitteStand] || 0);
    const laatst = (t) => ((staten || {})[t.adres] || {}).laatstGebruikt || 0;
    vrij.sort((a, b) => (a.kern ? 1 : 0) - (b.kern ? 1 : 0) || warm(a) - warm(b) || laatst(a) - laatst(b));
    return vrij[0];
  }

  // ---- Een SSE-stroom (OlliteRT, OpenAI-vorm) lezen ----
  function maakSseLezer() {
    let rest = '';
    let tekst = '';
    return {
      voeg(brok) {
        rest += String(brok);
        const regels = rest.split(/\r?\n/);
        rest = regels.pop();
        const nieuw = [];
        for (const r of regels) {
          const m = /^data:\s?(.*)$/.exec(r);
          if (!m || m[1] === '[DONE]') continue;
          try {
            const d = JSON.parse(m[1]);
            const deel = d && d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
            if (typeof deel === 'string' && deel) { tekst += deel; nieuw.push(deel); }
          } catch (e) { /* half bericht: overslaan */ }
        }
        return nieuw;
      },
      tekst: () => tekst,
    };
  }
  // Het denken van Gemma (<think>...</think>) hoort niet in het antwoord.
  const zonderDenken = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*$/, '').trim();

  // ZON EN STROOM uit stand.json van de hoofdtelefoon. Veronica rekent de zon NIET zelf uit:
  // de hoofdtelefoon is de enige bron (zonneklok, NOAA). Elk getal kreeg daar een leeftijd
  // (leeftijdMs, op het moment van samenstellen); hier wordt dat een meting met een tijdstip op
  // DEZE klok: ontvangen - leeftijd. Zo maakt een andere klok op de telefoon niets uit.
  // Terug: { rijen: [{ label, m }], staaf: meting | null } of null (niets bruikbaars).
  function leesZonStroom(d, ontvangen) {
    if (!d || typeof d !== 'object' || !d.zon) return null;
    const bij = (ms) => (typeof ms === 'number' && ms >= 0 ? ontvangen - ms : null);
    const tekst = (x) => (typeof x === 'string' ? x.slice(0, 200) : null);
    const g = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const graad = (x) => `${String(Math.round(x * 10) / 10).replace('.', ',')} °C`;
    const kwh = (x) => `${String(Math.round(x * 100) / 100).replace('.', ',')} kWh`;
    const duur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} u ${m % 60} min` : `${m} min`; };
    const rijen = [];
    const accuPer = {};                       // naam -> de accu-zin (voor de tegel)
    const z = d.zon;
    const zonStand = { open: !!z.open, nogMs: g(z.nogMs), totOpenMs: g(z.totOpenMs), geen: !z.venster, t: ontvangen };
    const zb = `${tekst(z.bron) || 'zonneklok'} · via de hoofdtelefoon`;
    rijen.push({ label: 'Zon op / onder', m: meting(tekst(z.opTekst) && tekst(z.onderTekst) ? `${tekst(z.opTekst)} / ${tekst(z.onderTekst)}` : null, zb, ontvangen) });
    const v = z.venster && tekst(z.venster.tekst);
    rijen.push({ label: 'Zonvenster', m: meting(v ? `${v} · ${z.open ? `open, nog ${duur(g(z.nogMs) || 0)}` : (g(z.totOpenMs) ? `dicht, open over ${duur(z.totOpenMs)}` : 'dicht tot morgen')}` : 'vandaag geen', zb, ontvangen) });
    const STAND = { altijd: 'Altijd', slim: 'Slim', zon: '100% zon' };
    rijen.push({ label: 'Stroom', m: meting(STAND[d.stand] || null, 'schuifknop op de hoofdtelefoon', ontvangen) });
    const w = d.weer;
    rijen.push({ label: 'Zon (hint)', m: w ? meting([g(w.bewolking) !== null ? `bewolking ${w.bewolking}%` : null, g(w.zonkracht) !== null ? `zonkracht ${w.zonkracht} W/m²` : null, g(w.dagMJ) !== null ? `dag ${String(w.dagMJ).replace('.', ',')} MJ/m²` : null].filter(Boolean).join(' · ') || null, tekst(w.bron) || 'Open-Meteo.com (CC BY 4.0)', bij(w.leeftijdMs))
      : meting(`alleen de zonneklok (${tekst(d.weerFout) || 'geen hint'})`, 'hoofdtelefoon', ontvangen) });
    const vent = d.ventilator;
    if (vent && typeof vent === 'object') {
      rijen.push({ label: `Ventilator: ${tekst(vent.naam) || ''}`, m: bij(vent.leeftijdMs) === null ? null
        : meting(`${vent.aan === true ? 'aan' : vent.aan === false ? 'uit' : 'aan/uit onbekend'}${tekst(vent.reden) ? ` · ${tekst(vent.reden)}` : ''}`, 'Tasmota, via de hoofdtelefoon', bij(vent.leeftijdMs)) });
    }
    for (const s of Array.isArray(d.stekkers) ? d.stekkers : []) {
      if (!s || s.rol !== 'laden') continue;
      rijen.push({ label: `Laden: ${tekst(s.naam) || ''}`, m: bij(s.leeftijdMs) === null ? null
        : meting(`${s.aan === true ? 'aan' : s.aan === false ? 'uit' : 'aan/uit onbekend'} · ${g(s.watt) !== null ? `${Math.round(s.watt)} W` : 'watt onbekend'} · vandaag ${g(s.vandaag) !== null ? kwh(s.vandaag) : 'onbekend'}${tekst(s.reden) ? ` · ${tekst(s.reden)}` : ''}`, 'Tasmota Status 8, via de hoofdtelefoon', bij(s.leeftijdMs)) });
    }
    const ICOON = { mobiel: '👖', rek: '🧊🔌' };
    if (!d.ladenGekoppeld && d.droog && d.droog.laden) {
      rijen.push({ label: 'Laden', m: meting(`stekker nog niet gekoppeld · zou nu ${d.droog.laden.aan ? 'aan' : 'uit'} (${tekst(d.droog.laden.reden) || ''})`, 'droog, via de hoofdtelefoon', bij(d.droog.laden.leeftijdMs)) });
    }
    if (!d.ventilatorGekoppeld && d.droog && d.droog.ventilator) {
      rijen.push({ label: 'Ventilator', m: meting(`stekker nog niet gekoppeld · zou nu ${d.droog.ventilator.aan ? 'aan' : 'uit'} (${tekst(d.droog.ventilator.reden) || ''})`, 'droog, via de hoofdtelefoon', bij(d.droog.ventilator.leeftijdMs)) });
    }
    for (const t of Array.isArray(d.telefoons) ? d.telefoons : []) {
      if (!t) continue;
      const icoon = ICOON[t.plek] ? `${ICOON[t.plek]} ` : '';
      if (tekst(t.accu) && tekst(t.naam)) accuPer[tekst(t.naam)] = tekst(t.accu);
      if (tekst(t.accu)) rijen.push({ label: `Accu ${icoon}${tekst(t.naam) || ''}`, m: meting(`${tekst(t.accu)}${tekst(t.zon) ? ` · ${tekst(t.zon)}` : ''}`, t.plek === 'mobiel' ? 'eigen metingen, via de hoofdtelefoon (mobiel: apart)' : 'eigen metingen, via de hoofdtelefoon', ontvangen) });
      rijen.push({ label: `${icoon}${tekst(t.naam) || 'telefoon'}`, m: bij(t.leeftijdMs) === null ? null
        : meting(`${g(t.procent) !== null ? `${t.procent}%` : '% onbekend'} · ${t.laadt === true ? 'laadt' : t.laadt === false ? 'laadt niet' : 'laden onbekend'} · ${g(t.temperatuur) !== null ? graad(t.temperatuur) : 'temperatuur onbekend'}`, `${tekst(t.bron) || 'JARVIS'}, via de hoofdtelefoon`, bij(t.leeftijdMs)) });
    }
    if (tekst(d.accuRek)) rijen.push({ label: 'Accu rek samen', m: meting(tekst(d.accuRek), 'eigen metingen, via de hoofdtelefoon', ontvangen) });
    const st = d.staaf;
    const staaf = st && g(st.zon) !== null && g(st.buiten) !== null
      ? meting({ zon: st.zon, buiten: st.buiten, onbekend: g(st.onbekend) || 0 }, `${tekst(st.bron) || 'Tasmota'}, via de hoofdtelefoon`, ontvangen) : null;
    return { rijen, staaf, accuPer, zon: zonStand };
  }

  // ---- HET KARAKTER VAN VERONICA: de nuchtere hulpdienst ----
  // Een eigen karakter (niet uit een film): kalm, beschermend, kort en kordaat. Ze zegt WAT ze
  // doet en WAAROM. Alleen voor haar eigen meldingen; nooit voor antwoorden van een model, en
  // het verandert niets aan wat er gebeurt. Getallen blijven precies zoals ze gemeten zijn.
  // stand: 'hulpdienst' (standaard) of 'zakelijk'. d = de feiten.
  const KARAKTERS = ['hulpdienst', 'zakelijk'];
  function graden(t) { return typeof t === 'number' && Number.isFinite(t) ? `${String(Math.round(t * 10) / 10).replace('.', ',')} graden` : null; }
  function veronicaZin(stand, wat, d) {
    const x = d || {};
    const hd = stand !== 'zakelijk';
    switch (wat) {
      case 'weg': return hd
        ? (x.anderen > 0 ? `${x.naam} is weg. Ik houd de rij draaiende tot hij terug is.` : `${x.naam} is weg. Er rekent nu niemand. Het werk wacht veilig in de rij.`)
        : `${x.naam} is niet bereikbaar.`;
      case 'terug': return hd ? `${x.naam} is terug. Hij krijgt weer werk.` : `${x.naam} is weer bereikbaar.`;
      case 'heet': {
        const g = graden(x.temperatuur);
        if (!hd) return `${x.naam}: ${g ? `${g}, ` : ''}${x.stand}. Krijgt geen nieuw werk.`;
        return `${g ? `${g} op de ${x.naam}` : `${x.naam} is te warm`}. ${x.ventilator ? 'Ventilator aan, werk gepauzeerd.' : 'Werk gepauzeerd.'}`;
      }
      case 'koel': return hd ? `${x.naam} is weer koel. Het werk gaat door.` : `${x.naam} is weer koel.`;
      case 'noodstop': return hd ? 'Noodstop. Alles staat stil. Het werk wacht veilig in de rij.' : 'NOODSTOP: alles stilgezet.';
      case 'rustig': return hd ? 'Alles rustig. Ik kijk mee.' : '';
      case 'volgt': return hd ? `De hoofdtelefoon is weg. ${x.naam} is nu de baas; ik kijk via hem mee.` : `Hoofdtelefoon onbereikbaar. Baas nu: ${x.naam}.`;
      case 'kernTerug': return hd ? 'De hoofdtelefoon is terug. Hij is weer de baas.' : 'Hoofdtelefoon weer bereikbaar.';
      default: return '';
    }
  }

  // DE THUISPOST: de hoofdtelefoon gaat de deur uit, Veronica blijft naast het rek. Is de hoofdtelefoon
  // weg, dan volgt ze de rek-telefoon die ZELF zegt dat hij nu baas is (rol in /jarvis/status,
  // vers). Nooit gegokt: zonder verse rol 'baas' geen vervanger. Terug: { adres, naam } of null.
  function baasUitStatus(telefoons, metingen, t, kern) {
    const lijst = Array.isArray(telefoons) ? telefoons : [];
    const kandidaten = lijst.filter((x) => x && x.jarvis && x.jarvis !== kern).filter((x) => {
      const st = metingen && metingen[x.adres] && metingen[x.adres].status;
      return st && st.rol && st.rol.waarde === 'baas' && t - st.rol.t <= MAX_LEEFTIJD_MS;
    });
    // Twee bazen tegelijk (gesplitst netwerk): dezelfde vaste keus als leider.js, het laagste adres.
    kandidaten.sort((a, b) => String(a.jarvis).localeCompare(String(b.jarvis)));
    return kandidaten.length ? { adres: kandidaten[0].jarvis, naam: kandidaten[0].naam } : null;
  }

  return {
    KARAKTERS, veronicaZin, baasUitStatus, lnaUitleg,
    leesZonStroom, leesPakket, koppelQrTekst,
    MAX_LEEFTIJD_MS, JARVIS_POORT, OLLITERT_POORT, HITTE,
    meting, vakje, leeftijdZin, klokZin, leesHealth, leesStatus, leesStekker, hitteNaam, ruweStand,
    isEigenNet, normaalAdres, leesVertrouwd, leesQr, lnaOpties, kiesTelefoon, maakSseLezer, zonderDenken,
  };
}));
